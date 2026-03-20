/**
 * Athena V2 API - Entry Point
 * Express server with CORS, JSON parsing, and route registration.
 */

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables — try local .env first, then root
dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import authRoutes        from './routes/auth';
import employeeRoutes    from './routes/employees';
import leaveRoutes       from './routes/leaves';
import claimRoutes       from './routes/claims';
import dashboardRoutes   from './routes/dashboard';
import holidayRoutes     from './routes/holidays';
import announcementRoutes  from './routes/announcements';
import leaveBalanceRoutes  from './routes/leaveBalance';
import leavePolicyRoutes   from './routes/leavePolicy';
import uploadRoutes        from './routes/upload';
import notificationRoutes  from './routes/notifications';
import payrollRoutes        from './routes/payroll';
import attendanceRoutes     from './routes/attendance';
import worklogRoutes        from './routes/worklogs';
import auditLogRoutes        from './routes/auditLogs';
import settingsRoutes         from './routes/settings';
import salaryRevisionRoutes   from './routes/salaryRevisions';
import reportsRoutes          from './routes/reports';
import documentsRoutes        from './routes/documents';
import apiKeysRoutes          from './routes/apiKeys';
import backupsRoutes          from './routes/backups';
import integrationsRoutes     from './routes/integrations';
import dailyAttendanceRoutes  from './routes/dailyAttendance';
import searchRoutes           from './routes/search';
import companyRoutes          from './routes/companies';
import assignmentRoutes       from './routes/assignments';
import policyRoutes           from './routes/policies';
import exitRoutes             from './routes/exit';
import assetRoutes            from './routes/assets';
import loanRoutes             from './routes/loans';
import compoffRoutes          from './routes/compoff';
import travelProofRoutes      from './routes/travelProof';
import cron                   from 'node-cron';
import { runBackup, isBackupConfigured } from './lib/backup';
import { prisma } from './lib/prisma';
import { createNotification } from './lib/notify';

const app  = express();
const PORT = process.env.PORT || 3001;

function getAllowedOrigins() {
  const configuredOrigins = (process.env.CORS_ORIGIN ?? process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  return configuredOrigins;
}

// --- Middleware ---
// Allow localhost/LAN during development, plus any explicit origins configured
// via CORS_ORIGIN for hosted environments such as Vercel.
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (curl, Postman) and any local network origin
    if (!origin) return callback(null, true);
    const allowedOrigins = getAllowedOrigins();
    const isLocalhost = origin.includes('localhost') || origin.includes('127.0.0.1');
    const isLAN       = /^https?:\/\/192\.168\.\d+\.\d+/.test(origin);
    const isConfigured = allowedOrigins.includes(origin);
    callback(null, isLocalhost || isLAN || isConfigured);
  },
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- Static file serving for uploaded documents ---
app.use('/uploads', express.static(path.resolve(__dirname, '../uploads')));

// --- Routes ---
app.use('/api/auth',          authRoutes);
app.use('/api/employees',     employeeRoutes);
app.use('/api/leaves',        leaveRoutes);
app.use('/api/claims',        claimRoutes);
app.use('/api/dashboard',     dashboardRoutes);
app.use('/api/holidays',      holidayRoutes);
app.use('/api/announcements',  announcementRoutes);
app.use('/api/leave-balance', leaveBalanceRoutes);
app.use('/api/leave-policy',  leavePolicyRoutes);
app.use('/api/upload',        uploadRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/payroll',       payrollRoutes);
app.use('/api/attendance',    attendanceRoutes);
app.use('/api/worklogs',     worklogRoutes);
app.use('/api/audit-logs',        auditLogRoutes);
app.use('/api/settings',          settingsRoutes);
app.use('/api/salary-revisions',  salaryRevisionRoutes);
app.use('/api/reports',           reportsRoutes);
app.use('/api/documents',         documentsRoutes);
app.use('/api/api-keys',          apiKeysRoutes);
app.use('/api/backups',           backupsRoutes);
app.use('/api/v1',                integrationsRoutes);
app.use('/api/daily-attendance',  dailyAttendanceRoutes);
app.use('/api/search',            searchRoutes);
app.use('/api/companies',         companyRoutes);
app.use('/api/assignments',       assignmentRoutes);
app.use('/api/policies',          policyRoutes);
app.use('/api/exit',              exitRoutes);
app.use('/api/assets',            assetRoutes);
app.use('/api/loans',             loanRoutes);
app.use('/api/compoff',           compoffRoutes);
app.use('/api/travel-proof',      travelProofRoutes);

// --- Health check ---
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', version: '3.1.0', service: 'Athena HRMS API' });
});

