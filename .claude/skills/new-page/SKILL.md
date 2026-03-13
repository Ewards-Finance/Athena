---
name: new-page
description: Scaffold a new React frontend page for Athena following existing project patterns
---

Create a new React frontend page for: $ARGUMENTS

Follow these steps exactly:

1. **Read a similar existing page first** to understand the pattern (e.g., `apps/web/src/pages/Leaves.tsx` or `apps/web/src/pages/Claims.tsx`)

2. **Create `apps/web/src/pages/<Name>.tsx`** with:
   - `useAuth()` from `'../hooks/useAuth'` to get current user and role
   - `api` from `'../lib/api'` for all HTTP requests (JWT injected automatically)
   - Shadcn UI components: Card, CardContent, CardHeader, CardTitle, Button, Badge, Input, Dialog, Select
   - Tailwind CSS for styling (use `className="p-6 space-y-4"` pattern)
   - Loading state while fetching (`const [loading, setLoading] = useState(true)`)
   - Role-gated admin actions: `{user?.role === 'ADMIN' && <Button>...</Button>}`
   - Error handling with try/catch

3. **Register route in `apps/web/src/App.tsx`**:
   ```tsx
   // Any logged-in user:
   <Route path="/<name>" element={<ProtectedRoute><Name /></ProtectedRoute>} />
   // Admin only:
   <Route path="/<name>" element={<AdminRoute><Name /></AdminRoute>} />
   ```
   Add the import at the top of App.tsx.

4. **Add to sidebar** in `apps/web/src/components/Layout.tsx` in the `navItems` array with an appropriate Lucide icon.

5. **Verify TypeScript compiles** (no errors):
   ```bash
   cd apps/web && npx tsc --noEmit
   ```

6. **Tell the user** what was created and how to navigate to the page in the browser.
