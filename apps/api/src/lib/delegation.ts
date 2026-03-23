/**
 * Athena V3.1 Sprint 5 — Delegation Helper
 * Checks if a manager has an active delegate covering today's date.
 */

import { prisma } from './prisma';

/**
 * Returns the delegate's userId if the given manager has an active
 * delegation covering today. Returns null otherwise.
 */
export async function getActiveDelegate(managerId: string): Promise<string | null> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const delegation = await prisma.delegateApprover.findFirst({
    where: {
      delegatorId: managerId,
      isActive: true,
      fromDate: { lte: today },
      toDate: { gte: today },
    },
  });

  return delegation?.delegateId ?? null;
}

/**
 * Checks whether `approverId` is an active delegate for any manager
 * who is the reporting manager of `employeeId`.
 * Used to allow delegates to approve leaves/claims.
 */
export async function isDelegateForEmployee(approverId: string, employeeId: string): Promise<boolean> {
  // Find the employee's reporting manager from their active assignment
  const assignment = await prisma.employeeCompanyAssignment.findFirst({
    where: { userId: employeeId, status: 'ACTIVE' },
    select: { reportingManagerId: true },
  });

  // Also check from profile
  const profile = await prisma.profile.findUnique({
    where: { userId: employeeId },
    select: { managerId: true },
  });

  const managerId = assignment?.reportingManagerId || profile?.managerId;
  if (!managerId) return false;

  const delegate = await getActiveDelegate(managerId);
  return delegate === approverId;
}
