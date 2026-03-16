import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

// Shadcn UI utility: merges Tailwind class names intelligently
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Format a date string to readable format (e.g. "15 Jan 2026")
export function formatDate(date: string | Date): string {
  return new Date(date).toLocaleDateString('en-IN', {
    day:   '2-digit',
    month: 'short',
    year:  'numeric',
  });
}

// Format currency in INR
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style:    'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount);
}

// Map leave status to a display badge color
export function leaveStatusColor(status: string): string {
  const map: Record<string, string> = {
    PENDING:   'bg-yellow-100 text-yellow-800',
    APPROVED:  'bg-green-100 text-green-800',
    REJECTED:  'bg-red-100 text-red-800',
    CANCELLED: 'bg-gray-100 text-gray-600',
  };
  return map[status] || 'bg-gray-100 text-gray-600';
}

// Resolve a server-relative upload path to an absolute URL.
// In production, VITE_API_URL points to the Render backend (e.g. https://athena-api.onrender.com/api).
// We strip the trailing /api to get the base host, then prepend it to the /uploads path.
export function resolveUploadUrl(path: string): string {
  if (!path.startsWith('/uploads')) return path;
  const base = (import.meta.env.VITE_API_URL ?? '').replace(/\/api$/, '');
  return `${base}${path}`;
}

// Map claim status to a display badge color
export function claimStatusColor(status: string): string {
  const map: Record<string, string> = {
    PENDING:  'bg-yellow-100 text-yellow-800',
    APPROVED: 'bg-blue-100 text-blue-800',
    PAID:     'bg-green-100 text-green-800',
    REJECTED: 'bg-red-100 text-red-800',
  };
  return map[status] || 'bg-gray-100 text-gray-600';
}
