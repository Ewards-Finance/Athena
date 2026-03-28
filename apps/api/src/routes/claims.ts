/**
 * Athena V2 - Reimbursement & Claims Routes
 * Status flow: PENDING -> APPROVED -> PAID
 *
 * GET    /api/claims             - list claims (own or all)
 * POST   /api/claims             - employee submits a claim
 * PATCH  /api/claims/:id/approve - admin/manager approves
 * PATCH  /api/claims/:id/pay     - admin marks as paid (Finance action)
 * PATCH  /api/claims/:id/reject  - admin/manager rejects
 */

import { Router, Response }          from 'express';
import { prisma } from '../lib/prisma';
import { z }                         from 'zod';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';
import { createNotifications, createNotification } from '../lib/notify';
import { isDelegateForEmployee } from '../lib/delegation';
import { createAuditLog } from '../lib/audit';

const router = Router();

router.use(authenticate);

// Zod schema: validates claim submission
const claimSchema = z.object({
  category:    z.enum(['TRAVEL', 'FOOD', 'INTERNET', 'MISCELLANEOUS']),
  amount:      z.number().positive('Amount must be a positive number'),
  description: z.string().min(5, 'Description must be at least 5 characters'),
  billUrl:     z.string().optional(),
});

// GET /api/claims - Employees see their own; Admin/Manager see all
router.get('/', async (req: AuthRequest, res: Response) => {
  const user = req.user!;
  try {
    const where = user.role === 'EMPLOYEE' ? { employeeId: user.id } : {};
    const claims = await prisma.reimbursement.findMany({
      where,
      include: {
        employee: {
          select: {
            profile: { select: { firstName: true, lastName: true, employeeId: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(claims);
  } catch (err) {
    console.error('List claims error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/claims - Employee submits a reimbursement claim
router.post('/', async (req: AuthRequest, res: Response) => {
  const parsed = claimSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }

  try {
    const claim = await prisma.reimbursement.create({
      data: {
        employeeId:  req.user!.id,
        category:    parsed.data.category as any,
        amount:      parsed.data.amount,
        description: parsed.data.description,
        billUrl:     parsed.data.billUrl,
        status:      'PENDING',
      },
    });

    // Notify the reporting manager and all Admins about the new claim
    const empProfile = await prisma.profile.findUnique({
      where:  { userId: req.user!.id },
      select: { firstName: true, lastName: true, managerId: true },
    });
    const empName = empProfile ? `${empProfile.firstName} ${empProfile.lastName}` : 'An employee';

    // Notify reporting manager (if assigned)
    if (empProfile?.managerId) {
      await createNotification({
        userId:  empProfile.managerId,
        type:    'CLAIM_SUBMITTED',
        title:   'New Reimbursement Claim',
        message: `${empName} submitted a ${parsed.data.category} claim for ₹${parsed.data.amount}.`,
        link:    '/claims',
      });
    }

    // Notify all Admins (exclude the employee and the manager already notified above)
    const admins = await prisma.user.findMany({
      where:  { role: { in: ['ADMIN', 'OWNER'] }, isActive: true, id: { not: req.user!.id } },
      select: { id: true },
    });
    const adminIds = admins
      .map((a) => a.id)
      .filter((id) => id !== empProfile?.managerId);
    if (adminIds.length > 0) {
      await createNotifications(
        adminIds.map((id) => ({
          userId:  id,
          type:    'CLAIM_SUBMITTED',
          title:   'New Reimbursement Claim',
          message: `${empName} submitted a ${parsed.data.category} claim for ₹${parsed.data.amount}.`,
          link:    '/claims',
        }))
      );
    }

    res.status(201).json(claim);
  } catch (err) {
    console.error('Create claim error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/claims/:id/approve - Admin/Manager approves a claim
router.patch('/:id/approve', authorize(['ADMIN', 'MANAGER']), async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  try {
    const claim = await prisma.reimbursement.findUnique({ where: { id } });
    if (!claim) { res.status(404).json({ error: 'Claim not found' }); return; }
    if (claim.status !== 'PENDING') {
      res.status(400).json({ error: `Claim is already ${claim.status}` });
      return;
    }

    // Cannot approve your own claim
    if (claim.employeeId === req.user!.id) {
      res.status(403).json({ error: 'You cannot approve your own claim' });
      return;
    }

    // Admin's claims can only be approved by another Admin
    const submitter = await prisma.user.findUnique({ where: { id: claim.employeeId }, select: { role: true } });
    if (submitter?.role === 'ADMIN' && req.user!.role !== 'ADMIN') {
      res.status(403).json({ error: "Only an Admin can approve another Admin's claim" });
      return;
    }

    // Check if this approval is via delegation (for audit trail)
    let approvedViaDelegate = false;
    if (req.user!.role === 'MANAGER') {
      approvedViaDelegate = await isDelegateForEmployee(req.user!.id, claim.employeeId);
    }

    const updated = await prisma.reimbursement.update({
      where: { id },
      data:  { status: 'APPROVED' },
    });

    await createAuditLog({
      actorId: req.user!.id,
      action: 'CLAIM_APPROVED',
      entity: 'Reimbursement',
      entityId: id,
      oldValues: { status: 'PENDING' },
      newValues: { status: 'APPROVED' },
      changeSource: 'WEB',
    });

    await createNotification({
      userId:  claim.employeeId,
      type:    'CLAIM_APPROVED',
      title:   'Claim Approved',
      message: `Your ${claim.category} claim for ₹${claim.amount} has been approved.${approvedViaDelegate ? ' (via delegate approver)' : ''}`,
      link:    '/claims',
    });

    res.json(updated);
  } catch (err) {
    console.error('Approve claim error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/claims/:id/pay - Admin marks an APPROVED claim as PAID (Finance action)
router.patch('/:id/pay', authorize(['ADMIN']), async (req: AuthRequest, res: Response) => {
  const { id }   = req.params;
  const { note } = req.body;
  try {
    const claim = await prisma.reimbursement.findUnique({ where: { id } });
    if (!claim) { res.status(404).json({ error: 'Claim not found' }); return; }
    if (claim.status !== 'APPROVED') {
      res.status(400).json({ error: 'Only APPROVED claims can be marked as PAID' });
      return;
    }
    const updated = await prisma.reimbursement.update({
      where: { id },
      data:  { status: 'PAID', paidAt: new Date(), paidNote: note },
    });

    await createAuditLog({
      actorId: req.user!.id,
      action: 'CLAIM_PAID',
      entity: 'Reimbursement',
      entityId: id,
      oldValues: { status: 'APPROVED' },
      newValues: { status: 'PAID', paidNote: note || null },
      changeSource: 'WEB',
    });

    await createNotification({
      userId:  claim.employeeId,
      type:    'CLAIM_PAID',
      title:   'Claim Payment Processed',
      message: `Your ${claim.category} claim for ₹${claim.amount} has been marked as paid.${note ? ` Note: ${note}` : ''}`,
      link:    '/claims',
    });

    res.json(updated);
  } catch (err) {
    console.error('Pay claim error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/claims/:id/reject - Admin/Manager rejects a claim
router.patch('/:id/reject', authorize(['ADMIN', 'MANAGER']), async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  try {
    const claim = await prisma.reimbursement.findUnique({ where: { id } });
    if (!claim) { res.status(404).json({ error: 'Claim not found' }); return; }
    if (claim.status !== 'PENDING') {
      res.status(400).json({ error: `Claim is already ${claim.status}` });
      return;
    }

    // Cannot reject your own claim
    if (claim.employeeId === req.user!.id) {
      res.status(403).json({ error: 'You cannot reject your own claim' });
      return;
    }

    // Admin's claims can only be rejected by another Admin
    const submitter = await prisma.user.findUnique({ where: { id: claim.employeeId }, select: { role: true } });
    if (submitter?.role === 'ADMIN' && req.user!.role !== 'ADMIN') {
      res.status(403).json({ error: "Only an Admin can reject another Admin's claim" });
      return;
    }

    const updated = await prisma.reimbursement.update({
      where: { id },
      data:  { status: 'REJECTED' },
    });

    await createAuditLog({
      actorId: req.user!.id,
      action: 'CLAIM_REJECTED',
      entity: 'Reimbursement',
      entityId: id,
      oldValues: { status: 'PENDING' },
      newValues: { status: 'REJECTED' },
      changeSource: 'WEB',
    });

    await createNotification({
      userId:  claim.employeeId,
      type:    'CLAIM_REJECTED',
      title:   'Claim Rejected',
      message: `Your ${claim.category} claim for ₹${claim.amount} has been rejected.`,
      link:    '/claims',
    });

    res.json(updated);
  } catch (err) {
    console.error('Reject claim error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/claims/:id - Employee withdraws their own PENDING claim
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const user = req.user!;
  try {
    const claim = await prisma.reimbursement.findUnique({ where: { id } });
    if (!claim) {
      res.status(404).json({ error: 'Claim not found' });
      return;
    }
    if (claim.employeeId !== user.id && user.role !== 'ADMIN') {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    if (claim.status !== 'PENDING') {
      res.status(400).json({ error: 'Only PENDING claims can be withdrawn' });
      return;
    }
    await prisma.reimbursement.delete({ where: { id } });
    res.json({ message: 'Claim withdrawn successfully' });
  } catch (err) {
    console.error('Delete claim error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
