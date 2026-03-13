# HRMS Product Blueprint
## Arjava Advisors Private Limited

**Document Type:** Product Requirements & Feature Specification
**Prepared for:** Internal Development
**Company:** Arjava Advisors Private Limited
**Location:** Kolkata, West Bengal
**Employee Strength:** 80–100 employees

---

## 1. Overview

Arjava Advisors Private Limited requires a web-based Human Resource Management System (HRMS) to manage the complete employee lifecycle — from onboarding and daily attendance to monthly payroll processing and reimbursements. The system must be accessible via browser on both desktop and mobile (PWA or equivalent).

The system serves three user types: **HR Admin**, **Manager**, and **Employee**, each with distinct capabilities. All data is company-specific and the system must reflect Arjava's actual policies, departments, leave rules, and payroll structure.

---

## 2. Company Structure

### 2.1 Departments
The system must support the following departments exactly as named:

| # | Department Name |
|---|----------------|
| 1 | HR & Finance |
| 2 | eWards Marketing |
| 3 | eWards Sales |
| 4 | eWards Developer |
| 5 | eWards Product Analyst |
| 6 | eWards Support |
| 7 | eWards MC |
| 8 | SN Designer |
| 9 | SN Tech |
| 10 | SN Servicing |
| 11 | SN Sales |
| 12 | Second Hugs |

### 2.2 Office
- **Primary Office Location:** Kolkata, West Bengal
- **Professional Tax Jurisdiction:** West Bengal (see Section 7.3 for slabs)

### 2.3 User Roles
| Role | Description |
|------|-------------|
| **Admin** | Full system access. Manages employees, payroll, attendance, policies. Represents HR. |
| **Manager** | Can approve/reject leaves and claims for their direct reports. Views team attendance and worklogs. |
| **Employee** | Self-service access. Can apply leaves, submit claims, log work, view own payslips. |

Every employee must be assigned exactly one role. Managers are also employees and have their own self-service access in addition to team management capabilities.

---

## 3. Authentication & Access Control

- Email + password login
- Session managed via JWT tokens (stateless)
- All pages and API endpoints must enforce role-based access control (RBAC)
- Three-level hierarchy: Admin > Manager > Employee
- Employees can only see and act on their own data
- Managers can see their direct reports' data
- Admins can see everything
- Passwords must be stored hashed (bcrypt or equivalent)

---

## 4. Employee Management

### 4.1 Employee Profile
Each employee record must contain the following fields:

**Identity**
- First Name, Last Name
- Employee ID (e.g. ARJ-001 format)
- Email address (used as login)
- Date of Birth
- Blood Group
- Emergency Contact Number

**Employment Details**
- Department (from the fixed list in Section 2.1)
- Designation / Job Title
- Date of Joining
- Office Location
- Reporting Manager (linked to another employee)
- Role (Admin / Manager / Employee)
- Active/Inactive status (soft delete — never hard delete employees)

**Statutory / Compliance**
- PAN Number
- Aadhar Number
- UAN (Universal Account Number — PF)

**Bank Details**
- Bank Account Number
- IFSC Code
- Bank Name

**Payroll**
- Annual CTC (Cost to Company) — set by Admin

### 4.2 Employee Operations
- Admin can add new employees
- Admin can deactivate employees (they remain in historical records)
- Admin and the employee themselves can update profile details
- Only Admin can change: department, designation, role, reporting manager, CTC
- Employee can update: phone, emergency contact, bank details

---

## 5. Leave Management

### 5.1 Leave Types & Annual Entitlements
The following leave types are configured for Arjava Advisors. Quotas are per calendar year per employee:

| Code | Name | Annual Entitlement |
|------|------|--------------------|
| SL | Sick Leave | 12 days |
| CL | Casual Leave | 12 days |
| EL | Earned Leave | 15 days |
| MATERNITY | Maternity Leave | 180 days |
| PATERNITY | Paternity Leave | 5 days |

