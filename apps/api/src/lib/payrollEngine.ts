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

// ─── Component shape (mirrors DB model) ──────────────────────────────────────
export interface ComponentSnapshot {
  name:     string;
  type:     'EARNING' | 'DEDUCTION';
  calcType: 'PERCENTAGE_OF_CTC' | 'FIXED' | 'MANUAL' | 'AUTO_PT';
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
  workingDays:    number;
  lwpDays:        number;
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

  // Prorated gross after LWP (used for PT slab lookup)
  const proratedGross = round2(fullGross - lwpDeduction);

  const deductionComponents = [...components]
    .filter((c) => c.type === 'DEDUCTION')
    .sort((a, b) => a.order - b.order);

  for (const comp of deductionComponents) {
    let val = 0;
    if (comp.calcType === 'AUTO_PT') {
      val = calculatePT(proratedGross);
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

// ─── Helper ──────────────────────────────────────────────────────────────────
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
