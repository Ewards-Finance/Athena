/**
 * Athena V2 - Leave Management Routes
 * Workflow: Employee applies -> Manager gets notified -> Approve/Reject with comments
 *
 * GET    /api/leaves           - list leaves (own for employees; all for manager/admin)
 * POST   /api/leaves           - employee applies for leave
 * GET    /api/leaves/pending   - manager/admin sees all pending approvals
 * PATCH  /api/leaves/:id/approve - manager/admin approves
 * PATCH  /api/leaves/:id/reject  - manager/admin rejects
 * DELETE /api/leaves/:id        - employee cancels their own PENDING leave
 */

import { Router, Response }         from 'express';
import { prisma } from '../lib/prisma';
import { z }                        from 'zod';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';
import { getOrCreateBalances }      from './leaveBalance';
import { createNotification }       from '../lib/notify';
import { createAuditLog }           from '../lib/audit';
import { getFYYear }                from '../lib/fyUtils';
import { sendLeaveApprovedEmail, sendLeaveRejectedEmail } from '../lib/email';
import { UNLIMITED_LEAVE_TYPES } from '../lib/payrollEngine';
import { getBooleanRule } from '../lib/policyEngine';

const router = Router();

router.use(authenticate);

// Zod schema: validates leave application input
const applyLeaveSchema = z.object({
  leaveType:    z.string().min(1, 'Leave type is required'),
  durationType: z.enum(['SINGLE', 'MULTIPLE']),
  // Single-day fields
  singleDate:    z.string().optional(),
  singleDayType: z.enum(['FULL', 'FIRST_HALF', 'SECOND_HALF']).optional(),
  // Multiple-day fields
  startDate:    z.string().optional(),
  startDayType: z.enum(['FULL', 'FROM_SECOND_HALF']).optional(),
  endDate:      z.string().optional(),
  endDayType:   z.enum(['FULL', 'UNTIL_FIRST_HALF']).optional(),
  // Common
  reason: z.string().min(5, 'Reason must be at least 5 characters'),
}).superRefine((data, ctx) => {
  if (data.durationType === 'SINGLE') {
    if (!data.singleDate || isNaN(Date.parse(data.singleDate)))
      ctx.addIssue({ code: 'custom', message: 'Valid date is required', path: ['singleDate'] });
    if (!data.singleDayType)
      ctx.addIssue({ code: 'custom', message: 'Select a session', path: ['singleDayType'] });
  } else {
    if (!data.startDate || isNaN(Date.parse(data.startDate)))
      ctx.addIssue({ code: 'custom', message: 'Valid start date is required', path: ['startDate'] });
    if (!data.endDate || isNaN(Date.parse(data.endDate)))
      ctx.addIssue({ code: 'custom', message: 'Valid end date is required', path: ['endDate'] });
    if (!data.startDayType)
      ctx.addIssue({ code: 'custom', message: 'Select a session', path: ['startDayType'] });
    if (!data.endDayType)
      ctx.addIssue({ code: 'custom', message: 'Select a session', path: ['endDayType'] });
    if (data.startDate && data.endDate && new Date(data.startDate) > new Date(data.endDate))
      ctx.addIssue({ code: 'custom', message: 'End date must be on or after start date', path: ['endDate'] });
  }
});

