/**
 * Athena V2 - Leave Policy Routes
 *
 * GET    /api/leave-policy          - fetch all leave type policies (all authenticated)
 * POST   /api/leave-policy          - ADMIN only, create new leave type
 * PUT    /api/leave-policy          - ADMIN only, bulk-update existing policies
 * DELETE /api/leave-policy/:id      - ADMIN only, delete a leave type
 * POST   /api/leave-policy/apply-all - ADMIN only, push defaults to all employees
 */

import { Router, Response }   from 'express';
import { prisma } from '../lib/prisma';
import { z }                  from 'zod';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';
import { currentFYYear } from '../lib/fyUtils';

const router = Router();

router.use(authenticate);

const DEFAULT_POLICIES = [
  { leaveType: 'SL',        label: 'Sick Leave',       defaultTotal: 12,  isActive: true },
  { leaveType: 'CL',        label: 'Casual Leave',     defaultTotal: 12,  isActive: true },
  { leaveType: 'EL',        label: 'Earned Leave',     defaultTotal: 15,  isActive: true },
  { leaveType: 'MATERNITY', label: 'Maternity Leave',  defaultTotal: 180, isActive: true },
  { leaveType: 'PATERNITY', label: 'Paternity Leave',  defaultTotal: 5,   isActive: true },
];

const createPolicySchema = z.object({
  leaveType:    z.string().regex(/^[A-Z0-9_]+$/).min(2).max(20),
  label:        z.string().min(1),
  defaultTotal: z.number().int().min(0),
});

const bulkUpdateSchema = z.array(
  z.object({
    id:           z.string(),
    label:        z.string().min(1),
    defaultTotal: z.number().int().min(0),
    isActive:     z.boolean(),
  })
);

// GET /api/leave-policy — returns all leave type policies, auto-seeding if missing
router.get('/', async (_req: AuthRequest, res: Response) => {
  try {
    let policies = await prisma.leavePolicy.findMany({ orderBy: { createdAt: 'asc' } });

    if (policies.length === 0) {
      await prisma.leavePolicy.createMany({
        data: DEFAULT_POLICIES as any,
        skipDuplicates: true,
      });
      policies = await prisma.leavePolicy.findMany({ orderBy: { createdAt: 'asc' } });
    }

    res.json(policies);
  } catch (err) {
    console.error('Get leave policy error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/leave-policy — ADMIN creates a new leave type
router.post('/', authorize(['ADMIN']), async (req: AuthRequest, res: Response) => {
  const parsed = createPolicySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }

  const { leaveType, label, defaultTotal } = parsed.data;

  try {
    // Check uniqueness
    const existing = await prisma.leavePolicy.findUnique({ where: { leaveType: leaveType as any } });
    if (existing) {
      res.status(409).json({ error: `Leave type '${leaveType}' already exists` });
      return;
    }

    const policy = await prisma.leavePolicy.create({
      data: { leaveType: leaveType as any, label, defaultTotal, isActive: true },
    });

    // Auto-create LeaveBalance records for all active employees for the current FY year
    const year = currentFYYear();
    const users = await prisma.user.findMany({
      where: { isActive: true },
      select: { id: true },
    });

    await prisma.leaveBalance.createMany({
      data: users.map((u) => ({
        userId:    u.id,
        year,
        leaveType: leaveType as any,
        total:     defaultTotal,
        used:      0,
      })),
      skipDuplicates: true,
    });

    res.status(201).json(policy);
  } catch (err) {
    console.error('Create leave policy error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/leave-policy — ADMIN bulk-updates existing policies
router.put('/', authorize(['ADMIN']), async (req: AuthRequest, res: Response) => {
  const parsed = bulkUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }

  try {
    const ops = parsed.data.map((p) =>
      prisma.leavePolicy.update({
        where:  { id: p.id },
        data:   { label: p.label, defaultTotal: p.defaultTotal, isActive: p.isActive },
      })
    );
    const results = await prisma.$transaction(ops);
    res.json(results);
  } catch (err) {
    console.error('Update leave policy error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/leave-policy/:id — ADMIN deletes a leave type
// Existing LeaveBalance / LeaveRequest data is intentionally preserved.
router.delete('/:id', authorize(['ADMIN']), async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  try {
    await prisma.leavePolicy.delete({ where: { id } });
    res.json({ message: 'Leave type removed' });
  } catch (err) {
    console.error('Delete leave policy error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/leave-policy/apply-all?year=2026
// Admin applies current active policy defaults to ALL employees for the given year.
// Sets total = policy.defaultTotal for each active leave type.
// Does NOT reduce total below already-used days to avoid negative balances.
router.post('/apply-all', authorize(['ADMIN']), async (req: AuthRequest, res: Response) => {
  const year = Number(req.query.year) || currentFYYear();

  try {
    const policies = await prisma.leavePolicy.findMany({ where: { isActive: true } });
    if (policies.length === 0) {
      res.json({ updated: 0, message: 'No active leave policies found.' });
      return;
    }

    const users = await prisma.user.findMany({
      where: { isActive: true },
      select: { id: true },
    });

    let updated = 0;
    for (const user of users) {
      for (const policy of policies) {
        // Fetch current balance to avoid setting total below used
        const existing = await prisma.leaveBalance.findUnique({
          where: { userId_year_leaveType: { userId: user.id, year, leaveType: policy.leaveType } },
        });
        const safeTotal = existing
          ? Math.max(policy.defaultTotal, existing.used)
          : policy.defaultTotal;

        await prisma.leaveBalance.upsert({
          where: { userId_year_leaveType: { userId: user.id, year, leaveType: policy.leaveType } },
          update: { total: safeTotal },
          create: { userId: user.id, year, leaveType: policy.leaveType, total: safeTotal, used: 0 },
        });
        updated++;
      }
    }

    res.json({ updated, employees: users.length, year });
  } catch (err) {
    console.error('Apply-all error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
