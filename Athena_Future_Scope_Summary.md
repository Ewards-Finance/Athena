# Athena Future Scope Summary

This file consolidates the three documents in `Future_scopes` into one Athena-specific roadmap.

Source files reviewed:
- `Future_scopes/hrms_blueprint_feedback.txt`
- `Future_scopes/hrms_current_vs_initial_feedback.txt`
- `Future_scopes/hrms_product_gap_analysis.txt`

Status legend:
- `Implemented`: already present in Athena in meaningful form
- `Partial`: some support exists, but the full scope is not complete
- `Missing`: not currently implemented in Athena
- `Done ✓`: was Missing/Partial, now fully implemented (built in this session)

---

## Executive Summary

The three documents are broadly aligned. After removing repetition, the future scope for Athena clusters into:
- stronger employee lifecycle management
- richer leave and attendance policy automation
- more complete statutory payroll
- better reporting, audit, security, and admin tooling
- a cleaner configuration and integration layer

Athena already covers the operational core well:
- auth and RBAC
- employee directory and profile management
- leave workflow with balances and policy management
- attendance import, mapping, late policy, and corrections
- claims workflow with attachments
- worklogs and declared WFH
- holidays, announcements, notifications
- payroll runs, manual components, finalize/export, payslips

**After this session, the following gaps are now closed:**
- employee lifecycle states (5-state model per employment type)
- audit logs with before/after capture for critical actions
- central system settings panel (attendance thresholds, probation, notice period)
- TDS (income tax) calculation under new regime FY 2025-26
- leave overlap warning before applying
- financial year (Apr–Mar) based leave balances
- annual leave reset with full carry-forward
- password complexity enforcement

**Remaining biggest missing areas:**
- exit workflows (formal resignation, asset return, final settlement)
- shift-based attendance and absence automation
- PF / ESI support (decided: skip for this org)
- profile change history (decided: not needed for this org)

---

## Consolidated Scope By Module

### 1. Employee Lifecycle Management

- `Done ✓` Multi-stage employee lifecycle implemented:
  Full-time path: **Pending Join → Probation → Regular Full-time → Notice Period → Inactive**.
  Intern path: **Pending Join → Internship → Regular Full-time → Notice Period → Inactive**.
  HR Admin can set any status freely from the Organization page (no forced order).
- `Partial` Probation tracking exists via status; dedicated confirmation workflow (auto-notify, auto-promote) is not yet built.
- `Missing` Formal resignation submission by employee and notice period tracking workflow.
- `Missing` Exit workflow: exit interview, asset return checklist, final settlement.
- `Done ✓` Employee status change history captured in Audit Logs (actor, old status, new status, timestamp).
- `Done ✓` `User.isActive` plus `User.employmentStatus` now both maintained.

### 2. Employee Profile and Employee Master

- `Implemented` Core profile, statutory, bank, manager, role, CTC, and employment type fields.
- `Implemented` Phone and emergency contact fields already exist.
- `Partial` Document handling exists for KYC and appointment letter uploads, but not as a full document vault.
- `Missing` Employee photo.
- `Missing` Residential address.
- `Missing` Skills / expertise fields.
- `Missing` Emergency contact relationship.
- `Partial` Work location exists as office location, but not as a richer multi-location model.
- `Missing` Profile change history for department, designation, reporting manager, and CTC updates.
  _(Note: CTC and role changes now appear in Audit Logs, but a dedicated profile history timeline is not built.)_

### 3. Leave Management

- `Implemented` Core leave workflow, balances, approvals, half-day support, leave policy CRUD, admin type override, cancellation with balance restore.
- `Implemented` SL, CL, EL, maternity, and paternity are already supported through leave policies.
- `Missing` Comp Off / compensatory leave workflow.
- `Done ✓` Overlapping leave detection: warns employee before submitting if dates clash with existing PENDING/APPROVED leave. Employee can override and submit anyway.
- `Missing` Team leave calendar view.
- `Partial` Carry-forward is now implemented (full unused balance rolls over on FY reset). Expiry rules and encashment policy are not yet built.
- `Done ✓` Manual annual leave reset with full carry-forward logic. Admin triggers it from Organization → Leave Quotas tab with a From FY / To FY selector.
- `Done ✓` Leave balances are now **financial year based** (April 1 – March 31) throughout the system.

### 4. Attendance, Shift Policy, and Working Hours

