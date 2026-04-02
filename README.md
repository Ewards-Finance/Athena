# Athena HRMS

A full-stack Human Resource Management System built for Ewards Finance. Athena covers the complete employee lifecycle — from onboarding and attendance to payroll, leave management, and exit processing.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Node.js + Express + TypeScript |
| Frontend | React 18 + Vite + TypeScript |
| Database | PostgreSQL (Prisma ORM) |
| Auth | JWT (RS256) + RBAC |
| UI | Shadcn UI + Tailwind CSS |
| State | Zustand |
| Email | Nodemailer (Zoho SMTP) |
| Deployment | Render (API) + Vercel (Web) |

---

## Project Structure

```
athena-v2/                        # npm workspaces monorepo
├── apps/
│   ├── api/                      # Express backend (port 3001)
│   │   ├── prisma/
│   │   │   ├── schema.prisma     # Database schema (19 models)
│   │   │   ├── seed.ts           # Dev seed data
│   │   │   └── migrations/       # Prisma migration history
│   │   └── src/
│   │       ├── index.ts          # App entry, route registration
│   │       ├── middleware/
│   │       │   ├── auth.ts       # JWT verification + RBAC
│   │       │   └── upload.ts     # Multer file upload handler
│   │       ├── routes/           # 30+ Express route files
│   │       ├── lib/
│   │       │   ├── payrollEngine.ts   # Payroll calculation engine
│   │       │   ├── policyEngine.ts    # Leave/attendance policy rules
│   │       │   ├── notify.ts          # In-app notification helper
│   │       │   ├── email.ts           # Nodemailer email helper
│   │       │   ├── audit.ts           # Audit log writer
│   │       │   ├── delegation.ts      # Approval delegation logic
│   │       │   ├── excelExport.ts     # Excel report generation
│   │       │   └── letterGenerator.ts # PDF letter generation (Puppeteer)
│   │       └── templates/        # Handlebars templates for HR letters
│   └── web/                      # React + Vite frontend (port 5173)
│       └── src/
│           ├── App.tsx           # Router + route guards
│           ├── pages/            # 30+ page components
│           ├── components/
│           │   ├── Layout.tsx    # Sidebar + nav shell
│           │   ├── ui/           # Shadcn UI components
│           │   └── NotificationPanel.tsx
│           ├── hooks/
│           │   └── useAuth.ts    # Zustand auth store
│           └── lib/
│               └── api.ts        # Axios instance (JWT auto-injected)
└── package.json                  # Workspace root
```

---

## Modules

| Module | Description |
|--------|-------------|
| **Auth** | Login, JWT issuance, password change, admin password reset |
| **Employees** | Full CRUD, profile management, bulk Excel import, statutory docs |
| **Leaves** | Apply, approve/reject, leave balance tracking, leave policies, comp-off |
| **Attendance** | ZKTeco biometric import, late marking, LWP deductions, manual adjustments, exception inbox |
| **Payroll** | CTC components, payroll runs, payslip generation, Excel export, salary revisions |
| **Claims** | Reimbursement submission, approval flow, payment tracking |
| **Worklogs** | Daily work logs, WFH declarations, manager approval |
| **Travel Proof** | Travel expense proof submission and review |
| **Documents** | Employee document uploads and management |
| **Letters** | PDF generation for offer, appointment, increment, relieving, and other HR letters |
| **Loans** | Employee loan tracking and repayment |
| **Assets** | Company asset assignment and tracking |
| **Exit Management** | Resignation, clearance checklist, full-and-final settlement |
| **Notifications** | In-app notification bell with real-time badge |
| **Announcements** | Company-wide notice board |
| **Holidays** | Company holiday calendar |
| **Policies** | HR policy documents with employee acknowledgement tracking |
| **Audit Logs** | Immutable log of all admin/manager actions |
| **Reports** | Exportable reports (attendance, payroll, headcount) |
| **Search** | Global search across employees, leaves, claims |
| **Settings** | Organisation settings, SMTP config, API keys |
| **Companies** | Multi-company setup and employee assignment |
| **Helpdesk** | Internal service request ticketing |
| **Founder Dashboard** | High-level org health metrics |

---

## Roles & Access Control

Three roles with route-level and data-level enforcement:

| Role | Access |
|------|--------|
| `ADMIN` | Full access to all data and configuration |
| `MANAGER` | Own data + direct reports' data (leaves, claims, attendance, worklogs) |
| `EMPLOYEE` | Own data only |

