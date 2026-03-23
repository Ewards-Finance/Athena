/**
 * Athena V3.1 - Policy Engine
 *
 * Replaces hardcoded values with versioned PolicyRule lookups.
 * Each PolicyVersion contains a set of key-value rules that control
 * payroll, attendance, leave, and other business logic.
 *
 * Usage:
 *   const rate = await getNumericRule(policyVersionId, 'wfh_deduction_pct', 30);
 *   const enabled = await getBooleanRule(policyVersionId, 'sandwich_rule_enabled', true);
 */

import { prisma } from './prisma';

// ─── Default Policy Values ───────────────────────────────────────────────────
// Fallbacks when a rule is not found in the active policy version.
// These match the V2 hardcoded values.
const DEFAULTS: Record<string, string> = {
  wfh_deduction_pct:          '30',
  sandwich_rule_enabled:      'true',
  late_cutoff_time:           '10:15',
  half_day_hours_threshold:   '4.5',
  late_lwp_threshold:         '4',
  sat_free_fulltime:          '3',
  sat_free_intern:            '2',
  default_notice_period_days: '90',
  leave_encashment_rate:      '1.0',
  compoff_expiry_days:        '90',
  tds_regime:                 'new',
  tds_standard_deduction:     '75000',   // ₹75,000 standard deduction (FY2025-26)
  tds_87a_rebate_limit:       '1200000', // Section 87A: full rebate if taxable income ≤ this
  pt_state:                   'west_bengal',
  pf_enabled:                 'false',
  esi_enabled:                'false',
  sick_leave_doc_required_days: '2',
  wfh_allowed_per_month:      '0',
  carry_forward_max_days:     '15',
  probation_default_days:     '90',
  extension_arrival_time:     '11:00',
  late_lwp_penalty_days:      '0.5',   // LWP days deducted per late mark beyond threshold
  max_loan_amount:            '5000000', // max loan amount an employee can request (₹)
  max_loan_installments:      '60',    // max EMI tenure in months
};

/**
 * Get the currently active policy version (with rules loaded).
 * Resolution order when companyId is provided:
 *   1. COMPANY_SPECIFIC active version for that company
 *   2. GLOBAL active version (fallback)
 */
export async function getActivePolicyVersion(companyId?: string) {
  if (companyId) {
    const companySpecific = await prisma.policyVersion.findFirst({
      where: { isActive: true, scope: 'COMPANY_SPECIFIC', companyId },
      include: { rules: true },
    });
    if (companySpecific) return companySpecific;
  }
  return prisma.policyVersion.findFirst({
    where: { isActive: true, scope: 'GLOBAL' },
    include: { rules: true },
  });
}

/**
 * Get a single policy rule value as a string.
 * If policyVersionId is null, looks up active version (company-specific first, then global).
 * If rule not found in company-specific version, falls back to global version rule, then default.
 */
export async function getPolicyRule(
  policyVersionId: string | null,
  key: string,
  companyId?: string,
): Promise<string> {
  if (policyVersionId) {
    const rule = await prisma.policyRule.findUnique({
      where: { policyVersionId_ruleKey: { policyVersionId, ruleKey: key } },
    });
    if (rule) return rule.ruleValue;
  } else {
    // Try company-specific active version first
    if (companyId) {
      const companyActive = await prisma.policyVersion.findFirst({
        where: { isActive: true, scope: 'COMPANY_SPECIFIC', companyId },
        include: { rules: true },
      });
      if (companyActive) {
        const rule = companyActive.rules.find(r => r.ruleKey === key);
        if (rule) return rule.ruleValue;
      }
    }
    // Fall back to global active version
    const globalActive = await prisma.policyVersion.findFirst({
      where: { isActive: true, scope: 'GLOBAL' },
      include: { rules: true },
    });
    if (globalActive) {
      const rule = globalActive.rules.find(r => r.ruleKey === key);
      if (rule) return rule.ruleValue;
    }
  }
  return DEFAULTS[key] ?? '';
}

/**
 * Get a numeric policy rule.
 */
export async function getNumericRule(
  policyVersionId: string | null,
  key: string,
  fallback?: number,
): Promise<number> {
  const val = await getPolicyRule(policyVersionId, key);
  const parsed = parseFloat(val);
  if (Number.isFinite(parsed)) return parsed;
  return fallback ?? parseFloat(DEFAULTS[key] ?? '0');
}

