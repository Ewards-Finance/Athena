/**
 * Athena V2 - Auth State (Zustand Store)
 * Manages login state, user info, and token persistence across the app.
 */

import { create } from 'zustand';
import api from '@/lib/api';

interface AuthUser {
  id:         string;
  email:      string;
  role:       'OWNER' | 'ADMIN' | 'MANAGER' | 'EMPLOYEE';
  firstName?: string;
  lastName?:  string;
  employeeId?: string;
  department?: string;
  employmentType?: string;
}

interface AuthState {
  user:    AuthUser | null;
  token:   string | null;
  isLoading: boolean;
  login:   (email: string, password: string) => Promise<void>;
  logout:  () => void;
  initFromStorage: () => void;
}

// Read localStorage once at module load time (synchronous, before first render)
// This prevents the flash-to-login on page refresh.
function readStoredAuth(): { user: AuthUser | null; token: string | null } {
  const token    = localStorage.getItem('athena_token');
  const userJson = localStorage.getItem('athena_user');
  if (token && userJson) {
    try {
      return { user: JSON.parse(userJson) as AuthUser, token };
    } catch {
      localStorage.removeItem('athena_token');
      localStorage.removeItem('athena_user');
    }
  }
  return { user: null, token: null };
}

export const useAuth = create<AuthState>((set) => ({
  ...readStoredAuth(),
  isLoading: false,

  // No-op kept for backwards compatibility (storage is now read at module init)
  initFromStorage: () => {},

  // Login: calls API, stores token in localStorage for persistence
  login: async (email: string, password: string) => {
    set({ isLoading: true });
    try {
      const { data } = await api.post('/auth/login', { email, password });
      localStorage.setItem('athena_token', data.token);
      localStorage.setItem('athena_user', JSON.stringify(data.user));
      set({ user: data.user, token: data.token, isLoading: false });
    } catch (err) {
      set({ isLoading: false });
      throw err; // Let the calling component handle the error display
    }
  },

  // Logout: clear everything
  logout: () => {
    localStorage.removeItem('athena_token');
    localStorage.removeItem('athena_user');
    set({ user: null, token: null });
  },
}));
