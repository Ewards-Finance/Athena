# Athena V2 HRMS — Full Technical Documentation

> Version 3.1.0 | Stack: Node.js + Express + React 18 + PostgreSQL + Prisma

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Repository Structure](#2-repository-structure)
3. [Technology Stack](#3-technology-stack)
4. [Environment Variables](#4-environment-variables)
5. [Database Schema](#5-database-schema)
6. [Backend Architecture](#6-backend-architecture)
   - 6.1 [Entry Point & Middleware](#61-entry-point--middleware)
   - 6.2 [Authentication & RBAC](#62-authentication--rbac)
   - 6.3 [Library Functions](#63-library-functions)
   - 6.4 [All API Endpoints](#64-all-api-endpoints)
   - 6.5 [Scheduled Jobs (Cron)](#65-scheduled-jobs-cron)
7. [Frontend Architecture](#7-frontend-architecture)
   - 7.1 [Entry Point & Routing](#71-entry-point--routing)
   - 7.2 [Auth Store (Zustand)](#72-auth-store-zustand)
   - 7.3 [API Client (Axios)](#73-api-client-axios)
   - 7.4 [Layout & Navigation](#74-layout--navigation)
   - 7.5 [Pages](#75-pages)
   - 7.6 [UI Component Library](#76-ui-component-library)
8. [Business Logic & Workflows](#8-business-logic--workflows)
   - 8.1 [Leave Workflow](#81-leave-workflow)
   - 8.2 [Payroll Workflow](#82-payroll-workflow)
   - 8.3 [Attendance Workflow](#83-attendance-workflow)
   - 8.4 [Exit & Final Settlement Workflow](#84-exit--final-settlement-workflow)
   - 8.5 [Comp-Off Workflow](#85-comp-off-workflow)
   - 8.6 [Travel Leave Proof Workflow](#86-travel-leave-proof-workflow)
   - 8.7 [Loan Workflow](#87-loan-workflow)
9. [Security Model](#9-security-model)
10. [Seed Data](#10-seed-data)
11. [Dev Commands Reference](#11-dev-commands-reference)
12. [Deployment Notes](#12-deployment-notes)

---

## 1. Project Overview

Athena V2 is a full-featured, multi-company HRMS (Human Resource Management System) built as a monorepo with a REST API backend and a React SPA frontend.

**Capabilities:**
- Employee lifecycle management (onboarding → exit)
- Multi-company support with per-employee company assignments
- Leave management with sandwich rule, WFH, comp-off, travel leave
- Attendance tracking (ZKTeco punch-card Excel import)
- Full payroll engine (CTC breakdown, LWP, WFH deductions, PT, TDS new regime)
- Reimbursement claims
- Employee loans with EMI scheduling
- Document vault with expiry alerts
- Asset tracking
- Policy versioning with acknowledgement tracking
- Service desk (helpdesk tickets)
- Delegation of approvals
- Exit management with department clearances & final settlement
- Audit logging for all sensitive operations
- Role-based access control (OWNER / ADMIN / MANAGER / EMPLOYEE)
- In-app + email notifications
- Scheduled database backups to GitHub

---

## 2. Repository Structure

```
Athena2.0/                          ← Monorepo root
├── package.json                    ← Workspaces: ["apps/api", "apps/web"]
├── .env                            ← Root environment variables
├── employee_import_template.xlsx   ← Source data for seed script
├── CLAUDE.md                       ← AI assistant instructions
├── TECHNICAL_DOCS.md               ← This file
│
├── apps/
│   ├── api/                        ← Express backend (Node.js + TypeScript)
│   │   ├── src/
│   │   │   ├── index.ts            ← Server entry, middleware, route registration, cron
│   │   │   ├── routes/             ← 36 route files
│   │   │   ├── middleware/
│   │   │   │   ├── auth.ts         ← JWT auth + RBAC
│   │   │   │   └── upload.ts       ← Multer config for file uploads
│   │   │   └── lib/
│   │   │       ├── payrollEngine.ts ← Tax/payslip calculation
│   │   │       ├── notify.ts       ← In-app + email notification helper
│   │   │       ├── audit.ts        ← Audit log creation helper
│   │   │       ├── backup.ts       ← DB backup to GitHub
│   │   │       ├── delegation.ts   ← Approval delegation helper
│   │   │       ├── email.ts        ← SMTP email dispatch
│   │   │       ├── excelExport.ts  ← Payroll Excel export
│   │   │       ├── fyUtils.ts      ← Fiscal year utilities
│   │   │       ├── letterGenerator.ts ← PDF letter generation
│   │   │       ├── mask.ts         ← Field masking by role
│   │   │       ├── policyEngine.ts ← Policy rule retrieval
│   │   │       └── prisma.ts       ← Singleton PrismaClient
│   │   ├── prisma/
│   │   │   ├── schema.prisma       ← Full DB schema (38 models, 20 enums)
│   │   │   └── seed.ts             ← Seed script
│   │   ├── uploads/
│   │   │   ├── bills/              ← Reimbursement receipts
│   │   │   └── docs/               ← Employee documents
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── web/                        ← React frontend (Vite + TypeScript)
│       ├── src/
│       │   ├── main.tsx            ← ReactDOM root, QueryClient, Toaster
│       │   ├── App.tsx             ← Router, route guards, all routes
│       │   ├── pages/              ← 30 page components
│       │   ├── components/
│       │   │   ├── Layout.tsx      ← Sidebar, topbar, nav
│       │   │   └── ui/             ← Shadcn UI components
│       │   ├── hooks/
│       │   │   └── useAuth.ts      ← Zustand auth store
│       │   └── lib/
│       │       └── api.ts          ← Axios instance
│       ├── package.json
│       ├── vite.config.ts
│       ├── tailwind.config.js
│       └── tsconfig.json
```

**Root `package.json` Scripts:**

| Script | Command |
|--------|---------|
| `dev:api` | `npm run dev --workspace=apps/api` |
| `dev:web` | `npm run dev --workspace=apps/web` |
| `dev` | Both in parallel |
| `seed` | `npm run seed --workspace=apps/api` |
| `db:migrate` | Prisma migrate (api workspace) |
| `db:generate` | Prisma generate (api workspace) |

---

## 3. Technology Stack

### Backend (`apps/api`)

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js |
| Language | TypeScript |
| Framework | Express 4.x |
| ORM | Prisma 5.x |
| Database | PostgreSQL 18 |
| Auth | JWT (jsonwebtoken), bcryptjs |
| File Uploads | Multer |
| Scheduling | node-cron |
| Excel | exceljs |
| Email | Nodemailer (SMTP) |
| PDF | Puppeteer / HTML templates |
| Validation | Zod (in places), manual validation |

### Frontend (`apps/web`)

| Layer | Technology |
|-------|-----------|
| Framework | React 18.2.0 |
| Language | TypeScript |
| Build Tool | Vite 5.x |
| Routing | React Router DOM 6.22.0 |
| Data Fetching | TanStack React Query 5.91.2 |
| HTTP Client | Axios 1.6.7 |
| State Management | Zustand 4.5.0 |
| Styling | Tailwind CSS 3.4.1 |
| Component Library | Shadcn UI (Radix UI primitives) |
| Icons | Lucide React 0.323.0 |
| Toasts | Sonner 1.7.4 |
| Forms | React Hook Form 7.50.1 + Zod 3.22.4 |
| PWA | Vite PWA Plugin (Workbox) |

### TanStack Query Config (`main.tsx`)
```ts
staleTime:           2 minutes
gcTime:              10 minutes
retry:               1
refetchOnWindowFocus: false
```

### Vite Dev Server (`vite.config.ts`)
- Port: `5173`
- Proxy: `/api` → `http://localhost:3001`
- PWA manifest theme: `#361963`
- Path alias: `@` → `src/`

---

## 4. Environment Variables

### Backend (`apps/api/.env`)

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | Full PostgreSQL connection string | — (required) |
| `DIRECT_URL` | Direct DB URL for Prisma (used for migrations) | — |
| `JWT_SECRET` | Secret for signing JWTs | — (required) |
| `JWT_EXPIRES_IN` | Token lifetime | `7d` |
| `PORT` | HTTP server port | `3001` |
| `CORS_ORIGIN` | Comma-separated allowed origins | — |
| `CORS_ORIGINS` | Alternative CORS origins env key | — |
| `SMTP_HOST` | SMTP server hostname | — |
| `SMTP_PORT` | SMTP server port | — |
| `SMTP_USER` | SMTP login user | — |
| `SMTP_PASSWORD` | SMTP login password | — |
| `SMTP_FROM_EMAIL` | "From" address for outgoing mail | — |
| `BACKUP_CRON` | Cron expression for DB backup | `0 2 * * *` |
| `BACKUP_GITHUB_OWNER` | GitHub org/user for backup repo | — |
| `BACKUP_GITHUB_REPO` | GitHub repository name | — |
| `BACKUP_GITHUB_TOKEN` | GitHub personal access token | — |

### Frontend (`apps/web/.env`)

| Variable | Description |
|----------|-------------|
| `VITE_API_BASE_URL` | API base URL (falls back to `/api`) |
| `VITE_API_URL` | Alternative API URL |

---

## 5. Database Schema

**Generator:** `prisma-client-js`  
**Datasource:** PostgreSQL  
**Total Models:** 38  
**Total Enums:** 20  

---

### Enums

```prisma
enum Role                 { OWNER, ADMIN, MANAGER, EMPLOYEE }
enum EmploymentStatus     { PENDING_JOIN, PROBATION, INTERNSHIP, REGULAR_FULL_TIME, NOTICE_PERIOD, INACTIVE }
enum LeaveStatus          { PENDING, APPROVED, REJECTED, CANCELLED }
enum ComponentType        { EARNING, DEDUCTION }
enum CalcType             { PERCENTAGE_OF_CTC, FIXED, MANUAL, AUTO_PT, AUTO_TDS }
enum PayrollStatus        { DRAFT, SUBMITTED, FINALIZED }
enum PayrollRunType       { REGULAR, FULL_AND_FINAL }
enum ClaimStatus          { PENDING, APPROVED, PAID, REJECTED }
enum ClaimCategory        { TRAVEL, FOOD, INTERNET, MISCELLANEOUS }
enum WorklogStatus        { APPROVED, REJECTED }
enum CompOffStatus        { PENDING, APPROVED, REJECTED, EXPIRED, USED }
enum LoanStatus           { PENDING, APPROVED, ACTIVE, CLOSED, REJECTED }
enum AssetStatus          { AVAILABLE, ASSIGNED, UNDER_REPAIR, RETIRED }
enum AssetCategory        { LAPTOP, PHONE, CHARGER, MONITOR, KEYBOARD, MOUSE, SIM_CARD, ACCESS_CARD, ID_CARD, SOFTWARE_LICENSE, OTHER }
enum AssignmentStatus     { ACTIVE, TRANSFERRED, CLOSED }
enum ExitStatus           { INITIATED, NOTICE_PERIOD, CLEARANCE_PENDING, SETTLED, CANCELLED }
enum ClearanceStatus      { PENDING, CLEARED }
enum DocCategory          { OFFER_LETTER, APPOINTMENT_LETTER, EXPERIENCE_LETTER, KYC, CONTRACT, PAYSLIP, OTHER }
enum PolicyScope          { GLOBAL, COMPANY_SPECIFIC }
enum RevisionStatus       { PENDING, APPROVED, REJECTED }
enum ServiceRequestCategory { SALARY_ISSUE, ATTENDANCE_CORRECTION, DOCUMENT_REQUEST, REIMBURSEMENT_ISSUE, LEAVE_CORRECTION, LETTER_REQUEST, IT_SUPPORT, OTHER }
enum ServiceRequestStatus { OPEN, IN_PROGRESS, RESOLVED, CLOSED }
enum ImportStatus         { PREVIEWED, IMPORTED, PARTIALLY_IMPORTED, ROLLED_BACK }
enum ImportType           { ATTENDANCE, EMPLOYEE_BULK, ASSET_BULK }
```

---

### Core Identity Models

#### `User`
| Field | Type | Notes |
|-------|------|-------|
| id | String (cuid) | PK |
| email | String | Unique |
| password | String | Bcrypt hash |
| role | Role | OWNER / ADMIN / MANAGER / EMPLOYEE |
| isActive | Boolean | Default `true` |
| employmentStatus | EmploymentStatus | Default `PENDING_JOIN` |
| adminScope | String? | Scope restriction for limited admins |
| visibilityScope | String? | Department/team visibility scope |
| createdAt | DateTime | |
| updatedAt | DateTime | Auto-updated |

Relations: `profile`, `leaveRequests`, `leaveBalances`, `payslipEntries`, `notifications`, `reimbursements`, `workLogs`, `documents`, `loans`, `compOffs`, `salaryRevisions`, `assets (via AssetAssignment)`, `companyAssignments`

#### `Profile`
| Field | Type | Notes |
|-------|------|-------|
| id | String (cuid) | PK |
| userId | String | Unique FK → User |
| firstName | String | |
| middleName | String? | |
| lastName | String | |
| employeeId | String | Unique (e.g. "EW001") |
| dateOfBirth | DateTime? | |
| gender | String? | |
| bloodGroup | String? | |
| personalEmail | String? | |
| phone | String? | |
| secondaryPhone | String? | |
| emergencyContact | String? | |
| designation | String? | |
| department | String? | |
| dateOfJoining | DateTime? | |
| officeLocation | String? | |
| managerId | String? | FK → User (manager) |
| pan | String? | Format: AAAAA1234A |
| aadharNumber | String? | 12 digits |
| uan | String? | UAN number |
| bankAccountNumber | String? | |
| ifscCode | String? | Format: AAAA0XXXXXX |
| bankName | String? | |
| kycDocumentUrl | String? | |
| appointmentLetterUrl | String? | |
| annualCtc | Float? | Annual CTC in INR |
| employmentType | String? | FULL_TIME / INTERN |
| createdAt | DateTime | |
| updatedAt | DateTime | Auto-updated |

---

### Leave Management Models

#### `LeaveRequest`
| Field | Type | Notes |
|-------|------|-------|
| id | String (cuid) | PK |
| employeeId | String | FK → User |
| managerId | String? | FK → User (approver) |
| appliedById | String? | FK → User (if admin applied on behalf) |
| leaveType | String | SL / CL / EL / MATERNITY / PATERNITY / TEMPORARY_WFH / TRAVELLING / COMP_OFF |
| startDate | DateTime | |
| endDate | DateTime | |
| totalDays | Float | Calculated business days |
| durationType | String | SINGLE / MULTIPLE |
| singleDayType | String? | FULL / FIRST_HALF / SECOND_HALF (for SINGLE) |
| startDayType | String? | FULL / FIRST_HALF / SECOND_HALF (for MULTIPLE start) |
| endDayType | String? | FULL / FIRST_HALF / SECOND_HALF (for MULTIPLE end) |
| reason | String | |
| status | LeaveStatus | PENDING / APPROVED / REJECTED / CANCELLED |
| managerComment | String? | |
| approvedAt | DateTime? | |
| createdAt | DateTime | |
| updatedAt | DateTime | Auto-updated |

#### `LeaveBalance`
| Field | Type | Notes |
|-------|------|-------|
| id | String (cuid) | PK |
| userId | String | FK → User |
| year | Int | Fiscal year (e.g. 2025) |
| leaveType | String | Matches LeaveRequest.leaveType |
| total | Float | Allocated days |
| used | Float | Default 0 |

Unique: `[userId, year, leaveType]`

#### `LeavePolicy`
| Field | Type | Notes |
|-------|------|-------|
| id | String (cuid) | PK |
| leaveType | String | Unique |
| label | String | Display name |
| defaultTotal | Float | Default days allocated |
| isActive | Boolean | |
| isUnlimited | Boolean | For types with no cap |
| documentRequired | Boolean | |
| documentAfterDays | Int? | Require doc after N days |
| carryForwardEnabled | Boolean | |
| carryForwardMaxDays | Int? | Max days to carry forward |
| encashable | Boolean | |
| allowedFor | String | ALL / FULL_TIME / INTERN |
| createdAt | DateTime | |
| updatedAt | DateTime | Auto-updated |

#### `Holiday`
| Field | Type | Notes |
|-------|------|-------|
| id | String (cuid) | PK |
| name | String | |
| date | DateTime | |
| type | String | |
| createdAt | DateTime | |

#### `DeclaredWFH`
| Field | Type | Notes |
|-------|------|-------|
| id | String (cuid) | PK |
| date | DateTime | Unique |
| reason | String | |
| createdBy | String | FK → User |
| createdAt | DateTime | |

#### `TravelProof`
| Field | Type | Notes |
|-------|------|-------|
| id | String (cuid) | PK |
| leaveRequestId | String | FK → LeaveRequest |
| userId | String | FK → User |
| proofDate | DateTime | |
| geoLat | Float? | GPS latitude |
| geoLng | Float? | GPS longitude |
| mapsLink | String? | Google Maps URL |
| submittedAt | DateTime | |

Unique: `[leaveRequestId, proofDate]`

---

### Attendance Models

#### `AttendanceRecord`
| Field | Type | Notes |
|-------|------|-------|
| id | String (cuid) | PK |
| userId | String | FK → User |
| importId | String? | FK → AttendanceImport |
| date | DateTime | |
| checkIn | DateTime? | |
| checkOut | DateTime? | |
| hoursWorked | Float? | |
| checkInManual | Boolean | Default `false` |
| isLate | Boolean | Default `false` |
| lwpDeduction | Float | Default 0 |

Unique: `[userId, date]`

#### `AttendanceImport`
| Field | Type | Notes |
|-------|------|-------|
| id | String (cuid) | PK |
| month | Int | |
| year | Int | |
| fileName | String | |
| importedBy | String | FK → User |
| recordCount | Int | |
| unmappedEnNos | Json? | ENs that had no mapping |
| arrivalTime | String? | Expected arrival override |
| extensionDates | Json? | Dates with extended clock-in window |

Unique: `[month, year]`

#### `AttendanceAdjustment`
| Field | Type | Notes |
|-------|------|-------|
| id | String (cuid) | PK |
| userId | String | FK → User |
| month | Int | |
| year | Int | |
| adjustmentDays | Float | |
| reason | String | |
| createdBy | String | FK → User |

Unique: `[userId, month, year]`

#### `AbsenceRecord`
| Field | Type | Notes |
|-------|------|-------|
| id | String (cuid) | PK |
| userId | String | FK → User |
| date | DateTime | |
| markedBy | String | FK → User |

Unique: `[userId, date]`

#### `WorkLog`
| Field | Type | Notes |
|-------|------|-------|
| id | String (cuid) | PK |
| userId | String | FK → User |
| date | DateTime | |
| content | String | Daily work description |
| status | WorklogStatus | Default APPROVED |
| rejectedBy | String? | FK → User |
| rejectedAt | DateTime? | |
| rejectionNote | String? | |

Unique: `[userId, date]`

#### `PunchMapping`
| Field | Type | Notes |
|-------|------|-------|
| id | String (cuid) | PK |
| enNo | String | Unique — ZKTeco enrollment number |
| userId | String | Unique FK → User |
| label | String? | |
| createdAt | DateTime | |
| updatedAt | DateTime | Auto-updated |

---

### Payroll Models

#### `PayrollComponent`
| Field | Type | Notes |
|-------|------|-------|
| id | String (cuid) | PK |
| name | String | Unique |
| type | ComponentType | EARNING / DEDUCTION |
| calcType | CalcType | PERCENTAGE_OF_CTC / FIXED / MANUAL / AUTO_PT / AUTO_TDS |
| value | Float | Default 0 (% or fixed amount) |
| isActive | Boolean | |
| order | Int | Display/calculation order |
| createdAt | DateTime | |
| updatedAt | DateTime | Auto-updated |

#### `PayrollRun`
| Field | Type | Notes |
|-------|------|-------|
| id | String (cuid) | PK |
| month | Int | 1–12 |
| year | Int | |
| status | PayrollStatus | DRAFT / SUBMITTED / FINALIZED |
| processedBy | String | FK → User |
| companyId | String? | FK → Company (null = all) |
| policyVersionId | String? | FK → PolicyVersion |
| runType | PayrollRunType | REGULAR / FULL_AND_FINAL |

Unique: `[month, year, companyId, runType]`

#### `PayslipEntry`
| Field | Type | Notes |
|-------|------|-------|
| id | String (cuid) | PK |
| payrollRunId | String | FK → PayrollRun |
| userId | String | FK → User |
| monthlyCtc | Float | |
| workingDays | Int | Total working days that month |
| lwpDays | Float | Default 0 |
| paidDays | Float | workingDays − lwpDays |
| earnings | Json | `{componentName: amount, ...}` |
| deductions | Json | `{componentName: amount, ...}` |
| reimbursements | Float | Default 0 |
| grossPay | Float | Sum of earnings |
| totalDeductions | Float | Sum of deductions |
| netPay | Float | grossPay − totalDeductions + reimbursements |
| companyLegalName | String? | Snapshot at time of run |
| companyAddress | String? | Snapshot |
| companyPan | String? | Snapshot |
| employeeCode | String? | Snapshot |
| designationSnapshot | String? | Snapshot |
| arrearsAmount | Float? | |
| arrearsNote | String? | |

Unique: `[payrollRunId, userId]`

#### `SalaryRevision`
| Field | Type | Notes |
|-------|------|-------|
| id | String (cuid) | PK |
| userId | String | FK → User |
| effectiveDate | DateTime | |
| oldCtc | Float | |
| newCtc | Float | |
| reason | String? | |
| proposedBy | String? | FK → User |
| revisedBy | String? | FK → User |
| approvedBy | String? | FK → User |
| status | RevisionStatus | PENDING / APPROVED / REJECTED |
| createdAt | DateTime | |
| updatedAt | DateTime | Auto-updated |

---

### Benefits & Requests Models

#### `Reimbursement` (Claims)
| Field | Type | Notes |
|-------|------|-------|
| id | String (cuid) | PK |
| employeeId | String | FK → User |
| category | ClaimCategory | TRAVEL / FOOD / INTERNET / MISCELLANEOUS |
| amount | Float | |
| description | String | |
| billUrl | String? | Upload path |
| status | ClaimStatus | PENDING / APPROVED / PAID / REJECTED |
| paidAt | DateTime? | |
| paidNote | String? | |
| createdAt | DateTime | |
| updatedAt | DateTime | Auto-updated |

#### `LoanRequest`
| Field | Type | Notes |
|-------|------|-------|
| id | String (cuid) | PK |
| userId | String | FK → User |
| amount | Float | Principal |
| installments | Int | Number of EMIs |
| monthlyEMI | Float | |
| interestRate | Float | Default 9.0% |
| reason | String? | |
| status | LoanStatus | PENDING / APPROVED / ACTIVE / CLOSED / REJECTED |
| approvedBy | String? | FK → User |
| approvedAt | DateTime? | |
| startMonth | Int? | Deduction start month |
| startYear | Int? | Deduction start year |
| paidInstallments | Int | Default 0 |
| createdAt | DateTime | |
| updatedAt | DateTime | Auto-updated |

#### `CompOff`
| Field | Type | Notes |
|-------|------|-------|
| id | String (cuid) | PK |
| userId | String | FK → User |
| earnedDate | DateTime | Day worked (weekend/holiday) |
| reason | String? | |
| status | CompOffStatus | PENDING / APPROVED / REJECTED / EXPIRED / USED |
| approvedBy | String? | FK → User |
| usedOn | DateTime? | Date comp-off was applied |
| expiresAt | DateTime? | earnedDate + 90 days |

Unique: `[userId, earnedDate]`

---

### Company & Assignment Models

#### `Company`
| Field | Type | Notes |
|-------|------|-------|
| id | String (cuid) | PK |
| code | String | Unique short code |
| legalName | String | |
| displayName | String | |
| payrollPrefix | String? | Prefix for payslip numbering |
| pan | String? | |
| tan | String? | |
| gstin | String? | |
| addressLine1 | String? | |
| addressLine2 | String? | |
| city | String? | |
| state | String? | |
| pincode | String? | |
| logoUrl | String? | |
| isActive | Boolean | Default `true` |
| createdAt | DateTime | |
| updatedAt | DateTime | Auto-updated |

#### `EmployeeCompanyAssignment`
| Field | Type | Notes |
|-------|------|-------|
| id | String (cuid) | PK |
| userId | String | FK → User |
| companyId | String | FK → Company |
| employeeCode | String? | Per-company employee code |
| designation | String? | |
| department | String? | |
| reportingManagerId | String? | FK → User |
| annualCTC | Float? | |
| employmentType | String? | |
| joiningDate | DateTime? | |
| effectiveFrom | DateTime? | |
| effectiveTo | DateTime? | |
| isPrimary | Boolean | Default `true` |
| status | AssignmentStatus | ACTIVE / TRANSFERRED / CLOSED |
| notes | String? | |
| createdAt | DateTime | |
| updatedAt | DateTime | Auto-updated |

Indices: `[companyId]`, `[userId, status]`

---

### Exit Management Models

#### `ExitRequest`
| Field | Type | Notes |
|-------|------|-------|
| id | String (cuid) | PK |
| userId | String | Unique FK → User |
| initiatedBy | String | FK → User (admin who initiated) |
| reason | String? | |
| lastWorkingDate | DateTime | |
| noticePeriodDays | Int | |
| buyoutDays | Int? | Notice buyout days |
| buyoutAmount | Float? | |
| status | ExitStatus | INITIATED / NOTICE_PERIOD / CLEARANCE_PENDING / SETTLED / CANCELLED |
| createdAt | DateTime | |
| updatedAt | DateTime | Auto-updated |

#### `ExitClearance`
| Field | Type | Notes |
|-------|------|-------|
| id | String (cuid) | PK |
| exitRequestId | String | FK → ExitRequest |
| department | String | Department name |
| clearedBy | String? | FK → User |
| status | ClearanceStatus | PENDING / CLEARED |
| remarks | String? | |
| clearedAt | DateTime? | |
| createdAt | DateTime | |

#### `FinalSettlement`
| Field | Type | Notes |
|-------|------|-------|
| id | String (cuid) | PK |
| exitRequestId | String | Unique FK → ExitRequest |
| lastMonthSalaryProrated | Float | |
| leaveEncashmentDays | Float | |
| leaveEncashmentAmount | Float | |
| pendingClaimsAmount | Float | |
| arrearsPending | Float | |
| bonusPending | Float | |
| noticePeriodRecovery | Float | Deduction if notice not served |
| loanOutstanding | Float | |
| otherDeductions | Float | |
| totalPayable | Float | Total after all adjustments |
| processedBy | String | FK → User |
| processedAt | DateTime | |
| createdAt | DateTime | |

---

### Policy Models

#### `PolicyVersion`
| Field | Type | Notes |
|-------|------|-------|
| id | String (cuid) | PK |
| name | String | |
| versionCode | String | Unique (e.g. "v1") |
| effectiveFrom | DateTime | |
| effectiveTo | DateTime? | |
| isActive | Boolean | |
| scope | PolicyScope | GLOBAL / COMPANY_SPECIFIC |
| companyId | String? | FK → Company |
| notes | String? | |
| publishedBy | String? | FK → User |
| publishedAt | DateTime? | |
| createdAt | DateTime | |

#### `PolicyRule`
| Field | Type | Notes |
|-------|------|-------|
| id | String (cuid) | PK |
| policyVersionId | String | FK → PolicyVersion |
| ruleKey | String | Unique per version |
| ruleValue | String | String-encoded value |
| valueType | String | "number" / "boolean" / "string" |
| description | String? | |

Unique: `[policyVersionId, ruleKey]`

#### `PolicyAcknowledgement`
| Field | Type | Notes |
|-------|------|-------|
| id | String (cuid) | PK |
| policyVersionId | String | FK → PolicyVersion |
| userId | String | FK → User |
| acknowledgedAt | DateTime? | |
| isAcknowledged | Boolean | Default `false` |
| createdAt | DateTime | |

Unique: `[policyVersionId, userId]`

---

### Documents & Assets Models

#### `EmployeeDocument`
| Field | Type | Notes |
|-------|------|-------|
| id | String (cuid) | PK |
| userId | String | FK → User |
| category | DocCategory | OFFER_LETTER / APPOINTMENT_LETTER / EXPERIENCE_LETTER / KYC / CONTRACT / PAYSLIP / OTHER |
| name | String | |
| fileUrl | String | Upload path |
| description | String? | |
| uploadedBy | String | FK → User |
| expiryDate | DateTime? | |
| isRequired | Boolean | |
| reminderSentAt | DateTime? | |
| createdAt | DateTime | |

#### `Asset`
| Field | Type | Notes |
|-------|------|-------|
| id | String (cuid) | PK |
| name | String | |
| assetTag | String | Unique |
| category | AssetCategory | |
| serialNumber | String? | |
| purchaseDate | DateTime? | |
| purchaseCost | Float? | |
| status | AssetStatus | AVAILABLE / ASSIGNED / UNDER_REPAIR / RETIRED |
| notes | String? | |
| createdAt | DateTime | |
| updatedAt | DateTime | Auto-updated |

#### `AssetAssignment`
| Field | Type | Notes |
|-------|------|-------|
| id | String (cuid) | PK |
| assetId | String | FK → Asset |
| userId | String | FK → User |
| assignedAt | DateTime | |
| returnedAt | DateTime? | |
| conditionOut | String? | Condition when assigned |
| conditionIn | String? | Condition when returned |
| notes | String? | |
| assignedBy | String | FK → User |

Indices: `[assetId]`, `[userId]`

---

### Miscellaneous Models

#### `Notification`
| Field | Type | Notes |
|-------|------|-------|
| id | String (cuid) | PK |
| userId | String | FK → User |
| type | String | e.g. LEAVE_APPROVED, COMPOFF_EXPIRED |
| title | String | |
| message | String | |
| isRead | Boolean | Default `false` |
| link | String? | Frontend route |
| createdAt | DateTime | |

#### `Announcement`
| Field | Type | Notes |
|-------|------|-------|
| id | String (cuid) | PK |
| title | String | |
| body | String | |
| createdBy | String | FK → User |
| isActive | Boolean | Default `true` |
| createdAt | DateTime | |
| updatedAt | DateTime | Auto-updated |

#### `ServiceRequest`
| Field | Type | Notes |
|-------|------|-------|
| id | String (cuid) | PK |
| userId | String | FK → User |
| category | ServiceRequestCategory | |
| subject | String | |
| description | String | |
| status | ServiceRequestStatus | OPEN / IN_PROGRESS / RESOLVED / CLOSED |
| assignedTo | String? | FK → User |
| resolvedAt | DateTime? | |
| resolution | String? | |
| createdAt | DateTime | |
| updatedAt | DateTime | Auto-updated |

#### `AuditLog`
| Field | Type | Notes |
|-------|------|-------|
| id | String (cuid) | PK |
| actorId | String | FK → User |
| action | String | e.g. CREATE, UPDATE, DELETE, APPROVE |
| entity | String | Model name |
| entityId | String | Record ID |
| subjectEntity | String? | Related entity |
| subjectId | String? | Related ID |
| subjectLabel | String? | Human label |
| subjectMeta | Json? | Extra context |
| oldValues | Json? | Before-state |
| newValues | Json? | After-state |
| reason | String? | |
| changeSource | String? | API / SYSTEM / IMPORT |
| createdAt | DateTime | |

#### `ApiKey`
| Field | Type | Notes |
|-------|------|-------|
| id | String (cuid) | PK |
| name | String | |
| keyHash | String | Unique — bcrypt hash of actual key |
| prefix | String | Unique — first 8 chars shown to user |
| createdBy | String | FK → User |
| isActive | Boolean | |
| scopes | Json | Array of allowed scopes |
| expiresAt | DateTime? | |
| lastUsedAt | DateTime? | |
| createdAt | DateTime | |

#### `BackupLog`
| Field | Type | Notes |
|-------|------|-------|
| id | String (cuid) | PK |
| triggeredBy | String | FK → User or "SYSTEM" |
| status | String | SUCCESS / FAILED |
| fileName | String? | |
| commitSha | String? | GitHub commit SHA |
| fileSizeKb | Float? | |
| error | String? | |
| createdAt | DateTime | |

#### `SystemSetting`
| Field | Type | Notes |
|-------|------|-------|
| id | String (cuid) | PK |
| key | String | Unique |
| value | String | |
| updatedBy | String | FK → User |
| updatedAt | DateTime | Auto-updated |

#### `ImportBatch`
| Field | Type | Notes |
|-------|------|-------|
| id | String (cuid) | PK |
| type | ImportType | ATTENDANCE / EMPLOYEE_BULK / ASSET_BULK |
| uploadedBy | String | FK → User |
| fileName | String | |
| totalRows | Int | |
| successRows | Int | |
| failedRows | Int | |
| status | ImportStatus | PREVIEWED / IMPORTED / PARTIALLY_IMPORTED / ROLLED_BACK |
| errorLog | Json? | Per-row errors |
| notes | String? | |
| createdAt | DateTime | |

#### `DelegateApprover`
| Field | Type | Notes |
|-------|------|-------|
| id | String (cuid) | PK |
| delegatorId | String | FK → User (manager delegating) |
| delegateId | String | FK → User (receiving delegation) |
| fromDate | DateTime | |
| toDate | DateTime | |
| isActive | Boolean | Default `true` |
| createdAt | DateTime | |

---

## 6. Backend Architecture

### 6.1 Entry Point & Middleware

**File:** `apps/api/src/index.ts`

**Startup sequence:**
1. Load environment variables
2. Create Express app
3. Configure CORS (allows: `localhost`, `192.168.x.x/*`, explicit `CORS_ORIGIN` env)
4. Mount `express.json()` and `express.urlencoded()` body parsers
5. Serve `/uploads` as static directory
6. Register all 36 route files under `/api/*`
7. Register `GET /api/health` endpoint
8. Register global error handler
9. Schedule all cron jobs
10. Start HTTP listener on `PORT` (default 3001)

**Health Check:**
```
GET /api/health
→ 200 { status: 'ok', version: '3.1.0', service: 'Athena HRMS API' }
```

**File Upload Middleware** (`src/middleware/upload.ts`):
- Engine: Multer disk storage
- Storage paths: `/uploads/bills/`, `/uploads/docs/`
- Allowed MIME types: `image/jpeg`, `image/png`, `image/gif`, `image/webp`, `application/pdf`
- Max file size: **5 MB**
- Random filename generation (no original name preserved)
- Exports: `billUpload` (for claims), `docUpload` (for documents)

---

### 6.2 Authentication & RBAC

**File:** `apps/api/src/middleware/auth.ts`

#### `AuthRequest` Interface
```typescript
interface AuthRequest extends Request {
  user?: {
    id:    string;
    email: string;
    role:  'OWNER' | 'ADMIN' | 'MANAGER' | 'EMPLOYEE';
  }
}
```

#### `authenticate` Middleware
- Reads `Authorization: Bearer <token>` header
- Verifies JWT with `JWT_SECRET`
- Attaches decoded payload to `req.user`
- Returns `401` if missing or invalid

#### `authorize(roles: Role[])` Middleware
- Checks `req.user.role` is in the allowed roles array
- **OWNER bypasses all authorization checks** — always passes
- Returns `403` if role not allowed

#### Role Hierarchy (effective permissions)
```
OWNER   → Full access, bypasses all authorize() gates
ADMIN   → Most management operations, except OWNER-only
MANAGER → Team-scoped views, leave/claim approval
EMPLOYEE → Own data only
```

#### Token Lifecycle
- Signed with HS256 (default jsonwebtoken)
- Expires per `JWT_EXPIRES_IN` (default `7d`)
- Stored on frontend in `localStorage` as key `athena_token`
- Frontend auto-clears on `401` response (Axios interceptor)

---

### 6.3 Library Functions

#### Payroll Engine (`src/lib/payrollEngine.ts`)

**`calculatePT(monthlyGross: number): number`**  
West Bengal Professional Tax slabs:
| Monthly Gross | PT Amount |
|--------------|-----------|
| ≤ ₹10,000 | ₹0 |
| ≤ ₹15,000 | ₹110 |
| ≤ ₹25,000 | ₹130 |
| ≤ ₹40,000 | ₹150 |
| > ₹40,000 | ₹200 |

**`countWorkingDays(year, month, holidays[]): number`**  
- Counts all days in the month
- Excludes dates present in the `holidays[]` array
- Note: Saturdays and Sundays are **not** excluded — company policy treats them as working days

**`calculateTDS(annualCtc, standardDeduction = 75000, rebateLimit = 1200000): number`**  
New tax regime FY 2025-26:
- Standard deduction: ₹75,000
- Section 87A: Full rebate if taxable income ≤ ₹12,00,000
- Tax Slabs:

| Income Range | Rate |
|-------------|------|
| ₹0 – ₹4,00,000 | 0% |
| ₹4,00,001 – ₹8,00,000 | 5% |
| ₹8,00,001 – ₹12,00,000 | 10% |
| ₹12,00,001 – ₹16,00,000 | 15% |
| ₹16,00,001 – ₹20,00,000 | 20% |
| ₹20,00,001 – ₹24,00,000 | 25% |
| > ₹24,00,000 | 30% |

- Health & Education Cess: **4%** on tax
- Returns: `annualTax / 12` (monthly TDS)

**`computePayslipEntry(params): PayslipResult`**  
Main computation function:

Input params:
```typescript
{
  monthlyCtc:          number;
  annualCtc?:          number;          // defaults to monthlyCtc * 12
  workingDays:         number;
  lwpDays:             number;
  wfhDays?:            number;          // defaults to 0
  components:          ComponentSnapshot[];
  reimbursements:      number;
  wfhDeductionRate?:   number;          // defaults to 0.30 (30%)
  tdsStandardDeduction?: number;        // defaults to 75000
  tdsRebateLimit?:     number;          // defaults to 1200000
  existingEarnings?:   Record<string, number>;
  existingDeductions?: Record<string, number>;
}
```

Calculation steps:
1. For each EARNING component: apply `calcType`
   - `PERCENTAGE_OF_CTC`: `(value / 100) * monthlyCtc`
   - `FIXED`: `value`
   - `MANUAL`: uses `existingEarnings[name]` if provided
2. Compute `grossPay` = sum of all earnings
3. Compute prorated gross after LWP: `grossPay × (1 − lwpDays / workingDays)`
4. Compute WFH deduction: `grossPay × (wfhDays / workingDays) × wfhDeductionRate`
5. Compute LWP deduction: `grossPay − proratedGross`
6. For each DEDUCTION component:
   - `AUTO_PT`: calls `calculatePT(proratedGross)`
   - `AUTO_TDS`: calls `calculateTDS(annualCtc)`
   - `FIXED`: `value`
   - `MANUAL`: uses `existingDeductions[name]` if provided
7. `netPay` = `proratedGross − totalDeductions + reimbursements`

---

#### Notifications (`src/lib/notify.ts`)

```typescript
interface NotificationPayload {
  userId:  string;
  type:    string;   // e.g. 'LEAVE_APPROVED', 'COMPOFF_EXPIRED'
  title:   string;
  message: string;
  link?:   string;   // Frontend route e.g. '/leaves'
}

createNotification(payload: NotificationPayload): Promise<void>
createNotifications(payloads: NotificationPayload[]): Promise<void>
```

- Creates a `Notification` record in DB (always)
- Sends an email via `email.ts` → `sendNotificationEmail()` (only if SMTP configured)
- **OWNER accounts receive in-app notifications only — no email sent**

---

#### Other Library Modules

| Module | Function | Purpose |
|--------|----------|---------|
| `audit.ts` | `createAuditLog(params)` | Records actor, action, entity, before/after values |
| `backup.ts` | `runBackup()` | Exports DB and pushes to GitHub repo |
| `delegation.ts` | `isDelegateForEmployee(managerId, employeeId, date)` | Checks if approvals are delegated |
| `email.ts` | `sendNotificationEmail(to, subject, body)` | Nodemailer SMTP dispatch |
| `excelExport.ts` | `generatePayrollExcel(run, entries)` | Returns .xlsx buffer for payroll export |
| `fyUtils.ts` | `currentFYYear()` | Returns current fiscal year start year |
| `letterGenerator.ts` | `generateExperienceLetter(userId)` `generateExitLetter(exitId)` | PDF generation via HTML template |
| `mask.ts` | `maskSensitiveFields(profile, viewerRole)` | Redacts PAN, Aadhar, bank details for non-admin roles |
| `policyEngine.ts` | `getPolicyRules(policyVersionId?)` | Returns `Record<string, string>` of all rules |
| `prisma.ts` | Singleton `PrismaClient` | Shared Prisma instance across the app |

---

### 6.4 All API Endpoints

**Base URL:** `/api`  
**All routes require `authenticate` middleware unless noted.**

---

#### Auth (`/api/auth`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/auth/login` | Public | Login with email + password; returns JWT |
| GET | `/auth/me` | Any | Get own user + profile |
| POST | `/auth/reset-password/:userId` | ADMIN | Reset employee password to temp value |
| POST | `/auth/change-password` | Any | Change own password (requires current password) |

**Login request:** `{ email: string, password: string }`  
**Login response:** `{ token: string, user: { id, email, role, firstName, lastName, employeeId, department, employmentType } }`

---

#### Employees (`/api/employees`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/employees` | ADMIN, MANAGER | List all active employees with profiles and company assignments |
| GET | `/employees/:id` | Any | Get single employee; statutory fields masked for non-ADMIN |
| POST | `/employees` | ADMIN | Create new employee (User + Profile) |
| PUT | `/employees/:id` | Self or ADMIN | Update employee profile |
| DELETE | `/employees/:id` | ADMIN | Deactivate employee (soft delete) |
| POST | `/employees/bulk-import` | ADMIN | Preview employee Excel import |
| POST | `/employees/bulk-import/confirm` | ADMIN | Confirm and execute bulk import |
| DELETE | `/employees/bulk-import/:batchId/rollback` | ADMIN | Rollback import batch |

**Create employee validates:**
- Required: email, password, firstName, lastName
- PAN regex: `/^[A-Z]{5}[0-9]{4}[A-Z]$/`
- IFSC regex: `/^[A-Z]{4}0[A-Z0-9]{6}$/`
- Aadhar: exactly 12 digits
- Duplicate email check

---

#### Leaves (`/api/leaves`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/leaves` | Any | List leaves (own for EMPLOYEE, all for ADMIN/MANAGER) |
| POST | `/leaves` | Any | Apply for leave |
| GET | `/leaves/pending` | MANAGER, ADMIN | List pending leaves awaiting approval |
| PATCH | `/leaves/:id/approve` | MANAGER, ADMIN | Approve leave |
| PATCH | `/leaves/:id/reject` | MANAGER, ADMIN | Reject leave |
| DELETE | `/leaves/:id` | Any (own only) | Cancel a PENDING leave |
| GET | `/leaves/balance` | Any | Get own leave balance |

**Apply leave request body:**
```json
{
  "leaveType": "SL | CL | EL | MATERNITY | PATERNITY | TEMPORARY_WFH | TRAVELLING | COMP_OFF",
  "startDate": "YYYY-MM-DD",
  "endDate": "YYYY-MM-DD",
  "durationType": "SINGLE | MULTIPLE",
  "singleDayType": "FULL | FIRST_HALF | SECOND_HALF",
  "startDayType": "FULL | FIRST_HALF | SECOND_HALF",
  "endDayType": "FULL | FIRST_HALF | SECOND_HALF",
  "reason": "string",
  "employeeId": "string (admin can specify different user)"
}
```

---

#### Payroll (`/api/payroll`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/payroll/components` | ADMIN | List all payroll components |
| POST | `/payroll/components` | ADMIN | Create component |
| PUT | `/payroll/components/:id` | ADMIN | Update component |
| DELETE | `/payroll/components/:id` | ADMIN | Delete component (AUTO_PT protected) |
| PATCH | `/payroll/components/reorder` | ADMIN | Reorder components |
| GET | `/payroll/employees-ctc` | ADMIN | List all employees with CTC |
| PUT | `/payroll/employees-ctc/:userId` | ADMIN | Set employee's annual CTC |
| GET | `/payroll/runs` | ADMIN | List all payroll runs |
| POST | `/payroll/runs` | ADMIN | Create new DRAFT run |
| GET | `/payroll/runs/:id` | ADMIN | Get run + all payslip entries |
| PATCH | `/payroll/runs/:id/entries/:entryId` | ADMIN | Edit MANUAL values in DRAFT run |
| POST | `/payroll/runs/:id/submit` | ADMIN | Submit DRAFT → SUBMITTED |
| POST | `/payroll/runs/:id/finalize` | OWNER | Finalize SUBMITTED → FINALIZED |
| POST | `/payroll/runs/:id/reopen` | OWNER | Reopen FINALIZED → DRAFT |
| DELETE | `/payroll/runs/:id` | ADMIN | Delete DRAFT run |
| GET | `/payroll/runs/:id/export` | ADMIN | Export run as .xlsx |
| GET | `/payroll/my-payslips` | Any | List own finalized payslips |

---

#### Attendance (`/api/attendance`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/attendance` | Any | List attendance (scoped by role) |
| GET | `/attendance/:userId/range` | ADMIN, MANAGER | Get attendance for date range |
| POST | `/attendance/manual-entry` | ADMIN | Manually mark attendance |
| PATCH | `/attendance/:id` | ADMIN | Update attendance record |
| POST | `/attendance/import-preview` | ADMIN | Upload Excel → preview |
| POST | `/attendance/import-confirm` | ADMIN | Confirm import |
| POST | `/attendance/import-preview/:id/rollback` | ADMIN | Rollback import |
| POST | `/attendance/adjustments` | Any | Request attendance adjustment |
| GET | `/attendance/adjustments` | ADMIN | List adjustments |

---

#### Claims / Reimbursements (`/api/claims`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/claims` | Any | List claims (scoped by role) |
| POST | `/claims` | Any | Submit reimbursement claim |
| PATCH | `/claims/:id/approve` | MANAGER, ADMIN | Approve claim |
| PATCH | `/claims/:id/pay` | ADMIN | Mark claim as paid |
| PATCH | `/claims/:id/reject` | MANAGER, ADMIN | Reject claim |
| DELETE | `/claims/:id` | Any (PENDING only) | Delete own claim |

---

#### Loans (`/api/loans`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/loans` | Any | List loans (scoped by role) |
| POST | `/loans` | Any | Apply for a loan |
| PATCH | `/loans/:id/approve` | ADMIN | Approve loan, set EMI start month |
| PATCH | `/loans/:id/close` | ADMIN | Mark loan as CLOSED |
| GET | `/loans/schedule` | Any | Get EMI payment schedule |

---

#### Comp-Off (`/api/compoff`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/compoff` | Any | List comp-offs (scoped by role) |
| POST | `/compoff` | Any | Request comp-off for a worked day |
| PATCH | `/compoff/:id/approve` | MANAGER, ADMIN | Approve comp-off, set expiry |
| PATCH | `/compoff/:id/reject` | MANAGER, ADMIN | Reject comp-off |
| POST | `/compoff/:id/use` | Any | Mark comp-off as used on a date |
| GET | `/compoff/expired` | System | Returns expired comp-offs (used by cron) |

---

#### Travel Proof (`/api/travel-proof`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/travel-proof` | ADMIN, MANAGER | List travel proofs |
| POST | `/travel-proof` | Any | Submit geo-location proof for a travel leave day |
| GET | `/travel-proof/:leaveId` | Any | Get all proofs for a leave |
| DELETE | `/travel-proof/:id` | Any (own) | Delete proof |

---

#### Holidays (`/api/holidays`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/holidays` | Any | List all holidays |
| POST | `/holidays` | ADMIN | Add holiday |
| DELETE | `/holidays/:id` | ADMIN | Remove holiday |

---

#### Leave Balance (`/api/leave-balance`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/leave-balance/user/:userId` | Any | Get balance by user/FY/leave type |
| POST | `/leave-balance/reset` | ADMIN | Reset balance for user |
| PATCH | `/leave-balance/:balanceId` | ADMIN | Adjust specific balance |

---

#### Leave Policy (`/api/leave-policy`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/leave-policy` | Any | List all leave policies |
| POST | `/leave-policy` | ADMIN | Create leave policy |
| PUT | `/leave-policy/:id` | ADMIN | Update policy |
| DELETE | `/leave-policy/:id` | ADMIN | Delete policy (prevented if balances exist) |

---

#### Exit Management (`/api/exit`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/exit` | ADMIN, OWNER | List all exit requests |
| POST | `/exit` | ADMIN | Initiate exit for an employee |
| GET | `/exit/:id` | ADMIN | Get exit + clearances + settlement |
| PATCH | `/exit/:id/clearance/:clearanceId/approve` | Any | Mark department clearance as CLEARED |
| POST | `/exit/:id/settlement` | ADMIN | Generate final settlement |
| POST | `/exit/:id/cancel` | ADMIN | Cancel exit request |

---

#### Dashboard (`/api/dashboard`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/dashboard/stats` | Any | Stat cards (counts by role scope) |
| GET | `/dashboard/team` | Any | Own department's team members |

---

#### Companies (`/api/companies`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/companies` | ADMIN, OWNER | List all companies |
| POST | `/companies` | ADMIN, OWNER | Create company |
| PUT | `/companies/:id` | ADMIN, OWNER | Update company |
| DELETE | `/companies/:id` | ADMIN, OWNER | Deactivate company |

---

#### Assignments (`/api/assignments`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/assignments` | ADMIN | List all assignments |
| GET | `/assignments/:userId` | ADMIN | Get assignments for user |
| POST | `/assignments` | ADMIN | Create assignment |
| PATCH | `/assignments/:id` | ADMIN | Update assignment |
| POST | `/assignments/:id/transfer` | ADMIN | Transfer employee to another company |

---

#### Policies (`/api/policies`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/policies` | OWNER | List all policy versions |
| POST | `/policies` | OWNER | Create new policy version |
| GET | `/policies/:id` | Any | Get policy + rules + acknowledgements |
| PATCH | `/policies/:id/rules` | OWNER | Update policy rules |
| POST | `/policies/:id/publish` | OWNER | Publish policy, send acknowledgement tasks |
| POST | `/policies/acknowledge/:policyVersionId` | Any | Employee acknowledges policy |

---

#### Worklogs (`/api/worklogs`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/worklogs` | Any | List work logs (scoped by role) |
| POST | `/worklogs` | Any | Submit daily work log |
| PATCH | `/worklogs/:id` | MANAGER, ADMIN | Approve or reject a work log |

---

#### Documents (`/api/documents`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/documents` | Any | List documents (scoped by role) |
| POST | `/documents` | Any | Upload document (multipart/form-data) |
| GET | `/documents/:id` | Any | Get document detail |
| DELETE | `/documents/:id` | Any (own) or ADMIN | Delete document |

---

#### Assets (`/api/assets`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/assets` | Any | List assets (own for EMPLOYEE, all for ADMIN) |
| GET | `/assets/my-assets` | Any | Get currently assigned assets |
| POST | `/assets` | ADMIN | Create asset record |
| PATCH | `/assets/:id` | ADMIN | Update asset |
| POST | `/assets/:id/assign` | ADMIN | Assign asset to employee |
| PATCH | `/assets/:id/return` | ADMIN | Return asset |

---

#### Notifications (`/api/notifications`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/notifications` | Any | List unread notifications |
| PATCH | `/notifications/:id/read` | Any | Mark as read |
| DELETE | `/notifications/:id` | Any | Delete notification |

---

#### Announcements (`/api/announcements`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/announcements` | Any | List active announcements |
| POST | `/announcements` | ADMIN | Create announcement |
| DELETE | `/announcements/:id` | ADMIN | Delete announcement |

---

#### Reports (`/api/reports`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/reports/daily-attendance` | ADMIN | Daily attendance report |
| GET | `/reports/leave-summary` | ADMIN | Leave summary by employee/dept/month |
| GET | `/reports/attendance-summary` | ADMIN | Attendance metrics (late %, absent %) |
| GET | `/reports/payroll-summary` | ADMIN | Payroll expenses by dept/company/month |
| GET | `/reports/export` | ADMIN | Export report as .xlsx |

---

#### Settings (`/api/settings`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/settings` | ADMIN | Get all system settings |
| PATCH | `/settings/:key` | ADMIN | Update a setting |

---

#### Audit Logs (`/api/audit-logs`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/audit-logs` | ADMIN | List audit logs (filterable) |
| GET | `/audit-logs/:id` | ADMIN | Get single log |

---

#### Salary Revisions (`/api/salary-revisions`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/salary-revisions` | ADMIN | List all revisions |
| POST | `/salary-revisions` | ADMIN | Propose revision |
| PATCH | `/salary-revisions/:id/approve` | ADMIN | Approve revision |
| PATCH | `/salary-revisions/:id/reject` | ADMIN | Reject revision |

---

#### Service Requests / Helpdesk (`/api/service-requests`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/service-requests` | Any | List tickets (own for EMPLOYEE, all for ADMIN) |
| POST | `/service-requests` | Any | Create helpdesk ticket |
| PATCH | `/service-requests/:id` | ADMIN | Update status, assign, resolve |

---

#### Delegates (`/api/delegates`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/delegates` | ADMIN | List all delegations |
| POST | `/delegates` | ADMIN | Create delegation (fromDate → toDate) |
| DELETE | `/delegates/:id` | ADMIN | Remove delegation |

---

#### Letters (`/api/letters`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/letters/experience` | ADMIN | Generate experience letter PDF |
| POST | `/letters/exit` | ADMIN | Generate exit letter PDF |

---

#### Upload (`/api/upload`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/upload/bills` | Any | Upload receipt image/PDF → returns URL |
| POST | `/upload/docs` | Any | Upload document → returns URL |

---

#### API Keys (`/api/api-keys`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api-keys` | Any | List own API keys |
| POST | `/api-keys` | Any | Create new API key |
| DELETE | `/api-keys/:id` | Any (own) | Deactivate API key |

---

#### Backups (`/api/backups`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/backups/backup` | OWNER | Trigger manual DB backup to GitHub |
| GET | `/backups/logs` | OWNER | View backup history |

---

#### Founder Dashboard (`/api/founder-dashboard`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/founder-dashboard` | OWNER | Company-wide KPIs |
| GET | `/founder-dashboard/probation-ending` | OWNER | Employees near probation end |
| GET | `/founder-dashboard/turnover` | OWNER | Turnover analysis by department |
| GET | `/founder-dashboard/payroll-trends` | OWNER | Monthly payroll expense trends |

---

#### Search (`/api/search`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/search?q=<query>` | Any | Search employees, documents, policies |

---

#### Daily Attendance (`/api/daily-attendance`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/daily-attendance` | ADMIN | Today's attendance overview for all employees |

---

### 6.5 Scheduled Jobs (Cron)

All jobs run in-process via `node-cron`. Times are IST.

| Time | Job | Description |
|------|-----|-------------|
| 12:01 AM | Auto-deactivate employees | Sets `isActive = false` for employees whose `lastWorkingDate` was yesterday |
| 1:00 AM | Expire comp-offs | Marks CompOff records with `expiresAt < now` as `EXPIRED`; sends notification |
| 12:05 AM | Check missing travel proofs | Flags TRAVELLING leaves from yesterday that have no TravelProof for that date |
| 6:00 AM | Document expiry alerts | Sends notification for documents expiring within 30 days |
| 7:00 AM | Probation ending alerts | Notifies admin of employees exiting probation within 30 days |
| 8:00 AM | Travel proof morning reminder | Sends reminder to employees on active TRAVELLING leave to submit proof |
| 9:00 AM | Exit clearance overdue | Alerts admin of exit clearances pending for 7+ days |
| 10:00 AM | Policy acknowledgement reminder | Sends reminder to employees who haven't acknowledged a policy in 3+ days |
| 2:00 AM | Scheduled DB backup | Runs if `BACKUP_GITHUB_*` env vars are set; commits DB dump to GitHub |

---

## 7. Frontend Architecture

### 7.1 Entry Point & Routing

**`src/main.tsx`** bootstraps:
- `React 18` with StrictMode
- `QueryClientProvider` (TanStack React Query)
- `<Toaster>` (Sonner, top-right, rich colors, close button)
- Renders `<App />`

**`src/App.tsx`** defines all routes:

#### Public Routes
| Path | Component |
|------|-----------|
| `/login` | Login |

#### Protected Routes (any authenticated role)
| Path | Component |
|------|-----------|
| `/` | Redirect → `/dashboard` |
| `/dashboard` | Dashboard |
| `/profile` | Profile |
| `/leaves` | Leaves |
| `/claims` | Claims |
| `/holidays` | Holidays |
| `/attendance` | Attendance |
| `/worklogs` | Worklogs |
| `/payroll/my-payslips` | MyPayslips |
| `/documents` | Documents |
| `/search` | Search |
| `/assets` | Assets |
| `/loans` | Loans |
| `/compoff` | CompOff |
| `/travel-proof` | TravelProof |
| `/helpdesk` | Helpdesk |
| `/reports` | Reports |

#### Admin Routes (`ADMIN` or `OWNER` only)
| Path | Component |
|------|-----------|
| `/organization` | Organization |
| `/payroll/runs` | PayrollRuns |
| `/payroll/runs/:id` | PayrollRunDetail |
| `/payroll/setup` | PayrollSetup |
| `/audit-logs` | AuditLogs |
| `/settings` | Settings |
| `/companies` | Companies |
| `/assignments/:userId` | Assignments |
| `/exit` | ExitManagement |

#### Owner Routes (`OWNER` only)
| Path | Component |
|------|-----------|
| `/policies` | Policies |
| `/founder` | FounderDashboard |

#### Fallback
| Path | Component |
|------|-----------|
| `/*` | NotFound (404) |

#### Route Guards
- `ProtectedRoute` — Redirects unauthenticated users to `/login`
- `AdminRoute` — Redirects non-ADMIN/non-OWNER to `/dashboard`
- `OwnerRoute` — Redirects non-OWNER to `/dashboard`

---

### 7.2 Auth Store (Zustand)

**File:** `src/hooks/useAuth.ts`

```typescript
interface AuthUser {
  id:              string;
  email:           string;
  role:            'OWNER' | 'ADMIN' | 'MANAGER' | 'EMPLOYEE';
  firstName?:      string;
  lastName?:       string;
  employeeId?:     string;
  department?:     string;
  employmentType?: string;
}

interface AuthState {
  user:            AuthUser | null;
  token:           string | null;
  isLoading:       boolean;
  login:           (email: string, password: string) => Promise<void>;
  logout:          () => void;
  initFromStorage: () => void;
}
```

**Persistence:** `localStorage` keys:
- `athena_token` — JWT string
- `athena_user` — JSON-serialized `AuthUser`

**Initialization:** Called at module load time via `initFromStorage()` to rehydrate state and prevent a flash-to-login on page refresh.

---

### 7.3 API Client (Axios)

**File:** `src/lib/api.ts`

```typescript
// Instance config
baseURL: process.env.VITE_API_BASE_URL || '/api'

// Request interceptor
// → Reads token from localStorage('athena_token')
// → Injects header: Authorization: Bearer <token>

// Response interceptor
// → On 401: clears auth (removes localStorage keys), redirects to /login
```

**Usage patterns:**
```typescript
const res = await api.get('/leaves')          // res.data = array/object
const res = await api.post('/leaves', body)   // res.data = created record
const res = await api.patch(`/leaves/${id}`, {}) 
await api.delete(`/leaves/${id}`)
```

---

### 7.4 Layout & Navigation

**File:** `src/components/Layout.tsx`

**Structure:**
- Fixed left sidebar (collapsible on mobile via hamburger)
- Top bar with notification bell + user avatar
- Main content area (`<Outlet />`)

**Notification panel:** Dropdown showing unread notifications. Fetched from `GET /api/notifications`. Clicking marks as read.

**Sidebar nav items (role-gated):**

| Nav Item | Roles |
|----------|-------|
| Home (Dashboard) | All |
| Founder View | OWNER |
| My Profile | All |
| Leaves | All |
| Claims | All |
| Loans | All |
| Comp-Off | All |
| Travelling | All |
| Holidays | All |
| Attendance | All |
| Worklogs | All |
| Companies | ADMIN, OWNER |
| Organization | ADMIN, OWNER |
| Payroll | ADMIN, OWNER |
| Exit Management | ADMIN, OWNER |
| Assets | All |
| Policies | OWNER |
| Audit Logs | ADMIN, OWNER |
| Settings | ADMIN, OWNER |
| Documents | All |
| Search | All |
| Reports | All |
| Helpdesk | All |
| API Keys | ADMIN, OWNER |
| Logout | All |

---

### 7.5 Pages

Every page follows this pattern:
1. Reads `user` from `useAuth()` to check permissions
2. Calls `api.get/post/patch/delete()` for data
3. Uses TanStack Query for caching where applicable
4. Shows loading state while fetching
5. Displays data using `Card`, `Table`, `Badge` components
6. Role-gates admin controls: `{user?.role === 'ADMIN' && <Button>...`
7. Uses `toast.success/error()` for feedback

| Page | Route | Key Features |
|------|-------|-------------|
| Login | `/login` | Email/password form, JWT storage, redirect |
| Dashboard | `/dashboard` | Stat cards, team list, announcements |
| Profile | `/profile` | View/edit own profile, KYC/document upload |
| Leaves | `/leaves` | List, apply, approve/reject, balance display, sandwich rule |
| Claims | `/claims` | Submit with receipt upload, approval workflow |
| Holidays | `/holidays` | Calendar view, add/delete (admin) |
| Attendance | `/attendance` | Daily records, import Excel, manual entry, adjustments |
| Worklogs | `/worklogs` | Submit daily log, manager review/approve |
| PayrollRuns | `/payroll/runs` | List runs, create new, status badges |
| PayrollRunDetail | `/payroll/runs/:id` | Per-employee breakdown, edit MANUAL values, status transitions |
| PayrollSetup | `/payroll/setup` | Create/reorder/delete components |
| MyPayslips | `/payroll/my-payslips` | Download own finalized payslips |
| Organization | `/organization` | Employee table, bulk actions, manager assignment |
| Companies | `/companies` | CRUD company entities |
| Assignments | `/assignments/:userId` | View/edit employee-company assignments, transfers |
| ExitManagement | `/exit` | Initiate exit, track clearances, generate settlement |
| Policies | `/policies` | Version history, rules editor, publish + acknowledgement tracking |
| FounderDashboard | `/founder` | KPI tiles, probation alerts, turnover chart, payroll trends |
| Assets | `/assets` | My assigned assets; inventory management (admin) |
| Loans | `/loans` | Apply, view schedule, admin approval |
| CompOff | `/compoff` | Request, approve, use, view expiry |
| TravelProof | `/travel-proof` | Submit GPS proof per travel leave day |
| Documents | `/documents` | Upload/list/delete KYC, contracts, letters |
| Search | `/search` | Global search across employees, docs, policies |
| Reports | `/reports` | Multiple tabbed reports, Excel export |
| Settings | `/settings` | System-wide key-value settings |
| AuditLogs | `/audit-logs` | Filterable audit trail table |
| Helpdesk | `/helpdesk` | Create/track service tickets |
| NotFound | `/*` | 404 page |

---

### 7.6 UI Component Library

**Location:** `src/components/ui/`  
Built from Shadcn UI (copy-paste Radix UI components with Tailwind styling).

| Component | Description |
|-----------|-------------|
| `avatar.tsx` | Circular avatar with image + fallback initials |
| `badge.tsx` | Inline label with variant colors (default, secondary, destructive, outline) |
| `button.tsx` | Button with variants (default, destructive, outline, secondary, ghost, link) and sizes |
| `card.tsx` | Card container with `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `CardFooter` |
| `dialog.tsx` | Modal dialog with `DialogTrigger`, `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogDescription` |
| `input.tsx` | Styled text input |
| `label.tsx` | Accessible form label |
| `separator.tsx` | Horizontal/vertical visual divider |

**Tailwind Theme** (`tailwind.config.js`):
- Dark mode: class-based
- Custom CSS variable colors: `background`, `foreground`, `card`, `popover`, `primary`, `secondary`, `muted`, `accent`, `destructive`, `border`, `input`, `ring`
- Extended border radius from CSS var: `lg`, `md`, `sm`
- Animation plugin: `tailwindcss-animate`

---

## 8. Business Logic & Workflows

### 8.1 Leave Workflow

```
Employee applies
    ↓
System validates:
  - Leave type allowed for employmentType (FULL_TIME vs INTERN)
  - Leave balance available
  - No conflicting active leave on same dates
  - Sandwich rule check (see below)
    ↓
LeaveRequest created (status: PENDING)
  + Balance pre-deducted
  + Notification sent to manager
    ↓
Manager approves / rejects
  ↓ Approved                      ↓ Rejected
Status → APPROVED              Status → REJECTED
                               Balance refunded
    ↓
Employee notified
```

**Sandwich Rule:**
- Enabled via policy rule `sandwich_rule_enabled: true`
- When a leave spans non-working days (holidays, DeclaredWFH, weekends), those days are **credited** (counted) as part of the leave
- Example: Employee takes Mon + Thu off; Tue + Wed are public holidays → `totalDays = 4` (not 2)
- Does **not** apply to: `TRAVELLING`, `TEMPORARY_WFH`, `COMP_OFF`

**Half-day handling:**
- `SINGLE` leave with `singleDayType: FIRST_HALF | SECOND_HALF` = 0.5 days
- `MULTIPLE` leave can have partial start/end days via `startDayType` / `endDayType`

---

### 8.2 Payroll Workflow

```
Admin creates PayrollRun (month, year, company?)
    ↓
System generates PayslipEntry for each active employee:
  1. Fetch employee CTC (Profile.annualCtc)
  2. Count working days (calendar days − holidays)
  3. Count LWP days (from AttendanceRecord.lwpDeduction)
  4. Count WFH days (TEMPORARY_WFH approved leaves in month)
  5. Load active PayrollComponents (ordered)
  6. Compute earnings per component (PERCENTAGE_OF_CTC / FIXED / MANUAL)
  7. Compute gross pay
  8. Apply LWP deduction: gross × lwpDays / workingDays
  9. Apply WFH deduction: gross × wfhDays / workingDays × 30% (policy)
  10. Compute PT (AUTO_PT) from prorated gross slab
  11. Compute TDS (AUTO_TDS) from annual CTC
  12. Add any other DEDUCTION components
  13. net = proratedGross − deductions + reimbursements
    ↓
Admin reviews → edits MANUAL components → recomputes
    ↓
Admin submits → SUBMITTED (frozen for editing)
    ↓
Owner finalizes → FINALIZED (locked, audit logged)
    ↓
Employees can download payslip from My Payslips
```

**Payroll Status Machine:**
```
DRAFT → SUBMITTED → FINALIZED
          ↓              ↓
        (Owner can reopen back to DRAFT)
```

---

### 8.3 Attendance Workflow

```
Monthly ZKTeco export → Excel file
    ↓
Admin uploads via /attendance/import-preview
    ↓
System previews:
  - Maps enNo → userId via PunchMapping
  - Shows unmapped enrollment numbers
  - Validates date/time formats
    ↓
Admin confirms import
    ↓
AttendanceRecord created per employee per day:
  - checkIn / checkOut times stored
  - hoursWorked calculated
  - isLate = checkIn > late_cutoff_time (10:15 policy)
  - lwpDeduction = 1 if hoursWorked < half_day_hours_threshold (4.5h policy)
    ↓
Attendance visible to employees
Managers can add manual entries / adjustments
Payroll run picks up lwpDays from records
```

---

### 8.4 Exit & Final Settlement Workflow

```
Admin initiates exit (sets lastWorkingDate, noticePeriodDays)
    ↓
ExitRequest created (status: INITIATED)
ExitClearance records created per department
    ↓
Each department head marks clearance CLEARED
    ↓
When all clearances CLEARED:
Admin generates FinalSettlement:
  + Last month salary (prorated)
  + Leave encashment (remaining EL days × daily rate)
  + Pending reimbursements
  − Notice period recovery (if notice not served)
  − Outstanding loan balance
  − Other deductions
  = Total Payable
    ↓
Settlement reviewed and processed
    ↓
On lastWorkingDate: cron auto-sets isActive = false
```

---

### 8.5 Comp-Off Workflow

```
Employee works on holiday/weekend
    ↓
Employee requests comp-off (earnedDate, reason)
    ↓
Manager approves → expiresAt = earnedDate + 90 days
    ↓
Employee uses comp-off (POST /compoff/:id/use)
  → Status: USED, usedOn: date
    ↓
If not used before expiresAt:
  → 1:00 AM cron: Status → EXPIRED
  → Notification sent to employee
```

---

### 8.6 Travel Leave Proof Workflow

```
Employee applies for TRAVELLING leave
    ↓
Manager approves
    ↓
8:00 AM daily: cron sends reminder to submit geo proof for today
    ↓
Employee submits TravelProof (GPS lat/lng, maps link)
    ↓
12:05 AM: cron checks previous day's TRAVELLING leaves
  → If no proof found: flags + notifies employee + manager
```

---

### 8.7 Loan Workflow

```
Employee applies for loan (amount, installments, reason)
    ↓
Admin reviews and approves:
  - Sets startMonth/startYear for EMI deduction
  - Status: APPROVED → ACTIVE
    ↓
Each payroll run: EMI auto-deducted as MANUAL deduction
    ↓
paidInstallments incremented per run
    ↓
When paidInstallments = installments:
  Admin marks as CLOSED
```

---

## 9. Security Model

### Authentication
- JWT signed with `JWT_SECRET` (HS256)
- Token expiry: `JWT_EXPIRES_IN` (default `7d`)
- Token stored in `localStorage` (`athena_token`)
- Every API request sends: `Authorization: Bearer <token>`
- On 401: frontend clears localStorage, redirects to `/login`

### Authorization
| Role | Access Level |
|------|-------------|
| OWNER | Full access, bypasses all `authorize()` checks |
| ADMIN | Can manage all data except OWNER-only actions |
| MANAGER | Can view/approve team data; cannot access org-wide configs |
| EMPLOYEE | Own data only |

### Field Masking
Sensitive employee fields are redacted based on viewer role:
- **PAN**: Shown fully only to OWNER/ADMIN. Masked (e.g. `ABXXX1234A`) for MANAGER+
- **Aadhar**: Masked except last 4 digits
- **Bank account**: Masked except last 4 digits
- **IFSC / UAN**: Masked for non-admin roles

### Password Security
- Stored as bcrypt hash (cost factor: 10-12 rounds)
- Login uses `bcrypt.compare()` (constant-time, no timing attacks)
- Admin reset generates temp password `Temp@<4 random digits>`
- No minimum length policy enforced beyond 1 character

### File Upload Security
- MIME type validated server-side (jpg, png, gif, webp, pdf only)
- Max 5 MB per file
- Files saved with random names (original filename not preserved)
- No executable extension allowed
- Served as static files (no server-side execution)

### CORS
- Explicit origins: `localhost:*`, `192.168.x.x/*`, `CORS_ORIGIN` env
- Credentials: enabled
- All other origins: blocked

### Audit Trail
- Every significant mutation is logged to `AuditLog`
- Fields: actor, action, entity, entityId, oldValues, newValues, reason, changeSource
- Accessible to ADMIN only via `/api/audit-logs`

### API Key Security
- Keys hashed with bcrypt before storage
- Only the 8-char prefix shown to user after creation
- Scopes stored as JSON array (future granular permission support)

---

## 10. Seed Data

**Script:** `apps/api/prisma/seed.ts`  
**Run:** `cd apps/api && npm run seed`

**Seed Process:**
1. Truncate all app tables (CASCADE)
2. Load employees from `employee_import_template.xlsx`
3. Create `User` + `Profile` for each (bcrypt password)
4. Resolve manager relationships by employeeId cross-reference
5. Promote `admin@ewards.com` → role `OWNER`
6. Create 8 `Company` records:
   - Advisors, Central Cables, Ewards Engagement, Export, Gajraj Tradecom, Optimix, Projects, Second Hugs
7. Create `EmployeeCompanyAssignment` records (from hardcoded map by employeeId)
8. Create `PolicyVersion` v1 with 18 default `PolicyRule` records
9. Create `LeavePolicy` records: SL (12d), CL (12d), EL (15d), MATERNITY (180d), PATERNITY (5d), TEMPORARY_WFH, TRAVELLING, COMP_OFF
10. Create `LeaveBalance` records for current FY for all employees
11. Create `PayrollComponent` records: Basic (60% of CTC, EARNING), HRA (25%, EARNING), LTA (15%, EARNING), Professional Tax (AUTO_PT, DEDUCTION), TDS (AUTO_TDS, DEDUCTION)
12. Create `Holiday` records for 2026: Holi, Good Friday, Eid, Independence Day, Durga Puja, Diwali, Christmas
13. Create welcome `Announcement`

**Default Policy Rules (v1):**

| Rule Key | Default Value | Type |
|----------|--------------|------|
| `wfh_deduction_pct` | 30 | number |
| `sandwich_rule_enabled` | true | boolean |
| `late_cutoff_time` | 10:15 | string |
| `half_day_hours_threshold` | 4.5 | number |
| `late_lwp_threshold` | 4 | number |
| `sat_free_fulltime` | 3 | number |
| `sat_free_intern` | 2 | number |
| `default_notice_period_days` | 90 | number |
| `leave_encashment_rate` | 1.0 | number |
| `compoff_expiry_days` | 90 | number |
| `tds_regime` | new | string |
| `pt_state` | west_bengal | string |
| `pf_enabled` | false | boolean |
| `esi_enabled` | false | boolean |
| `sick_leave_doc_required_days` | 2 | number |
| `wfh_allowed_per_month` | 0 | number (0 = unlimited) |
| `carry_forward_max_days` | 15 | number |
| `probation_default_days` | 90 | number |
| `extension_arrival_time` | 11:00 | string |

**Test Accounts:**

| Role | Email | Password |
|------|-------|---------|
| OWNER | admin@ewards.com | Admin@123 |
| MANAGER | manager@ewards.com | Employee@123 |
| EMPLOYEE | rahul.verma@ewards.com | Employee@123 |
| EMPLOYEE | sneha.roy@ewards.com | Employee@123 |

---

## 11. Dev Commands Reference

```bash
# --- Monorepo (run from root) ---
npm install                     # Install all workspace dependencies
npm run dev                     # Start API + Web in parallel
npm run seed                    # Re-seed test data (wipes existing data!)
npm run db:migrate              # Run Prisma migrations
npm run db:generate             # Regenerate Prisma client

# --- Backend only (apps/api) ---
cd apps/api
npm run dev                     # Start API server (port 3001, ts-node-dev hot reload)
npm run build                   # Compile TypeScript → dist/
npm run start                   # Run compiled dist/index.js
npm run seed                    # Run seed.ts
npx prisma migrate dev --name <name>   # Create + apply new migration
npx prisma db pull              # Pull schema from existing DB (overrides schema.prisma)
npx prisma studio               # Open visual DB browser at localhost:5555
npx prisma generate             # Regenerate Prisma client after schema change

# --- Frontend only (apps/web) ---
cd apps/web
npm run dev                     # Start Vite dev server (port 5173)
npm run build                   # Bundle for production → dist/
npm run preview                 # Preview production build locally
```

---

## 12. Deployment Notes

### Production Build

**Backend:**
```bash
cd apps/api
npm install --include=dev    # Must include dev deps for TypeScript
npm run build                # tsc → dist/
npm run start                # node dist/index.js
```

**Frontend:**
```bash
cd apps/web
npm install
npm run build                # Vite → dist/
# Serve dist/ as static files (Nginx, Vercel, Netlify, etc.)
```

### Key Deployment Requirements
- `DATABASE_URL` must be a full PostgreSQL connection string
- `JWT_SECRET` must be a strong random string
- `DIRECT_URL` required for Prisma on connection-pooled setups (e.g. PgBouncer)
- SMTP env vars required for email notifications (optional — app works without them)
- GitHub env vars required for automated backup (optional)
- `/uploads/` directory must be writable and persisted (not ephemeral)
- In production: move file storage to S3 / Azure Blob / Cloudflare R2

### CORS Configuration
Set `CORS_ORIGIN` to your production frontend URL:
```
CORS_ORIGIN=https://your-app.vercel.app
```

### Hosted Deployment
- API: Render (Web Service, Node.js)
- Frontend: Vercel (Static/SPA)
- Database: Supabase or Render PostgreSQL

### Scaling Considerations
| Concern | Current | Recommendation |
|---------|---------|---------------|
| DB connections | Direct PrismaClient | Use PgBouncer + `DIRECT_URL` |
| Cron jobs | In-process node-cron | Move to separate worker or use pg-boss |
| File storage | Local disk `/uploads/` | S3-compatible object storage |
| Sessions | Stateless JWT | No change needed |
| Cache | None | Add Redis for query cache if needed |
| Email queue | Synchronous Nodemailer | Bull/BullMQ queue for reliability |
| Logs | `console.log` | Winston + log aggregation (Datadog, Logtail) |

### After `prisma db pull` — Important
When pulling schema from an existing DB:
1. Restore `@default(cuid())` on all `id` fields
2. Restore `@updatedAt` on all `updatedAt` fields
3. Restore camelCase relation names (Prisma may lowercase them)

---

*End of Athena V2 HRMS Technical Documentation*
