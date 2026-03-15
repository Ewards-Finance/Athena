/**
 * Athena V2 - Audit Log Routes (Admin only)
 *
 * GET /api/audit-logs            - paginated audit log with optional filters
 * GET /api/audit-logs/entities   - distinct entity types for filter UI
 */

import { Router, Response } from 'express';
import { PrismaClient }     from '@prisma/client';
import { z }                from 'zod';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';

const router = Router();
const prisma = new PrismaClient();

router.use(authenticate);

// GET /api/audit-logs?page=1&limit=50&entity=LeaveRequest&actorId=xxx&action=LEAVE_APPROVED
router.get('/', authorize(['ADMIN']), async (req: AuthRequest, res: Response) => {
  const parsed = z.object({
    page:    z.coerce.number().int().min(1).default(1),
    limit:   z.coerce.number().int().min(1).max(200).default(50),
    entity:  z.string().optional(),
    action:  z.string().optional(),
    actorId: z.string().optional(),
  }).safeParse(req.query);

  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid query params' });
    return;
  }

  const { page, limit, entity, action, actorId } = parsed.data;
  const skip = (page - 1) * limit;

  const where: any = {};
  if (entity)  where.entity  = entity;
  if (action)  where.action  = { contains: action, mode: 'insensitive' };
  if (actorId) where.actorId = actorId;

  try {
    const [logs, total] = await prisma.$transaction([
      prisma.auditLog.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          actor: {
            select: {
              profile: { select: { firstName: true, lastName: true, employeeId: true } },
            },
          },
        },
      }),
      prisma.auditLog.count({ where }),
    ]);

    res.json({ logs, total, page, limit, pages: Math.ceil(total / limit) });
  } catch (err) {
    console.error('Audit logs error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/audit-logs/entities — list of distinct entity + action combos for filter UI
router.get('/entities', authorize(['ADMIN']), async (_req, res: Response) => {
  try {
    const entities = await prisma.auditLog.findMany({
      select:  { entity: true, action: true },
      distinct: ['entity'],
      orderBy: { entity: 'asc' },
    });
    const actions = await prisma.auditLog.findMany({
      select:  { action: true },
      distinct: ['action'],
      orderBy: { action: 'asc' },
    });
    res.json({ entities: entities.map((e) => e.entity), actions: actions.map((a) => a.action) });
  } catch (err) {
    console.error('Audit entities error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
