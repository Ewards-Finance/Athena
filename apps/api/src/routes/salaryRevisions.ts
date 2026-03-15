/**
 * Athena V2 - Salary Revision Routes
 *
 * GET  /api/salary-revisions/:userId  - list revision history (Admin or own employee)
 * POST /api/salary-revisions/:userId  - manually add a revision note (Admin only)
 */

import { Router, Response }    from 'express';
import { PrismaClient }        from '@prisma/client';
import { z }                   from 'zod';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';

const router = Router();
const prisma = new PrismaClient();

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

// POST /api/salary-revisions/:userId — Admin manually records a revision
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
      },
    });
    res.status(201).json(revision);
  } catch (err) {
    console.error('Create salary revision error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
