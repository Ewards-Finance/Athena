# Project Athena V2 — HRMS

> Built with Claude Code by a non-developer (vibe coding). Keep code simple, follow existing patterns exactly.

## Stack
- **Monorepo** (npm workspaces): `apps/api` + `apps/web`
- **Backend**: Node.js + Express + TypeScript — port **3001**
- **Frontend**: React 18 + Vite + TypeScript — port **5173**
- **Database**: PostgreSQL 18 — db: `athena_db`, user: `postgres`
- **ORM**: Prisma 5.x (schema at `apps/api/prisma/schema.prisma`)
- **Auth**: JWT stored in localStorage as `athena_token` + RBAC (3 roles: ADMIN, MANAGER, EMPLOYEE)
- **UI**: Shadcn (manual) + Tailwind CSS
- **State**: Zustand — single auth store at `apps/web/src/hooks/useAuth.ts`

## Dev Commands
```bash
# Start servers (run each in a separate terminal):
cd apps/api && npm run dev      # API on port 3001
cd apps/web && npm run dev      # Frontend on port 5173

# Database:
cd apps/api && npm run seed                                  # Re-seed test data
cd apps/api && npx prisma migrate dev --name <name>          # Create migration
cd apps/api && npx prisma studio                             # Visual DB browser
```

## Test Accounts
| Role     | Email                       | Password     |
|----------|-----------------------------|--------------|
| Admin    | admin@ewards.com            | Admin@123    |
| Manager  | manager@ewards.com          | Employee@123 |
| Employee | rahul.verma@ewards.com      | Employee@123 |
| Employee | sneha.roy@ewards.com        | Employee@123 |

## Key File Paths
- API entry: `apps/api/src/index.ts`
- API routes folder: `apps/api/src/routes/` (14 route files)
- Auth middleware: `apps/api/src/middleware/auth.ts`
- Prisma schema: `apps/api/prisma/schema.prisma`
- Seed file: `apps/api/prisma/seed.ts`
- Frontend entry: `apps/web/src/main.tsx`
- Router + guards: `apps/web/src/App.tsx`
- Pages folder: `apps/web/src/pages/` (14 pages)
- Shadcn UI components: `apps/web/src/components/ui/`
- Auth store (Zustand): `apps/web/src/hooks/useAuth.ts`
- API client (Axios): `apps/web/src/lib/api.ts`
- Payroll engine: `apps/api/src/lib/payrollEngine.ts`
- Notification helper: `apps/api/src/lib/notify.ts`

---

## Backend: Creating a New API Route

**Always follow this exact pattern:**

```typescript
// apps/api/src/routes/example.ts
import { Router, Response } from 'express'
import { AuthRequest, authenticate, authorize } from '../middleware/auth'
import { prisma } from '../index'

const router = Router()
router.use(authenticate)  // ALL routes require login — never skip this

// GET — list (always scope by role)
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!
    const where = user.role === 'EMPLOYEE' ? { userId: user.id } : {}
    const items = await prisma.modelName.findMany({ where })
    res.json(items)
  } catch {
    res.status(500).json({ error: 'Internal server error' })
  }
})

// POST — create (restrict to admin)
router.post('/', authorize(['ADMIN']), async (req: AuthRequest, res: Response) => {
  try {
    const item = await prisma.modelName.create({ data: req.body })
    res.status(201).json(item)
  } catch {
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
```

**Register in `apps/api/src/index.ts`:**
```typescript
import exampleRouter from './routes/example'
app.use('/api/example', exampleRouter)
```

## Auth Middleware Usage
```typescript
router.use(authenticate)                              // All routes: require login
router.get('/', handler)                              // Any logged-in user
router.post('/', authorize(['ADMIN']), handler)       // Admin only
router.patch('/', authorize(['ADMIN', 'MANAGER']), handler)  // Admin or Manager
```

## API Error Response Format (use consistently)
```typescript
res.status(400).json({ error: 'Missing required fields' })
res.status(401).json({ error: 'Unauthorized' })
res.status(403).json({ error: 'Forbidden' })
res.status(404).json({ error: 'Not found' })
res.status(409).json({ error: 'Already exists' })
res.status(500).json({ error: 'Internal server error' })
```

