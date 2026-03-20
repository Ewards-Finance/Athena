/**
 * Athena V2 - Worklog Routes
 *
 * POST   /api/worklogs                    - Submit (upsert) a worklog for a date
 * GET    /api/worklogs/mine               - Own worklogs (?month&year)
 * GET    /api/worklogs/team               - Direct reports' worklogs (MANAGER/ADMIN)
 * GET    /api/worklogs/all                - All employees' worklogs (ADMIN, search)
 * PUT    /api/worklogs/:id                - Update own worklog content
 * PUT    /api/worklogs/:id/reject         - Reject a worklog (MANAGER/ADMIN)
 * PUT    /api/worklogs/:id/restore        - Restore rejected → approved (MANAGER/ADMIN)
 * DELETE /api/worklogs/:id                - Delete own worklog
 *
 * Declared WFH (ADMIN only):
 * GET    /api/worklogs/declared-wfh       - List declared WFH days
 * POST   /api/worklogs/declared-wfh       - Declare a WFH day
 * DELETE /api/worklogs/declared-wfh/:id   - Remove a declared WFH day
 */

import { Router, Response }   from 'express';
import { prisma } from '../lib/prisma';
import { z }                   from 'zod';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';

const router = Router();

router.use(authenticate);

// ─── Validation Schemas ────────────────────────────────────────────────────────

const submitSchema = z.object({
  date:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
  content: z.string().min(1, 'Content is required').max(10000),
});

const updateSchema = z.object({
  content: z.string().min(1, 'Content is required').max(10000),
});

const rejectSchema = z.object({
  rejectionNote: z.string().max(500).optional(),
});

const declareWFHSchema = z.object({
  date:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
  reason: z.string().max(300).optional(),
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseDate(str: string): Date {
  return new Date(`${str}T00:00:00.000Z`);
}

const profileSelect = {
  firstName:      true,
  lastName:       true,
  employeeId:     true,
  designation:    true,
  employmentType: true,
} as const;

// ─── POST /api/worklogs ───────────────────────────────────────────────────────

router.post('/', async (req: AuthRequest, res: Response) => {
  const parsed = submitSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
  }

  const { date, content } = parsed.data;
  const userId = req.user!.id;
  const dateObj = parseDate(date);

  try {
    const worklog = await prisma.workLog.upsert({
      where:  { userId_date: { userId, date: dateObj } },
      update: { content, status: 'APPROVED', rejectedBy: null, rejectedAt: null, rejectionNote: null },
      create: { userId, date: dateObj, content, status: 'APPROVED' },
    });
    return res.status(201).json(worklog);
  } catch (err) {
    console.error('POST /worklogs error:', err);
    return res.status(500).json({ error: 'Failed to save worklog' });
  }
});

// ─── GET /api/worklogs/declared-wfh ──────────────────────────────────────────
// Must be defined before /:id routes

router.get('/declared-wfh', authorize(['ADMIN']), async (_req: AuthRequest, res: Response) => {
  try {
    const days = await prisma.declaredWFH.findMany({
      orderBy: { date: 'desc' },
    });
    return res.json(days);
  } catch (err) {
    console.error('GET /declared-wfh error:', err);
    return res.status(500).json({ error: 'Failed to fetch declared WFH days' });
  }
});

// ─── POST /api/worklogs/declared-wfh ─────────────────────────────────────────

router.post('/declared-wfh', authorize(['ADMIN']), async (req: AuthRequest, res: Response) => {
  const parsed = declareWFHSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
  }

  const { date, reason } = parsed.data;
  const dateObj = parseDate(date);

  try {
    const day = await prisma.declaredWFH.create({
      data: { date: dateObj, reason, createdBy: req.user!.id },
    });
    return res.status(201).json(day);
  } catch (err: any) {
    if (err?.code === 'P2002') {
      return res.status(409).json({ error: 'This date is already declared as WFH' });
    }
    console.error('POST /declared-wfh error:', err);
    return res.status(500).json({ error: 'Failed to declare WFH day' });
  }
});

