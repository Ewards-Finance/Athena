/**
 * Athena V3.1 Sprint 5 — Letter Generation
 * Generate PDF letters from Handlebars templates for employees.
 */

import { Router, Response } from 'express';
import { AuthRequest, authenticate, authorize } from '../middleware/auth';
import { prisma } from '../lib/prisma';
import { LETTER_TYPES, generateLetterPDF } from '../lib/letterGenerator';
import { createNotification } from '../lib/notify';

const router = Router();
router.use(authenticate);

// GET /templates — List available letter types
router.get('/templates', authorize(['ADMIN']), async (_req: AuthRequest, res: Response) => {
  res.json(LETTER_TYPES);
});

// POST /generate — Generate a PDF letter
router.post('/generate', authorize(['ADMIN']), async (req: AuthRequest, res: Response) => {
  try {
    const { userId, type, additionalData } = req.body;

    if (!userId || !type) {
      res.status(400).json({ error: 'userId and type are required' });
      return;
    }

    // Validate letter type
    if (!LETTER_TYPES.find((t) => t.key === type)) {
      res.status(400).json({ error: `Invalid letter type. Valid types: ${LETTER_TYPES.map((t) => t.key).join(', ')}` });
      return;
    }

    // Fetch employee data
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        profile: true,
        companyAssignments: {
          where: { status: 'ACTIVE' },
          include: { company: true },
          take: 1,
        },
        exitRequest: {
          select: { lastWorkingDate: true },
        },
      },
    });

    if (!user) {
      res.status(404).json({ error: 'Employee not found' });
      return;
    }

    const profile = user.profile;
    const assignment = user.companyAssignments[0];
    const company = assignment?.company;

    // Build company address string
    const addressParts = [
      company?.addressLine1,
      company?.addressLine2,
      company?.city,
      company?.state,
      company?.pincode,
    ].filter(Boolean);
    const companyAddress = addressParts.join(', ') || 'Kolkata, West Bengal';

    // Build template data
    const templateData: Record<string, any> = {
      // Employee
      firstName: profile?.firstName || 'Employee',
      lastName: profile?.lastName || '',
      employeeCode: assignment?.employeeCode || profile?.employeeId || '',
      designation: assignment?.designation || profile?.designation || '',
      department: assignment?.department || profile?.department || '',
      dateOfJoining: assignment?.joiningDate || profile?.dateOfJoining || '',
      annualCTC: assignment?.annualCTC || profile?.annualCtc || 0,
      monthlyGross: Math.round((assignment?.annualCTC || profile?.annualCtc || 0) / 12),
      employmentType: assignment?.employmentType || profile?.employmentType || 'FULL_TIME',
      officeLocation: profile?.officeLocation || 'Kolkata',
      email: user.email,

      // Company
      companyLegalName: company?.legalName || 'Ewards Engagement Pvt. Ltd.',
      companyAddress,
      companyPan: company?.pan || '',
      companyTan: company?.tan || '',

      // Meta
      currentYear: new Date().getFullYear(),

      // Policy defaults
      probationDays: 90,
      noticePeriodDays: 90,

      // Exit data
      lastWorkingDate: user.exitRequest?.lastWorkingDate || '',

      // Merge any additional data from the request
      ...additionalData,
    };

    // Generate PDF
    const pdfBuffer = await generateLetterPDF(type, templateData);

    // Notify the employee
    const letterLabel = LETTER_TYPES.find((t) => t.key === type)?.label || type;
    await createNotification({
      userId,
      type: 'LETTER_GENERATED',
      title: 'Letter Generated',
      message: `A ${letterLabel} has been generated for you.`,
      link: '/documents',
    });

    // Return PDF
    const fileName = `${type.toLowerCase()}_${(profile?.firstName || 'employee').toLowerCase()}_${(profile?.lastName || '').toLowerCase()}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(pdfBuffer);
  } catch (err: any) {
    console.error('Generate letter error:', err);
    if (err.message?.includes('puppeteer')) {
      res.status(503).json({ error: 'PDF generation service unavailable. Puppeteer may not be installed.' });
    } else {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

export default router;
