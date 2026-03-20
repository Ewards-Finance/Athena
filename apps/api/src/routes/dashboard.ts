/**
 * Athena V2 - Dashboard Stats Route
 * GET /api/dashboard/stats
 *
 * Returns aggregated stats for the stat cards on the dashboard:
 * - Total active employees
 * - Pending approvals (leaves)
 * - Today's leaves (people on leave today)
 * - Pending claims
 */

import { Router, Response }         from 'express';
import { prisma } from '../lib/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';

const router = Router();

router.use(authenticate);

router.get('/stats', async (req: AuthRequest, res: Response) => {
  const user = req.user!;
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Count total active employees (exclude self for employees - show all for admin/manager)
    const totalEmployees = await prisma.user.count({
      where: { isActive: true },
    });

    // Count pending leave approvals
    const pendingLeaves = await prisma.leaveRequest.count({
      where: {
        status: 'PENDING',
        // Employees see their own pending; Managers/Admin see all
        ...(user.role === 'EMPLOYEE' ? { employeeId: user.id } : {}),
      },
    });

    // Count who is on leave today
    const todaysLeaves = await prisma.leaveRequest.count({
      where: {
        status:    'APPROVED',
        startDate: { lte: tomorrow },
        endDate:   { gte: today },
      },
    });

    // Count pending reimbursement claims
    const pendingClaims = await prisma.reimbursement.count({
      where: {
        status: 'PENDING',
        ...(user.role === 'EMPLOYEE' ? { employeeId: user.id } : {}),
      },
    });

    // Latest announcements for the notice board
    const announcements = await prisma.announcement.findMany({
      where:   { isActive: true },
      orderBy: { createdAt: 'desc' },
      take:    5,
    });

    res.json({
      totalEmployees,
      pendingLeaves,
      todaysLeaves,
      pendingClaims,
      announcements,
    });
  } catch (err) {
    console.error('Dashboard stats error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/dashboard/team
// Returns the logged-in user's department teammates (same department, all active users)
router.get('/team', async (req: AuthRequest, res: Response) => {
  const user = req.user!;
  try {
    const myProfile = await prisma.profile.findUnique({
      where:  { userId: user.id },
      select: { department: true },
    });

    const department = myProfile?.department?.trim();
    if (!department) {
      res.json({ department: null, count: 0, members: [] });
      return;
    }

    const members = await prisma.profile.findMany({
      where: {
        department,
        user: { isActive: true },
        NOT: { employeeId: { startsWith: 'eXXX' } },
      },
      select: {
        userId:      true,
        firstName:   true,
        lastName:    true,
        designation: true,
        employeeId:  true,
      },
      orderBy: { firstName: 'asc' },
    });

    res.json({ department, count: members.length, members });
  } catch (err) {
    console.error('Team info error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