- Leave policies (types and default totals) must be configurable by Admin
- Admin can also manually override individual employee quotas for a given year
- Admin can apply policy defaults to all employees at the start of a new year

### 5.2 Leave Application Rules
Employees apply for leaves with the following options:

**Single Day Leave:**
- Full Day
- First Half (morning session)
- Second Half (afternoon session)

**Multiple Day Leave:**
- Start Day: Full Day or From Second Half
- End Day: Full Day or Until First Half
- System must auto-calculate total days, excluding weekends and company holidays

**Minimum leave unit:** 0.5 day (half day)

### 5.3 Leave Calculation
- Working days for leave calculation = All calendar days **excluding Saturdays, Sundays, and company-declared holidays**
- If start day is "From Second Half" → subtract 0.5 from total
- If end day is "Until First Half" → subtract 0.5 from total
- Minimum result is 0.5 days regardless of calculation

### 5.4 Leave Workflow
```
Employee applies → Manager notified → Manager/Admin approves or rejects → Employee notified
```
- Leave status: PENDING → APPROVED / REJECTED / CANCELLED
- Approved leaves **immediately deduct from the employee's leave balance**
- If an approved leave is cancelled → days are **restored** to balance
- Only the leave applicant can cancel their own leave
- Managers and Admins can approve/reject with a comment
- Admin can override the leave type on a PENDING request (e.g. reclassify SL as CL)
- Each employee's leave balance is tracked per leave type per year

---

## 6. Attendance Management

### 6.1 Biometric Integration
The company uses **ZKTeco biometric attendance devices**. The device generates a `.txt` export file. The system must:
- Accept upload of ZKTeco `.txt` attendance files by Admin
- Parse check-in and check-out punches per employee per day
- Map biometric enrollment numbers (EnNo) to employee records manually via an Admin-managed mapping table
- Flag any enrollment numbers in the import file that have no employee mapping (unmapped EnNos)
- Allow Admin to delete an import batch and all associated records

### 6.2 Working Days Policy
> **Important:** At Arjava Advisors, **all calendar days including Saturdays and Sundays are treated as potential working days** for payroll purposes. Only company-declared public holidays are excluded from working day count.

### 6.3 Late Arrival Policy
After importing an attendance file, Admin applies the late policy by setting an arrival time cutoff.

**Standard Rule:**
- Admin configures the standard arrival time (e.g. 10:00 AM) per import batch
- Any employee who checks in after the configured time is marked **Late**

**Extension Date Rule (Special Dates):**
- Admin can designate specific dates within an import batch as "Extension Dates"
- On extension dates, the late cutoff is fixed at **11:00 AM** regardless of the standard time
- Exception: employees who have an approved **First Half** leave on that same date use the **2:30 PM cutoff** instead of 11:00 AM

**First Half Leave Override:**
- Employees with an approved First Half leave on any day get a **2:30 PM cutoff** for that specific day (they are attending the second half)

### 6.4 LWP (Loss of Pay) Deduction from Attendance
- The first **3 late arrivals** per employee per month are treated as warnings — no pay deduction
- From the **4th late arrival onwards**, each instance results in a **0.5 day LWP** deduction
- LWP deductions from attendance feed directly into payroll calculation for that month
- Admin can also manually correct a check-in time if there is a biometric error

### 6.5 Attendance Records
- Admin can view a summary of all employees for a given month (total days present, late count, LWP days, etc.)
- Each employee can view their own attendance records

---

## 7. Payroll Management

### 7.1 Payroll Components
Payroll components define the salary structure. Admin can configure components with the following calculation types:

| Calc Type | Behaviour |
|-----------|-----------|
| **% of CTC** | Component value = Monthly CTC × percentage |
| **Fixed Amount** | Same fixed rupee value for all employees |
| **Manual** | Admin enters a custom value per employee each month |
| **Auto PT** | System auto-computes Professional Tax from West Bengal slabs |

