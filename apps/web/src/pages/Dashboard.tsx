/**
 * Athena V2 - Dashboard Page
 * Shows Stat Cards: Total Employees, Pending Approvals, Today's Leaves, Pending Claims.
 * Also shows the Announcements notice board.
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Users, Clock, CalendarOff, Receipt, Megaphone, TrendingUp, Plus, Trash2, Loader2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge }   from '@/components/ui/badge';
import { Button }  from '@/components/ui/button';
import { Input }   from '@/components/ui/input';
import { Label }   from '@/components/ui/label';
import { useAuth } from '@/hooks/useAuth';
import api         from '@/lib/api';
import { formatDate } from '@/lib/utils';

interface DashboardStats {
  totalEmployees: number;
  pendingLeaves:  number;
  todaysLeaves:   number;
  pendingClaims:  number;
  announcements:  Announcement[];
}

interface Announcement {
  id:        string;
  title:     string;
  body:      string;
  createdAt: string;
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

// Individual stat card component
function StatCard({
  label,
  value,
  icon: Icon,
  description,
  colorClass,
}: {
  label:       string;
  value:       number | string;
  icon:        React.ElementType;
  description: string;
  colorClass:  string;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
        <div className={`p-2 rounded-md ${colorClass}`}>
          <Icon className="h-4 w-4 text-white" />
        </div>
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-bold">{value}</div>
        <p className="text-xs text-muted-foreground mt-1">{description}</p>
      </CardContent>
    </Card>
  );
}

export default function Dashboard() {
  const { user }                          = useAuth();
  const [stats, setStats]                 = useState<DashboardStats | null>(null);
  const [loading, setLoading]             = useState(true);
  const [error, setError]                 = useState('');
  const [team, setTeam]                   = useState<TeamInfo | null>(null);

  // Announcement management (admin only)
  const [showAddAnnouncement, setShowAddAnnouncement] = useState(false);
  const [newTitle, setNewTitle]     = useState('');
  const [newBody, setNewBody]       = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const isAdmin = user?.role === 'ADMIN';

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const [statsRes, teamRes] = await Promise.all([
          api.get<DashboardStats>('/dashboard/stats'),
          api.get<TeamInfo>('/dashboard/team'),
        ]);
        setStats(statsRes.data);
        setTeam(teamRes.data);
      } catch (err) {
        setError('Failed to load dashboard data. Is the API running?');
      } finally {
        setLoading(false);
      }
    };

    fetchStats();
  }, []);

  const handlePostAnnouncement = async () => {
    if (!newTitle.trim() || !newBody.trim()) return;
    setSubmitting(true);
    try {
      await api.post('/announcements', { title: newTitle.trim(), body: newBody.trim() });
      setNewTitle('');
      setNewBody('');
      setShowAddAnnouncement(false);
      const { data } = await api.get<DashboardStats>('/dashboard/stats');
      setStats(data);
    } catch (err: any) {
      alert(err?.response?.data?.error || 'Failed to post announcement');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteAnnouncement = async (id: string) => {
    setDeletingId(id);
    try {
      await api.delete(`/announcements/${id}`);
      setStats((prev) =>
        prev ? { ...prev, announcements: prev.announcements.filter((a) => a.id !== id) } : prev
      );
    } catch (err: any) {
      alert(err?.response?.data?.error || 'Failed to remove announcement');
    } finally {
      setDeletingId(null);
    }
  };

  const today = new Date().toLocaleDateString('en-IN', {
    weekday: 'long',
    year:    'numeric',
    month:   'long',
    day:     'numeric',
  });

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          Welcome back, {user?.firstName}
        </h1>
        <p className="text-muted-foreground text-sm mt-1">{today}</p>
      </div>

      {/* Error state */}
      {error && (
        <div className="bg-destructive/10 border border-destructive/20 text-destructive rounded-md px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="animate-pulse">
              <CardHeader className="pb-2">
                <div className="h-4 w-32 bg-muted rounded" />
              </CardHeader>
              <CardContent>
                <div className="h-8 w-16 bg-muted rounded mb-2" />
                <div className="h-3 w-24 bg-muted rounded" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Stat Cards */}
      {stats && !loading && (
        <>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Total Employees"
              value={stats.totalEmployees}
              icon={Users}
              description="Active employees in the system"
              colorClass="bg-[#361963]"
            />
            <StatCard
              label="Pending Approvals"
              value={stats.pendingLeaves}
              icon={Clock}
              description={user?.role === 'EMPLOYEE' ? 'Your pending leave requests' : 'Leaves awaiting your review'}
              colorClass="bg-[#FD8C27]"
            />
            <StatCard
              label="On Leave Today"
              value={stats.todaysLeaves}
              icon={CalendarOff}
              description="Employees on approved leave"
              colorClass="bg-rose-500"
            />
            <StatCard
              label="Pending Claims"
              value={stats.pendingClaims}
              icon={Receipt}
              description={user?.role === 'EMPLOYEE' ? 'Your pending reimbursements' : 'Claims awaiting processing'}
              colorClass="bg-violet-600"
            />
          </div>

          {/* Notice Board / Announcements — view for all, edit for ADMIN */}
          {(stats.announcements.length > 0 || isAdmin) && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Megaphone className="h-5 w-5 text-primary" />
                    <CardTitle className="text-lg">Notice Board</CardTitle>
                  </div>
                  {isAdmin && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setShowAddAnnouncement((v) => !v)}
                    >
                      <Plus className="h-4 w-4 mr-1" />
                      Post
                    </Button>
                  )}
                </div>
                <CardDescription>Company-wide announcements</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">

                {/* Admin: post new announcement form */}
                {isAdmin && showAddAnnouncement && (
                  <div className="border rounded-lg p-4 bg-muted/20 space-y-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="ann-title">Title</Label>
                      <Input
                        id="ann-title"
                        placeholder="e.g. Office closed on Friday"
                        value={newTitle}
                        onChange={(e) => setNewTitle(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="ann-body">Message</Label>
                      <textarea
                        id="ann-body"
                        rows={3}
                        placeholder="Write the announcement details..."
                        value={newBody}
                        onChange={(e) => setNewBody(e.target.value)}
                        className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      />
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        disabled={submitting || !newTitle.trim() || !newBody.trim()}
                        style={{ backgroundColor: '#361963' }}
                        className="text-white"
                        onClick={handlePostAnnouncement}
                      >
                        {submitting && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
                        Post Announcement
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => { setShowAddAnnouncement(false); setNewTitle(''); setNewBody(''); }}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}

                {/* Announcement list */}
                {stats.announcements.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    No announcements yet. Post one using the button above.
                  </p>
                ) : (
                  stats.announcements.map((announcement) => (
                    <div
                      key={announcement.id}
                      className="flex gap-3 p-3 bg-muted/50 rounded-lg border"
                    >
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <p className="text-sm font-semibold">{announcement.title}</p>
                          <Badge variant="secondary" className="text-xs">New</Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">{announcement.body}</p>
                        <p className="text-xs text-muted-foreground mt-2">
                          Posted on {formatDate(announcement.createdAt)}
                        </p>
                      </div>
                      {isAdmin && (
                        <button
                          className="text-muted-foreground hover:text-destructive transition-colors flex-shrink-0 self-start mt-0.5"
                          disabled={deletingId === announcement.id}
                          onClick={() => handleDeleteAnnouncement(announcement.id)}
                          title="Remove announcement"
                        >
                          {deletingId === announcement.id
                            ? <Loader2 className="h-4 w-4 animate-spin" />
                            : <Trash2 className="h-4 w-4" />}
                        </button>
                      )}
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          )}

          {/* Quick links section */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-primary" />
                <CardTitle className="text-lg">Quick Actions</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Link
                  to="/leaves"
                  className="flex flex-col items-center gap-2 p-4 border rounded-lg hover:bg-secondary transition-colors cursor-pointer text-center"
                >
                  <CalendarOff className="h-6 w-6" style={{ color: '#FD8C27' }} />
                  <span className="text-sm font-medium">Apply Leave</span>
                </Link>
                <Link
                  to="/claims"
                  className="flex flex-col items-center gap-2 p-4 border rounded-lg hover:bg-secondary transition-colors cursor-pointer text-center"
                >
                  <Receipt className="h-6 w-6" style={{ color: '#361963' }} />
                  <span className="text-sm font-medium">File Claim</span>
                </Link>
                <Link
                  to="/profile"
                  className="flex flex-col items-center gap-2 p-4 border rounded-lg hover:bg-secondary transition-colors cursor-pointer text-center"
                >
                  <Users className="h-6 w-6" style={{ color: '#361963' }} />
                  <span className="text-sm font-medium">My Profile</span>
                </Link>
                {(user?.role === 'ADMIN' || user?.role === 'MANAGER') && (
                  <Link
                    to="/leaves"
                    className="flex flex-col items-center gap-2 p-4 border rounded-lg hover:bg-secondary transition-colors cursor-pointer text-center"
                  >
                    <Clock className="h-6 w-6" style={{ color: '#FD8C27' }} />
                    <span className="text-sm font-medium">Review Pending</span>
                  </Link>
                )}
              </div>
            </CardContent>
          </Card>

          {/* My Team card — visible when user has a department */}
          {team && team.department && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Users className="h-5 w-5 text-primary" />
                    <CardTitle className="text-lg">My Team</CardTitle>
                  </div>
                  <Badge variant="secondary" className="text-xs font-medium">
                    {team.department}
                  </Badge>
                </div>
                <CardDescription>
                  {team.count} {team.count === 1 ? 'member' : 'members'} in your department
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-2 sm:grid-cols-2">
                  {team.members.map((member) => {
                    const initials = `${member.firstName[0] ?? ''}${member.lastName[0] ?? ''}`.toUpperCase();
                    const isMe = member.userId === user?.id;
                    return (
                      <div
                        key={member.userId}
                        className={`flex items-center gap-3 p-3 rounded-lg border ${isMe ? 'bg-muted/60 border-primary/30' : 'bg-muted/20'}`}
                      >
                        {/* Initials avatar */}
                        <div
                          className="flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold"
                          style={{ backgroundColor: isMe ? '#361963' : '#FD8C27' }}
                        >
                          {initials}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">
                            {member.firstName} {member.lastName}
                            {isMe && <span className="text-xs text-muted-foreground ml-1">(You)</span>}
                          </p>
                          <p className="text-xs text-muted-foreground truncate">
                            {member.designation || member.employeeId}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
