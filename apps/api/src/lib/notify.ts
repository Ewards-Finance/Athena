/**
 * Athena V2 - Notification Helper
 * Central utility to create in-app notifications.
 * Call createNotification() from any route to fire a notification to a user.
 */

import { prisma } from './prisma';
import { sendNotificationEmail } from './email';


export interface NotificationPayload {
  userId:  string;
  type:    string;
  title:   string;
  message: string;
  link?:   string;
}

/**
 * Creates a single in-app notification and fires a mirror email to the recipient.
 * Both operations are error-silent so a failure never breaks the main API flow.
 */
export async function createNotification(payload: NotificationPayload): Promise<void> {
  try {
    await prisma.notification.create({ data: payload });
  } catch (err) {
    console.error('[notify] Failed to create notification:', err);
  }
  // Fire email — fully async, never blocks the caller
  prisma.user.findUnique({ where: { id: payload.userId }, select: { email: true } })
    .then((u) => {
      if (u?.email) {
        sendNotificationEmail({
          to:      u.email,
          subject: payload.title,
          title:   payload.title,
          message: payload.message,
          link:    payload.link,
        }).catch(() => {});
      }
    })
    .catch(() => {});
}

/**
 * Creates the same notification for multiple recipients (e.g. all admins)
 * and fires mirror emails to all of them.
 */
export async function createNotifications(payloads: NotificationPayload[]): Promise<void> {
  if (!payloads.length) return;
  try {
    await prisma.notification.createMany({ data: payloads });
  } catch (err) {
    console.error('[notify] Failed to create notifications (bulk):', err);
  }
  // Fire emails — fully async, never blocks the caller
  const ids = payloads.map((p) => p.userId);
  prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, email: true } })
    .then((users) => {
      const emailMap = new Map(users.map((u) => [u.id, u.email]));
      for (const p of payloads) {
        const email = emailMap.get(p.userId);
        if (email) {
          sendNotificationEmail({
            to:      email,
            subject: p.title,
            title:   p.title,
            message: p.message,
            link:    p.link,
          }).catch(() => {});
        }
      }
    })
    .catch(() => {});
}
