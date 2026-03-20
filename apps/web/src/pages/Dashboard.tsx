/**
 * Athena V2 - Home Page
 * Notice Board, Quick Actions, and My Team. No stats clutter.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Users, CalendarOff, Receipt, Megaphone, TrendingUp, Plus, Trash2, Loader2, Clock } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge }   from '@/components/ui/badge';
import { Button }  from '@/components/ui/button';
import { Input }   from '@/components/ui/input';
import { Label }   from '@/components/ui/label';
import { useAuth } from '@/hooks/useAuth';
import api         from '@/lib/api';
import { formatDate } from '@/lib/utils';

interface Announcement {
  id:        string;
  title:     string;
  body:      string;
  createdAt: string;
}

interface DashboardData {
  announcements: Announcement[];
}

interface TeamMember {
  userId:      string;
  firstName:   string;
  lastName:    string;
  designation: string;
  employeeId:  string;
}

interface TeamInfo {
  department: string | null;
  count:      number;
  members:    TeamMember[];
}

export default function Dashboard() {
  const { user }                = useAuth();
  const queryClient             = useQueryClient();

  // Announcement management (admin only)
  const [showAdd, setShowAdd]   = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newBody, setNewBody]   = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const isAdmin = user?.role === 'ADMIN';

  const statsQuery = useQuery({
    queryKey: ['dashboard-stats'],
    queryFn: () => api.get<DashboardData>('/dashboard/stats').then((r) => r.data),
  });

  const teamQuery = useQuery({
    queryKey: ['dashboard-team'],
    queryFn: () => api.get<TeamInfo>('/dashboard/team').then((r) => r.data),
  });

  const announcements = statsQuery.data?.announcements ?? [];
  const team          = teamQuery.data ?? null;
  const loading       = statsQuery.isLoading || teamQuery.isLoading;

  const handlePost = async () => {
    if (!newTitle.trim() || !newBody.trim()) return;
    setSubmitting(true);
    try {
      await api.post('/announcements', { title: newTitle.trim(), body: newBody.trim() });
      await queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
      setNewTitle('');
      setNewBody('');
      setShowAdd(false);
      toast.success('Announcement posted');
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to post announcement');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      await api.delete(`/announcements/${id}`);
      await queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
      toast.success('Announcement removed');
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to remove');
    } finally {
      setDeletingId(null);
    }
  };

  const today = new Date().toLocaleDateString('en-IN', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          Welcome back, {user?.firstName} 👋
        </h1>
        <p className="text-muted-foreground text-sm mt-1">{today}</p>
      </div>

      {/* Quick Actions */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" style={{ color: '#361963' }} />
            <CardTitle className="text-base">Quick Actions</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Link to="/leaves" className="flex flex-col items-center gap-2 p-4 border rounded-xl hover:bg-muted/50 transition-colors text-center">
              <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ backgroundColor: '#FD8C2720' }}>
                <CalendarOff className="h-5 w-5" style={{ color: '#FD8C27' }} />
              </div>
              <span className="text-sm font-medium">Apply Leave</span>
            </Link>
            <Link to="/claims" className="flex flex-col items-center gap-2 p-4 border rounded-xl hover:bg-muted/50 transition-colors text-center">
              <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ backgroundColor: '#36196320' }}>
                <Receipt className="h-5 w-5" style={{ color: '#361963' }} />
              </div>
              <span className="text-sm font-medium">File Claim</span>
            </Link>
            <Link to="/profile" className="flex flex-col items-center gap-2 p-4 border rounded-xl hover:bg-muted/50 transition-colors text-center">
              <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ backgroundColor: '#36196320' }}>
                <Users className="h-5 w-5" style={{ color: '#361963' }} />
              </div>
              <span className="text-sm font-medium">My Profile</span>
            </Link>
            {(user?.role === 'ADMIN' || user?.role === 'MANAGER') && (
              <Link to="/leaves" className="flex flex-col items-center gap-2 p-4 border rounded-xl hover:bg-muted/50 transition-colors text-center">
                <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ backgroundColor: '#FD8C2720' }}>
                  <Clock className="h-5 w-5" style={{ color: '#FD8C27' }} />
                </div>
                <span className="text-sm font-medium">Review Pending</span>
              </Link>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Notice Board */}
      {(loading || announcements.length > 0 || isAdmin) && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Megaphone className="h-5 w-5" style={{ color: '#361963' }} />
                <CardTitle className="text-base">Notice Board</CardTitle>
              </div>
              {isAdmin && (
                <Button size="sm" variant="outline" onClick={() => setShowAdd((v) => !v)}>
                  <Plus className="h-4 w-4 mr-1" />
                  Post
                </Button>
              )}
            </div>
            <CardDescription>Company-wide announcements</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* Admin post form */}
            {isAdmin && showAdd && (
              <div className="border rounded-xl p-4 bg-muted/20 space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="ann-title">Title</Label>
                  <Input id="ann-title" placeholder="e.g. Office closed on Friday" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ann-body">Message</Label>
                  <textarea
                    id="ann-body" rows={3}
                    placeholder="Write the announcement..."
                    value={newBody} onChange={(e) => setNewBody(e.target.value)}
                    className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>
                <div className="flex gap-2">
                  <Button size="sm" disabled={submitting || !newTitle.trim() || !newBody.trim()} style={{ backgroundColor: '#361963' }} className="text-white" onClick={handlePost}>
                    {submitting && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
                    Post
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => { setShowAdd(false); setNewTitle(''); setNewBody(''); }}>Cancel</Button>
                </div>
              </div>
            )}

            {loading && (
              <div className="space-y-2">
                {[1, 2].map((i) => (
                  <div key={i} className="h-16 rounded-xl bg-muted animate-pulse" />
                ))}
              </div>
            )}

            {!loading && announcements.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-6">No announcements yet.</p>
            )}

            {!loading && announcements.map((a) => (
              <div key={a.id} className="flex gap-3 p-3 bg-muted/40 rounded-xl border">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <p className="text-sm font-semibold">{a.title}</p>
                    <Badge variant="secondary" className="text-xs shrink-0">New</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">{a.body}</p>
                  <p className="text-xs text-muted-foreground mt-1.5">{formatDate(a.createdAt)}</p>
                </div>
                {isAdmin && (
                  <button
                    className="text-muted-foreground hover:text-destructive transition-colors flex-shrink-0 self-start mt-0.5"
                    disabled={deletingId === a.id}
                    onClick={() => handleDelete(a.id)}
                  >
                    {deletingId === a.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  </button>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* My Team */}
      {team && team.department && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users className="h-5 w-5" style={{ color: '#361963' }} />
                <CardTitle className="text-base">My Team</CardTitle>
              </div>
              <Badge variant="secondary" className="text-xs font-medium">{team.department}</Badge>
            </div>
            <CardDescription>{team.count} {team.count === 1 ? 'member' : 'members'} in your department</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2 sm:grid-cols-2">
              {team.members.map((m) => {
                const initials = `${m.firstName[0] ?? ''}${m.lastName[0] ?? ''}`.toUpperCase();
                const isMe = m.userId === user?.id;
                return (
                  <div key={m.userId} className={`flex items-center gap-3 p-3 rounded-xl border ${isMe ? 'bg-muted/60 border-[#361963]/20' : 'bg-muted/20'}`}>
                    <div className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0" style={{ backgroundColor: isMe ? '#361963' : '#FD8C27' }}>
                      {initials}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">
                        {m.firstName} {m.lastName}
                        {isMe && <span className="text-xs text-muted-foreground ml-1">(You)</span>}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">{m.designation || m.employeeId}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
