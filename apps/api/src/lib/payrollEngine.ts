/**
 * Athena V2 - Payroll Calculation Engine
 *
 * Handles:
 * - Working day counting (Mon–Fri, holidays excluded)
 * - West Bengal Professional Tax slab lookup
 * - Per-employee payslip computation
 * - Recomputation when MANUAL component values are updated
 */

// ─── Professional Tax (West Bengal monthly slab) ─────────────────────────────
const PT_SLABS = [
  { max: 10000,    tax: 0   },
  { max: 15000,    tax: 110 },
  { max: 25000,    tax: 130 },
  { max: 40000,    tax: 150 },
  { max: Infinity, tax: 200 },
];

export function calculatePT(monthlyGross: number): number {
  for (const slab of PT_SLABS) {
    if (monthlyGross <= slab.max) return slab.tax;
  }
  return 200;
}

// ─── Working Day Counter ──────────────────────────────────────────────────────
/**
 * Count all calendar days in a given month, excluding holidays.
 * Saturday and Sunday are treated as working days (company policy).
 * @param year   Full year (e.g. 2026)
 * @param month  1–12
 * @param holidays  Array of holiday Date objects
 */
export function countWorkingDays(year: number, month: number, holidays: Date[]): number {
  const daysInMonth = new Date(year, month, 0).getDate(); // last day of month
  let count = 0;

  for (let day = 1; day <= daysInMonth; day++) {
    const isHoliday = holidays.some(
      (h) =>
        h.getFullYear() === year &&
        h.getMonth()    === month - 1 &&
        h.getDate()     === day
    );
    if (!isHoliday) count++;
  }
  return count;
}

// ─── TDS (Income Tax) — New Regime, FY 2025-26 ───────────────────────────────
/**
 * Calculate annual TDS under the new tax regime (FY 2025-26 / Budget 2025).
 * - Standard deduction: ₹75,000
 * - Section 87A rebate: full rebate if taxable income ≤ ₹12,00,000 (tax = 0)
 * - Slabs: 0% up to ₹4L | 5% ₹4L-8L | 10% ₹8L-12L | 15% ₹12L-16L |
 *          20% ₹16L-20L | 25% ₹20L-24L | 30% above ₹24L
 * - Health & Education Cess: 4%
 * Returns monthly TDS amount (annual tax / 12), rounded to nearest rupee.
 */
export function calculateTDS(annualCtc: number): number {
  const STANDARD_DEDUCTION = 75_000;
  const taxableIncome = Math.max(0, annualCtc - STANDARD_DEDUCTION);

  // Slab computation
  let tax = 0;
  if      (taxableIncome <= 400_000)  tax = 0;
  else if (taxableIncome <= 800_000)  tax = (taxableIncome - 400_000)   * 0.05;
  else if (taxableIncome <= 1_200_000) tax = 20_000  + (taxableIncome - 800_000)   * 0.10;
  else if (taxableIncome <= 1_600_000) tax = 60_000  + (taxableIncome - 1_200_000) * 0.15;
  else if (taxableIncome <= 2_000_000) tax = 120_000 + (taxableIncome - 1_600_000) * 0.20;
  else if (taxableIncome <= 2_400_000) tax = 200_000 + (taxableIncome - 2_000_000) * 0.25;
  else                                 tax = 300_000 + (taxableIncome - 2_400_000) * 0.30;

  // Section 87A: full rebate if taxable income ≤ ₹12,00,000
  if (taxableIncome <= 1_200_000) return 0;

  // Add 4% cess
  const annualTax = Math.round(tax * 1.04);

  // Monthly TDS
  return Math.round(annualTax / 12);
}

// ─── Component shape (mirrors DB model) ──────────────────────────────────────
export interface ComponentSnapshot {
  name:     string;
  type:     'EARNING' | 'DEDUCTION';
  calcType: 'PERCENTAGE_OF_CTC' | 'FIXED' | 'MANUAL' | 'AUTO_PT' | 'AUTO_TDS';
  value:    number;
  order:    number;
}

