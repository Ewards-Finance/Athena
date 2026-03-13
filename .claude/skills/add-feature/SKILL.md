---
name: add-feature
description: Add a complete new HRMS feature to Athena — creates backend route, database model (if needed), frontend page, and navigation all in one go
---

Add a complete new HRMS feature: $ARGUMENTS

This creates everything needed for a fully working feature. Work through each step:

## Step 1: Understand the Feature
- Ask clarifying questions if the feature is unclear
- Decide what data needs to be stored (new model? or use existing?)
- Decide who can do what (EMPLOYEE submits, MANAGER approves, ADMIN manages?)

## Step 2: Database (only if new data model needed)
- Add the new model to `apps/api/prisma/schema.prisma`
- Follow existing model conventions (use `id String @id @default(cuid())`, `createdAt DateTime @default(now())`)
- Run migration:
  ```bash
  cd apps/api && npx prisma migrate dev --name add_<feature>
  ```

## Step 3: Backend API Route
- Read `apps/api/src/routes/leaves.ts` or `apps/api/src/routes/claims.ts` as reference
- Create `apps/api/src/routes/<feature>.ts` with full CRUD
- Apply role-based scoping (EMPLOYEE sees own, ADMIN sees all)
- Add notifications for status changes
- Register in `apps/api/src/index.ts`

## Step 4: Frontend Page
- Read `apps/web/src/pages/Leaves.tsx` or `apps/web/src/pages/Claims.tsx` as reference
- Create `apps/web/src/pages/<Feature>.tsx`
- Include: list view, submit form (Dialog), approve/reject actions (role-gated)
- Use Shadcn UI + Tailwind for styling

## Step 5: Navigation
- Add route in `apps/web/src/App.tsx`
- Add sidebar entry in `apps/web/src/components/Layout.tsx`

## Step 6: Verify Everything Works
```bash
cd apps/api && npx tsc --noEmit
cd apps/web && npx tsc --noEmit
```
Fix any TypeScript errors before finishing.

## Step 7: Summary
Tell the user exactly:
- What endpoints were created (e.g., GET /api/feature, POST /api/feature)
- What the page URL is (e.g., /feature)
- Which roles can do what
- If a migration was run
