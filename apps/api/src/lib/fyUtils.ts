/**
 * Financial Year Utilities (India: April 1 – March 31)
 * FY 2025-26 spans Apr 2025 → Mar 2026 and is identified as year = 2025.
 */

/**
 * Returns the starting year of the Financial Year that contains the given date.
 * e.g. Jan 2026 → 2025, Apr 2026 → 2026
 */
export function getFYYear(date: Date): number {
  const month = date.getMonth() + 1; // 1–12
  const year  = date.getFullYear();
  return month >= 4 ? year : year - 1;
}

/**
 * Returns the current FY start year (April 1 of that FY year).
 */
export function currentFYYear(): number {
  return getFYYear(new Date());
}
