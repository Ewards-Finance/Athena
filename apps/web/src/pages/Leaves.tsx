/**
 * Athena V2 - Leave Management Page
 * Employees apply for leaves; Managers/Admins approve or reject.
 * Admins can also manage leave policies and individual employee quotas.
 */

import { Fragment, useEffect, useState } from 'react';
import { useForm }     from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z }           from 'zod';
import { useAuth }     from '@/hooks/useAuth';
import api             from '@/lib/api';
import { formatDate, leaveStatusColor } from '@/lib/utils';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button }  from '@/components/ui/button';
import { Input }   from '@/components/ui/input';
import { Label }   from '@/components/ui/label';
import { Badge }   from '@/components/ui/badge';
import { Loader2, Plus, Check, X, CalendarDays, ShieldCheck, Settings2, Pencil, Trash2, ArrowLeftRight } from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface LeaveBalance {
  leaveType: string;
  total:     number;
  used:      number;
}

interface TeamOverviewUser {
  id:            string;
  profile?:      { firstName: string; lastName: string; employeeId: string };
  leaveBalances: LeaveBalance[];
}

interface LeavePolicy {
  id:           string;
  leaveType:    string;
  label:        string;
  defaultTotal: number;
  isActive:     boolean;
}

interface LeaveRequest {
  id:            string;
  employeeId:    string;   // User ID of the employee — used to split own vs team requests
  leaveType:     string;
  startDate:     string;
  endDate:       string;
  totalDays:     number;
  reason:        string;
  status:        string;
  managerComment?: string;
  // Half-day fields
  durationType?:  string;
  singleDayType?: string;
  startDayType?:  string;
  endDayType?:    string;
  employee?: {
    profile?: {
      firstName: string;
      lastName:  string;
      employeeId: string;
    };
  };
}

// ─── Form schema ──────────────────────────────────────────────────────────────

const leaveSchema = z.object({
  leaveType:    z.string().min(1, 'Select a leave type'),
  durationType: z.enum(['SINGLE', 'MULTIPLE']),
  // Single-day fields
  singleDate:    z.string().optional(),
  singleDayType: z.enum(['FULL', 'FIRST_HALF', 'SECOND_HALF']).optional(),
  // Multiple-day fields
  startDate:    z.string().optional(),
  startDayType: z.enum(['FULL', 'FROM_SECOND_HALF']).optional(),
  endDate:      z.string().optional(),
  endDayType:   z.enum(['FULL', 'UNTIL_FIRST_HALF']).optional(),
  // Common
  reason: z.string().min(5, 'Reason must be at least 5 characters'),
}).superRefine((data, ctx) => {
  if (data.durationType === 'SINGLE') {
    if (!data.singleDate)
      ctx.addIssue({ code: 'custom', message: 'Date is required', path: ['singleDate'] });
    if (!data.singleDayType)
      ctx.addIssue({ code: 'custom', message: 'Select a session', path: ['singleDayType'] });
  } else {
    if (!data.startDate)
      ctx.addIssue({ code: 'custom', message: 'Start date is required', path: ['startDate'] });
    if (!data.endDate)
      ctx.addIssue({ code: 'custom', message: 'End date is required', path: ['endDate'] });
    if (!data.startDayType)
      ctx.addIssue({ code: 'custom', message: 'Select a session', path: ['startDayType'] });
    if (!data.endDayType)
      ctx.addIssue({ code: 'custom', message: 'Select a session', path: ['endDayType'] });
    if (data.startDate && data.endDate && new Date(data.startDate) > new Date(data.endDate))
      ctx.addIssue({ code: 'custom', message: 'End date must be on or after start date', path: ['endDate'] });
  }
});

type LeaveFormData = z.infer<typeof leaveSchema>;

// ─── Sub-components ───────────────────────────────────────────────────────────

