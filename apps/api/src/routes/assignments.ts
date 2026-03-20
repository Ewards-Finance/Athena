/**
 * Athena V3.1 - Employee Company Assignment Routes
 *
 * Manages employee-to-company assignments and inter-company transfers.
 * One employee can only have ONE ACTIVE assignment at a time.
 */

import { Router, Response } from 'express';
import { AuthRequest, authenticate, authorize } from '../middleware/auth';
import { prisma } from '../lib/prisma';

const router = Router();
router.use(authenticate);

// GET /api/assignments — list all assignments
// ADMIN/OWNER: all assignments; EMPLOYEE: own only
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!;
    const { companyId, status } = req.query;

    const where: any = {};
    if (user.role === 'EMPLOYEE') {
      where.userId = user.id;
    }
    if (companyId) where.companyId = companyId;
    if (status) where.status = status;

    const assignments = await prisma.employeeCompanyAssignment.findMany({
      where,
      include: {
        company: { select: { id: true, code: true, displayName: true } },
        user: {
          select: {
            id: true,
            email: true,
            profile: { select: { firstName: true, lastName: true, employeeId: true } },
          },
        },
      },
      orderBy: { effectiveFrom: 'desc' },
    });

    res.json(assignments);
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/assignments/:userId — assignment history for one employee
router.get('/:userId', async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!;
    const targetUserId = req.params.userId;

    // Employees can only see their own
    if (user.role === 'EMPLOYEE' && user.id !== targetUserId) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const assignments = await prisma.employeeCompanyAssignment.findMany({
      where: { userId: targetUserId },
      include: {
        company: { select: { id: true, code: true, displayName: true, legalName: true } },
        reportingManager: {
          select: {
            id: true,
            profile: { select: { firstName: true, lastName: true } },
          },
        },
      },
      orderBy: { effectiveFrom: 'desc' },
    });

    // Also get the employee's basic info
    const employee = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: {
        id: true,
        email: true,
        role: true,
        profile: {
          select: {
            firstName: true, lastName: true, employeeId: true,
            designation: true, department: true,
          },
        },
      },
    });

    if (!employee) {
      res.status(404).json({ error: 'Employee not found' });
      return;
    }

    res.json({ employee, assignments });
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/assignments/:userId — create first assignment
router.post('/:userId', authorize(['OWNER', 'ADMIN']), async (req: AuthRequest, res: Response) => {
  try {
    const targetUserId = req.params.userId;
    const {
      companyId, employeeCode, designation, department,
      reportingManagerId, annualCTC, employmentType, joiningDate,
      effectiveFrom, notes,
    } = req.body;

    if (!companyId || !effectiveFrom) {
      res.status(400).json({ error: 'companyId and effectiveFrom are required' });
      return;
    }

    // Check employee exists
    const employee = await prisma.user.findUnique({ where: { id: targetUserId } });
    if (!employee) {
      res.status(404).json({ error: 'Employee not found' });
      return;
    }

    // Check company exists
    const company = await prisma.company.findUnique({ where: { id: companyId } });
    if (!company) {
      res.status(404).json({ error: 'Company not found' });
      return;
    }

    // Check no active assignment already exists
    const existing = await prisma.employeeCompanyAssignment.findFirst({
      where: { userId: targetUserId, status: 'ACTIVE' },
    });
    if (existing) {
      res.status(409).json({ error: 'Employee already has an active assignment. Use transfer instead.' });
      return;
    }

    const assignment = await prisma.employeeCompanyAssignment.create({
      data: {
        userId: targetUserId,
        companyId,
        employeeCode,
        designation,
        department,
        reportingManagerId,
        annualCTC: annualCTC ? parseFloat(annualCTC) : null,
        employmentType,
        joiningDate: joiningDate ? new Date(joiningDate) : null,
        effectiveFrom: new Date(effectiveFrom),
        isPrimary: true,
        status: 'ACTIVE',
        notes,
      },
      include: {
        company: { select: { id: true, code: true, displayName: true } },
      },
    });

    res.status(201).json(assignment);
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/assignments/:userId/transfer — inter-company transfer
router.post('/:userId/transfer', authorize(['OWNER', 'ADMIN']), async (req: AuthRequest, res: Response) => {
  try {
    const targetUserId = req.params.userId;
    const {
      toCompanyId, effectiveDate, newDesignation, newDepartment,
      newCTC, newManagerId, newEmployeeCode, notes,
    } = req.body;

    if (!toCompanyId || !effectiveDate) {
      res.status(400).json({ error: 'toCompanyId and effectiveDate are required' });
      return;
    }

    // Get current active assignment
    const currentAssignment = await prisma.employeeCompanyAssignment.findFirst({
      where: { userId: targetUserId, status: 'ACTIVE' },
      include: { company: true },
    });

    if (!currentAssignment) {
      res.status(400).json({ error: 'Employee has no active assignment to transfer from' });
      return;
    }

    if (currentAssignment.companyId === toCompanyId) {
      res.status(400).json({ error: 'Cannot transfer to the same company' });
      return;
    }

    // Check target company exists
    const targetCompany = await prisma.company.findUnique({ where: { id: toCompanyId } });
    if (!targetCompany) {
      res.status(404).json({ error: 'Target company not found' });
      return;
    }

    const transferDate = new Date(effectiveDate);

    // Atomic transaction: close old assignment + create new one
    const [_, newAssignment] = await prisma.$transaction([
      // Close current assignment
      prisma.employeeCompanyAssignment.update({
        where: { id: currentAssignment.id },
        data: {
          status: 'TRANSFERRED',
          effectiveTo: transferDate,
          notes: notes ? `${currentAssignment.notes ?? ''}\nTransferred: ${notes}`.trim() : currentAssignment.notes,
        },
      }),
      // Create new assignment
      prisma.employeeCompanyAssignment.create({
        data: {
          userId: targetUserId,
          companyId: toCompanyId,
          employeeCode: newEmployeeCode ?? currentAssignment.employeeCode,
          designation: newDesignation ?? currentAssignment.designation,
          department: newDepartment ?? currentAssignment.department,
          reportingManagerId: newManagerId ?? currentAssignment.reportingManagerId,
          annualCTC: newCTC ? parseFloat(newCTC) : currentAssignment.annualCTC,
          employmentType: currentAssignment.employmentType,
          joiningDate: transferDate,
          effectiveFrom: transferDate,
          isPrimary: true,
          status: 'ACTIVE',
          notes: notes ?? `Transferred from ${currentAssignment.company?.displayName ?? 'unknown'}`,
        },
        include: {
          company: { select: { id: true, code: true, displayName: true } },
        },
      }),
    ]);

    // Leave balance carries over fully — no changes needed per blueprint

    res.status(201).json({
      message: 'Transfer completed successfully',
      previousCompany: currentAssignment.company?.displayName,
      newAssignment,
    });
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/assignments/:id/close — manually close assignment (OWNER only)
router.patch('/:id/close', authorize(['OWNER']), async (req: AuthRequest, res: Response) => {
  try {
    const assignment = await prisma.employeeCompanyAssignment.findUnique({
      where: { id: req.params.id },
    });

    if (!assignment) {
      res.status(404).json({ error: 'Assignment not found' });
      return;
    }

    if (assignment.status !== 'ACTIVE') {
      res.status(400).json({ error: 'Only active assignments can be closed' });
      return;
    }

    const updated = await prisma.employeeCompanyAssignment.update({
      where: { id: req.params.id },
      data: {
        status: 'CLOSED',
        effectiveTo: new Date(),
        notes: req.body.notes ?? assignment.notes,
      },
    });

    res.json(updated);
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
