/**
 * Athena V3.1 - Travel Proof Routes
 * GPS location proof for employees on TRAVELLING leave.
 *
 * POST   /api/travel-proof              - employee submits GPS proof for a travel day
 * GET    /api/travel-proof              - list proofs (own for employee; all for admin)
 * GET    /api/travel-proof/pending      - admin/manager: travel days with no proof
 */

import { Router, Response } from 'express';
import { prisma } from '../lib/prisma';
import { z } from 'zod';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';
import { createNotification } from '../lib/notify';

const router = Router();

router.use(authenticate);

// Zod: submit proof
const proofSchema = z.object({
  leaveRequestId: z.string().min(1),
  proofDate:      z.string().min(1),
  geoLat:         z.number(),
  geoLng:         z.number(),
});

// GET /api/travel-proof/today - employee: check if today falls in a TRAVELLING leave (any status except REJECTED/CANCELLED)
// Returns: { leaveRequestId, proofDate, alreadySubmitted } or null
router.get('/today', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const today  = new Date();
    today.setHours(0, 0, 0, 0);
    const todayEnd = new Date(today);
    todayEnd.setHours(23, 59, 59, 999);
    const todayStr = today.toISOString().split('T')[0];

    // Find a TRAVELLING leave that covers today (PENDING or APPROVED — not REJECTED/CANCELLED)
    const leave = await prisma.leaveRequest.findFirst({
      where: {
        employeeId: userId,
        leaveType:  'TRAVELLING',
        status:     { in: ['PENDING', 'APPROVED'] },
        startDate:  { lte: todayEnd },
        endDate:    { gte: today },
      },
    });

    if (!leave) {
      res.json(null);
      return;
    }

    // Check if proof already submitted for today
    const existing = await prisma.travelProof.findUnique({
      where: { leaveRequestId_proofDate: { leaveRequestId: leave.id, proofDate: today } },
    });

    res.json({
      leaveRequestId:   leave.id,
      proofDate:        todayStr,
      leaveStatus:      leave.status,
      alreadySubmitted: !!existing,
    });
  } catch (err) {
    console.error('Today travel proof error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/travel-proof/pending - admin/manager: days missing proof
router.get('/pending', authorize(['ADMIN', 'MANAGER', 'OWNER']), async (_req: AuthRequest, res: Response) => {
  try {
    const pending = await prisma.travelProof.findMany({
      where: { submittedAt: null },
      include: {
        user: { select: { email: true, profile: { select: { firstName: true, lastName: true, employeeId: true } } } },
        leaveRequest: { select: { startDate: true, endDate: true } },
      },
      orderBy: { proofDate: 'asc' },
    });
    res.json(pending);
  } catch (err) {
    console.error('Pending travel proofs error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/travel-proof - list
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!;
    const where: any = user.role === 'EMPLOYEE' ? { userId: user.id } : {};

    // Filter by leaveRequestId if provided (employees always scoped to own)
    if (req.query.leaveRequestId) {
      where.leaveRequestId = req.query.leaveRequestId as string;
      // Employees can only see their own proofs — enforce userId even with filter
      if (user.role === 'EMPLOYEE') where.userId = user.id;
    }

    const proofs = await prisma.travelProof.findMany({
      where,
      include: {
        user: { select: { email: true, profile: { select: { firstName: true, lastName: true, employeeId: true } } } },
      },
      orderBy: { proofDate: 'asc' },
    });
    res.json(proofs);
  } catch (err) {
    console.error('List travel proofs error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/travel-proof - employee submits GPS proof
router.post('/', async (req: AuthRequest, res: Response) => {
  const parsed = proofSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }

  const { leaveRequestId, proofDate, geoLat, geoLng } = parsed.data;
  const date = new Date(proofDate);

  try {
    // Validate: leave must exist, be TRAVELLING, and be APPROVED
    const leave = await prisma.leaveRequest.findUnique({ where: { id: leaveRequestId } });
    if (!leave) {
      res.status(404).json({ error: 'Leave request not found' });
      return;
    }
    if (leave.leaveType !== 'TRAVELLING') {
      res.status(400).json({ error: 'Travel proof can only be submitted for TRAVELLING leaves' });
      return;
    }
    if (leave.status !== 'APPROVED') {
      res.status(400).json({ error: 'Your travelling leave must be approved before you can submit proof. Ask your manager to approve it first.' });
      return;
    }

    // Validate: proofDate must be TODAY — employees can only submit proof for the current day
    const proofDateStr = date.toISOString().split('T')[0];
    const todayStr = new Date().toISOString().split('T')[0];
    if (proofDateStr !== todayStr) {
      res.status(400).json({ error: 'You can only submit location proof for today\'s date' });
      return;
    }

    // Validate: today must be within the leave date range
    const startStr = new Date(leave.startDate).toISOString().split('T')[0];
    const endStr   = new Date(leave.endDate).toISOString().split('T')[0];
    if (proofDateStr < startStr || proofDateStr > endStr) {
      res.status(400).json({ error: 'Today is not within your travelling leave dates' });
      return;
    }

    // Validate: employee can only submit for themselves
    if (leave.employeeId !== req.user!.id) {
      res.status(403).json({ error: 'You can only submit proof for your own travel leave' });
      return;
    }

    const mapsLink = `https://maps.google.com/?q=${geoLat},${geoLng}`;

    // Upsert: update existing record or create new one
    const proof = await prisma.travelProof.upsert({
      where: {
        leaveRequestId_proofDate: { leaveRequestId, proofDate: date },
      },
      update: {
        geoLat,
        geoLng,
        mapsLink,
        submittedAt: new Date(),
      },
      create: {
        leaveRequestId,
        userId: req.user!.id,
        proofDate: date,
        geoLat,
        geoLng,
        mapsLink,
        submittedAt: new Date(),
      },
    });

    // Notify manager + admins
    const profile = await prisma.profile.findUnique({
      where: { userId: req.user!.id },
      select: { firstName: true, lastName: true, managerId: true },
    });
    const empName = profile ? `${profile.firstName} ${profile.lastName}` : 'An employee';
    const dateStr = date.toDateString();

    const notifyIds: string[] = [];
    if (profile?.managerId) notifyIds.push(profile.managerId);
    const admins = await prisma.user.findMany({
      where: { role: { in: ['ADMIN', 'OWNER'] }, isActive: true },
      select: { id: true },
    });
    for (const a of admins) {
      if (!notifyIds.includes(a.id)) notifyIds.push(a.id);
    }

    for (const uid of notifyIds) {
      await createNotification({
        userId: uid,
        type:   'TRAVEL_PROOF_SUBMITTED',
        title:  'Travel Proof Submitted',
        message: `${empName} has submitted travel proof for ${dateStr}.`,
        link:   '/attendance',
      });
    }

    res.status(201).json(proof);
  } catch (err) {
    console.error('Submit travel proof error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
