/**
 * Athena V2 - Notification Helper
 * Central utility to create in-app notifications.
 * Call createNotification() from any route to fire a notification to a user.
 */

import { prisma } from './prisma';


export interface NotificationPayload {
  userId:  string;
  type:    string;
  title:   string;
  message: string;
  link?:   string;
}

/**
 * Creates a single notification for one recipient.
 * Silently catches errors so a notification failure never breaks the main flow.
 */
export async function createNotification(payload: NotificationPayload): Promise<void> {
  try {
    await prisma.notification.create({ data: payload });
  } catch (err) {
    console.error('[notify] Failed to create notification:', err);
  }
}

/**
 * Creates the same notification for multiple recipients (e.g. all admins).
 */
export async function createNotifications(payloads: NotificationPayload[]): Promise<void> {
  if (!payloads.length) return;
  try {
    await prisma.notification.createMany({ data: payloads });
  } catch (err) {
    console.error('[notify] Failed to create notifications (bulk):', err);
  }
}