**Default salary structure for Arjava Advisors:**
| Component | Type | Value |
|-----------|------|-------|
| Basic Salary | Earning | 60% of CTC |
| HRA | Earning | 25% of CTC |
| LTA | Earning | 15% of CTC |
| Professional Tax | Deduction | Auto (WB Slab) |

Admin can add, edit, reorder, or delete components. Components can be of type **Earning** or **Deduction**.

### 7.2 LWP (Loss of Pay) Calculation
```
LWP Deduction = Full Monthly Gross × (LWP Days ÷ Total Working Days in Month)
```
- LWP days include both attendance-based late deductions (Section 6.4) and any leave taken beyond entitlement
- This deduction is calculated automatically during payroll run

### 7.3 Professional Tax — West Bengal Slabs
Auto-computed monthly based on the employee's gross pay after LWP deduction:

| Monthly Gross (after LWP) | Professional Tax |
|--------------------------|-----------------|
| Up to ₹10,000 | ₹0 |
| ₹10,001 – ₹15,000 | ₹110 |
| ₹15,001 – ₹25,000 | ₹130 |
| ₹25,001 – ₹40,000 | ₹150 |
| Above ₹40,000 | ₹200 |

### 7.4 Net Pay Formula
```
Full Gross  = Sum of all Earning components (before LWP)
LWP Deduction = Full Gross × (LWP Days ÷ Working Days)
Prorated Gross = Full Gross − LWP Deduction
Professional Tax = PT slab lookup on Prorated Gross
Total Deductions = LWP Deduction + PT + any other deductions

Net Pay = Full Gross − Total Deductions + Approved Reimbursements
```

### 7.5 Payroll Run Workflow
```
Admin creates DRAFT run for a month →
System computes payslips for all active employees →
Admin reviews and adjusts Manual component values →
Admin finalizes (FINALIZED — locked, no further edits) →
Export to .xlsx
```
- Only one payroll run allowed per month
- Once FINALIZED, attendance late policy cannot be re-applied for that month
- DRAFT runs can be deleted; FINALIZED runs cannot

### 7.6 Employee Payslip Access
- All employees can view their own finalized payslips
- Each payslip shows: earnings breakdown, deductions breakdown, LWP days, paid days, gross pay, net pay, reimbursements included

---

## 8. Reimbursements / Claims

### 8.1 Claim Categories
| Category | Description |
|----------|-------------|
| Travel | Travel expenses (fuel, cab, train, flight) |
| Food | Meal expenses during work |
| Internet | Home internet for WFH |
| Miscellaneous | Any other approved business expense |

### 8.2 Claim Workflow
```
Employee submits claim with amount, description, and bill attachment →
Manager/Admin reviews → Approves or Rejects →
Admin marks as Paid (triggers reimbursement in payroll)
```
- Claim status: PENDING → APPROVED → PAID / REJECTED
- Employees can withdraw (delete) their own PENDING claims
- Approved and paid claims are included as a separate line in the employee's payslip for that month
- Bill/receipt upload is supported (image or PDF)

---

## 9. Daily Work Logs

### 9.1 Purpose
Employees submit daily work logs to record what they worked on. This is particularly important for WFH days.