// --- Global error handler ---
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error:', err.message);
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

app.listen(Number(PORT), '0.0.0.0', () => {
  console.log(`🚀 Athena API running on http://localhost:${PORT}`);
  console.log(`🌐 Network access: http://192.168.1.163:${PORT}`);

  // ── Scheduled DB Backup ──────────────────────────────────────────────────
  // Default: daily at 2:00 AM. Override with BACKUP_CRON env var.
  // e.g. BACKUP_CRON="0 3 * * *" for 3 AM.
  if (isBackupConfigured()) {
    const schedule = process.env.BACKUP_CRON ?? '0 2 * * *';
    cron.schedule(schedule, () => {
      console.log('[backup] Running scheduled backup...');
      runBackup('SCHEDULED').catch((err) => console.error('[backup] Scheduled backup failed:', err));
    });
    console.log(`💾 Backup scheduler active (${schedule})`);
  } else {
    console.log('💾 Backup not configured (set BACKUP_GITHUB_* in .env to enable)');
  }

  // ── Comp-off expiry cron (daily at 1:00 AM) ─────────────────────────────
  cron.schedule('0 1 * * *', async () => {
    try {
      const expired = await prisma.compOff.findMany({
        where: { status: 'APPROVED', expiresAt: { lt: new Date() } },
      });
      for (const co of expired) {
        await prisma.compOff.update({ where: { id: co.id }, data: { status: 'EXPIRED' } });
        await createNotification({
          userId: co.userId,
          type: 'COMPOFF_EXPIRED',
          title: 'Comp-Off Expired',
          message: `Your comp-off earned on ${co.earnedDate.toDateString()} has expired.`,
          link: '/compoff',
        });
      }
      if (expired.length > 0) console.log(`[cron] Expired ${expired.length} comp-off(s)`);
    } catch (err) {
      console.error('[cron] Comp-off expiry error:', err);
    }
  });

  // ── Document expiry alerts (daily at 6:00 AM) ───────────────────────────
  cron.schedule('0 6 * * *', async () => {
    try {
      const thirtyDaysFromNow = new Date();
      thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      const docs = await prisma.employeeDocument.findMany({
        where: {
          expiryDate: { lte: thirtyDaysFromNow, gte: new Date() },
          OR: [
            { reminderSentAt: null },
            { reminderSentAt: { lte: sevenDaysAgo } },
          ],
        },
        include: { user: { select: { id: true, profile: { select: { firstName: true, lastName: true } } } } },
      });

      for (const doc of docs) {
        await createNotification({
          userId: doc.userId,
          type: 'DOCUMENT_EXPIRING',
          title: 'Document Expiring Soon',
          message: `Your document "${doc.name}" expires on ${doc.expiryDate!.toDateString()}. Please update it.`,
          link: '/profile',
        });
        await prisma.employeeDocument.update({
          where: { id: doc.id },
          data: { reminderSentAt: new Date() },
        });
      }
      if (docs.length > 0) console.log(`[cron] Sent ${docs.length} document expiry reminder(s)`);
    } catch (err) {
      console.error('[cron] Document expiry error:', err);
    }
  });

  // ── Travel proof morning reminder (daily at 8:00 AM) ────────────────────
  cron.schedule('0 8 * * *', async () => {
    try {
      const today    = new Date();
      today.setHours(0, 0, 0, 0);
      const todayEnd = new Date(today);
      todayEnd.setHours(23, 59, 59, 999);

      // 1. Remind employees with APPROVED TRAVELLING leave today to submit proof
      const approvedTravel = await prisma.leaveRequest.findMany({
        where: {
          leaveType: 'TRAVELLING',
          status:    'APPROVED',
          startDate: { lte: todayEnd },
          endDate:   { gte: today },
        },
        select: { id: true, employeeId: true },
      });

      for (const leave of approvedTravel) {
        const existing = await prisma.travelProof.findUnique({
          where: { leaveRequestId_proofDate: { leaveRequestId: leave.id, proofDate: today } },
        });
        if (existing) continue;
        await createNotification({
          userId:  leave.employeeId,
          type:    'TRAVEL_PROOF_REMINDER',
          title:   'Submit Your Location Proof',
          message: 'You are on approved Travelling leave today. Submit your geo location proof before midnight.',
          link:    '/dashboard',
        });
      }

      // 2. Urgently notify managers for PENDING TRAVELLING leaves starting today or already active
      const pendingTravel = await prisma.leaveRequest.findMany({
        where: {
          leaveType: 'TRAVELLING',
          status:    'PENDING',
          startDate: { lte: todayEnd },
          endDate:   { gte: today },
        },
        include: {
          employee: {
            select: {
              profile: { select: { firstName: true, lastName: true, managerId: true } },
            },
          },
        },
      });

      for (const leave of pendingTravel) {
        const profile  = leave.employee?.profile;
        const empName  = profile ? `${profile.firstName} ${profile.lastName}` : 'An employee';
        const managerId = profile?.managerId;

        // Notify the manager (or all admins if no manager assigned)
        const notifyIds: string[] = [];
        if (managerId) notifyIds.push(managerId);
        const admins = await prisma.user.findMany({
          where: { role: { in: ['ADMIN', 'OWNER'] }, isActive: true },
          select: { id: true },
        });
        for (const a of admins) {
          if (!notifyIds.includes(a.id)) notifyIds.push(a.id);
        }
        for (const uid of notifyIds) {
          await createNotification({
            userId:  uid,
            type:    'TRAVEL_APPROVAL_URGENT',
            title:   'Urgent: Approve Travelling Leave',
            message: `${empName}'s Travelling leave started today but is still pending approval. They cannot submit geo proof until you approve.`,
            link:    '/leaves',
          });
        }
      }

      if (approvedTravel.length > 0 || pendingTravel.length > 0)
        console.log(`[cron] Travel reminders: ${approvedTravel.length} proof reminder(s), ${pendingTravel.length} urgent approval(s)`);
    } catch (err) {
      console.error('[cron] Travel proof reminder error:', err);
    }
  });

  // ── Travel proof missing cron (daily at 12:05 AM) ───────────────────────
  cron.schedule('5 0 * * *', async () => {
    try {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      yesterday.setHours(0, 0, 0, 0);
      const yesterdayEnd = new Date(yesterday);
      yesterdayEnd.setHours(23, 59, 59, 999);

      // Find TRAVELLING leaves (PENDING or APPROVED) that covered yesterday
      // and check if a proof was submitted — flag employees who didn't submit
      const travelYesterday = await prisma.leaveRequest.findMany({
        where: {
          leaveType: 'TRAVELLING',
          status:    { in: ['PENDING', 'APPROVED'] },
          startDate: { lte: yesterdayEnd },
          endDate:   { gte: yesterday },
        },
        select: { id: true, employeeId: true },
      });

      const missing: { employeeId: string; leaveId: string }[] = [];
      for (const leave of travelYesterday) {
        const proof = await prisma.travelProof.findUnique({
          where: { leaveRequestId_proofDate: { leaveRequestId: leave.id, proofDate: yesterday } },
        });
        if (!proof) missing.push({ employeeId: leave.employeeId, leaveId: leave.id });
      }

      for (const m of missing) {
        // Notify the employee
        await createNotification({
          userId:  m.employeeId,
          type:    'TRAVEL_PROOF_MISSING',
          title:   'Location Proof Not Submitted',
          message: `You did not submit location proof for your travel day on ${yesterday.toDateString()}. Contact HR.`,
          link:    '/dashboard',
        });

        // Notify their manager + admins
        const profile = await prisma.profile.findUnique({
          where: { userId: m.employeeId },
          select: { firstName: true, lastName: true, managerId: true },
        });
        const empName = profile ? `${profile.firstName} ${profile.lastName}` : 'An employee';
        const notifyIds: string[] = [];
        if (profile?.managerId) notifyIds.push(profile.managerId);
        const admins = await prisma.user.findMany({
          where: { role: { in: ['ADMIN', 'OWNER'] }, isActive: true },
          select: { id: true },
        });
        for (const a of admins) {
          if (!notifyIds.includes(a.id)) notifyIds.push(a.id);
        }
        for (const uid of notifyIds) {
          await createNotification({
            userId:  uid,
            type:    'TRAVEL_PROOF_MISSING',
            title:   'Missing Travel Proof',
            message: `${empName} did not submit location proof for travel on ${yesterday.toDateString()}.`,
            link:    '/attendance',
          });
        }
      }

      if (missing.length > 0) console.log(`[cron] Flagged ${missing.length} missing travel proof(s)`);
    } catch (err) {
      console.error('[cron] Travel proof missing error:', err);
    }
  });

  console.log('⏰ Cron jobs active: comp-off expiry (1AM), doc expiry (6AM), travel proof reminder (8AM), travel proof missing (12:05AM)');
});

export default app;
