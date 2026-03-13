/**
 * Athena V2 - Multer Upload Middleware
 * Two pre-configured uploaders: bills (claims receipts) and docs (KYC / appointment letters).
 * Accepted types: JPEG, PNG, WebP, GIF, PDF — max 5 MB each.
 */

import multer, { FileFilterCallback } from 'multer';
import path   from 'path';
import fs     from 'fs';
import { Request } from 'express';

const UPLOAD_ROOT = path.resolve(__dirname, '../../uploads');

function makeStorage(folder: string) {
  return multer.diskStorage({
    destination: (_req, _file, cb) => {
      const dir = path.join(UPLOAD_ROOT, folder);
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (_req, file, cb) => {
      const ext    = path.extname(file.originalname).toLowerCase();
      const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
      cb(null, unique);
    },
  });
}

function fileFilter(_req: Request, file: Express.Multer.File, cb: FileFilterCallback) {
  const allowed = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.pdf'];
  const ext     = path.extname(file.originalname).toLowerCase();
  if (allowed.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error('Only images (JPG, PNG, WebP, GIF) and PDF files are allowed'));
  }
}

const LIMIT = { fileSize: 5 * 1024 * 1024 }; // 5 MB

export const billUpload = multer({ storage: makeStorage('bills'), fileFilter, limits: LIMIT }).single('file');
export const docUpload  = multer({ storage: makeStorage('docs'),  fileFilter, limits: LIMIT }).single('file');
