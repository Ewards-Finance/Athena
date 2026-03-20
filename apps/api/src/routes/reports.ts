/**
 * Athena V2 - Reports Routes (Admin only)
 *
 * GET /api/reports/hr                          - headcount, dept distribution, status, tenure
 * GET /api/reports/attendance?month=&year=     - late/LWP/absence summary
 * GET /api/reports/payroll?month=&year=        - payroll cost by dept, TDS, net pay
 */

import { Router, Response }    from 'express';
import { prisma } from '../lib/prisma';
import { z }                   from 'zod';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';

const router = Router();

router.use(authenticate);
router.use(authorize(['ADMIN']));

function isoDay(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addUtcDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function getLeaveFractionForDate(leave: any, dateKey: string) {
  const startKey = isoDay(new Date(leave.startDate));
  const endKey = isoDay(new Date(leave.endDate));

  if (leave.durationType === 'SINGLE') {
    if (leave.singleDayType === 'FIRST_HALF' || leave.singleDayType === 'SECOND_HALF') {
      return 0.5;
    }
    return 1;
  }

  let fraction = 1;
  if (dateKey === startKey && leave.startDayType === 'FROM_SECOND_HALF') {
    fraction = 0.5;
  }
  if (dateKey === endKey && leave.endDayType === 'UNTIL_FIRST_HALF') {
    fraction = Math.min(fraction, 0.5);
  }
  return fraction;
}

// ─── HR Report ────────────────────────────────────────────────────────────────

router.get('/hr', async (_req, res: Response) => {
  try {
    const [allUsers, allProfiles] = await Promise.all([
      prisma.user.findMany({
        select: {
          id:               true,
          role:             true,
          isActive:         true,
          employmentStatus: true,
          createdAt:        true,
          profile: {
            select: {
              department:     true,
              employmentType: true,
              dateOfJoining:  true,
            },
          },
        },
      }),
      prisma.profile.findMany({ select: { department: true } }),
    ]);

    const active   = allUsers.filter((u) => u.isActive);
    const inactive = allUsers.filter((u) => !u.isActive);

    // Department distribution (active only)
    const deptMap = new Map<string, number>();
    for (const u of active) {
      const dept = u.profile?.department || 'Unassigned';
      deptMap.set(dept, (deptMap.get(dept) ?? 0) + 1);
    }
    const byDepartment = Array.from(deptMap.entries())
      .map(([dept, count]) => ({ dept, count }))
      .sort((a, b) => b.count - a.count);

    // Employment status distribution
    const statusMap = new Map<string, number>();
    for (const u of active) {
      const s = u.employmentStatus ?? 'UNKNOWN';
      statusMap.set(s, (statusMap.get(s) ?? 0) + 1);
    }
    const byStatus = Array.from(statusMap.entries()).map(([status, count]) => ({ status, count }));

    // Employment type distribution
    const typeMap = new Map<string, number>();
    for (const u of active) {
      const t = u.profile?.employmentType || 'FULL_TIME';
      typeMap.set(t, (typeMap.get(t) ?? 0) + 1);
    }
    const byType = Array.from(typeMap.entries()).map(([type, count]) => ({ type, count }));

    // Role distribution
    const roleMap = new Map<string, number>();
    for (const u of active) {
      roleMap.set(u.role, (roleMap.get(u.role) ?? 0) + 1);
    }
    const byRole = Array.from(roleMap.entries()).map(([role, count]) => ({ role, count }));

    // Recent joiners (last 90 days)
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 90);
    const recentJoiners = active.filter(
      (u) => u.profile?.dateOfJoining && new Date(u.profile.dateOfJoining) >= cutoff
    ).length;

    // Tenure buckets (based on dateOfJoining)
    const now = new Date();
    let tenure0to1 = 0, tenure1to2 = 0, tenure2to3 = 0, tenure3plus = 0, tenureUnknown = 0;
    for (const u of active) {
      if (!u.profile?.dateOfJoining) { tenureUnknown++; continue; }
      const years = (now.getTime() - new Date(u.profile.dateOfJoining).getTime()) / (365.25 * 24 * 3600 * 1000);
      if      (years < 1)  tenure0to1++;
      else if (years < 2)  tenure1to2++;
      else if (years < 3)  tenure2to3++;
      else                 tenure3plus++;
    }
    const tenureBuckets = [
      { label: '< 1 year',    count: tenure0to1  },
      { label: '1–2 years',   count: tenure1to2  },
      { label: '2–3 years',   count: tenure2to3  },
      { label: '3+ years',    count: tenure3plus },
      { label: 'No data',     count: tenureUnknown },
    ];

    res.json({
      totalActive:   active.length,
      totalInactive: inactive.length,
      recentJoiners,
      byDepartment,
      byStatus,
      byType,
      byRole,
      tenureBuckets,
    });
  } catch (err) {
    console.error('HR report error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Attendance Report ────────────────────────────────────────────────────────

router.get('/attendance', async (req: AuthRequest, res: Response) => {
  const parsed = z.object({
    month: z.coerce.number().int().min(1).max(12),
    year:  z.coerce.number().int().min(2020).max(2100),
  }).safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: 'Valid month and year query params are required' });
    return;
  }
  const { month, year } = parsed.data;
  const startOfMonth = new Date(Date.UTC(year, month - 1, 1));
  const endOfMonth   = new Date(Date.UTC(year, month, 0, 23, 59, 59));

  try {
    const [records, absences, leaves, activeUsers] = await Promise.all([
      prisma.attendanceRecord.findMany({
        where: { date: { gte: startOfMonth, lte: endOfMonth } },
        include: {
          user: { select: { profile: { select: { firstName: true, lastName: true, employeeId: true, department: true } } } },
        },
      }),
      prisma.absenceRecord.findMany({
        where: { date: { gte: startOfMonth, lte: endOfMonth } },
        include: {
          user: { select: { profile: { select: { firstName: true, lastName: true, employeeId: true, department: true } } } },
        },
      }),
      prisma.leaveRequest.findMany({
        where: {
          status:    'APPROVED',
          startDate: { lte: endOfMonth },
          endDate:   { gte: startOfMonth },
        },
        select: {
          employeeId: true,
          startDate: true,
          endDate: true,
          durationType: true,
          singleDayType: true,
          startDayType: true,
          endDayType: true,
        },
      }),
      prisma.user.findMany({
        where:  { isActive: true },
        select: { id: true, profile: { select: { firstName: true, lastName: true, employeeId: true, department: true } } },
      }),
    ]);

    // Per-employee aggregation
    const empMap = new Map<string, {
      name: string; employeeId: string; department: string;
      presentDays: number; lateDays: number; lwpDays: number; absenceDays: number; leaveDays: number;
    }>();

    for (const u of activeUsers) {
      empMap.set(u.id, {
        name:        `${u.profile?.firstName ?? ''} ${u.profile?.lastName ?? ''}`.trim(),
        employeeId:  u.profile?.employeeId ?? '',
        department:  u.profile?.department ?? 'Unassigned',
        presentDays: 0, lateDays: 0, lwpDays: 0, absenceDays: 0, leaveDays: 0,
      });
    }

    for (const r of records) {
      const e = empMap.get(r.userId);
      if (!e) continue;
      e.presentDays++;
      if (r.isLate)       e.lateDays++;
      if (r.lwpDeduction) e.lwpDays += r.lwpDeduction;
    }

    for (const a of absences) {
      const e = empMap.get(a.userId);
      if (e) e.absenceDays++;
    }

    const leaveDaysByEmployee = new Map<string, Map<string, number>>();
    for (const leave of leaves) {
      let cursor = new Date(Math.max(new Date(leave.startDate).getTime(), startOfMonth.getTime()));
      const overlapEnd = new Date(Math.min(new Date(leave.endDate).getTime(), endOfMonth.getTime()));
      cursor.setUTCHours(0, 0, 0, 0);
      overlapEnd.setUTCHours(0, 0, 0, 0);

      while (cursor.getTime() <= overlapEnd.getTime()) {
        const dayKey = isoDay(cursor);
        const fraction = getLeaveFractionForDate(leave, dayKey);
        if (!leaveDaysByEmployee.has(leave.employeeId)) {
          leaveDaysByEmployee.set(leave.employeeId, new Map<string, number>());
        }
        const dayMap = leaveDaysByEmployee.get(leave.employeeId)!;
        dayMap.set(dayKey, Math.min(1, (dayMap.get(dayKey) ?? 0) + fraction));
        cursor = addUtcDays(cursor, 1);
      }
    }

    for (const [employeeId, dayMap] of leaveDaysByEmployee.entries()) {
      const employee = empMap.get(employeeId);
      if (!employee) continue;
      employee.leaveDays = Array.from(dayMap.values()).reduce((sum, value) => sum + value, 0);
    }

    // Department summary
    const deptAtt = new Map<string, { dept: string; totalLate: number; totalLwp: number; totalAbsent: number }>();
    for (const e of empMap.values()) {
      if (!deptAtt.has(e.department)) {
        deptAtt.set(e.department, { dept: e.department, totalLate: 0, totalLwp: 0, totalAbsent: 0 });
      }
      const d = deptAtt.get(e.department)!;
      d.totalLate   += e.lateDays;
      d.totalLwp    += e.lwpDays;
      d.totalAbsent += e.absenceDays;
    }

    const employees  = Array.from(empMap.values()).sort((a, b) => a.employeeId.localeCompare(b.employeeId));
    const deptSummary = Array.from(deptAtt.values()).sort((a, b) => a.dept.localeCompare(b.dept));

    res.json({
      month, year,
      totalPresent:  records.length,
      totalAbsences: absences.length,
      totalLateCount: records.filter((r) => r.isLate).length,
      employees,
      deptSummary,
    });
  } catch (err) {
    console.error('Attendance report error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Payroll Report ───────────────────────────────────────────────────────────

router.get('/payroll', async (req: AuthRequest, res: Response) => {
  const parsed = z.object({
    month: z.coerce.number().int().min(1).max(12),
    year:  z.coerce.number().int().min(2020).max(2100),
  }).safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: 'Valid month and year query params are required' });
    return;
  }
  const { month, year } = parsed.data;

  try {
    const run = await prisma.payrollRun.findFirst({
      where:   { month, year },
      include: {
        entries: {
          include: {
            user: { select: { profile: { select: { firstName: true, lastName: true, employeeId: true, department: true } } } },
          },
        },
      },
    });

    if (!run) {
      res.json({ month, year, status: 'NO_PAYROLL', entries: [], deptSummary: [], totals: null });
      return;
    }

    const entries = run.entries.map((e) => ({
      name:           `${e.user.profile?.firstName ?? ''} ${e.user.profile?.lastName ?? ''}`.trim(),
      employeeId:     e.user.profile?.employeeId ?? '',
      department:     e.user.profile?.department ?? 'Unassigned',
      monthlyCtc:     e.monthlyCtc,
      grossPay:       e.grossPay,
      totalDeductions: e.totalDeductions,
      netPay:         e.netPay,
      lwpDays:        e.lwpDays,
      reimbursements: e.reimbursements,
      tds:            (() => {
        const d = e.deductions as any[];
        if (!Array.isArray(d)) return 0;
        const tdsEntry = d.find((x: any) => x.calcType === 'AUTO_TDS');
        return tdsEntry?.amount ?? 0;
      })(),
    }));

    // Department totals
    const deptMap = new Map<string, { dept: string; headcount: number; totalGross: number; totalNet: number; totalTds: number }>();
    for (const e of entries) {
      if (!deptMap.has(e.department)) {
        deptMap.set(e.department, { dept: e.department, headcount: 0, totalGross: 0, totalNet: 0, totalTds: 0 });
      }
      const d = deptMap.get(e.department)!;
      d.headcount++;
      d.totalGross += e.grossPay;
      d.totalNet   += e.netPay;
      d.totalTds   += e.tds;
    }

    const totals = {
      headcount:      entries.length,
      totalGross:     entries.reduce((s, e) => s + e.grossPay, 0),
      totalDeductions: entries.reduce((s, e) => s + e.totalDeductions, 0),
      totalNet:       entries.reduce((s, e) => s + e.netPay, 0),
      totalTds:       entries.reduce((s, e) => s + e.tds, 0),
      totalReimbursements: entries.reduce((s, e) => s + e.reimbursements, 0),
    };

    res.json({
      month, year,
      status:      run.status,
      entries,
      deptSummary: Array.from(deptMap.values()).sort((a, b) => a.dept.localeCompare(b.dept)),
      totals,
    });
  } catch (err) {
    console.error('Payroll report error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Statutory Export (TDS / PT) ─────────────────────────────────────────────

router.get('/statutory', async (req: AuthRequest, res: Response) => {
  const parsed = z.object({
    month:     z.coerce.number().int().min(1).max(12),
    year:      z.coerce.number().int().min(2020).max(2100),
    type:      z.enum(['TDS', 'PT']),
    companyId: z.string().optional(),
  }).safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: 'month, year, and type (TDS|PT) required' });
    return;
  }
  const { month, year, type, companyId } = parsed.data;

  try {
    const where: any = { month, year };
    if (companyId) where.companyId = companyId;

    const run = await prisma.payrollRun.findFirst({
      where,
      include: {
        entries: {
          include: {
            user: {
              select: {
                profile: {
                  select: { firstName: true, lastName: true, employeeId: true, pan: true },
                },
              },
            },
          },
        },
      },
    });

    if (!run) {
      res.status(404).json({ error: 'No payroll run found for the given period' });
      return;
    }

    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(`${type} Report`);

    if (type === 'TDS') {
      ws.columns = [
        { header: 'Employee ID', key: 'employeeId', width: 15 },
        { header: 'Name', key: 'name', width: 25 },
        { header: 'PAN', key: 'pan', width: 15 },
        { header: 'Gross Salary', key: 'gross', width: 15 },
        { header: 'TDS Deducted', key: 'tds', width: 15 },
      ];

      for (const entry of run.entries) {
        const deductions = entry.deductions as any[];
        const tdsEntry = Array.isArray(deductions)
          ? deductions.find((d: any) => d.calcType === 'AUTO_TDS')
          : null;

        ws.addRow({
          employeeId: entry.user.profile?.employeeId || '',
          name: `${entry.user.profile?.firstName || ''} ${entry.user.profile?.lastName || ''}`.trim(),
          pan: entry.user.profile?.pan || '',
          gross: entry.grossPay,
          tds: tdsEntry?.amount || 0,
        });
      }
    } else {
      // PT
      ws.columns = [
        { header: 'Employee ID', key: 'employeeId', width: 15 },
        { header: 'Name', key: 'name', width: 25 },
        { header: 'Gross Salary', key: 'gross', width: 15 },
        { header: 'PT Amount', key: 'pt', width: 15 },
        { header: 'State', key: 'state', width: 15 },
      ];

      for (const entry of run.entries) {
        const deductions = entry.deductions as any[];
        const ptEntry = Array.isArray(deductions)
          ? deductions.find((d: any) => d.calcType === 'AUTO_PT')
          : null;

        ws.addRow({
          employeeId: entry.user.profile?.employeeId || '',
          name: `${entry.user.profile?.firstName || ''} ${entry.user.profile?.lastName || ''}`.trim(),
          gross: entry.grossPay,
          pt: ptEntry?.amount || 0,
          state: 'West Bengal',
        });
      }
    }

    // Style header row
    ws.getRow(1).font = { bold: true };

    const MONTH_NAMES = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const fileName = `${type}_Report_${MONTH_NAMES[month]}_${year}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('Statutory export error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
