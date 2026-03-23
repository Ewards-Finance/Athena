/**
 * Athena V3.1 Sprint 5 — Service Desk / Helpdesk
 * Employees raise tickets, admins manage and resolve them.
 */

import { Router, Response } from 'express';
import { AuthRequest, authenticate, authorize } from '../middleware/auth';
import { prisma } from '../lib/prisma';
import { createNotification, createNotifications } from '../lib/notify';

const router = Router();
router.use(authenticate);

const VALID_CATEGORIES = [
  'SALARY_ISSUE', 'ATTENDANCE_CORRECTION', 'DOCUMENT_REQUEST',
  'REIMBURSEMENT_ISSUE', 'LEAVE_CORRECTION', 'LETTER_REQUEST',
  'IT_SUPPORT', 'OTHER',
];
const VALID_STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];

// POST / — Any employee raises a ticket
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!;
    const { category, subject, description } = req.body;
    if (!category || !subject || !description) {
      res.status(400).json({ error: 'category, subject, and description are required' });
      return;
    }
    if (!VALID_CATEGORIES.includes(category)) {
      res.status(400).json({ error: `Invalid category. Must be one of: ${VALID_CATEGORIES.join(', ')}` });
      return;
    }

    const ticket = await prisma.serviceRequest.create({
      data: {
        userId: user.id,
        category: category as any,
        subject,
        description,
      },
      include: {
        user: {
          select: {
            profile: { select: { firstName: true, lastName: true, managerId: true } },
          },
        },
      },
    });

    // Notify all admins about the new ticket
    const admins = await prisma.user.findMany({
      where: { role: { in: ['ADMIN', 'OWNER'] }, isActive: true },
      select: { id: true },
    });
    const empName = ticket.user?.profile
      ? `${ticket.user.profile.firstName} ${ticket.user.profile.lastName}`
      : 'An employee';
    await createNotifications(
      admins.map((a) => ({
        userId: a.id,
        type: 'SERVICE_REQUEST_NEW',
        title: 'New Helpdesk Ticket',
        message: `${empName} raised a ticket: "${subject}"`,
        link: '/helpdesk',
      })),
    );

    // Notify reporting manager too (if available and not already in admin list)
    const managerId = ticket.user?.profile?.managerId ?? null;
    if (managerId && !admins.some((a) => a.id === managerId)) {
      await createNotification({
        userId: managerId,
        type: 'SERVICE_REQUEST_NEW',
        title: 'New Team Helpdesk Ticket',
        message: `${empName} raised a ticket: "${subject}"`,
        link: '/helpdesk',
      });
    }

    res.status(201).json(ticket);
  } catch (err) {
    console.error('Create service request error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET / — List tickets (admin: all, employee: own)
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!;
    const isAdmin = user.role === 'ADMIN' || user.role === 'OWNER';
    const isManager = user.role === 'MANAGER';
    const where = isAdmin
      ? {}
      : isManager
        ? {
            OR: [
              { userId: user.id }, // manager's own ticket
              { assignedTo: user.id }, // explicitly assigned to manager
              { user: { profile: { is: { managerId: user.id } } } }, // team member tickets
            ],
          }
        : { userId: user.id };

    const tickets = await prisma.serviceRequest.findMany({
      where,
      include: {
        user: {
          select: {
            email: true,
            profile: { select: { firstName: true, lastName: true, employeeId: true, managerId: true } },
          },
        },
      },
      orderBy: [
        { status: 'asc' }, // OPEN first (alphabetical: CLOSED, IN_PROGRESS, OPEN, RESOLVED)
        { createdAt: 'desc' },
      ],
    });

    // Re-sort so OPEN → IN_PROGRESS → RESOLVED → CLOSED
    const statusOrder: Record<string, number> = { OPEN: 0, IN_PROGRESS: 1, RESOLVED: 2, CLOSED: 3 };
    tickets.sort((a, b) => (statusOrder[a.status] ?? 9) - (statusOrder[b.status] ?? 9) || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    // Enrich with reporting manager identity for assignment UI
    const managerIds = Array.from(
      new Set(
        tickets
          .map((t) => t.user?.profile?.managerId)
          .filter((id): id is string => !!id)
      )
    );
    const managers = managerIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: managerIds } },
          select: {
            id: true,
            email: true,
            profile: { select: { firstName: true, lastName: true, employeeId: true } },
          },
        })
      : [];
    const managerMap = new Map(managers.map((m) => [m.id, m]));

    res.json(
      tickets.map((t) => ({
        ...t,
        reportingManager: t.user?.profile?.managerId
          ? managerMap.get(t.user.profile.managerId) ?? null
          : null,
      }))
    );
  } catch (err) {
    console.error('List service requests error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /:id — Single ticket
router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!;
    const ticket = await prisma.serviceRequest.findUnique({
      where: { id: req.params.id },
      include: {
        user: {
          select: {
            email: true,
            profile: { select: { firstName: true, lastName: true, employeeId: true, managerId: true } },
          },
        },
      },
    });
    if (!ticket) { res.status(404).json({ error: 'Ticket not found' }); return; }

    const isAdmin = user.role === 'ADMIN' || user.role === 'OWNER';
    const isReportingManager = user.role === 'MANAGER' && ticket.user?.profile?.managerId === user.id;
    const isAssignedManager = user.role === 'MANAGER' && ticket.assignedTo === user.id;
    if (!isAdmin && !isReportingManager && !isAssignedManager && ticket.userId !== user.id) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    res.json(ticket);
  } catch (err) {
    console.error('Get service request error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /:id — Admin/Manager updates status / assigns / resolves
router.patch('/:id', authorize(['ADMIN', 'MANAGER']), async (req: AuthRequest, res: Response) => {
  try {
    const actor = req.user!;
    const isAdmin = actor.role === 'ADMIN' || actor.role === 'OWNER';
    const { status, assignedTo, resolution } = req.body;
    const ticket = await prisma.serviceRequest.findUnique({
      where: { id: req.params.id },
      include: {
        user: {
          select: {
            profile: { select: { managerId: true } },
          },
        },
      },
    });
    if (!ticket) { res.status(404).json({ error: 'Ticket not found' }); return; }

    const isReportingManager = actor.role === 'MANAGER' && ticket.user?.profile?.managerId === actor.id;
    const isAssignedManager = actor.role === 'MANAGER' && ticket.assignedTo === actor.id;
    if (!isAdmin && !isReportingManager && !isAssignedManager) {
      res.status(403).json({ error: 'Forbidden: You can only update team tickets assigned to you' });
      return;
    }

    if (status && !VALID_STATUSES.includes(status)) {
      res.status(400).json({ error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` });
      return;
    }

    if (!isAdmin && assignedTo !== undefined && assignedTo !== actor.id) {
      res.status(403).json({ error: 'Managers cannot assign tickets to others' });
      return;
    }

    if (assignedTo !== undefined && assignedTo !== null) {
      const assignee = await prisma.user.findUnique({
        where: { id: assignedTo },
        select: { id: true, isActive: true, role: true },
      });
      if (!assignee || !assignee.isActive) {
        res.status(400).json({ error: 'Assigned user is not active or not found' });
        return;
      }
      if (!['ADMIN', 'MANAGER', 'OWNER'].includes(assignee.role)) {
        res.status(400).json({ error: 'Only ADMIN, MANAGER, or OWNER can be assignees' });
        return;
      }
    }

    const data: any = {};
    if (status) data.status = status;
    if (assignedTo !== undefined) data.assignedTo = assignedTo;
    if (resolution !== undefined) data.resolution = resolution;
    if (status === 'RESOLVED') data.resolvedAt = new Date();

    const updated = await prisma.serviceRequest.update({
      where: { id: req.params.id },
      data,
      include: {
        user: {
          select: {
            profile: { select: { firstName: true, lastName: true } },
          },
        },
      },
    });

    // Notify employee on status change
    if (status && status !== ticket.status) {
      const statusLabel = status.replace('_', ' ').toLowerCase();
      await createNotification({
        userId: ticket.userId,
        type: 'SERVICE_REQUEST_UPDATE',
        title: 'Helpdesk Ticket Updated',
        message: `Your ticket "${ticket.subject}" is now ${statusLabel}.${resolution ? ` Resolution: ${resolution}` : ''}`,
        link: '/helpdesk',
      });
    }

    if (assignedTo && assignedTo !== ticket.assignedTo) {
      await createNotification({
        userId: assignedTo,
        type: 'SERVICE_REQUEST_ASSIGNED',
        title: 'Helpdesk Ticket Assigned',
        message: `A helpdesk ticket "${ticket.subject}" has been assigned to you.`,
        link: '/helpdesk',
      });
    }

    res.json(updated);
  } catch (err) {
    console.error('Update service request error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
