/**
 * Athena V3.1 - Sensitive Data Masking
 * Masks PAN, Aadhaar, and bank account numbers for non-privileged viewers.
 */

export function maskSensitiveFields(profile: any, viewerCanSeeAll: boolean): any {
  if (!profile || viewerCanSeeAll) return profile;

  const masked = { ...profile };

  // PAN: show first 2 + last 2 → "AB****EF"
  if (masked.pan) {
    masked.pan = masked.pan.length >= 4
      ? masked.pan.slice(0, 2) + '****' + masked.pan.slice(-2)
      : '****';
  }

  // Aadhaar: show last 4 only → "****5678"
  if (masked.aadharNumber) {
    masked.aadharNumber = masked.aadharNumber.length >= 4
      ? '****' + masked.aadharNumber.slice(-4)
      : '****';
  }

  // Bank account: show last 4 only → "****5678"
  if (masked.bankAccountNumber) {
    masked.bankAccountNumber = masked.bankAccountNumber.length >= 4
      ? '****' + masked.bankAccountNumber.slice(-4)
      : '****';
  }

  // IFSC is not PII — left visible

  return masked;
}
