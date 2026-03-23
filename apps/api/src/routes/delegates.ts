/**
 * Athena V3.1 Sprint 5 — Delegate Approver Management
 * Managers can delegate approval authority to another manager during absence.
 */

import { Router, Response } from 'express';
import { AuthRequest, authenticate, authorize } from '../middleware/auth';
import { prisma } from '../lib/prisma';
import { createNotification } from '../lib/notify';

const router = Router();
router.use(authenticate);

// POST / — Create a delegation
router.post('/', authorize(['ADMIN', 'MANAGER']), async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!;
    const { delegatorId, delegateId, fromDate, toDate } = req.body;

    // If MANAGER, can only delegate own authority. ADMIN can delegate for anyone.
    const actualDelegatorId = user.role === 'MANAGER' ? user.id : (delegatorId || user.id);

    if (!delegateId || !fromDate || !toDate) {
      res.status(400).json({ error: 'delegateId, fromDate, and toDate are required' });
      return;
    }
    if (actualDelegatorId === delegateId) {
      res.status(400).json({ error: 'Cannot delegate to yourself' });
      return;
    }
    if (new Date(fromDate) > new Date(toDate)) {
      res.status(400).json({ error: 'fromDate must be before toDate' });
      return;
    }

    // Check delegate exists and is ADMIN or MANAGER
    const delegate = await prisma.user.findUnique({
      where: { id: delegateId },
      select: { id: true, role: true, isActive: true, profile: { select: { firstName: true, lastName: true } } },
    });
    if (!delegate || !delegate.isActive) {
      res.status(404).json({ error: 'Delegate user not found or inactive' });
      return;
    }
    if (delegate.role !== 'ADMIN' && delegate.role !== 'MANAGER' && delegate.role !== 'OWNER') {
      res.status(400).json({ error: 'Delegate must be an Admin, Manager, or Owner' });
      return;
    }

    // Check no overlapping active delegation for the same delegator
    const overlap = await prisma.delegateApprover.findFirst({
      where: {
        delegatorId: actualDelegatorId,
        isActive: true,
        OR: [
          { fromDate: { lte: new Date(toDate) }, toDate: { gte: new Date(fromDate) } },
        ],
      },
    });
    if (overlap) {
      res.status(409).json({ error: 'An active delegation already exists for this date range' });
      return;
    }

    const delegation = await prisma.delegateApprover.create({
      data: {
        delegatorId: actualDelegatorId,
        delegateId,
        fromDate: new Date(fromDate),
        toDate: new Date(toDate),
      },
      include: {
        delegator: { select: { profile: { select: { firstName: true, lastName: true } } } },
        delegate: { select: { profile: { select: { firstName: true, lastName: true } } } },
      },
    });

    // Notify the delegate
    const delegatorName = delegation.delegator?.profile
      ? `${delegation.delegator.profile.firstName} ${delegation.delegator.profile.lastName}`
      : 'A manager';
    await createNotification({
      userId: delegateId,
      type: 'DELEGATION_ASSIGNED',
      title: 'Approval Delegation',
      message: `${delegatorName} has delegated their approval authority to you from ${new Date(fromDate).toLocaleDateString('en-IN')} to ${new Date(toDate).toLocaleDateString('en-IN')}.`,
      link: '/settings',
    });

    res.status(201).json(delegation);
  } catch (err) {
    console.error('Create delegation error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /active — List active delegations
router.get('/active', async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!;
    const isAdmin = user.role === 'ADMIN' || user.role === 'OWNER';

    const where = isAdmin
      ? { isActive: true }
      : { isActive: true, OR: [{ delegatorId: user.id }, { delegateId: user.id }] };

    const delegations = await prisma.delegateApprover.findMany({
      where,
      include: {
        delegator: {
          select: {
            email: true,
            profile: { select: { firstName: true, lastName: true, employeeId: true } },
          },
        },
        delegate: {
          select: {
            email: true,
            profile: { select: { firstName: true, lastName: true, employeeId: true } },
          },
        },
      },
      orderBy: { fromDate: 'desc' },
    });

    res.json(delegations);
  } catch (err) {
    console.error('List delegations error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /:id — Deactivate delegation
router.delete('/:id', authorize(['ADMIN', 'MANAGER']), async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!;
    const delegation = await prisma.delegateApprover.findUnique({ where: { id: req.params.id } });
    if (!delegation) { res.status(404).json({ error: 'Delegation not found' }); return; }

    // Only the delegator or an ADMIN can remove
    const isAdmin = user.role === 'ADMIN' || user.role === 'OWNER';
    if (!isAdmin && delegation.delegatorId !== user.id) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    await prisma.delegateApprover.update({
      where: { id: req.params.id },
      data: { isActive: false },
    });

    res.json({ message: 'Delegation deactivated' });
  } catch (err) {
    console.error('Delete delegation error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
