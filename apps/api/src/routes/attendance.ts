/**
 * Athena V2 - Attendance Routes
 *
 * EnNo Mapping (Admin):
 *   GET    /api/attendance/mappings          - list all EnNo → Employee mappings
 *   POST   /api/attendance/mappings          - create mapping
 *   PUT    /api/attendance/mappings/:id      - update mapping
 *   DELETE /api/attendance/mappings/:id      - delete mapping
 *
 * Import (Admin):
 *   POST   /api/attendance/import            - upload ZKTeco .txt file, parse, save
 *   GET    /api/attendance/imports           - list all import batches
 *   DELETE /api/attendance/imports/:id       - delete import + its records
 *
 * Records (role-scoped):
 *   GET    /api/attendance/records?month=&year=   - Admin: all | Employee/Manager: own
 *   GET    /api/attendance/summary?month=&year=   - Admin only: per-employee aggregated stats
 */

import { Router, Response }    from 'express';
import { prisma } from '../lib/prisma';
import { z }                   from 'zod';
import multer                  from 'multer';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';
import { createAuditLog }      from '../lib/audit';

const router = Router();

// Memory-storage multer for .txt import (no disk write needed)
const txtUpload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 10 * 1024 * 1024 }, // 10 MB
}).single('file');

router.use(authenticate);

// ─── EnNo Mapping ─────────────────────────────────────────────────────────────

