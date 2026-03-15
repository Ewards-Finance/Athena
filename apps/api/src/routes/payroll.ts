/**
 * Athena V2 - Payroll Routes
 *
 * Payroll Components (Admin):
 *   GET    /api/payroll/components           - list all components
 *   POST   /api/payroll/components           - create component
 *   PUT    /api/payroll/components/:id       - update component
 *   DELETE /api/payroll/components/:id       - delete component
 *   PATCH  /api/payroll/components/reorder   - reorder components
 *
 * Employee CTC (Admin):
 *   GET    /api/payroll/employees-ctc        - list all employees with CTC
 *   PUT    /api/payroll/employees-ctc/:userId - set annual CTC
 *
 * Payroll Runs (Admin):
 *   GET    /api/payroll/runs                 - list runs
 *   POST   /api/payroll/runs                 - create run (generates DRAFT)
 *   GET    /api/payroll/runs/:id             - run + all entries
 *   PATCH  /api/payroll/runs/:id/entries/:entryId - update MANUAL values
 *   POST   /api/payroll/runs/:id/finalize    - lock run (FINALIZED)
 *   DELETE /api/payroll/runs/:id             - delete DRAFT run
 *   GET    /api/payroll/runs/:id/export      - download .xlsx
 *
 * Employee self-service:
 *   GET    /api/payroll/my-payslips          - own finalized payslips
 */

import { Router, Response }          from 'express';
import { PrismaClient }              from '@prisma/client';
import { z }                         from 'zod';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';
import { computePayslipEntry, countWorkingDays, ComponentSnapshot, SATURDAY_FREE_OFF, UNLIMITED_LEAVE_TYPES } from '../lib/payrollEngine';
import { generatePayrollExcel } from '../lib/excelExport';
import { sendPayslipReadyEmail } from '../lib/email';

const MONTH_NAMES = ['','January','February','March','April','May','June','July','August','September','October','November','December'];

const router = Router();
const prisma = new PrismaClient();

router.use(authenticate);

// ─── Helper ──────────────────────────────────────────────────────────────────
function r2(n: number) { return Math.round(n * 100) / 100; }

// ─── Payroll Components ───────────────────────────────────────────────────────

