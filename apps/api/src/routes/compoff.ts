/**
 * Athena V3.1 - Comp-Off (Compensatory Off) Routes
 * Status flow: PENDING -> APPROVED -> USED / EXPIRED
 *
 * GET    /api/compoff              - list comp-offs (own for employee; all for admin/manager)
 * POST   /api/compoff              - employee requests comp-off for a worked holiday/weekend
 * GET    /api/compoff/balance      - available comp-off count for logged-in user
 * GET    /api/compoff/pending      - pending comp-off requests (admin/manager)
 * PATCH  /api/compoff/:id/approve  - admin/manager approves
 * PATCH  /api/compoff/:id/reject   - admin/manager rejects
 */

import { Router, Response } from 'express';
import { prisma } from '../lib/prisma';
import { z } from 'zod';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';
import { createNotification } from '../lib/notify';
import { getNumericRule } from '../lib/policyEngine';

const router = Router();

router.use(authenticate);

// Zod: comp-off request
const compoffSchema = z.object({
  earnedDate: z.string().min(1, 'Date is required'),
  reason:     z.string().min(5, 'Reason must be at least 5 characters'),
});

// GET /api/compoff/balance - available count for logged-in user
router.get('/balance', async (req: AuthRequest, res: Response) => {
  try {
    const count = await prisma.compOff.count({
      where: {
        userId: req.user!.id,
        status: 'APPROVED',
        expiresAt: { gt: new Date() },
      },
    });
    res.json({ balance: count });
  } catch (err) {
    console.error('Comp-off balance error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/compoff/pending - admin/manager: pending requests
router.get('/pending', authorize(['ADMIN', 'MANAGER', 'OWNER']), async (_req: AuthRequest, res: Response) => {
  try {
    const pending = await prisma.compOff.findMany({
      where: { status: 'PENDING' },
      include: {
        user: { select: { email: true, profile: { select: { firstName: true, lastName: true, employeeId: true, department: true } } } },
      },
      orderBy: { createdAt: 'asc' },
    });
    res.json(pending);
  } catch (err) {
    console.error('Pending comp-offs error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/compoff - list
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!;
    const where = user.role === 'EMPLOYEE' ? { userId: user.id } : {};
    const compoffs = await prisma.compOff.findMany({
      where,
      include: {
        user: { select: { email: true, profile: { select: { firstName: true, lastName: true, employeeId: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(compoffs);
  } catch (err) {
    console.error('List comp-offs error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/compoff - employee requests comp-off
router.post('/', authorize(['EMPLOYEE', 'MANAGER']), async (req: AuthRequest, res: Response) => {
  const parsed = compoffSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }

  const earnedDate = new Date(parsed.data.earnedDate);
  const { reason } = parsed.data;

  try {
    // Validate: earnedDate must be a weekend or holiday
    const dow = earnedDate.getDay();
    const isWeekend = dow === 0 || dow === 6;

    let isHoliday = false;
    if (!isWeekend) {
      const holiday = await prisma.holiday.findFirst({
        where: {
          date: {
            gte: new Date(earnedDate.toISOString().split('T')[0]),
            lt:  new Date(new Date(earnedDate).setDate(earnedDate.getDate() + 1)),
          },
        },
      });
      isHoliday = !!holiday;
    }

    if (!isWeekend && !isHoliday) {
      res.status(400).json({ error: 'Comp-off can only be requested for weekends or holidays' });
      return;
    }

    // Validate: earnedDate must not be in the future
    if (earnedDate > new Date()) {
      res.status(400).json({ error: 'Comp-off date cannot be in the future' });
      return;
    }

    // Check for duplicate
    const existing = await prisma.compOff.findUnique({
      where: { userId_earnedDate: { userId: req.user!.id, earnedDate } },
    });
    if (existing) {
      res.status(409).json({ error: 'You already have a comp-off request for this date' });
      return;
    }

    // Compute expiry from policy
    const expiryDays = await getNumericRule(null, 'compoff_expiry_days', 90);
    const expiresAt = new Date(earnedDate);
    expiresAt.setDate(expiresAt.getDate() + expiryDays);

    const compoff = await prisma.compOff.create({
      data: {
        userId: req.user!.id,
        earnedDate,
        reason,
        expiresAt,
      },
    });

    // Notify admins/managers
    const approvers = await prisma.user.findMany({
      where: { role: { in: ['ADMIN', 'OWNER', 'MANAGER'] }, isActive: true },
      select: { id: true },
    });
    for (const a of approvers) {
      await createNotification({
        userId:  a.id,
        type:    'COMPOFF_REQUESTED',
        title:   'New Comp-Off Request',
        message: `A comp-off request has been submitted for ${earnedDate.toDateString()}.`,
        link:    '/compoff',
      });
    }

    res.status(201).json(compoff);
  } catch (err) {
    console.error('Create comp-off error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/compoff/:id/approve
router.patch('/:id/approve', authorize(['ADMIN', 'MANAGER', 'OWNER']), async (req: AuthRequest, res: Response) => {
  try {
    const compoff = await prisma.compOff.findUnique({ where: { id: req.params.id } });
    if (!compoff) {
      res.status(404).json({ error: 'Comp-off not found' });
      return;
    }
    if (compoff.status !== 'PENDING') {
      res.status(400).json({ error: `Cannot approve a comp-off that is ${compoff.status}` });
      return;
    }
    if (compoff.userId === req.user!.id) {
      res.status(403).json({ error: 'You cannot approve your own comp-off request' });
      return;
    }

    const updated = await prisma.compOff.update({
      where: { id: req.params.id },
      data: {
        status:     'APPROVED',
        approvedBy: req.user!.id,
      },
    });

    await createNotification({
      userId:  compoff.userId,
      type:    'COMPOFF_APPROVED',
      title:   'Comp-Off Approved',
      message: `Your comp-off for ${compoff.earnedDate.toDateString()} has been approved. Expires: ${compoff.expiresAt.toDateString()}.`,
      link:    '/compoff',
    });

    res.json(updated);
  } catch (err) {
    console.error('Approve comp-off error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/compoff/:id/reject
router.patch('/:id/reject', authorize(['ADMIN', 'MANAGER', 'OWNER']), async (req: AuthRequest, res: Response) => {
  try {
    const compoff = await prisma.compOff.findUnique({ where: { id: req.params.id } });
    if (!compoff) {
      res.status(404).json({ error: 'Comp-off not found' });
      return;
    }
    if (compoff.status !== 'PENDING') {
      res.status(400).json({ error: `Cannot reject a comp-off that is ${compoff.status}` });
      return;
    }
    if (compoff.userId === req.user!.id) {
      res.status(403).json({ error: 'You cannot reject your own comp-off request' });
      return;
    }

    const { reason } = req.body;
    const updated = await prisma.compOff.update({
      where: { id: req.params.id },
      data: { status: 'REJECTED' },
    });

    await createNotification({
      userId:  compoff.userId,
      type:    'COMPOFF_REJECTED',
      title:   'Comp-Off Rejected',
      message: `Your comp-off for ${compoff.earnedDate.toDateString()} has been rejected.${reason ? ` Reason: ${reason}` : ''}`,
      link:    '/compoff',
    });

    res.json(updated);
  } catch (err) {
    console.error('Reject comp-off error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