// ─── Core computation ─────────────────────────────────────────────────────────
/**
 * Compute a single employee's payslip entry.
 *
 * Earnings formula:
 *   PERCENTAGE_OF_CTC → monthlyCtc × (value / 100)
 *   FIXED             → component.value (same for everyone)
 *   MANUAL            → 0 (HR fills in later while run is DRAFT)
 *
 * LWP Deduction (auto, not a component):
 *   lwpDeduction = fullGross × (lwpDays / workingDays)
 *   Stored in deductions JSON as "LWP Deduction"
 *
 * Deductions:
 *   AUTO_PT → WB PT slab applied to (fullGross – lwpDeduction)
 *   FIXED   → component.value
 *   MANUAL  → 0 (HR fills in later)
 *
 * Net Pay = grossPay − totalDeductions + reimbursements
 *   where grossPay = fullGross (sum of earnings before deductions)
 *         totalDeductions includes LWP Deduction + PT + any others
 */
export function computePayslipEntry(params: {
  monthlyCtc:     number;
  annualCtc?:     number;  // Used for AUTO_TDS calculation; defaults to monthlyCtc * 12
  workingDays:    number;
  lwpDays:        number;
  wfhDays?:       number;  // TEMPORARY_WFH approved days → 30% daily deduction
  components:     ComponentSnapshot[];
  reimbursements: number;
  // Optional: pass existing manual values to preserve them (used on recompute)
  existingEarnings?:   Record<string, number>;
  existingDeductions?: Record<string, number>;
}) {
  const {
    monthlyCtc, workingDays, lwpDays, components,
    reimbursements, existingEarnings = {}, existingDeductions = {},
  } = params;
  const annualCtc = params.annualCtc ?? monthlyCtc * 12;
  const wfhDays   = params.wfhDays ?? 0;

  const paidDays = Math.max(0, workingDays - lwpDays);

  // ── Earnings ─────────────────────────────────────────────────────────────
  const earnings: Record<string, number> = {};
  const earningComponents = [...components]
    .filter((c) => c.type === 'EARNING')
    .sort((a, b) => a.order - b.order);

  for (const comp of earningComponents) {
    let val = 0;
    if (comp.calcType === 'PERCENTAGE_OF_CTC') {
      val = round2((monthlyCtc * comp.value) / 100);
    } else if (comp.calcType === 'FIXED') {
      val = comp.value;
    } else if (comp.calcType === 'MANUAL') {
      // Preserve any value already entered by HR; default 0 for new runs
      val = existingEarnings[comp.name] ?? 0;
    }
    earnings[comp.name] = val;
  }

  // ── Full gross (pre-LWP) ─────────────────────────────────────────────────
  const fullGross = round2(
    Object.values(earnings).reduce((sum, v) => sum + v, 0)
  );

  // ── Deductions ───────────────────────────────────────────────────────────
  const deductions: Record<string, number> = {};

  // LWP Deduction (system-computed, always present when lwpDays > 0)
  const lwpDeduction =
    workingDays > 0 && lwpDays > 0
      ? round2(fullGross * (lwpDays / workingDays))
      : 0;
  if (lwpDeduction > 0) {
    deductions['LWP Deduction'] = lwpDeduction;
  }

  // WFH Deduction: 30% of daily gross for each approved TEMPORARY_WFH day.
  // If wfhDays is explicitly provided (initial run), recalculate fresh.
  // If wfhDays is not passed (manual edit recompute), preserve the existing value
  // so admin edits don't silently wipe WFH deductions already on the payslip.
  const wfhDeduction =
    params.wfhDays !== undefined
      ? (workingDays > 0 && wfhDays > 0
          ? round2(fullGross * (wfhDays / workingDays) * WFH_DEDUCTION_RATE)
          : 0)
      : (existingDeductions['WFH Deduction'] ?? 0);
  if (wfhDeduction > 0) {
    deductions['WFH Deduction'] = wfhDeduction;
  }

  // Prorated gross after LWP (used for PT slab lookup)
  const proratedGross = round2(fullGross - lwpDeduction - wfhDeduction);

  const deductionComponents = [...components]
    .filter((c) => c.type === 'DEDUCTION')
    .sort((a, b) => a.order - b.order);

  for (const comp of deductionComponents) {
    let val = 0;
    if (comp.calcType === 'AUTO_PT') {
      val = calculatePT(proratedGross);
    } else if (comp.calcType === 'AUTO_TDS') {
      val = calculateTDS(annualCtc);
    } else if (comp.calcType === 'FIXED') {
      val = comp.value;
    } else if (comp.calcType === 'MANUAL') {
      val = existingDeductions[comp.name] ?? 0;
    }
    deductions[comp.name] = val;
  }

  // ── Totals ────────────────────────────────────────────────────────────────
  const grossPay        = fullGross;
  const totalDeductions = round2(
    Object.values(deductions).reduce((sum, v) => sum + v, 0)
  );
  const netPay = round2(grossPay - totalDeductions + reimbursements);

  return {
    monthlyCtc,
    workingDays,
    lwpDays,
    paidDays,
    earnings,
    deductions,
    reimbursements,
    grossPay,
    totalDeductions,
    netPay,
  };
}

