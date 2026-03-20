/**
 * Athena V2 - System Settings Routes (Admin only)
 *
 * GET  /api/settings   - get all system settings (returns defaults if not set)
 * PUT  /api/settings   - update one or more settings
 *
 * Managed keys:
 *   extension_arrival_time   — HH:MM, cutoff on extension dates (default "11:00")
 *   half_day_cutoff_time     — HH:MM, cutoff for first-half-leave employees (default "14:30")
 *   late_warning_threshold   — int, free late arrivals before LWP kicks in (default "3")
 *   probation_duration_months — int, default probation period (default "6")
 *   notice_period_days       — int, standard notice period in days (default "30")
 */

import { Router, Response } from 'express';
import { prisma } from '../lib/prisma';
import { z }                from 'zod';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';

const router = Router();

router.use(authenticate);

// Default values — returned when a key has not been set in the DB yet
const DEFAULTS: Record<string, string> = {
  extension_arrival_time:    '11:00',
  half_day_cutoff_time:      '14:30',
  late_warning_threshold:    '3',
  probation_duration_months: '6',
  notice_period_days:        '30',
};

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

function validateSetting(key: string, value: string): string | null {
  if (key === 'extension_arrival_time' || key === 'half_day_cutoff_time') {
    return TIME_RE.test(value) ? null : `${key} must be a valid 24-hour time (HH:MM)`;
  }

  const num = Number(value);
  if (!Number.isInteger(num)) {
    return `${key} must be a whole number`;
  }

  if (key === 'late_warning_threshold') {
    return num >= 0 && num <= 31 ? null : `${key} must be between 0 and 31`;
  }

  if (key === 'probation_duration_months') {
    return num >= 1 && num <= 24 ? null : `${key} must be between 1 and 24`;
  }

  if (key === 'notice_period_days') {
    return num >= 1 && num <= 365 ? null : `${key} must be between 1 and 365`;
  }

  return null;
}

// GET /api/settings
router.get('/', authorize(['ADMIN']), async (_req, res: Response) => {
  try {
    const rows = await prisma.systemSetting.findMany();
    // Merge DB rows into defaults so all keys are always present
    const settings: Record<string, string> = { ...DEFAULTS };
    for (const row of rows) {
      settings[row.key] = row.value;
    }
    res.json(settings);
  } catch (err) {
    console.error('Get settings error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/settings — body: { key: value, ... }
router.put('/', authorize(['ADMIN']), async (req: AuthRequest, res: Response) => {
  const parsed = z.record(z.string(), z.string()).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed' });
    return;
  }

  const allowedKeys = Object.keys(DEFAULTS);
  const invalid = Object.keys(parsed.data).filter((k) => !allowedKeys.includes(k));
  if (invalid.length > 0) {
    res.status(400).json({ error: `Unknown setting keys: ${invalid.join(', ')}` });
    return;
  }

  for (const [key, value] of Object.entries(parsed.data)) {
    const validationError = validateSetting(key, value.trim());
    if (validationError) {
      res.status(400).json({ error: validationError });
      return;
    }
  }

  try {
    const ops = Object.entries(parsed.data).map(([key, value]) =>
      prisma.systemSetting.upsert({
        where:  { key },
        update: { value: value.trim(), updatedBy: req.user!.id },
        create: { key, value: value.trim(), updatedBy: req.user!.id },
      })
    );
    await prisma.$transaction(ops);

    // Return full settings after update
    const rows = await prisma.systemSetting.findMany();
    const settings: Record<string, string> = { ...DEFAULTS };
    for (const row of rows) {
      settings[row.key] = row.value;
    }
    res.json(settings);
  } catch (err) {
    console.error('Update settings error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
