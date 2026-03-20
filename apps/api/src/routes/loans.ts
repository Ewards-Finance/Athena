/**
 * Athena V3.1 - Loan & Advance Routes
 * Status flow: PENDING -> APPROVED -> ACTIVE (when EMI starts) -> CLOSED
 *
 * GET    /api/loans              - list loans (own for employee; all for admin)
 * POST   /api/loans              - employee requests a loan
 * GET    /api/loans/:id          - single loan detail
 * PATCH  /api/loans/:id/approve  - admin approves + sets repayment schedule
 * PATCH  /api/loans/:id/reject   - admin rejects
 */

import { Router, Response } from 'express';
import { prisma } from '../lib/prisma';
import { z } from 'zod';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';
import { createNotification } from '../lib/notify';
import { createAuditLog } from '../lib/audit';

const router = Router();

router.use(authenticate);

// Zod: loan request
const loanSchema = z.object({
  amount:       z.number().positive('Amount must be positive').max(5000000, 'Max loan amount is 50 lakhs'),
  installments: z.number().int().min(1).max(60, 'Max 60 installments'),
  reason:       z.string().min(5, 'Reason must be at least 5 characters'),
});

// Zod: approve
const approveSchema = z.object({
  startMonth: z.number().int().min(1).max(12),
  startYear:  z.number().int().min(2020).max(2100),
  installments: z.number().int().min(1).max(60).optional(),
});

// GET /api/loans - list
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

// POST /api/loans - employee requests loan
router.post('/', authorize(['EMPLOYEE', 'MANAGER']), async (req: AuthRequest, res: Response) => {
  const parsed = loanSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }

  const { amount, installments, reason } = parsed.data;
  const monthlyEMI = Math.round((amount / installments) * 100) / 100;

  try {
    // Check for existing active/pending loan
    const existing = await prisma.loanRequest.findFirst({
      where: { userId: req.user!.id, status: { in: ['PENDING', 'APPROVED', 'ACTIVE'] } },
    });
    if (existing) {
      res.status(409).json({ error: 'You already have an active or pending loan request' });
      return;
    }

    const loan = await prisma.loanRequest.create({
      data: {
        userId: req.user!.id,
        amount,
        installments,
        monthlyEMI,
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
        message: `A loan request of ${amount} has been submitted.`,
        link:    '/loans',
      });
    }

    res.status(201).json(loan);
  } catch (err) {
    console.error('Create loan error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/loans/:id - single loan
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
    // Employees can only see their own
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

// PATCH /api/loans/:id/approve - admin approves
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

    const { startMonth, startYear, installments } = parsed.data;
    const newInstallments = installments ?? loan.installments;
    const newEMI = Math.round((loan.amount / newInstallments) * 100) / 100;

    const updated = await prisma.loanRequest.update({
      where: { id: req.params.id },
      data: {
        status:       'APPROVED',
        approvedBy:   req.user!.id,
        approvedAt:   new Date(),
        startMonth,
        startYear,
        installments: newInstallments,
        monthlyEMI:   newEMI,
      },
    });

    await createNotification({
      userId:  loan.userId,
      type:    'LOAN_APPROVED',
      title:   'Loan Approved',
      message: `Your loan of ${loan.amount} has been approved. EMI of ${newEMI}/month starts from ${startMonth}/${startYear}.`,
      link:    '/loans',
    });

    await createAuditLog({
      actorId:  req.user!.id,
      action:   'LOAN_APPROVED',
      entity:   'LoanRequest',
      entityId: loan.id,
      oldValues: { status: 'PENDING' },
      newValues: { status: 'APPROVED', startMonth, startYear, monthlyEMI: newEMI },
    });

    res.json(updated);
  } catch (err) {
    console.error('Approve loan error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/loans/:id/reject - admin rejects
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

    const { reason } = req.body;
    const updated = await prisma.loanRequest.update({
      where: { id: req.params.id },
      data: { status: 'REJECTED' },
    });

    await createNotification({
      userId:  loan.userId,
      type:    'LOAN_REJECTED',
      title:   'Loan Rejected',
      message: `Your loan request of ${loan.amount} has been rejected.${reason ? ` Reason: ${reason}` : ''}`,
      link:    '/loans',
    });

    await createAuditLog({
      actorId:  req.user!.id,
      action:   'LOAN_REJECTED',
      entity:   'LoanRequest',
      entityId: loan.id,
      oldValues: { status: 'PENDING' },
      newValues: { status: 'REJECTED', reason },
    });

    res.json(updated);
  } catch (err) {
    console.error('Reject loan error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
