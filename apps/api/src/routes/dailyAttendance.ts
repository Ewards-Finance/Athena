/**
 * Athena V2 - Daily Attendance View
 *
 * Shows who is on leave / half-day / WFH / travelling for a given date.
 * Upcoming leaves (next 60 days) also included.
 * Visible to all roles. Read-only report.
 *
 * GET /api/daily-attendance?date=YYYY-MM-DD
 */

import { Router, Response } from 'express';
import { AuthRequest, authenticate } from '../middleware/auth';
import { prisma } from '../index';

const router = Router();
router.use(authenticate);

function toDate(dateStr: string): Date {
  const d = new Date(dateStr);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

router.get('/', async (req: AuthRequest, res: Response) => {
  const dateStr = (req.query.date as string) ?? isoDate(new Date());
  const date = toDate(dateStr);
  const dateEnd = new Date(date);
  dateEnd.setUTCHours(23, 59, 59, 999);

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const sixtyDays = new Date(today);
  sixtyDays.setUTCDate(today.getUTCDate() + 60);

  try {
    const leavesOnDate = await prisma.leaveRequest.findMany({
      where: {
        status: { in: ['APPROVED', 'PENDING'] },
        startDate: { lte: dateEnd },
        endDate: { gte: date },
      },
      include: {
        employee: {
          select: {
            profile: { select: { firstName: true, lastName: true, employeeId: true, department: true } },
          },
        },
      },
      orderBy: { employee: { profile: { firstName: 'asc' } } },
    });

    const upcoming = await prisma.leaveRequest.findMany({
      where: {
        status: { in: ['APPROVED', 'PENDING'] },
        startDate: { gte: today },
        endDate: { lte: sixtyDays },
      },
      include: {
        employee: {
          select: {
            profile: { select: { firstName: true, lastName: true, employeeId: true, department: true } },
          },
        },
      },
      orderBy: { startDate: 'asc' },
    });

    const onLeave: typeof leavesOnDate = [];
    const halfDayAM: typeof leavesOnDate = [];
    const halfDayPM: typeof leavesOnDate = [];
    const onWFH: typeof leavesOnDate = [];
    const onTravelling: typeof leavesOnDate = [];

    for (const leave of leavesOnDate) {
      if (leave.leaveType === 'TEMPORARY_WFH') {
        onWFH.push(leave);
      } else if (leave.leaveType === 'TRAVELLING') {
        onTravelling.push(leave);
      } else if (leave.durationType === 'SINGLE' && leave.singleDayType === 'FIRST_HALF') {
        halfDayAM.push(leave);
      } else if (leave.durationType === 'SINGLE' && leave.singleDayType === 'SECOND_HALF') {
        halfDayPM.push(leave);
      } else if (leave.durationType === 'MULTIPLE') {
        const isStartHalf = isoDate(new Date(leave.startDate)) === dateStr && leave.startDayType === 'FROM_SECOND_HALF';
        const isEndHalf = isoDate(new Date(leave.endDate)) === dateStr && leave.endDayType === 'UNTIL_FIRST_HALF';
        if (isStartHalf) halfDayPM.push(leave);
        else if (isEndHalf) halfDayAM.push(leave);
        else onLeave.push(leave);
      } else {
        onLeave.push(leave);
      }
    }

    res.json({ date: dateStr, onLeave, halfDayAM, halfDayPM, onWFH, onTravelling, upcoming });
  } catch (err) {
    console.error('Daily attendance error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
