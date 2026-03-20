/**
 * Athena V2 - Holiday Calendar Routes
 * GET    /api/holidays       - list all holidays
 * POST   /api/holidays       - admin adds a holiday
 * DELETE /api/holidays/:id   - admin removes a holiday
 */

import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { z }                         from 'zod';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';

const router = Router();

router.use(authenticate);

const holidaySchema = z.object({
  name: z.string().min(1, 'Holiday name is required'),
  date: z.string().refine(d => !isNaN(Date.parse(d)), { message: 'Invalid date' }),
  type: z.string().optional(),
});

router.get('/', async (_req: Request, res: Response) => {
  try {
    const holidays = await prisma.holiday.findMany({
      orderBy: { date: 'asc' },
    });
    res.json(holidays);
  } catch (err) {
    console.error('List holidays error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/', authorize(['ADMIN']), async (req: AuthRequest, res: Response) => {
  const parsed = holidaySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }
  try {
    const holiday = await prisma.holiday.create({
      data: {
        name: parsed.data.name,
        date: new Date(parsed.data.date),
        type: parsed.data.type,
      },
    });
    res.status(201).json(holiday);
  } catch (err) {
    console.error('Create holiday error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/:id', authorize(['ADMIN']), async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  try {
    await prisma.holiday.delete({ where: { id } });
    res.json({ message: 'Holiday deleted' });
  } catch (err) {
    console.error('Delete holiday error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