- `Implemented` ZKTeco import, EnNo mapping, first-punch/check-in and last-punch/check-out logic, import history, late policy, extension dates, manual check-in correction, attendance summaries.
- `Done ✓` Absence auto-marking: Admin triggers from Attendance → Records tab ("Mark Absences" button). Selects a date range; engine skips Sundays and holidays, and marks absence for employees with no punch AND no approved leave. Stored in `AbsenceRecord` model. Visible in Reports → Attendance.
- `Missing` Full manual attendance entry workflow: mark present / absent / override whole attendance day.
- `Missing` Shift master: shift start, shift end, minimum hours, half-day threshold.
- `Missing` Half-day/full-day attendance logic based on working hours.
- `Missing` Remote attendance / manual WFH attendance tagging.
- `Done ✓` Extension arrival cutoff and half-day cutoff times are now **configurable** via System Settings (previously hardcoded).
- `Done ✓` Late warning threshold (free lates before LWP kicks in) is now **configurable** via System Settings (previously hardcoded at 3).

### 5. Holiday Work, Sunday Work, Overtime, and Comp Off

- `Implemented` Holiday calendar and declared WFH dates exist.
- `Missing` Policy for working on Sundays or holidays.
- `Missing` Comp-off credit generation.
- `Missing` Overtime tracking.

### 6. Payroll and Salary Administration

- `Implemented` Payroll components, CTC setup, monthly payroll runs, manual pay components, PT, LWP, reimbursements in payroll, finalize/export, employee payslips.
- `Done ✓` **TDS (Income Tax) support** — new tax regime FY 2025-26. AUTO_TDS component calcType added. Calculation: CTC − ₹75,000 standard deduction → slab tax → Section 87A rebate (if taxable ≤ ₹12L, tax = ₹0) → 4% cess → monthly TDS. Based on fixed annual CTC, not affected by LWP.
- `Missing` PF and ESI support.
- `Missing` Salary structure templates.
- `Missing` Salary revision history with effective dates.
- `Missing` Retroactive payroll adjustments.
- `Missing` Payroll reopen after finalization, with audit controls.
- `Missing` Bonus and incentive management.
- `Partial` Payroll is now statutory-partial (PT + TDS). PF and ESI remain missing.

### 7. Claims and Reimbursements

- `Implemented` Claim submission, approval, rejection, paid flow, receipt upload, inclusion in payroll.
- `Partial` Receipt viewing exists by opening the uploaded file, but there is no dedicated inline preview experience.
- `Missing` Category-wise and monthly claim limits.
- `Missing` Duplicate claim detection.
- `Missing` Claim analytics / reporting.

### 8. Worklogs and Productivity

- `Implemented` Daily worklogs, manager/admin review, rejection/restore, own/team/all views, declared WFH days.
- `Missing` Project tagging.
- `Missing` Task categories.
- `Missing` Hours tracking inside worklogs.
- `Missing` Weekly summaries / productivity reports.
- `Missing` Manager productivity dashboard.

### 9. Reporting and Analytics

- `Partial` Dashboard has operational widgets and summary cards.
- `Done ✓` **Reporting & Analytics** module at `/reports` (Admin only). Three tabs:
  - **HR Overview**: headcount, dept distribution, status/type/role breakdown, tenure buckets, recent joiners.
  - **Attendance**: per-employee late/LWP/absent/leave summary + department rollup for selected month.
  - **Payroll**: total cost, dept cost summary, per-employee gross/net/TDS table for selected payroll run.

### 10. Notifications and Communication

- `Implemented` In-app notifications with unread count, mark-as-read, and role-based event triggers.
- `Missing` Email notifications.
- `Missing` Slack / messaging integration.
- `Missing` Mobile push notifications.

### 11. Document Management

- `Partial` Athena supports employee document uploads and claim attachments.
- `Done ✓` **Document Vault** at `/documents`. Employees see their own docs; Admin can view/upload/delete for any employee. Categories: Offer Letter, Appointment Letter, Experience Letter, KYC, Contract, Payslip, Other. Grouped by category in the UI.
- `Missing` Document version history.
- `Missing` Document expiry alerts.
- `Missing` Policy document storage.

### 12. Admin Productivity and Bulk Operations

- `Implemented` Admin CRUD for employees, holidays, announcements, leave policy, payroll setup, attendance imports/mappings.
- `Missing` Bulk employee import UI/flow.
- `Missing` Bulk leave approval.
- `Missing` Bulk salary updates.
- `Missing` Bulk attendance corrections.
- `Partial` Search exists in some modules, but advanced multi-filter admin search is missing.
- `Done ✓` **Bulk employee import**: Admin clicks "Bulk Import" in Organization → Directory. Can download a live Excel template (always reflects current required fields) or upload a filled template. Import processes each row, creates employees, and returns a per-row summary of created/skipped with reasons.

### 13. System Configuration

- `Done ✓` **Central System Settings panel** built at `/settings` (Admin only).
  Configurable parameters: extension day arrival cutoff, first-half-leave arrival cutoff, late warning threshold (free lates before LWP), probation duration (months), notice period (days).
  Settings stored in `SystemSetting` DB table and read live by the attendance engine.
