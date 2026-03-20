/**
 * Athena V2 - Home Page
 * Notice Board, Quick Actions, and My Team. No stats clutter.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Users, CalendarOff, Receipt, Megaphone, TrendingUp, Plus, Trash2, Loader2, Clock, MapPin, AlertTriangle, CheckCircle2, Info } from 'lucide-react';
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

  const isAdmin   = user?.role === 'ADMIN';
  const isManager = user?.role === 'MANAGER' || user?.role === 'ADMIN' || user?.role === 'OWNER';

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

  // Travel proof banner — check if today is a travel day
  const travelProofQuery = useQuery({
    queryKey: ['travel-proof-today'],
    queryFn: () => api.get('/travel-proof/today').then(r => r.data),
  });
  const todayProof: { leaveRequestId: string; proofDate: string; leaveStatus: string; alreadySubmitted: boolean } | null = travelProofQuery.data ?? null;
  const [submittingProof, setSubmittingProof] = useState(false);

  // Manager/Admin: pending TRAVELLING leave approvals
  const pendingTravelQuery = useQuery({
    queryKey: ['pending-travel-leaves'],
    queryFn: () => api.get('/leaves/pending').then(r => r.data),
    enabled: isManager,
  });
  const pendingTravelLeaves = ((pendingTravelQuery.data ?? []) as any[]).filter(
    (l: any) => l.leaveType === 'TRAVELLING'
  );
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectComment, setRejectComment] = useState<Record<string, string>>({});

  const handleTravelApprove = async (id: string) => {
    setApprovingId(id);
    try {
      await api.patch(`/leaves/${id}/approve`);
      toast.success('Travel leave approved');
      queryClient.invalidateQueries({ queryKey: ['pending-travel-leaves'] });
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to approve');
    } finally {
      setApprovingId(null);
    }
  };

  const handleTravelReject = async (id: string) => {
    setRejectingId(id);
    try {
      await api.patch(`/leaves/${id}/reject`, { comment: rejectComment[id] || 'Rejected' });
      toast.success('Travel leave rejected');
      queryClient.invalidateQueries({ queryKey: ['pending-travel-leaves'] });
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to reject');
    } finally {
      setRejectingId(null);
    }
  };

  const submitTravelProof = async (leaveRequestId: string, proofDate: string) => {
    if (!navigator.geolocation) {
      toast.error('Geolocation is not supported by your browser.');
      return;
    }
    setSubmittingProof(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          await api.post('/travel-proof', {
            leaveRequestId,
            proofDate,
            geoLat: pos.coords.latitude,
            geoLng: pos.coords.longitude,
          });
          toast.success('Location proof submitted!');
          queryClient.invalidateQueries({ queryKey: ['travel-proof-today'] });
        } catch (err: any) {
          toast.error(err?.response?.data?.error || 'Failed to submit proof');
        } finally {
          setSubmittingProof(false);
        }
      },
      () => {
        toast.error('Location access is required. Please allow location in your browser settings.');
        setSubmittingProof(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

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

      {/* ── Manager: Pending Travel Approvals ─────────────────────────── */}
      {isManager && pendingTravelLeaves.length > 0 && (
        <Card className="border-red-200 bg-red-50">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-red-600" />
              <CardTitle className="text-sm font-semibold text-red-800">
                Pending Travel Approvals ({pendingTravelLeaves.length})
              </CardTitle>
            </div>
            <p className="text-xs text-red-700 mt-0.5">
              Employees cannot submit location proof until you approve their travelling leave.
            </p>
          </CardHeader>
          <CardContent className="space-y-3 pt-0">
            {pendingTravelLeaves.map((l: any) => {
              const name = l.employee?.profile
                ? `${l.employee.profile.firstName} ${l.employee.profile.lastName}`
                : l.employee?.email;
              const isStartingToday = new Date(l.startDate).toISOString().split('T')[0] === new Date().toISOString().split('T')[0];
              return (
                <div key={l.id} className="bg-white rounded-lg border border-red-100 p-3 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium flex items-center gap-1.5">
                        {name}
                        {isStartingToday && (
                          <Badge className="text-xs bg-red-100 text-red-700 border-red-200">Starts Today</Badge>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(l.startDate)} — {formatDate(l.endDate)} · {l.totalDays} day{l.totalDays !== 1 ? 's' : ''}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5 italic">"{l.reason}"</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      className="h-7 text-xs bg-green-600 hover:bg-green-700 text-white"
                      disabled={approvingId === l.id}
                      onClick={() => handleTravelApprove(l.id)}
                    >
                      {approvingId === l.id ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <CheckCircle2 className="h-3 w-3 mr-1" />}
                      Approve
                    </Button>
                    <input
                      className="flex-1 h-7 text-xs rounded border border-input bg-background px-2"
                      placeholder="Rejection reason (optional)"
                      value={rejectComment[l.id] ?? ''}
                      onChange={e => setRejectComment(prev => ({ ...prev, [l.id]: e.target.value }))}
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs border-red-300 text-red-600 hover:bg-red-50"
                      disabled={rejectingId === l.id}
                      onClick={() => handleTravelReject(l.id)}
                    >
                      {rejectingId === l.id ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                      Reject
                    </Button>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* ── Employee: Travel Proof Banner ──────────────────────────────── */}
      {todayProof && (
        <>
          {/* State 1: Leave is PENDING — waiting for manager approval */}
          {todayProof.leaveStatus === 'PENDING' && (
            <Card className="border-blue-200 bg-blue-50">
              <CardContent className="pt-4">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                    <Info className="h-4 w-4 text-blue-600" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-blue-800">
                      Your travelling leave is pending approval
                    </p>
                    <p className="text-xs text-blue-600 mt-0.5">
                      You can submit location proof once your manager approves the leave. Ask them to check their dashboard.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* State 2: Leave is APPROVED — proof not yet submitted */}
          {todayProof.leaveStatus === 'APPROVED' && !todayProof.alreadySubmitted && (
            <Card className="border-amber-200 bg-amber-50">
              <CardContent className="pt-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
                      <MapPin className="h-4 w-4 text-amber-600" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-amber-800">
                        You are on Travelling leave today — submit your location proof
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Must be submitted before midnight · {formatDate(todayProof.proofDate)}
                      </p>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    className="shrink-0"
                    disabled={submittingProof}
                    onClick={() => submitTravelProof(todayProof.leaveRequestId, todayProof.proofDate)}
                  >
                    {submittingProof ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <MapPin className="h-3 w-3 mr-1" />}
                    Submit Proof
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* State 3: Proof already submitted today */}
          {todayProof.leaveStatus === 'APPROVED' && todayProof.alreadySubmitted && (
            <Card className="border-green-200 bg-green-50">
              <CardContent className="pt-4">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-green-800">
                      Location proof submitted for today ✅
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {formatDate(todayProof.proofDate)} · Your manager has been notified
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}

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
