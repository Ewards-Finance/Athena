/**
 * Athena HRMS V3.1 - Database Seed Script
 *
 * Seeds the database from the root-level employee_import_template.xlsx file.
 * Also seeds:
 * - 8 group companies
 * - Employee-company assignments (from hardcoded mapping)
 * - First PolicyVersion with all default rules
 *
 * Behavior:
 * - clears existing app data in a fresh bootstrap-friendly way
 * - creates users/profiles from the Excel sheet
 * - resolves reporting managers by Employee ID
 * - seeds leave policies, leave balances, payroll components, holidays, announcement
 * - seeds companies and employee-company assignments
 * - seeds PolicyVersion v1 with all default rules
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
  role: 'OWNER' | 'ADMIN' | 'MANAGER' | 'EMPLOYEE';
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
  { leaveType: 'COMP_OFF',      label: 'Compensatory Off', defaultTotal: 0,   isActive: true, isUnlimited: true  },
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

// ─── V3.1: 8 Group Companies ────────────────────────────────────────────────
const COMPANIES = [
  { code: 'ADVISORS',           legalName: 'Advisors Pvt Ltd',              displayName: 'Advisors' },
  { code: 'CENTRAL-CABLES',     legalName: 'Central Cables Pvt Ltd',        displayName: 'Central Cables' },
  { code: 'EWARDS-ENGAGEMENT',  legalName: 'Ewards Engagement Pvt Ltd',     displayName: 'Ewards Engagement' },
  { code: 'EXPORT',             legalName: 'Export Pvt Ltd',                displayName: 'Export' },
  { code: 'GAJRAJ-TRADECOM',    legalName: 'Gajraj Tradecom Pvt Ltd',       displayName: 'Gajraj Tradecom' },
  { code: 'OPTIMIX',            legalName: 'Optimix Pvt Ltd',               displayName: 'Optimix' },
  { code: 'PROJECTS',           legalName: 'Projects Pvt Ltd',              displayName: 'Projects' },
  { code: 'SECOND-HUGS',        legalName: 'Second Hugs Pvt Ltd',           displayName: 'Second Hugs' },
] as const;

// ─── V3.1: Employee → Company Mapping (by employeeId → displayName) ─────────
// Keys are case-insensitive matched. Extra keys not in the workbook are ignored.
const EMPLOYEE_COMPANY_MAP: Record<string, string> = {
  "eKol0698": "Second Hugs",
  "eKol0768": "Ewards Engagement",
  "eKol0746": "Second Hugs",
  "eKol0784": "Ewards Engagement",
  "eKol0724": "Advisors",
  "eKol0672": "Ewards Engagement",
  "eKol0240": "Central Cables",
  "eKol0782": "Second Hugs",
  "eXXX009": "Central Cables",
  "eKol0345": "Central Cables",
  "eXXX002": "Export",
  "eKol0002": "Central Cables",
  "eKol0748": "Ewards Engagement",
  "eKol0787": "Ewards Engagement",
  "eXXX003": "Export",
  "eKol0770": "Gajraj Tradecom",
  "eKol0523": "Central Cables",
  "eKol0751": "Advisors",
  "eKol0761": "Advisors",
  "eKhr0458": "Advisors",
  "eBal0373": "Projects",
  "eXXX004": "Export",
  "eXXX010": "Projects",
  "eKol0493": "Advisors",
  "eXXX011": "Projects",
  "eKol0686": "Projects",
  "eKol0004": "Central Cables",
  "eHow0279": "Projects",
  "eKol0797": "Ewards Engagement",
  "eKha0532": "Export",
  "eAsa0812": "Optimix",
  "eKol0283": "Advisors",
  "ePat0379": "Projects",
  "eKol0794": "Optimix",
  "eXXX001": "Export",
  "eXXX008": "Gajraj Tradecom",
  "eKak0798": "Ewards Engagement",
  "eKol0795": "Optimix",
  "eKol0802": "Optimix",
  "eKol0631": "Export",
  "eBar0807": "Second Hugs",
  "ekol0706": "Optimix",
  "eKol0517": "Gajraj Tradecom",
  "eKol0742": "Advisors",
  "eDur0420": "Advisors",
  "eKol0683": "Ewards Engagement",
  "eKol0809": "Ewards Engagement",
  "eKol0793": "Gajraj Tradecom",
  "eKol0696": "Optimix",
  "eKol0776": "Optimix",
  "eKol0805": "Gajraj Tradecom",
  "eKol0750": "Ewards Engagement",
  "eKol0243": "Central Cables",
  "eKol0678": "Gajraj Tradecom",
  "eKol0813": "Optimix",
  "eKol0772": "Gajraj Tradecom",
  "eKol0699": "Ewards Engagement",
  "eKol0804": "Optimix",
  "eKol0509": "Central Cables",
  "eBer0229": "Central Cables",
  "eHas0806": "Optimix",
  "eKol0808": "Second Hugs",
  "eKol0801": "Optimix",
  "eXXX012": "Projects",
  "eKol0792": "Projects",
  "eKol0359": "Projects",
  "eSil0728": "Ewards Engagement",
  "ekol0276": "Central Cables",
  "eKol0777": "Gajraj Tradecom",
  "eKol0703": "Ewards Engagement",
  "eKol0702": "Central Cables",
  "eKol0764": "Export",
  "eKol0719": "Optimix",
  "eKol0635": "Export",
  "eKol0758": "Export",
};

// ─── V3.1: Default Policy Rules (replaces hardcoded values) ──────────────────
const DEFAULT_POLICY_RULES = [
  { ruleKey: 'wfh_deduction_pct',          ruleValue: '30',           valueType: 'number',  description: '% salary deducted per WFH day' },
  { ruleKey: 'sandwich_rule_enabled',      ruleValue: 'true',         valueType: 'boolean', description: 'Enable sandwich rule for leaves' },
  { ruleKey: 'late_cutoff_time',           ruleValue: '10:15',        valueType: 'time',    description: 'After this time = late mark' },
  { ruleKey: 'half_day_hours_threshold',   ruleValue: '4.5',          valueType: 'number',  description: 'Hours worked < this = half day' },
  { ruleKey: 'late_lwp_threshold',         ruleValue: '4',            valueType: 'number',  description: 'Late marks after this count become LWP' },
  { ruleKey: 'sat_free_fulltime',          ruleValue: '3',            valueType: 'number',  description: 'Saturdays off per month for full-timers' },
  { ruleKey: 'sat_free_intern',            ruleValue: '2',            valueType: 'number',  description: 'Saturdays off per month for interns' },
  { ruleKey: 'default_notice_period_days', ruleValue: '90',           valueType: 'number',  description: 'Default notice period in days' },
  { ruleKey: 'leave_encashment_rate',      ruleValue: '1.0',          valueType: 'number',  description: 'Multiplier on daily rate for encashment' },
  { ruleKey: 'compoff_expiry_days',        ruleValue: '90',           valueType: 'number',  description: 'Days before comp-off expires' },
  { ruleKey: 'tds_regime',                 ruleValue: 'new',          valueType: 'string',  description: '"new" or "old" tax regime' },
  { ruleKey: 'pt_state',                   ruleValue: 'west_bengal',  valueType: 'string',  description: 'State for PT slabs' },
  { ruleKey: 'pf_enabled',                 ruleValue: 'false',        valueType: 'boolean', description: 'PF deduction enabled (future)' },
  { ruleKey: 'esi_enabled',                ruleValue: 'false',        valueType: 'boolean', description: 'ESI deduction enabled (future)' },
  { ruleKey: 'sick_leave_doc_required_days', ruleValue: '2',          valueType: 'number',  description: 'SL > this days requires medical doc' },
  { ruleKey: 'wfh_allowed_per_month',      ruleValue: '0',            valueType: 'number',  description: 'Max WFH days per month (0 = unlimited)' },
  { ruleKey: 'carry_forward_max_days',     ruleValue: '15',           valueType: 'number',  description: 'Max EL days to carry forward at year end' },
  { ruleKey: 'probation_default_days',     ruleValue: '90',           valueType: 'number',  description: 'Default probation period in days' },
  { ruleKey: 'extension_arrival_time',     ruleValue: '11:00',        valueType: 'time',    description: 'Extended arrival cutoff for certain days' },
];

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
      "PolicyAcknowledgement",
      "PolicyRule",
      "PolicyVersion",
      "EmployeeCompanyAssignment",
      "Company",
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
  console.log('Starting Athena V3.1 seed...');
  console.log(`Source workbook: ${EMPLOYEE_FILE}`);

  const employees = await loadEmployeesFromWorkbook();
  if (employees.length === 0) {
    throw new Error('Workbook contains no employee rows');
  }

  console.log(`Loaded ${employees.length} employees from workbook`);

  await clearDatabase();
  console.log('Cleared existing application data');

  // ── Create Users & Profiles ─────────────────────────────────────────────────
  const createdUsers = new Map<string, string>(); // employeeId → userId

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

  // ── Resolve Manager Links ──────────────────────────────────────────────────
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

  // ── Promote admin@ewards.com to OWNER ──────────────────────────────────────
  const ownerUser = await prisma.user.findUnique({ where: { email: 'admin@ewards.com' } });
  if (ownerUser) {
    await prisma.user.update({
      where: { id: ownerUser.id },
      data: { role: 'OWNER' },
    });
    console.log('Promoted admin@ewards.com to OWNER role');
  }

  // ── Leave Policies ─────────────────────────────────────────────────────────
  await prisma.leavePolicy.createMany({ data: LEAVE_POLICIES as any });

  // ── Leave Balances ─────────────────────────────────────────────────────────
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

  // ── Payroll Components, Holidays ───────────────────────────────────────────
  await prisma.payrollComponent.createMany({ data: PAYROLL_COMPONENTS as any });
  await prisma.holiday.createMany({ data: HOLIDAYS_2026 as any });

  // ── Announcement ───────────────────────────────────────────────────────────
  const firstAdmin = ownerUser ?? await prisma.user.findFirst({
    where: { role: 'ADMIN' },
    select: { id: true, email: true },
    orderBy: { createdAt: 'asc' },
  });

  if (firstAdmin) {
    await prisma.announcement.create({
      data: {
        title: 'Athena V3.1 initialized',
        body: 'Company employee master data has been seeded. Multi-entity support is now active with 8 group companies.',
        createdBy: firstAdmin.id,
        isActive: true,
      },
    });
  }

  // ── V3.1: Seed Companies ──────────────────────────────────────────────────
  console.log('Seeding 8 group companies...');
  const companyMap = new Map<string, string>(); // displayName → companyId

  for (const company of COMPANIES) {
    const created = await prisma.company.create({ data: company });
    companyMap.set(company.displayName, created.id);
  }
  console.log(`Created ${COMPANIES.length} companies`);

  // ── V3.1: Create Employee-Company Assignments ─────────────────────────────
  console.log('Creating employee-company assignments...');

  // Build case-insensitive lookup for employee mapping
  const empMapLower = new Map<string, string>();
  for (const [empId, companyName] of Object.entries(EMPLOYEE_COMPANY_MAP)) {
    empMapLower.set(empId.toLowerCase(), companyName);
  }

  let assignmentCount = 0;
  let skippedCount = 0;

  for (const employee of employees) {
    const companyName = empMapLower.get(employee.employeeId.toLowerCase());
    if (!companyName) {
      skippedCount++;
      continue; // Not in the mapping — skip
    }

    const companyId = companyMap.get(companyName);
    if (!companyId) {
      console.warn(`  Warning: Company "${companyName}" not found for employee ${employee.employeeId}`);
      skippedCount++;
      continue;
    }

    const userId = createdUsers.get(employee.employeeId);
    if (!userId) {
      skippedCount++;
      continue;
    }

    await prisma.employeeCompanyAssignment.create({
      data: {
        userId,
        companyId,
        employeeCode: employee.employeeId,
        designation: employee.designation,
        department: employee.department,
        annualCTC: employee.annualCtc,
        employmentType: employee.employmentType,
        joiningDate: employee.dateOfJoining,
        effectiveFrom: employee.dateOfJoining ?? new Date(),
        isPrimary: true,
        status: 'ACTIVE',
        notes: 'Initial assignment from V3.1 seed',
      },
    });
    assignmentCount++;
  }
  console.log(`Created ${assignmentCount} assignments (${skippedCount} employees not in mapping)`);

  // ── V3.1: Seed PolicyVersion + PolicyRules ────────────────────────────────
  console.log('Seeding policy version with default rules...');

  const policyVersion = await prisma.policyVersion.create({
    data: {
      name: 'FY 2025-26 Policy',
      versionCode: 'POL-2025-001',
      effectiveFrom: new Date('2025-04-01'),
      isActive: true,
      publishedBy: ownerUser?.id ?? null,
      publishedAt: new Date(),
      notes: 'Initial policy version seeded with V3.1 defaults',
    },
  });

  await prisma.policyRule.createMany({
    data: DEFAULT_POLICY_RULES.map(rule => ({
      policyVersionId: policyVersion.id,
      ...rule,
    })),
  });

  console.log(`Created policy version "${policyVersion.name}" with ${DEFAULT_POLICY_RULES.length} rules`);

  // ── Summary ────────────────────────────────────────────────────────────────
  const roleCounts = employees.reduce<Record<string, number>>((acc, employee) => {
    acc[employee.role] = (acc[employee.role] ?? 0) + 1;
    return acc;
  }, {});

  console.log('\nSeed complete');
  console.log(`Employees created: ${employees.length}`);
  console.log(`Role mix: OWNER=1, ADMIN=${(roleCounts.ADMIN ?? 1) - 1}, MANAGER=${roleCounts.MANAGER ?? 0}, EMPLOYEE=${roleCounts.EMPLOYEE ?? 0}`);
  console.log(`Companies: ${COMPANIES.length}`);
  console.log(`Assignments: ${assignmentCount}`);
  console.log(`Policy rules: ${DEFAULT_POLICY_RULES.length}`);
  console.log(`FY leave balances created for ${fyYear}-${String(fyYear + 1).slice(-2)}`);
}

main()
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
