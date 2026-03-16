/**
 * Athena HRMS - Database Seed Script
 *
 * Seeds the database from the root-level employee_import_template.xlsx file.
 * This replaces the earlier hardcoded demo users with the current company roster.
 *
 * Behavior:
 * - clears existing app data in a fresh bootstrap-friendly way
 * - creates users/profiles from the Excel sheet
 * - resolves reporting managers by Employee ID
 * - seeds leave policies, leave balances, payroll components, holidays, announcement
 *
 * Run with: npm run seed (inside apps/api)
 */

import path from 'path';
import ExcelJS from 'exceljs';
import bcrypt from 'bcryptjs';
import { PrismaClient, Role } from '@prisma/client';

const prisma = new PrismaClient();

const EMPLOYEE_FILE = path.resolve(__dirname, '../../../employee_import_template.xlsx');

type RawEmployee = {
  firstName: string;
  middleName?: string;
  lastName: string;
  employeeId: string;
  email: string;
  password: string;
  role: 'ADMIN' | 'MANAGER' | 'EMPLOYEE';
  designation: string;
  department: string;
  officeLocation: string;
  dateOfJoining?: Date;
  dateOfBirth?: Date;
  gender?: string;
  phone?: string;
  personalEmail?: string;
  emergencyContact?: string;
  bloodGroup?: string;
  managerEmployeeId?: string;
  annualCtc: number;
  bankAccountNumber: string;
  ifscCode: string;
  bankName: string;
  employmentType: 'FULL_TIME' | 'INTERN';
  pan?: string;
  aadharNumber?: string;
  uan?: string;
};

const LEAVE_POLICIES = [
  { leaveType: 'SL',            label: 'Sick Leave',       defaultTotal: 12,  isActive: true, isUnlimited: false },
  { leaveType: 'CL',            label: 'Casual Leave',     defaultTotal: 12,  isActive: true, isUnlimited: false },
  { leaveType: 'EL',            label: 'Earned Leave',     defaultTotal: 15,  isActive: true, isUnlimited: false },
  { leaveType: 'MATERNITY',     label: 'Maternity Leave',  defaultTotal: 180, isActive: true, isUnlimited: false },
  { leaveType: 'PATERNITY',     label: 'Paternity Leave',  defaultTotal: 5,   isActive: true, isUnlimited: false },
  { leaveType: 'TEMPORARY_WFH', label: 'Temporary WFH',    defaultTotal: 0,   isActive: true, isUnlimited: true  },
  { leaveType: 'TRAVELLING',    label: 'Travelling',       defaultTotal: 0,   isActive: true, isUnlimited: true  },
] as const;

const PAYROLL_COMPONENTS = [
  { name: 'Basic Salary',     type: 'EARNING'   as const, calcType: 'PERCENTAGE_OF_CTC' as const, value: 60, order: 1 },
  { name: 'HRA',              type: 'EARNING'   as const, calcType: 'PERCENTAGE_OF_CTC' as const, value: 25, order: 2 },
  { name: 'LTA',              type: 'EARNING'   as const, calcType: 'PERCENTAGE_OF_CTC' as const, value: 15, order: 3 },
  { name: 'Professional Tax', type: 'DEDUCTION' as const, calcType: 'AUTO_PT'            as const, value: 0,  order: 4 },
  { name: 'TDS',              type: 'DEDUCTION' as const, calcType: 'AUTO_TDS'           as const, value: 0,  order: 5 },
] as const;

const HOLIDAYS_2026 = [
  { name: 'Holi',             date: new Date('2026-03-13'), type: 'National' },
  { name: 'Good Friday',      date: new Date('2026-04-03'), type: 'National' },
  { name: 'Eid-ul-Fitr',      date: new Date('2026-03-31'), type: 'National' },
  { name: 'Independence Day', date: new Date('2026-08-15'), type: 'National' },
  { name: 'Durga Puja',       date: new Date('2026-10-14'), type: 'Regional' },
  { name: 'Diwali',           date: new Date('2026-11-07'), type: 'National' },
  { name: 'Christmas',        date: new Date('2026-12-25'), type: 'National' },
] as const;

function currentFYYear(date = new Date()) {
  return date.getMonth() + 1 >= 4 ? date.getFullYear() : date.getFullYear() - 1;
}

function extractCellPrimitive(value: unknown): unknown {
  if (value === null || value === undefined) return value;

  if (typeof value !== 'object') return value;

  const maybeText = value as {
    text?: unknown;
    hyperlink?: unknown;
    result?: unknown;
    richText?: Array<{ text?: unknown }>;
  };

  if (typeof maybeText.text === 'string') return maybeText.text;
  if (typeof maybeText.result === 'string' || typeof maybeText.result === 'number') return maybeText.result;
  if (Array.isArray(maybeText.richText)) {
    return maybeText.richText.map((part) => String(part.text ?? '')).join('');
  }

  return value;
}

function normalizeText(value: unknown): string {
  const primitive = extractCellPrimitive(value);
  if (primitive === null || primitive === undefined) return '';
  return String(primitive).trim();
}

