/**
 * Athena V3.1 - Loan & Advance Routes
 * Status flow: PENDING -> APPROVED -> ACTIVE (when EMI starts) -> CLOSED
 *
 * EMI formula: Standard reducing-balance method
 *   r   = annualRate / 12 / 100
 *   EMI = P × r × (1+r)^n / ((1+r)^n − 1)
 * Interest rate is configured in SystemSettings as `loan_interest_rate` (default 9% p.a.)
 *
 * GET    /api/loans              - list loans (own for employee; all for admin)
 * GET    /api/loans/rate         - get current loan interest rate (all authenticated users)
 * POST   /api/loans              - employee requests a loan
 * GET    /api/loans/:id          - single loan detail
 * GET    /api/loans/:id/schedule - full month-by-month repayment schedule
 * PATCH  /api/loans/:id/approve  - admin approves + optionally edits amount/installments
 * PATCH  /api/loans/:id/reject   - admin rejects
 */

import { Router, Response } from 'express';
import { prisma } from '../lib/prisma';
import { z } from 'zod';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';
import { createNotification } from '../lib/notify';
import { createAuditLog } from '../lib/audit';
import { getNumericRule } from '../lib/policyEngine';

const router = Router();

router.use(authenticate);

// ─── EMI helpers ──────────────────────────────────────────────────────────────

/**
 * Calculate fixed monthly EMI using reducing-balance formula.
 * If annualRate is 0, returns simple principal / tenure.
 */
function calculateEMI(principal: number, annualRate: number, tenure: number): number {
  if (annualRate === 0) return Math.round((principal / tenure) * 100) / 100;
  const r = annualRate / 12 / 100;
  const emi = (principal * r * Math.pow(1 + r, tenure)) / (Math.pow(1 + r, tenure) - 1);
  return Math.round(emi * 100) / 100;
}

interface ScheduleRow {
  emiNo:     number;
  month:     number;
  year:      number;
  emi:       number;
  principal: number;
  interest:  number;
  remaining: number;
}

/**
 * Generate a full month-by-month repayment schedule.
 * The last installment is adjusted to clear any rounding difference.
 */
function generateSchedule(
  principal: number,
  annualRate: number,
  tenure: number,
  emi: number,
  startMonth: number,
  startYear: number,
): ScheduleRow[] {
  const r = annualRate / 12 / 100;
  const schedule: ScheduleRow[] = [];
  let remaining = principal;

  for (let i = 1; i <= tenure; i++) {
    // Month/year for this installment
    const totalMonth = startMonth + (i - 1);
    const month = ((totalMonth - 1) % 12) + 1;
    const year  = startYear + Math.floor((totalMonth - 1) / 12);

    const interest = annualRate === 0 ? 0 : Math.round(remaining * r * 100) / 100;

    if (i === tenure) {
      // Last installment: pay exact remaining balance
      const lastEMI = Math.round((remaining + interest) * 100) / 100;
      schedule.push({ emiNo: i, month, year, emi: lastEMI, principal: remaining, interest, remaining: 0 });
      break;
    }

    const principalComponent = Math.round((emi - interest) * 100) / 100;
    remaining = Math.round((remaining - principalComponent) * 100) / 100;
    schedule.push({ emiNo: i, month, year, emi, principal: principalComponent, interest, remaining });
  }

  return schedule;
}

// ─── Zod schemas ──────────────────────────────────────────────────────────────

const loanSchema = z.object({
  amount:       z.number().positive('Amount must be positive'),
  installments: z.number().int().min(1, 'Minimum 1 installment'),
  reason:       z.string().min(5, 'Reason must be at least 5 characters'),
});

const approveSchema = z.object({
  startMonth:   z.number().int().min(1).max(12),
  startYear:    z.number().int().min(2020).max(2100),
  installments: z.number().int().min(1).max(60).optional(),
  amount:       z.number().positive().optional(),
});

// ─── GET /api/loans/rate — public rate for preview (all authenticated users) ──

