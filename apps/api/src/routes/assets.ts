/**
 * Athena V2 - Asset Management Routes
 * GET    /api/assets              - list assets (scoped by role)
 * GET    /api/assets/my-assets    - employee's currently assigned assets
 * POST   /api/assets              - create asset (Admin/Owner)
 * PATCH  /api/assets/:id          - update asset (Admin/Owner)
 * POST   /api/assets/:id/assign   - assign asset to employee (Admin/Owner)
 * PATCH  /api/assets/:id/return   - return asset (Admin/Owner)
 * POST   /api/assets/import       - bulk import preview from Excel (Admin/Owner)
 * POST   /api/assets/import/commit/:batchId - commit previewed batch (Admin/Owner)
 */

import { Router, Response } from 'express';
import { AuthRequest, authenticate, authorize } from '../middleware/auth';
import { prisma } from '../lib/prisma';
import { createNotification } from '../lib/notify';
import { createAuditLog } from '../lib/audit';
import multer from 'multer';
import ExcelJS from 'exceljs';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const VALID_CATEGORIES = [
  'LAPTOP', 'PHONE', 'CHARGER', 'MONITOR', 'KEYBOARD', 'MOUSE',
  'SIM_CARD', 'ACCESS_CARD', 'ID_CARD', 'SOFTWARE_LICENSE', 'OTHER',
] as const;

const router = Router();

// All asset routes require authentication
router.use(authenticate);

// ─── GET / — List assets ──────────────────────────────────────────────────────

router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!;
    const { category, status } = req.query as { category?: string; status?: string };

    if (user.role === 'ADMIN' || user.role === 'OWNER') {
      const where: any = {};
      if (category) where.category = category;
      if (status) where.status = status;

      const assets = await prisma.asset.findMany({
        where,
        include: {
          assignments: {
            where: { returnedAt: null },
            include: { user: { include: { profile: true } } },
          },
        },
        orderBy: { createdAt: 'desc' },
      });
      res.json(assets);
    } else {
      // EMPLOYEE / MANAGER — only their own assigned assets
      const assignments = await prisma.assetAssignment.findMany({
        where: { userId: user.id, returnedAt: null },
        include: { asset: true },
      });
      const assets = assignments.map(a => a.asset);
      res.json(assets);
    }
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /my-assets — Employee's currently assigned assets ────────────────────