function normalizeOptional(value: unknown): string | undefined {
  const text = normalizeText(value);
  return text || undefined;
}

function parseDateValue(value: ExcelJS.CellValue | undefined): Date | undefined {
  if (!value) return undefined;
  if (value instanceof Date) return value;
  if (typeof value === 'number') return new Date(value);
  const text = normalizeText(value);
  if (!text) return undefined;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function normalizeRole(value: unknown): RawEmployee['role'] {
  const text = normalizeText(value).toUpperCase();
  if (text === 'ADMIN' || text === 'MANAGER') return text;
  return 'EMPLOYEE';
}

function normalizeEmploymentType(value: unknown): RawEmployee['employmentType'] {
  const text = normalizeText(value).toUpperCase().replace(/\s+/g, '_');
  return text === 'INTERNSHIP' || text === 'INTERN' ? 'INTERN' : 'FULL_TIME';
}

function deriveEmploymentStatus(employee: RawEmployee) {
  if (employee.dateOfJoining && employee.dateOfJoining.getTime() > Date.now()) {
    return 'PENDING_JOIN' as const;
  }
  return employee.employmentType === 'INTERN' ? 'INTERNSHIP' as const : 'REGULAR_FULL_TIME' as const;
}

async function clearDatabase() {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "AttendanceAdjustment",
      "AbsenceRecord",
      "EmployeeDocument",
      "SalaryRevision",
      "AuditLog",
      "SystemSetting",
      "AttendanceRecord",
      "AttendanceImport",
      "PunchMapping",
      "DeclaredWFH",
      "WorkLog",
      "PayslipEntry",
      "PayrollRun",
      "PayrollComponent",
      "Notification",
      "Announcement",
      "LeaveBalance",
      "LeaveRequest",
      "Reimbursement",
      "LeavePolicy",
      "Holiday",
      "Profile",
      "User",
      "ApiKey",
      "BackupLog"
    RESTART IDENTITY CASCADE;
  `);
}

async function loadEmployeesFromWorkbook(): Promise<RawEmployee[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(EMPLOYEE_FILE);

  const worksheet = workbook.getWorksheet('Employees') ?? workbook.worksheets[0];
  if (!worksheet) {
    throw new Error('No Employees worksheet found in employee_import_template.xlsx');
  }

  const headerMap = new Map<string, number>();
  worksheet.getRow(1).eachCell((cell, colNumber) => {
    const header = normalizeText(cell.value).replace(' *', '');
    if (header) headerMap.set(header, colNumber);
  });

  const getCell = (row: ExcelJS.Row, name: string) => {
    const col = headerMap.get(name);
    return col ? row.getCell(col).value : undefined;
  };

  const employees: RawEmployee[] = [];
  const seenEmails = new Set<string>();
  const seenEmployeeIds = new Set<string>();

  for (let rowNum = 2; rowNum <= worksheet.rowCount; rowNum++) {
    const row = worksheet.getRow(rowNum);
    const firstName = normalizeText(getCell(row, 'First Name'));
    const lastName = normalizeText(getCell(row, 'Last Name'));
    const employeeId = normalizeText(getCell(row, 'Employee ID'));
    const email = normalizeText(getCell(row, 'Email')).toLowerCase();
    const password = normalizeText(getCell(row, 'Password'));

    if (!firstName && !lastName && !employeeId && !email) continue;

    if (!firstName || !lastName || !employeeId || !email || !password) {
      throw new Error(`Row ${rowNum} is missing a required identity field`);
    }

    if (seenEmails.has(email)) {
      throw new Error(`Duplicate email in workbook after normalization: ${email} (row ${rowNum})`);
    }
    if (seenEmployeeIds.has(employeeId)) {
      throw new Error(`Duplicate employee ID in workbook: ${employeeId} (row ${rowNum})`);
    }
    seenEmails.add(email);
    seenEmployeeIds.add(employeeId);

    const annualCtc = Number(getCell(row, 'Annual CTC') ?? 0);
    if (!Number.isFinite(annualCtc)) {
      throw new Error(`Row ${rowNum} has an invalid Annual CTC value`);
    }

    employees.push({
      firstName,
      middleName: normalizeOptional(getCell(row, 'Middle Name')),
      lastName,
      employeeId,
      email,
      password,
      role: normalizeRole(getCell(row, 'Role')),
      designation: normalizeText(getCell(row, 'Designation')),
      department: normalizeText(getCell(row, 'Department')),
      officeLocation: normalizeOptional(getCell(row, 'Office Location')) ?? 'Kolkata',
      dateOfJoining: parseDateValue(getCell(row, 'Date of Joining')),
      dateOfBirth: parseDateValue(getCell(row, 'Date of Birth')),
      gender: normalizeOptional(getCell(row, 'Gender')),
      phone: normalizeOptional(getCell(row, 'Phone')),
      personalEmail: normalizeOptional(getCell(row, 'Personal Email')),
      emergencyContact: normalizeOptional(getCell(row, 'Emergency Contact')),
      bloodGroup: normalizeOptional(getCell(row, 'Blood Group')),
      managerEmployeeId: normalizeOptional(getCell(row, 'Manager Employee ID')),
      annualCtc,
      bankAccountNumber: normalizeText(getCell(row, 'Bank Account Number')),
      ifscCode: normalizeText(getCell(row, 'IFSC Code')).toUpperCase(),
      bankName: normalizeText(getCell(row, 'Bank Name')),
      employmentType: normalizeEmploymentType(getCell(row, 'Employment Type')),
      pan: normalizeOptional(getCell(row, 'PAN'))?.toUpperCase(),
      aadharNumber: normalizeOptional(getCell(row, 'Aadhar Number')),
      uan: normalizeOptional(getCell(row, 'UAN')),
    });
  }

  return employees;
}

async function main() {
  console.log('Starting company seed...');
  console.log(`Source workbook: ${EMPLOYEE_FILE}`);

  const employees = await loadEmployeesFromWorkbook();
  if (employees.length === 0) {
    throw new Error('Workbook contains no employee rows');
  }

  console.log(`Loaded ${employees.length} employees from workbook`);

  await clearDatabase();
  console.log('Cleared existing application data');

  const createdUsers = new Map<string, string>();

  for (const employee of employees) {
    const hashedPassword = await bcrypt.hash(employee.password, 10);

    const user = await prisma.user.create({
      data: {
        email: employee.email,
        password: hashedPassword,
        role: employee.role as Role,
        isActive: true,
        employmentStatus: deriveEmploymentStatus(employee),
        profile: {
          create: {
            firstName: employee.firstName,
            middleName: employee.middleName,
            lastName: employee.lastName,
            employeeId: employee.employeeId,
            designation: employee.designation,
            department: employee.department,
            officeLocation: employee.officeLocation,
            dateOfJoining: employee.dateOfJoining,
            dateOfBirth: employee.dateOfBirth,
            gender: employee.gender,
            phone: employee.phone,
            personalEmail: employee.personalEmail,
            emergencyContact: employee.emergencyContact,
            bloodGroup: employee.bloodGroup,
            annualCtc: employee.annualCtc,
            bankAccountNumber: employee.bankAccountNumber,
            ifscCode: employee.ifscCode,
            bankName: employee.bankName,
            employmentType: employee.employmentType,
            pan: employee.pan,
            aadharNumber: employee.aadharNumber,
            uan: employee.uan,
          },
        },
      },
      select: { id: true, profile: { select: { employeeId: true } } },
    });

    createdUsers.set(employee.employeeId, user.id);
  }

  for (const employee of employees) {
    if (!employee.managerEmployeeId) continue;
    const userId = createdUsers.get(employee.employeeId);
    const managerId = createdUsers.get(employee.managerEmployeeId);
    if (!userId || !managerId) {
      throw new Error(`Unable to resolve manager mapping for ${employee.employeeId} -> ${employee.managerEmployeeId}`);
    }
    await prisma.profile.update({
      where: { userId },
      data: { managerId },
    });
  }

  await prisma.leavePolicy.createMany({ data: LEAVE_POLICIES as any });

  const balancePolicies = LEAVE_POLICIES.filter((policy) => !policy.isUnlimited);
  const fyYear = currentFYYear();
  const leaveBalanceData = Array.from(createdUsers.values()).flatMap((userId) =>
    balancePolicies.map((policy) => ({
      userId,
      year: fyYear,
      leaveType: policy.leaveType,
      total: policy.defaultTotal,
      used: 0,
    }))
  );
  await prisma.leaveBalance.createMany({ data: leaveBalanceData });

  await prisma.payrollComponent.createMany({ data: PAYROLL_COMPONENTS as any });
  await prisma.holiday.createMany({ data: HOLIDAYS_2026 as any });

  const firstAdmin = await prisma.user.findFirst({
    where: { role: 'ADMIN' },
    select: { id: true, email: true },
    orderBy: { createdAt: 'asc' },
  });

  if (firstAdmin) {
    await prisma.announcement.create({
      data: {
        title: 'Athena HRMS initialized',
        body: 'Company employee master data has been seeded from the latest import template.',
        createdBy: firstAdmin.id,
        isActive: true,
      },
    });
  }

  const roleCounts = employees.reduce<Record<string, number>>((acc, employee) => {
    acc[employee.role] = (acc[employee.role] ?? 0) + 1;
    return acc;
  }, {});

  console.log('Seed complete');
  console.log(`Employees created: ${employees.length}`);
  console.log(`Role mix: ADMIN=${roleCounts.ADMIN ?? 0}, MANAGER=${roleCounts.MANAGER ?? 0}, EMPLOYEE=${roleCounts.EMPLOYEE ?? 0}`);
  console.log(`FY leave balances created for ${fyYear}-${String(fyYear + 1).slice(-2)}`);
  if (firstAdmin?.email) {
    console.log(`Primary admin login: ${firstAdmin.email}`);
  }
}

main()
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