// ─── Saturday Policy (Ewards company policy) ─────────────────────────────────
/**
 * SATURDAY WORKING POLICY — read this before touching payroll Saturday logic.
 *
 * Each month has N Saturdays (typically 4, sometimes 5).
 *
 * OFF Saturdays (no work expected):
 *   Full-timer : 2 Saturdays off
 *   Intern     : 1 Saturday off
 *
 * OFFICE Saturday (1 per month, not fixed — any Saturday):
 *   Employees physically go to office. Attendance tracked via fingerprint device.
 *   NO worklog required for this Saturday.
 *
 * WFH Saturdays (remaining working Saturdays):
 *   Full-timer : N - 3 Saturdays  (N total − 2 off − 1 office)
 *   Intern     : N - 2 Saturdays  (N total − 1 off − 1 office)
 *   An APPROVED worklog must be submitted for each WFH Saturday.
 *
 * WORKED Saturday = fingerprint attendance record EXISTS  OR  approved worklog submitted.
 *   This means the office Saturday (fingerprint only) counts as a worked Saturday.
 *
 * PENALTY (applied as LWP deduction at payroll run time):
 *   required_worked = N - 3  (full-timer)  |  N - 2  (intern)
 *   penalty_days    = max(0, required_worked − actual_worked_saturdays)
 *   Each missing Saturday = 1 full LWP day deducted.
 *
 * NOTE: Declared WFH days (company-wide) are handled separately — if an admin
 * declares a specific date as WFH, all employees must submit a worklog regardless
 * of whether it is a Saturday. That penalty is computed independently.
 *
 * NOTE: Absence auto-marking skips ALL Saturdays — Saturday compliance is
 * handled entirely through this worklog/fingerprint check, not absence records.
 */
export const SATURDAY_FREE_OFF: Record<'FULL_TIME' | 'INTERN', number> = {
  FULL_TIME: 3, // 2 off + 1 office = 3 non-worklog Saturdays
  INTERN:    2, // 1 off + 1 office = 2 non-worklog Saturdays
};

// ─── Special Leave Types ───────────────────────────────────────────────────────
/**
 * UNLIMITED_LEAVE_TYPES: Leave types with no fixed balance.
 *   TEMPORARY_WFH — employee works from home; 30% daily pay deduction applies.
 *   TRAVELLING    — employee is on field travel; auto-treated as present, no LWP.
 *
 * Rules:
 *   - No LeaveBalance row created or decremented for these types.
 *   - TEMPORARY_WFH: deduction = (fullGross / workingDays) × wfhDays × WFH_DEDUCTION_RATE
 *     Added to payslip deductions as "WFH Deduction". LWP days unaffected.
 *   - TRAVELLING: approved travelling days are subtracted from computed LWP.
 */
export const UNLIMITED_LEAVE_TYPES = ['TEMPORARY_WFH', 'TRAVELLING'] as const;
export const WFH_DEDUCTION_RATE    = 0.30;

// ─── Helper ──────────────────────────────────────────────────────────────────
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