router.get('/my-assets', async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!;
    const assignments = await prisma.assetAssignment.findMany({
      where: { userId: user.id, returnedAt: null },
      include: { asset: true },
    });
    res.json(assignments);
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST / — Create asset (Admin/Owner) ─────────────────────────────────────

router.post('/', authorize(['ADMIN', 'OWNER']), async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!;
    const { name, assetTag, category, serialNumber, purchaseDate, purchaseCost, notes } = req.body;

    if (!name || !assetTag || !category) {
      res.status(400).json({ error: 'Missing required fields: name, assetTag, category' });
      return;
    }

    if (!VALID_CATEGORIES.includes(category)) {
      res.status(400).json({ error: `Invalid category. Must be one of: ${VALID_CATEGORIES.join(', ')}` });
      return;
    }

    const asset = await prisma.asset.create({
      data: {
        name,
        assetTag,
        category,
        serialNumber: serialNumber || null,
        purchaseDate: purchaseDate ? new Date(purchaseDate) : null,
        purchaseCost: purchaseCost ? parseFloat(purchaseCost) : null,
        notes: notes || null,
      },
    });

    await createAuditLog({
      actorId: user.id,
      action: 'ASSET_CREATED',
      entity: 'Asset',
      entityId: asset.id,
      newValues: { name, assetTag, category },
    });

    res.status(201).json(asset);
  } catch (err: any) {
    if (err?.code === 'P2002') {
      res.status(409).json({ error: 'Asset tag already exists' });
      return;
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── PATCH /:id — Update asset (Admin/Owner) ─────────────────────────────────

router.patch('/:id', authorize(['ADMIN', 'OWNER']), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { name, category, serialNumber, purchaseDate, purchaseCost, status, notes } = req.body;

    const existing = await prisma.asset.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ error: 'Asset not found' });
      return;
    }

    if (category !== undefined && !VALID_CATEGORIES.includes(category)) {
      res.status(400).json({ error: `Invalid category. Must be one of: ${VALID_CATEGORIES.join(', ')}` });
      return;
    }
    const VALID_STATUSES = ['AVAILABLE', 'ASSIGNED', 'UNDER_REPAIR', 'RETIRED'];
    if (status !== undefined && !VALID_STATUSES.includes(status)) {
      res.status(400).json({ error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` });
      return;
    }

    const data: any = {};
    if (name !== undefined) data.name = name;
    if (category !== undefined) data.category = category;
    if (serialNumber !== undefined) data.serialNumber = serialNumber;
    if (purchaseDate !== undefined) data.purchaseDate = purchaseDate ? new Date(purchaseDate) : null;
    if (purchaseCost !== undefined) data.purchaseCost = purchaseCost ? parseFloat(purchaseCost) : null;
    if (status !== undefined) data.status = status;
    if (notes !== undefined) data.notes = notes;

    const asset = await prisma.asset.update({ where: { id }, data });
    res.json(asset);
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /:id/assign — Assign asset to employee (Admin/Owner) ───────────────

router.post('/:id/assign', authorize(['ADMIN', 'OWNER']), async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!;
    const { id } = req.params;
    const { userId, conditionOut, notes } = req.body;

    if (!userId) {
      res.status(400).json({ error: 'Missing required field: userId' });
      return;
    }

    const asset = await prisma.asset.findUnique({ where: { id } });
    if (!asset) {
      res.status(404).json({ error: 'Asset not found' });
      return;
    }
    if (asset.status !== 'AVAILABLE') {
      res.status(400).json({ error: 'Asset is not available for assignment' });
      return;
    }

    const targetUser = await prisma.user.findUnique({ where: { id: userId } });
    if (!targetUser || !targetUser.isActive) {
      res.status(404).json({ error: 'Target user not found or inactive' });
      return;
    }

    const assignment = await prisma.$transaction(async (tx) => {
      const a = await tx.assetAssignment.create({
        data: {
          assetId: id,
          userId,
          conditionOut: conditionOut || null,
          notes: notes || null,
          assignedBy: user.id,
        },
      });
      await tx.asset.update({ where: { id }, data: { status: 'ASSIGNED' } });
      return a;
    });

    await createNotification({
      userId,
      type: 'ASSET_ASSIGNED',
      title: 'Asset Assigned',
      message: `You have been assigned: ${asset.name} (${asset.assetTag})`,
      link: '/assets',
    });

    await createAuditLog({
      actorId: user.id,
      action: 'ASSET_ASSIGNED',
      entity: 'Asset',
      entityId: id,
      subjectEntity: 'User',
      subjectId: userId,
      newValues: { assetTag: asset.assetTag, conditionOut },
    });

    res.status(201).json(assignment);
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── PATCH /:id/return — Return asset (Admin/Owner) ──────────────────────────

router.patch('/:id/return', authorize(['ADMIN', 'OWNER']), async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!;
    const { id } = req.params;
    const { conditionIn, notes } = req.body;

    const asset = await prisma.asset.findUnique({ where: { id } });
    if (!asset) {
      res.status(404).json({ error: 'Asset not found' });
      return;
    }

    // Find active assignment for this asset
    const activeAssignment = await prisma.assetAssignment.findFirst({
      where: { assetId: id, returnedAt: null },
    });
    if (!activeAssignment) {
      res.status(400).json({ error: 'No active assignment found for this asset' });
      return;
    }

    await prisma.$transaction(async (tx) => {
      await tx.assetAssignment.update({
        where: { id: activeAssignment.id },
        data: {
          returnedAt: new Date(),
          conditionIn: conditionIn || null,
          notes: notes || activeAssignment.notes,
        },
      });
      await tx.asset.update({ where: { id }, data: { status: 'AVAILABLE' } });
    });

    await createAuditLog({
      actorId: user.id,
      action: 'ASSET_RETURNED',
      entity: 'Asset',
      entityId: id,
      subjectEntity: 'User',
      subjectId: activeAssignment.userId,
      newValues: { assetTag: asset.assetTag, conditionIn },
    });

    const updatedAsset = await prisma.asset.findUnique({
      where: { id },
      include: { assignments: { where: { returnedAt: null }, include: { user: { select: { id: true, profile: { select: { firstName: true, lastName: true, employeeId: true } } } } } } },
    });
    res.json(updatedAsset);
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /import — Bulk import preview from Excel (Admin/Owner) ─────────────

router.post('/import', authorize(['ADMIN', 'OWNER']), upload.single('file'), async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!;

    if (!req.file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(req.file.buffer as any);
    const sheet = workbook.worksheets[0];

    if (!sheet || sheet.rowCount < 2) {
      res.status(400).json({ error: 'Empty or invalid spreadsheet' });
      return;
    }

    // Read header row to map columns
    const headerRow = sheet.getRow(1);
    const headers: Record<string, number> = {};
    headerRow.eachCell((cell, colNumber) => {
      const val = String(cell.value ?? '').trim().toUpperCase().replace(/\s+/g, '_');
      headers[val] = colNumber;
    });

    const requiredHeaders = ['NAME', 'ASSET_TAG', 'CATEGORY'];
    const missing = requiredHeaders.filter(h => !(h in headers));
    if (missing.length > 0) {
      res.status(400).json({ error: `Missing required columns: ${missing.join(', ')}` });
      return;
    }

    const validRows: any[] = [];
    const errors: any[] = [];

    for (let r = 2; r <= sheet.rowCount; r++) {
      const row = sheet.getRow(r);
      const name = String(row.getCell(headers['NAME'] || 0).value ?? '').trim();
      const assetTag = String(row.getCell(headers['ASSET_TAG'] || 0).value ?? '').trim();
      const categoryRaw = String(row.getCell(headers['CATEGORY'] || 0).value ?? '').trim().toUpperCase().replace(/\s+/g, '_');
      const serialNumber = headers['SERIAL_NUMBER'] ? String(row.getCell(headers['SERIAL_NUMBER']).value ?? '').trim() : '';
      const purchaseDateRaw = headers['PURCHASE_DATE'] ? row.getCell(headers['PURCHASE_DATE']).value : null;
      const purchaseCostRaw = headers['PURCHASE_COST'] ? row.getCell(headers['PURCHASE_COST']).value : null;
      const notesVal = headers['NOTES'] ? String(row.getCell(headers['NOTES']).value ?? '').trim() : '';

      // Skip completely empty rows
      if (!name && !assetTag && !categoryRaw) continue;

      const rowErrors: string[] = [];

      if (!name) rowErrors.push('Name is required');
      if (!assetTag) rowErrors.push('Asset Tag is required');
      if (!categoryRaw) rowErrors.push('Category is required');
      else if (!VALID_CATEGORIES.includes(categoryRaw as any)) {
        rowErrors.push(`Invalid category "${categoryRaw}". Must be one of: ${VALID_CATEGORIES.join(', ')}`);
      }

      if (rowErrors.length > 0) {
        errors.push({ row: r, assetTag: assetTag || '(empty)', errors: rowErrors });
      } else {
        let purchaseDate: string | null = null;
        if (purchaseDateRaw instanceof Date) {
          purchaseDate = purchaseDateRaw.toISOString();
        } else if (purchaseDateRaw) {
          const parsed = new Date(String(purchaseDateRaw));
          if (!isNaN(parsed.getTime())) purchaseDate = parsed.toISOString();
        }

        validRows.push({
          name,
          assetTag,
          category: categoryRaw,
          serialNumber: serialNumber || null,
          purchaseDate,
          purchaseCost: purchaseCostRaw ? parseFloat(String(purchaseCostRaw)) : null,
          notes: notesVal || null,
        });
      }
    }

    const batch = await prisma.importBatch.create({
      data: {
        type: 'ASSET_BULK',
        uploadedBy: user.id,
        fileName: req.file.originalname || 'upload.xlsx',
        totalRows: validRows.length + errors.length,
        status: 'PREVIEWED',
        notes: JSON.stringify(validRows),
        errorLog: errors.length > 0 ? JSON.stringify(errors) : null,
      },
    });

    res.json({
      batchId: batch.id,
      totalRows: validRows.length + errors.length,
      validRows: validRows.length,
      errors,
    });
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /import/commit/:batchId — Commit previewed batch (Admin/Owner) ─────

router.post('/import/commit/:batchId', authorize(['ADMIN', 'OWNER']), async (req: AuthRequest, res: Response) => {
  try {
    const { batchId } = req.params;

    const batch = await prisma.importBatch.findUnique({ where: { id: batchId } });
    if (!batch) {
      res.status(404).json({ error: 'Import batch not found' });
      return;
    }
    if (batch.status !== 'PREVIEWED') {
      res.status(400).json({ error: 'Batch has already been processed' });
      return;
    }
    if (batch.type !== 'ASSET_BULK') {
      res.status(400).json({ error: 'Batch is not an asset import' });
      return;
    }

    const validRows = JSON.parse(batch.notes || '[]');
    if (validRows.length === 0) {
      res.status(400).json({ error: 'No valid rows to import' });
      return;
    }

    // Map rows to Prisma create format
    const createData = validRows.map((row: any) => ({
      name: row.name,
      assetTag: row.assetTag,
      category: row.category,
      serialNumber: row.serialNumber,
      purchaseDate: row.purchaseDate ? new Date(row.purchaseDate) : null,
      purchaseCost: row.purchaseCost,
      notes: row.notes,
    }));

    const result = await prisma.asset.createMany({
      data: createData,
      skipDuplicates: true,
    });

    const imported = result.count;
    const failed = validRows.length - imported;

    await prisma.importBatch.update({
      where: { id: batchId },
      data: {
        status: failed > 0 ? 'PARTIALLY_IMPORTED' : 'IMPORTED',
        successRows: imported,
        failedRows: failed,
      },
    });

    res.json({ imported, failed });
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