// GET /api/attendance/mappings
router.get('/mappings', authorize(['ADMIN']), async (_req, res: Response) => {
  try {
    const mappings = await prisma.punchMapping.findMany({
      include: {
        user: {
          select: {
            profile: {
              select: { firstName: true, lastName: true, employeeId: true, department: true },
            },
          },
        },
      },
      orderBy: { enNo: 'asc' },
    });
    res.json(mappings);
  } catch (err) {
    console.error('List mappings error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/attendance/mappings
router.post('/mappings', authorize(['ADMIN']), async (req: AuthRequest, res: Response) => {
  const parsed = z.object({
    enNo:   z.number().int().min(1),
    userId: z.string().min(1),
    label:  z.string().optional(),
  }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }
  try {
    const mapping = await prisma.punchMapping.create({
      data: parsed.data,
      include: {
        user: { select: { profile: { select: { firstName: true, lastName: true, employeeId: true } } } },
      },
    });
    res.status(201).json(mapping);
  } catch (err: any) {
    if (err?.code === 'P2002') {
      res.status(409).json({ error: 'This EnNo or employee is already mapped to another entry.' });
      return;
    }
    console.error('Create mapping error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/attendance/mappings/:id
router.put('/mappings/:id', authorize(['ADMIN']), async (req: AuthRequest, res: Response) => {
  const parsed = z.object({
    enNo:   z.number().int().min(1).optional(),
    userId: z.string().min(1).optional(),
    label:  z.string().optional(),
  }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }
  try {
    const updated = await prisma.punchMapping.update({
      where: { id: req.params.id },
      data:  parsed.data,
    });
    res.json(updated);
  } catch (err: any) {
    if (err?.code === 'P2025') { res.status(404).json({ error: 'Mapping not found' }); return; }
    if (err?.code === 'P2002') { res.status(409).json({ error: 'This EnNo or employee is already mapped.' }); return; }
    console.error('Update mapping error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/attendance/mappings/:id
router.delete('/mappings/:id', authorize(['ADMIN']), async (req: AuthRequest, res: Response) => {
  try {
    await prisma.punchMapping.delete({ where: { id: req.params.id } });
    res.json({ message: 'Mapping deleted' });
  } catch (err: any) {
    if (err?.code === 'P2025') { res.status(404).json({ error: 'Mapping not found' }); return; }
    console.error('Delete mapping error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Import Parsing ───────────────────────────────────────────────────────────

interface PunchGroup {
  enNo:    number;
  name:    string;
  punches: Date[];
}

function parseUdiskLog(content: string): Map<string, PunchGroup> {
  const lines  = content.split(/\r?\n/);
  const groups = new Map<string, PunchGroup>();

  // Line 0: UDISKLOG header, Line 1: column header — skip both
  for (let i = 2; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const cols = line.split('\t');
    if (cols.length < 7) continue;

    const enNo = parseInt(cols[2].trim(), 10);
    if (isNaN(enNo)) continue;

    const name  = cols[3].trim();
    const dtStr = cols[6].trim(); // "2026/01/02  09:29:50"

    // Parse "YYYY/MM/DD  HH:MM:SS"
    const m = dtStr.match(/^(\d{4})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/);
    if (!m) continue;

    const [, yr, mo, dy, hh, mm, ss] = m;
    const dt = new Date(`${yr}-${mo}-${dy}T${hh}:${mm}:${ss}`);
    if (isNaN(dt.getTime())) continue;

    const groupKey = `${enNo}_${yr}-${mo}-${dy}`;
    if (!groups.has(groupKey)) {
      groups.set(groupKey, { enNo, name, punches: [] });
    }
    groups.get(groupKey)!.punches.push(dt);
  }

  return groups;
}

// POST /api/attendance/import
router.post('/import', authorize(['ADMIN']), (req: AuthRequest, res: Response) => {
  txtUpload(req as any, res as any, async (err) => {
    if (err) {
      res.status(400).json({ error: err.message || 'File upload failed' });
      return;
    }
    if (!req.file) {
      res.status(400).json({ error: 'No file uploaded. Send the .txt file as form-data field "file".' });
      return;
    }

    const fileName = req.file.originalname;
    const content  = req.file.buffer.toString('utf-8');

    try {
      const groups = parseUdiskLog(content);
      if (groups.size === 0) {
        res.status(400).json({ error: 'No valid punch records found in the file.' });
        return;
      }

      // Determine month/year from the earliest date in the data
      let earliestDate: Date | null = null;
      for (const { punches } of groups.values()) {
        for (const p of punches) {
          if (!earliestDate || p < earliestDate) earliestDate = p;
        }
      }
      const month = earliestDate!.getMonth() + 1;
      const year  = earliestDate!.getFullYear();

      // Block re-import of same month/year
      const existing = await prisma.attendanceImport.findUnique({
        where: { month_year: { month, year } },
      });
      const MONTH_NAMES = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      if (existing) {
        res.status(409).json({
          error: `Attendance for ${MONTH_NAMES[month]} ${year} already exists. Delete the existing import first to re-import.`,
        });
        return;
      }

      // Load all current punch mappings
      const allMappings   = await prisma.punchMapping.findMany({ select: { enNo: true, userId: true } });
      const enNoToUser    = new Map(allMappings.map((m) => [m.enNo, m.userId]));

      // Build records and collect unmapped EnNos
      const records: Array<{
        userId:      string;
        date:        Date;
        checkIn:     Date;
        checkOut?:   Date;
        hoursWorked?: number;
      }> = [];
      const unmappedSet = new Set<number>();

      for (const { enNo, punches } of groups.values()) {
        const userId = enNoToUser.get(enNo);
        if (!userId) {
          unmappedSet.add(enNo);
          continue;
        }

        punches.sort((a, b) => a.getTime() - b.getTime());
        const checkIn   = punches[0];
        const checkOut  = punches.length > 1 ? punches[punches.length - 1] : undefined;
        const hoursWorked = checkOut
          ? Math.round(((checkOut.getTime() - checkIn.getTime()) / 3_600_000) * 100) / 100
          : undefined;

        // Normalise to midnight UTC of that day
        const date = new Date(Date.UTC(checkIn.getFullYear(), checkIn.getMonth(), checkIn.getDate()));

        records.push({ userId, date, checkIn, checkOut, hoursWorked });
      }

      // Save in a transaction
      const batch = await prisma.$transaction(async (tx) => {
        const importBatch = await tx.attendanceImport.create({
          data: {
            month,
            year,
            fileName,
            importedBy:    req.user!.id,
            recordCount:   records.length,
            unmappedEnNos: Array.from(unmappedSet).sort((a, b) => a - b),
          },
        });

        if (records.length > 0) {
          await tx.attendanceRecord.createMany({
            data: records.map((r) => ({
              userId:      r.userId,
              importId:    importBatch.id,
              date:        r.date,
              checkIn:     r.checkIn,
              checkOut:    r.checkOut,
              hoursWorked: r.hoursWorked,
            })),
            skipDuplicates: true,
          });
        }

        return importBatch;
      });

      res.status(201).json({
        importId:      batch.id,
        month,
        year,
        saved:         records.length,
        unmappedEnNos: Array.from(unmappedSet).sort((a, b) => a - b),
      });
    } catch (err) {
      console.error('Import error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });
});

// GET /api/attendance/imports
router.get('/imports', authorize(['ADMIN']), async (_req, res: Response) => {
  try {
    const imports = await prisma.attendanceImport.findMany({
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
      include: { _count: { select: { records: true } } },
    });
    res.json(imports);
  } catch (err) {
    console.error('List imports error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/attendance/imports/:id
router.delete('/imports/:id', authorize(['ADMIN']), async (req: AuthRequest, res: Response) => {
  try {
    await prisma.attendanceImport.delete({ where: { id: req.params.id } });
    res.json({ message: 'Import and all associated records deleted' });
  } catch (err: any) {
    if (err?.code === 'P2025') { res.status(404).json({ error: 'Import not found' }); return; }
    console.error('Delete import error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Records ──────────────────────────────────────────────────────────────────

// GET /api/attendance/records?month=1&year=2026
router.get('/records', async (req: AuthRequest, res: Response) => {
  const parsed = z.object({
    month: z.coerce.number().int().min(1).max(12),
    year:  z.coerce.number().int().min(2020).max(2100),
  }).safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: 'Valid month (1-12) and year query params are required' });
    return;
  }
  const { month, year } = parsed.data;
  const startOfMonth = new Date(Date.UTC(year, month - 1, 1));
  const endOfMonth   = new Date(Date.UTC(year, month, 0, 23, 59, 59));

  try {
    const where: any = { date: { gte: startOfMonth, lte: endOfMonth } };
    if (req.user!.role !== 'ADMIN') {
      where.userId = req.user!.id;
    }

    const records = await prisma.attendanceRecord.findMany({
      where,
      include: {
        user: {
          select: {
            profile: {
              select: { firstName: true, lastName: true, employeeId: true, department: true },
            },
          },
        },
      },
      orderBy: [{ user: { profile: { employeeId: 'asc' } } }, { date: 'asc' }],
    });
    res.json(records);
  } catch (err) {
    console.error('Get records error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/attendance/summary?month=1&year=2026
router.get('/summary', authorize(['ADMIN']), async (req: AuthRequest, res: Response) => {
  const parsed = z.object({
    month: z.coerce.number().int().min(1).max(12),
    year:  z.coerce.number().int().min(2020).max(2100),
  }).safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: 'Valid month (1-12) and year query params are required' });
    return;
  }
  const { month, year } = parsed.data;
  const startOfMonth = new Date(Date.UTC(year, month - 1, 1));
  const endOfMonth   = new Date(Date.UTC(year, month, 0, 23, 59, 59));

  // Count Saturdays + Sundays in the month (auto-present for all employees)
  const daysInMonth = new Date(year, month, 0).getDate();
  let weekendDays = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const dow = new Date(year, month - 1, d).getDay();
    if (dow === 0 || dow === 6) weekendDays++;
  }

  try {
    const records = await prisma.attendanceRecord.findMany({
      where:   { date: { gte: startOfMonth, lte: endOfMonth } },
      include: {
        user: {
          select: {
            profile: {
              select: { firstName: true, lastName: true, employeeId: true, department: true },
            },
          },
        },
      },
    });

    const byUser = new Map<string, {
      userId:            string;
      profile:           any;
      daysPresent:       number;
      weekendDays:       number;
      totalHours:        number;
      lateCount:         number;
      totalLwpDeduction: number;
    }>();

    for (const r of records) {
      if (!byUser.has(r.userId)) {
        byUser.set(r.userId, {
          userId: r.userId, profile: r.user.profile,
          daysPresent: 0, weekendDays, totalHours: 0, lateCount: 0, totalLwpDeduction: 0,
        });
      }
      const entry = byUser.get(r.userId)!;
      entry.daysPresent       += 1;
      entry.totalHours        += r.hoursWorked ?? 0;
      entry.lateCount         += r.isLate ? 1 : 0;
      entry.totalLwpDeduction += r.lwpDeduction;
    }

    const summary = Array.from(byUser.values())
      .map((e) => ({
        ...e,
        daysPresent:       e.daysPresent + e.weekendDays,
        weekdayDaysPresent: e.daysPresent,
        totalHours:        Math.round(e.totalHours * 100) / 100,
        totalLwpDeduction: Math.round(e.totalLwpDeduction * 100) / 100,
        avgHours:          e.daysPresent > 0
          ? Math.round((e.totalHours / e.daysPresent) * 100) / 100
          : 0,
      }))
      .sort((a, b) => (a.profile?.employeeId ?? '').localeCompare(b.profile?.employeeId ?? ''));

    res.json(summary);
  } catch (err) {
    console.error('Summary error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Extension Dates ──────────────────────────────────────────────────────────

/**
 * PUT /api/attendance/imports/:id/extension-dates
 * HR sets the extension dates for an import batch.
 * On extension dates the late cutoff is fixed at 11:00 AM.
 * Saving new dates clears arrivalTime to force re-applying late policy.
 */
router.put('/imports/:id/extension-dates', authorize(['ADMIN']), async (req: AuthRequest, res: Response) => {
  const parsed = z.object({
    dates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Each date must be YYYY-MM-DD')).max(31),
  }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }

  try {
    const importBatch = await prisma.attendanceImport.findUnique({ where: { id: req.params.id } });
    if (!importBatch) { res.status(404).json({ error: 'Import not found' }); return; }

    // Validate all dates belong to this import's month/year
    const { month, year } = importBatch;
    for (const d of parsed.data.dates) {
      const dt = new Date(d + 'T00:00:00.000Z');
      if (dt.getUTCMonth() + 1 !== month || dt.getUTCFullYear() !== year) {
        res.status(400).json({ error: `Date ${d} is outside ${month}/${year}` });
        return;
      }
    }

    // Deduplicate and sort
    const unique = Array.from(new Set(parsed.data.dates)).sort();

    const updated = await prisma.attendanceImport.update({
      where: { id: req.params.id },
      data:  { extensionDates: unique, arrivalTime: null }, // clear so policy must be re-applied
    });

    res.json({ extensionDates: updated.extensionDates });
  } catch (err) {
    console.error('PUT extension-dates error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Late Policy ──────────────────────────────────────────────────────────────

// POST /api/attendance/imports/:id/apply-late-policy
router.post('/imports/:id/apply-late-policy', authorize(['ADMIN']), async (req: AuthRequest, res: Response) => {
  const parsed = z.object({
    arrivalTime: z.string().regex(/^\d{2}:\d{2}$/, 'Format must be HH:MM'),
  }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }
  const { arrivalTime } = parsed.data;
  const [arrHour, arrMin] = arrivalTime.split(':').map(Number);

  // Read configurable settings (fall back to hardcoded defaults if not in DB)
  const settingRows = await prisma.systemSetting.findMany({
    where: { key: { in: ['half_day_cutoff_time', 'late_warning_threshold'] } },
  });
  const settingMap = Object.fromEntries(settingRows.map((s) => [s.key, s.value]));
  const halfDayTime = (settingMap['half_day_cutoff_time'] || '14:30').split(':').map(Number);
  const HALF_DAY_HOUR = halfDayTime[0];
  const HALF_DAY_MIN  = halfDayTime[1];
  const LATE_FREE_COUNT = parseInt(settingMap['late_warning_threshold'] || '3', 10);

  try {
    const importBatch = await prisma.attendanceImport.findUnique({
      where:   { id: req.params.id },
      include: { records: { orderBy: [{ userId: 'asc' }, { date: 'asc' }] } },
    });
    if (!importBatch) {
      res.status(404).json({ error: 'Import not found' });
      return;
    }

    // Extension dates: cutoff from settings (default 11:00 AM)
    const extSettingRow = await prisma.systemSetting.findUnique({ where: { key: 'extension_arrival_time' } });
    const extTimeParts  = (extSettingRow?.value || '11:00').split(':').map(Number);
    const EXTENSION_HOUR = extTimeParts[0];
    const EXTENSION_MIN  = extTimeParts[1];
    const extensionDateSet = new Set<string>(
      (importBatch.extensionDates as string[] ?? [])
    );

    // Block if payroll is already finalized for this month
    const payrollRun = await prisma.payrollRun.findFirst({
      where: { month: importBatch.month, year: importBatch.year, status: 'FINALIZED' },
    });
    if (payrollRun) {
      res.status(400).json({ error: 'Cannot modify late policy — payroll for this month is already finalized.' });
      return;
    }

    // Load all approved first-half leaves for this month
    const monthStart = new Date(Date.UTC(importBatch.year, importBatch.month - 1, 1));
    const monthEnd   = new Date(Date.UTC(importBatch.year, importBatch.month, 0, 23, 59, 59));
    const firstHalfLeaves = await prisma.leaveRequest.findMany({
      where: {
        status:        'APPROVED',
        startDate:     { lte: monthEnd },
        endDate:       { gte: monthStart },
        singleDayType: 'FIRST_HALF',
      },
      select: { employeeId: true, startDate: true },
    });

    // Build Set of "userId_YYYY-MM-DD" for first-half leave days
    const firstHalfSet = new Set<string>();
    for (const l of firstHalfLeaves) {
      const d = l.startDate;
      const key = `${l.employeeId}_${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
      firstHalfSet.add(key);
    }

    // Determine isLate for each record (records already sorted by userId + date)
    const withLate: Array<{ id: string; userId: string; isLate: boolean }> = [];
    for (const record of importBatch.records) {
      const effectiveCheckIn = record.checkInManual ?? record.checkIn;
      if (!effectiveCheckIn) {
        withLate.push({ id: record.id, userId: record.userId, isLate: false });
        continue;
      }

      const yy      = record.date.getUTCFullYear();
      const mm      = String(record.date.getUTCMonth() + 1).padStart(2, '0');
      const dd      = String(record.date.getUTCDate()).padStart(2, '0');
      const dateKey = `${record.userId}_${yy}-${mm}-${dd}`;
      const dateStr = `${yy}-${mm}-${dd}`;

      const isFirstHalf     = firstHalfSet.has(dateKey);
      const isExtensionDate = extensionDateSet.has(dateStr);

      const ciHour = effectiveCheckIn.getHours();
      const ciMin  = effectiveCheckIn.getMinutes();
      let isLate: boolean;

      if (isFirstHalf) {
        // First-half-off employees always use 2:00 PM cutoff — extension dates don't change this
        isLate = ciHour > HALF_DAY_HOUR || (ciHour === HALF_DAY_HOUR && ciMin > HALF_DAY_MIN);
      } else if (isExtensionDate) {
        // Extension day (not on first-half leave): fixed 11:00 AM cutoff
        isLate = ciHour > EXTENSION_HOUR || (ciHour === EXTENSION_HOUR && ciMin > EXTENSION_MIN);
      } else {
        // Regular day, no first-half leave: standard arrival time cutoff
        isLate = ciHour > arrHour || (ciHour === arrHour && ciMin > arrMin);
      }

      withLate.push({ id: record.id, userId: record.userId, isLate });
    }

    // Assign LWP deductions: first N lates per employee = 0, (N+1)th onwards = 0.5 each
    // N is controlled by late_warning_threshold setting (default 3)
    const runningLate = new Map<string, number>();
    const finalUpdates: Array<{ id: string; isLate: boolean; lwpDeduction: number }> = [];
    for (const r of withLate) {
      let lwpDeduction = 0;
      if (r.isLate) {
        const count = (runningLate.get(r.userId) ?? 0) + 1;
        runningLate.set(r.userId, count);
        if (count > LATE_FREE_COUNT) lwpDeduction = 0.5;
      }
      finalUpdates.push({ id: r.id, isLate: r.isLate, lwpDeduction });
    }

    // Apply all updates + store arrival time in a single transaction
    await prisma.$transaction([
      ...finalUpdates.map((u) =>
        prisma.attendanceRecord.update({
          where: { id: u.id },
          data:  { isLate: u.isLate, lwpDeduction: u.lwpDeduction },
        })
      ),
      prisma.attendanceImport.update({
        where: { id: req.params.id },
        data:  { arrivalTime },
      }),
    ]);

    const totalLate = finalUpdates.filter((u) => u.isLate).length;
    const totalLwp  = finalUpdates.reduce((s, u) => s + u.lwpDeduction, 0);
    res.json({ arrivalTime, totalLateRecords: totalLate, totalLwpDeductions: totalLwp });
  } catch (err) {
    console.error('Apply late policy error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/attendance/records/:id — HR manual check-in correction
router.put('/records/:id', authorize(['ADMIN']), async (req: AuthRequest, res: Response) => {
  const parsed = z.object({
    checkInManual: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/).nullable(),
  }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }
  try {
    const record = await prisma.attendanceRecord.findUnique({
      where:   { id: req.params.id },
      include: {
        import: { select: { month: true, year: true } },
        user: {
          select: {
            profile: { select: { firstName: true, lastName: true, employeeId: true } },
          },
        },
      },
    });
    if (!record) { res.status(404).json({ error: 'Record not found' }); return; }

    const payrollRun = await prisma.payrollRun.findFirst({
      where: { month: record.import.month, year: record.import.year, status: 'FINALIZED' },
    });
    if (payrollRun) {
      res.status(400).json({ error: 'Cannot modify attendance — payroll for this month is already finalized.' });
      return;
    }

    const updated = await prisma.attendanceRecord.update({
      where: { id: req.params.id },
      data:  {
        checkInManual: parsed.data.checkInManual ? new Date(parsed.data.checkInManual) : null,
        // Reset late flags — HR must re-apply late policy after correction
        isLate:       false,
        lwpDeduction: 0,
      },
    });
    // Clear the import's arrivalTime so UI signals policy needs re-applying
    await prisma.attendanceImport.update({
      where: { id: record.importId },
      data:  { arrivalTime: null },
    });

    await createAuditLog({
      actorId:   req.user!.id,
      action:    'ATTENDANCE_CORRECTED',
      entity:    'AttendanceRecord',
      entityId:  req.params.id,
      subjectEntity: 'User',
      subjectId: record.userId,
      subjectLabel: record.user?.profile
        ? `${record.user.profile.firstName} ${record.user.profile.lastName} (${record.user.profile.employeeId})`
        : record.userId,
      subjectMeta: {
        employeeId: record.user?.profile?.employeeId,
        attendanceDate: record.date,
      },
      oldValues: { checkInManual: record.checkInManual },
      newValues: { checkInManual: parsed.data.checkInManual },
    });

    res.json(updated);
  } catch (err: any) {
    if (err?.code === 'P2025') { res.status(404).json({ error: 'Record not found' }); return; }
    console.error('Update record check-in error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Absence Auto-Marking ─────────────────────────────────────────────────────

/**
 * POST /api/attendance/mark-absences
 * Body: { fromDate: "YYYY-MM-DD", toDate: "YYYY-MM-DD" }
 * For each working day in the range:
 *   - Skip Sundays
 *   - Skip holidays
 *   - For each active employee with no attendance record AND no approved leave → create AbsenceRecord
 * Returns summary of how many absence records were created.
 */
router.post('/mark-absences', authorize(['ADMIN']), async (req: AuthRequest, res: Response) => {
  const parsed = z.object({
    fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    toDate:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'fromDate and toDate required in YYYY-MM-DD format' });
    return;
  }

  const from = new Date(parsed.data.fromDate + 'T00:00:00.000Z');
  const to   = new Date(parsed.data.toDate   + 'T00:00:00.000Z');
  if (to < from) {
    res.status(400).json({ error: 'toDate must be >= fromDate' });
    return;
  }
  // Limit to 31 days to prevent abuse
  const diffDays = Math.round((to.getTime() - from.getTime()) / (24 * 3600 * 1000)) + 1;
  if (diffDays > 31) {
    res.status(400).json({ error: 'Date range cannot exceed 31 days' });
    return;
  }

  try {
    // Load holidays in range
    const holidays = await prisma.holiday.findMany({
      where: { date: { gte: from, lte: new Date(to.getTime() + 86400000) } },
      select: { date: true },
    });
    const holidaySet = new Set(holidays.map((h) => h.date.toISOString().slice(0, 10)));

    // Load active employees
    const activeUsers = await prisma.user.findMany({
      where:  { isActive: true },
      select: { id: true },
    });

    // Collect all dates to process (skip Sundays and holidays)
    const workingDates: Date[] = [];
    const cursor = new Date(from);
    while (cursor <= to) {
      const dow     = cursor.getUTCDay();   // 0 = Sunday, 6 = Saturday
      const dateStr = cursor.toISOString().slice(0, 10);
      // Skip Sundays and Saturdays: Saturday compliance is handled separately
      // via the Saturday worklog/fingerprint policy at payroll run time.
      // Skip holidays too.
      if (dow !== 0 && dow !== 6 && !holidaySet.has(dateStr)) {
        workingDates.push(new Date(cursor));
      }
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    if (workingDates.length === 0) {
      res.json({ message: 'No working days in the selected range', created: 0 });
      return;
    }

    // Load existing attendance records for the range
    const existingRecords = await prisma.attendanceRecord.findMany({
      where: { date: { gte: from, lte: to } },
      select: { userId: true, date: true },
    });
    const attendanceSet = new Set(existingRecords.map((r) => `${r.userId}_${r.date.toISOString().slice(0, 10)}`));

    // Load existing absence records for the range (avoid duplicates)
    const existingAbsences = await prisma.absenceRecord.findMany({
      where: { date: { gte: from, lte: to } },
      select: { userId: true, date: true },
    });
    const absenceSet = new Set(existingAbsences.map((r) => `${r.userId}_${r.date.toISOString().slice(0, 10)}`));

    // Load approved leaves in range
    const approvedLeaves = await prisma.leaveRequest.findMany({
      where: {
        status:    'APPROVED',
        startDate: { lte: to },
        endDate:   { gte: from },
      },
      select: { employeeId: true, startDate: true, endDate: true },
    });

    // Build a Set of "userId_YYYY-MM-DD" for approved leave days
    const leaveSet = new Set<string>();
    for (const l of approvedLeaves) {
      const lStart = new Date(l.startDate);
      const lEnd   = new Date(l.endDate);
      const lCursor = new Date(lStart);
      while (lCursor <= lEnd) {
        leaveSet.add(`${l.employeeId}_${lCursor.toISOString().slice(0, 10)}`);
        lCursor.setUTCDate(lCursor.getUTCDate() + 1);
      }
    }

    // Create absence records
    const toCreate: { userId: string; date: Date; markedBy: string }[] = [];
    for (const date of workingDates) {
      const dateStr = date.toISOString().slice(0, 10);
      for (const user of activeUsers) {
        const key = `${user.id}_${dateStr}`;
        if (!attendanceSet.has(key) && !leaveSet.has(key) && !absenceSet.has(key)) {
          toCreate.push({ userId: user.id, date, markedBy: req.user!.id });
        }
      }
    }

    if (toCreate.length > 0) {
      await prisma.absenceRecord.createMany({ data: toCreate, skipDuplicates: true });
    }

    res.json({
      message:      `Absence marking complete. ${toCreate.length} absence record(s) created.`,
      created:      toCreate.length,
      workingDays:  workingDates.length,
      employees:    activeUsers.length,
    });
  } catch (err) {
    console.error('Mark absences error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Attendance Adjustments ───────────────────────────────────────────────────

// GET /api/attendance/adjustments?month=&year= — get all adjustments for a month (Admin)
router.get('/adjustments', authorize(['ADMIN']), async (req: AuthRequest, res: Response) => {
  const parsed = z.object({
    month: z.coerce.number().int().min(1).max(12),
    year:  z.coerce.number().int().min(2020).max(2100),
  }).safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: 'Valid month and year required' });
    return;
  }
  try {
    const adjustments = await prisma.attendanceAdjustment.findMany({
      where: { month: parsed.data.month, year: parsed.data.year },
    });
    res.json(adjustments);
  } catch (err) {
    console.error('Get adjustments error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/attendance/adjustments/:userId — set/update adjustment for employee+month (Admin)
router.put('/adjustments/:userId', authorize(['ADMIN']), async (req: AuthRequest, res: Response) => {
  const { userId } = req.params;
  const parsed = z.object({
    month:          z.number().int().min(1).max(12),
    year:           z.number().int().min(2020).max(2100),
    adjustmentDays: z.number(),
    reason:         z.string().optional(),
  }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }

  const { month, year, adjustmentDays, reason } = parsed.data;

  // If adjustmentDays is 0, delete the record (clean up)
  if (adjustmentDays === 0) {
    try {
      await prisma.attendanceAdjustment.deleteMany({ where: { userId, month, year } });
      res.json({ message: 'Adjustment cleared' });
    } catch (err) {
      console.error('Clear adjustment error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
    return;
  }

  try {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) { res.status(404).json({ error: 'Employee not found' }); return; }

    const adj = await prisma.attendanceAdjustment.upsert({
      where:  { userId_month_year: { userId, month, year } },
      update: { adjustmentDays, reason: reason ?? null, createdBy: req.user!.id },
      create: { userId, month, year, adjustmentDays, reason: reason ?? null, createdBy: req.user!.id },
    });
    res.json(adj);
  } catch (err) {
    console.error('Set adjustment error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/attendance/absences?month=&year= — list absence records for a month (Admin)
router.get('/absences', authorize(['ADMIN']), async (req: AuthRequest, res: Response) => {
  const parsed = z.object({
    month: z.coerce.number().int().min(1).max(12),
    year:  z.coerce.number().int().min(2020).max(2100),
  }).safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: 'Valid month and year required' });
    return;
  }
  const { month, year } = parsed.data;
  const startOfMonth = new Date(Date.UTC(year, month - 1, 1));
  const endOfMonth   = new Date(Date.UTC(year, month, 0, 23, 59, 59));

  try {
    const absences = await prisma.absenceRecord.findMany({
      where: { date: { gte: startOfMonth, lte: endOfMonth } },
      include: {
        user: { select: { profile: { select: { firstName: true, lastName: true, employeeId: true, department: true } } } },
      },
      orderBy: [{ date: 'asc' }, { user: { profile: { employeeId: 'asc' } } }],
    });
    res.json(absences);
  } catch (err) {
    console.error('Get absences error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Exception Inbox ─────────────────────────────────────────────────────────

// GET /api/attendance/exceptions?month=&year= — grouped anomalies
router.get('/exceptions', authorize(['ADMIN']), async (req: AuthRequest, res: Response) => {
  const parsed = z.object({
    month: z.coerce.number().int().min(1).max(12),
    year:  z.coerce.number().int().min(2020).max(2100),
  }).safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: 'Valid month and year required' });
    return;
  }
  const { month, year } = parsed.data;
  const startOfMonth = new Date(Date.UTC(year, month - 1, 1));
  const endOfMonth   = new Date(Date.UTC(year, month, 0, 23, 59, 59));

  try {
    const records = await prisma.attendanceRecord.findMany({
      where: { date: { gte: startOfMonth, lte: endOfMonth } },
      include: {
        user: {
          select: {
            profile: { select: { firstName: true, lastName: true, employeeId: true, department: true } },
          },
        },
      },
    });

    // 1. Missing punch: checkIn exists but no checkOut
    const missingPunch = records
      .filter(r => r.checkIn && !r.checkOut)
      .map(r => ({
        id: r.id, userId: r.userId, date: r.date,
        checkIn: r.checkIn, profile: r.user?.profile,
      }));

    // 2. Late marks: group by user, count lates
    const lateByUser = new Map<string, { profile: any; count: number; dates: Date[] }>();
    for (const r of records) {
      if (r.isLate) {
        if (!lateByUser.has(r.userId)) {
          lateByUser.set(r.userId, { profile: r.user?.profile, count: 0, dates: [] });
        }
        const entry = lateByUser.get(r.userId)!;
        entry.count++;
        entry.dates.push(r.date);
      }
    }
    const lateMark = Array.from(lateByUser.entries()).map(([userId, data]) => ({
      userId, ...data,
    }));

    // 3. Half-day mismatch: approved half-day leaves but full-day attendance (>6h)
    const halfDayLeaves = await prisma.leaveRequest.findMany({
      where: {
        status: 'APPROVED',
        startDate: { lte: endOfMonth },
        endDate: { gte: startOfMonth },
        singleDayType: { in: ['FIRST_HALF', 'SECOND_HALF'] },
      },
      select: { employeeId: true, startDate: true, singleDayType: true },
    });
    const halfDayMismatch: any[] = [];
    for (const leave of halfDayLeaves) {
      const dateStr = leave.startDate.toISOString().slice(0, 10);
      const matchingRecord = records.find(
        r => r.userId === leave.employeeId && r.date.toISOString().slice(0, 10) === dateStr
      );
      if (matchingRecord && matchingRecord.hoursWorked && matchingRecord.hoursWorked > 6) {
        halfDayMismatch.push({
          userId: leave.employeeId, date: leave.startDate,
          leaveType: leave.singleDayType, hoursWorked: matchingRecord.hoursWorked,
          profile: matchingRecord.user?.profile,
        });
      }
    }

    // 4. Unmapped employees: active users with punch mapping but no record this month
    const allMappings = await prisma.punchMapping.findMany({ select: { userId: true, enNo: true } });
    const usersWithRecords = new Set(records.map(r => r.userId));
    const unmappedEmployees = [];
    for (const mapping of allMappings) {
      if (!usersWithRecords.has(mapping.userId)) {
        const user = await prisma.user.findUnique({
          where: { id: mapping.userId },
          select: { isActive: true, profile: { select: { firstName: true, lastName: true, employeeId: true } } },
        });
        if (user?.isActive) {
          unmappedEmployees.push({ userId: mapping.userId, enNo: mapping.enNo, profile: user.profile });
        }
      }
    }

    res.json({ missingPunch, lateMark, halfDayMismatch, unmappedEmployees });
  } catch (err) {
    console.error('Exceptions error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Import Preview / Commit / Rollback ──────────────────────────────────────

// POST /api/attendance/import/preview — parse file without committing
router.post('/import/preview', authorize(['ADMIN']), (req: AuthRequest, res: Response) => {
  txtUpload(req as any, res as any, async (err) => {
    if (err) { res.status(400).json({ error: err.message || 'File upload failed' }); return; }
    if (!req.file) { res.status(400).json({ error: 'No file uploaded' }); return; }

    const fileName = req.file.originalname;
    const content  = req.file.buffer.toString('utf-8');

    try {
      const groups = parseUdiskLog(content);
      if (groups.size === 0) {
        res.status(400).json({ error: 'No valid punch records found in the file.' });
        return;
      }

      let earliestDate: Date | null = null;
      for (const { punches } of groups.values()) {
        for (const p of punches) {
          if (!earliestDate || p < earliestDate) earliestDate = p;
        }
      }
      const month = earliestDate!.getMonth() + 1;
      const year  = earliestDate!.getFullYear();

      // Check if already imported
      const existing = await prisma.attendanceImport.findUnique({
        where: { month_year: { month, year } },
      });
      const MONTH_NAMES = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      if (existing) {
        res.status(409).json({
          error: `Attendance for ${MONTH_NAMES[month]} ${year} already exists. Delete existing import first.`,
        });
        return;
      }

      // Load mappings
      const allMappings = await prisma.punchMapping.findMany({ select: { enNo: true, userId: true } });
      const enNoToUser  = new Map(allMappings.map(m => [m.enNo, m.userId]));

      const parsedRecords: any[] = [];
      const unmappedSet = new Set<number>();

      for (const { enNo, punches } of groups.values()) {
        const userId = enNoToUser.get(enNo);
        if (!userId) { unmappedSet.add(enNo); continue; }

        punches.sort((a, b) => a.getTime() - b.getTime());
        const checkIn  = punches[0];
        const checkOut = punches.length > 1 ? punches[punches.length - 1] : undefined;
        const hoursWorked = checkOut
          ? Math.round(((checkOut.getTime() - checkIn.getTime()) / 3_600_000) * 100) / 100
          : undefined;
        const date = new Date(Date.UTC(checkIn.getFullYear(), checkIn.getMonth(), checkIn.getDate()));

        parsedRecords.push({ userId, date: date.toISOString(), checkIn: checkIn.toISOString(), checkOut: checkOut?.toISOString(), hoursWorked });
      }

      // Store in ImportBatch for later commit
      const batch = await prisma.importBatch.create({
        data: {
          type: 'ATTENDANCE',
          uploadedBy: req.user!.id,
          fileName,
          totalRows: parsedRecords.length,
          status: 'PREVIEWED',
          notes: JSON.stringify({ month, year, records: parsedRecords, unmappedEnNos: Array.from(unmappedSet) }),
        },
      });

      res.json({
        batchId: batch.id,
        month, year,
        totalRows: parsedRecords.length,
        unmappedEnNos: Array.from(unmappedSet).sort((a, b) => a - b),
        sampleRecords: parsedRecords.slice(0, 10),
      });
    } catch (err) {
      console.error('Import preview error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });
});

// POST /api/attendance/import/commit/:batchId — commit previewed batch
router.post('/import/commit/:batchId', authorize(['ADMIN']), async (req: AuthRequest, res: Response) => {
  try {
    const batch = await prisma.importBatch.findUnique({ where: { id: req.params.batchId } });
    if (!batch) { res.status(404).json({ error: 'Import batch not found' }); return; }
    if (batch.status !== 'PREVIEWED') {
      res.status(400).json({ error: `Batch is ${batch.status}, cannot commit` });
      return;
    }
    if (batch.type !== 'ATTENDANCE') {
      res.status(400).json({ error: 'Batch is not an attendance import' });
      return;
    }

    const data = JSON.parse(batch.notes || '{}');
    const { month, year, records, unmappedEnNos } = data;

    if (!records || records.length === 0) {
      res.status(400).json({ error: 'No records to import' });
      return;
    }

    // Block if already imported for this month
    const existing = await prisma.attendanceImport.findUnique({
      where: { month_year: { month, year } },
    });
    if (existing) {
      res.status(409).json({ error: 'Attendance for this month was already imported' });
      return;
    }

    const result = await prisma.$transaction(async (tx) => {
      const importBatch = await tx.attendanceImport.create({
        data: {
          month, year,
          fileName: batch.fileName,
          importedBy: req.user!.id,
          recordCount: records.length,
          unmappedEnNos: unmappedEnNos || [],
        },
      });

      if (records.length > 0) {
        await tx.attendanceRecord.createMany({
          data: records.map((r: any) => ({
            userId: r.userId,
            importId: importBatch.id,
            date: new Date(r.date),
            checkIn: r.checkIn ? new Date(r.checkIn) : null,
            checkOut: r.checkOut ? new Date(r.checkOut) : null,
            hoursWorked: r.hoursWorked,
          })),
          skipDuplicates: true,
        });
      }

      await tx.importBatch.update({
        where: { id: batch.id },
        data: { status: 'IMPORTED', successRows: records.length },
      });

      return importBatch;
    });

    res.status(201).json({
      importId: result.id,
      month, year,
      saved: records.length,
      unmappedEnNos: unmappedEnNos || [],
    });
  } catch (err) {
    console.error('Import commit error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/attendance/import/rollback/:batchId — rollback imported batch
router.post('/import/rollback/:batchId', authorize(['ADMIN']), async (req: AuthRequest, res: Response) => {
  try {
    const batch = await prisma.importBatch.findUnique({ where: { id: req.params.batchId } });
    if (!batch) { res.status(404).json({ error: 'Import batch not found' }); return; }
    if (batch.status !== 'IMPORTED') {
      res.status(400).json({ error: `Batch is ${batch.status}, cannot rollback` });
      return;
    }

    const data = JSON.parse(batch.notes || '{}');
    const { month, year } = data;

    // Block if payroll finalized
    const payrollRun = await prisma.payrollRun.findFirst({
      where: { month, year, status: 'FINALIZED' },
    });
    if (payrollRun) {
      res.status(400).json({ error: 'Cannot rollback — payroll for this month is already finalized.' });
      return;
    }

    // Find the attendance import for this month
    const attendanceImport = await prisma.attendanceImport.findUnique({
      where: { month_year: { month, year } },
    });

    await prisma.$transaction(async (tx) => {
      if (attendanceImport) {
        await tx.attendanceRecord.deleteMany({ where: { importId: attendanceImport.id } });
        await tx.attendanceImport.delete({ where: { id: attendanceImport.id } });
      }
      await tx.importBatch.update({
        where: { id: batch.id },
        data: { status: 'ROLLED_BACK' },
      });
    });

    await createAuditLog({
      actorId: req.user!.id,
      action: 'ATTENDANCE_IMPORT_ROLLED_BACK',
      entity: 'ImportBatch',
      entityId: batch.id,
    });

    res.json({ message: 'Import rolled back successfully' });
  } catch (err) {
    console.error('Import rollback error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