### 9.2 Workflow
- Employees submit one worklog per day (upsert — can update same day's log)
- Worklog status defaults to APPROVED upon submission
- Manager/Admin can reject a worklog with a reason
- Manager/Admin can restore a rejected worklog back to approved
- Employees can delete their own worklogs

### 9.3 WFH Declaration
- Admin can declare specific dates as company-wide Work From Home days
- These declared WFH dates are visible to all employees and managers
- Relevant for attendance context

### 9.4 Views
| Role | Access |
|------|--------|
| Employee | Own worklogs only |
| Manager | Their direct reports' worklogs |
| Admin | All employees' worklogs with search |

---

## 10. Holidays

- Admin manages a company holiday calendar
- Each holiday has: Name, Date, Type (National / Regional)
- Holiday dates are excluded from leave day calculations (Section 5.3)
- All employees can view the holiday calendar

---

## 11. Announcements / Notice Board

- Admin can post company-wide announcements
- Announcements appear on the dashboard for all employees
- Admin can remove/deactivate announcements
- Announcements show title, body text, and posted date

---

## 12. Notifications

The system must have an in-app notification system (bell icon in the top bar):
- Unread count badge on bell icon
- List of latest notifications with timestamp
- Mark individual or all notifications as read
- Notifications must be triggered for the following events:

| Event | Who Gets Notified |
|-------|------------------|
| Employee applies for leave | Their reporting manager |
| Leave approved | The employee |
| Leave rejected | The employee |
| Leave type changed by Admin | The employee |
| Claim approved | The employee |
| Claim rejected | The employee |
| Claim marked as paid | The employee |
| Worklog rejected | The employee |

---

## 13. Dashboard

The dashboard is the landing page after login and must show:

**For all users:**
- Date and greeting
- Company announcements (notice board)
- Quick action shortcuts (Apply Leave, File Claim, etc.)
- My Team section (teammates in same department)

**Stats visible based on role:**
| Stat | Employee | Manager | Admin |
|------|----------|---------|-------|
| Total Employees | — | — | ✓ |
| Pending Leave Approvals | Own pending count | Team pending count | All pending count |
| Employees on Leave Today | — | Team count | All count |
| Pending Claims | Own pending | Team pending | All pending |

---

## 14. Employee Self-Service

Every employee (including managers and admins) must have access to:
- View and edit their own profile
- View their leave balance per type for the current year
- Apply for leaves
- View their own leave history
- Submit expense claims with bill upload
- View their own claims history
- View their own attendance records
- Submit daily work logs
- View their own payslips (finalized only)
- View the holiday calendar
- Receive and read in-app notifications

---

## 15. Data & Storage Requirements

### 15.1 File Storage
- Employee KYC/statutory documents (Aadhar, PAN copy, etc.) — uploaded by employee or Admin
- Expense claim bills — uploaded by employee (image or PDF)
- File size limit: 10 MB per file

### 15.2 Data Retention
- Employee records must be retained even after deactivation (soft delete only)
- All payroll runs and payslips must be retained permanently
- All leave requests and attendance records must be retained permanently

---

## 16. Non-Functional Requirements

| Requirement | Specification |
|-------------|---------------|
| **Users** | 80–100 concurrent employees |
| **Availability** | Business hours priority (09:00–20:00 IST, Mon–Sat) |
| **Mobile Access** | Must be fully usable on mobile browsers (responsive design or PWA) |
| **Security** | All passwords hashed; JWT tokens; HTTPS in production |
| **Data Location** | India preferred (data residency) |
| **Export** | Monthly payroll must be exportable as `.xlsx` |
| **Tech Stack** | Developer's choice — no constraints imposed |

---

## 17. Module Summary

| # | Module | Employee | Manager | Admin |
|---|--------|----------|---------|-------|
| 1 | Authentication | ✓ | ✓ | ✓ |
| 2 | Employee Profiles | Own | View team | Full CRUD |
| 3 | Leave Management | Apply/View own | Approve team | Full control + policy |
| 4 | Attendance | View own | View team | Import, map, late policy |
| 5 | Payroll | View payslips | View payslips | Full run management |
| 6 | Claims / Reimbursements | Submit own | Approve team | Approve + mark paid |
| 7 | Work Logs | Submit own | Review team | View all + WFH declare |
| 8 | Holidays | View | View | Manage |
| 9 | Announcements | View | View | Manage |
| 10 | Notifications | Receive | Receive | Receive + trigger |
| 11 | Dashboard | Self stats | Team stats | Org stats |

---

*This document reflects the complete operational requirements of Arjava Advisors Private Limited's internal HR processes. All policies, slabs, department names, and workflows described are specific to this organisation and must be implemented as specified.*
