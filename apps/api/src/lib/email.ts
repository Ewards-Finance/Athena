/**
 * Athena V2 - Email Notification Library
 *
 * Uses NodeMailer with SMTP credentials from environment variables.
 * If SMTP_HOST is not set, all email calls silently no-op (safe for dev/staging).
 *
 * Required .env variables to enable email:
 *   SMTP_HOST     — e.g. smtp.gmail.com
 *   SMTP_PORT     — e.g. 587
 *   SMTP_SECURE   — "true" for port 465 (SSL), "false" for STARTTLS
 *   SMTP_USER     — SMTP login email
 *   SMTP_PASS     — SMTP password or app password
 *   SMTP_FROM     — Display name + address, e.g. "Athena HRMS <hr@ewards.com>"
 */

import nodemailer from 'nodemailer';

const isConfigured = !!process.env.SMTP_HOST;

const transporter = isConfigured
  ? nodemailer.createTransport({
      host:   process.env.SMTP_HOST,
      port:   Number(process.env.SMTP_PORT ?? 587),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER ?? '',
        pass: process.env.SMTP_PASS ?? '',
      },
    })
  : null;

const FROM = process.env.SMTP_FROM ?? 'Athena HRMS <noreply@ewards.com>';

// ─── Core send ────────────────────────────────────────────────────────────────

export async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  if (!transporter) return; // silently skip if SMTP not configured
  try {
    await transporter.sendMail({ from: FROM, to, subject, html });
  } catch (err) {
    console.error(`[email] Failed to send to ${to}:`, err);
    // Never throw — email failure must not break the API response
  }
}

// ─── Shared layout wrapper ────────────────────────────────────────────────────