// Helper: calculate working days between two dates.
// Excludes weekends AND any public/company holidays stored in the DB.
async function calcBusinessDays(start: Date, end: Date): Promise<number> {
  // Fetch all holidays that fall within [start, end]
  const holidays = await prisma.holiday.findMany({
    where: { date: { gte: start, lte: end } },
    select: { date: true },
  });

  // Normalise to YYYY-MM-DD strings for fast lookup
  const holidaySet = new Set(
    holidays.map((h) => h.date.toISOString().split('T')[0])
  );

  let count = 0;
  const cur = new Date(start);
  while (cur <= end) {
    const dow     = cur.getDay();
    const dateStr = cur.toISOString().split('T')[0];
    if (dow !== 0 && dow !== 6 && !holidaySet.has(dateStr)) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

/**
 * Sandwich Rule: If leave days are adjacent to weekends/holidays,
 * those weekends/holidays get "sandwiched" and count as leave days.
 *
 * Example: Leave on Friday + Monday → Saturday & Sunday are sandwiched = 4 total days.
 * Example: Leave on Thursday + Friday, Monday is holiday → Sat+Sun+Mon sandwiched = 6 total.
 */
async function checkSandwichRule(
  start: Date,
  end: Date,
  leaveType: string,
): Promise<{ sandwichDays: number; sandwichDates: string[]; warning: string }> {
  const empty = { sandwichDays: 0, sandwichDates: [], warning: '' };

  // Sandwich rule only applies to paid leave types, not unlimited ones
  if ((UNLIMITED_LEAVE_TYPES as readonly string[]).includes(leaveType)) return empty;

  const enabled = await getBooleanRule(null, 'sandwich_rule_enabled', true);
  if (!enabled) return empty;

  // Fetch holidays in an extended window (7 days before start to 7 days after end)
  const windowStart = new Date(start);
  windowStart.setDate(windowStart.getDate() - 7);
  const windowEnd = new Date(end);
  windowEnd.setDate(windowEnd.getDate() + 7);

  const holidays = await prisma.holiday.findMany({
    where: { date: { gte: windowStart, lte: windowEnd } },
    select: { date: true },
  });
  const holidaySet = new Set(holidays.map(h => h.date.toISOString().split('T')[0]));

  const isNonWorking = (d: Date): boolean => {
    const dow = d.getDay();
    const ds = d.toISOString().split('T')[0];
    return dow === 0 || dow === 6 || holidaySet.has(ds);
  };

  // Walk backwards from start to find contiguous non-working days before
  const sandwichDates: string[] = [];
  const beforeDates: Date[] = [];
  const cur1 = new Date(start);
  cur1.setDate(cur1.getDate() - 1);
  while (isNonWorking(cur1)) {
    beforeDates.push(new Date(cur1));
    cur1.setDate(cur1.getDate() - 1);
  }

  // Walk forwards from end to find contiguous non-working days after
  const afterDates: Date[] = [];
  const cur2 = new Date(end);
  cur2.setDate(cur2.getDate() + 1);
  while (isNonWorking(cur2)) {
    afterDates.push(new Date(cur2));
    cur2.setDate(cur2.getDate() + 1);
  }

  // Also find non-working gaps WITHIN the leave range
  const withinDates: Date[] = [];
  const cur3 = new Date(start);
  cur3.setDate(cur3.getDate() + 1);
  while (cur3 < end) {
    if (isNonWorking(cur3)) withinDates.push(new Date(cur3));
    cur3.setDate(cur3.getDate() + 1);
  }

  // Sandwich logic: non-working days between two leave/working periods are sandwiched
  // Before: only if there's a leave day on the other side (start)
  // After: only if there's a leave day on the other side (end)
  // Within: always sandwiched
  for (const d of beforeDates) sandwichDates.push(d.toISOString().split('T')[0]);
  for (const d of afterDates) sandwichDates.push(d.toISOString().split('T')[0]);
  for (const d of withinDates) sandwichDates.push(d.toISOString().split('T')[0]);

  sandwichDates.sort();
  const count = sandwichDates.length;

  if (count === 0) return empty;

  return {
    sandwichDays: count,
    sandwichDates,
    warning: `Sandwich rule applies: ${count} non-working day(s) (${sandwichDates.join(', ')}) will also be counted as leave.`,
  };
}

// GET /api/leaves - Scoped by role:
//   EMPLOYEE → own leaves only
//   MANAGER  → own leaves + leaves submitted to them for approval
//   ADMIN    → all leaves
router.get('/', async (req: AuthRequest, res: Response) => {
  const user = req.user!;
  try {
    const where =
      user.role === 'EMPLOYEE' ? { employeeId: user.id } :
      user.role === 'MANAGER'  ? { OR: [{ employeeId: user.id }, { managerId: user.id }] } :
      {};
    const leaves = await prisma.leaveRequest.findMany({
      where,
      include: {
        employee: { select: { profile: { select: { firstName: true, lastName: true, employeeId: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(leaves);
  } catch (err) {
    console.error('List leaves error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/leaves/pending - Manager/Admin: all leaves awaiting approval
router.get('/pending', authorize(['ADMIN', 'MANAGER']), async (_req, res: Response) => {
  try {
    const pending = await prisma.leaveRequest.findMany({
      where: { status: 'PENDING' },
      include: {
        employee: {
          select: {
            email:   true,
            profile: { select: { firstName: true, lastName: true, employeeId: true, department: true } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    res.json(pending);
  } catch (err) {
    console.error('Pending leaves error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/leaves - Employee submits a leave application
router.post('/', authorize(['EMPLOYEE', 'MANAGER']), async (req: AuthRequest, res: Response) => {
  const parsed = applyLeaveSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }

  const {
    leaveType, durationType,
    singleDate, singleDayType,
    startDate,  startDayType,
    endDate,    endDayType,
    reason,
  } = parsed.data;

  // Compute start, end, and totalDays based on duration type
  let start: Date, end: Date, totalDays: number;

  if (durationType === 'SINGLE') {
    start     = new Date(singleDate!);
    end       = new Date(singleDate!);
    totalDays = singleDayType === 'FULL' ? 1 : 0.5;
  } else {
    start = new Date(startDate!);
    end   = new Date(endDate!);
    const businessDays = await calcBusinessDays(start, end);
    totalDays = businessDays;
    if (startDayType === 'FROM_SECOND_HALF') totalDays -= 0.5;
    if (endDayType   === 'UNTIL_FIRST_HALF') totalDays -= 0.5;
    totalDays = Math.max(totalDays, 0.5); // minimum half day
  }

  try {
    // ── Sandwich rule check ───────────────────────────────────────────────
    const sandwich = await checkSandwichRule(start, end, leaveType);
    if (sandwich.sandwichDays > 0) {
      totalDays += sandwich.sandwichDays;
    }

    // ── Document requirement check ────────────────────────────────────────
    let documentWarning = '';
    const policy = await prisma.leavePolicy.findUnique({ where: { leaveType } });
    if (policy?.documentRequired && totalDays > (policy.documentAfterDays ?? 0)) {
      documentWarning = `Medical document required for ${leaveType} exceeding ${policy.documentAfterDays ?? 0} day(s).`;
    }

    // ── LWP cascade warning ───────────────────────────────────────────────
    let lwpWarning = '';
    let lwpDays = 0;
    const isUnlimited = (UNLIMITED_LEAVE_TYPES as readonly string[]).includes(leaveType);
    if (!isUnlimited) {
      const year = getFYYear(new Date(start));
      await getOrCreateBalances(req.user!.id, year);
      const balance = await prisma.leaveBalance.findFirst({
        where: { userId: req.user!.id, year, leaveType },
      });
      if (balance) {
        const remaining = Math.max(balance.total - balance.used, 0);
        if (totalDays > remaining) {
          lwpDays = totalDays - remaining;
          lwpWarning = `Insufficient ${leaveType} balance. ${lwpDays} day(s) will be marked as Loss of Pay (LWP).`;
        }
      }
    }

    // ── Preview mode — return warnings without creating leave ─────────────
    if (req.query.preview === 'true') {
      res.json({
        preview: true,
        totalDays,
        sandwichDays: sandwich.sandwichDays,
        sandwichDates: sandwich.sandwichDates,
        sandwichWarning: sandwich.warning,
        documentWarning,
        lwpDays,
        lwpWarning,
      });
      return;
    }

    // ── Overlap detection ─────────────────────────────────────────────────
    const force = req.query.force === 'true';
    if (!force) {
      const overlapping = await prisma.leaveRequest.findMany({
        where: {
          employeeId: req.user!.id,
          status:     { in: ['PENDING', 'APPROVED'] },
          startDate:  { lte: end },
          endDate:    { gte: start },
        },
        select: { id: true, leaveType: true, startDate: true, endDate: true, status: true },
      });
      if (overlapping.length > 0) {
        res.status(409).json({
          warning:          true,
          message:          'You already have a leave request that overlaps with the selected dates. Submit again to confirm.',
          conflictingLeaves: overlapping,
        });
        return;
      }
    }

    // Find the employee's reporting manager from their profile
    const profile = await prisma.profile.findUnique({
      where:  { userId: req.user!.id },
      select: { managerId: true },
    });

    const leave = await prisma.leaveRequest.create({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: {
        employeeId:    req.user!.id,
        managerId:     profile?.managerId || undefined,
        leaveType,
        startDate:     start,
        endDate:       end,
        totalDays,
        reason,
        status:        'PENDING',
        durationType,
        singleDayType: durationType === 'SINGLE'   ? singleDayType : undefined,
        startDayType:  durationType === 'MULTIPLE'  ? startDayType  : undefined,
        endDayType:    durationType === 'MULTIPLE'  ? endDayType    : undefined,
      } as any,
    });

    // Notify the reporting manager (if assigned)
    if (profile?.managerId) {
      const emp = await prisma.profile.findUnique({
        where:  { userId: req.user!.id },
        select: { firstName: true, lastName: true },
      });
      const empName = emp ? `${emp.firstName} ${emp.lastName}` : 'An employee';
      const daysStr = totalDays === 0.5 ? 'half day' : `${totalDays} day${totalDays !== 1 ? 's' : ''}`;
      await createNotification({
        userId:  profile.managerId,
        type:    'LEAVE_APPLIED',
        title:   'New Leave Request',
        message: `${empName} has applied for ${leaveType} leave (${daysStr}).`,
        link:    '/leaves',
      });
    }

    res.status(201).json({
      ...leave,
      sandwichDays: sandwich.sandwichDays,
      sandwichWarning: sandwich.warning,
      documentWarning,
      lwpDays,
      lwpWarning,
    });
  } catch (err) {
    console.error('Apply leave error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/leaves/:id/approve - Manager or Admin approves a leave
router.patch('/:id/approve', authorize(['ADMIN', 'MANAGER']), async (req: AuthRequest, res: Response) => {
  const { id }     = req.params;
  const { comment } = req.body;

  try {
    const leave = await prisma.leaveRequest.findUnique({
      where: { id },
      include: {
        employee: {
          select: {
            email:   true,
            profile: { select: { firstName: true, lastName: true, employeeId: true } },
          },
        },
      },
    });
    if (!leave) {
      res.status(404).json({ error: 'Leave request not found' });
      return;
    }
    if (leave.status !== 'PENDING') {
      res.status(400).json({ error: `Cannot approve a leave that is already ${leave.status}` });
      return;
    }

    // Cannot approve your own leave
    if (leave.employeeId === req.user!.id) {
      res.status(403).json({ error: 'You cannot approve your own leave request' });
      return;
    }

    // Admin's leave requests can only be approved by another Admin
    const submitter = await prisma.user.findUnique({ where: { id: leave.employeeId }, select: { role: true } });
    if (submitter?.role === 'ADMIN' && req.user!.role !== 'ADMIN') {
      res.status(403).json({ error: 'Only an Admin can approve another Admin\'s leave request' });
      return;
    }

    const year = getFYYear(new Date(leave.startDate));
    const isUnlimited = (UNLIMITED_LEAVE_TYPES as readonly string[]).includes(leave.leaveType);

    // Ensure balance row exists (for non-unlimited types), then approve
    if (!isUnlimited) await getOrCreateBalances(leave.employeeId, year);

    // ── LWP cascade: deduct only up to available balance ─────────────────
    let lwpDays = 0;
    let deductDays = leave.totalDays;
    if (!isUnlimited) {
      const balance = await prisma.leaveBalance.findFirst({
        where: { userId: leave.employeeId, year, leaveType: leave.leaveType },
      });
      if (balance) {
        const remaining = Math.max(balance.total - balance.used, 0);
        if (leave.totalDays > remaining) {
          lwpDays = leave.totalDays - remaining;
          deductDays = remaining; // only deduct what's available
        }
      }
    }

    const approveOps: any[] = [
      prisma.leaveRequest.update({
        where: { id },
        data: {
          status:         'APPROVED',
          managerId:      req.user!.id,
          managerComment: comment || 'Approved',
          approvedAt:     new Date(),
        },
      }),
    ];
    // Only deduct balance for types that have a balance (not TEMPORARY_WFH / TRAVELLING)
    if (!isUnlimited && deductDays > 0) {
      approveOps.push(
        prisma.leaveBalance.updateMany({
          where: { userId: leave.employeeId, year, leaveType: leave.leaveType },
          data:  { used: { increment: deductDays } },
        })
      );
    }
    const [updated] = await prisma.$transaction(approveOps);

    // ── Auto-create TravelProof records for TRAVELLING leaves ─────────────
    if (leave.leaveType === 'TRAVELLING') {
      const proofRecords: any[] = [];
      const cur = new Date(leave.startDate);
      const endDate = new Date(leave.endDate);
      while (cur <= endDate) {
        const dow = cur.getDay();
        if (dow !== 0 && dow !== 6) { // business days only
          proofRecords.push({
            leaveRequestId: leave.id,
            userId:         leave.employeeId,
            proofDate:      new Date(cur),
          });
        }
        cur.setDate(cur.getDate() + 1);
      }
      if (proofRecords.length > 0) {
        await prisma.travelProof.createMany({ data: proofRecords, skipDuplicates: true });
      }
    }

    // ── Notify about LWP cascade ──────────────────────────────────────────
    if (lwpDays > 0) {
      await createNotification({
        userId:  leave.employeeId,
        type:    'LWP_CASCADE',
        title:   'Leave Balance Exhausted',
        message: `${lwpDays} day(s) of your ${leave.leaveType} leave will be marked as Loss of Pay (LWP) due to insufficient balance.`,
        link:    '/leaves',
      });
    }

    // Audit log
    await createAuditLog({
      actorId:   req.user!.id,
      action:    'LEAVE_APPROVED',
      entity:    'LeaveRequest',
      entityId:  id,
      subjectEntity: 'User',
      subjectId: leave.employeeId,
      subjectLabel: leave.employee?.profile
        ? `${leave.employee.profile.firstName} ${leave.employee.profile.lastName} (${leave.employee.profile.employeeId})`
        : leave.employeeId,
      subjectMeta: {
        leaveType: leave.leaveType,
        totalDays: leave.totalDays,
        startDate: leave.startDate,
        endDate: leave.endDate,
      },
      oldValues: { status: 'PENDING' },
      newValues: { status: 'APPROVED', comment: comment || 'Approved' },
    });

    // Notify the employee their leave was approved
    const approvedDaysStr = leave.totalDays === 0.5 ? 'half day' : `${leave.totalDays} day${leave.totalDays !== 1 ? 's' : ''}`;
    await createNotification({
      userId:  leave.employeeId,
      type:    'LEAVE_APPROVED',
      title:   'Leave Approved',
      message: `Your ${leave.leaveType} leave request (${approvedDaysStr}) has been approved.`,
      link:    '/leaves',
    });

    // Email (fire and forget)
    if (leave.employee?.email) {
      sendLeaveApprovedEmail({
        to:        leave.employee.email,
        firstName: leave.employee.profile?.firstName ?? 'Employee',
        leaveType: leave.leaveType,
        startDate: new Date(leave.startDate).toDateString(),
        endDate:   new Date(leave.endDate).toDateString(),
        totalDays: leave.totalDays,
        comment:   comment || undefined,
      }).catch(() => {});
    }

    res.json(updated);
  } catch (err) {
    console.error('Approve leave error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/leaves/:id/reject - Manager or Admin rejects a leave
router.patch('/:id/reject', authorize(['ADMIN', 'MANAGER']), async (req: AuthRequest, res: Response) => {
  const { id }     = req.params;
  const { comment } = req.body;

  try {
    const leave = await prisma.leaveRequest.findUnique({
      where: { id },
      include: {
        employee: {
          select: {
            email:   true,
            profile: { select: { firstName: true, lastName: true, employeeId: true } },
          },
        },
      },
    });
    if (!leave) {
      res.status(404).json({ error: 'Leave request not found' });
      return;
    }
    if (leave.status !== 'PENDING') {
      res.status(400).json({ error: `Cannot reject a leave that is already ${leave.status}` });
      return;
    }

    // Cannot reject your own leave
    if (leave.employeeId === req.user!.id) {
      res.status(403).json({ error: 'You cannot reject your own leave request' });
      return;
    }

    // Admin's leave requests can only be rejected by another Admin
    const submitter = await prisma.user.findUnique({ where: { id: leave.employeeId }, select: { role: true } });
    if (submitter?.role === 'ADMIN' && req.user!.role !== 'ADMIN') {
      res.status(403).json({ error: 'Only an Admin can reject another Admin\'s leave request' });
      return;
    }

    const updated = await prisma.leaveRequest.update({
      where: { id },
      data: {
        status:         'REJECTED',
        managerId:      req.user!.id,
        managerComment: comment || 'Rejected',
      },
    });

    // Notify the employee their leave was rejected
    await createNotification({
      userId:  leave.employeeId,
      type:    'LEAVE_REJECTED',
      title:   'Leave Rejected',
      message: `Your ${leave.leaveType} leave request (${leave.totalDays} day${leave.totalDays !== 1 ? 's' : ''}) has been rejected.${comment ? ` Reason: ${comment}` : ''}`,
      link:    '/leaves',
    });

    // Email (fire and forget)
    if (leave.employee?.email) {
      sendLeaveRejectedEmail({
        to:        leave.employee.email,
        firstName: leave.employee.profile?.firstName ?? 'Employee',
        leaveType: leave.leaveType,
        startDate: new Date(leave.startDate).toDateString(),
        endDate:   new Date(leave.endDate).toDateString(),
        totalDays: leave.totalDays,
        comment:   comment || undefined,
      }).catch(() => {});
    }

    // Audit log
    await createAuditLog({
      actorId:   req.user!.id,
      action:    'LEAVE_REJECTED',
      entity:    'LeaveRequest',
      entityId:  id,
      subjectEntity: 'User',
      subjectId: leave.employeeId,
      subjectLabel: leave.employee?.profile
        ? `${leave.employee.profile.firstName} ${leave.employee.profile.lastName} (${leave.employee.profile.employeeId})`
        : leave.employeeId,
      subjectMeta: {
        leaveType: leave.leaveType,
        totalDays: leave.totalDays,
        startDate: leave.startDate,
        endDate: leave.endDate,
      },
      oldValues: { status: 'PENDING' },
      newValues: { status: 'REJECTED', comment: comment || 'Rejected' },
    });

    res.json(updated);
  } catch (err) {
    console.error('Reject leave error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/leaves/:id/change-type — Admin only: override leave type on a PENDING request
router.patch('/:id/change-type', authorize(['ADMIN']), async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const parsed = z.object({
    leaveType: z.string().min(1, 'Leave type is required'),
  }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }

  try {
    const leave = await prisma.leaveRequest.findUnique({ where: { id } });
    if (!leave) {
      res.status(404).json({ error: 'Leave request not found' });
      return;
    }
    if (leave.status !== 'PENDING') {
      res.status(400).json({ error: 'Leave type can only be changed on PENDING requests' });
      return;
    }
    if (leave.leaveType === parsed.data.leaveType) {
      res.status(400).json({ error: 'New leave type is the same as the current type' });
      return;
    }

    const oldType = leave.leaveType;
    const updated = await prisma.leaveRequest.update({
      where: { id },
      data:  { leaveType: parsed.data.leaveType },
    });

    await createNotification({
      userId:  leave.employeeId,
      type:    'LEAVE_TYPE_CHANGED',
      title:   'Leave Type Updated',
      message: `Your leave request type has been changed from ${oldType} to ${parsed.data.leaveType} by HR Admin.`,
      link:    '/leaves',
    });

    res.json(updated);
  } catch (err) {
    console.error('Change leave type error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/leaves/:id - Employee cancels their own PENDING leave
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const user = req.user!;

  try {
    const leave = await prisma.leaveRequest.findUnique({ where: { id } });
    if (!leave) {
      res.status(404).json({ error: 'Leave request not found' });
      return;
    }
    // Only the owner can cancel, and only if still pending
    if (leave.employeeId !== user.id && user.role !== 'ADMIN') {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    if (leave.status !== 'PENDING' && leave.status !== 'APPROVED') {
      res.status(400).json({ error: 'Only PENDING or APPROVED leaves can be cancelled' });
      return;
    }

    const ops: any[] = [
      prisma.leaveRequest.update({
        where: { id },
        data:  { status: 'CANCELLED' },
      }),
    ];

    // If it was already APPROVED, decrement the used balance (not for unlimited types)
    const isUnlimited = (UNLIMITED_LEAVE_TYPES as readonly string[]).includes(leave.leaveType);
    if (leave.status === 'APPROVED' && !isUnlimited) {
      const year = getFYYear(new Date(leave.startDate));
      ops.push(
        prisma.leaveBalance.updateMany({
          where: { userId: leave.employeeId, year, leaveType: leave.leaveType },
          data:  { used: { decrement: leave.totalDays } },
        })
      );
    }

    await prisma.$transaction(ops);
    res.json({ message: 'Leave cancelled successfully' });
  } catch (err) {
    console.error('Cancel leave error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
