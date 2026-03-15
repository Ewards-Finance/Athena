/**
 * Athena V2 - Database Backup Library
 *
 * Runs pg_dump and pushes the SQL file to a private GitHub repository.
 * Old backups beyond BACKUP_RETAIN_DAYS are automatically deleted.
 *
 * Required .env variables:
 *   BACKUP_GITHUB_TOKEN  — GitHub Personal Access Token (repo scope)
 *   BACKUP_GITHUB_OWNER  — GitHub username or org (e.g. "ewards-finance")
 *   BACKUP_GITHUB_REPO   — Repository name (e.g. "athena-backups")
 *   BACKUP_RETAIN_DAYS   — How many days of backups to keep (default: 30)
 *   DATABASE_URL         — Already required by Prisma — reused here for pg_dump
 */

import { exec }   from 'child_process';
import { promisify } from 'util';
import os    from 'os';
import path  from 'path';
import fs    from 'fs';
import { prisma } from '../index';

const execAsync = promisify(exec);

const GITHUB_API = 'https://api.github.com';
const RETAIN_DAYS = Number(process.env.BACKUP_RETAIN_DAYS ?? 30);

export function isBackupConfigured(): boolean {
  return !!(
    process.env.BACKUP_GITHUB_TOKEN &&
    process.env.BACKUP_GITHUB_OWNER &&
    process.env.BACKUP_GITHUB_REPO
  );
}

export async function getPgDumpStatus(): Promise<{ available: boolean; message: string | null }> {
  try {
    await execAsync('pg_dump --version');
    return { available: true, message: null };
  } catch (err: any) {
    const message = String(err?.stderr || err?.message || 'pg_dump is not available on this machine').trim();
    return { available: false, message };
  }
}

// ─── GitHub helpers ───────────────────────────────────────────────────────────

function ghHeaders() {
  return {
    Authorization: `token ${process.env.BACKUP_GITHUB_TOKEN}`,
    'Content-Type': 'application/json',
    'User-Agent':   'Athena-HRMS-Backup',
    Accept:         'application/vnd.github.v3+json',
  };
}

async function ghGet(urlPath: string) {
  const res = await fetch(`${GITHUB_API}${urlPath}`, { headers: ghHeaders() });
  if (!res.ok && res.status !== 404) throw new Error(`GitHub GET ${urlPath} → ${res.status}`);
  return res.status === 404 ? null : res.json();
}

async function ghPut(urlPath: string, body: object) {
  const res = await fetch(`${GITHUB_API}${urlPath}`, {
    method:  'PUT',
    headers: ghHeaders(),
    body:    JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`GitHub PUT ${urlPath} → ${res.status}: ${err}`);
  }
  return res.json();
}

async function ghDelete(urlPath: string, body: object) {
  const res = await fetch(`${GITHUB_API}${urlPath}`, {
    method:  'DELETE',
    headers: ghHeaders(),
    body:    JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`GitHub DELETE ${urlPath} → ${res.status}`);
}

// ─── Main backup function ─────────────────────────────────────────────────────

export async function runBackup(triggeredBy: string = 'SCHEDULED'): Promise<void> {
  if (!isBackupConfigured()) throw new Error('Backup not configured. Set BACKUP_GITHUB_* env vars.');
  const pgDump = await getPgDumpStatus();
  if (!pgDump.available) throw new Error(`Backup cannot run because pg_dump is unavailable. ${pgDump.message ?? ''}`.trim());

  const owner = process.env.BACKUP_GITHUB_OWNER!;
  const repo  = process.env.BACKUP_GITHUB_REPO!;

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const fileName  = `athena-backup-${timestamp}.sql`;
  const tmpPath   = path.join(os.tmpdir(), fileName);

  let logId: string | null = null;

  // Create a pending log entry
  const log = await prisma.backupLog.create({
    data: { triggeredBy, status: 'RUNNING' },
  });
  logId = log.id;

  try {
    // ── 1. pg_dump ──────────────────────────────────────────────────────────
    const dbUrl = process.env.DATABASE_URL!;
    await execAsync(`pg_dump "${dbUrl}" -f "${tmpPath}"`);

    const content    = fs.readFileSync(tmpPath, 'utf-8');
    const b64Content = Buffer.from(content).toString('base64');
    const fileSizeKb = Math.ceil(Buffer.byteLength(content) / 1024);

    // ── 2. Push to GitHub ───────────────────────────────────────────────────
    const ghPath = `backups/${fileName}`;
    const result = await ghPut(`/repos/${owner}/${repo}/contents/${ghPath}`, {
      message: `chore: automated backup ${timestamp}`,
      content: b64Content,
    });

    const commitSha = result?.commit?.sha ?? '';

    // ── 3. Update log — SUCCESS ─────────────────────────────────────────────
    await prisma.backupLog.update({
      where: { id: logId },
      data:  { status: 'SUCCESS', commitSha, fileSizeKb, fileName },
    });

    // ── 4. Prune old backups ────────────────────────────────────────────────
    await pruneOldBackups(owner, repo);

  } catch (err: any) {
    await prisma.backupLog.update({
      where: { id: logId! },
      data:  { status: 'FAILED', error: String(err?.message ?? err).slice(0, 500) },
    });
    throw err;
  } finally {
    if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
  }
}

// ─── Prune backups older than RETAIN_DAYS ─────────────────────────────────────

async function pruneOldBackups(owner: string, repo: string) {
  try {
    const files = await ghGet(`/repos/${owner}/${repo}/contents/backups`) as any[];
    if (!Array.isArray(files)) return;

    const cutoff = Date.now() - RETAIN_DAYS * 24 * 60 * 60 * 1000;

    for (const file of files) {
      // Extract timestamp from filename: athena-backup-2026-01-15T02-00-00.sql
      const match = file.name.match(/athena-backup-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})\.sql/);
      if (!match) continue;

      const fileDate = new Date(match[1].replace(/T(\d{2})-(\d{2})-(\d{2})/, 'T$1:$2:$3'));
      if (fileDate.getTime() < cutoff) {
        await ghDelete(`/repos/${owner}/${repo}/contents/${file.path}`, {
          message: `chore: remove backup older than ${RETAIN_DAYS} days`,
          sha:     file.sha,
        }).catch(() => {}); // non-fatal
      }
    }
  } catch {
    // Pruning failure is non-fatal
  }
}