function BalanceBar({ label, total, used }: { label: string; total: number; used: number }) {
  const available = Math.max(total - used, 0);
  const pct       = total > 0 ? Math.min((used / total) * 100, 100) : 0;
  const isLow     = available <= 2 && total > 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium text-muted-foreground">{label}</span>
        <span className={`font-semibold ${isLow ? 'text-rose-600' : 'text-foreground'}`}>
          {available} / {total} left
        </span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, backgroundColor: isLow ? '#ef4444' : '#361963' }}
        />
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function Leaves() {
  const { user } = useAuth();

  // ── Leave requests ──
  const [leaves, setLeaves]         = useState<LeaveRequest[]>([]);
  const [loading, setLoading]       = useState(true);
  const [showForm, setShowForm]     = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // ── Own balance ──
  const [balances, setBalances] = useState<LeaveBalance[]>([]);

  // ── Team overview ──
  const [teamOverview, setTeamOverview] = useState<TeamOverviewUser[]>([]);
  const [showTeam, setShowTeam]         = useState(false);
  const [teamLoading, setTeamLoading]   = useState(false);
  const [teamError, setTeamError]       = useState('');

  // ── Leave policies (admin) ──
  const [policies, setPolicies]         = useState<LeavePolicy[]>([]);
  const [policyDraft, setPolicyDraft]   = useState<LeavePolicy[]>([]);
  const [showPolicy, setShowPolicy]     = useState(false);
  const [savingPolicy, setSavingPolicy] = useState(false);

  // ── Add new leave type (admin) ──
  const [newLT, setNewLT] = useState({ code: '', label: '', days: 0 });

  // ── Individual quota edit (admin) ──
  const [editingUserId, setEditingUserId]   = useState<string | null>(null);
  const [quotaDraft, setQuotaDraft]         = useState<Record<string, number>>({});
  const [savingQuota, setSavingQuota]       = useState(false);

  const { register, handleSubmit, reset, watch, setValue, formState: { errors, isSubmitting } } =
    useForm<LeaveFormData>({
      resolver: zodResolver(leaveSchema),
      defaultValues: { durationType: 'SINGLE', singleDayType: 'FULL', startDayType: 'FULL', endDayType: 'FULL' },
    });

  const durationType = watch('durationType');

  const isManagerOrAdmin = user?.role === 'ADMIN' || user?.role === 'MANAGER';
  const isAdmin          = user?.role === 'ADMIN';

  // ── Fetchers ──

  const fetchLeaves = async () => {
    try {
      const { data } = await api.get<LeaveRequest[]>('/leaves');
      setLeaves(data);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  };

  const fetchBalances = async () => {
    try {
      const { data } = await api.get<LeaveBalance[]>('/leave-balance');
      setBalances(data);
    } catch { /* non-critical */ }
  };

  const fetchTeamOverview = async () => {
    setTeamLoading(true);
    setTeamError('');
    try {
      const { data } = await api.get<TeamOverviewUser[]>('/leave-balance/overview');
      setTeamOverview(data);
    } catch (err: any) {
      setTeamError(String(err?.response?.data?.error || err?.message || 'Failed to load team balances'));
    } finally {
      setTeamLoading(false);
    }
  };

  const fetchPolicies = async () => {
    try {
      const { data } = await api.get<LeavePolicy[]>('/leave-policy');
      setPolicies(data);
      setPolicyDraft(data.map((p) => ({ ...p })));
    } catch { /* non-critical */ }
  };

  useEffect(() => {
    fetchLeaves();
    fetchBalances();
    fetchPolicies();
    // Auto-load team overview for managers
    if (isManagerOrAdmin) {
      setShowTeam(true);
      fetchTeamOverview();
    }
  }, []);

  // ── Leave actions ──

  const onSubmit = async (data: LeaveFormData) => {
    try {
      await api.post('/leaves', data);
      setShowForm(false);
      reset();
      fetchLeaves();
    } catch (err: any) {
      alert(err?.response?.data?.error || 'Failed to apply leave');
    }
  };

  const handleApprove = async (id: string) => {
    setActionLoading(id + '-approve');
    try {
      await api.patch(`/leaves/${id}/approve`, { comment: 'Approved' });
      fetchLeaves();
      fetchBalances();
    } finally {
      setActionLoading(null);
    }
  };

  const handleReject = async (id: string) => {
    const comment = prompt('Reason for rejection (optional):') ?? 'Rejected';
    setActionLoading(id + '-reject');
    try {
      await api.patch(`/leaves/${id}/reject`, { comment });
      fetchLeaves();
    } finally {
      setActionLoading(null);
    }
  };

  const handleWithdraw = async (id: string) => {
    if (!confirm('Withdraw this leave request? This cannot be undone.')) return;
    setActionLoading(id + '-withdraw');
    try {
      await api.delete(`/leaves/${id}`);
      fetchLeaves();
      fetchBalances();
    } catch (err: any) {
      alert(err?.response?.data?.error || 'Failed to withdraw leave request');
    } finally {
      setActionLoading(null);
    }
  };

  const handleChangeType = async (id: string, newType: string) => {
    setActionLoading(id + '-changetype');
    try {
      await api.patch(`/leaves/${id}/change-type`, { leaveType: newType });
      fetchLeaves();
    } catch (err: any) {
      alert(err?.response?.data?.error || 'Failed to change leave type');
    } finally {
      setActionLoading(null);
    }
  };

  // ── Policy actions (admin) ──

  const handleSavePolicy = async () => {
    setSavingPolicy(true);
    try {
      const payload = policyDraft.map(({ id, label, defaultTotal, isActive }) => ({
        id, label, defaultTotal, isActive,
      }));
      const { data } = await api.put<LeavePolicy[]>('/leave-policy', payload);
      setPolicies(data);
      setPolicyDraft(data.map((p) => ({ ...p })));
      // Refresh balances so the balance card reflects any downstream changes
      fetchBalances();
      if (showTeam) fetchTeamOverview();
    } catch (err: any) {
      alert(err?.response?.data?.error || 'Failed to save policy');
    } finally {
      setSavingPolicy(false);
    }
  };

  const handleDeletePolicy = async (id: string, leaveType: string) => {
    if (!confirm(`Delete leave type '${leaveType}'?\n\nExisting leave requests and balances will be preserved, but employees won't be able to apply for this type.`)) return;
    try {
      await api.delete(`/leave-policy/${id}`);
      fetchPolicies();
      fetchBalances();
    } catch (err: any) {
      alert(err?.response?.data?.error || 'Failed to delete leave type');
    }
  };

  const handleAddLeaveType = async () => {
    if (!newLT.code || !newLT.label) {
      alert('Type code and label are required');
      return;
    }
    try {
      await api.post('/leave-policy', {
        leaveType:    newLT.code.toUpperCase(),
        label:        newLT.label,
        defaultTotal: Number(newLT.days),
      });
      fetchPolicies();
      fetchBalances();
      setNewLT({ code: '', label: '', days: 0 });
    } catch (err: any) {
      alert(err?.response?.data?.error || 'Failed to add leave type');
    }
  };

  const handleApplyToAll = async () => {
    if (!confirm(`Apply current policy defaults to ALL employees for ${new Date().getFullYear()}?\n\nThis will update every employee's leave quota to match the policy defaults. Already-used days are preserved.`)) return;
    setSavingPolicy(true);
    try {
      const { data } = await api.post<{ updated: number; employees: number; year: number }>(
        `/leave-policy/apply-all?year=${new Date().getFullYear()}`
      );
      alert(`Done! Updated ${data.updated} balance records across ${data.employees} employees for ${data.year}.`);
      fetchBalances();
      if (showTeam) fetchTeamOverview();
    } catch (err: any) {
      alert(err?.response?.data?.error || 'Failed to apply policy');
    } finally {
      setSavingPolicy(false);
    }
  };

  const updatePolicyDraft = (leaveType: string, field: keyof LeavePolicy, value: any) => {
    setPolicyDraft((prev) =>
      prev.map((p) => (p.leaveType === leaveType ? { ...p, [field]: value } : p))
    );
  };

  // ── Quota edit actions (admin) ──

  const openQuotaEdit = (u: TeamOverviewUser) => {
    const draft: Record<string, number> = {};
    u.leaveBalances.forEach((b) => { draft[b.leaveType] = b.total; });
    setQuotaDraft(draft);
    setEditingUserId(u.id);
  };

  const handleSaveQuota = async (userId: string) => {
    setSavingQuota(true);
    try {
      await api.put(`/leave-balance/${userId}`, {
        year: new Date().getFullYear(),
        ...quotaDraft,
      });
      setEditingUserId(null);
      fetchTeamOverview();
      fetchBalances();
    } catch (err: any) {
      alert(err?.response?.data?.error || 'Failed to save quota');
    } finally {
      setSavingQuota(false);
    }
  };

  // ── Active leave types (from policy, or all if not loaded) ──
  const leaveTypesForForm = policies.length > 0
    ? policies.filter((p) => p.isActive)
    : [
        { leaveType: 'CL', label: 'Casual Leave' },
        { leaveType: 'SL', label: 'Sick Leave' },
        { leaveType: 'EL', label: 'Earned Leave' },
        { leaveType: 'MATERNITY', label: 'Maternity Leave' },
        { leaveType: 'PATERNITY', label: 'Paternity Leave' },
      ];

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6 max-w-5xl">

      {/* ── Header ── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Leave Management</h1>
          <p className="text-muted-foreground text-sm">
            {isManagerOrAdmin ? 'Review and manage team leave requests' : 'Apply and track your leaves'}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {isAdmin && (
            <Button
              variant="outline"
              onClick={() => {
                if (!showPolicy && policies.length === 0) fetchPolicies();
                setShowPolicy((v) => !v);
              }}
            >
              <Settings2 className="h-4 w-4 mr-2" />
              {showPolicy ? 'Hide Policy' : 'Leave Policy'}
            </Button>
          )}
          {isManagerOrAdmin && (
            <Button
              variant="outline"
              onClick={() => {
                if (!showTeam) fetchTeamOverview();
                setShowTeam((v) => !v);
              }}
            >
              <ShieldCheck className="h-4 w-4 mr-2" />
              {showTeam ? 'Hide' : 'Team Balances'}
            </Button>
          )}
          <Button
            onClick={() => setShowForm(!showForm)}
            style={{ backgroundColor: '#361963' }}
            className="text-white"
          >
            <Plus className="h-4 w-4 mr-2" />
            Apply Leave
          </Button>
        </div>
      </div>

      {/* ── Leave Policy Card (Admin only) ── */}
      {isAdmin && showPolicy && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <Settings2 className="h-4 w-4" style={{ color: '#361963' }} />
              <CardTitle className="text-base">Leave Policy Configuration</CardTitle>
            </div>
            <CardDescription>
              Set org-wide default quotas and enable/disable leave categories. Defaults apply when new employee balances are auto-created.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {policyDraft.length === 0 ? (
              <div className="flex justify-center py-4">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="space-y-4">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-muted-foreground text-xs">
                        <th className="text-left pb-2 pr-4 font-medium">Leave Type</th>
                        <th className="text-left pb-2 pr-4 font-medium w-52">Display Label</th>
                        <th className="text-center pb-2 px-4 font-medium w-28">Default Days</th>
                        <th className="text-center pb-2 px-4 font-medium w-20">Active</th>
                        <th className="text-center pb-2 px-4 font-medium w-20">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {policyDraft.map((p) => (
                        <tr key={p.leaveType} className="border-b last:border-0">
                          <td className="py-3 pr-4">
                            <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded bg-muted">
                              {p.leaveType}
                            </span>
                          </td>
                          <td className="py-3 pr-4">
                            <Input
                              value={p.label}
                              onChange={(e) => updatePolicyDraft(p.leaveType, 'label', e.target.value)}
                              className="h-8 text-sm w-48"
                            />
                          </td>
                          <td className="py-3 px-4 text-center">
                            <Input
                              type="number"
                              min={0}
                              value={p.defaultTotal}
                              onChange={(e) =>
                                updatePolicyDraft(p.leaveType, 'defaultTotal', Number(e.target.value))
                              }
                              className="h-8 text-sm w-20 mx-auto text-center"
                            />
                          </td>
                          <td className="py-3 px-4 text-center">
                            <input
                              type="checkbox"
                              checked={p.isActive}
                              onChange={(e) => updatePolicyDraft(p.leaveType, 'isActive', e.target.checked)}
                              className="h-4 w-4 cursor-pointer accent-[#361963]"
                            />
                          </td>
                          <td className="py-3 px-4 text-center">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                              onClick={() => handleDeletePolicy(p.id, p.leaveType)}
                              title={`Delete ${p.leaveType}`}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* ── Add New Leave Type ── */}
                <div className="border rounded-lg p-4 bg-muted/20 space-y-3">
                  <p className="text-xs font-medium text-muted-foreground">Add New Leave Type</p>
                  <div className="flex flex-wrap gap-3 items-end">
                    <div className="space-y-1">
                      <Label className="text-xs">Type Code</Label>
                      <Input
                        placeholder="COMP_OFF"
                        value={newLT.code}
                        onChange={(e) => setNewLT((prev) => ({ ...prev, code: e.target.value }))}
                        className="h-8 text-sm w-32 font-mono"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Label</Label>
                      <Input
                        placeholder="Compensatory Off"
                        value={newLT.label}
                        onChange={(e) => setNewLT((prev) => ({ ...prev, label: e.target.value }))}
                        className="h-8 text-sm w-48"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Days</Label>
                      <Input
                        type="number"
                        min={0}
                        value={newLT.days}
                        onChange={(e) => setNewLT((prev) => ({ ...prev, days: Number(e.target.value) }))}
                        className="h-8 text-sm w-20 text-center"
                      />
                    </div>
                    <Button
                      size="sm"
                      onClick={handleAddLeaveType}
                      style={{ backgroundColor: '#361963' }}
                      className="text-white h-8"
                    >
                      <Plus className="h-3.5 w-3.5 mr-1.5" />
                      Add Type
                    </Button>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 items-center">
                  <Button
                    onClick={handleSavePolicy}
                    disabled={savingPolicy}
                    style={{ backgroundColor: '#361963' }}
                    className="text-white"
                  >
                    {savingPolicy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Save Policy
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setPolicyDraft(policies.map((p) => ({ ...p })))}
                    disabled={savingPolicy}
                  >
                    Reset
                  </Button>
                  <div className="h-5 w-px bg-border mx-1" />
                  <Button
                    variant="outline"
                    onClick={handleApplyToAll}
                    disabled={savingPolicy}
                    className="text-amber-700 border-amber-300 hover:bg-amber-50"
                  >
                    {savingPolicy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Apply Defaults to All Employees
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  "Save Policy" updates the policy config only. "Apply Defaults to All Employees" pushes the current default days to every employee's balance for {new Date().getFullYear()}.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── My Leave Balance Card ── */}
      {balances.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4" style={{ color: '#361963' }} />
              <CardTitle className="text-base">My Leave Balance — {new Date().getFullYear()}</CardTitle>
            </div>
            <CardDescription>Allocated vs used days for this calendar year</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              {policies.map((p) => ({ key: p.leaveType, label: p.label })).map(({ key, label }) => {
                const b = balances.find((x) => x.leaveType === key);
                if (!b) return null;
                return <BalanceBar key={key} label={label} total={b.total} used={b.used} />;
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Team Balances Card (Manager/Admin) ── */}
      {isManagerOrAdmin && showTeam && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4" style={{ color: '#361963' }} />
              <CardTitle className="text-base">Team Leave Balances — {new Date().getFullYear()}</CardTitle>
            </div>
            <CardDescription>
              {isAdmin
                ? 'Remaining days per employee. Click Edit to adjust individual quotas.'
                : 'Remaining days per employee for this calendar year'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {teamLoading ? (
              <div className="flex justify-center py-4">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : teamError ? (
              <p className="text-sm text-destructive py-4 text-center">{teamError}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-muted-foreground text-xs">
                      <th className="text-left pb-2 pr-4 font-medium">Employee</th>
                      {policies.map((p) => p.leaveType).map((lt) => (
                        <th key={lt} className="text-center pb-2 px-2 font-medium">
                          {policies.find((p) => p.leaveType === lt)?.label ?? lt}
                        </th>
                      ))}
                      {isAdmin && <th className="text-center pb-2 px-2 font-medium w-16">Edit</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {teamOverview.map((u) => (
                      <Fragment key={u.id}>
                        {/* ── Employee row ── */}
                        <tr
                          className={`border-b hover:bg-muted/20 ${
                            editingUserId === u.id ? 'bg-muted/30' : ''
                          }`}
                        >
                          <td className="py-2.5 pr-4">
                            <p className="font-medium">
                              {u.profile?.firstName} {u.profile?.lastName}
                            </p>
                            <p className="text-xs text-muted-foreground font-mono">
                              {u.profile?.employeeId}
                            </p>
                          </td>
                          {policies.map((p) => p.leaveType).map((lt) => {
                            const b    = u.leaveBalances.find((x) => x.leaveType === lt);
                            const left = b ? Math.max(b.total - b.used, 0) : 0;
                            const isLow = b && left <= 2 && b.total > 0;
                            return (
                              <td key={lt} className="text-center py-2.5 px-2">
                                <span
                                  className="text-xs font-semibold px-2 py-0.5 rounded-full"
                                  style={{
                                    backgroundColor: isLow ? '#fee2e2' : '#f3f0fa',
                                    color:           isLow ? '#b91c1c' : '#361963',
                                  }}
                                >
                                  {left}/{b?.total ?? 0}
                                </span>
                              </td>
                            );
                          })}
                          {isAdmin && (
                            <td className="text-center py-2.5 px-2">
                              {editingUserId === u.id ? (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 px-2 text-muted-foreground"
                                  onClick={() => setEditingUserId(null)}
                                >
                                  <X className="h-3 w-3" />
                                </Button>
                              ) : (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 px-2"
                                  onClick={() => openQuotaEdit(u)}
                                >
                                  <Pencil className="h-3 w-3" />
                                </Button>
                              )}
                            </td>
                          )}
                        </tr>

                        {/* ── Inline quota editor row (admin only) ── */}
                        {isAdmin && editingUserId === u.id && (
                          <tr key={u.id + '-edit'} className="border-b bg-muted/10">
                            <td className="py-3 pr-4">
                              <p className="text-xs font-medium text-muted-foreground">
                                Set quotas for {u.profile?.firstName}
                              </p>
                            </td>
                            {policies.map((p) => p.leaveType).map((lt) => (
                              <td key={lt} className="py-3 px-2">
                                <Input
                                  type="number"
                                  min={0}
                                  value={quotaDraft[lt] ?? 0}
                                  onChange={(e) =>
                                    setQuotaDraft((prev) => ({ ...prev, [lt]: Number(e.target.value) }))
                                  }
                                  className="h-7 text-xs text-center w-16 mx-auto px-1"
                                />
                              </td>
                            ))}
                            <td className="py-3 px-2 text-center">
                              <Button
                                size="sm"
                                disabled={savingQuota}
                                style={{ backgroundColor: '#361963' }}
                                className="text-white h-7 px-2"
                                onClick={() => handleSaveQuota(u.id)}
                              >
                                {savingQuota
                                  ? <Loader2 className="h-3 w-3 animate-spin" />
                                  : <Check className="h-3 w-3" />}
                              </Button>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Apply Leave Form ── */}
      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">New Leave Application</CardTitle>
            <CardDescription>Submit a leave request for your manager's review</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">

              {/* Row 1 — Leave Type + Duration toggle */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="leaveType">Leave Type</Label>
                  <select
                    id="leaveType"
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    {...register('leaveType')}
                  >
                    <option value="">— Select type —</option>
                    {leaveTypesForForm.map((t) => (
                      <option key={t.leaveType} value={t.leaveType}>{t.label}</option>
                    ))}
                  </select>
                  {errors.leaveType && <p className="text-xs text-destructive">{errors.leaveType.message}</p>}
                </div>

                <div className="space-y-2">
                  <Label>Leave Duration</Label>
                  <div className="flex gap-1 p-1 rounded-lg bg-muted w-fit">
                    {(['SINGLE', 'MULTIPLE'] as const).map((dt) => (
                      <button
                        key={dt}
                        type="button"
                        onClick={() => setValue('durationType', dt, { shouldValidate: true })}
                        className="px-4 py-1.5 rounded-md text-sm font-medium transition-all"
                        style={durationType === dt
                          ? { backgroundColor: '#361963', color: '#fff' }
                          : { color: '#361963' }}
                      >
                        {dt === 'SINGLE' ? 'Single Day' : 'Multiple Days'}
                      </button>
                    ))}
                  </div>
                  {errors.durationType && <p className="text-xs text-destructive">{errors.durationType.message}</p>}
                </div>
              </div>

              {/* Row 2 — Date inputs (conditional on duration type) */}
              {durationType === 'SINGLE' ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="singleDate">Date</Label>
                    <Input id="singleDate" type="date" {...register('singleDate')} />
                    {errors.singleDate && <p className="text-xs text-destructive">{errors.singleDate.message}</p>}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="singleDayType">Session</Label>
                    <select
                      id="singleDayType"
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      {...register('singleDayType')}
                    >
                      <option value="FULL">Full Day</option>
                      <option value="FIRST_HALF">1st Half (Morning)</option>
                      <option value="SECOND_HALF">2nd Half (Afternoon)</option>
                    </select>
                    {errors.singleDayType && <p className="text-xs text-destructive">{errors.singleDayType.message}</p>}
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Start */}
                  <div className="space-y-2">
                    <Label htmlFor="startDate">Start Date</Label>
                    <div className="flex gap-2">
                      <Input id="startDate" type="date" className="flex-1" {...register('startDate')} />
                      <select
                        className="flex h-10 rounded-md border border-input bg-background px-2 py-2 text-sm w-44"
                        {...register('startDayType')}
                      >
                        <option value="FULL">Full Day</option>
                        <option value="FROM_SECOND_HALF">From 2nd Half</option>
                      </select>
                    </div>
                    {(errors.startDate || errors.startDayType) && (
                      <p className="text-xs text-destructive">
                        {errors.startDate?.message || errors.startDayType?.message}
                      </p>
                    )}
                  </div>
                  {/* End */}
                  <div className="space-y-2">
                    <Label htmlFor="endDate">End Date</Label>
                    <div className="flex gap-2">
                      <Input id="endDate" type="date" className="flex-1" {...register('endDate')} />
                      <select
                        className="flex h-10 rounded-md border border-input bg-background px-2 py-2 text-sm w-44"
                        {...register('endDayType')}
                      >
                        <option value="FULL">Full Day</option>
                        <option value="UNTIL_FIRST_HALF">Until 1st Half</option>
                      </select>
                    </div>
                    {(errors.endDate || errors.endDayType) && (
                      <p className="text-xs text-destructive">
                        {errors.endDate?.message || errors.endDayType?.message}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* Row 3 — Reason (always shown) */}
              <div className="space-y-2">
                <Label htmlFor="reason">Reason</Label>
                <Input id="reason" placeholder="Brief reason for leave..." {...register('reason')} />
                {errors.reason && <p className="text-xs text-destructive">{errors.reason.message}</p>}
              </div>

              <div className="flex gap-2">
                <Button type="submit" disabled={isSubmitting} style={{ backgroundColor: '#361963' }} className="text-white">
                  {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Submit Application
                </Button>
                <Button type="button" variant="outline" onClick={() => { setShowForm(false); reset(); }}>
                  Cancel
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* ── Leave Request List ── */}
      {loading ? (
        <Card>
          <CardContent className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </CardContent>
        </Card>
      ) : user?.role === 'MANAGER' ? (
        /* ── Manager: split into own leaves + team requests ── */
        <>
          {/* My Leave Requests */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <CalendarDays className="h-4 w-4" />
                <CardTitle className="text-base">My Leave Requests</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              {leaves.filter((l) => l.employeeId === user.id).length === 0 ? (
                <p className="text-center text-muted-foreground py-6">You haven't submitted any leave requests.</p>
              ) : (
                <div className="space-y-3">
                  {leaves
                    .filter((l) => l.employeeId === user.id)
                    .map((leave) => (
                      <LeaveRow
                        key={leave.id}
                        leave={leave}
                        showEmployee={false}
                        canAction={false}
                        canWithdraw={leave.status === 'PENDING' && leave.employeeId === user.id}
                        actionLoading={actionLoading}
                        onApprove={handleApprove}
                        onReject={handleReject}
                        onWithdraw={handleWithdraw}
                        isAdmin={false}
                        onChangeType={handleChangeType}
                        policies={policies}
                      />
                    ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Team Leave Requests */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4" />
                <CardTitle className="text-base">Team Leave Requests</CardTitle>
              </div>
              <CardDescription>Leave requests submitted by your direct reports</CardDescription>
            </CardHeader>
            <CardContent>
              {leaves.filter((l) => l.employeeId !== user.id).length === 0 ? (
                <p className="text-center text-muted-foreground py-6">No team leave requests found.</p>
              ) : (
                <div className="space-y-3">
                  {leaves
                    .filter((l) => l.employeeId !== user.id)
                    .map((leave) => (
                      <LeaveRow
                        key={leave.id}
                        leave={leave}
                        showEmployee={true}
                        canAction={leave.status === 'PENDING'}
                        canWithdraw={false}
                        actionLoading={actionLoading}
                        onApprove={handleApprove}
                        onReject={handleReject}
                        onWithdraw={handleWithdraw}
                        isAdmin={false}
                        onChangeType={handleChangeType}
                        policies={policies}
                      />
                    ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      ) : (
        /* ── Employee / Admin: single list ── */
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <CalendarDays className="h-4 w-4" />
              <CardTitle className="text-base">
                {isAdmin ? 'All Leave Requests' : 'My Leave Requests'}
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            {leaves.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">No leave requests found.</p>
            ) : (
              <div className="space-y-3">
                {leaves.map((leave) => (
                  <LeaveRow
                    key={leave.id}
                    leave={leave}
                    showEmployee={isAdmin}
                    canAction={isAdmin && leave.status === 'PENDING'}
                    canWithdraw={!isAdmin && leave.status === 'PENDING' && leave.employeeId === user?.id}
                    actionLoading={actionLoading}
                    onApprove={handleApprove}
                    onReject={handleReject}
                    onWithdraw={handleWithdraw}
                    isAdmin={isAdmin}
                    onChangeType={handleChangeType}
                    policies={policies}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Shared leave row sub-component ──────────────────────────────────────────

function LeaveRow({
  leave,
  showEmployee,
  canAction,
  canWithdraw,
  actionLoading,
  onApprove,
  onReject,
  onWithdraw,
  isAdmin,
  onChangeType,
  policies,
}: {
  leave:         LeaveRequest;
  showEmployee:  boolean;
  canAction:     boolean;
  canWithdraw:   boolean;
  actionLoading: string | null;
  onApprove:     (id: string) => void;
  onReject:      (id: string) => void;
  onWithdraw:    (id: string) => void;
  isAdmin:       boolean;
  onChangeType:  (id: string, newType: string) => void;
  policies:      LeavePolicy[];
}) {
  const [showTypeChange, setShowTypeChange] = useState(false);
  const [selectedType, setSelectedType]     = useState(leave.leaveType);

  const canChangeType = isAdmin && leave.status === 'PENDING';

  const handleSaveType = () => {
    if (selectedType !== leave.leaveType) {
      onChangeType(leave.id, selectedType);
    }
    setShowTypeChange(false);
  };

  return (
    <div className="flex items-start justify-between p-4 border rounded-lg gap-4">
      <div className="flex-1">
        {showEmployee && leave.employee?.profile && (
          <p className="text-sm font-medium mb-1">
            {leave.employee.profile.firstName} {leave.employee.profile.lastName}
            <span className="text-muted-foreground text-xs ml-2 font-mono">
              {leave.employee.profile.employeeId}
            </span>
          </p>
        )}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold">{leave.leaveType}</span>
          <span className="text-muted-foreground text-sm">
            {leave.durationType === 'SINGLE' ? (
              <>
                {formatDate(leave.startDate)}
                {leave.singleDayType && leave.singleDayType !== 'FULL' && (
                  <span className="ml-1 text-xs font-medium text-[#361963]">
                    · {leave.singleDayType === 'FIRST_HALF' ? '1st Half' : '2nd Half'}
                  </span>
                )}
              </>
            ) : (
              <>
                {formatDate(leave.startDate)}
                {leave.startDayType === 'FROM_SECOND_HALF' && (
                  <span className="ml-0.5 text-xs text-[#361963]"> (from 2nd half)</span>
                )}
                {' — '}
                {formatDate(leave.endDate)}
                {leave.endDayType === 'UNTIL_FIRST_HALF' && (
                  <span className="ml-0.5 text-xs text-[#361963]"> (until 1st half)</span>
                )}
              </>
            )}
            <span className="ml-1">
              ({leave.totalDays === 0.5
                ? '½ day'
                : `${leave.totalDays} day${leave.totalDays !== 1 ? 's' : ''}`})
            </span>
          </span>
        </div>
        <p className="text-sm text-muted-foreground mt-1">{leave.reason}</p>
        {leave.status === 'REJECTED' && leave.managerComment && (
          <p className="text-xs text-rose-600 mt-1 italic font-medium">
            Rejection reason: {leave.managerComment}
          </p>
        )}
        {leave.status !== 'REJECTED' && leave.managerComment && leave.managerComment !== 'Approved' && (
          <p className="text-xs text-muted-foreground mt-1 italic">
            Note: {leave.managerComment}
          </p>
        )}
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <span className={`text-xs font-medium px-2 py-1 rounded-full ${leaveStatusColor(leave.status)}`}>
          {leave.status}
        </span>
        {/* Admin: change leave type inline */}
        {canChangeType && !showTypeChange && (
          <Button
            size="sm"
            variant="ghost"
            className="text-muted-foreground hover:text-[#361963] px-2"
            title="Change leave type"
            onClick={() => { setSelectedType(leave.leaveType); setShowTypeChange(true); }}
            disabled={!!actionLoading}
          >
            <ArrowLeftRight className="h-3.5 w-3.5" />
          </Button>
        )}
        {canChangeType && showTypeChange && (
          <div className="flex items-center gap-1.5">
            <select
              value={selectedType}
              onChange={(e) => setSelectedType(e.target.value)}
              className="text-xs border border-input rounded-md px-2 py-1 bg-background focus:outline-none focus:ring-1 focus:ring-ring"
            >
              {policies.filter((p) => p.isActive).map((p) => (
                <option key={p.leaveType} value={p.leaveType}>{p.label}</option>
              ))}
            </select>
            <Button
              size="sm"
              variant="outline"
              className="px-2 text-[#361963] border-[#361963]/40 hover:bg-[#361963]/5"
              onClick={handleSaveType}
              disabled={actionLoading === leave.id + '-changetype' || selectedType === leave.leaveType}
              title="Save type change"
            >
              {actionLoading === leave.id + '-changetype'
                ? <Loader2 className="h-3 w-3 animate-spin" />
                : <Check className="h-3 w-3" />}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="px-2 text-muted-foreground"
              onClick={() => setShowTypeChange(false)}
              title="Cancel"
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
        )}
        {canAction && (
          <>
            <Button
              size="sm"
              variant="outline"
              className="text-green-600 border-green-300 hover:bg-green-50"
              onClick={() => onApprove(leave.id)}
              disabled={!!actionLoading}
            >
              {actionLoading === leave.id + '-approve'
                ? <Loader2 className="h-3 w-3 animate-spin" />
                : <Check className="h-3 w-3" />}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="text-destructive border-destructive/30 hover:bg-destructive/10"
              onClick={() => onReject(leave.id)}
              disabled={!!actionLoading}
            >
              {actionLoading === leave.id + '-reject'
                ? <Loader2 className="h-3 w-3 animate-spin" />
                : <X className="h-3 w-3" />}
            </Button>
          </>
        )}
        {canWithdraw && (
          <Button
            size="sm"
            variant="outline"
            className="text-destructive border-destructive/30 hover:bg-destructive/10"
            onClick={() => onWithdraw(leave.id)}
            disabled={actionLoading === leave.id + '-withdraw'}
            title="Withdraw request"
          >
            {actionLoading === leave.id + '-withdraw'
              ? <Loader2 className="h-3 w-3 animate-spin" />
              : <Trash2 className="h-3 w-3" />}
          </Button>
        )}
      </div>
    </div>
  );
}
