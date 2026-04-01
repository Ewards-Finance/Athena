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
export function calculateTDS(
  annualCtc: number,
  standardDeduction = 75_000,
  rebateLimit = 1_200_000,
): number {
  const taxableIncome = Math.max(0, annualCtc - standardDeduction);

  // Slab computation
  let tax = 0;
  if      (taxableIncome <= 400_000)   tax = 0;
  else if (taxableIncome <= 800_000)   tax = (taxableIncome - 400_000)   * 0.05;
  else if (taxableIncome <= 1_200_000) tax = 20_000  + (taxableIncome - 800_000)   * 0.10;
  else if (taxableIncome <= 1_600_000) tax = 60_000  + (taxableIncome - 1_200_000) * 0.15;
  else if (taxableIncome <= 2_000_000) tax = 120_000 + (taxableIncome - 1_600_000) * 0.20;
  else if (taxableIncome <= 2_400_000) tax = 200_000 + (taxableIncome - 2_000_000) * 0.25;
  else                                 tax = 300_000 + (taxableIncome - 2_400_000) * 0.30;

  // Section 87A: full rebate if taxable income ≤ rebateLimit
  if (taxableIncome <= rebateLimit) return 0;

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
  annualCtc?:     number;
  workingDays:    number;
  lwpDays:        number;
  wfhDays?:       number;
  components:     ComponentSnapshot[];
  reimbursements: number;
  // Policy-driven overrides (read from policyEngine, default to hardcoded fallbacks)
  wfhDeductionRate?:    number;  // e.g. 0.30 from wfh_deduction_pct rule
  tdsStandardDeduction?: number; // e.g. 75000 from tds_standard_deduction rule
  tdsRebateLimit?:      number;  // e.g. 1200000 from tds_87a_rebate_limit rule
  existingEarnings?:   Record<string, number>;
  existingDeductions?: Record<string, number>;
}) {
  const {
    monthlyCtc, workingDays, lwpDays, components,
    reimbursements, existingEarnings = {}, existingDeductions = {},
  } = params;
  const annualCtc          = params.annualCtc ?? monthlyCtc * 12;
  const wfhDays            = params.wfhDays ?? 0;
  const wfhDeductionRate   = params.wfhDeductionRate   ?? WFH_DEDUCTION_RATE;
  const tdsStandardDeduct  = params.tdsStandardDeduction ?? 75_000;
  const tdsRebateLimit     = params.tdsRebateLimit      ?? 1_200_000;

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
          ? round2(fullGross * (wfhDays / workingDays) * wfhDeductionRate)
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
      val = calculateTDS(annualCtc, tdsStandardDeduct, tdsRebateLimit);
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
 * UNLIMITED_LEAVE_TYPES: Leave types with no fixed balance and no balance tracking.
 *   TWFH       — employee works from home; 30% daily pay deduction applies.
 *   TRAVELLING — employee is on field travel; auto-treated as present, no LWP.
 *
 * Rules:
 *   - No LeaveBalance row created or decremented for these types.
 *   - TWFH: deduction = (fullGross / workingDays) × wfhDays × WFH_DEDUCTION_RATE
 *     Added to payslip deductions as "WFH Deduction". LWP days unaffected.
 *   - TRAVELLING: approved travelling days are subtracted from computed LWP.
 *
 * NO_BALANCE_TRACK_TYPES: Leave types with no balance cap but usage IS tracked.
 *   UL — Unpaid Leave. No quota, but `used` count is incremented on each approval
 *        so HR can see how many unpaid days an employee has taken. Approved UL days
 *        count as LWP in payroll (no pay for those days). No LWP cascade warning.
 */
export const UNLIMITED_LEAVE_TYPES   = ['TWFH', 'TRAVELLING'] as const;
export const NO_BALANCE_TRACK_TYPES  = ['UL'] as const;
export const WFH_DEDUCTION_RATE      = 0.30;

// ─── Mid-Month Salary Revision Pro-Rating ────────────────────────────────────
/**
 * Count working days within a sub-range of a month (startDay to endDay inclusive).
 * Uses the same logic as countWorkingDays: all calendar days minus holidays.
 */
export function countWorkingDaysInRange(
  year: number, month: number,
  startDay: number, endDay: number,
  holidays: Date[],
): number {
  let count = 0;
  for (let day = startDay; day <= endDay; day++) {
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

/**
 * Compute effective monthly CTC when a salary revision falls mid-month.
 *
 * If revision effectiveDate is day D of the target month:
 *   - days 1..(D-1) use oldCtc rate
 *   - days D..end use newCtc rate
 *   - weighted by working days in each range
 *
 * If multiple revisions in one month, uses the LATEST one (last effectiveDate).
 * Returns effectiveAnnualCtc = newCtc for TDS purposes (forward-looking).
 */
export function computeProRatedCtc(params: {
  baseAnnualCtc: number;
  workingDays:   number;
  month:         number;
  year:          number;
  revisions:     { effectiveDate: Date; oldCtc: number; newCtc: number }[];
  holidays:      Date[];
}): { effectiveMonthlyCtc: number; effectiveAnnualCtc: number; wasProRated: boolean } {
  const { baseAnnualCtc, workingDays, month, year, revisions, holidays } = params;

  // Filter revisions whose effectiveDate falls in this month
  const midMonthRevisions = revisions.filter((r) => {
    const d = new Date(r.effectiveDate);
    return d.getFullYear() === year && d.getMonth() === month - 1;
  });

  if (midMonthRevisions.length === 0 || workingDays === 0) {
    return {
      effectiveMonthlyCtc: round2(baseAnnualCtc / 12),
      effectiveAnnualCtc: baseAnnualCtc,
      wasProRated: false,
    };
  }

  // Use the latest revision in the month
  midMonthRevisions.sort(
    (a, b) => new Date(b.effectiveDate).getTime() - new Date(a.effectiveDate).getTime()
  );
  const rev = midMonthRevisions[0];
  const revDay = new Date(rev.effectiveDate).getDate();
  const daysInMonth = new Date(year, month, 0).getDate();

  // Working days before revision vs on/after
  const daysBefore = revDay > 1
    ? countWorkingDaysInRange(year, month, 1, revDay - 1, holidays)
    : 0;
  const daysAfter = countWorkingDaysInRange(year, month, revDay, daysInMonth, holidays);

  const oldMonthly = rev.oldCtc / 12;
  const newMonthly = rev.newCtc / 12;
  const effectiveMonthlyCtc = round2(
    (daysBefore / workingDays) * oldMonthly +
    (daysAfter / workingDays) * newMonthly
  );

  return {
    effectiveMonthlyCtc,
    effectiveAnnualCtc: rev.newCtc, // TDS uses the new CTC going forward
    wasProRated: true,
  };
}

// ─── Arrears Calculation ─────────────────────────────────────────────────────
/**
 * Calculate arrears for backdated salary revisions.
 *
 * A revision is "backdated" when effectiveDate is BEFORE the current payroll month
 * but was created (createdAt) AFTER the last finalized payroll run. This means the
 * revision wasn't captured in any previous payroll.
 *
 * For each such revision, compute delta for each missed month between effectiveDate
 * and the current payroll month.
 */
export function computeArrears(params: {
  currentMonth: number;
  currentYear:  number;
  revisions:    { effectiveDate: Date; oldCtc: number; newCtc: number }[];
}): { arrearsAmount: number; arrearsNote: string } {
  const { currentMonth, currentYear, revisions } = params;

  if (revisions.length === 0) {
    return { arrearsAmount: 0, arrearsNote: '' };
  }

  const MONTH_NAMES = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  let totalArrears = 0;
  const notes: string[] = [];

  for (const rev of revisions) {
    const effDate = new Date(rev.effectiveDate);
    const effMonth = effDate.getMonth() + 1; // 1-based
    const effYear = effDate.getFullYear();
    const monthlyDelta = round2((rev.newCtc - rev.oldCtc) / 12);

    if (monthlyDelta <= 0) continue; // only positive revisions generate arrears

    // Count months from effective month up to (but not including) current month
    let months = 0;
    let m = effMonth, y = effYear;
    while (y < currentYear || (y === currentYear && m < currentMonth)) {
      months++;
      m++;
      if (m > 12) { m = 1; y++; }
    }

    if (months > 0) {
      const arrears = round2(monthlyDelta * months);
      totalArrears += arrears;

      const fromLabel = `${MONTH_NAMES[effMonth]} ${effYear}`;
      // "To" month is the month before currentMonth
      let toM = currentMonth - 1, toY = currentYear;
      if (toM < 1) { toM = 12; toY--; }
      const toLabel = `${MONTH_NAMES[toM]} ${toY}`;

      notes.push(
        `CTC revised ${fmtLakh(rev.oldCtc)}→${fmtLakh(rev.newCtc)} ` +
        `effective ${fromLabel}: ₹${arrears.toLocaleString('en-IN')} ` +
        `(${months} month${months > 1 ? 's' : ''}, ${fromLabel}–${toLabel})`
      );
    }
  }

  return {
    arrearsAmount: round2(totalArrears),
    arrearsNote: notes.length > 0 ? `Arrears: ${notes.join('; ')}` : '',
  };
}

function fmtLakh(n: number): string {
  if (n >= 100_000) return `${round2(n / 100_000)}L`;
  return `₹${n.toLocaleString('en-IN')}`;
}

// ─── Helper ──────────────────────────────────────────────────────────────────
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
