/**
 * Athena V2 - External Integrations API (Read-only)
 *
 * Authenticated via API key in the X-API-Key header.
 * All endpoints are read-only (GET only).
 *
 * GET /api/v1/employees             - active employees with profiles
 * GET /api/v1/attendance?month&year - attendance summary for a month
 * GET /api/v1/leaves?month&year     - leave records for a month
 * GET /api/v1/payroll?month&year    - payroll run summary for a month
 */

import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { prisma } from '../index';

const router = Router();

type ApiScope = 'employees:read' | 'attendance:read' | 'leaves:read' | 'payroll:read';
type ApiKeyRequest = Request & { apiKey?: { scopes: unknown } };

function hasScope(apiKey: { scopes: unknown }, scope: ApiScope) {
  return Array.isArray(apiKey.scopes) && apiKey.scopes.includes(scope);
}

function requireScope(scope: ApiScope) {
  return (req: Request, res: Response, next: NextFunction) => {
    const apiKey = (req as ApiKeyRequest).apiKey;
    if (!apiKey || !hasScope(apiKey, scope)) {
      res.status(403).json({ error: `API key is missing required scope: ${scope}` });
      return;
    }
    next();
  };
}

async function apiKeyAuth(req: Request, res: Response, next: NextFunction) {
  const rawKey = req.headers['x-api-key'] as string | undefined;
  if (!rawKey) {
    res.status(401).json({ error: 'Missing X-API-Key header' });
    return;
  }

  const prefix = rawKey.slice(0, 12);
  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');

  const apiKey = await prisma.apiKey.findFirst({
    where: { prefix, keyHash, isActive: true },
  });

  if (!apiKey) {
    res.status(401).json({ error: 'Invalid or revoked API key' });
    return;
  }

  if (apiKey.expiresAt && apiKey.expiresAt.getTime() <= Date.now()) {
    res.status(401).json({ error: 'API key has expired' });
    return;
  }

  prisma.apiKey.update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
  (req as ApiKeyRequest).apiKey = apiKey;

  next();
}

router.use(apiKeyAuth);

router.get('/employees', requireScope('employees:read'), async (_req: Request, res: Response) => {
  try {
    const employees = await prisma.user.findMany({
      where: { isActive: true },
      select: {
        id: true,
        email: true,
        role: true,
        employmentStatus: true,
        profile: {
          select: {
            firstName: true,
            lastName: true,
            employeeId: true,
            designation: true,
            department: true,
            officeLocation: true,
            dateOfJoining: true,
            employmentType: true,
            managerId: true,
          },
        },
      },
      orderBy: { profile: { employeeId: 'asc' } },
    });
    res.json(employees);
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/attendance', requireScope('attendance:read'), async (req: Request, res: Response) => {
  const month = Number(req.query.month);
  const year = Number(req.query.year);
  if (!month || !year || month < 1 || month > 12) {
    res.status(400).json({ error: 'month (1-12) and year are required' });
    return;
  }

  try {
    const monthStart = new Date(year, month - 1, 1);
    const monthEnd = new Date(year, month, 0, 23, 59, 59);

    const records = await prisma.attendanceRecord.findMany({
      where: { date: { gte: monthStart, lte: monthEnd } },
      select: {
        userId: true,
        date: true,
        checkIn: true,
        checkOut: true,
        hoursWorked: true,
        isLate: true,
        lwpDeduction: true,
        user: {
          select: {
            profile: { select: { firstName: true, lastName: true, employeeId: true, department: true } },
          },
        },
      },
      orderBy: [{ userId: 'asc' }, { date: 'asc' }],
    });
    res.json(records);
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/leaves', requireScope('leaves:read'), async (req: Request, res: Response) => {
  const month = Number(req.query.month);
  const year = Number(req.query.year);
  if (!month || !year || month < 1 || month > 12) {
    res.status(400).json({ error: 'month (1-12) and year are required' });
    return;
  }

  try {
    const monthStart = new Date(year, month - 1, 1);
    const monthEnd = new Date(year, month, 0, 23, 59, 59);

    const leaves = await prisma.leaveRequest.findMany({
      where: {
        status: 'APPROVED',
        startDate: { lte: monthEnd },
        endDate: { gte: monthStart },
      },
      select: {
        id: true,
        leaveType: true,
        startDate: true,
        endDate: true,
        totalDays: true,
        status: true,
        employee: {
          select: {
            profile: { select: { firstName: true, lastName: true, employeeId: true, department: true } },
          },
        },
      },
      orderBy: { startDate: 'asc' },
    });
    res.json(leaves);
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/payroll', requireScope('payroll:read'), async (req: Request, res: Response) => {
  const month = Number(req.query.month);
  const year = Number(req.query.year);
  if (!month || !year || month < 1 || month > 12) {
    res.status(400).json({ error: 'month (1-12) and year are required' });
    return;
  }

  try {
    const run = await prisma.payrollRun.findUnique({
      where: { month_year: { month, year } },
      include: {
        entries: {
          select: {
            userId: true,
            monthlyCtc: true,
            workingDays: true,
            lwpDays: true,
            paidDays: true,
            grossPay: true,
            totalDeductions: true,
            netPay: true,
            reimbursements: true,
            user: {
              select: {
                profile: { select: { firstName: true, lastName: true, employeeId: true, department: true } },
              },
            },
          },
        },
      },
    });

    if (!run) {
      res.status(404).json({ error: `No payroll run found for ${month}/${year}` });
      return;
    }

    res.json({
      month: run.month,
      year: run.year,
      status: run.status,
      entries: run.entries,
    });
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
