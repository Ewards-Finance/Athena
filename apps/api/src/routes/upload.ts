/**
 * Athena V2 - File Upload Route
 *
 * POST /api/upload?folder=bills   — upload a receipt/bill for a claim
 * POST /api/upload?folder=docs    — upload a KYC or appointment letter document
 *
 * Returns: { url: string, filename: string, size: number }
 * The `url` is a server-relative path served under /uploads/…
 */

import { Router, Response }  from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { billUpload, docUpload }     from '../middleware/upload';

const router = Router();

router.use(authenticate);

router.post('/', (req: AuthRequest, res: Response) => {
  const folder   = req.query.folder === 'docs' ? 'docs' : 'bills';
  const uploader = folder === 'docs' ? docUpload : billUpload;

  uploader(req as any, res as any, (err) => {
    if (err) {
      res.status(400).json({ error: err.message || 'Upload failed' });
      return;
    }
    if (!req.file) {
      res.status(400).json({ error: 'No file provided' });
      return;
    }
    res.json({
      url:      `/uploads/${folder}/${req.file.filename}`,
      filename: req.file.originalname,
      size:     req.file.size,
    });
  });
});

export default router;
