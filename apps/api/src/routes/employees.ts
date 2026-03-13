/**
 * Athena V2 - Employee Routes
 * GET    /api/employees         - list all employees (Admin/Manager)
 * GET    /api/employees/:id     - get single employee profile
 * PUT    /api/employees/:id     - update employee profile (Admin or self)
 * POST   /api/employees         - create new employee (Admin only)
 * DELETE /api/employees/:id     - deactivate employee (Admin only)
 */

import { Router, Response }          from 'express';
import { PrismaClient }              from '@prisma/client';
import bcrypt                        from 'bcryptjs';
import { z }                         from 'zod';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';

const router = Router();
const prisma = new PrismaClient();

// All employee routes require authentication
router.use(authenticate);

// --- Zod Schemas for data validation ---

// PAN format: 5 uppercase letters + 4 digits + 1 uppercase letter (e.g. ABCDE1234F)
const panRegex = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;

// IFSC format: 4 uppercase letters + 0 (literal) + 6 alphanumeric chars (e.g. HDFC0001234)
const ifscRegex = /^[A-Z]{4}0[A-Z0-9]{6}$/;

// Aadhar: exactly 12 digits
const aadharRegex = /^\d{12}$/;

const profileUpdateSchema = z.object({
  firstName:        z.string().min(1).optional(),
  lastName:         z.string().min(1).optional(),
  dateOfBirth:      z.string().optional(),
  gender:           z.enum(['Male', 'Female', 'Other', 'Prefer not to say']).optional(),
  bloodGroup:       z.string().optional(),
  personalEmail:    z.string().email().optional(),
  phone:            z.string().optional(),
  emergencyContact: z.string().optional(),
  designation:      z.string().optional(),
  department:       z.string().optional(),
  officeLocation:   z.string().optional(),
  dateOfJoining:    z.string().optional(),
  managerId:        z.string().optional(),

  // Admin-only: change the user's role
  role:             z.enum(['EMPLOYEE', 'MANAGER', 'ADMIN']).optional(),

  // Statutory fields — validated with regex
  pan:              z.string().regex(panRegex, 'Invalid PAN format. Expected: AAAAA1234A').optional(),
  aadharNumber:     z.string().regex(aadharRegex, 'Aadhar must be exactly 12 digits').optional(),
  uan:              z.string().optional(),

  // Bank details
  bankAccountNumber: z.string().optional(),
  ifscCode:          z.string().regex(ifscRegex, 'Invalid IFSC format. Expected: AAAA0XXXXXX').optional(),
  bankName:          z.string().optional(),

  // Document upload paths (set by the upload endpoint, not user-typed)
  kycDocumentUrl:       z.string().optional(),
  appointmentLetterUrl: z.string().optional(),

  // Identity fields — admin-editable, uniqueness checked in handler
  employeeId: z.string().min(1).optional(),
  email:      z.string().email('Invalid email').optional(),

  // Payroll — admin-only
  annualCtc: z.number().min(0).optional(),

  // Employment type — admin-only
  employmentType: z.enum(['FULL_TIME', 'INTERN']).optional(),
});

const createEmployeeSchema = z.object({
  email:             z.string().email(),
  password:          z.string().min(8, 'Password must be at least 8 characters'),
  role:              z.enum(['EMPLOYEE', 'MANAGER', 'ADMIN']).default('EMPLOYEE'),
  firstName:         z.string().min(1),
  lastName:          z.string().min(1),
  employeeId:        z.string().min(1),
  designation:       z.string().min(1, 'Designation is required'),
  department:        z.string().min(1, 'Department is required'),
  officeLocation:    z.string().optional(),
  dateOfJoining:     z.string().optional(),
  dateOfBirth:       z.string().optional(),
  gender:            z.enum(['Male', 'Female', 'Other', 'Prefer not to say']).optional(),
  phone:             z.string().optional(),
  personalEmail:     z.string().email().optional().or(z.literal('')),
  emergencyContact:  z.string().optional(),
  bloodGroup:        z.string().optional(),
  managerId:         z.string().min(1, 'Reporting manager is required'),
  annualCtc:         z.number().min(0, 'Annual CTC is required'),
  bankAccountNumber: z.string().min(1, 'Bank account number is required'),
  ifscCode:          z.string().regex(ifscRegex, 'Invalid IFSC format. Expected: AAAA0XXXXXX'),
  bankName:          z.string().min(1, 'Bank name is required'),
  employmentType:    z.enum(['FULL_TIME', 'INTERN']).default('FULL_TIME'),
  pan:               z.string().regex(panRegex, 'Invalid PAN format').optional().or(z.literal('')),
  aadharNumber:      z.string().regex(aadharRegex, 'Aadhar must be 12 digits').optional().or(z.literal('')),
  uan:               z.string().optional(),
});

