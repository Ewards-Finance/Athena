/**
 * Athena V2 - API Key Management (Admin only)
 *
 * GET    /api/api-keys          - list all keys (prefix, scopes, expiry, lastUsed, status)
 * POST   /api/api-keys          - create new key (returns full key ONCE, then hashed)
 * DELETE /api/api-keys/:id      - revoke / delete a key
 */

import { Router, Response } from 'express';
import crypto from 'crypto';
import { AuthRequest, authenticate, authorize } from '../middleware/auth';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const router = Router();
router.use(authenticate);
router.use(authorize(['ADMIN']));

const DEFAULT_SCOPES = ['employees:read', 'attendance:read', 'leaves:read', 'payroll:read'];
const DEFAULT_EXPIRY_DAYS = Number(process.env.API_KEY_DEFAULT_EXPIRY_DAYS ?? 365);

router.get('/', async (_req: AuthRequest, res: Response) => {
  try {
    const keys = await prisma.apiKey.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        prefix: true,
        isActive: true,
        scopes: true,
        expiresAt: true,
        lastUsedAt: true,
        createdAt: true,
      },
    });
    res.json(keys);
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/', async (req: AuthRequest, res: Response) => {
  const { name } = req.body;
  if (!name?.trim()) {
    res.status(400).json({ error: 'Key name is required' });
    return;
  }

  try {
    const rawKey = `athn_${crypto.randomBytes(16).toString('hex')}`;
    const prefix = rawKey.slice(0, 12);
    const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');

    const created = await prisma.apiKey.create({
      data: {
        name: name.trim(),
        keyHash,
        prefix,
        createdBy: req.user!.id,
        scopes: DEFAULT_SCOPES,
        expiresAt: new Date(Date.now() + DEFAULT_EXPIRY_DAYS * 24 * 60 * 60 * 1000),
      },
    });

    res.status(201).json({
      id: created.id,
      name: created.name,
      prefix: created.prefix,
      scopes: created.scopes,
      expiresAt: created.expiresAt,
      key: rawKey,
      createdAt: created.createdAt,
    });
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    await prisma.apiKey.delete({ where: { id: req.params.id } });
    res.json({ message: 'API key revoked' });
  } catch {
    res.status(404).json({ error: 'Key not found' });
  }
});

export default router;
