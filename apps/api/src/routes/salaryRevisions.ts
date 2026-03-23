/**
 * Athena V3.1 - Salary Revision Routes
 *
 * GET   /api/salary-revisions/:userId        - list revision history (Admin or own employee)
 * POST  /api/salary-revisions/:userId        - propose a revision (Admin only) — creates as PENDING
 * PATCH /api/salary-revisions/:id/approve    - approve revision (Admin/Owner, no self-approval)
 * PATCH /api/salary-revisions/:id/reject     - reject revision (Admin/Owner, no self-approval)
 */

import { Router, Response }    from 'express';
import { prisma } from '../lib/prisma';
import { z }                   from 'zod';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';
import { createNotification }  from '../lib/notify';
import { createAuditLog }      from '../lib/audit';

const router = Router();

router.use(authenticate);

// GET /api/salary-revisions/:userId
router.get('/:userId', async (req: AuthRequest, res: Response) => {
  const { userId } = req.params;
  const me = req.user!;

  // Employees can only see their own; Admin can see anyone
  if (me.role === 'EMPLOYEE' && me.id !== userId) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  if (me.role === 'MANAGER' && me.id !== userId) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  try {
    const revisions = await prisma.salaryRevision.findMany({
      where: { userId },
      include: {
        revisor: {
          select: { profile: { select: { firstName: true, lastName: true } } },
        },
      },
      orderBy: { effectiveDate: 'desc' },
    });
    res.json(revisions);
  } catch (err) {
    console.error('Get salary revisions error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/salary-revisions/:userId — Admin proposes a revision (creates as PENDING)
router.post('/:userId', authorize(['ADMIN']), async (req: AuthRequest, res: Response) => {
  const { userId } = req.params;
  const parsed = z.object({
    effectiveDate: z.string().min(1),
    oldCtc:        z.number().min(0),
    newCtc:        z.number().min(0),
    reason:        z.string().optional(),
  }).safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }

  try {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) { res.status(404).json({ error: 'Employee not found' }); return; }

    const revision = await prisma.salaryRevision.create({
      data: {
        userId,
        effectiveDate: new Date(parsed.data.effectiveDate),
        oldCtc:        parsed.data.oldCtc,
        newCtc:        parsed.data.newCtc,
        reason:        parsed.data.reason,
        revisedBy:     req.user!.id,
        proposedBy:    req.user!.id,
        status:        'PENDING',
      },
    });

    // Notify all owners to approve
    const owners = await prisma.user.findMany({
      where: { role: 'OWNER', isActive: true },
      select: { id: true },
    });
    for (const owner of owners) {
      await createNotification({
        userId:  owner.id,
        type:    'SALARY_REVISION_PENDING',
        title:   'Salary Revision Approval Required',
        message: `A salary revision has been proposed for an employee. Please review and approve or reject.`,
        link:    '/organization',
      });
    }

    res.status(201).json(revision);
  } catch (err) {
    console.error('Create salary revision error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/salary-revisions/:id/approve — Admin/Owner approves (no self-approval)
router.patch('/:id/approve', authorize(['ADMIN', 'OWNER']), async (req: AuthRequest, res: Response) => {
  try {
    const revision = await prisma.salaryRevision.findUnique({ where: { id: req.params.id } });
    if (!revision) { res.status(404).json({ error: 'Revision not found' }); return; }
    if (revision.status !== 'PENDING') {
      res.status(400).json({ error: `Cannot approve a revision that is ${revision.status}` });
      return;
    }
    if (revision.proposedBy === req.user!.id) {
      res.status(403).json({ error: 'You cannot approve a revision you proposed' });
      return;
    }

    const updated = await prisma.salaryRevision.update({
      where: { id: req.params.id },
      data:  { status: 'APPROVED', approvedBy: req.user!.id },
    });

    // Apply the new CTC to the employee's profile
    await prisma.profile.update({
      where: { userId: revision.userId },
      data:  { annualCtc: revision.newCtc },
    });

    await createNotification({
      userId:  revision.userId,
      type:    'SALARY_REVISION_APPROVED',
      title:   'Salary Revision Approved',
      message: `Your salary revision has been approved. New CTC: ₹${revision.newCtc.toLocaleString('en-IN')} effective ${new Date(revision.effectiveDate).toDateString()}.`,
      link:    '/profile',
    });

    await createAuditLog({
      actorId:  req.user!.id,
      action:   'SALARY_REVISION_APPROVED',
      entity:   'SalaryRevision',
      entityId: revision.id,
      oldValues: { status: 'PENDING', annualCtc: revision.oldCtc },
      newValues: { status: 'APPROVED', annualCtc: revision.newCtc },
      changeSource: 'WEB',
    });

    res.json(updated);
  } catch (err) {
    console.error('Approve salary revision error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/salary-revisions/:id/reject — Admin/Owner rejects (no self-rejection)
router.patch('/:id/reject', authorize(['ADMIN', 'OWNER']), async (req: AuthRequest, res: Response) => {
  try {
    const revision = await prisma.salaryRevision.findUnique({ where: { id: req.params.id } });
    if (!revision) { res.status(404).json({ error: 'Revision not found' }); return; }
    if (revision.status !== 'PENDING') {
      res.status(400).json({ error: `Cannot reject a revision that is ${revision.status}` });
      return;
    }
    if (revision.proposedBy === req.user!.id) {
      res.status(403).json({ error: 'You cannot reject a revision you proposed' });
      return;
    }

    const { reason } = req.body;
    const updated = await prisma.salaryRevision.update({
      where: { id: req.params.id },
      data:  { status: 'REJECTED', approvedBy: req.user!.id },
    });

    await createNotification({
      userId:  revision.proposedBy,
      type:    'SALARY_REVISION_REJECTED',
      title:   'Salary Revision Rejected',
      message: `The salary revision you proposed has been rejected.${reason ? ` Reason: ${reason}` : ''}`,
      link:    '/organization',
    });

    res.json(updated);
  } catch (err) {
    console.error('Reject salary revision error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
