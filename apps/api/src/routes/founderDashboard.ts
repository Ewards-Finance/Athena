/**
 * Athena V3.1 - Founder MIS Dashboard Routes (OWNER only)
 *
 * GET /api/founder-dashboard/headcount     - Group + company-wise headcount
 * GET /api/founder-dashboard/payroll-cost  - Total + company-wise payroll cost
 * GET /api/founder-dashboard/attendance    - Late marks, exceptions, absentees
 * GET /api/founder-dashboard/leave-risk    - High leave consumers, LWP trend
 * GET /api/founder-dashboard/probation     - Probation ending soon, low-attendance
 * GET /api/founder-dashboard/asset-exit    - Unreturned assets, overdue settlements
 * GET /api/founder-dashboard/transfers     - Recent inter-company transfers
 */

import { Router, Response } from 'express';
import { AuthRequest, authenticate, authorize } from '../middleware/auth';
import { prisma } from '../lib/prisma';

const router = Router();

router.use(authenticate);
router.use(authorize(['OWNER']));

// ─── GET /headcount ─────────────────────────────────────────────────────────

router.get('/headcount', async (_req: AuthRequest, res: Response) => {
  try {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

    const [totalActive, byCompany, byDepartment, newJoins, exitsThisMonth, onNotice, onProbation] = await Promise.all([
      // Total active employees
      prisma.user.count({ where: { isActive: true, role: { in: ['EMPLOYEE', 'MANAGER'] } } }),

      // By company (active assignments)
      prisma.employeeCompanyAssignment.groupBy({
        by: ['companyId'],
        where: { status: 'ACTIVE' },
        _count: true,
      }),

      // By department
      prisma.profile.groupBy({
        by: ['department'],
        where: { user: { isActive: true }, department: { not: '' } },
        _count: true,
      }),

      // New joins this month
      prisma.profile.count({
        where: { dateOfJoining: { gte: startOfMonth, lte: endOfMonth } },
      }),

      // Exits settled this month
      prisma.exitRequest.count({
        where: { status: 'SETTLED', updatedAt: { gte: startOfMonth, lte: endOfMonth } },
      }),

      // On notice period
      prisma.user.count({
        where: { isActive: true, employmentStatus: 'NOTICE_PERIOD' },
      }),

      // On probation
      prisma.user.count({
        where: { isActive: true, employmentStatus: 'PROBATION' },
      }),
    ]);

    // Enrich company names
    const companies = await prisma.company.findMany({
      where: { id: { in: byCompany.map(c => c.companyId) } },
      select: { id: true, displayName: true, code: true },
    });
    const companyMap = Object.fromEntries(companies.map(c => [c.id, c]));

    res.json({
      totalActive,
      onProbation,
      onNotice,
      newJoinsThisMonth: newJoins,
      exitsThisMonth,
      byCompany: byCompany.map(c => ({
        companyId: c.companyId,
        companyName: companyMap[c.companyId]?.displayName ?? 'Unknown',
        companyCode: companyMap[c.companyId]?.code ?? '',
        count: c._count,
      })),
      byDepartment: byDepartment
        .map(d => ({ department: d.department, count: d._count }))
        .sort((a, b) => b.count - a.count),
    });
  } catch (err) {
    console.error('[founder-dashboard] headcount error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /payroll-cost ──────────────────────────────────────────────────────

router.get('/payroll-cost', async (_req: AuthRequest, res: Response) => {
  try {
    // Last 6 finalized payroll runs
    const runs = await prisma.payrollRun.findMany({
      where: { status: 'FINALIZED', runType: 'REGULAR' },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
      take: 6,
      include: {
        entries: { select: { grossPay: true, netPay: true, totalDeductions: true, arrearsAmount: true } },
        company: { select: { displayName: true, code: true } },
      },
    });

    const monthNames = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

    const trend = runs.map(run => {
      const totalGross = run.entries.reduce((s, e) => s + e.grossPay, 0);
      const totalNet = run.entries.reduce((s, e) => s + e.netPay, 0);
      const totalDeductions = run.entries.reduce((s, e) => s + e.totalDeductions, 0);
      const totalArrears = run.entries.reduce((s, e) => s + (e.arrearsAmount ?? 0), 0);
      return {
        month: run.month,
        year: run.year,
        label: `${monthNames[run.month]} ${run.year}`,
        companyName: run.company?.displayName ?? 'All',
        employees: run.entries.length,
        totalGross: Math.round(totalGross),
        totalNet: Math.round(totalNet),
        totalDeductions: Math.round(totalDeductions),
        totalArrears: Math.round(totalArrears),
      };
    });

    // Pending F&F settlements
    const pendingFF = await prisma.exitRequest.count({
      where: { status: { in: ['CLEARANCE_PENDING', 'NOTICE_PERIOD'] } },
    });

    // Outstanding loans
    const outstandingLoans = await prisma.loanRequest.aggregate({
      where: { status: { in: ['APPROVED', 'ACTIVE'] } },
      _sum: { amount: true },
      _count: true,
    });

    // Pending approved claims (not yet paid)
    const pendingClaims = await prisma.reimbursement.aggregate({
      where: { status: 'APPROVED' },
      _sum: { amount: true },
      _count: true,
    });

    res.json({
      trend: trend.reverse(), // oldest first for chart
      pendingFFCount: pendingFF,
      outstandingLoanAmount: outstandingLoans._sum.amount ?? 0,
      outstandingLoanCount: outstandingLoans._count,
      pendingClaimsAmount: pendingClaims._sum.amount ?? 0,
      pendingClaimsCount: pendingClaims._count,
    });
  } catch (err) {
    console.error('[founder-dashboard] payroll-cost error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /attendance ────────────────────────────────────────────────────────

router.get('/attendance', async (_req: AuthRequest, res: Response) => {
  try {
    const now = new Date();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();

    // Get current month's attendance import
    const attImport = await prisma.attendanceImport.findUnique({
      where: { month_year: { month, year } },
      select: { id: true },
    });

    let lateCount = 0;
    let totalRecords = 0;
    let topAbsentees: { userId: string; name: string; lwpDays: number }[] = [];

    if (attImport) {
      // Late marks
      const lateResult = await prisma.attendanceRecord.count({
        where: { importId: attImport.id, isLate: true },
      });
      lateCount = lateResult;

      totalRecords = await prisma.attendanceRecord.count({
        where: { importId: attImport.id },
      });

      // Top 5 employees by LWP deduction
      const topLwp = await prisma.attendanceRecord.groupBy({
        by: ['userId'],
        where: { importId: attImport.id, lwpDeduction: { gt: 0 } },
        _sum: { lwpDeduction: true },
        orderBy: { _sum: { lwpDeduction: 'desc' } },
        take: 5,
      });

      if (topLwp.length > 0) {
        const profiles = await prisma.profile.findMany({
          where: { userId: { in: topLwp.map(t => t.userId) } },
          select: { userId: true, firstName: true, lastName: true },
        });
        const profileMap = Object.fromEntries(profiles.map(p => [p.userId, p]));

        topAbsentees = topLwp.map(t => ({
          userId: t.userId,
          name: profileMap[t.userId] ? `${profileMap[t.userId].firstName} ${profileMap[t.userId].lastName}` : 'Unknown',
          lwpDays: t._sum.lwpDeduction ?? 0,
        }));
      }
    }

    // Unresolved exceptions (missing punch — no checkIn or no checkOut)
    const exceptionCount = attImport
      ? await prisma.attendanceRecord.count({
          where: {
            importId: attImport.id,
            OR: [{ checkIn: null }, { checkOut: null }],
          },
        }).catch(() => 0)
      : 0;

    res.json({
      month, year,
      lateMarkCount: lateCount,
      totalRecords,
      lateMarkRate: totalRecords > 0 ? Math.round((lateCount / totalRecords) * 100) : 0,
      exceptionCount,
      topAbsentees,
    });
  } catch (err) {
    console.error('[founder-dashboard] attendance error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /leave-risk ────────────────────────────────────────────────────────

router.get('/leave-risk', async (_req: AuthRequest, res: Response) => {
  try {
    const now = new Date();
    const currentYear = now.getFullYear();

    // Employees with >80% leave consumed
    const balances = await prisma.leaveBalance.findMany({
      where: { year: currentYear },
      include: {
        user: { select: { isActive: true, profile: { select: { firstName: true, lastName: true } } } },
      },
    });

    const highConsumers: { userId: string; name: string; leaveType: string; used: number; total: number; pct: number }[] = [];
    for (const b of balances) {
      if (!b.user.isActive || b.total === 0) continue;
      const pct = Math.round((b.used / b.total) * 100);
      if (pct >= 80) {
        highConsumers.push({
          userId: b.userId,
          name: b.user.profile ? `${b.user.profile.firstName} ${b.user.profile.lastName}` : 'Unknown',
          leaveType: b.leaveType,
          used: b.used,
          total: b.total,
          pct,
        });
      }
    }

    // LWP trend: last 6 months of LWP leave requests (approved)
    const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);
    const lwpLeaves = await prisma.leaveRequest.findMany({
      where: {
        leaveType: 'LWP',
        status: 'APPROVED',
        startDate: { gte: sixMonthsAgo },
      },
      select: { startDate: true, totalDays: true },
    });

    const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const lwpTrend: { label: string; days: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const m = d.getMonth();
      const y = d.getFullYear();
      const days = lwpLeaves
        .filter(l => new Date(l.startDate).getMonth() === m && new Date(l.startDate).getFullYear() === y)
        .reduce((s, l) => s + l.totalDays, 0);
      lwpTrend.push({ label: `${monthNames[m]} ${y}`, days: Math.round(days) });
    }

    res.json({
      highConsumers: highConsumers.sort((a, b) => b.pct - a.pct).slice(0, 20),
      lwpTrend,
    });
  } catch (err) {
    console.error('[founder-dashboard] leave-risk error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /probation ─────────────────────────────────────────────────────────

router.get('/probation', async (_req: AuthRequest, res: Response) => {
  try {
    const now = new Date();
    const thirtyDaysOut = new Date(now);
    thirtyDaysOut.setDate(thirtyDaysOut.getDate() + 30);

    // Default probation period (90 days)
    const probationDays = 90;

    // Current month for attendance check
    const currMonth = now.getMonth() + 1;
    const currYear  = now.getFullYear();
    const daysInMonth = new Date(currYear, currMonth, 0).getDate();
    const daysSoFar   = Math.min(now.getDate(), daysInMonth);

    // Employees on probation
    const probationers = await prisma.profile.findMany({
      where: {
        user: { isActive: true, employmentStatus: 'PROBATION' },
      },
      select: {
        userId: true, firstName: true, lastName: true,
        dateOfJoining: true, department: true, designation: true,
      },
    });

    const endingSoon: any[]   = [];
    const overdue: any[]      = [];
    const lowAttendance: any[] = [];

    // Attendance records for probationers this month
    const probUserIds = probationers.map(p => p.userId);
    const attendanceRecords = probUserIds.length > 0
      ? await prisma.attendanceRecord.groupBy({
          by: ['userId'],
          where: {
            userId: { in: probUserIds },
            date: {
              gte: new Date(currYear, currMonth - 1, 1),
              lte: new Date(currYear, currMonth - 1, daysInMonth, 23, 59, 59),
            },
          },
          _count: { _all: true },
        })
      : [];
    const attendanceMap = new Map(attendanceRecords.map(r => [r.userId, r._count._all]));

    for (const p of probationers) {
      const probationEndDate = p.dateOfJoining
        ? new Date(new Date(p.dateOfJoining).getTime() + probationDays * 86400000)
        : null;

      const baseEntry = {
        userId: p.userId,
        name: `${p.firstName} ${p.lastName}`,
        department: p.department,
        designation: p.designation,
        dateOfJoining: p.dateOfJoining,
        probationEndDate,
      };

      // Ending in 30 days
      if (probationEndDate && probationEndDate <= thirtyDaysOut && probationEndDate >= now) {
        endingSoon.push(baseEntry);
      }

      // Overdue — probation should have ended but still in PROBATION status
      if (probationEndDate && probationEndDate < now) {
        overdue.push(baseEntry);
      }

      // Low attendance (<80% of days so far this month)
      const daysPresent = attendanceMap.get(p.userId) ?? 0;
      const attendancePct = daysSoFar > 0 ? Math.round((daysPresent / daysSoFar) * 100) : 100;
      if (attendancePct < 80 && daysSoFar >= 5) {
        lowAttendance.push({ ...baseEntry, attendancePct, daysPresent, daysSoFar });
      }
    }

    res.json({
      totalOnProbation: probationers.length,
      endingIn30Days:   endingSoon,
      overdue,
      lowAttendance,
    });
  } catch (err) {
    console.error('[founder-dashboard] probation error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /asset-exit ────────────────────────────────────────────────────────

router.get('/asset-exit', async (_req: AuthRequest, res: Response) => {
  try {
    const now = new Date();
    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    // Active exits (not yet settled)
    const activeExits = await prisma.exitRequest.findMany({
      where: { status: { in: ['INITIATED', 'NOTICE_PERIOD', 'CLEARANCE_PENDING'] } },
      include: {
        user: { select: { profile: { select: { firstName: true, lastName: true } } } },
        clearances: true,
      },
    });

    // Unreturned assets from exited employees
    const exitedUserIds = await prisma.exitRequest.findMany({
      where: { status: 'SETTLED' },
      select: { userId: true },
    });
    const unreturnedAssets = await prisma.assetAssignment.findMany({
      where: {
        userId: { in: exitedUserIds.map(e => e.userId) },
        returnedAt: null,
      },
      include: {
        asset: { select: { name: true, assetTag: true, category: true } },
        user: { select: { profile: { select: { firstName: true, lastName: true } } } },
      },
    });

    // Overdue clearances (pending > 7 days)
    const overdueClearances = activeExits.filter(ex => {
      const pending = ex.clearances.filter(c => c.status === 'PENDING');
      return pending.length > 0 && new Date(ex.createdAt) < sevenDaysAgo;
    });

    res.json({
      activeExitCount: activeExits.length,
      activeExits: activeExits.map(ex => ({
        id: ex.id,
        userId: ex.userId,
        name: ex.user.profile ? `${ex.user.profile.firstName} ${ex.user.profile.lastName}` : 'Unknown',
        status: ex.status,
        lastWorkingDate: ex.lastWorkingDate,
        pendingClearances: ex.clearances.filter(c => c.status === 'PENDING').map(c => c.department),
      })),
      unreturnedAssets: unreturnedAssets.map(a => ({
        assetName: a.asset.name,
        assetTag: a.asset.assetTag,
        category: a.asset.category,
        employeeName: a.user.profile ? `${a.user.profile.firstName} ${a.user.profile.lastName}` : 'Unknown',
        assignedAt: a.assignedAt,
      })),
      overdueClearanceCount: overdueClearances.length,
    });
  } catch (err) {
    console.error('[founder-dashboard] asset-exit error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /transfers ─────────────────────────────────────────────────────────

router.get('/transfers', async (_req: AuthRequest, res: Response) => {
  try {
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    // Recent transfers
    const recentTransfers = await prisma.employeeCompanyAssignment.findMany({
      where: { status: 'TRANSFERRED', updatedAt: { gte: ninetyDaysAgo } },
      include: {
        user: { select: { profile: { select: { firstName: true, lastName: true } } } },
        company: { select: { displayName: true, code: true } },
      },
      orderBy: { updatedAt: 'desc' },
      take: 20,
    });

    // Company-wise active headcount
    const companyHeadcount = await prisma.employeeCompanyAssignment.groupBy({
      by: ['companyId'],
      where: { status: 'ACTIVE' },
      _count: true,
    });
    const companies = await prisma.company.findMany({
      select: { id: true, displayName: true, code: true },
    });
    const companyMap = Object.fromEntries(companies.map(c => [c.id, c]));

    res.json({
      recentTransfers: recentTransfers.map(t => ({
        userId: t.userId,
        name: t.user.profile ? `${t.user.profile.firstName} ${t.user.profile.lastName}` : 'Unknown',
        fromCompany: companyMap[t.companyId]?.displayName ?? 'Unknown',
        designation: t.designation,
        transferDate: t.updatedAt,
        notes: t.notes,
      })),
      companyHeadcount: companyHeadcount.map(c => ({
        companyId: c.companyId,
        companyName: companyMap[c.companyId]?.displayName ?? 'Unknown',
        companyCode: companyMap[c.companyId]?.code ?? '',
        count: c._count,
      })),
    });
  } catch (err) {
    console.error('[founder-dashboard] transfers error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