function wrap(content: string): string {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f9f9f9; padding: 24px;">
      <div style="background: #361963; padding: 16px 24px; border-radius: 8px 8px 0 0;">
        <h2 style="color: white; margin: 0; font-size: 18px;">Athena HRMS</h2>
      </div>
      <div style="background: white; padding: 24px; border-radius: 0 0 8px 8px; border: 1px solid #e5e7eb;">
        ${content}
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
        <p style="color: #9ca3af; font-size: 12px; margin: 0;">
          This is an automated message from Athena HRMS. Please do not reply to this email.
        </p>
      </div>
    </div>
  `;
}

// ─── Leave notifications ──────────────────────────────────────────────────────

export async function sendLeaveApprovedEmail(opts: {
  to: string; firstName: string; leaveType: string;
  startDate: string; endDate: string; totalDays: number; comment?: string;
}) {
  const daysStr = opts.totalDays === 0.5 ? 'half day' : `${opts.totalDays} day${opts.totalDays !== 1 ? 's' : ''}`;
  await sendEmail(opts.to, `Leave Approved — ${opts.leaveType}`, wrap(`
    <p style="color: #374151;">Hi ${opts.firstName},</p>
    <p style="color: #374151;">Your leave request has been <strong style="color: #16a34a;">approved</strong>.</p>
    <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
      <tr><td style="padding: 8px; color: #6b7280; border-bottom: 1px solid #f3f4f6;">Leave Type</td><td style="padding: 8px; font-weight: 600; border-bottom: 1px solid #f3f4f6;">${opts.leaveType}</td></tr>
      <tr><td style="padding: 8px; color: #6b7280; border-bottom: 1px solid #f3f4f6;">Duration</td><td style="padding: 8px; font-weight: 600; border-bottom: 1px solid #f3f4f6;">${daysStr}</td></tr>
      <tr><td style="padding: 8px; color: #6b7280; border-bottom: 1px solid #f3f4f6;">From</td><td style="padding: 8px; border-bottom: 1px solid #f3f4f6;">${opts.startDate}</td></tr>
      <tr><td style="padding: 8px; color: #6b7280;">To</td><td style="padding: 8px;">${opts.endDate}</td></tr>
    </table>
    ${opts.comment ? `<p style="color: #6b7280; font-size: 14px;">Comment: ${opts.comment}</p>` : ''}
  `));
}

export async function sendLeaveRejectedEmail(opts: {
  to: string; firstName: string; leaveType: string;
  startDate: string; endDate: string; totalDays: number; comment?: string;
}) {
  await sendEmail(opts.to, `Leave Request Rejected — ${opts.leaveType}`, wrap(`
    <p style="color: #374151;">Hi ${opts.firstName},</p>
    <p style="color: #374151;">Unfortunately your leave request has been <strong style="color: #dc2626;">rejected</strong>.</p>
    <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
      <tr><td style="padding: 8px; color: #6b7280; border-bottom: 1px solid #f3f4f6;">Leave Type</td><td style="padding: 8px; font-weight: 600; border-bottom: 1px solid #f3f4f6;">${opts.leaveType}</td></tr>
      <tr><td style="padding: 8px; color: #6b7280; border-bottom: 1px solid #f3f4f6;">From</td><td style="padding: 8px; border-bottom: 1px solid #f3f4f6;">${opts.startDate}</td></tr>
      <tr><td style="padding: 8px; color: #6b7280;">To</td><td style="padding: 8px;">${opts.endDate}</td></tr>
    </table>
    ${opts.comment ? `<p style="color: #374151; font-size: 14px;"><strong>Reason:</strong> ${opts.comment}</p>` : ''}
  `));
}

// ─── Claim notifications ──────────────────────────────────────────────────────

export async function sendClaimStatusEmail(opts: {
  to: string; firstName: string; category: string; amount: number;
  status: 'APPROVED' | 'PAID' | 'REJECTED'; note?: string;
}) {
  const statusLabel = opts.status === 'APPROVED' ? 'Approved' : opts.status === 'PAID' ? 'Paid' : 'Rejected';
  const statusColor = opts.status === 'REJECTED' ? '#dc2626' : '#16a34a';
  await sendEmail(opts.to, `Claim ${statusLabel} — ${opts.category}`, wrap(`
    <p style="color: #374151;">Hi ${opts.firstName},</p>
    <p style="color: #374151;">Your reimbursement claim has been <strong style="color: ${statusColor};">${statusLabel}</strong>.</p>
    <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
      <tr><td style="padding: 8px; color: #6b7280; border-bottom: 1px solid #f3f4f6;">Category</td><td style="padding: 8px; font-weight: 600; border-bottom: 1px solid #f3f4f6;">${opts.category}</td></tr>
      <tr><td style="padding: 8px; color: #6b7280;">Amount</td><td style="padding: 8px; font-weight: 600;">₹${opts.amount.toLocaleString('en-IN')}</td></tr>
    </table>
    ${opts.note ? `<p style="color: #374151; font-size: 14px;"><strong>Note:</strong> ${opts.note}</p>` : ''}
  `));
}

// ─── Payslip ready notification ───────────────────────────────────────────────

export async function sendPayslipReadyEmail(opts: {
  to: string; firstName: string; month: string; year: number; netPay: number;
}) {
  await sendEmail(opts.to, `Payslip Ready — ${opts.month} ${opts.year}`, wrap(`
    <p style="color: #374151;">Hi ${opts.firstName},</p>
    <p style="color: #374151;">Your payslip for <strong>${opts.month} ${opts.year}</strong> is now available.</p>
    <p style="color: #374151; font-size: 18px;">Net Pay: <strong style="color: #361963;">₹${opts.netPay.toLocaleString('en-IN')}</strong></p>
    <p style="color: #6b7280; font-size: 14px;">Log in to Athena HRMS to view and download your full payslip.</p>
  `));
}

// ─── Announcement notification ────────────────────────────────────────────────

export async function sendAnnouncementEmail(opts: {
  to: string; firstName: string; title: string; body: string;
}) {
  await sendEmail(opts.to, `New Announcement: ${opts.title}`, wrap(`
    <p style="color: #374151;">Hi ${opts.firstName},</p>
    <p style="color: #374151;">A new announcement has been posted on Athena HRMS.</p>
    <div style="background: #f8f7ff; border-left: 4px solid #361963; padding: 16px; margin: 16px 0; border-radius: 0 4px 4px 0;">
      <h3 style="margin: 0 0 8px 0; color: #361963;">${opts.title}</h3>
      <p style="margin: 0; color: #374151;">${opts.body}</p>
    </div>
  `));
}
