/**
 * Athena V3.1 Sprint 5 — Letter Generator
 * Compiles Handlebars templates and generates PDF via Puppeteer.
 */

import fs from 'fs';
import path from 'path';
import Handlebars from 'handlebars';

let puppeteer: any;
try {
  puppeteer = require('puppeteer');
} catch {
  console.warn('[letterGenerator] puppeteer not installed — PDF generation disabled');
}

// All supported letter types
export const LETTER_TYPES = [
  { key: 'OFFER',                    label: 'Offer Letter' },
  { key: 'APPOINTMENT',              label: 'Appointment Letter' },
  { key: 'INCREMENT',                label: 'Increment / Revision Letter' },
  { key: 'PROBATION_CONFIRMATION',   label: 'Probation Confirmation Letter' },
  { key: 'TRANSFER',                 label: 'Transfer Letter' },
  { key: 'WARNING',                  label: 'Warning Letter' },
  { key: 'EXPERIENCE',               label: 'Experience Letter' },
  { key: 'RELIEVING',                label: 'Relieving Letter' },
  { key: 'SALARY_CERTIFICATE',       label: 'Salary Certificate' },
] as const;

// Map letter type key to template filename
const TEMPLATE_MAP: Record<string, string> = {
  OFFER:                    'offer.hbs',
  APPOINTMENT:              'appointment.hbs',
  INCREMENT:                'increment.hbs',
  PROBATION_CONFIRMATION:   'probation_confirmation.hbs',
  TRANSFER:                 'transfer.hbs',
  WARNING:                  'warning.hbs',
  EXPERIENCE:               'experience.hbs',
  RELIEVING:                'relieving.hbs',
  SALARY_CERTIFICATE:       'salary_certificate.hbs',
};

// Register Handlebars helpers
Handlebars.registerHelper('formatDate', (dateStr: string) => {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });
});

Handlebars.registerHelper('formatCurrency', (amount: number) => {
  if (!amount && amount !== 0) return '—';
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount);
});

Handlebars.registerHelper('today', () => {
  return new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });
});

/**
 * Generate a PDF letter from a template + data.
 * Returns a Buffer containing the PDF.
 */
export async function generateLetterPDF(
  type: string,
  data: Record<string, any>,
): Promise<Buffer> {
  const templateFile = TEMPLATE_MAP[type];
  if (!templateFile) throw new Error(`Unknown letter type: ${type}`);

  const templatePath = path.join(__dirname, '..', 'templates', templateFile);
  if (!fs.existsSync(templatePath)) throw new Error(`Template not found: ${templateFile}`);

  const source = fs.readFileSync(templatePath, 'utf-8');
  const template = Handlebars.compile(source);
  const html = template(data);

  if (!puppeteer) throw new Error('puppeteer is not installed — cannot generate PDF');

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '20mm', bottom: '20mm', left: '15mm', right: '15mm' },
    });
    return Buffer.from(pdfBuffer);
  } finally {
    await browser.close();
  }
}