Reporting manager is set per employee via `Profile.managerId`. All manager-scoped queries filter by this field automatically.

---

## Database

**19 Prisma models:** User, Profile, LeaveRequest, LeaveBalance, LeavePolicy, Reimbursement, Notification, Holiday, Announcement, PayrollComponent, PayrollRun, PayslipEntry, AttendanceImport, AttendanceRecord, PunchMapping, WorkLog, DeclaredWFH, Company, EmployeeCompanyAssignment, and more.

Single migration (`20260323101248_init`) — schema is stable.

---

## Local Setup

### Prerequisites
- Node.js 18+
- PostgreSQL 15+

### 1. Clone and install

```bash
git clone https://github.com/Ewards-Finance/Athena.git
cd Athena
npm install
```

### 2. Configure environment

```bash
# API environment
cp apps/api/.env.example apps/api/.env
```

Edit `apps/api/.env`:

```env
DATABASE_URL="postgresql://postgres:yourpassword@localhost:5432/athena_db"
JWT_SECRET="your-strong-secret-min-32-chars"
JWT_EXPIRES_IN="7d"
PORT=3001
CORS_ORIGINS="http://localhost:5173"

# Optional — email notifications (Zoho / any SMTP)
SMTP_HOST=smtppro.zoho.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=your@email.com
SMTP_PASS=yourpassword
SMTP_FROM="Athena HRMS <your@email.com>"
FRONTEND_URL=http://localhost:5173
```

```bash
# Frontend environment
cp apps/web/.env.example apps/web/.env
```

Edit `apps/web/.env`:

```env
VITE_API_BASE_URL=http://localhost:3001/api
```

### 3. Set up the database

```bash
# Run migrations
cd apps/api
npx prisma migrate dev

# Seed dev data (creates test accounts)
npm run seed
```

### 4. Start the servers

```bash
# In terminal 1 — API
cd apps/api && npm run dev

# In terminal 2 — Frontend
cd apps/web && npm run dev
```

Open http://localhost:5173

---

## Test Accounts (dev seed)

| Role | Email | Password |
|------|-------|----------|
| Admin | admin@ewards.com | Admin@123 |
| Manager | manager@ewards.com | Employee@123 |
| Employee | rahul.verma@ewards.com | Employee@123 |
| Employee | sneha.roy@ewards.com | Employee@123 |

---

## Deployment

| Service | Platform | Notes |
|---------|----------|-------|
| API | Render | Build: `npm install --include=dev && npm run build` · Start: `npm start` |
| Frontend | Vercel | Auto-deploys from `main` branch |
| Database | Render PostgreSQL | Connection via `DATABASE_URL` env var |

---

## Key Commands

```bash
# Development
cd apps/api && npm run dev          # Start API (port 3001)
cd apps/web && npm run dev          # Start frontend (port 5173)

# Database
cd apps/api && npx prisma migrate dev --name <name>   # Create migration
cd apps/api && npm run seed                            # Re-seed dev data
cd apps/api && npx prisma studio                       # Visual DB browser

# Production build
cd apps/api && npm run build        # Compile TypeScript
cd apps/web && npm run build        # Vite production build
```

---

## API Overview

All API routes are prefixed with `/api` and require a JWT bearer token (except `/api/auth/login`).

```
POST   /api/auth/login
GET    /api/auth/me
POST   /api/auth/change-password

GET    /api/employees
POST   /api/employees
GET    /api/employees/:id
PATCH  /api/employees/:id

GET    /api/leaves
POST   /api/leaves
PATCH  /api/leaves/:id/approve
PATCH  /api/leaves/:id/reject

GET    /api/attendance/records
GET    /api/attendance/summary
POST   /api/attendance/import

GET    /api/payroll/runs
POST   /api/payroll/runs
GET    /api/payroll/runs/:id/payslips

GET    /api/claims
POST   /api/claims
PATCH  /api/claims/:id/approve

# ... and 25+ more route files
```

---

## Security Highlights

- Passwords hashed with bcrypt (cost factor 12)
- JWT expiry configurable via `JWT_EXPIRES_IN`
- Role-based access enforced at both route level (`authorize()` middleware) and query level (data scoping by role)
- Sensitive profile fields masked for non-admin viewers
- Audit log written on every approval, rejection, and admin action
- SMTP credentials never exposed to frontend

---

*Built with Node.js, React, Prisma, and PostgreSQL.*
