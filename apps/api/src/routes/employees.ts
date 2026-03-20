/**
 * Athena V2 - Employee Routes
 * GET    /api/employees         - list all employees (Admin/Manager)
 * GET    /api/employees/:id     - get single employee profile
 * PUT    /api/employees/:id     - update employee profile (Admin or self)
 * POST   /api/employees         - create new employee (Admin only)
 * DELETE /api/employees/:id     - deactivate employee (Admin only)
 */

import { Router, Response }          from 'express';
import { prisma } from '../lib/prisma';
import bcrypt                        from 'bcryptjs';
import { z }                         from 'zod';
import multer                        from 'multer';
import ExcelJS                       from 'exceljs';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';
import { createAuditLog }            from '../lib/audit';

const xlsxUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } }).single('file');

const router = Router();

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
  middleName:       z.string().optional(),
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

  // Employment lifecycle status — admin-only
  employmentStatus: z.enum(['PENDING_JOIN', 'PROBATION', 'INTERNSHIP', 'REGULAR_FULL_TIME', 'NOTICE_PERIOD', 'INACTIVE']).optional(),
});

const passwordSchema = z.string().min(6, 'Password must be at least 6 characters');

const createEmployeeSchema = z.object({
  email:             z.string().email(),
  password:          passwordSchema,
  role:              z.enum(['EMPLOYEE', 'MANAGER', 'ADMIN']).default('EMPLOYEE'),
  firstName:         z.string().min(1),
  middleName:        z.string().optional(),
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
  employmentStatus:  z.enum(['PENDING_JOIN', 'PROBATION', 'INTERNSHIP', 'REGULAR_FULL_TIME', 'NOTICE_PERIOD', 'INACTIVE']).optional(),
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
        id:               true,
        email:            true,
        role:             true,
        employmentStatus: true,
        profile: {
          select: {
            firstName:       true,
            middleName:      true,
            lastName:        true,
            employeeId:      true,
            designation:     true,
            department:      true,
            officeLocation:  true,
            dateOfJoining:   true,
            managerId:       true,
            annualCtc:       true,
            employmentType:  true,
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
router.get('/:id([a-z0-9]+)', async (req: AuthRequest, res: Response) => {
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
    let reportsTo: { firstName: string; middleName: string | null; lastName: string; employeeId: string } | null = null;
    if (user.profile?.managerId) {
      reportsTo = await prisma.profile.findUnique({
        where:  { userId: user.profile.managerId },
        select: { firstName: true, middleName: true, lastName: true, employeeId: true },
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
      email, password, role, firstName, middleName, lastName, employeeId,
      designation, department, officeLocation, dateOfJoining, dateOfBirth,
      gender, phone, personalEmail, emergencyContact, bloodGroup,
      managerId, annualCtc, bankAccountNumber, ifscCode, bankName,
      employmentType, employmentStatus, pan, aadharNumber, uan,
    } = parsed.data;

    // Check if email or employeeId already exists
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      res.status(409).json({ error: 'An employee with this email already exists' });
      return;
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    // New employees default to PENDING_JOIN unless explicitly set
    const defaultStatus = employmentStatus || 'PENDING_JOIN';

    const newUser = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        role: role as any,
        employmentStatus: defaultStatus as any,
        profile: {
          create: {
            firstName,
            middleName:     middleName || undefined,
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
        profile: { select: { firstName: true, middleName: true, lastName: true, employeeId: true } },
      },
    });

    res.status(201).json(newUser);
  } catch (err) {
    console.error('Create employee error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/employees/:id - update profile (Admin can update any; Employee updates only self)
router.put('/:id([a-z0-9]+)', async (req: AuthRequest, res: Response) => {
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

    const { dateOfBirth, dateOfJoining, role, email, employeeId, annualCtc, employmentStatus, ...profileRest } = parsed.data;

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

    // Capture old CTC before update (for salary revision log)
    let oldCtcSnapshot: number | undefined;
    if (requestingUser.role === 'ADMIN' && annualCtc !== undefined) {
      const snap = await prisma.profile.findUnique({ where: { userId: id }, select: { annualCtc: true } });
      oldCtcSnapshot = snap?.annualCtc;
    }

    // If admin is changing role, email, or employment status, update the User record
    if (requestingUser.role === 'ADMIN') {
      const userUpdate: any = {};
      if (role)             userUpdate.role             = role;
      if (email)            userUpdate.email            = email;
      if (employmentStatus) userUpdate.employmentStatus = employmentStatus;
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

    // Audit log + salary revision for admin-level changes
    if (requestingUser.role === 'ADMIN') {
      const changes: Record<string, any> = {};
      if (role)             changes.role             = role;
      if (annualCtc !== undefined) changes.annualCtc = annualCtc;
      if (employmentStatus) changes.employmentStatus = employmentStatus;
      if (Object.keys(changes).length > 0) {
        const subjectProfile = await prisma.profile.findUnique({
          where: { userId: id },
          select: { firstName: true, middleName: true, lastName: true, employeeId: true },
        });
        await createAuditLog({
          actorId:   requestingUser.id,
          action:    'PROFILE_UPDATED',
          entity:    'User',
          entityId:  id,
          subjectEntity: 'User',
          subjectId: id,
          subjectLabel: subjectProfile
            ? `${subjectProfile.firstName}${subjectProfile.middleName ? ` ${subjectProfile.middleName}` : ''} ${subjectProfile.lastName} (${subjectProfile.employeeId})`
            : id,
          subjectMeta: subjectProfile
            ? { employeeId: subjectProfile.employeeId }
            : undefined,
          newValues: changes,
        });
      }

      // Auto-log salary revision when CTC changes
      if (annualCtc !== undefined && oldCtcSnapshot !== undefined && oldCtcSnapshot !== annualCtc) {
        await prisma.salaryRevision.create({
          data: {
            userId:        id,
            effectiveDate: new Date(),
            oldCtc:        oldCtcSnapshot,
            newCtc:        annualCtc,
            revisedBy:     requestingUser.id,
          },
        }).catch((e) => console.error('Salary revision log error (non-fatal):', e));
      }
    }

    res.json(updated);
  } catch (err) {
    console.error('Update profile error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/employees/:id/status — Admin changes employment lifecycle status
router.patch('/:id([a-z0-9]+)/status', authorize(['ADMIN']), async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const parsed = z.object({
    employmentStatus: z.enum(['PENDING_JOIN', 'PROBATION', 'INTERNSHIP', 'REGULAR_FULL_TIME', 'NOTICE_PERIOD', 'INACTIVE']),
  }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid employment status' });
    return;
  }

  try {
    const current = await prisma.user.findUnique({
      where:  { id },
      select: {
        employmentStatus: true,
        profile: { select: { firstName: true, middleName: true, lastName: true, employeeId: true } },
      },
    });
    if (!current) {
      res.status(404).json({ error: 'Employee not found' });
      return;
    }

    const updated = await prisma.user.update({
      where: { id },
      data:  { employmentStatus: parsed.data.employmentStatus as any },
      select: { id: true, employmentStatus: true },
    });

    await createAuditLog({
      actorId:   req.user!.id,
      action:    'EMPLOYMENT_STATUS_CHANGED',
      entity:    'User',
      entityId:  id,
      subjectEntity: 'User',
      subjectId: id,
      subjectLabel: current.profile
        ? `${current.profile.firstName}${current.profile.middleName ? ` ${current.profile.middleName}` : ''} ${current.profile.lastName} (${current.profile.employeeId})`
        : id,
      subjectMeta: current.profile
        ? { employeeId: current.profile.employeeId }
        : undefined,
      oldValues: { employmentStatus: current.employmentStatus },
      newValues: { employmentStatus: parsed.data.employmentStatus },
    });

    res.json(updated);
  } catch (err) {
    console.error('Change status error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/employees/:id - soft delete (deactivate), Admin only
router.delete('/:id([a-z0-9]+)', authorize(['ADMIN']), async (req: AuthRequest, res: Response) => {
  const { id } = req.params;

  // Prevent admin from deactivating themselves
  if (req.user!.id === id) {
    res.status(400).json({ error: 'You cannot deactivate your own account' });
    return;
  }

  try {
    const subject = await prisma.user.findUnique({
      where: { id },
      select: {
        profile: { select: { firstName: true, middleName: true, lastName: true, employeeId: true } },
      },
    });

    await prisma.user.update({
      where: { id },
      data:  { isActive: false },
    });

    await createAuditLog({
      actorId:   req.user!.id,
      action:    'EMPLOYEE_DEACTIVATED',
      entity:    'User',
      entityId:  id,
      subjectEntity: 'User',
      subjectId: id,
      subjectLabel: subject?.profile
        ? `${subject.profile.firstName}${subject.profile.middleName ? ` ${subject.profile.middleName}` : ''} ${subject.profile.lastName} (${subject.profile.employeeId})`
        : id,
      subjectMeta: subject?.profile
        ? { employeeId: subject.profile.employeeId }
        : undefined,
      newValues: { isActive: false },
    });

    res.json({ message: 'Employee deactivated successfully' });
  } catch (err) {
    console.error('Deactivate employee error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Import Template Download ─────────────────────────────────────────────────

// Columns definition — single source of truth for template AND import parser
const IMPORT_COLUMNS = [
  { header: 'First Name *',         key: 'firstName',         width: 18 },
  { header: 'Middle Name',          key: 'middleName',        width: 18 },
  { header: 'Last Name *',          key: 'lastName',          width: 18 },
  { header: 'Employee ID *',        key: 'employeeId',        width: 14 },
  { header: 'Email *',              key: 'email',             width: 28 },
  { header: 'Password *',           key: 'password',          width: 20 },
  { header: 'Role',                 key: 'role',              width: 12 },
  { header: 'Designation *',        key: 'designation',       width: 20 },
  { header: 'Department *',         key: 'department',        width: 18 },
  { header: 'Office Location',      key: 'officeLocation',    width: 18 },
  { header: 'Date of Joining',      key: 'dateOfJoining',     width: 16 },
  { header: 'Date of Birth',        key: 'dateOfBirth',       width: 16 },
  { header: 'Gender',               key: 'gender',            width: 12 },
  { header: 'Phone',                key: 'phone',             width: 14 },
  { header: 'Personal Email',       key: 'personalEmail',     width: 28 },
  { header: 'Emergency Contact',    key: 'emergencyContact',  width: 16 },
  { header: 'Blood Group',          key: 'bloodGroup',        width: 12 },
  { header: 'Manager Employee ID',  key: 'managerEmployeeId', width: 20 },
  { header: 'Annual CTC *',         key: 'annualCtc',         width: 14 },
  { header: 'Bank Account Number *',key: 'bankAccountNumber', width: 22 },
  { header: 'IFSC Code *',          key: 'ifscCode',          width: 14 },
  { header: 'Bank Name *',          key: 'bankName',          width: 18 },
  { header: 'Employment Type',      key: 'employmentType',    width: 16 },
  { header: 'PAN',                  key: 'pan',               width: 14 },
  { header: 'Aadhar Number',        key: 'aadharNumber',      width: 14 },
  { header: 'UAN',                  key: 'uan',               width: 14 },
];

// GET /api/employees/import-template
router.get('/import-template', authorize(['ADMIN']), async (_req, res: Response) => {
  try {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Athena HRMS';
    const ws = wb.addWorksheet('Employees');

    ws.columns = IMPORT_COLUMNS.map((c) => ({ header: c.header, key: c.key, width: c.width }));

    // Style header row
    const headerRow = ws.getRow(1);
    headerRow.eachCell((cell) => {
      const header = String(cell.value ?? '');
      const isRequired = header.includes('*');
      cell.font      = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill      = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: isRequired ? 'FF361963' : 'FFFD8C27' },
      };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      cell.border    = {
        top: { style: 'thin' }, bottom: { style: 'thin' },
        left: { style: 'thin' }, right: { style: 'thin' },
      };
    });
    headerRow.height = 28;

    // Sample row
    ws.addRow({
      firstName: 'Arjun', middleName: 'Kumar', lastName: 'Sharma', employeeId: 'EW010',
      email: 'arjun.sharma@ewards.com', password: 'Arjun@123',
      role: 'EMPLOYEE', designation: 'Software Engineer', department: 'Engineering',
      officeLocation: 'Kolkata', dateOfJoining: '2025-01-15', dateOfBirth: '1995-06-20',
      gender: 'Male', phone: '9876543210', personalEmail: 'arjun@gmail.com',
      emergencyContact: '9876543211', bloodGroup: 'O+',
      managerEmployeeId: 'EW001', annualCtc: 600000,
      bankAccountNumber: '123456789012', ifscCode: 'HDFC0001234', bankName: 'HDFC Bank',
      employmentType: 'FULL_TIME', pan: 'ABCDE1234F', aadharNumber: '123456789012', uan: '',
    });

    // Notes worksheet
    const notes = wb.addWorksheet('Notes');
    notes.addRows([
      ['Field', 'Notes'],
      ['Role', 'EMPLOYEE | MANAGER | ADMIN  (default: EMPLOYEE)'],
      ['Gender', 'Male | Female | Other | Prefer not to say'],
      ['Date of Joining / DOB', 'Format: YYYY-MM-DD'],
      ['Employment Type', 'FULL_TIME | INTERN  (default: FULL_TIME)'],
      ['Manager Employee ID', 'Use the Employee ID of the reporting manager (not email)'],
      ['Annual CTC', 'In rupees, numbers only (e.g. 600000)'],
      ['PAN', 'Format: AAAAA1234A (5 uppercase letters + 4 digits + 1 uppercase letter)'],
      ['Aadhar Number', 'Exactly 12 digits'],
      ['IFSC Code', 'Format: AAAA0XXXXXX'],
      ['Password', 'Min 8 chars, must include uppercase, lowercase, number, special char'],
      ['Fields marked *', 'Required — rows with missing required fields will be skipped'],
    ]);
    notes.getRow(1).font = { bold: true };
    notes.getColumn(1).width = 28;
    notes.getColumn(2).width = 60;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="athena_employee_import_template.xlsx"');
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('Template download error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Bulk Import ───────────────────────────────────────────────────────────────

// POST /api/employees/import
router.post('/import', authorize(['ADMIN']), (req: AuthRequest, res: Response) => {
  xlsxUpload(req as any, res as any, async (err) => {
    if (err) { res.status(400).json({ error: err.message || 'File upload failed' }); return; }
    if (!req.file) { res.status(400).json({ error: 'No file uploaded' }); return; }

    try {
      const wb = new ExcelJS.Workbook();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await wb.xlsx.load(req.file.buffer as any);
      const ws = wb.getWorksheet('Employees') ?? wb.worksheets[0];
      if (!ws) { res.status(400).json({ error: 'No "Employees" worksheet found in the file' }); return; }

      // Build header → column index map from row 1
      const headerMap = new Map<string, number>();
      ws.getRow(1).eachCell((cell, colNumber) => {
        const raw = String(cell.value ?? '').replace(' *', '').trim();
        headerMap.set(raw, colNumber);
      });

      const col = (name: string, row: ExcelJS.Row): string => {
        const idx = headerMap.get(name);
        if (!idx) return '';
        const v = row.getCell(idx).value;
        return v === null || v === undefined ? '' : String(v).trim();
      };

      // Pre-load all managers indexed by employeeId
      const allManagers = await prisma.profile.findMany({ select: { userId: true, employeeId: true } });
      const managerByEmpId = new Map(allManagers.map((m) => [m.employeeId, m.userId]));

      const results: { row: number; status: 'created' | 'skipped'; employeeId?: string; reason?: string }[] = [];

      for (let rowNum = 2; rowNum <= ws.rowCount; rowNum++) {
        const row = ws.getRow(rowNum);
        // Skip if row is empty
        const firstName = col('First Name', row);
        if (!firstName) continue;

        const middleName     = col('Middle Name', row);
        const lastName       = col('Last Name', row);
        const employeeId     = col('Employee ID', row);
        const email          = col('Email', row);
        const password       = col('Password', row);
        const designation    = col('Designation', row);
        const department     = col('Department', row);
        const annualCtcRaw   = col('Annual CTC', row);
        const bankAccount    = col('Bank Account Number', row);
        const ifscCode       = col('IFSC Code', row);
        const bankName       = col('Bank Name', row);

        // Required field check
        if (!lastName || !employeeId || !email || !password || !designation || !department || !annualCtcRaw || !bankAccount || !ifscCode || !bankName) {
          results.push({ row: rowNum, status: 'skipped', reason: 'Missing required fields' });
          continue;
        }

        // Password validation
        const pwParsed = passwordSchema.safeParse(password);
        if (!pwParsed.success) {
          results.push({ row: rowNum, status: 'skipped', employeeId, reason: pwParsed.error.errors[0]?.message ?? 'Invalid password' });
          continue;
        }

        // Check duplicates
        const existing = await prisma.user.findUnique({ where: { email } });
        if (existing) {
          results.push({ row: rowNum, status: 'skipped', employeeId, reason: `Email already exists: ${email}` });
          continue;
        }
        const existingEmpId = await prisma.profile.findUnique({ where: { employeeId } });
        if (existingEmpId) {
          results.push({ row: rowNum, status: 'skipped', employeeId, reason: `Employee ID already exists: ${employeeId}` });
          continue;
        }

        // Resolve manager
        const managerEmpId = col('Manager Employee ID', row);
        const managerId    = managerEmpId ? (managerByEmpId.get(managerEmpId) ?? '') : '';

        const roleRaw          = col('Role', row);
        const empTypeRaw       = col('Employment Type', row);
        const genderRaw        = col('Gender', row);
        const dateOfJoiningRaw = col('Date of Joining', row);
        const dateOfBirthRaw   = col('Date of Birth', row);

        const hashedPassword = await bcrypt.hash(password, 10);
        const annualCtc      = parseFloat(annualCtcRaw) || 0;

        const role           = ['EMPLOYEE', 'MANAGER', 'ADMIN'].includes(roleRaw) ? roleRaw : 'EMPLOYEE';
        const employmentType = empTypeRaw === 'INTERN' ? 'INTERN' : 'FULL_TIME';

        try {
          await prisma.user.create({
            data: {
              email,
              password: hashedPassword,
              role:             role as any,
              employmentStatus: 'PENDING_JOIN',
              profile: {
                create: {
                  firstName,
                  middleName: middleName || undefined,
                  lastName,
                  employeeId,
                  designation,
                  department,
                  officeLocation:   col('Office Location', row) || 'Kolkata',
                  dateOfJoining:    dateOfJoiningRaw  ? new Date(dateOfJoiningRaw)  : undefined,
                  dateOfBirth:      dateOfBirthRaw    ? new Date(dateOfBirthRaw)    : undefined,
                  gender:           ['Male','Female','Other','Prefer not to say'].includes(genderRaw) ? genderRaw : undefined,
                  phone:            col('Phone', row) || undefined,
                  personalEmail:    col('Personal Email', row) || undefined,
                  emergencyContact: col('Emergency Contact', row) || undefined,
                  bloodGroup:       col('Blood Group', row) || undefined,
                  managerId:        managerId || undefined,
                  annualCtc,
                  bankAccountNumber: bankAccount,
                  ifscCode,
                  bankName,
                  employmentType,
                  pan:          col('PAN', row) || undefined,
                  aadharNumber: col('Aadhar Number', row) || undefined,
                  uan:          col('UAN', row) || undefined,
                },
              },
            },
          });
          results.push({ row: rowNum, status: 'created', employeeId });
        } catch (createErr: any) {
          results.push({ row: rowNum, status: 'skipped', employeeId, reason: createErr?.message ?? 'Create failed' });
        }
      }

      const created = results.filter((r) => r.status === 'created').length;
      const skipped = results.filter((r) => r.status === 'skipped').length;
      res.json({ message: `Import complete. ${created} created, ${skipped} skipped.`, created, skipped, results });
    } catch (err) {
      console.error('Bulk import error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });
});

export default router;
