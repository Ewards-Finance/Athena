/**
 * Athena V2 - Announcements (Notice Board) Routes
 * GET    /api/announcements       - list active announcements
 * POST   /api/announcements       - admin posts an announcement
 * DELETE /api/announcements/:id   - admin deactivates an announcement
 */

import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { z }                         from 'zod';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';
import { createNotifications } from '../lib/notify';

const router  = Router();

router.use(authenticate);

const announcementSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  body:  z.string().min(5, 'Body must be at least 5 characters'),
});

router.get('/', async (_req: Request, res: Response) => {
  try {
    const items = await prisma.announcement.findMany({
      where:   { isActive: true },
      orderBy: { createdAt: 'desc' },
    });
    res.json(items);
  } catch (err) {
    console.error('List announcements error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/', authorize(['ADMIN']), async (req: AuthRequest, res: Response) => {
  const parsed = announcementSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }
  try {
    const item = await prisma.announcement.create({
      data: {
        title:     parsed.data.title,
        body:      parsed.data.body,
        createdBy: req.user!.id,
      },
    });
    res.status(201).json(item);

    // Notify all active employees (in-app + email via createNotifications)
    prisma.user.findMany({
      where:  { isActive: true, id: { not: req.user!.id } },
      select: { id: true },
    }).then((users) => {
      if (!users.length) return;
      createNotifications(users.map((u) => ({
        userId:  u.id,
        type:    'ANNOUNCEMENT',
        title:   parsed.data.title,
        message: parsed.data.body,
        link:    '/holidays', // announcements are visible on the dashboard
      })));
    }).catch(() => {});

  } catch (err) {
    console.error('Create announcement error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/:id', authorize(['ADMIN']), async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  try {
    await prisma.announcement.update({
      where: { id },
      data:  { isActive: false },
    });
    res.json({ message: 'Announcement deactivated' });
  } catch (err) {
    console.error('Delete announcement error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