## Prisma Usage Patterns
```typescript
import { prisma } from '../index'  // Always use shared instance, NEVER new PrismaClient()

// Find with relations
await prisma.leaveRequest.findMany({
  where: { employeeId: user.id },
  include: { employee: { include: { profile: true } } }
})

// Transaction (for multi-step: e.g., approve + update balance)
await prisma.$transaction(async (tx) => {
  await tx.leaveRequest.update({ where: { id }, data: { status: 'APPROVED' } })
  await tx.leaveBalance.update({ where: { ... }, data: { used: { increment: days } } })
})
```

## Sending Notifications
```typescript
import { createNotification } from '../lib/notify'

await createNotification({
  userId: targetUserId,
  type: 'LEAVE_APPROVED',
  title: 'Leave Approved',
  message: 'Your leave has been approved.',
  link: '/leaves'
})
```

---

## Frontend: Creating a New Page

**Always follow this exact pattern:**

```typescript
// apps/web/src/pages/Example.tsx
import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { useAuth } from '../hooks/useAuth'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Badge } from '../components/ui/badge'

export default function Example() {
  const { user } = useAuth()
  const [items, setItems] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get('/example')
      .then(r => setItems(r.data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-semibold">Example</h1>
      {loading ? (
        <p className="text-muted-foreground">Loading...</p>
      ) : (
        items.map(item => (
          <Card key={item.id}>
            <CardContent className="pt-4">{item.name}</CardContent>
          </Card>
        ))
      )}
      {/* Role-gate admin actions: */}
      {user?.role === 'ADMIN' && <Button>Admin Action</Button>}
    </div>
  )
}
```

**Register route in `apps/web/src/App.tsx`:**
```tsx
// For any logged-in user:
<Route path="/example" element={<ProtectedRoute><Example /></ProtectedRoute>} />
// For admin only:
<Route path="/example" element={<AdminRoute><Example /></AdminRoute>} />
```

**Add to sidebar in `apps/web/src/components/Layout.tsx`** inside the `navItems` array.

## API Client Usage (Frontend)
```typescript
import { api } from '../lib/api'  // Axios with JWT auto-injected on every request

const res = await api.get('/leaves')              // GET  → res.data
const res = await api.post('/leaves', body)       // POST → res.data (201)
const res = await api.patch(`/leaves/${id}`, {}) // PATCH → res.data
await api.delete(`/leaves/${id}`)                // DELETE
```

---

## All 19 Prisma Models
User, Profile, LeaveRequest, LeaveBalance, LeavePolicy, Reimbursement,
Notification, Holiday, Announcement, PayrollComponent, PayrollRun,
PayslipEntry, AttendanceImport, AttendanceRecord, PunchMapping, WorkLog, DeclaredWFH

## All Enums
- **Role**: ADMIN | MANAGER | EMPLOYEE
- **LeaveStatus**: PENDING | APPROVED | REJECTED | CANCELLED
- **ClaimStatus**: PENDING | APPROVED | PAID | REJECTED
- **ComponentType**: EARNING | DEDUCTION
- **CalcType**: PERCENTAGE_OF_CTC | FIXED | MANUAL | AUTO_PT
- **PayrollStatus**: DRAFT | FINALIZED
- **ClaimCategory**: TRAVEL | FOOD | INTERNET | MISCELLANEOUS
- **WorklogStatus**: APPROVED | REJECTED

## Existing Modules (already built)
- Auth (login, JWT, /me)
- Employees (CRUD, profiles, statutory docs)
- Leaves (apply, approve/reject, balance, policies)
- Claims (reimbursements, approve/pay/reject)
- Attendance (ZKTeco import, late marking, LWP)
- Payroll (components, CTC, runs, payslips, export)
- Worklogs (daily logs, WFH declaration)
- Dashboard (stats, team view)
- Notifications (in-app bell)
- Holidays (company calendar)
- Announcements (notice board)