/**
 * Get a boolean policy rule.
 */
export async function getBooleanRule(
  policyVersionId: string | null,
  key: string,
  fallback?: boolean,
): Promise<boolean> {
  const val = await getPolicyRule(policyVersionId, key);
  if (val === 'true') return true;
  if (val === 'false') return false;
  return fallback ?? DEFAULTS[key] === 'true';
}

/**
 * Load all rules into a Map for batch usage (avoids N+1 queries in payroll).
 * If companyId provided: merges global rules first, then overlays company-specific rules.
 * policyVersionId is the frozen version on the PayrollRun (always GLOBAL scope).
 */
export async function loadPolicyRulesMap(
  policyVersionId: string,
  companyId?: string,
): Promise<Map<string, string>> {
  // Load the base (global) rules from the frozen version
  const rules = await prisma.policyRule.findMany({ where: { policyVersionId } });
  const map = new Map<string, string>();
  for (const rule of rules) {
    map.set(rule.ruleKey, rule.ruleValue);
  }
  // Fill in defaults for any missing keys
  for (const [key, val] of Object.entries(DEFAULTS)) {
    if (!map.has(key)) map.set(key, val);
  }

  // Overlay company-specific active rules (these take priority over global)
  if (companyId) {
    const companyVersion = await prisma.policyVersion.findFirst({
      where: { isActive: true, scope: 'COMPANY_SPECIFIC', companyId },
      include: { rules: true },
    });
    if (companyVersion) {
      for (const rule of companyVersion.rules) {
        map.set(rule.ruleKey, rule.ruleValue);
      }
    }
  }

  return map;
}

/**
 * Get a value from a pre-loaded rules map, with type conversion helpers.
 */
export function ruleFromMap(map: Map<string, string>, key: string): string {
  return map.get(key) ?? DEFAULTS[key] ?? '';
}

export function numericRuleFromMap(map: Map<string, string>, key: string): number {
  const val = ruleFromMap(map, key);
  const parsed = parseFloat(val);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function booleanRuleFromMap(map: Map<string, string>, key: string): boolean {
  return ruleFromMap(map, key) === 'true';
}

/**
 * All default rule definitions — used when seeding the first PolicyVersion.
 */
export const DEFAULT_POLICY_RULES = Object.entries(DEFAULTS).map(([key, value]) => {
  let valueType = 'string';
  if (value === 'true' || value === 'false') valueType = 'boolean';
  else if (/^\d+(\.\d+)?$/.test(value)) valueType = 'number';
  else if (/^\d{1,2}:\d{2}$/.test(value)) valueType = 'time';

  const descriptions: Record<string, string> = {
    wfh_deduction_pct:          '% salary deducted per WFH day',
    sandwich_rule_enabled:      'Enable sandwich rule for leaves',
    late_cutoff_time:           'After this time = late mark',
    half_day_hours_threshold:   'Hours worked < this = half day',
    late_lwp_threshold:         'Late marks after this count become LWP',
    sat_free_fulltime:          'Saturdays off per month for full-timers',
    sat_free_intern:            'Saturdays off per month for interns',
    default_notice_period_days: 'Default notice period in days',
    leave_encashment_rate:      'Multiplier on daily rate for encashment',
    compoff_expiry_days:        'Days before comp-off expires',
    tds_regime:                 '"new" or "old" tax regime',
    tds_standard_deduction:     'Standard deduction from gross income for TDS (₹)',
    tds_87a_rebate_limit:       'Section 87A: full tax rebate if taxable income ≤ this amount (₹)',
    pt_state:                   'State for PT slabs',
    pf_enabled:                 'PF deduction enabled (future)',
    esi_enabled:                'ESI deduction enabled (future)',
    sick_leave_doc_required_days: 'SL > this days requires medical doc',
    wfh_allowed_per_month:      'Max WFH days per month (0 = unlimited)',
    carry_forward_max_days:     'Max EL days to carry forward at year end',
    probation_default_days:     'Default probation period in days',
    extension_arrival_time:     'Extended arrival cutoff for certain days',
    late_lwp_penalty_days:      'LWP days deducted per late mark beyond the free threshold',
    max_loan_amount:            'Maximum loan amount an employee can request (₹)',
    max_loan_installments:      'Maximum EMI tenure in months for loans',
  };

  return {
    ruleKey: key,
    ruleValue: value,
    valueType,
    description: descriptions[key] ?? null,
  };
});
