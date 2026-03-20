/**
 * Athena V2 - Exit Management Routes
 *
 * POST   /api/exit              - Initiate exit (resignation or admin-triggered)
 * GET    /api/exit              - List exits (scoped by role)
 * GET    /api/exit/:id          - Exit detail
 * PATCH  /api/exit/:id/clearance  - Mark department clearance
 * POST   /api/exit/:id/settlement - Calculate & save final settlement
 * PATCH  /api/exit/:id/cancel     - Cancel exit
 */

import { Router, Response } from 'express';
import { AuthRequest, authenticate, authorize } from '../middleware/auth';
import { prisma } from '../lib/prisma';
import { createNotification, createNotifications } from '../lib/notify';
import { createAuditLog } from '../lib/audit';

const router = Router();

router.use(authenticate);

const CLEARANCE_DEPARTMENTS = ['IT', 'Finance', 'HR', 'Admin', 'Manager'];

// ─── Helper ──────────────────────────────────────────────────────────────────

function daysInMonth(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ─── POST / — Initiate exit ──────────────────────────────────────────────────

router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const actor = req.user!;
    const { userId, reason, lastWorkingDate, noticePeriodDays, buyoutDays } = req.body;

    if (!userId || !reason || !lastWorkingDate) {
      return res.status(400).json({ error: 'Missing required fields: userId, reason, lastWorkingDate' });
    }

    // Employees can only resign themselves
    if (actor.role === 'EMPLOYEE' && userId !== actor.id) {
      return res.status(403).json({ error: 'Employees can only initiate their own exit' });
    }

    // Validate user exists and is active
    const targetUser = await prisma.user.findUnique({
      where: { id: userId },
      include: { profile: true },
    });

    if (!targetUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (!targetUser.isActive) {
      return res.status(400).json({ error: 'User is not active' });
    }

    // Check for existing non-cancelled exit request
    const existing = await prisma.exitRequest.findUnique({
      where: { userId },
    });

    if (existing && existing.status !== 'CANCELLED') {
      return res.status(409).json({ error: 'An active exit request already exists for this user' });
    }

    const finalNoticeDays = noticePeriodDays ?? 90;
    let buyoutAmount: number | null = null;

    if (buyoutDays && targetUser.profile?.annualCtc) {
      buyoutAmount = r2((targetUser.profile.annualCtc / 365) * buyoutDays);
    }

    const exitRequest = await prisma.$transaction(async (tx) => {
      // If there was a cancelled exit request, delete it first (userId is @unique)
      if (existing && existing.status === 'CANCELLED') {
        await tx.exitClearance.deleteMany({ where: { exitRequestId: existing.id } });
        await tx.exitRequest.delete({ where: { id: existing.id } });
      }

      // Create ExitRequest
      const exit = await tx.exitRequest.create({
        data: {
          userId,
          initiatedBy: actor.id,
          reason,
          lastWorkingDate: new Date(lastWorkingDate),
          noticePeriodDays: finalNoticeDays,
          buyoutDays: buyoutDays || null,
          buyoutAmount,
          status: 'INITIATED',
        },
      });

      // Create 5 clearance rows
      await tx.exitClearance.createMany({
        data: CLEARANCE_DEPARTMENTS.map((dept) => ({
          exitRequestId: exit.id,
          department: dept,
          status: 'PENDING' as const,
        })),
      });

      // Update user employment status
      await tx.user.update({
        where: { id: userId },
        data: { employmentStatus: 'NOTICE_PERIOD' },
      });

      return exit;
    });

    // Notify all OWNER/ADMIN users
    const admins = await prisma.user.findMany({
      where: { role: { in: ['OWNER', 'ADMIN'] }, isActive: true },
      select: { id: true },
    });

    const employeeName = targetUser.profile
      ? `${targetUser.profile.firstName} ${targetUser.profile.lastName}`
      : targetUser.email;

    await createNotifications(
      admins
        .filter((a) => a.id !== actor.id)
        .map((a) => ({
          userId: a.id,
          type: 'EXIT_INITIATED',
          title: 'Exit Initiated',
          message: `${employeeName} has initiated an exit request.`,
          link: '/exit',
        }))
    );

    // Audit log
    await createAuditLog({
      actorId: actor.id,
      action: 'EXIT_INITIATED',
      entity: 'ExitRequest',
      entityId: exitRequest.id,
      subjectEntity: 'User',
      subjectId: userId,
      subjectLabel: employeeName,
      newValues: { reason, lastWorkingDate, noticePeriodDays: finalNoticeDays, buyoutDays, buyoutAmount },
    });

    res.status(201).json(exitRequest);
  } catch (err) {
    console.error('[exit] POST / error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET / — List exits ─────────────────────────────────────────────────────

router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!;
    const isAdminOrOwner = user.role === 'OWNER' || user.role === 'ADMIN';

    const where = isAdminOrOwner ? {} : { userId: user.id };

    const exits = await prisma.exitRequest.findMany({
      where,
      include: {
        clearances: true,
        settlement: true,
        user: { include: { profile: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json(exits);
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /:id — Exit detail ─────────────────────────────────────────────────

router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!;

    const exit = await prisma.exitRequest.findUnique({
      where: { id: req.params.id },
      include: {
        clearances: true,
        settlement: true,
        user: {
          include: {
            profile: true,
            leaveBalances: true,
          },
        },
      },
    });

    if (!exit) {
      return res.status(404).json({ error: 'Not found' });
    }

    // Access check: OWNER/ADMIN or the user themselves
    const isAdminOrOwner = user.role === 'OWNER' || user.role === 'ADMIN';
    if (!isAdminOrOwner && exit.userId !== user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    res.json(exit);
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── PATCH /:id/clearance — Mark department clearance ───────────────────────

router.patch('/:id/clearance', authorize(['ADMIN', 'OWNER']), async (req: AuthRequest, res: Response) => {
  try {
    const actor = req.user!;
    const { department, status, remarks } = req.body;

    if (!department || status !== 'CLEARED') {
      return res.status(400).json({ error: 'Missing or invalid fields: department, status must be CLEARED' });
    }

    const exitRequest = await prisma.exitRequest.findUnique({
      where: { id: req.params.id },
      include: { clearances: true },
    });

    if (!exitRequest) {
      return res.status(404).json({ error: 'Not found' });
    }

    const clearance = exitRequest.clearances.find((c) => c.department === department);
    if (!clearance) {
      return res.status(404).json({ error: `Clearance for department '${department}' not found` });
    }

    // Update the clearance
    const updated = await prisma.exitClearance.update({
      where: { id: clearance.id },
      data: {
        status: 'CLEARED',
        clearedBy: actor.id,
        clearedAt: new Date(),
        remarks: remarks || null,
      },
    });

    // Check if ALL 5 clearances are now CLEARED
    const allClearances = await prisma.exitClearance.findMany({
      where: { exitRequestId: exitRequest.id },
    });

    const allCleared = allClearances.every((c) =>
      c.id === clearance.id ? true : c.status === 'CLEARED'
    );

    if (allCleared) {
      await prisma.exitRequest.update({
        where: { id: exitRequest.id },
        data: { status: 'CLEARANCE_PENDING' },
      });
    }

    // Audit log
    await createAuditLog({
      actorId: actor.id,
      action: 'EXIT_CLEARANCE_MARKED',
      entity: 'ExitClearance',
      entityId: clearance.id,
      subjectEntity: 'ExitRequest',
      subjectId: exitRequest.id,
      newValues: { department, status: 'CLEARED', remarks },
    });

    res.json(updated);
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /:id/settlement — Calculate & save final settlement ───────────────

router.post('/:id/settlement', authorize(['ADMIN', 'OWNER']), async (req: AuthRequest, res: Response) => {
  try {
    const actor = req.user!;

    const exitRequest = await prisma.exitRequest.findUnique({
      where: { id: req.params.id },
      include: {
        user: {
          include: {
            profile: true,
            leaveBalances: true,
          },
        },
        settlement: true,
      },
    });

    if (!exitRequest) {
      return res.status(404).json({ error: 'Not found' });
    }

    if (exitRequest.settlement) {
      return res.status(409).json({ error: 'Final settlement already exists for this exit' });
    }

    const profile = exitRequest.user.profile;
    if (!profile) {
      return res.status(400).json({ error: 'User profile not found — cannot calculate settlement' });
    }

    const annualCtc = profile.annualCtc || 0;
    const lwd = new Date(exitRequest.lastWorkingDate);

    // 1. Prorated last month salary
    const daysInLwdMonth = daysInMonth(lwd);
    const lastMonthSalaryProrated = r2((annualCtc / 12) * (lwd.getDate() / daysInLwdMonth));

    // 2. Leave encashment — sum unused days for encashable leave types
    const encashablePolicies = await prisma.leavePolicy.findMany({
      where: { encashable: true, isActive: true },
    });

    const encashableTypes = encashablePolicies.map((p) => p.leaveType);
    const currentYear = lwd.getFullYear();

    const currentYearBalances = exitRequest.user.leaveBalances.filter(
      (lb) => lb.year === currentYear && encashableTypes.includes(lb.leaveType)
    );

    const leaveEncashmentDays = currentYearBalances.reduce((sum, lb) => {
      const unused = lb.total - lb.used;
      return sum + (unused > 0 ? unused : 0);
    }, 0);

    const leaveEncashmentAmount = r2(leaveEncashmentDays * (annualCtc / 365));

    // 3. Pending approved claims
    const pendingClaims = await prisma.reimbursement.findMany({
      where: { employeeId: exitRequest.userId, status: 'APPROVED' },
    });

    const pendingClaimsAmount = r2(pendingClaims.reduce((sum, c) => sum + c.amount, 0));

    // 4. Notice period recovery (buyout)
    const noticePeriodRecovery = exitRequest.buyoutAmount || 0;

    // 5. Optional body overrides for arrears, bonus, loan, other deductions
    const arrearsPending = req.body.arrearsPending ?? 0;
    const bonusPending = req.body.bonusPending ?? 0;
    const loanOutstanding = req.body.loanOutstanding ?? 0;
    const otherDeductions = req.body.otherDeductions ?? 0;

    // 6. Total payable
    const totalPayable = r2(
      lastMonthSalaryProrated +
      leaveEncashmentAmount +
      pendingClaimsAmount +
      arrearsPending +
      bonusPending -
      noticePeriodRecovery -
      loanOutstanding -
      otherDeductions
    );

    // Transaction: create settlement, update exit status, deactivate user
    const settlement = await prisma.$transaction(async (tx) => {
      const fs = await tx.finalSettlement.create({
        data: {
          exitRequestId: exitRequest.id,
          lastMonthSalaryProrated,
          leaveEncashmentDays,
          leaveEncashmentAmount,
          pendingClaimsAmount,
          arrearsPending,
          bonusPending,
          noticePeriodRecovery,
          loanOutstanding,
          otherDeductions,
          totalPayable,
          processedBy: actor.id,
          processedAt: new Date(),
        },
      });

      await tx.exitRequest.update({
        where: { id: exitRequest.id },
        data: { status: 'SETTLED' },
      });

      await tx.user.update({
        where: { id: exitRequest.userId },
        data: { isActive: false },
      });

      return fs;
    });

    // Notify exiting user
    await createNotification({
      userId: exitRequest.userId,
      type: 'EXIT_SETTLED',
      title: 'Final Settlement Processed',
      message: 'Your final settlement has been calculated. Please review the details.',
      link: '/exit',
    });

    // Audit log
    const employeeName = profile
      ? `${profile.firstName} ${profile.lastName}`
      : exitRequest.user.email;

    await createAuditLog({
      actorId: actor.id,
      action: 'EXIT_SETTLEMENT_PROCESSED',
      entity: 'FinalSettlement',
      entityId: settlement.id,
      subjectEntity: 'User',
      subjectId: exitRequest.userId,
      subjectLabel: employeeName,
      newValues: {
        lastMonthSalaryProrated,
        leaveEncashmentDays,
        leaveEncashmentAmount,
        pendingClaimsAmount,
        arrearsPending,
        bonusPending,
        noticePeriodRecovery,
        loanOutstanding,
        otherDeductions,
        totalPayable,
      },
    });

    res.status(201).json(settlement);
  } catch (err) {
    console.error('[exit] POST /:id/settlement error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── PATCH /:id/cancel — Cancel exit ────────────────────────────────────────

router.patch('/:id/cancel', authorize(['ADMIN', 'OWNER']), async (req: AuthRequest, res: Response) => {
  try {
    const actor = req.user!;

    const exitRequest = await prisma.exitRequest.findUnique({
      where: { id: req.params.id },
      include: { user: { include: { profile: true } } },
    });

    if (!exitRequest) {
      return res.status(404).json({ error: 'Not found' });
    }

    if (exitRequest.status === 'SETTLED') {
      return res.status(400).json({ error: 'Cannot cancel a settled exit request' });
    }

    if (exitRequest.status === 'CANCELLED') {
      return res.status(400).json({ error: 'Exit request is already cancelled' });
    }

    await prisma.$transaction(async (tx) => {
      await tx.exitRequest.update({
        where: { id: exitRequest.id },
        data: { status: 'CANCELLED' },
      });

      await tx.user.update({
        where: { id: exitRequest.userId },
        data: {
          isActive: true,
          employmentStatus: 'REGULAR_FULL_TIME',
        },
      });
    });

    const employeeName = exitRequest.user.profile
      ? `${exitRequest.user.profile.firstName} ${exitRequest.user.profile.lastName}`
      : exitRequest.user.email;

    // Audit log
    await createAuditLog({
      actorId: actor.id,
      action: 'EXIT_CANCELLED',
      entity: 'ExitRequest',
      entityId: exitRequest.id,
      subjectEntity: 'User',
      subjectId: exitRequest.userId,
      subjectLabel: employeeName,
      oldValues: { status: exitRequest.status },
      newValues: { status: 'CANCELLED' },
    });

    // Notify the employee
    createNotification({
      userId: exitRequest.userId,
      type: 'EXIT_CANCELLED',
      title: 'Exit Cancelled',
      message: 'Your exit request has been cancelled. You remain active.',
      link: '/profile',
    });

    res.json({ message: 'Exit request cancelled successfully' });
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