// ─── DELETE /api/worklogs/declared-wfh/:id ───────────────────────────────────

router.delete('/declared-wfh/:id', authorize(['ADMIN']), async (req: AuthRequest, res: Response) => {
  try {
    await prisma.declaredWFH.delete({ where: { id: req.params.id } });
    return res.json({ message: 'Removed' });
  } catch (err: any) {
    if (err?.code === 'P2025') return res.status(404).json({ error: 'Not found' });
    console.error('DELETE /declared-wfh/:id error:', err);
    return res.status(500).json({ error: 'Failed to remove declared WFH day' });
  }
});

// ─── GET /api/worklogs/mine ───────────────────────────────────────────────────

router.get('/mine', async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;
  const month  = req.query.month ? parseInt(req.query.month as string) : null;
  const year   = req.query.year  ? parseInt(req.query.year  as string) : null;

  try {
    let where: any = { userId };
    if (month && year) {
      const start = new Date(Date.UTC(year, month - 1, 1));
      const end   = new Date(Date.UTC(year, month, 1));
      where.date  = { gte: start, lt: end };
    }

    const worklogs = await prisma.workLog.findMany({ where, orderBy: { date: 'desc' } });
    return res.json(worklogs);
  } catch (err) {
    console.error('GET /worklogs/mine error:', err);
    return res.status(500).json({ error: 'Failed to fetch worklogs' });
  }
});

// ─── GET /api/worklogs/team ───────────────────────────────────────────────────

router.get('/team', async (req: AuthRequest, res: Response) => {
  const { role, id: requesterId } = req.user!;
  if (role !== 'MANAGER' && role !== 'ADMIN') {
    return res.status(403).json({ error: 'Access denied' });
  }

  const month  = req.query.month  ? parseInt(req.query.month  as string) : null;
  const year   = req.query.year   ? parseInt(req.query.year   as string) : null;
  const userId = req.query.userId as string | undefined;

  try {
    let teamUserIds: string[];
    if (role === 'ADMIN') {
      const profiles = await prisma.profile.findMany({ select: { userId: true } });
      teamUserIds = profiles.map((p) => p.userId);
    } else {
      const profiles = await prisma.profile.findMany({
        where:  { managerId: requesterId },
        select: { userId: true },
      });
      teamUserIds = profiles.map((p) => p.userId);
    }

    if (teamUserIds.length === 0) return res.json([]);

    let where: any = { userId: userId ? userId : { in: teamUserIds } };
    if (month && year) {
      const start = new Date(Date.UTC(year, month - 1, 1));
      const end   = new Date(Date.UTC(year, month, 1));
      where.date  = { gte: start, lt: end };
    }

    const worklogs = await prisma.workLog.findMany({
      where,
      orderBy: [{ date: 'desc' }, { userId: 'asc' }],
      include: { user: { include: { profile: { select: profileSelect } } } },
    });
    return res.json(worklogs);
  } catch (err) {
    console.error('GET /worklogs/team error:', err);
    return res.status(500).json({ error: 'Failed to fetch team worklogs' });
  }
});

// ─── GET /api/worklogs/all ────────────────────────────────────────────────────
// Admin only — all employees, optional search + month/year filter

router.get('/all', authorize(['ADMIN']), async (req: AuthRequest, res: Response) => {
  const month  = req.query.month  ? parseInt(req.query.month  as string) : null;
  const year   = req.query.year   ? parseInt(req.query.year   as string) : null;
  const search = (req.query.search as string | undefined)?.trim().toLowerCase();

  try {
    let where: any = {};
    if (month && year) {
      const start = new Date(Date.UTC(year, month - 1, 1));
      const end   = new Date(Date.UTC(year, month, 1));
      where.date  = { gte: start, lt: end };
    }

    const worklogs = await prisma.workLog.findMany({
      where,
      orderBy: [{ date: 'desc' }, { userId: 'asc' }],
      include: { user: { include: { profile: { select: profileSelect } } } },
    });

    // Apply name/ID search in-memory (profiles are small)
    const filtered = search
      ? worklogs.filter((w) => {
          const p = w.user?.profile;
          if (!p) return false;
          const fullName = `${p.firstName} ${p.lastName}`.toLowerCase();
          return fullName.includes(search) || p.employeeId.toLowerCase().includes(search);
        })
      : worklogs;

    return res.json(filtered);
  } catch (err) {
    console.error('GET /worklogs/all error:', err);
    return res.status(500).json({ error: 'Failed to fetch worklogs' });
  }
});

