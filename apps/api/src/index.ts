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

const app  = express();
const PORT = process.env.PORT || 3001;

// --- Middleware ---
// Allow any origin on the local network (192.168.x.x) plus localhost.
// For production, replace this with a strict allowlist.
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (curl, Postman) and any local network origin
    if (!origin) return callback(null, true);
    const isLocalhost = origin.includes('localhost') || origin.includes('127.0.0.1');
    const isLAN       = /^https?:\/\/192\.168\.\d+\.\d+/.test(origin);
    callback(null, isLocalhost || isLAN);
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

// --- Health check ---
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', version: '2.0.0', service: 'Athena HRMS API' });
});

// --- Global error handler ---
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error:', err.message);
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

app.listen(Number(PORT), '0.0.0.0', () => {
  console.log(`🚀 Athena API running on http://localhost:${PORT}`);
  console.log(`🌐 Network access: http://192.168.1.163:${PORT}`);
});

export default app;
