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
import { createNotification, createNotifications } from '../lib/notify';
import { createAuditLog }           from '../lib/audit';
import { getFYYear }                from '../lib/fyUtils';
import { UNLIMITED_LEAVE_TYPES, NO_BALANCE_TRACK_TYPES } from '../lib/payrollEngine';
import { getBooleanRule } from '../lib/policyEngine';
import { isDelegateForEmployee } from '../lib/delegation';

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
  // Admin on-behalf-of
  onBehalfOf: z.string().optional(),
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
 * Sandwich Rule:
 *
 * A block of non-working days gets sandwiched when there is a FULL day leave
 * on BOTH sides of that block. The two leaves can be in the same request
 * (multi-day leave) OR in separate requests (two single-day leaves with
 * non-working days in between).
 *
 * Non-working days = weekends + declared holidays + DeclaredWFH days.
 * Only an actual office day (half or full) breaks a sandwich.
 *
 * Examples:
 *   Mon(full)→Thu(full) in ONE request, Tue+Wed holidays → 2+2=4 days
 *   Mon(full) single + existing Thu(full) single, Tue+Wed holidays → Thu gets +2
 *   Mon(half)→Thu(full) → no sandwich (start is not full)
 */
async function checkSandwichRule(
  start: Date,
  end: Date,
  leaveType: string,
  durationType: string,
  startDayType: string | undefined,
  endDayType: string | undefined,
  employeeId: string,
): Promise<{ sandwichDays: number; sandwichDates: string[]; warning: string }> {
  const empty = { sandwichDays: 0, sandwichDates: [], warning: '' };

  // Sandwich rule only applies to paid leave types — skip for unlimited and unpaid types
  if ((UNLIMITED_LEAVE_TYPES as readonly string[]).includes(leaveType)) return empty;
  if ((NO_BALANCE_TRACK_TYPES as readonly string[]).includes(leaveType)) return empty;

  const enabled = await getBooleanRule(null, 'sandwich_rule_enabled', true);
  if (!enabled) return empty;

  // By the time we get here, startDayType/endDayType are already normalised at the
  // call site (singleDayType used for both sides on SINGLE leaves).
  const effectiveStartFull = startDayType === 'FULL';
  const effectiveEndFull   = endDayType === 'FULL';

  // Fetch holidays + DeclaredWFH in a wide window (14 days either side)
  const windowStart = new Date(start); windowStart.setDate(windowStart.getDate() - 14);
  const windowEnd   = new Date(end);   windowEnd.setDate(windowEnd.getDate() + 14);

  const [holidays, wfhDays] = await Promise.all([
    prisma.holiday.findMany({ where: { date: { gte: windowStart, lte: windowEnd } }, select: { date: true } }),
    prisma.declaredWFH.findMany({ where: { date: { gte: windowStart, lte: windowEnd } }, select: { date: true } }),
  ]);
  const holidaySet = new Set(holidays.map(h => h.date.toISOString().split('T')[0]));
  const wfhSet     = new Set(wfhDays.map(w => w.date.toISOString().split('T')[0]));

  const isNonWorking = (d: Date): boolean => {
    const dow = d.getDay();
    const ds  = d.toISOString().split('T')[0];
    return dow === 0 || dow === 6 || holidaySet.has(ds) || wfhSet.has(ds);
  };

  // Fetch existing PENDING/APPROVED full-day leaves for this employee (excluding current dates)
  const existingLeaves = await prisma.leaveRequest.findMany({
    where: {
      employeeId,
      status: { in: ['PENDING', 'APPROVED'] },
    },
    select: { startDate: true, endDate: true, durationType: true, singleDayType: true, startDayType: true, endDayType: true },
  });

  // Build a set of dates that are "full day leave anchors" from existing requests
  const existingFullLeaveDates = new Set<string>();
  for (const lv of existingLeaves) {
    if (lv.durationType === 'SINGLE' && lv.singleDayType === 'FULL') {
      existingFullLeaveDates.add(lv.startDate.toISOString().split('T')[0]);
    } else if (lv.durationType === 'MULTIPLE') {
      if (lv.startDayType === 'FULL') existingFullLeaveDates.add(lv.startDate.toISOString().split('T')[0]);
      if (lv.endDayType === 'FULL')   existingFullLeaveDates.add(lv.endDate.toISOString().split('T')[0]);
    }
  }

  // Helper: walk through a block of contiguous non-working days starting from `from`,
  // moving in `direction` (+1 or -1). Returns the dates collected and the first
  // working day found at the end of the block.
  function walkNonWorkingBlock(from: Date, direction: 1 | -1): { block: string[]; anchorDay: string | null } {
    const block: string[] = [];
    const cur = new Date(from);
    cur.setDate(cur.getDate() + direction);
    while (isNonWorking(cur) && block.length < 30) {
      block.push(cur.toISOString().split('T')[0]);
      cur.setDate(cur.getDate() + direction);
    }
    const anchorDay = cur.toISOString().split('T')[0];
    return { block, anchorDay };
  }

  const sandwichSet = new Set<string>();

  // ── 1. Days WITHIN the leave range (only for MULTIPLE full-full leaves) ────
  if (durationType === 'MULTIPLE' && effectiveStartFull && effectiveEndFull) {
    const cur = new Date(start);
    cur.setDate(cur.getDate() + 1);
    while (cur < end) {
      if (isNonWorking(cur)) sandwichSet.add(cur.toISOString().split('T')[0]);
      cur.setDate(cur.getDate() + 1);
    }
  }

  // ── 2. Non-working block BEFORE start — check if there's a full leave anchor
  //       on the working day just before that block ────────────────────────────
  if (effectiveStartFull) {
    const { block, anchorDay } = walkNonWorkingBlock(start, -1);
    if (block.length > 0 && anchorDay && existingFullLeaveDates.has(anchorDay)) {
      block.forEach(d => sandwichSet.add(d));
    }
  }

  // ── 3. Non-working block AFTER end — check if there's a full leave anchor
  //       on the working day just after that block ─────────────────────────────
  if (effectiveEndFull) {
    const { block, anchorDay } = walkNonWorkingBlock(end, 1);
    if (block.length > 0 && anchorDay && existingFullLeaveDates.has(anchorDay)) {
      block.forEach(d => sandwichSet.add(d));
    }
  }

  const sandwichDates = Array.from(sandwichSet).sort();
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
        employee:  { select: { profile: { select: { firstName: true, lastName: true, employeeId: true } } } },
        appliedBy: { select: { profile: { select: { firstName: true, lastName: true } } } },
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
router.get('/pending', authorize(['ADMIN', 'MANAGER', 'OWNER']), async (req: AuthRequest, res: Response) => {
  const user = req.user!;
  try {
    const where =
      user.role === 'ADMIN' || user.role === 'OWNER'
        ? { status: 'PENDING' as const }
        : { status: 'PENDING' as const, managerId: user.id };
    const pending = await prisma.leaveRequest.findMany({
      where,
      include: {
        employee: {
          select: {
            email:   true,
            profile: { select: { firstName: true, lastName: true, employeeId: true, department: true } },
          },
        },
        appliedBy: { select: { profile: { select: { firstName: true, lastName: true } } } },
      },
      orderBy: { createdAt: 'asc' },
    });
    res.json(pending);
  } catch (err) {
    console.error('Pending leaves error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/leaves - Employee/Manager/Admin/Owner submits a leave application
router.post('/', authorize(['EMPLOYEE', 'MANAGER', 'ADMIN', 'OWNER']), async (req: AuthRequest, res: Response) => {
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
    reason, onBehalfOf,
  } = parsed.data;

  // Admin applying on behalf of another employee
  const targetUserId = (onBehalfOf && (req.user!.role === 'ADMIN' || req.user!.role === 'OWNER'))
    ? onBehalfOf
    : req.user!.id;

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
    // For SINGLE leaves singleDayType governs both sides; for MULTIPLE use start/endDayType
    const sandwichStartType = durationType === 'SINGLE' ? singleDayType : startDayType;
    const sandwichEndType   = durationType === 'SINGLE' ? singleDayType : endDayType;
    const sandwich = await checkSandwichRule(start, end, leaveType, durationType, sandwichStartType, sandwichEndType, targetUserId);
    if (sandwich.sandwichDays > 0) {
      totalDays += sandwich.sandwichDays;
    }

    // ── Document requirement check ────────────────────────────────────────
    let documentWarning = '';
    const policy = await prisma.leavePolicy.findUnique({ where: { leaveType } });

    // ── Employment type eligibility check ─────────────────────────────────
    if (policy?.allowedFor && policy.allowedFor !== 'ALL') {
      const profile = await prisma.profile.findUnique({ where: { userId: targetUserId }, select: { employmentType: true } });
      const empType = profile?.employmentType ?? 'FULL_TIME';
      if (policy.allowedFor !== empType) {
        res.status(400).json({ error: `${policy.label} is not available for ${empType === 'INTERN' ? 'interns' : 'full-time employees'}` });
        return;
      }
    }

    if (policy?.documentRequired && totalDays > (policy.documentAfterDays ?? 0)) {
      documentWarning = `Medical document required for ${leaveType} exceeding ${policy.documentAfterDays ?? 0} day(s).`;
    }

    // ── LWP cascade warning ───────────────────────────────────────────────
    let lwpWarning = '';
    let lwpDays = 0;
    const isUnlimited  = (UNLIMITED_LEAVE_TYPES  as readonly string[]).includes(leaveType);
    const isTrackOnly  = (NO_BALANCE_TRACK_TYPES as readonly string[]).includes(leaveType);
    // UL (unpaid leave) has no balance cap — skip the LWP cascade warning entirely
    if (!isUnlimited && !isTrackOnly) {
      const year = getFYYear(new Date(start));
      await getOrCreateBalances(targetUserId, year);
      const balance = await prisma.leaveBalance.findFirst({
        where: { userId: targetUserId, year, leaveType },
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
          employeeId: targetUserId,
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
      where:  { userId: targetUserId },
      select: { managerId: true },
    });

    const isOnBehalf = targetUserId !== req.user!.id;

    const leave = await prisma.leaveRequest.create({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: {
        employeeId:    targetUserId,
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
        ...(isOnBehalf ? { appliedById: req.user!.id } : {}),
      } as any,
    });

    // Notify the reporting manager and all HR Admins
    const emp = await prisma.profile.findUnique({
      where:  { userId: targetUserId },
      select: { firstName: true, lastName: true },
    });
    const empName = emp ? `${emp.firstName} ${emp.lastName}` : 'An employee';
    const daysStr = totalDays === 0.5 ? 'half day' : `${totalDays} day${totalDays !== 1 ? 's' : ''}`;
    const leaveLink = leaveType === 'TRAVELLING' ? '/travel-proof' : '/leaves';

    if (profile?.managerId) {
      await createNotification({
        userId:  profile.managerId,
        type:    'LEAVE_APPLIED',
        title:   'New Leave Request',
        message: `${empName} has applied for ${leaveType} leave (${daysStr}).`,
        link:    leaveLink,
      });
    }

    // Notify all Admins (excluding the employee themselves if they are an admin)
    const admins = await prisma.user.findMany({
      where: { role: { in: ['ADMIN', 'OWNER'] }, isActive: true, id: { notIn: [req.user!.id, targetUserId] } },
      select: { id: true },
    });
    // Exclude manager if already notified above to avoid duplicates
    const adminIds = admins
      .map((a) => a.id)
      .filter((id) => id !== profile?.managerId);
    if (adminIds.length > 0) {
      await createNotifications(
        adminIds.map((id) => ({
          userId:  id,
          type:    'LEAVE_APPLIED',
          title:   'New Leave Request',
          message: `${empName} has applied for ${leaveType} leave (${daysStr}).`,
          link:    leaveLink,
        }))
      );
    }

    // Notify the employee when HR applies leave on their behalf
    if (isOnBehalf) {
      await createNotification({
        userId:  targetUserId,
        type:    'LEAVE_APPLIED',
        title:   'Leave Applied on Your Behalf',
        message: `HR has applied ${leaveType} leave (${daysStr}) on your behalf. Reason: ${reason}`,
        link:    leaveLink,
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
  const { comment, convertToLeaveType } = req.body;

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
    if (leave.status !== 'PENDING' && leave.status !== 'REJECTED') {
      res.status(400).json({ error: `Cannot approve a leave that is ${leave.status}` });
      return;
    }

    // Payroll lock: block re-approve if that month's payroll is finalized
    if (leave.status === 'REJECTED') {
      const leaveMonth = new Date(leave.startDate).getMonth() + 1;
      const leaveYear  = new Date(leave.startDate).getFullYear();
      const finalizedRun = await prisma.payrollRun.findFirst({
        where: { month: leaveMonth, year: leaveYear, status: 'FINALIZED' },
      });
      if (finalizedRun) {
        res.status(400).json({ error: 'Cannot change leave status — payroll for this month is already finalized' });
        return;
      }
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

    // Check if this approval is via delegation (for audit trail)
    let approvedViaDelegate = false;
    if (req.user!.role === 'MANAGER') {
      approvedViaDelegate = await isDelegateForEmployee(req.user!.id, leave.employeeId);
      // Manager must be the assigned manager OR an authorised delegate
      if (leave.managerId !== req.user!.id && !approvedViaDelegate) {
        res.status(403).json({ error: 'You are not authorised to approve this leave request' });
        return;
      }
    }

    const year = getFYYear(new Date(leave.startDate));
    // If HR admin is converting the leave type atomically during approval, use the new type
    const effectiveLeaveType = convertToLeaveType ?? leave.leaveType;
    const isUnlimited  = (UNLIMITED_LEAVE_TYPES  as readonly string[]).includes(effectiveLeaveType);
    // UL = track-only: no balance cap, no LWP cascade, but still increment the used counter
    const isTrackOnly  = (NO_BALANCE_TRACK_TYPES as readonly string[]).includes(effectiveLeaveType);

    // Ensure balance row exists for types that have one
    if (!isUnlimited) await getOrCreateBalances(leave.employeeId, year);

    // ── LWP cascade: deduct only up to available balance ─────────────────
    // Skipped for UL — it has no balance quota, so there's nothing to cascade
    let lwpDays = 0;
    let deductDays = leave.totalDays;
    if (!isUnlimited && !isTrackOnly) {
      const balance = await prisma.leaveBalance.findFirst({
        where: { userId: leave.employeeId, year, leaveType: effectiveLeaveType },
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
          // If converting atomically, persist the new leave type in the same transaction
          ...(convertToLeaveType ? { leaveType: convertToLeaveType } : {}),
        },
      }),
    ];

    if (isTrackOnly) {
      // UL: no balance deduction, but increment the used counter so HR can see days taken
      approveOps.push(
        prisma.leaveBalance.updateMany({
          where: { userId: leave.employeeId, year, leaveType: effectiveLeaveType },
          data:  { used: { increment: leave.totalDays } },
        })
      );
    } else if (!isUnlimited && deductDays > 0) {
      // Regular paid leave: deduct from balance
      approveOps.push(
        prisma.leaveBalance.updateMany({
          where: { userId: leave.employeeId, year, leaveType: effectiveLeaveType },
          data:  { used: { increment: deductDays } },
        })
      );
    }
    const [updated] = await prisma.$transaction(approveOps);

    // ── Auto-create TravelProof records for TRAVELLING leaves ─────────────
    if (effectiveLeaveType === 'TRAVELLING') {
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
        message: `${lwpDays} day(s) of your ${effectiveLeaveType} leave will be marked as Loss of Pay (LWP) due to insufficient balance.`,
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
      newValues: { status: 'APPROVED', comment: comment || 'Approved', ...(approvedViaDelegate ? { approvedViaDelegate: true } : {}) },
      changeSource: 'WEB',
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
    if (leave.status !== 'PENDING' && leave.status !== 'APPROVED') {
      res.status(400).json({ error: `Cannot reject a leave that is ${leave.status}` });
      return;
    }

    // Payroll lock: block re-reject if that month's payroll is finalized
    if (leave.status === 'APPROVED') {
      const leaveMonth = new Date(leave.startDate).getMonth() + 1;
      const leaveYear  = new Date(leave.startDate).getFullYear();
      const finalizedRun = await prisma.payrollRun.findFirst({
        where: { month: leaveMonth, year: leaveYear, status: 'FINALIZED' },
      });
      if (finalizedRun) {
        res.status(400).json({ error: 'Cannot change leave status — payroll for this month is already finalized' });
        return;
      }
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

    // Manager must be the assigned manager OR an authorised delegate
    if (req.user!.role === 'MANAGER') {
      const isDelegate = await isDelegateForEmployee(req.user!.id, leave.employeeId);
      if (leave.managerId !== req.user!.id && !isDelegate) {
        res.status(403).json({ error: 'You are not authorised to reject this leave request' });
        return;
      }
    }

    // If re-rejecting an APPROVED leave, refund the balance
    const wasApproved = leave.status === 'APPROVED';
    const rejectOps: any[] = [
      prisma.leaveRequest.update({
        where: { id },
        data: {
          status:         'REJECTED',
          managerId:      req.user!.id,
          managerComment: comment || 'Rejected',
        },
      }),
    ];

    if (wasApproved) {
      const year = getFYYear(new Date(leave.startDate));
      const isUnlimited = (UNLIMITED_LEAVE_TYPES as readonly string[]).includes(leave.leaveType);
      const isTrackOnly = (NO_BALANCE_TRACK_TYPES as readonly string[]).includes(leave.leaveType);
      if (!isUnlimited) {
        // Refund the used balance (covers both regular and track-only types)
        rejectOps.push(
          prisma.leaveBalance.updateMany({
            where: { userId: leave.employeeId, year, leaveType: leave.leaveType },
            data:  { used: { decrement: leave.totalDays } },
          })
        );
      }
      // Clean up TravelProof records if it was TRAVELLING
      if (leave.leaveType === 'TRAVELLING') {
        rejectOps.push(
          prisma.travelProof.deleteMany({ where: { leaveRequestId: leave.id } })
        );
      }
    }
    const [updated] = await prisma.$transaction(rejectOps);

    // Notify the employee their leave was rejected
    await createNotification({
      userId:  leave.employeeId,
      type:    'LEAVE_REJECTED',
      title:   'Leave Rejected',
      message: `Your ${leave.leaveType} leave request (${leave.totalDays === 0.5 ? 'half day' : `${leave.totalDays} day${leave.totalDays !== 1 ? 's' : ''}`}) has been rejected.${comment ? ` Reason: ${comment}` : ''}`,
      link:    '/leaves',
    });

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
      oldValues: { status: leave.status },
      newValues: { status: 'REJECTED', comment: comment || 'Rejected', ...(wasApproved ? { balanceRefunded: true } : {}) },
      changeSource: 'WEB',
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

    // Notify manager if the cancelled leave was already approved
    if (leave.status === 'APPROVED' && leave.managerId) {
      const cancelledBy = await prisma.profile.findUnique({
        where: { userId: user.id },
        select: { firstName: true, lastName: true },
      });
      const name = cancelledBy ? `${cancelledBy.firstName} ${cancelledBy.lastName}` : 'An employee';
      const daysStr = leave.totalDays === 0.5 ? 'half day' : `${leave.totalDays} day${leave.totalDays !== 1 ? 's' : ''}`;
      await createNotification({
        userId:  leave.managerId,
        type:    'LEAVE_CANCELLED',
        title:   'Approved Leave Cancelled',
        message: `${name} has cancelled their approved ${leave.leaveType} leave (${daysStr}).`,
        link:    '/leaves',
      });
    }

    res.json({ message: 'Leave cancelled successfully' });
  } catch (err) {
    console.error('Cancel leave error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
