/**
 * Athena V2 - Leave Balance Routes
 *
 * GET  /api/leave-balance              - get own balances for current year (all roles)
 * GET  /api/leave-balance/:userId      - get any user's balances (Admin/Manager)
 * PUT  /api/leave-balance/:userId      - admin sets leave quotas for a user/year
 */

import { Router, Response }         from 'express';
import { PrismaClient }             from '@prisma/client';
import { z }                        from 'zod';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';

const router = Router();
const prisma = new PrismaClient();

router.use(authenticate);

// Zod schema: admin sends { year, [leaveType]: number, ... }
const setBalanceSchema = z.object({
  year: z.number().int().min(2020).max(2100),
}).catchall(z.number().int().min(0));

// GET /api/leave-balance/overview?year=2026 — all employees' balances (Admin/Manager)
router.get('/overview', authorize(['ADMIN', 'MANAGER']), async (req: AuthRequest, res: Response) => {
  const year = Number(req.query.year) || new Date().getFullYear();
  try {
    // Two separate plain queries — avoids any relation-include issues with Prisma client
    // Managers only see their direct reports; Admins see everyone
    const userWhere: any =
      req.user!.role === 'MANAGER'
        ? { isActive: true, profile: { managerId: req.user!.id } }
        : { isActive: true };

    const users = await prisma.user.findMany({
      where: userWhere,
      select: {
        id: true,
        profile: { select: { firstName: true, lastName: true, employeeId: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    const allBalances = await prisma.leaveBalance.findMany({
      where: { year },
    });

    // For any user with no balance rows yet, create defaults
    const userIdsWithBalances = new Set(allBalances.map((b) => b.userId));
    const usersNeedingDefaults = users.filter((u) => !userIdsWithBalances.has(u.id));

    if (usersNeedingDefaults.length > 0) {
      await Promise.all(usersNeedingDefaults.map((u) => getOrCreateBalances(u.id, year)));
      // Re-fetch after creating defaults
      const refreshed = await prisma.leaveBalance.findMany({ where: { year } });
      const result = users.map((u) => ({
        ...u,
        leaveBalances: refreshed.filter((b) => b.userId === u.id),
      }));
      res.json(result);
      return;
    }

    const result = users.map((u) => ({
      ...u,
      leaveBalances: allBalances.filter((b) => b.userId === u.id),
    }));
    res.json(result);
  } catch (err) {
    console.error('Overview error:', err);
    res.status(500).json({ error: String(err) });
  }
});

// GET /api/leave-balance — own balances for current year
router.get('/', async (req: AuthRequest, res: Response) => {
  const year = new Date().getFullYear();
  try {
    const balances = await getOrCreateBalances(req.user!.id, year);
    res.json(balances);
  } catch (err) {
    console.error('Get own balance error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/leave-balance/:userId — Admin/Manager views any user's balance
router.get('/:userId', authorize(['ADMIN', 'MANAGER']), async (req: AuthRequest, res: Response) => {
  const { userId } = req.params;
  const year = Number(req.query.year) || new Date().getFullYear();
  try {
    const balances = await getOrCreateBalances(userId, year);
    res.json(balances);
  } catch (err) {
    console.error('Get user balance error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/leave-balance/:userId — Admin sets/updates leave quotas
router.put('/:userId', authorize(['ADMIN']), async (req: AuthRequest, res: Response) => {
  const { userId } = req.params;

  const parsed = setBalanceSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }

  const { year, ...totals } = parsed.data;

  try {
    // Upsert each leave type provided
    const ops = Object.entries(totals).map(([lt, total]) =>
      prisma.leaveBalance.upsert({
        where: { userId_year_leaveType: { userId, year, leaveType: lt as any } },
        update: { total: total as number },
        create: { userId, year, leaveType: lt as any, total: total as number, used: 0 },
      })
    );

    const results = await prisma.$transaction(ops);
    res.json(results);
  } catch (err) {
    console.error('Set balance error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// --- Helper: fetch existing balances, auto-create defaults if missing ---
async function getOrCreateBalances(userId: string, year: number) {
  const existing = await prisma.leaveBalance.findMany({
    where: { userId, year },
  });

  // Pull active leave policies for defaults
  const policies = await prisma.leavePolicy.findMany({ where: { isActive: true } });

  // If no policies exist, return whatever balances already exist without creating new ones
  if (policies.length === 0) {
    return existing;
  }

  const activeTypes = policies.map((p) => p.leaveType);
  const defaultTotals = Object.fromEntries(policies.map((p) => [p.leaveType, p.defaultTotal]));

  const existingTypes = existing.map((b) => b.leaveType);
  const missing = activeTypes.filter((lt) => !existingTypes.includes(lt));

  if (missing.length > 0) {
    await prisma.leaveBalance.createMany({
      data: missing.map((lt) => ({
        userId,
        year,
        leaveType: lt,
        total: defaultTotals[lt] ?? 0,
        used: 0,
      })),
    });
    return prisma.leaveBalance.findMany({ where: { userId, year } });
  }

  return existing;
}

export default router;
export { getOrCreateBalances };
