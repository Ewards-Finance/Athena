/**
 * Athena V2 - Notification Panel
 * Dropdown triggered by the bell icon in the top bar.
 * Polls for unread count every 30s. Shows latest 30 notifications.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bell,
  CheckCheck,
  CalendarDays,
  Receipt,
  Info,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge }  from '@/components/ui/badge';
import { cn }     from '@/lib/utils';
import api        from '@/lib/api';

interface Notification {
  id:        string;
  type:      string;
  title:     string;
  message:   string;
  isRead:    boolean;
  link?:     string;
  createdAt: string;
}

// Map notification type to an icon
function NotifIcon({ type }: { type: string }) {
  if (type.startsWith('LEAVE'))  return <CalendarDays className="h-4 w-4 text-blue-500 flex-shrink-0" />;
  if (type.startsWith('CLAIM'))  return <Receipt       className="h-4 w-4 text-orange-500 flex-shrink-0" />;
  return                                <Info           className="h-4 w-4 text-gray-400 flex-shrink-0" />;
}

// Simple "X time ago" formatter
function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins  = Math.floor(diff / 60_000);
  if (mins < 1)   return 'just now';
  if (mins < 60)  return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs  < 24)  return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export default function NotificationPanel() {
  const navigate = useNavigate();

  const [open,          setOpen]          = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount,   setUnreadCount]   = useState(0);
  const [loading,       setLoading]       = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Fetch unread count (used for the badge, polled every 30s)
  const fetchUnreadCount = useCallback(async () => {
    try {
      const { data } = await api.get<{ count: number }>('/notifications/unread-count');
      setUnreadCount(data.count);
    } catch {
      // silently ignore — badge just won't update
    }
  }, []);

  // Fetch full notification list (only when panel is opened)
  const fetchNotifications = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get<Notification[]>('/notifications');
      setNotifications(data);
      // Re-derive unread count from fresh data
      setUnreadCount(data.filter((n) => !n.isRead).length);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  // Poll unread count every 30 seconds
  useEffect(() => {
    fetchUnreadCount();
    const interval = setInterval(fetchUnreadCount, 30_000);
    return () => clearInterval(interval);
  }, [fetchUnreadCount]);

  // Load notifications when panel opens
  useEffect(() => {
    if (open) fetchNotifications();
  }, [open, fetchNotifications]);

  // Close panel when clicking outside
  useEffect(() => {
    function handleOutsideClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [open]);

  const markAllRead = async () => {
    try {
      await api.patch('/notifications/read-all');
      setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
      setUnreadCount(0);
    } catch {
      // ignore
    }
  };

  const handleNotifClick = async (notif: Notification) => {
    // Mark as read if not already
    if (!notif.isRead) {
      try {
        await api.patch(`/notifications/${notif.id}/read`);
        setNotifications((prev) =>
          prev.map((n) => n.id === notif.id ? { ...n, isRead: true } : n)
        );
        setUnreadCount((c) => Math.max(0, c - 1));
      } catch {
        // ignore
      }
    }
    // Navigate to the linked page
    if (notif.link) {
      setOpen(false);
      navigate(notif.link);
    }
  };

  return (
    <div ref={panelRef} className="relative">
      {/* Bell Button */}
      <Button
        variant="ghost"
        size="icon"
        className="relative text-muted-foreground hover:text-foreground"
        onClick={() => setOpen((o) => !o)}
        aria-label="Notifications"
      >
        <Bell className="h-4 w-4" />
        {unreadCount > 0 && (
          <span
            className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold text-white"
            style={{ backgroundColor: '#FD8C27' }}
          >
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </Button>

      {/* Dropdown Panel */}
      {open && (
        <div className="absolute right-0 top-10 w-80 rounded-xl border bg-white shadow-lg z-50 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm text-gray-900">Notifications</span>
              {unreadCount > 0 && (
                <Badge variant="secondary" className="text-xs px-1.5 py-0 h-4">
                  {unreadCount} new
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-1">
              {unreadCount > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs text-muted-foreground gap-1 px-2"
                  onClick={markAllRead}
                  title="Mark all as read"
                >
                  <CheckCheck className="h-3.5 w-3.5" />
                  Mark all read
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground"
                onClick={() => setOpen(false)}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          {/* Notification List */}
          <div className="max-h-[420px] overflow-y-auto divide-y">
            {loading && (
              <div className="py-8 text-center text-sm text-muted-foreground">
                Loading...
              </div>
            )}

            {!loading && notifications.length === 0 && (
              <div className="py-10 text-center">
                <Bell className="h-8 w-8 mx-auto mb-2 text-gray-200" />
                <p className="text-sm text-muted-foreground">No notifications yet</p>
              </div>
            )}

            {!loading && notifications.map((notif) => (
              <button
                key={notif.id}
                className={cn(
                  'w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors flex gap-3 items-start',
                  !notif.isRead && 'bg-blue-50/40'
                )}
                onClick={() => handleNotifClick(notif)}
              >
                {/* Unread dot */}
                <div className="mt-1 flex-shrink-0 w-2 h-2 rounded-full mt-2"
                     style={{ backgroundColor: notif.isRead ? 'transparent' : '#FD8C27' }} />

                <NotifIcon type={notif.type} />

                <div className="flex-1 min-w-0">
                  <p className={cn(
                    'text-sm leading-snug',
                    notif.isRead ? 'text-gray-600 font-normal' : 'text-gray-900 font-medium'
                  )}>
                    {notif.title}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5 leading-snug line-clamp-2">
                    {notif.message}
                  </p>
                  <p className="text-[11px] text-gray-400 mt-1">
                    {timeAgo(notif.createdAt)}
                  </p>
                </div>
              </button>
            ))}
          </div>

          {/* Footer */}
          {notifications.length > 0 && (
            <div className="px-4 py-2 border-t text-center">
              <p className="text-xs text-muted-foreground">Showing latest {notifications.length} notifications</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
