/**
 * Athena V2 - App Layout
 * Contains the Sidebar navigation + main content area.
 * Sidebar items shown depend on user role (RBAC).
 * On mobile: sidebar is hidden by default, toggled via hamburger button.
 * On desktop: sidebar is always visible.
 */

import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  Home,
  User,
  CalendarDays,
  Receipt,
  Building2,
  LogOut,
  ChevronRight,
  Palmtree,
  Banknote,
  FileSpreadsheet,
  Clock,
  NotebookPen,
  Menu,
  X,
  ShieldCheck,
  Settings2,
  BarChart2,
  FolderOpen,
  Search,
  ScrollText,
  ArrowLeftRight,
  UserMinus,
  Package,
  Landmark,
  CalendarPlus,
} from 'lucide-react';
import { useAuth }            from '@/hooks/useAuth';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { cn }                 from '@/lib/utils';
import NotificationPanel      from '@/components/NotificationPanel';

// Navigation items definition — each item specifies required roles
const navItems = [
  {
    label: 'Home',
    to:    '/dashboard',
    icon:  Home,
    roles: ['OWNER', 'ADMIN', 'MANAGER', 'EMPLOYEE'] as const,
  },
  {
    label: 'My Profile',
    to:    '/profile',
    icon:  User,
    roles: ['OWNER', 'ADMIN', 'MANAGER', 'EMPLOYEE'] as const,
  },
  {
    label: 'Leaves',
    to:    '/leaves',
    icon:  CalendarDays,
    roles: ['OWNER', 'ADMIN', 'MANAGER', 'EMPLOYEE'] as const,
  },
  {
    label: 'Claims',
    to:    '/claims',
    icon:  Receipt,
    roles: ['OWNER', 'ADMIN', 'MANAGER', 'EMPLOYEE'] as const,
  },
  {
    label: 'Loans',
    to:    '/loans',
    icon:  Landmark,
    roles: ['OWNER', 'ADMIN', 'MANAGER', 'EMPLOYEE'] as const,
  },
  {
    label: 'Comp-Off',
    to:    '/compoff',
    icon:  CalendarPlus,
    roles: ['OWNER', 'ADMIN', 'MANAGER', 'EMPLOYEE'] as const,
  },
  {
    label: 'Holidays',
    to:    '/holidays',
    icon:  Palmtree,
    roles: ['OWNER', 'ADMIN', 'MANAGER', 'EMPLOYEE'] as const,
  },
  {
    label: 'Attendance',
    to:    '/attendance',
    icon:  Clock,
    roles: ['OWNER', 'ADMIN', 'MANAGER', 'EMPLOYEE'] as const,
  },
  {
    label: 'Worklogs',
    to:    '/worklogs',
    icon:  NotebookPen,
    roles: ['OWNER', 'ADMIN', 'MANAGER', 'EMPLOYEE'] as const,
  },
  {
    label: 'Companies',
    to:    '/companies',
    icon:  Building2,
    roles: ['OWNER', 'ADMIN'] as const,
  },
  {
    label: 'Organization',
    to:    '/organization',
    icon:  ArrowLeftRight,
    roles: ['OWNER', 'ADMIN'] as const,
  },
  {
    label: 'Payroll',
    to:    '/payroll/runs',
    icon:  Banknote,
    roles: ['OWNER', 'ADMIN'] as const,
  },
  {
    label: 'Exit Management',
    to:    '/exit',
    icon:  UserMinus,
    roles: ['OWNER', 'ADMIN'] as const,
  },
  {
    label: 'Assets',
    to:    '/assets',
    icon:  Package,
    roles: ['OWNER', 'ADMIN', 'MANAGER', 'EMPLOYEE'] as const,
  },
  {
    label: 'Policies',
    to:    '/policies',
    icon:  ScrollText,
    roles: ['OWNER'] as const,
  },
  {
    label: 'Reports',
    to:    '/reports',
    icon:  BarChart2,
    roles: ['OWNER', 'ADMIN', 'MANAGER', 'EMPLOYEE'] as const,
  },
  {
    label: 'Search',
    to:    '/search',
    icon:  Search,
    roles: ['OWNER', 'ADMIN', 'MANAGER', 'EMPLOYEE'] as const,
  },
  {
    label: 'Documents',
    to:    '/documents',
    icon:  FolderOpen,
    roles: ['OWNER', 'ADMIN', 'MANAGER', 'EMPLOYEE'] as const,
  },
  {
    label: 'Audit Logs',
    to:    '/audit-logs',
    icon:  ShieldCheck,
    roles: ['OWNER', 'ADMIN'] as const,
  },
  {
    label: 'Settings',
    to:    '/settings',
    icon:  Settings2,
    roles: ['OWNER', 'ADMIN'] as const,
  },
  {
    label: 'My Payslips',
    to:    '/payroll/my-payslips',
    icon:  FileSpreadsheet,
    roles: ['MANAGER', 'EMPLOYEE'] as const,
  },
];

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate          = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const closeSidebar = () => setSidebarOpen(false);

  // Get initials for avatar fallback (e.g. "Arjun Sharma" -> "AS")
  const initials = user
    ? `${user.firstName?.[0] ?? ''}${user.lastName?.[0] ?? ''}`.toUpperCase()
    : '??';

  // Filter nav items based on user's role
  const visibleNavItems = navItems.filter(
    (item) => user && (item.roles as readonly string[]).includes(user.role)
  );

  return (
    <div className="flex h-screen bg-background overflow-hidden">

      {/* ---- MOBILE BACKDROP (tap outside to close sidebar) ---- */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 md:hidden"
          onClick={closeSidebar}
        />
      )}

      {/* ---- SIDEBAR ---- */}
      {/*
        Mobile:  fixed overlay, slides in/out from the left (z-50, on top of content)
        Desktop: normal flex item, always visible
      */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 w-64 flex flex-col transition-transform duration-300 ease-in-out',
          'md:relative md:translate-x-0 md:z-auto',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        )}
        style={{ backgroundColor: '#361963' }}
      >
        {/* Brand header */}
        <div
          className="flex items-center gap-3 px-6 py-5"
          style={{ borderBottom: '1px solid rgba(255,255,255,0.12)' }}
        >
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: '#FD8C27' }}
          >
            <span className="text-white font-bold text-base">A</span>
          </div>
          <div className="flex-1">
            <p className="font-bold text-sm text-white leading-tight">Athena</p>
            <p className="text-xs" style={{ color: 'rgba(255,255,255,0.55)' }}>Ewards</p>
          </div>
          {/* Close button — mobile only */}
          <button
            className="md:hidden text-white/60 hover:text-white p-1"
            onClick={closeSidebar}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
          {visibleNavItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={closeSidebar}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150',
                  isActive
                    ? 'text-white shadow-sm'
                    : 'hover:bg-white/10'
                )
              }
              style={({ isActive }) =>
                isActive
                  ? { backgroundColor: '#FD8C27' }
                  : { color: 'rgba(255,255,255,0.75)' }
              }
            >
              {({ isActive }) => (
                <>
                  <item.icon className="h-4 w-4 flex-shrink-0" />
                  <span className="flex-1">{item.label}</span>
                  {isActive && <ChevronRight className="h-3 w-3 opacity-70" />}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <div style={{ borderTop: '1px solid rgba(255,255,255,0.12)' }} />

        {/* User profile section */}
        <div className="p-4">
          <div className="flex items-center gap-3 mb-3">
            <Avatar className="h-8 w-8">
              <AvatarFallback
                className="text-xs text-white font-semibold"
                style={{ backgroundColor: '#FD8C27' }}
              >
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white truncate">
                {user?.firstName} {user?.lastName}
              </p>
              <p className="text-xs truncate capitalize" style={{ color: 'rgba(255,255,255,0.55)' }}>
                {user?.role?.toLowerCase()}
              </p>
            </div>
          </div>
          <button
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-all duration-150 hover:bg-white/10"
            style={{ color: 'rgba(255,255,255,0.65)' }}
            onClick={handleLogout}
          >
            <LogOut className="h-4 w-4" />
            Sign Out
          </button>
        </div>
      </aside>

      {/* ---- MAIN CONTENT ---- */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">

        {/* Top bar */}
        <header className="h-14 border-b bg-white flex items-center justify-between px-4 md:px-6 flex-shrink-0 shadow-sm">
          {/* Hamburger — mobile only */}
          <button
            className="md:hidden p-2 rounded-md hover:bg-gray-100 transition-colors"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </button>
          {/* Spacer on desktop */}
          <div className="hidden md:block" />

          <div className="flex items-center gap-3">
            <NotificationPanel />
            {user?.employeeId && (
              <span
                className="font-mono text-xs px-2 py-1 rounded-md font-medium text-white"
                style={{ backgroundColor: '#361963' }}
              >
                {user.employeeId}
              </span>
            )}
          </div>
        </header>

        {/* Page content — scrollable, less padding on mobile */}
        <main className="flex-1 overflow-y-auto p-3 md:p-6 bg-gray-50/50">
          <Outlet />
        </main>

      </div>
    </div>
  );
}
