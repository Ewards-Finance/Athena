---
name: new-route
description: Scaffold a new Express API route for Athena following existing project patterns
---

Create a new Express API route for: $ARGUMENTS

Follow these steps exactly:

1. **Read a similar existing route first** to understand the pattern (e.g., `apps/api/src/routes/leaves.ts` or `apps/api/src/routes/claims.ts`)

2. **Create `apps/api/src/routes/<name>.ts`** with:
   - `router.use(authenticate)` at the top — ALL routes require login
   - EMPLOYEE users see only their own data (filter by `userId: user.id`)
   - ADMIN/MANAGER see all data
   - Use `authorize(['ADMIN'])` or `authorize(['ADMIN', 'MANAGER'])` for restricted actions
   - Use shared `prisma` from `'../index'` — never `new PrismaClient()`
   - Return `{ error: '...' }` for all errors with correct status codes
   - Return 201 on POST, 200 on everything else
   - Add notifications via `createNotification` for status changes (approve/reject/etc)

3. **Register in `apps/api/src/index.ts`**:
   ```typescript
   import <name>Router from './routes/<name>'
   app.use('/api/<name>', <name>Router)
   ```

4. **Verify TypeScript compiles** (no errors):
   ```bash
   cd apps/api && npx tsc --noEmit
   ```

5. **Tell the user** what endpoints were created and how to test them.
