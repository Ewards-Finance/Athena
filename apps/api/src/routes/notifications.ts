/**
 * Athena V2 - Notifications Routes
 *
 * GET    /api/notifications              - list current user's notifications (latest 30)
 * GET    /api/notifications/unread-count - just the unread count (for bell badge)
 * PATCH  /api/notifications/:id/read    - mark one notification as read
 * PATCH  /api/notifications/read-all    - mark all of current user's notifications as read
 */

import { Router, Response }   from 'express';
import { PrismaClient }       from '@prisma/client';
import { authenticate, AuthRequest } from '../middleware/auth';

const router = Router();
const prisma = new PrismaClient();

router.use(authenticate);

// GET /api/notifications/unread-count — lightweight poll endpoint for the bell badge
router.get('/unread-count', async (req: AuthRequest, res: Response) => {
  try {
    const count = await prisma.notification.count({
      where: { userId: req.user!.id, isRead: false },
    });
    res.json({ count });
  } catch (err) {
    console.error('Unread count error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/notifications — latest 30 notifications for the current user
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const notifications = await prisma.notification.findMany({
      where:   { userId: req.user!.id },
      orderBy: { createdAt: 'desc' },
      take:    30,
    });
    res.json(notifications);
  } catch (err) {
    console.error('List notifications error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/notifications/read-all — mark every unread notification as read
// NOTE: this route MUST be defined before /:id/read to avoid "read-all" matching ":id"
router.patch('/read-all', async (req: AuthRequest, res: Response) => {
  try {
    await prisma.notification.updateMany({
      where: { userId: req.user!.id, isRead: false },
      data:  { isRead: true },
    });
    res.json({ message: 'All notifications marked as read' });
  } catch (err) {
    console.error('Mark all read error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/notifications/:id/read — mark one notification as read
router.patch('/:id/read', async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  try {
    // Ensure the notification belongs to the requesting user
    const notif = await prisma.notification.findUnique({ where: { id } });
    if (!notif || notif.userId !== req.user!.id) {
      res.status(404).json({ error: 'Notification not found' });
      return;
    }
    const updated = await prisma.notification.update({
      where: { id },
      data:  { isRead: true },
    });
    res.json(updated);
  } catch (err) {
    console.error('Mark read error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
