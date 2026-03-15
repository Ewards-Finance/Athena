/**
 * Athena V2 - Backup Management (Admin only)
 *
 * GET  /api/backups          — list backup history
 * POST /api/backups/run      — trigger a manual backup
 * GET  /api/backups/status   — check if GitHub backup is configured
 */

import { Router, Response }  from 'express';
import { AuthRequest, authenticate, authorize } from '../middleware/auth';
import { prisma }            from '../index';
import { runBackup, isBackupConfigured, getPgDumpStatus } from '../lib/backup';

const router = Router();
router.use(authenticate);
router.use(authorize(['ADMIN']));

// GET /api/backups/status
router.get('/status', async (_req: AuthRequest, res: Response) => {
  const pgDump = await getPgDumpStatus();
  res.json({
    configured: isBackupConfigured(),
    owner: process.env.BACKUP_GITHUB_OWNER ?? null,
    repo:  process.env.BACKUP_GITHUB_REPO  ?? null,
    retainDays: Number(process.env.BACKUP_RETAIN_DAYS ?? 30),
    pgDumpAvailable: pgDump.available,
    pgDumpMessage: pgDump.message,
  });
});

// GET /api/backups
router.get('/', async (_req: AuthRequest, res: Response) => {
  try {
    const logs = await prisma.backupLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.json(logs);
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/backups/run — manual trigger (runs async, returns immediately)
router.post('/run', async (req: AuthRequest, res: Response) => {
  if (!isBackupConfigured()) {
    res.status(400).json({ error: 'Backup not configured. Add BACKUP_GITHUB_* to your .env file.' });
    return;
  }
  const pgDump = await getPgDumpStatus();
  if (!pgDump.available) {
    res.status(400).json({ error: `Backup cannot run because pg_dump is unavailable. ${pgDump.message ?? ''}`.trim() });
    return;
  }
  // Respond immediately, run backup in background
  res.json({ message: 'Backup started. Check the backup history in a few seconds.' });

  runBackup(req.user!.id).catch((err) => {
    console.error('[backup] Manual backup failed:', err);
  });
});

export default router;