// GET /api/payroll/components
router.get('/components', async (_req: AuthRequest, res: Response) => {
  try {
    const components = await prisma.payrollComponent.findMany({
      orderBy: { order: 'asc' },
    });
    res.json(components);
  } catch (err) {
    console.error('List components error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

const componentSchema = z.object({
  name:     z.string().min(1).max(50),
  type:     z.enum(['EARNING', 'DEDUCTION']),
  calcType: z.enum(['PERCENTAGE_OF_CTC', 'FIXED', 'MANUAL', 'AUTO_PT', 'AUTO_TDS']),
  value:    z.number().min(0).default(0),
  order:    z.number().int().min(0).optional(),
});

// POST /api/payroll/components
router.post('/components', authorize(['ADMIN']), async (req: AuthRequest, res: Response) => {
  const parsed = componentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }
  try {
    // Auto-assign order if not provided
    const maxOrder = await prisma.payrollComponent.aggregate({ _max: { order: true } });
    const order = parsed.data.order ?? (maxOrder._max.order ?? 0) + 1;

    const component = await prisma.payrollComponent.create({
      data: { ...parsed.data, order },
    });
    res.status(201).json(component);
  } catch (err: any) {
    if (err?.code === 'P2002') {
      res.status(409).json({ error: 'A component with this name already exists' });
      return;
    }
    console.error('Create component error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/payroll/components/:id
router.put('/components/:id', authorize(['ADMIN']), async (req: AuthRequest, res: Response) => {
  const parsed = componentSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }
  try {
    const updated = await prisma.payrollComponent.update({
      where: { id: req.params.id },
      data:  parsed.data,
    });
    res.json(updated);
  } catch (err: any) {
    if (err?.code === 'P2025') {
      res.status(404).json({ error: 'Component not found' });
      return;
    }
    console.error('Update component error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/payroll/components/:id
router.delete('/components/:id', authorize(['ADMIN']), async (req: AuthRequest, res: Response) => {
  try {
    // Prevent deleting AUTO_PT (system component)
    const comp = await prisma.payrollComponent.findUnique({ where: { id: req.params.id } });
    if (!comp) { res.status(404).json({ error: 'Component not found' }); return; }
    if (comp.calcType === 'AUTO_PT') {
      res.status(400).json({ error: 'Cannot delete the Professional Tax component — it is system-managed' });
      return;
    }
    await prisma.payrollComponent.delete({ where: { id: req.params.id } });
    res.json({ message: 'Component deleted' });
  } catch (err) {
    console.error('Delete component error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/payroll/components/reorder
router.patch('/components/reorder', authorize(['ADMIN']), async (req: AuthRequest, res: Response) => {
  // Body: { order: [{ id, order }, …] }
  const schema = z.object({ order: z.array(z.object({ id: z.string(), order: z.number().int() })) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }
  try {
    await Promise.all(
      parsed.data.order.map(({ id, order }) =>
        prisma.payrollComponent.update({ where: { id }, data: { order } })
      )
    );
    res.json({ message: 'Reordered' });
  } catch (err) {
    console.error('Reorder error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Employee CTC ─────────────────────────────────────────────────────────────

// GET /api/payroll/employees-ctc
router.get('/employees-ctc', authorize(['ADMIN']), async (_req: AuthRequest, res: Response) => {
  try {
    const profiles = await prisma.profile.findMany({
      where: { user: { isActive: true } },
      select: {
        userId:      true,
        firstName:   true,
        lastName:    true,
        employeeId:  true,
        designation: true,
        department:  true,
        annualCtc:   true,
      },
      orderBy: { employeeId: 'asc' },
    });
    res.json(profiles);
  } catch (err) {
    console.error('List employees CTC error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/payroll/employees-ctc/:userId
router.put('/employees-ctc/:userId', authorize(['ADMIN']), async (req: AuthRequest, res: Response) => {
  const parsed = z.object({ annualCtc: z.number().min(0) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }
  try {
    const profile = await prisma.profile.update({
      where: { userId: req.params.userId },
      data:  { annualCtc: parsed.data.annualCtc },
    });
    res.json(profile);
  } catch (err: any) {
    if (err?.code === 'P2025') {
      res.status(404).json({ error: 'Employee profile not found' });
      return;
    }
    console.error('Update CTC error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Payroll Runs ─────────────────────────────────────────────────────────────

// GET /api/payroll/runs
router.get('/runs', authorize(['ADMIN']), async (_req: AuthRequest, res: Response) => {
  try {
    const runs = await prisma.payrollRun.findMany({
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
      include: { _count: { select: { entries: true } } },
    });
    res.json(runs);
  } catch (err) {
    console.error('List runs error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/payroll/runs — create a DRAFT payroll run for a given month/year
router.post('/runs', authorize(['ADMIN']), async (req: AuthRequest, res: Response) => {
  const parsed = z.object({
    month: z.number().int().min(1).max(12),
    year:  z.number().int().min(2020).max(2100),
  }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }

  const { month, year } = parsed.data;

  try {
    // Check for duplicate run
    const existing = await prisma.payrollRun.findUnique({ where: { month_year: { month, year } } });
    if (existing) {
      res.status(409).json({ error: `Payroll run for ${month}/${year} already exists (${existing.status})` });
      return;
    }

    // Fetch components
    const components = await prisma.payrollComponent.findMany({
      where:   { isActive: true },
      orderBy: { order: 'asc' },
    });
    if (components.length === 0) {
      res.status(400).json({ error: 'No active payroll components configured. Set them up in Payroll Settings first.' });
      return;
    }

    // Fetch holidays for this month/year (for working day calculation)
    const monthStart = new Date(year, month - 1, 1);
    const monthEnd   = new Date(year, month, 0, 23, 59, 59);
    const holidays   = await prisma.holiday.findMany({
      where: { date: { gte: monthStart, lte: monthEnd } },
    });
    const holidayDates = holidays.map((h) => new Date(h.date));
    const workingDays  = countWorkingDays(year, month, holidayDates);

    // Fetch all active employees with CTC
    const employees = await prisma.profile.findMany({
      where: { user: { isActive: true }, annualCtc: { gt: 0 } },
      select: {
        userId:         true,
        annualCtc:      true,
        firstName:      true,
        lastName:       true,
        employmentType: true,
      },
    });

    if (employees.length === 0) {
      res.status(400).json({ error: 'No active employees with Annual CTC set. Please configure CTC in Payroll Settings first.' });
      return;
    }

    // Compute reimbursements per employee for this month
    // Counts APPROVED claims submitted within the payroll month
    const claimsThisMonth = await prisma.reimbursement.findMany({
      where: {
        status:    'APPROVED',
        createdAt: { gte: monthStart, lte: monthEnd },
      },
      select: { employeeId: true, amount: true },
    });
    const reimbByUser: Record<string, number> = {};
    for (const c of claimsThisMonth) {
      reimbByUser[c.employeeId] = r2((reimbByUser[c.employeeId] ?? 0) + c.amount);
    }

    // Compute LWP days per employee (APPROVED leaves with leaveType = 'LWP' in this month)
    const lwpLeaves = await prisma.leaveRequest.findMany({
      where: {
        leaveType: 'LWP',
        status:    'APPROVED',
        startDate: { lte: monthEnd },
        endDate:   { gte: monthStart },
      },
      select: { employeeId: true, totalDays: true },
    });
    const lwpByUser: Record<string, number> = {};
    for (const l of lwpLeaves) {
      lwpByUser[l.employeeId] = (lwpByUser[l.employeeId] ?? 0) + l.totalDays;
    }

    // Add attendance-based late LWP deductions (0.5 days per late from the 4th onwards)
    const attImport = await prisma.attendanceImport.findUnique({
      where:  { month_year: { month, year } },
      select: { id: true },
    });
    if (attImport) {
      const attLwp = await prisma.attendanceRecord.groupBy({
        by:    ['userId'],
        where: { importId: attImport.id, lwpDeduction: { gt: 0 } },
        _sum:  { lwpDeduction: true },
      });
      for (const a of attLwp) {
        lwpByUser[a.userId] = (lwpByUser[a.userId] ?? 0) + (a._sum.lwpDeduction ?? 0);
      }
    }

    // ── Saturday working policy + declared WFH compliance ──────────────────
    // See payrollEngine.ts → SATURDAY POLICY comment for full explanation.
    //
    // A Saturday counts as "worked" if the employee has:
    //   (a) an APPROVED worklog on that date, OR
    //   (b) a fingerprint attendance record on that date (office Saturday)
    //
    // Penalty = max(0, required_worked_saturdays − actual_worked_saturdays)
    // required = total_saturdays − SATURDAY_FREE_OFF[employmentType]
    //   FULL_TIME free_off = 3  (2 off days + 1 office day, no worklog needed)
    //   INTERN    free_off = 2  (1 off day  + 1 office day, no worklog needed)

    // Collect all Saturdays in the month
    const saturdayDates: Date[] = [];
    {
      const d = new Date(Date.UTC(year, month - 1, 1));
      while (d.getUTCMonth() === month - 1) {
        if (d.getUTCDay() === 6) saturdayDates.push(new Date(d));
        d.setUTCDate(d.getUTCDate() + 1);
      }
    }

    // Declared WFH days (company-wide WFH mandate — worklog required for everyone)
    const declaredWFHDays = await (prisma as any).declaredWFH.findMany({
      where:  { date: { gte: monthStart, lte: monthEnd } },
      select: { date: true },
    });
    const declaredWFHDateStrings = new Set<string>(
      declaredWFHDays.map((d: any) => new Date(d.date).toISOString().slice(0, 10))
    );

    // Regular Saturdays (not covered by a declared WFH)
    const regularSaturdays = saturdayDates.filter(
      (s) => !declaredWFHDateStrings.has(s.toISOString().slice(0, 10))
    );

    // Approved worklogs this month (for all employees in run)
    const allWorklogs = await prisma.workLog.findMany({
      where:  {
        date:   { gte: monthStart, lte: monthEnd },
        status: 'APPROVED',
        userId: { in: employees.map((e) => e.userId) },
      },
      select: { userId: true, date: true },
    });
    const worklogDatesMap: Record<string, Set<string>> = {};
    for (const w of allWorklogs) {
      if (!worklogDatesMap[w.userId]) worklogDatesMap[w.userId] = new Set();
      worklogDatesMap[w.userId].add(new Date(w.date).toISOString().slice(0, 10));
    }

    // Fingerprint attendance records this month (office Saturday detection)
    const allAttRecords = await prisma.attendanceRecord.findMany({
      where:  {
        date:   { gte: monthStart, lte: monthEnd },
        userId: { in: employees.map((e) => e.userId) },
      },
      select: { userId: true, date: true },
    });
    const attendanceDatesMap: Record<string, Set<string>> = {};
    for (const a of allAttRecords) {
      if (!attendanceDatesMap[a.userId]) attendanceDatesMap[a.userId] = new Set();
      attendanceDatesMap[a.userId].add(new Date(a.date).toISOString().slice(0, 10));
    }

    // Per-employee Saturday + declared WFH penalty
    for (const emp of employees) {
      const worklogs    = worklogDatesMap[emp.userId]    ?? new Set<string>();
      const attendance  = attendanceDatesMap[emp.userId] ?? new Set<string>();
      const empType     = (emp.employmentType === 'INTERN' ? 'INTERN' : 'FULL_TIME') as 'FULL_TIME' | 'INTERN';
      const freeOff     = SATURDAY_FREE_OFF[empType];

      // A Saturday is "worked" if employee has a worklog OR a fingerprint record
      const workedRegularSats = regularSaturdays.filter((s) => {
        const ds = s.toISOString().slice(0, 10);
        return worklogs.has(ds) || attendance.has(ds);
      }).length;

      const requiredSats = Math.max(0, regularSaturdays.length - freeOff);
      const satPenalty   = Math.max(0, requiredSats - workedRegularSats);

      // Declared WFH penalty: worklog only (no fingerprint expected on WFH days)
      let declaredPenalty = 0;
      for (const dateStr of declaredWFHDateStrings) {
        if (!worklogs.has(dateStr)) declaredPenalty++;
      }

      const total = satPenalty + declaredPenalty;
      if (total > 0) lwpByUser[emp.userId] = (lwpByUser[emp.userId] ?? 0) + total;
    }
    // ── End Saturday / WFH penalty ─────────────────────────────────────────

    // ── Travelling: auto-present (reduce LWP by approved TRAVELLING days) ──
    // Employees on approved TRAVELLING leave are treated as present regardless
    // of fingerprint absence. Subtract their approved travelling days from LWP.
    const travellingLeaves = await prisma.leaveRequest.findMany({
      where: {
        leaveType: 'TRAVELLING',
        status:    'APPROVED',
        startDate: { lte: monthEnd },
        endDate:   { gte: monthStart },
      },
      select: { employeeId: true, totalDays: true },
    });
    for (const l of travellingLeaves) {
      const current = lwpByUser[l.employeeId] ?? 0;
      lwpByUser[l.employeeId] = Math.max(0, current - l.totalDays);
    }

    // ── Temporary WFH: 30% daily deduction ─────────────────────────────────
    // Employees on approved TEMPORARY_WFH are present (no LWP), but get a
    // 30% deduction on those days. Compute wfhDays per employee here and
    // pass to computePayslipEntry which applies the deduction.
    const wfhLeaves = await prisma.leaveRequest.findMany({
      where: {
        leaveType: 'TEMPORARY_WFH',
        status:    'APPROVED',
        startDate: { lte: monthEnd },
        endDate:   { gte: monthStart },
      },
      select: { employeeId: true, totalDays: true },
    });
    const wfhByUser: Record<string, number> = {};
    for (const l of wfhLeaves) {
      wfhByUser[l.employeeId] = (wfhByUser[l.employeeId] ?? 0) + l.totalDays;
    }

    // ── Attendance Adjustments (HR Admin manual override) ──────────────────
    // HR Admin can set a +/- adjustment per employee per month in the Attendance
    // page before running payroll. Positive = reduce LWP, Negative = add LWP.
    const adjustments = await prisma.attendanceAdjustment.findMany({
      where: { month, year },
    });
    for (const adj of adjustments) {
      const current = lwpByUser[adj.userId] ?? 0;
      lwpByUser[adj.userId] = Math.max(0, current - adj.adjustmentDays);
    }
    // ── End adjustments ────────────────────────────────────────────────────

    const compSnaps: ComponentSnapshot[] = components.map((c) => ({
      name:     c.name,
      type:     c.type as 'EARNING' | 'DEDUCTION',
      calcType: c.calcType as ComponentSnapshot['calcType'],
      value:    c.value,
      order:    c.order,
    }));

    // Create the run + all payslip entries in a transaction
    const run = await prisma.payrollRun.create({
      data: {
        month,
        year,
        status:      'DRAFT',
        processedBy: req.user!.id,
        entries: {
          create: employees.map((emp) => {
            const annualCtc      = emp.annualCtc ?? 0;
            const monthlyCtc    = r2(annualCtc / 12);
            const reimbursements = reimbByUser[emp.userId] ?? 0;
            const lwpDays  = Math.min(lwpByUser[emp.userId] ?? 0, workingDays);
            const wfhDays  = Math.min(wfhByUser[emp.userId] ?? 0, workingDays);
            const computed = computePayslipEntry({
              monthlyCtc, annualCtc, workingDays, lwpDays, wfhDays, components: compSnaps, reimbursements,
            });
            return {
              userId:         emp.userId,
              monthlyCtc:     computed.monthlyCtc,
              workingDays:    computed.workingDays,
              lwpDays:        computed.lwpDays,
              paidDays:       computed.paidDays,
              earnings:       computed.earnings as any,
              deductions:     computed.deductions as any,
              reimbursements: computed.reimbursements,
              grossPay:       computed.grossPay,
              totalDeductions:computed.totalDeductions,
              netPay:         computed.netPay,
            };
          }),
        },
      },
      include: {
        entries: {
          include: {
            user: { select: { profile: { select: { firstName: true, lastName: true, employeeId: true, designation: true, department: true } } } },
          },
        },
      },
    });

    res.status(201).json(run);
  } catch (err) {
    console.error('Create run error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/payroll/runs/:id
router.get('/runs/:id', authorize(['ADMIN']), async (req: AuthRequest, res: Response) => {
  try {
    const run = await prisma.payrollRun.findUnique({
      where:   { id: req.params.id },
      include: {
        entries: {
          include: {
            user: {
              select: {
                profile: {
                  select: { firstName: true, lastName: true, employeeId: true, designation: true, department: true, annualCtc: true },
                },
              },
            },
          },
          orderBy: { user: { profile: { employeeId: 'asc' } } },
        },
      },
    });
    if (!run) { res.status(404).json({ error: 'Payroll run not found' }); return; }

    // Also return current components so the frontend knows column structure
    const components = await prisma.payrollComponent.findMany({
      where:   { isActive: true },
      orderBy: { order: 'asc' },
    });

    res.json({ ...run, components });
  } catch (err) {
    console.error('Get run error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/payroll/runs/:id/entries/:entryId — update MANUAL component values
router.patch('/runs/:id/entries/:entryId', authorize(['ADMIN']), async (req: AuthRequest, res: Response) => {
  const schema = z.object({
    manualEarnings:   z.record(z.string(), z.number()).optional(),
    manualDeductions: z.record(z.string(), z.number()).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }

  try {
    const run = await prisma.payrollRun.findUnique({ where: { id: req.params.id } });
    if (!run)              { res.status(404).json({ error: 'Run not found' }); return; }
    if (run.status === 'FINALIZED') {
      res.status(400).json({ error: 'Cannot edit a finalized payroll run' });
      return;
    }

    const entry = await prisma.payslipEntry.findUnique({ where: { id: req.params.entryId } });
    if (!entry) { res.status(404).json({ error: 'Entry not found' }); return; }

    // Fetch actual annualCtc from profile for accurate TDS calculation
    const profile = await prisma.profile.findUnique({
      where:  { userId: entry.userId },
      select: { annualCtc: true },
    });
    const actualAnnualCtc = profile?.annualCtc ?? entry.monthlyCtc * 12;

    // Merge incoming manual values into existing earnings/deductions
    const existingEarnings   = entry.earnings   as Record<string, number>;
    const existingDeductions = entry.deductions  as Record<string, number>;
    const updatedEarnings    = { ...existingEarnings,   ...(parsed.data.manualEarnings ?? {}) };
    const updatedDeductions  = { ...existingDeductions, ...(parsed.data.manualDeductions ?? {}) };

    // Recompute totals
    const components = await prisma.payrollComponent.findMany({
      where:   { isActive: true },
      orderBy: { order: 'asc' },
    });
    const compSnaps: ComponentSnapshot[] = components.map((c) => ({
      name:     c.name,
      type:     c.type as 'EARNING' | 'DEDUCTION',
      calcType: c.calcType as ComponentSnapshot['calcType'],
      value:    c.value,
      order:    c.order,
    }));

    const recomputed = computePayslipEntry({
      monthlyCtc:         entry.monthlyCtc,
      annualCtc:          actualAnnualCtc,
      workingDays:        entry.workingDays,
      lwpDays:            entry.lwpDays,
      components:         compSnaps,
      reimbursements:     entry.reimbursements,
      existingEarnings:   updatedEarnings,
      existingDeductions: updatedDeductions,
    });

    const updated = await prisma.payslipEntry.update({
      where: { id: req.params.entryId },
      data:  {
        earnings:        recomputed.earnings as any,
        deductions:      recomputed.deductions as any,
        grossPay:        recomputed.grossPay,
        totalDeductions: recomputed.totalDeductions,
        netPay:          recomputed.netPay,
      },
    });

    res.json(updated);
  } catch (err) {
    console.error('Update entry error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/payroll/runs/:id/finalize
router.post('/runs/:id/finalize', authorize(['ADMIN']), async (req: AuthRequest, res: Response) => {
  try {
    const run = await prisma.payrollRun.findUnique({ where: { id: req.params.id } });
    if (!run)                    { res.status(404).json({ error: 'Run not found' }); return; }
    if (run.status === 'FINALIZED') { res.status(400).json({ error: 'Run is already finalized' }); return; }

    const updated = await prisma.payrollRun.update({
      where: { id: req.params.id },
      data:  { status: 'FINALIZED' },
    });

    // Send payslip ready emails (fire and forget — never block the response)
    prisma.payslipEntry.findMany({
      where:   { payrollRunId: run.id },
      include: { user: { select: { email: true, profile: { select: { firstName: true } } } } },
    }).then((entries) => {
      const monthName = MONTH_NAMES[run.month] ?? String(run.month);
      for (const entry of entries) {
        if (!entry.user.email) continue;
        sendPayslipReadyEmail({
          to:        entry.user.email,
          firstName: entry.user.profile?.firstName ?? 'Employee',
          month:     monthName,
          year:      run.year,
          netPay:    entry.netPay,
        }).catch(() => {});
      }
    }).catch(() => {});

    res.json(updated);
  } catch (err) {
    console.error('Finalize run error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/payroll/runs/:id/reopen — Admin reopens a FINALIZED run back to DRAFT
router.post('/runs/:id/reopen', authorize(['ADMIN']), async (req: AuthRequest, res: Response) => {
  try {
    const run = await prisma.payrollRun.findUnique({ where: { id: req.params.id } });
    if (!run)                       { res.status(404).json({ error: 'Run not found' }); return; }
    if (run.status !== 'FINALIZED') { res.status(400).json({ error: 'Only finalized runs can be reopened' }); return; }

    const updated = await prisma.payrollRun.update({
      where: { id: req.params.id },
      data:  { status: 'DRAFT' },
    });

    // Audit log
    await prisma.auditLog.create({
      data: {
        actorId:  req.user!.id,
        action:   'PAYROLL_REOPENED',
        entity:   'PayrollRun',
        entityId: run.id,
        oldValues: { status: 'FINALIZED' },
        newValues: { status: 'DRAFT', month: run.month, year: run.year },
      },
    });

    res.json(updated);
  } catch (err) {
    console.error('Reopen payroll run error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/payroll/runs/:id — only DRAFT runs
router.delete('/runs/:id', authorize(['ADMIN']), async (req: AuthRequest, res: Response) => {
  try {
    const run = await prisma.payrollRun.findUnique({ where: { id: req.params.id } });
    if (!run)                    { res.status(404).json({ error: 'Run not found' }); return; }
    if (run.status === 'FINALIZED') {
      res.status(400).json({ error: 'Cannot delete a finalized payroll run. Contact system administrator.' });
      return;
    }
    await prisma.payrollRun.delete({ where: { id: req.params.id } });
    res.json({ message: 'Draft run deleted' });
  } catch (err) {
    console.error('Delete run error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/payroll/runs/:id/export — generate and stream .xlsx
router.get('/runs/:id/export', authorize(['ADMIN']), async (req: AuthRequest, res: Response) => {
  try {
    const run = await prisma.payrollRun.findUnique({
      where:   { id: req.params.id },
      include: {
        entries: {
          include: {
            user: {
              select: {
                profile: {
                  select: {
                    firstName: true, lastName: true, employeeId: true,
                    designation: true, department: true,
                  },
                },
              },
            },
          },
          orderBy: { user: { profile: { employeeId: 'asc' } } },
        },
      },
    });
    if (!run) { res.status(404).json({ error: 'Payroll run not found' }); return; }

    // Fetch active components for column headers
    const components = await prisma.payrollComponent.findMany({
      where:   { isActive: true },
      orderBy: { order: 'asc' },
    });

    const earningCols   = components.filter((c) => c.type === 'EARNING').map((c) => c.name);
    const deductionCols = components.filter((c) => c.type === 'DEDUCTION').map((c) => c.name);

    // Build reimbursement detail rows
    const monthStart = new Date(run.year, run.month - 1, 1);
    const monthEnd   = new Date(run.year, run.month, 0, 23, 59, 59);
    const claims = await prisma.reimbursement.findMany({
      where: {
        status:    'APPROVED',
        createdAt: { gte: monthStart, lte: monthEnd },
        employeeId: { in: run.entries.map((e) => e.userId) },
      },
      include: {
        employee: {
          select: { profile: { select: { firstName: true, lastName: true, employeeId: true } } },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    const exportBuffer = await generatePayrollExcel({
      month: run.month,
      year:  run.year,
      earningColumns:   earningCols,
      deductionColumns: deductionCols,
      entries: run.entries.map((e) => ({
        employeeId:     e.user.profile?.employeeId ?? '',
        name:           `${e.user.profile?.firstName ?? ''} ${e.user.profile?.lastName ?? ''}`.trim(),
        department:     e.user.profile?.department ?? '',
        designation:    e.user.profile?.designation ?? '',
        monthlyCtc:     e.monthlyCtc,
        workingDays:    e.workingDays,
        lwpDays:        e.lwpDays,
        paidDays:       e.paidDays,
        earnings:       e.earnings as Record<string, number>,
        deductions:     e.deductions as Record<string, number>,
        reimbursements: e.reimbursements,
        grossPay:       e.grossPay,
        totalDeductions:e.totalDeductions,
        netPay:         e.netPay,
      })),
      reimbDetails: claims.map((c) => ({
        employeeId:   c.employee.profile?.employeeId ?? '',
        employeeName: `${c.employee.profile?.firstName ?? ''} ${c.employee.profile?.lastName ?? ''}`.trim(),
        category:     c.category,
        amount:       c.amount,
        description:  c.description,
        submittedOn:  c.createdAt.toLocaleDateString('en-IN'),
      })),
    });

    const MONTH_NAMES = [
      '', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
    ];
    const filename = `payroll-${MONTH_NAMES[run.month]}-${run.year}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(Buffer.from(exportBuffer as ArrayBuffer));
  } catch (err) {
    console.error('Export run error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Employee Self-Service ────────────────────────────────────────────────────

// GET /api/payroll/my-payslips
router.get('/my-payslips', async (req: AuthRequest, res: Response) => {
  try {
    const entries = await prisma.payslipEntry.findMany({
      where: {
        userId:      req.user!.id,
        payrollRun:  { status: 'FINALIZED' },
      },
      include: { payrollRun: { select: { month: true, year: true, status: true } } },
      orderBy: [
        { payrollRun: { year:  'desc' } },
        { payrollRun: { month: 'desc' } },
      ],
    });
    res.json(entries);
  } catch (err) {
    console.error('My payslips error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