// ─── PUT /api/worklogs/:id ────────────────────────────────────────────────────

router.put('/:id', async (req: AuthRequest, res: Response) => {
  const { id }  = req.params;
  const userId  = req.user!.id;
  const parsed  = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
  }

  try {
    const existing = await prisma.workLog.findUnique({ where: { id } });
    if (!existing)                  return res.status(404).json({ error: 'Worklog not found' });
    if (existing.userId !== userId) return res.status(403).json({ error: 'Not your worklog' });

    const updated = await prisma.workLog.update({
      where: { id },
      data:  { content: parsed.data.content, status: 'APPROVED', rejectedBy: null, rejectedAt: null, rejectionNote: null },
    });
    return res.json(updated);
  } catch (err) {
    console.error('PUT /worklogs/:id error:', err);
    return res.status(500).json({ error: 'Failed to update worklog' });
  }
});

// ─── PUT /api/worklogs/:id/reject ─────────────────────────────────────────────

router.put('/:id/reject', async (req: AuthRequest, res: Response) => {
  const { role, id: rejectorId } = req.user!;
  if (role !== 'MANAGER' && role !== 'ADMIN') {
    return res.status(403).json({ error: 'Only managers or admins can reject worklogs' });
  }

  const parsed = rejectSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
  }

  try {
    const existing = await prisma.workLog.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Worklog not found' });

    const updated = await prisma.workLog.update({
      where: { id: req.params.id },
      data:  {
        status:        'REJECTED',
        rejectedBy:    rejectorId,
        rejectedAt:    new Date(),
        rejectionNote: parsed.data.rejectionNote ?? null,
      },
    });
    return res.json(updated);
  } catch (err) {
    console.error('PUT /worklogs/:id/reject error:', err);
    return res.status(500).json({ error: 'Failed to reject worklog' });
  }
});

// ─── PUT /api/worklogs/:id/restore ────────────────────────────────────────────

router.put('/:id/restore', async (req: AuthRequest, res: Response) => {
  const { role } = req.user!;
  if (role !== 'MANAGER' && role !== 'ADMIN') {
    return res.status(403).json({ error: 'Only managers or admins can restore worklogs' });
  }

  try {
    const existing = await prisma.workLog.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Worklog not found' });

    const updated = await prisma.workLog.update({
      where: { id: req.params.id },
      data:  { status: 'APPROVED', rejectedBy: null, rejectedAt: null, rejectionNote: null },
    });
    return res.json(updated);
  } catch (err) {
    console.error('PUT /worklogs/:id/restore error:', err);
    return res.status(500).json({ error: 'Failed to restore worklog' });
  }
});

// ─── DELETE /api/worklogs/:id ─────────────────────────────────────────────────

router.delete('/:id', async (req: AuthRequest, res: Response) => {
  const { id }  = req.params;
  const userId  = req.user!.id;

  try {
    const existing = await prisma.workLog.findUnique({ where: { id } });
    if (!existing)                  return res.status(404).json({ error: 'Worklog not found' });
    if (existing.userId !== userId) return res.status(403).json({ error: 'Not your worklog' });

    await prisma.workLog.delete({ where: { id } });
    return res.json({ message: 'Deleted' });
  } catch (err) {
    console.error('DELETE /worklogs/:id error:', err);
    return res.status(500).json({ error: 'Failed to delete worklog' });
  }
});

export default router;