router.get('/rate', async (_req: AuthRequest, res: Response) => {
  try {
    const setting = await prisma.systemSetting.findUnique({ where: { key: 'loan_interest_rate' } });
    const rate = Number(setting?.value ?? '9');
    res.json({ rate });
  } catch (err) {
    console.error('Get loan rate error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/loans — list ────────────────────────────────────────────────────

router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!;
    const where = user.role === 'EMPLOYEE' ? { userId: user.id } : {};
    const loans = await prisma.loanRequest.findMany({
      where,
      include: {
        user: { select: { email: true, profile: { select: { firstName: true, lastName: true, employeeId: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(loans);
  } catch (err) {
    console.error('List loans error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/loans — employee requests loan ─────────────────────────────────

router.post('/', authorize(['EMPLOYEE', 'MANAGER']), async (req: AuthRequest, res: Response) => {
  const parsed = loanSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }

  const { amount, installments, reason } = parsed.data;

  try {
    // Validate against policy-configured limits
    const maxAmount       = await getNumericRule(null, 'max_loan_amount', 5000000);
    const maxInstallments = await getNumericRule(null, 'max_loan_installments', 60);
    if (amount > maxAmount) {
      res.status(400).json({ error: `Maximum loan amount is ₹${maxAmount.toLocaleString('en-IN')}` });
      return;
    }
    if (installments > maxInstallments) {
      res.status(400).json({ error: `Maximum installments allowed is ${maxInstallments}` });
      return;
    }

    // Block if there's already an active/pending loan
    const existing = await prisma.loanRequest.findFirst({
      where: { userId: req.user!.id, status: { in: ['PENDING', 'APPROVED', 'ACTIVE'] } },
    });
    if (existing) {
      res.status(409).json({ error: 'You already have an active or pending loan request' });
      return;
    }

    // Preview EMI (no interest yet — actual EMI computed at approval with rate from settings)
    const previewEMI = Math.round((amount / installments) * 100) / 100;

    const loan = await prisma.loanRequest.create({
      data: {
        userId:       req.user!.id,
        amount,
        installments,
        monthlyEMI:  previewEMI,
        interestRate: 0,  // will be set at approval
        reason,
      },
    });

    // Notify admins
    const admins = await prisma.user.findMany({
      where: { role: { in: ['ADMIN', 'OWNER'] }, isActive: true },
      select: { id: true },
    });
    for (const admin of admins) {
      await createNotification({
        userId:  admin.id,
        type:    'LOAN_REQUESTED',
        title:   'New Loan Request',
        message: `A loan request of ₹${amount.toLocaleString('en-IN')} has been submitted.`,
        link:    '/loans',
      });
    }

    res.status(201).json(loan);
  } catch (err) {
    console.error('Create loan error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/loans/:id — single loan detail ──────────────────────────────────

router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const loan = await prisma.loanRequest.findUnique({
      where: { id: req.params.id },
      include: {
        user: { select: { email: true, profile: { select: { firstName: true, lastName: true, employeeId: true } } } },
      },
    });
    if (!loan) {
      res.status(404).json({ error: 'Loan not found' });
      return;
    }
    if (req.user!.role === 'EMPLOYEE' && loan.userId !== req.user!.id) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    res.json(loan);
  } catch (err) {
    console.error('Get loan error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/loans/:id/schedule — full repayment schedule ───────────────────

router.get('/:id/schedule', async (req: AuthRequest, res: Response) => {
  try {
    const loan = await prisma.loanRequest.findUnique({ where: { id: req.params.id } });
    if (!loan) {
      res.status(404).json({ error: 'Loan not found' });
      return;
    }
    if (req.user!.role === 'EMPLOYEE' && loan.userId !== req.user!.id) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    if (!loan.startMonth || !loan.startYear) {
      res.json({ schedule: [], paidInstallments: 0 });
      return;
    }

    const schedule = generateSchedule(
      loan.amount,
      loan.interestRate,
      loan.installments,
      loan.monthlyEMI,
      loan.startMonth,
      loan.startYear,
    );

    res.json({ schedule, paidInstallments: loan.paidInstallments });
  } catch (err) {
    console.error('Schedule error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── PATCH /api/loans/:id/approve — admin approves ───────────────────────────

router.patch('/:id/approve', authorize(['ADMIN', 'OWNER']), async (req: AuthRequest, res: Response) => {
  const parsed = approveSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }

  try {
    const loan = await prisma.loanRequest.findUnique({ where: { id: req.params.id } });
    if (!loan) {
      res.status(404).json({ error: 'Loan not found' });
      return;
    }
    if (loan.status !== 'PENDING') {
      res.status(400).json({ error: `Cannot approve a loan that is ${loan.status}` });
      return;
    }
    if (loan.userId === req.user!.id) {
      res.status(403).json({ error: 'You cannot approve your own loan request' });
      return;
    }

    const { startMonth, startYear, installments, amount } = parsed.data;
    const finalAmount       = amount       ?? loan.amount;
    const finalInstallments = installments ?? loan.installments;

    // Read current interest rate from settings
    const rateSetting  = await prisma.systemSetting.findUnique({ where: { key: 'loan_interest_rate' } });
    const interestRate = Number(rateSetting?.value ?? '9');

    const newEMI = calculateEMI(finalAmount, interestRate, finalInstallments);

    const updated = await prisma.loanRequest.update({
      where: { id: req.params.id },
      data: {
        status:       'APPROVED',
        approvedBy:   req.user!.id,
        approvedAt:   new Date(),
        startMonth,
        startYear,
        amount:       finalAmount,
        installments: finalInstallments,
        monthlyEMI:   newEMI,
        interestRate,
      },
    });

    await createNotification({
      userId:  loan.userId,
      type:    'LOAN_APPROVED',
      title:   'Loan Approved',
      message: `Your loan of ₹${finalAmount.toLocaleString('en-IN')} has been approved. Monthly EMI of ₹${newEMI.toLocaleString('en-IN')} starts from ${startMonth}/${startYear} at ${interestRate}% p.a.`,
      link:    '/loans',
    });

    await createAuditLog({
      actorId:  req.user!.id,
      action:   'LOAN_APPROVED',
      entity:   'LoanRequest',
      entityId: loan.id,
      oldValues: { status: 'PENDING', amount: loan.amount, installments: loan.installments },
      newValues: { status: 'APPROVED', amount: finalAmount, installments: finalInstallments, startMonth, startYear, monthlyEMI: newEMI, interestRate },
      changeSource: 'WEB',
    });

    res.json(updated);
  } catch (err) {
    console.error('Approve loan error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── PATCH /api/loans/:id/reject — admin rejects ─────────────────────────────

router.patch('/:id/reject', authorize(['ADMIN', 'OWNER']), async (req: AuthRequest, res: Response) => {
  try {
    const loan = await prisma.loanRequest.findUnique({ where: { id: req.params.id } });
    if (!loan) {
      res.status(404).json({ error: 'Loan not found' });
      return;
    }
    if (loan.status !== 'PENDING') {
      res.status(400).json({ error: `Cannot reject a loan that is ${loan.status}` });
      return;
    }
    if (loan.userId === req.user!.id) {
      res.status(403).json({ error: 'You cannot reject your own loan request' });
      return;
    }

    const { reason } = req.body;
    const updated = await prisma.loanRequest.update({
      where: { id: req.params.id },
      data: { status: 'REJECTED' },
    });

    await createNotification({
      userId:  loan.userId,
      type:    'LOAN_REJECTED',
      title:   'Loan Rejected',
      message: `Your loan request of ₹${loan.amount.toLocaleString('en-IN')} has been rejected.${reason ? ` Reason: ${reason}` : ''}`,
      link:    '/loans',
    });

    await createAuditLog({
      actorId:  req.user!.id,
      action:   'LOAN_REJECTED',
      entity:   'LoanRequest',
      entityId: loan.id,
      oldValues: { status: 'PENDING' },
      newValues: { status: 'REJECTED', reason },
      changeSource: 'WEB',
    });

    res.json(updated);
  } catch (err) {
    console.error('Reject loan error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
