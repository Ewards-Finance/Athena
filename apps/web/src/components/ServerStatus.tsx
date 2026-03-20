/**
 * ServerStatus — pings /api/health on app init.
 * Shows a "Connecting to server…" banner if the server doesn't respond within 1.5s.
 * Banner disappears automatically once the server is reachable.
 * This handles Render's cold-start delay gracefully.
 */

import { useEffect, useState } from 'react';
import api from '@/lib/api';

export default function ServerStatus() {
  const [slow, setSlow] = useState(false);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let cancelled = false;

    // Show banner after 1.5s if no response yet
    timer = setTimeout(() => {
      if (!cancelled) setSlow(true);
    }, 1500);

    const ping = async () => {
      try {
        await api.get('/health');
        if (!cancelled) {
          setConnected(true);
          setSlow(false);
        }
      } catch {
        // Server unreachable — keep banner visible; user will retry naturally
        if (!cancelled) setSlow(true);
      } finally {
        clearTimeout(timer);
      }
    };

    ping();

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  // Hide banner once connected or if server was fast
  if (!slow || connected) return null;

  return (
    <div
      className="fixed top-0 left-0 right-0 z-[9999] flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white"
      style={{ backgroundColor: '#361963' }}
    >
      <svg
        className="animate-spin h-4 w-4 flex-shrink-0"
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
      >
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
      </svg>
      Connecting to server, please wait…
    </div>
  );
}
