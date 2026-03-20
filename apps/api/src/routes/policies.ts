/**
 * Athena V3.1 - Policy Version Routes
 *
 * Manages versioned policy rules that replace hardcoded values.
 * OWNER can create/edit/publish versions, ADMIN can read.
 */

import { Router, Response } from 'express';
import { AuthRequest, authenticate, authorize } from '../middleware/auth';
import { prisma } from '../lib/prisma';
import { createNotification } from '../lib/notify';

const router = Router();
router.use(authenticate);

// GET /api/policies — list all policy versions
router.get('/', authorize(['OWNER', 'ADMIN']), async (req: AuthRequest, res: Response) => {
  try {
    const versions = await prisma.policyVersion.findMany({
      include: {
        _count: { select: { rules: true, acknowledgements: true } },
        company: { select: { id: true, displayName: true, code: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json(versions);
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/policies/active — get current active version + rules
// ?companyId= optional: returns company-specific version if one exists, else global
router.get('/active', async (req: AuthRequest, res: Response) => {
  try {
    const { companyId } = req.query as { companyId?: string };

    let active = null;
    if (companyId) {
      active = await prisma.policyVersion.findFirst({
        where: { isActive: true, scope: 'COMPANY_SPECIFIC', companyId },
        include: { rules: { orderBy: { ruleKey: 'asc' } }, company: { select: { displayName: true } } },
      });
    }
    if (!active) {
      active = await prisma.policyVersion.findFirst({
        where: { isActive: true, scope: 'GLOBAL' },
        include: { rules: { orderBy: { ruleKey: 'asc' } }, company: { select: { displayName: true } } },
      });
    }

    if (!active) {
      res.status(404).json({ error: 'No active policy version found' });
      return;
    }

    res.json(active);
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/policies/acknowledgements — list pending acknowledgements
router.get('/acknowledgements', authorize(['OWNER', 'ADMIN']), async (req: AuthRequest, res: Response) => {
  try {
    const acks = await prisma.policyAcknowledgement.findMany({
      where: { isAcknowledged: false },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            profile: { select: { firstName: true, lastName: true, employeeId: true } },
          },
        },
        policyVersion: { select: { id: true, name: true, versionCode: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    res.json(acks);
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/policies/:id — get specific version + rules
router.get('/:id', authorize(['OWNER', 'ADMIN']), async (req: AuthRequest, res: Response) => {
  try {
    const version = await prisma.policyVersion.findUnique({
      where: { id: req.params.id },
      include: {
        company: { select: { id: true, displayName: true, code: true } },
        rules: { orderBy: { ruleKey: 'asc' } },
        acknowledgements: {
          include: {
            user: {
              select: {
                id: true,
                email: true,
                profile: { select: { firstName: true, lastName: true } },
              },
            },
          },
        },
      },
    });

    if (!version) {
      res.status(404).json({ error: 'Policy version not found' });
      return;
    }

    res.json(version);
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/policies/:id — delete a DRAFT version (OWNER only, cannot delete active)
router.delete('/:id', authorize(['OWNER']), async (req: AuthRequest, res: Response) => {
  try {
    const version = await prisma.policyVersion.findUnique({ where: { id: req.params.id } });
    if (!version) {
      res.status(404).json({ error: 'Policy version not found' });
      return;
    }
    if (version.isActive) {
      res.status(400).json({ error: 'Cannot delete an active policy version' });
      return;
    }
    await prisma.policyVersion.delete({ where: { id: req.params.id } });
    res.json({ message: 'Draft deleted' });
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/policies — create new policy version draft (OWNER only)
// Optionally copies rules from the current active version
router.post('/', authorize(['OWNER']), async (req: AuthRequest, res: Response) => {
  try {
    const { name, versionCode, effectiveFrom, notes, copyFromActive, scope, companyId } = req.body;

    if (!name || !versionCode || !effectiveFrom) {
      res.status(400).json({ error: 'name, versionCode, and effectiveFrom are required' });
      return;
    }

    const resolvedScope = scope === 'COMPANY_SPECIFIC' ? 'COMPANY_SPECIFIC' : 'GLOBAL';
    if (resolvedScope === 'COMPANY_SPECIFIC' && !companyId) {
      res.status(400).json({ error: 'companyId is required for COMPANY_SPECIFIC scope' });
      return;
    }

    // Check versionCode uniqueness
    const existing = await prisma.policyVersion.findUnique({ where: { versionCode } });
    if (existing) {
      res.status(409).json({ error: 'Version code already exists' });
      return;
    }

    // Create the new version
    const version = await prisma.policyVersion.create({
      data: {
        name,
        versionCode,
        effectiveFrom: new Date(effectiveFrom),
        isActive: false,
        scope: resolvedScope,
        companyId: resolvedScope === 'COMPANY_SPECIFIC' ? companyId : null,
        notes,
      },
    });

    // Copy rules from active version if requested
    if (copyFromActive) {
      const active = await prisma.policyVersion.findFirst({
        where: { isActive: true },
        include: { rules: true },
      });

      if (active && active.rules.length > 0) {
        await prisma.policyRule.createMany({
          data: active.rules.map(r => ({
            policyVersionId: version.id,
            ruleKey: r.ruleKey,
            ruleValue: r.ruleValue,
            valueType: r.valueType,
            description: r.description,
          })),
        });
      }
    }

    const result = await prisma.policyVersion.findUnique({
      where: { id: version.id },
      include: { rules: { orderBy: { ruleKey: 'asc' } } },
    });

    res.status(201).json(result);
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/policies/:id/rules — add/update rules on a draft version
router.post('/:id/rules', authorize(['OWNER']), async (req: AuthRequest, res: Response) => {
  try {
    const version = await prisma.policyVersion.findUnique({ where: { id: req.params.id } });
    if (!version) {
      res.status(404).json({ error: 'Policy version not found' });
      return;
    }
    if (version.isActive) {
      res.status(400).json({ error: 'Cannot edit rules on an active/published version' });
      return;
    }

    const { rules } = req.body; // Array of { ruleKey, ruleValue, valueType?, description? }
    if (!Array.isArray(rules) || rules.length === 0) {
      res.status(400).json({ error: 'rules array is required' });
      return;
    }

    // Upsert each rule
    for (const rule of rules) {
      if (!rule.ruleKey || rule.ruleValue === undefined) continue;

      await prisma.policyRule.upsert({
        where: {
          policyVersionId_ruleKey: {
            policyVersionId: req.params.id,
            ruleKey: rule.ruleKey,
          },
        },
        update: {
          ruleValue: String(rule.ruleValue),
          ...(rule.valueType && { valueType: rule.valueType }),
          ...(rule.description !== undefined && { description: rule.description }),
        },
        create: {
          policyVersionId: req.params.id,
          ruleKey: rule.ruleKey,
          ruleValue: String(rule.ruleValue),
          valueType: rule.valueType ?? 'string',
          description: rule.description ?? null,
        },
      });
    }

    // Return updated version with rules
    const updated = await prisma.policyVersion.findUnique({
      where: { id: req.params.id },
      include: { rules: { orderBy: { ruleKey: 'asc' } } },
    });

    res.json(updated);
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/policies/:id/publish — publish version (OWNER only)
router.patch('/:id/publish', authorize(['OWNER']), async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!;
    const version = await prisma.policyVersion.findUnique({
      where: { id: req.params.id },
      include: { rules: true },
    });

    if (!version) {
      res.status(404).json({ error: 'Policy version not found' });
      return;
    }
    if (version.isActive) {
      res.status(400).json({ error: 'This version is already active' });
      return;
    }
    if (version.rules.length === 0) {
      res.status(400).json({ error: 'Cannot publish a version with no rules' });
      return;
    }

    const now = new Date();

    await prisma.$transaction(async (tx) => {
      // Deactivate all other active versions
      await tx.policyVersion.updateMany({
        where: { isActive: true },
        data: {
          isActive: false,
          effectiveTo: new Date(now.getTime() - 86400000), // yesterday
        },
      });

      // Activate this version
      await tx.policyVersion.update({
        where: { id: version.id },
        data: {
          isActive: true,
          publishedBy: user.id,
          publishedAt: now,
          effectiveFrom: now,
          effectiveTo: null,
        },
      });

      // Create acknowledgement rows for all active employees
      const activeUsers = await tx.user.findMany({
        where: { isActive: true },
        select: { id: true },
      });

      if (activeUsers.length > 0) {
        await tx.policyAcknowledgement.createMany({
          data: activeUsers.map(u => ({
            policyVersionId: version.id,
            userId: u.id,
            isAcknowledged: false,
          })),
          skipDuplicates: true,
        });

        // Send notification to all employees
        for (const u of activeUsers) {
          await createNotification({
            userId: u.id,
            type: 'POLICY_PUBLISHED',
            title: 'New Policy Version Published',
            message: `Policy "${version.name}" has been published. Please review and acknowledge.`,
            link: '/policies',
          });
        }
      }
    });

    const published = await prisma.policyVersion.findUnique({
      where: { id: version.id },
      include: { rules: { orderBy: { ruleKey: 'asc' } } },
    });

    res.json(published);
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/policies/acknowledge — employee acknowledges current policy
router.post('/acknowledge', async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!;

    // Find the active policy version
    const active = await prisma.policyVersion.findFirst({ where: { isActive: true } });
    if (!active) {
      res.status(404).json({ error: 'No active policy to acknowledge' });
      return;
    }

    // Upsert the acknowledgement
    const ack = await prisma.policyAcknowledgement.upsert({
      where: {
        policyVersionId_userId: {
          policyVersionId: active.id,
          userId: user.id,
        },
      },
      update: {
        isAcknowledged: true,
        acknowledgedAt: new Date(),
      },
      create: {
        policyVersionId: active.id,
        userId: user.id,
        isAcknowledged: true,
        acknowledgedAt: new Date(),
      },
    });

    res.json(ack);
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