// GET /api/employees - Admin and Managers can list all employees
router.get('/', authorize(['ADMIN', 'MANAGER']), async (_req, res: Response) => {
  try {
    const employees = await prisma.user.findMany({
      where: { isActive: true },
      select: {
        id:    true,
        email: true,
        role:  true,
        profile: {
          select: {
            firstName:     true,
            lastName:      true,
            employeeId:    true,
            designation:    true,
            department:     true,
            officeLocation: true,
            dateOfJoining:  true,
            managerId:      true,
            annualCtc:      true,
            employmentType: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    res.json(employees);
  } catch (err) {
    console.error('List employees error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/employees/:id - fetch a specific employee (self, or Admin/Manager)
router.get('/:id', async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const requestingUser = req.user!;

  // Employees can only view their own profile; Admin/Manager can view any
  if (requestingUser.role === 'EMPLOYEE' && requestingUser.id !== id) {
    res.status(403).json({ error: 'Forbidden: You can only view your own profile' });
    return;
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id:      true,
        email:   true,
        role:    true,
        profile: true,
      },
    });

    if (!user) {
      res.status(404).json({ error: 'Employee not found' });
      return;
    }

    // Resolve reporting manager name (managerId is a plain string, not a Prisma relation)
    let reportsTo: { firstName: string; lastName: string; employeeId: string } | null = null;
    if (user.profile?.managerId) {
      reportsTo = await prisma.profile.findUnique({
        where:  { userId: user.profile.managerId },
        select: { firstName: true, lastName: true, employeeId: true },
      });
    }

    res.json({ ...user, reportsTo });
  } catch (err) {
    console.error('Get employee error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/employees - Admin creates a new employee account
router.post('/', authorize(['ADMIN']), async (req: AuthRequest, res: Response) => {
  try {
    const parsed = createEmployeeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
      return;
    }

    const {
      email, password, role, firstName, lastName, employeeId,
      designation, department, officeLocation, dateOfJoining, dateOfBirth,
      gender, phone, personalEmail, emergencyContact, bloodGroup,
      managerId, annualCtc, bankAccountNumber, ifscCode, bankName,
      employmentType, pan, aadharNumber, uan,
    } = parsed.data;

    // Check if email or employeeId already exists
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      res.status(409).json({ error: 'An employee with this email already exists' });
      return;
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        role: role as any,
        profile: {
          create: {
            firstName,
            lastName,
            employeeId,
            designation,
            department,
            officeLocation: officeLocation || 'Kolkata',
            dateOfJoining:  dateOfJoining  ? new Date(dateOfJoining)  : undefined,
            dateOfBirth:    dateOfBirth    ? new Date(dateOfBirth)    : undefined,
            gender:         gender         || undefined,
            phone:          phone          || undefined,
            personalEmail:  personalEmail  || undefined,
            emergencyContact: emergencyContact || undefined,
            bloodGroup:     bloodGroup     || undefined,
            managerId,
            annualCtc,
            bankAccountNumber,
            ifscCode,
            bankName,
            employmentType,
            pan:            pan            || undefined,
            aadharNumber:   aadharNumber   || undefined,
            uan:            uan            || undefined,
          },
        },
      },
      select: {
        id:      true,
        email:   true,
        role:    true,
        profile: { select: { firstName: true, lastName: true, employeeId: true } },
      },
    });

    res.status(201).json(newUser);
  } catch (err) {
    console.error('Create employee error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/employees/:id - update profile (Admin can update any; Employee updates only self)
router.put('/:id', async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const requestingUser = req.user!;

  if (requestingUser.role === 'EMPLOYEE' && requestingUser.id !== id) {
    res.status(403).json({ error: 'Forbidden: You can only update your own profile' });
    return;
  }

  try {
    const parsed = profileUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
      return;
    }

    const { dateOfBirth, dateOfJoining, role, email, employeeId, annualCtc, ...profileRest } = parsed.data;

    // annualCtc is admin-only — strip it if the requester is not an admin
    const ctcUpdate = requestingUser.role === 'ADMIN' && annualCtc !== undefined
      ? { annualCtc }
      : {};

    // Uniqueness check: employeeId must not belong to a different employee
    if (employeeId) {
      const clash = await prisma.profile.findUnique({ where: { employeeId } });
      if (clash && clash.userId !== id) {
        res.status(409).json({ error: `Employee ID "${employeeId}" is already assigned to another employee.` });
        return;
      }
    }

    // Uniqueness check: email must not belong to a different user
    if (email) {
      const clash = await prisma.user.findUnique({ where: { email } });
      if (clash && clash.id !== id) {
        res.status(409).json({ error: `Email "${email}" is already in use by another account.` });
        return;
      }
    }

    // If admin is changing role or email, update the User record
    if (requestingUser.role === 'ADMIN') {
      const userUpdate: any = {};
      if (role)  userUpdate.role  = role;
      if (email) userUpdate.email = email;
      if (Object.keys(userUpdate).length > 0) {
        await prisma.user.update({ where: { id }, data: userUpdate });
      }
    }

    const updated = await prisma.profile.update({
      where: { userId: id },
      data: {
        ...profileRest,
        ...ctcUpdate,
        ...(employeeId    ? { employeeId }                        : {}),
        dateOfBirth:   dateOfBirth   ? new Date(dateOfBirth)   : undefined,
        dateOfJoining: dateOfJoining ? new Date(dateOfJoining) : undefined,
      },
    });

    res.json(updated);
  } catch (err) {
    console.error('Update profile error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/employees/:id - soft delete (deactivate), Admin only
router.delete('/:id', authorize(['ADMIN']), async (req: AuthRequest, res: Response) => {
  const { id } = req.params;

  // Prevent admin from deactivating themselves
  if (req.user!.id === id) {
    res.status(400).json({ error: 'You cannot deactivate your own account' });
    return;
  }

  try {
    await prisma.user.update({
      where: { id },
      data:  { isActive: false },
    });

    res.json({ message: 'Employee deactivated successfully' });
  } catch (err) {
    console.error('Deactivate employee error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