- `Partial` Carry-forward limits and leave encashment rules are not yet configurable (carry-forward is currently all-or-nothing).
- `Missing` Shift policy configuration.
- `Missing` Payroll rules configuration (PF ceiling, ESI threshold, etc).

### 14. Audit Logs and Compliance

- `Done ✓` **System-wide Audit Log** built at `/audit-logs` (Admin only).
  Captures: actor, action, entity, entity ID, old values (JSON), new values (JSON), timestamp.
  Paginated and filterable by action/entity.
- `Done ✓` Change history captured for:
  - Leave approve / reject
  - Employee role, CTC, employment status changes
  - Employee deactivation
  - Attendance manual corrections
- `Done ✓` Salary revision history: auto-logged whenever admin changes Annual CTC. Dedicated `SalaryRevision` model. Visible to Admin (any employee) and the employee themselves. Accessible via the TrendingUp icon in Organization → Employee Directory.
- `Missing` Configuration change audit (settings changes not yet logged).

### 15. Security and Data Protection

- `Implemented` Password hashing and JWT auth.
- `Done ✓` **Password complexity policy** enforced on new employee creation: minimum 8 characters, must contain uppercase, lowercase, digit, and special character.
- `Missing` Login rate limiting / brute-force protection (decided not to implement — internal app).
- `Missing` Two-factor authentication.
- `Missing` Encryption for PAN, Aadhaar, and bank details at rest.

### 16. Mobile Experience

- `Partial` Frontend is responsive and mobile-aware in several pages.
- `Partial` PWA tooling is present in the web app setup, but this should be treated as incomplete until installability/offline/push behavior is verified end-to-end.
- `Missing` Mobile push notifications.
- `Missing` Dedicated mobile UX hardening across all modules.

### 17. Integrations

- `Implemented` Biometric device file import is already integrated.
- `Missing` Integration API layer for external systems.
- `Missing` ERP / accounting / communication tool integrations.

### 18. Backup and Disaster Recovery

- `Missing` Defined backup strategy.
- `Missing` Automated database backup jobs.
- `Missing` Restore and recovery procedures.

### 19. Scalability and Architecture

- `Partial` Current architecture is clean enough for the current product stage and user size.
- `Missing` Pagination and indexing review for scale.
- `Missing` Background job queue for heavy operations: attendance import, payroll generation, notifications, reports.
- `Missing` Service modularization for payroll, attendance, notifications, reporting.
- `Missing` Historical data archival strategy.

---

## Suggested Athena Build Order

### Phase 1: Operational Hardening ← IN PROGRESS

- `Done ✓` Employee lifecycle states (5-state model per employment type)
- `Done ✓` Leave overlap validation
- `Done ✓` Annual leave reset with carry-forward (FY-based)
- `Done ✓` TDS / income tax support (new regime)
- `Done ✓` Central settings module
- `Done ✓` Audit logs
- `Done ✓` Password complexity policy
- `Done ✓` Absence auto-marking (Admin-triggered, date-range based, skips Sundays + holidays)
- PF / ESI support (decided: skip — org does not use PF/ESI yet)
- Login rate limiting (decided: skip for internal app)

### Phase 2: HR Admin Efficiency

- Profile change history (decided: not needed for this org)
- `Done ✓` Salary revision history with effective dates
- `Done ✓` Bulk employee import (live downloadable template from app)
- Advanced admin filters (deferred to after Phase 3)
- `Done ✓` Document vault
- `Done ✓` Reporting and analytics baseline

### Phase 3: Product Maturity

- Comp-off and overtime policy
- Formal resignation / exit workflow
- Payroll reopen / retro adjustments
- Email and push notifications
- Worklog productivity enhancements (project tags, hours, weekly summary)
- Integrations layer
- Backup / DR and background jobs

---

## Recommended Interpretation For Athena

These documents should not be treated as a brand-new PRD. They are a gap-analysis overlay on top of Athena's existing foundation.

Pragmatically, Athena should proceed as:
- keep the current operational core intact
- avoid rewriting working modules
- add missing enterprise controls around lifecycle, policy configuration, statutory payroll, audit, and security first
- treat analytics, integrations, and advanced productivity features as later phases after the system-of-record flows are hardened

## Net Assessment

Athena is now a solid Phase 1 HRMS. The operational core plus the new controls (audit, lifecycle, TDS, settings, FY leave reset) give it the compliance and configurability needed for a small-to-mid company running it in production. The next priority should be Phase 2 — making the admin experience more efficient with profile history, salary history, and basic reporting so HR has the data visibility to manage the workforce without going into the database directly.
