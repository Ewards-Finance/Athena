/**
 * Athena V2 - Audit Log Helper
 * Creates audit log entries for critical system actions.
 * Errors are silently swallowed so audit failures never break the main flow.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface AuditPayload {
  actorId:   string;
  action:    string;       // e.g. 'LEAVE_APPROVED', 'SALARY_CHANGED'
  entity:    string;       // e.g. 'LeaveRequest', 'Profile'
  entityId?: string;
  subjectEntity?: string;
  subjectId?: string;
  subjectLabel?: string;
  subjectMeta?: Record<string, any>;
  oldValues?: Record<string, any>;
  newValues?: Record<string, any>;
}

export async function createAuditLog(payload: AuditPayload): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        actorId:   payload.actorId,
        action:    payload.action,
        entity:    payload.entity,
        entityId:  payload.entityId,
        subjectEntity: payload.subjectEntity,
        subjectId:     payload.subjectId,
        subjectLabel:  payload.subjectLabel,
        subjectMeta:   payload.subjectMeta ?? undefined,
        oldValues: payload.oldValues ?? undefined,
        newValues: payload.newValues ?? undefined,
      },
    });
  } catch (err) {
    console.error('Audit log error (non-fatal):', err);
  }
}
