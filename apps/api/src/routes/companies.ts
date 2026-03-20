/**
 * Athena V3.1 - Company Routes
 *
 * Manages the 8 sub-companies under the Ewards group.
 * OWNER/ADMIN can read, OWNER can create/update.
 */

import { Router, Response } from 'express';
import { AuthRequest, authenticate, authorize } from '../middleware/auth';
import { prisma } from '../lib/prisma';

const router = Router();
router.use(authenticate);

// GET /api/companies — list all companies with headcount
router.get('/', authorize(['OWNER', 'ADMIN']), async (req: AuthRequest, res: Response) => {
  try {
    const companies = await prisma.company.findMany({
      where: { isActive: true },
      include: {
        _count: {
          select: {
            assignments: { where: { status: 'ACTIVE' } },
          },
        },
      },
      orderBy: { displayName: 'asc' },
    });

    const result = companies.map(c => ({
      ...c,
      headcount: c._count.assignments,
      _count: undefined,
    }));

    res.json(result);
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/companies/:id — single company with stats + assigned employees
router.get('/:id', authorize(['OWNER', 'ADMIN']), async (req: AuthRequest, res: Response) => {
  try {
    const company = await prisma.company.findUnique({
      where: { id: req.params.id },
      include: {
        assignments: {
          where: { status: 'ACTIVE' },
          include: {
            user: {
              select: {
                id: true,
                email: true,
                role: true,
                isActive: true,
                employmentStatus: true,
                profile: {
                  select: {
                    firstName: true,
                    lastName: true,
                    employeeId: true,
                    designation: true,
                    department: true,
                    phone: true,
                  },
                },
              },
            },
          },
        },
        _count: {
          select: {
            assignments: { where: { status: 'ACTIVE' } },
          },
        },
      },
    });

    if (!company) {
      res.status(404).json({ error: 'Company not found' });
      return;
    }

    res.json({
      ...company,
      headcount: company._count.assignments,
      _count: undefined,
    });
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/companies — create a new company (OWNER only)
router.post('/', authorize(['OWNER']), async (req: AuthRequest, res: Response) => {
  try {
    const { code, legalName, displayName, payrollPrefix, pan, tan, gstin,
            addressLine1, addressLine2, city, state, pincode, logoUrl } = req.body;

    if (!code || !legalName || !displayName) {
      res.status(400).json({ error: 'code, legalName, and displayName are required' });
      return;
    }

    const existing = await prisma.company.findUnique({ where: { code } });
    if (existing) {
      res.status(409).json({ error: 'Company with this code already exists' });
      return;
    }

    const company = await prisma.company.create({
      data: {
        code, legalName, displayName, payrollPrefix, pan, tan, gstin,
        addressLine1, addressLine2, city, state, pincode, logoUrl,
      },
    });

    res.status(201).json(company);
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/companies/:id — update company details (OWNER only)
router.patch('/:id', authorize(['OWNER']), async (req: AuthRequest, res: Response) => {
  try {
    const company = await prisma.company.findUnique({ where: { id: req.params.id } });
    if (!company) {
      res.status(404).json({ error: 'Company not found' });
      return;
    }

    const { legalName, displayName, payrollPrefix, pan, tan, gstin,
            addressLine1, addressLine2, city, state, pincode, logoUrl, isActive } = req.body;

    const updated = await prisma.company.update({
      where: { id: req.params.id },
      data: {
        ...(legalName !== undefined && { legalName }),
        ...(displayName !== undefined && { displayName }),
        ...(payrollPrefix !== undefined && { payrollPrefix }),
        ...(pan !== undefined && { pan }),
        ...(tan !== undefined && { tan }),
        ...(gstin !== undefined && { gstin }),
        ...(addressLine1 !== undefined && { addressLine1 }),
        ...(addressLine2 !== undefined && { addressLine2 }),
        ...(city !== undefined && { city }),
        ...(state !== undefined && { state }),
        ...(pincode !== undefined && { pincode }),
        ...(logoUrl !== undefined && { logoUrl }),
        ...(isActive !== undefined && { isActive }),
      },
    });

    res.json(updated);
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
