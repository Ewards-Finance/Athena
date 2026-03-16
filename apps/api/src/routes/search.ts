/**
 * Athena V2 - Advanced Search
 *
 * Role-scoped search across employees, leaves, claims, and documents.
 * Admin sees all. Managers see own + team where applicable; documents remain self-only.
 * Employees see own only.
 *
 * GET /api/search/employees?q=&department=&status=&employmentType=&role=
 * GET /api/search/leaves?q=&status=&leaveType=&fromDate=&toDate=
 * GET /api/search/claims?q=&status=&category=
 * GET /api/search/documents?q=&category=
 */

import { Router, Response }  from 'express';
import { AuthRequest, authenticate } from '../middleware/auth';
import { PrismaClient }        from '@prisma/client';
const prisma = new PrismaClient();

const router = Router();
router.use(authenticate);

const PAGE_SIZE = 30;

function getManagerUserScope(userId: string) {
  return [{ id: userId }, { profile: { managerId: userId } }];
}

// ─── GET /api/search/employees ────────────────────────────────────────────────

router.get('/employees', async (req: AuthRequest, res: Response) => {
  const { q, department, status, employmentType, role } = req.query as Record<string, string>;
  const user = req.user!;

  // Only Admin/Manager can search employees
  if (user.role === 'EMPLOYEE') {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  try {
    const where: any = { isActive: true };

    if (user.role === 'MANAGER') {
      where.OR = getManagerUserScope(user.id);
    }

    // Role filter
    if (role) where.role = role;

    // Employment status filter
    if (status) where.employmentStatus = status;

    // Profile-level filters
    const profileWhere: any = {};
    if (department) profileWhere.department = { contains: department, mode: 'insensitive' };
    if (employmentType) profileWhere.employmentType = employmentType;

    if (q) {
      profileWhere.OR = [
        { firstName:  { contains: q, mode: 'insensitive' } },
        { lastName:   { contains: q, mode: 'insensitive' } },
        { employeeId: { contains: q, mode: 'insensitive' } },
        { designation:{ contains: q, mode: 'insensitive' } },
      ];
    }

    if (q) {
      const qClause = {
        OR: [
          { email:   { contains: q, mode: 'insensitive' } },
          { profile: profileWhere },
        ],
      };
      if (user.role === 'MANAGER') {
        where.AND = [{ OR: getManagerUserScope(user.id) }, qClause];
        delete where.OR;
      } else {
        where.OR = qClause.OR;
      }
    } else if (Object.keys(profileWhere).length > 0) {
      where.profile = profileWhere;
    }

    const employees = await prisma.user.findMany({
      where,
      select: {
        id:               true,
        email:            true,
        role:             true,
        employmentStatus: true,
        isActive:         true,
        profile: {
          select: {
            firstName:      true,
            lastName:       true,
            employeeId:     true,
            designation:    true,
            department:     true,
            employmentType: true,
            officeLocation: true,
            dateOfJoining:  true,
          },
        },
      },
      orderBy: { profile: { firstName: 'asc' } },
      take:    PAGE_SIZE,
    });

    res.json(employees);
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/search/leaves ───────────────────────────────────────────────────

router.get('/leaves', async (req: AuthRequest, res: Response) => {
  const { q, status, leaveType, fromDate, toDate } = req.query as Record<string, string>;
  const user = req.user!;

  try {
    const where: any = {};

    // Role scoping
    if (user.role === 'EMPLOYEE') {
      where.employeeId = user.id;
    } else if (user.role === 'MANAGER') {
      where.OR = [{ employeeId: user.id }, { managerId: user.id }];
    }

    if (status)    where.status    = status;
    if (leaveType) where.leaveType = leaveType;
    if (fromDate)  where.startDate = { gte: new Date(fromDate) };
    if (toDate) {
      where.endDate = { lte: new Date(toDate) };
    }

    if (q) {
      where.employee = {
        profile: {
          OR: [
            { firstName:  { contains: q, mode: 'insensitive' } },
            { lastName:   { contains: q, mode: 'insensitive' } },
            { employeeId: { contains: q, mode: 'insensitive' } },
          ],
        },
      };
    }

    const leaves = await prisma.leaveRequest.findMany({
      where,
      include: {
        employee: {
          select: {
            profile: { select: { firstName: true, lastName: true, employeeId: true, department: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take:    PAGE_SIZE,
    });

    res.json(leaves);
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/search/claims ───────────────────────────────────────────────────

router.get('/claims', async (req: AuthRequest, res: Response) => {
  const { q, status, category } = req.query as Record<string, string>;
  const user = req.user!;

  try {
    const where: any = {};

    if (user.role === 'EMPLOYEE') {
      where.employeeId = user.id;
    } else if (user.role === 'MANAGER') {
      where.OR = [
        { employeeId: user.id },
        { employee: { profile: { managerId: user.id } } },
      ];
    }

    if (status)   where.status   = status;
    if (category) where.category = category;

    if (q) {
      const qFilter = {
        employee: {
          profile: {
            OR: [
              { firstName:  { contains: q, mode: 'insensitive' } },
              { lastName:   { contains: q, mode: 'insensitive' } },
              { employeeId: { contains: q, mode: 'insensitive' } },
            ],
          },
        },
      };

      if (user.role === 'MANAGER') {
        where.AND = [{ OR: where.OR }, qFilter];
        delete where.OR;
      } else {
        Object.assign(where, qFilter);
      }
    }

    const claims = await prisma.reimbursement.findMany({
      where,
      include: {
        employee: {
          select: {
            profile: { select: { firstName: true, lastName: true, employeeId: true, department: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take:    PAGE_SIZE,
    });

    res.json(claims);
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/search/documents ────────────────────────────────────────────────

router.get('/documents', async (req: AuthRequest, res: Response) => {
  const { q, category } = req.query as Record<string, string>;
  const user = req.user!;

  try {
    const where: any = {};

    if (user.role === 'EMPLOYEE' || user.role === 'MANAGER') {
      where.userId = user.id;
    }

    if (category) where.category = category;
    if (q) {
      where.OR = [
        { name:        { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
        { user: { profile: { OR: [
          { firstName:  { contains: q, mode: 'insensitive' } },
          { lastName:   { contains: q, mode: 'insensitive' } },
          { employeeId: { contains: q, mode: 'insensitive' } },
        ]}}},
      ];
    }

    const docs = await prisma.employeeDocument.findMany({
      where,
      include: {
        user: {
          select: {
            profile: { select: { firstName: true, lastName: true, employeeId: true, department: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take:    PAGE_SIZE,
    });

    res.json(docs);
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
