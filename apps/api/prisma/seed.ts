/**
 * Athena V2 - Database Seed Script
 * Populates the DB with 1 Admin and 2 Employees so the app isn't empty on first run.
 * Run with: npm run seed (inside apps/api)
 */

import { PrismaClient, Role } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting seed...');

  // Hash passwords with bcrypt (cost factor 10 is a good balance of security/speed)
  const adminPassword = await bcrypt.hash('Admin@123', 10);
  const empPassword   = await bcrypt.hash('Employee@123', 10);

  // --- 1. Create Admin User ---
  const admin = await prisma.user.upsert({
    where: { email: 'admin@ewards.com' },
    update: {},
    create: {
      email:    'admin@ewards.com',
      password: adminPassword,
      role:     Role.ADMIN,
      profile: {
        create: {
          firstName:     'Arjun',
          lastName:      'Sharma',
          employeeId:    'EWD-001',
          designation:   'HR Administrator',
          department:    'HR',
          dateOfJoining: new Date('2020-01-15'),
          officeLocation: 'Kolkata',
          phone:         '+91-9876543210',
          pan:           'ABRPS1234A',
          aadharNumber:  '123456789012',
          uan:           '100123456789',
          bankAccountNumber: '001234567890',
          ifscCode:      'HDFC0001234',
          bankName:      'HDFC Bank',
        },
      },
    },
  });

  // --- 2. Create Manager User (also acts as reporting manager for employees) ---
  const manager = await prisma.user.upsert({
    where: { email: 'manager@ewards.com' },
    update: {},
    create: {
      email:    'manager@ewards.com',
      password: empPassword,
      role:     Role.MANAGER,
      profile: {
        create: {
          firstName:     'Priya',
          lastName:      'Das',
          employeeId:    'EWD-002',
          designation:   'Engineering Manager',
          department:    'Tech',
          dateOfJoining: new Date('2021-03-01'),
          officeLocation: 'Kolkata',
          phone:         '+91-9876543211',
          pan:           'BCDPD5678B',
          aadharNumber:  '234567890123',
          uan:           '100234567890',
          bankAccountNumber: '002345678901',
          ifscCode:      'SBIN0001234',
          bankName:      'State Bank of India',
        },
      },
    },
  });

  // --- 3. Create Employee 1 ---
  const emp1 = await prisma.user.upsert({
    where: { email: 'rahul.verma@ewards.com' },
    update: {},
    create: {
      email:    'rahul.verma@ewards.com',
      password: empPassword,
      role:     Role.EMPLOYEE,
      profile: {
        create: {
          firstName:     'Rahul',
          lastName:      'Verma',
          employeeId:    'EWD-003',
          designation:   'Software Engineer',
          department:    'Tech',
          dateOfJoining: new Date('2022-07-15'),
          officeLocation: 'Kolkata',
          managerId:     manager.id,
          phone:         '+91-9876543212',
          pan:           'CEFPV9012C',
          aadharNumber:  '345678901234',
          uan:           '100345678901',
          bankAccountNumber: '003456789012',
          ifscCode:      'ICIC0001234',
          bankName:      'ICICI Bank',
          bloodGroup:    'B+',
          emergencyContact: '+91-9998887776',
        },
      },
    },
  });

  // --- 4. Create Employee 2 ---
  const emp2 = await prisma.user.upsert({
    where: { email: 'sneha.roy@ewards.com' },
    update: {},
    create: {
      email:    'sneha.roy@ewards.com',
      password: empPassword,
      role:     Role.EMPLOYEE,
      profile: {
        create: {
          firstName:     'Sneha',
          lastName:      'Roy',
          employeeId:    'EWD-004',
          designation:   'UI/UX Designer',
          department:    'Tech',
          dateOfJoining: new Date('2023-01-10'),
          officeLocation: 'Kolkata',
          managerId:     manager.id,
          phone:         '+91-9876543213',
          pan:           'DFGPR3456D',
          aadharNumber:  '456789012345',
          uan:           '100456789012',
          bankAccountNumber: '004567890123',
          ifscCode:      'AXIS0001234',
          bankName:      'Axis Bank',
          bloodGroup:    'O+',
          emergencyContact: '+91-9997776665',
        },
      },
    },
  });

  // --- 5. Seed Leave Balances for all users (2026) ---
  // Only Paid Leave needs a balance row. Unlimited types (LWP, WFH, Travelling) have no balance.
  const YEAR = 2026;
  for (const u of [admin, manager, emp1, emp2]) {
    await prisma.leaveBalance.upsert({
      where:  { userId_year_leaveType: { userId: u.id, year: YEAR, leaveType: 'PL' } },
      update: {},
      create: { userId: u.id, year: YEAR, leaveType: 'PL', total: 18, used: 0 },
    });
  }

  // --- 6. Seed Leave Policies (org-wide defaults) ---
  const leavePolicies = [
    { leaveType: 'PL',            label: 'Paid Leave',      defaultTotal: 18, isActive: true, isUnlimited: false },
    { leaveType: 'LWP',           label: 'Unpaid Leave',    defaultTotal: 0,  isActive: true, isUnlimited: true  },
    { leaveType: 'TEMPORARY_WFH', label: 'Temporary WFH',   defaultTotal: 0,  isActive: true, isUnlimited: true  },
    { leaveType: 'TRAVELLING',    label: 'Travelling',      defaultTotal: 0,  isActive: true, isUnlimited: true  },
  ];
  for (const p of leavePolicies) {
    await prisma.leavePolicy.upsert({
      where:  { leaveType: p.leaveType },
      update: {},
      create: p,
    });
  }

  // --- 8. Seed leave requests for demo data ---
  await prisma.leaveRequest.createMany({
    skipDuplicates: true,
    data: [
      {
        employeeId: emp1.id,
        managerId:  manager.id,
        leaveType:  'PL',
        startDate:  new Date('2026-03-10'),
        endDate:    new Date('2026-03-11'),
        totalDays:  2,
        reason:     'Personal work',
        status:     'PENDING',
      },
      {
        employeeId: emp2.id,
        managerId:  manager.id,
        leaveType:  'PL',
        startDate:  new Date('2026-03-05'),
        endDate:    new Date('2026-03-05'),
        totalDays:  1,
        reason:     'Personal day',
        status:     'APPROVED',
        managerComment: 'Approved',
        approvedAt: new Date('2026-03-04'),
      },
    ],
  });

  // --- 9. Seed Holidays ---
  await prisma.holiday.createMany({
    skipDuplicates: true,
    data: [
      { name: 'Holi',         date: new Date('2026-03-13'), type: 'National' },
      { name: 'Good Friday',  date: new Date('2026-04-03'), type: 'National' },
      { name: 'Eid-ul-Fitr',  date: new Date('2026-03-31'), type: 'National' },
      { name: 'Independence Day', date: new Date('2026-08-15'), type: 'National' },
      { name: 'Durga Puja',   date: new Date('2026-10-14'), type: 'Regional' },
      { name: 'Diwali',       date: new Date('2026-11-07'), type: 'National' },
      { name: 'Christmas',    date: new Date('2026-12-25'), type: 'National' },
    ],
  });

  // --- 10. Seed a Welcome Announcement ---
  await prisma.announcement.create({
    data: {
      title:     'Welcome to Athena V2!',
      body:      'Our new HR Management System is live. Please complete your profile and verify your statutory details. Contact HR for any issues.',
      createdBy: admin.id,
      isActive:  true,
    },
  });

  // --- 11. Seed default Payroll Components ---
  const payrollComponents = [
    { name: 'Basic Salary',          type: 'EARNING'   as const, calcType: 'PERCENTAGE_OF_CTC' as const, value: 60, order: 1 },
    { name: 'HRA',                   type: 'EARNING'   as const, calcType: 'PERCENTAGE_OF_CTC' as const, value: 25, order: 2 },
    { name: 'LTA',                   type: 'EARNING'   as const, calcType: 'PERCENTAGE_OF_CTC' as const, value: 15, order: 3 },
    { name: 'Professional Tax',      type: 'DEDUCTION' as const, calcType: 'AUTO_PT'           as const, value: 0,  order: 4 },
  ];
  for (const comp of payrollComponents) {
    await prisma.payrollComponent.upsert({
      where:  { name: comp.name },
      update: {},
      create: comp,
    });
  }

  // --- 12. Seed sample Annual CTC for all employees ---
  const ctcMap: Record<string, number> = {
    [admin.id]:   800000,   // ₹8,00,000 / year
    [manager.id]: 1200000,  // ₹12,00,000 / year
    [emp1.id]:    720000,   // ₹7,20,000 / year
    [emp2.id]:    600000,   // ₹6,00,000 / year
  };
  for (const [userId, ctc] of Object.entries(ctcMap)) {
    await prisma.profile.update({
      where: { userId },
      data:  { annualCtc: ctc },
    });
  }

  console.log('✅ Seed complete!');
  console.log(`   Admin:    admin@ewards.com / Admin@123`);
  console.log(`   Manager:  manager@ewards.com / Employee@123`);
  console.log(`   Employee: rahul.verma@ewards.com / Employee@123`);
  console.log(`   Employee: sneha.roy@ewards.com / Employee@123`);
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
