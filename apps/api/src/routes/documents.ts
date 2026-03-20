/**
 * Athena V2 - Employee Document Vault Routes
 *
 * GET    /api/documents/:userId          - list documents for employee (Admin or own only)
 * POST   /api/documents/:userId          - upload/add a document entry (Admin or own only)
 * DELETE /api/documents/:docId           - delete a document (Admin only)
 */

import { Router, Response }    from 'express';
import { prisma } from '../lib/prisma';
import { z }                   from 'zod';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';

const router = Router();

router.use(authenticate);

const DOC_CATEGORIES = ['OFFER_LETTER', 'APPOINTMENT_LETTER', 'EXPERIENCE_LETTER', 'KYC', 'CONTRACT', 'PAYSLIP', 'OTHER'] as const;

// GET /api/documents/:userId
router.get('/:userId', async (req: AuthRequest, res: Response) => {
  const { userId } = req.params;
  const me = req.user!;

  if (me.role === 'EMPLOYEE' && me.id !== userId) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  if (me.role === 'MANAGER' && me.id !== userId) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  try {
    const docs = await prisma.employeeDocument.findMany({
      where:   { userId },
      orderBy: { createdAt: 'desc' },
    });
    res.json(docs);
  } catch (err) {
    console.error('List documents error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/documents/:userId
router.post('/:userId', async (req: AuthRequest, res: Response) => {
  const { userId } = req.params;
  const me = req.user!;

  // Non-admin users can add only their own documents
  if (me.role === 'EMPLOYEE' && me.id !== userId) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  if (me.role === 'MANAGER' && me.id !== userId) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  const parsed = z.object({
    category:    z.enum(DOC_CATEGORIES),
    name:        z.string().min(1),
    fileUrl:     z.string().min(1),
    description: z.string().optional(),
  }).safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }

  try {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) { res.status(404).json({ error: 'Employee not found' }); return; }

    const doc = await prisma.employeeDocument.create({
      data: {
        userId,
        category:    parsed.data.category as any,
        name:        parsed.data.name,
        fileUrl:     parsed.data.fileUrl,
        description: parsed.data.description,
        uploadedBy:  me.id,
      },
    });
    res.status(201).json(doc);
  } catch (err) {
    console.error('Create document error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/documents/:docId
router.delete('/:docId', authorize(['ADMIN']), async (req: AuthRequest, res: Response) => {
  try {
    await prisma.employeeDocument.delete({ where: { id: req.params.docId } });
    res.json({ message: 'Document deleted' });
  } catch (err: any) {
    if (err?.code === 'P2025') { res.status(404).json({ error: 'Document not found' }); return; }
    console.error('Delete document error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
