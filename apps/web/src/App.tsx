/**
 * Athena V2 - Root Application Component
 * Sets up React Router with protected routes.
 * Unauthenticated users are redirected to /login.
 */

import { useEffect }              from 'react';
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { useAuth }        from '@/hooks/useAuth';
import Layout             from '@/components/Layout';
import Login              from '@/pages/Login';
import Dashboard          from '@/pages/Dashboard';
import Profile            from '@/pages/Profile';
import Leaves             from '@/pages/Leaves';
import Claims             from '@/pages/Claims';
import Organization       from '@/pages/Organization';
import Holidays           from '@/pages/Holidays';
import PayrollRuns        from '@/pages/PayrollRuns';
import PayrollSetup       from '@/pages/PayrollSetup';
import PayrollRunDetail   from '@/pages/PayrollRunDetail';
import MyPayslips         from '@/pages/MyPayslips';
import Attendance         from '@/pages/Attendance';
import Worklogs           from '@/pages/Worklogs';
import NotFound           from '@/pages/NotFound';
import AuditLogs          from '@/pages/AuditLogs';
import Settings           from '@/pages/Settings';
import Reports            from '@/pages/Reports';
import Documents          from '@/pages/Documents';
import Search            from '@/pages/Search';

// ProtectedRoute: wraps routes that require login
// If user is not authenticated, redirects to /login
function ProtectedRoute() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return <Outlet />;
}

// AdminRoute: wraps routes that require ADMIN role
function AdminRoute() {
  const { user } = useAuth();
  if (!user)                   return <Navigate to="/login"    replace />;
  if (user.role !== 'ADMIN')   return <Navigate to="/dashboard" replace />;
  return <Outlet />;
}

export default function App() {
  const { initFromStorage } = useAuth();

  // On app load, restore auth state from localStorage (JWT + user data)
  useEffect(() => {
    initFromStorage();
  }, [initFromStorage]);

  return (
    <BrowserRouter>
      <Routes>
        {/* Public routes */}
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<Navigate to="/dashboard" replace />} />

        {/* Protected routes — wrapped in the Layout (sidebar + header) */}
        <Route element={<ProtectedRoute />}>
          <Route element={<Layout />}>
            <Route path="/dashboard"    element={<Dashboard />} />
            <Route path="/profile"      element={<Profile />} />
            <Route path="/leaves"       element={<Leaves />} />
            <Route path="/claims"       element={<Claims />} />
            <Route path="/holidays"     element={<Holidays />} />

            {/* All roles: attendance */}
            <Route path="/attendance"          element={<Attendance />} />

            {/* All roles: worklogs */}
            <Route path="/worklogs"            element={<Worklogs />} />

            {/* All roles: own payslips */}
            <Route path="/payroll/my-payslips" element={<MyPayslips />} />

            {/* All roles: documents vault */}
            <Route path="/documents"             element={<Documents />} />

            {/* All roles: search */}
            <Route path="/search"                element={<Search />} />

            {/* All roles: reports (Daily Attendance visible to all) */}
            <Route path="/reports"               element={<Reports />} />

            {/* Admin-only routes */}
            <Route element={<AdminRoute />}>
              <Route path="/organization"        element={<Organization />} />
              <Route path="/payroll/runs"         element={<PayrollRuns />} />
              <Route path="/payroll/runs/:id"     element={<PayrollRunDetail />} />
              <Route path="/payroll/setup"        element={<PayrollSetup />} />
              <Route path="/audit-logs"            element={<AuditLogs />} />
              <Route path="/settings"              element={<Settings />} />
            </Route>
          </Route>
        </Route>

        {/* 404 fallback */}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  );
}
