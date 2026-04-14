/**
 * Athena V2 - Leave Management
 *
 * Tab 1 "My Leaves"     — balance bars + apply form + own requests        (all roles)
 * Tab 2 "Approvals"    — team leave requests + approve/reject           (Manager, Admin)
 * Tab 3 "Team Balances"— team leave balances per employee               (Manager, Admin)
 * Tab 4 "Manage"       — leave policy config + quota overrides          (Admin only)
 */

import { Fragment, useEffect, useRef, useState } from 'react';
import { useForm }     from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z }           from 'zod';
import { toast }       from 'sonner';
import { useAuth }     from '@/hooks/useAuth';
import api             from '@/lib/api';
import { formatDate, leaveStatusColor } from '@/lib/utils';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button }  from '@/components/ui/button';
import { Input }   from '@/components/ui/input';
import { Label }   from '@/components/ui/label';
import { Badge }   from '@/components/ui/badge';
import { Loader2, Plus, Check, X, CalendarDays, Settings2, Pencil, Trash2, ArrowLeftRight, Users, RefreshCw } from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface LeaveBalance { leaveType: string; total: number; used: number; }

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
  isUnlimited:  boolean;
  allowedFor?:  string;
}

interface LeaveRequest {
  id:            string;
  employeeId:    string;
  leaveType:     string;
  startDate:     string;
  endDate:       string;
  totalDays:     number;
  reason:        string;
  status:        string;
  managerComment?: string;
  durationType?:  string;
  singleDayType?: string;
  startDayType?:  string;
  endDayType?:    string;
  employee?: { profile?: { firstName: string; lastName: string; employeeId: string } };
  appliedById?: string;
  appliedBy?: { profile?: { firstName: string; lastName: string } };
}

// ─── Form schema ──────────────────────────────────────────────────────────────

const leaveSchema = z.object({
  leaveType:    z.string().min(1, 'Select a leave type'),
  durationType: z.enum(['SINGLE', 'MULTIPLE']),
  singleDate:    z.string().optional(),
  singleDayType: z.enum(['FULL', 'FIRST_HALF', 'SECOND_HALF']).optional(),
  startDate:    z.string().optional(),
  startDayType: z.enum(['FULL', 'FROM_SECOND_HALF']).optional(),
  endDate:      z.string().optional(),
  endDayType:   z.enum(['FULL', 'UNTIL_FIRST_HALF']).optional(),
  reason: z.string().min(5, 'Reason must be at least 5 characters'),
}).superRefine((data, ctx) => {
  if (data.durationType === 'SINGLE') {
    if (!data.singleDate)    ctx.addIssue({ code: 'custom', message: 'Date is required',          path: ['singleDate'] });
    if (!data.singleDayType) ctx.addIssue({ code: 'custom', message: 'Select a session',          path: ['singleDayType'] });
  } else {
    if (!data.startDate)     ctx.addIssue({ code: 'custom', message: 'Start date is required',    path: ['startDate'] });
    if (!data.endDate)       ctx.addIssue({ code: 'custom', message: 'End date is required',      path: ['endDate'] });
    if (!data.startDayType)  ctx.addIssue({ code: 'custom', message: 'Select a session',          path: ['startDayType'] });
    if (!data.endDayType)    ctx.addIssue({ code: 'custom', message: 'Select a session',          path: ['endDayType'] });
    if (data.startDate && data.endDate && new Date(data.startDate) > new Date(data.endDate))
      ctx.addIssue({ code: 'custom', message: 'End date must be on or after start date',          path: ['endDate'] });
  }
});
type LeaveFormData = z.infer<typeof leaveSchema>;

// ─── BalanceBar ───────────────────────────────────────────────────────────────

function BalanceBar({ label, total, used }: { label: string; total: number; used: number }) {
  const isTrackOnly = total === 0; // e.g. Unpaid Leave — no cap, just track count
  const available   = Math.max(total - used, 0);
  const pct         = total > 0 ? Math.min((used / total) * 100, 100) : 0;
  const isLow       = available <= 2 && total > 0;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium text-muted-foreground">{label}</span>
        {isTrackOnly
          ? <span className="font-semibold text-muted-foreground">{used} day{used !== 1 ? 's' : ''} taken</span>
          : <span className={`font-semibold ${isLow ? 'text-rose-600' : ''}`}>{available} / {total} left</span>
        }
      </div>
      {!isTrackOnly && (
        <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
          <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: isLow ? '#ef4444' : '#361963' }} />
        </div>
      )}
    </div>
  );
}

// ─── Tab button ───────────────────────────────────────────────────────────────

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
        active ? 'border-[#361963] text-[#361963]' : 'border-transparent text-muted-foreground hover:text-foreground'
      }`}
    >
      {children}
    </button>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function Empty({ icon: Icon, text }: { icon: React.ElementType; text: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-10 text-muted-foreground">
      <Icon className="h-8 w-8 opacity-30" />
      <p className="text-sm">{text}</p>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function Leaves() {
  const { user } = useAuth();

  const isManagerOrAdmin = user?.role === 'ADMIN' || user?.role === 'MANAGER' || user?.role === 'OWNER';
  const isAdmin          = user?.role === 'ADMIN' || user?.role === 'OWNER';

  type Tab = 'my' | 'approvals' | 'team-balances' | 'manage' | 'on-behalf';
  const [tab, setTab] = useState<Tab>('my');

  // ── Data ──
  const [leaves,       setLeaves]       = useState<LeaveRequest[]>([]);
  const [balances,     setBalances]     = useState<LeaveBalance[]>([]);
  const [teamOverview, setTeamOverview] = useState<TeamOverviewUser[]>([]);
  const [policies,     setPolicies]     = useState<LeavePolicy[]>([]);
  const [policyDraft,  setPolicyDraft]  = useState<LeavePolicy[]>([]);

  // ── Loading ──
  const [loading,      setLoading]      = useState(true);
  const [teamLoading,  setTeamLoading]  = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [savingQuota,  setSavingQuota]  = useState(false);
  const [applyingAll,  setApplyingAll]  = useState(false);
  const [resettingFY,  setResettingFY]  = useState(false);
  const _now   = new Date();
  const _curFY = _now.getMonth() >= 3 ? _now.getFullYear() : _now.getFullYear() - 1;
  const [fyFrom, setFyFrom] = useState(_curFY - 1);
  const [fyTo,   setFyTo]   = useState(_curFY);

  // ── Comp-off balance ──
  const [compOffBalance, setCompOffBalance] = useState(0);

  // ── Sandwich / LWP warnings ──
  const [sandwichWarning, setSandwichWarning] = useState('');
  const [lwpWarning,      setLwpWarning]      = useState('');
  const [docWarning,      setDocWarning]      = useState('');

  // ── Form / UI state ──
  const [showForm,        setShowForm]        = useState(false);
  const [overlapWarning,  setOverlapWarning]  = useState<string | null>(null);
  const [pendingData,     setPendingData]     = useState<any>(null);
  const [forceSubmitting, setForceSubmitting] = useState(false);
  const [rejectId,       setRejectId]       = useState<string | null>(null);
  const [rejectComment,  setRejectComment]  = useState('');
  const [editingUserId,  setEditingUserId]  = useState<string | null>(null);
  const [quotaDraft,     setQuotaDraft]     = useState<Record<string, number>>({});
  const [newLT,          setNewLT]          = useState({ code: '', label: '', days: 0 });

  // Synchronous guard against rapid double-tap on mobile (disabled={isSubmitting} alone
  // is insufficient because the DOM attribute update waits for the next React render cycle)
  const submitGuard = useRef(false);

  // ── Form ──
  const { register, handleSubmit, reset, watch, setValue, formState: { errors, isSubmitting } } =
    useForm<LeaveFormData>({
      resolver: zodResolver(leaveSchema),
      defaultValues: { durationType: 'SINGLE', singleDayType: 'FULL', startDayType: 'FULL', endDayType: 'FULL' },
    });
  const durationType = watch('durationType');

  // ── Fetchers ──────────────────────────────────────────────────────────────

  const fetchLeaves = async () => {
    try {
      const { data } = await api.get<LeaveRequest[]>('/leaves');
      setLeaves(data);
    } catch { /* silent */ }
    finally { setLoading(false); }
  };

  const fetchBalances = async () => {
    try { const { data } = await api.get<LeaveBalance[]>('/leave-balance'); setBalances(data); }
    catch { /* non-critical */ }
  };

  const fetchTeamOverview = async () => {
    setTeamLoading(true);
    try { const { data } = await api.get<TeamOverviewUser[]>('/leave-balance/overview'); setTeamOverview(data); }
    catch { toast.error('Failed to load team balances'); }
    finally { setTeamLoading(false); }
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
    if (isManagerOrAdmin) fetchTeamOverview();
    api.get('/compoff/balance').then(r => setCompOffBalance(r.data.balance)).catch(() => {});
  }, []);

  // ── Leave actions ─────────────────────────────────────────────────────────

  const submitLeave = async (data: any, force = false) => {
    // Preview first to get sandwich/LWP warnings
    try {
      const preview = await api.post(`/leaves?preview=true`, data);
      const p = preview.data;
      setSandwichWarning(p.sandwichWarning || '');
      setLwpWarning(p.lwpWarning || '');
      setDocWarning(p.documentWarning || '');

      // If warnings exist and this isn't a force submit, show them and wait for confirmation
      if (!force && (p.sandwichWarning || p.lwpWarning)) {
        setPendingData(data);
        return;
      }
    } catch { /* preview failed, proceed anyway */ }

    // Clear warnings and submit
    setSandwichWarning('');
    setLwpWarning('');
    setDocWarning('');

    await api.post(`/leaves${force ? '?force=true' : ''}`, data);
    setShowForm(false);
    setOverlapWarning(null);
    setPendingData(null);
    reset();
    fetchLeaves();
    fetchBalances();
    toast.success('Leave application submitted');
  };

  const onSubmit = async (data: LeaveFormData) => {
    if (submitGuard.current) return;   // blocks rapid re-tap before React re-renders
    submitGuard.current = true;
    try { await submitLeave(data, false); }
    catch (err: any) {
      if (err?.response?.status === 409 && err?.response?.data?.warning) {
        setOverlapWarning(err.response.data.message);
        setPendingData(data);
        return;
      }
      toast.error(err?.response?.data?.error || 'Failed to apply leave');
    } finally {
      submitGuard.current = false;
    }
  };

  const confirmOverlap = async () => {
    if (!pendingData || forceSubmitting) return;
    setForceSubmitting(true);
    try { await submitLeave(pendingData, true); }
    catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to apply leave');
      setOverlapWarning(null);
      setPendingData(null);
    } finally {
      setForceSubmitting(false);
    }
  };

  const handleApprove = async (id: string, convertTo?: string) => {
    setActionLoading(id + '-approve');
    try {
      await api.patch(`/leaves/${id}/approve`, { comment: 'Approved', ...(convertTo ? { convertToLeaveType: convertTo } : {}) });
      fetchLeaves();
      fetchBalances();
      toast.success('Leave approved');
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to approve');
    } finally { setActionLoading(null); }
  };

  const handleReject = async () => {
    if (!rejectId) return;
    setActionLoading(rejectId + '-reject');
    try {
      await api.patch(`/leaves/${rejectId}/reject`, { comment: rejectComment || 'Rejected' });
      fetchLeaves();
      setRejectId(null);
      setRejectComment('');
      toast.success('Leave rejected');
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to reject');
    } finally { setActionLoading(null); }
  };

  const handleWithdraw = async (id: string) => {
    setActionLoading(id + '-withdraw');
    try {
      await api.delete(`/leaves/${id}`);
      fetchLeaves();
      fetchBalances();
      toast.success('Leave request withdrawn');
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to withdraw leave request');
    } finally { setActionLoading(null); }
  };

  const handleChangeType = async (id: string, newType: string) => {
    setActionLoading(id + '-changetype');
    try {
      await api.patch(`/leaves/${id}/change-type`, { leaveType: newType });
      fetchLeaves();
      toast.success('Leave type updated');
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to change leave type');
    } finally { setActionLoading(null); }
  };

  // ── Policy actions ────────────────────────────────────────────────────────

  const handleSavePolicy = async () => {
    setSavingPolicy(true);
    try {
      const payload = policyDraft.map(({ id, label, defaultTotal, isActive, allowedFor }) => ({ id, label, defaultTotal, isActive, allowedFor }));
      const { data } = await api.put<LeavePolicy[]>('/leave-policy', payload);
      setPolicies(data);
      setPolicyDraft(data.map((p) => ({ ...p })));
      fetchBalances();
      if (isManagerOrAdmin) fetchTeamOverview();
      toast.success('Policy saved');
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to save policy');
    } finally { setSavingPolicy(false); }
  };

  const handleDeletePolicy = async (id: string, leaveType: string) => {
    try {
      await api.delete(`/leave-policy/${id}`);
      fetchPolicies();
      fetchBalances();
      toast.success(`Leave type '${leaveType}' deleted`);
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to delete leave type');
    }
  };

  const handleAddLeaveType = async () => {
    if (!newLT.code || !newLT.label) { toast.error('Type code and label are required'); return; }
    try {
      await api.post('/leave-policy', { leaveType: newLT.code.toUpperCase(), label: newLT.label, defaultTotal: Number(newLT.days) });
      fetchPolicies();
      fetchBalances();
      setNewLT({ code: '', label: '', days: 0 });
      toast.success('Leave type added');
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to add leave type');
    }
  };

  const handleFYReset = async () => {
    setResettingFY(true);
    try {
      const res = await api.post('/leave-balance/reset-fy', { fromYear: fyFrom, toYear: fyTo });
      toast.success(res.data.message || `FY reset complete: ${fyFrom} → ${fyTo}`);
      fetchBalances();
      if (isManagerOrAdmin) fetchTeamOverview();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to reset FY');
    } finally { setResettingFY(false); }
  };

  const handleApplyToAll = async () => {
    setApplyingAll(true);
    try {
      const { data } = await api.post<{ updated: number; employees: number; year: number }>(
        `/leave-policy/apply-all?year=${new Date().getFullYear()}`
      );
      toast.success(`Updated ${data.updated} balance records across ${data.employees} employees for ${data.year}`);
      fetchBalances();
      if (isManagerOrAdmin) fetchTeamOverview();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to apply policy');
    } finally { setApplyingAll(false); }
  };

  const updatePolicyDraft = (leaveType: string, field: keyof LeavePolicy, value: any) => {
    setPolicyDraft((prev) => prev.map((p) => (p.leaveType === leaveType ? { ...p, [field]: value } : p)));
  };

  // ── Quota edit ────────────────────────────────────────────────────────────

  const openQuotaEdit = (u: TeamOverviewUser) => {
    const draft: Record<string, number> = {};
    u.leaveBalances.forEach((b) => { draft[b.leaveType] = b.total; });
    setQuotaDraft(draft);
    setEditingUserId(u.id);
  };

  const handleSaveQuota = async (userId: string) => {
    setSavingQuota(true);
    try {
      await api.put(`/leave-balance/${userId}`, { year: new Date().getFullYear(), ...quotaDraft });
      setEditingUserId(null);
      fetchTeamOverview();
      fetchBalances();
      toast.success('Quota updated');
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to save quota');
    } finally { setSavingQuota(false); }
  };

  // ── Active leave types for apply form (TRAVELLING is applied from Travel Proof page)
  const leaveTypesForForm = policies.filter((p) => {
    if (!p.isActive || p.leaveType === 'TRAVELLING') return false;
    const empType = (user as any)?.employmentType || 'FULL_TIME';
    if (p.allowedFor && p.allowedFor !== 'ALL' && p.allowedFor !== empType) return false;
    return true;
  });

  // ── Own vs team leaves ────────────────────────────────────────────────────
  const myLeaves   = leaves.filter((l) => l.employeeId === user?.id);
  const teamLeaves = leaves.filter((l) => l.employeeId !== user?.id);

  // ── Render ────────────────────────────────────────────────────────────────

  // ── On-behalf state (Admin only) ──────────────────────────────────────────
  const [obEmployees, setObEmployees] = useState<{ id: string; name: string; employeeId: string; employmentType?: string }[]>([]);
  const [obSelectedEmp, setObSelectedEmp] = useState('');
  const [obLeaveType, setObLeaveType] = useState('');
  const [obDurationType, setObDurationType] = useState<'SINGLE' | 'MULTIPLE'>('SINGLE');
  const [obSingleDate, setObSingleDate] = useState('');
  const [obSingleDayType, setObSingleDayType] = useState('FULL');
  const [obStartDate, setObStartDate] = useState('');
  const [obStartDayType, setObStartDayType] = useState('FULL');
  const [obEndDate, setObEndDate] = useState('');
  const [obEndDayType, setObEndDayType] = useState('FULL');
  const [obReason, setObReason] = useState('');
  const [obSubmitting, setObSubmitting] = useState(false);
  const [obError, setObError] = useState('');
  const [obSuccess, setObSuccess] = useState('');

  useEffect(() => {
    if (isAdmin) {
      api.get('/employees').then((r) => {
        const emps = r.data
          .filter((e: any) => e.isActive && e.id !== user?.id)
          .map((e: any) => ({
            id: e.id,
            name: e.profile ? `${e.profile.firstName} ${e.profile.lastName}` : e.email,
            employeeId: e.profile?.employeeId || '',
            employmentType: e.profile?.employmentType || 'FULL_TIME',
          }));
        setObEmployees(emps);
      }).catch(() => {});
    }
  }, [isAdmin]);

  const handleOnBehalfSubmit = async () => {
    if (!obSelectedEmp || !obLeaveType || !obReason) {
      setObError('Please fill all required fields');
      return;
    }
    setObSubmitting(true);
    setObError('');
    setObSuccess('');
    try {
      const body: any = {
        leaveType: obLeaveType,
        durationType: obDurationType,
        reason: obReason,
        onBehalfOf: obSelectedEmp,
      };
      if (obDurationType === 'SINGLE') {
        if (!obSingleDate) { setObError('Date is required'); setObSubmitting(false); return; }
        body.singleDate = obSingleDate;
        body.singleDayType = obSingleDayType;
      } else {
        if (!obStartDate || !obEndDate) { setObError('Start and end dates are required'); setObSubmitting(false); return; }
        body.startDate = obStartDate;
        body.startDayType = obStartDayType;
        body.endDate = obEndDate;
        body.endDayType = obEndDayType;
      }
      await api.post('/leaves', body);
      setObSuccess('Leave applied successfully on behalf of the employee.');
      setObLeaveType('');
      setObSingleDate('');
      setObStartDate('');
      setObEndDate('');
      setObReason('');
      // refresh leaves
      api.get('/leaves').then((r) => setLeaves(r.data)).catch(() => {});
    } catch (err: any) {
      setObError(err?.response?.data?.error || err?.response?.data?.message || 'Failed to apply leave');
    } finally {
      setObSubmitting(false);
    }
  };

  const tabs: { key: Tab; label: string; show: boolean }[] = [
    { key: 'my',             label: 'My Leaves',       show: true },
    { key: 'approvals',      label: 'Approvals',       show: isManagerOrAdmin },
    { key: 'team-balances',  label: 'Team Balances',   show: isManagerOrAdmin },
    { key: 'on-behalf',      label: 'Apply on Behalf', show: isAdmin },
    { key: 'manage',         label: 'Manage',          show: isAdmin },
  ];

  return (
    <div className="space-y-5 max-w-5xl">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Leaves</h1>
          <p className="text-sm text-muted-foreground">Manage leave requests and balances</p>
        </div>
        {tab === 'my' && (
          <Button onClick={() => setShowForm((v) => !v)} style={{ backgroundColor: '#361963' }} className="text-white">
            <Plus className="h-4 w-4 mr-2" />
            Apply Leave
          </Button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b">
        {tabs.filter((t) => t.show).map((t) => (
          <TabBtn key={t.key} active={tab === t.key} onClick={() => setTab(t.key)}>{t.label}</TabBtn>
        ))}
      </div>

      {/* ── TAB: MY LEAVES ─────────────────────────────────────────────────── */}
      {tab === 'my' && (
        <div className="space-y-5">

          {/* Overlap warning modal */}
          {overlapWarning && (
            <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
              <div className="bg-white rounded-xl shadow-xl max-w-sm w-full p-6 space-y-4">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
                    <span className="text-amber-600 text-sm font-bold">!</span>
                  </div>
                  <div>
                    <h3 className="font-semibold text-sm">Overlapping Leave Detected</h3>
                    <p className="text-sm text-muted-foreground mt-1">{overlapWarning}</p>
                  </div>
                </div>
                <div className="flex gap-2 justify-end">
                  <Button variant="outline" size="sm" onClick={() => { setOverlapWarning(null); setPendingData(null); }}>Cancel</Button>
                  <Button size="sm" style={{ backgroundColor: '#FD8C27' }} className="text-white" onClick={confirmOverlap} disabled={forceSubmitting}>
                    {forceSubmitting && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}Submit Anyway
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Sandwich / LWP warning modal */}
          {(sandwichWarning || lwpWarning) && pendingData && !overlapWarning && (
            <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
              <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 space-y-4">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
                    <span className="text-amber-600 text-sm font-bold">!</span>
                  </div>
                  <div className="space-y-2">
                    <h3 className="font-semibold text-sm">Leave Warnings</h3>
                    {sandwichWarning && (
                      <div className="text-sm bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">{sandwichWarning}</div>
                    )}
                    {lwpWarning && (
                      <div className="text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-red-700">{lwpWarning}</div>
                    )}
                    {docWarning && (
                      <div className="text-sm bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 text-blue-700">{docWarning}</div>
                    )}
                  </div>
                </div>
                <div className="flex gap-2 justify-end">
                  <Button variant="outline" size="sm" onClick={() => { setSandwichWarning(''); setLwpWarning(''); setDocWarning(''); setPendingData(null); }}>Cancel</Button>
                  <Button size="sm" style={{ backgroundColor: '#FD8C27' }} className="text-white" disabled={forceSubmitting} onClick={async () => {
                    if (forceSubmitting) return;
                    setForceSubmitting(true);
                    try {
                      await api.post(`/leaves?force=true`, pendingData);
                      setSandwichWarning(''); setLwpWarning(''); setDocWarning('');
                      setShowForm(false); setPendingData(null); reset();
                      fetchLeaves(); fetchBalances();
                      toast.success('Leave application submitted');
                    } catch (err: any) {
                      toast.error(err?.response?.data?.error || 'Failed to apply leave');
                    } finally {
                      setForceSubmitting(false);
                    }
                  }}>
                    {forceSubmitting && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}Submit Anyway
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Reject modal */}
          {rejectId && (
            <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
              <div className="bg-white rounded-xl shadow-xl max-w-sm w-full p-6 space-y-4">
                <h3 className="font-semibold text-sm">Reject Leave Request</h3>
                <div className="space-y-1.5">
                  <Label>Reason <span className="text-muted-foreground font-normal">(optional)</span></Label>
                  <Input placeholder="Briefly explain the reason…" value={rejectComment} onChange={(e) => setRejectComment(e.target.value)} />
                </div>
                <div className="flex gap-2 justify-end">
                  <Button variant="outline" size="sm" onClick={() => { setRejectId(null); setRejectComment(''); }}>Cancel</Button>
                  <Button size="sm" variant="destructive" onClick={handleReject} disabled={!!actionLoading}>
                    {actionLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Reject'}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Balance bars — only for non-unlimited leave types */}
          {balances.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">My Leave Balance — FY {_curFY}-{(_curFY + 1).toString().slice(-2)}</CardTitle>
                <CardDescription>Allocated vs used days</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-5">
                  {policies
                    .filter((p) => !p.isUnlimited && p.isActive)
                    .map((p) => {
                      const b = balances.find((x) => x.leaveType === p.leaveType);
                      if (!b) return null;
                      return <BalanceBar key={p.leaveType} label={p.label} total={b.total} used={b.used} />;
                    })}
                </div>
                {/* Show unlimited types as badges */}
                {policies.filter((p) => p.isUnlimited && p.isActive).length > 0 && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {policies.filter((p) => p.isUnlimited && p.isActive).map((p) => (
                      <span key={p.leaveType} className="text-xs px-3 py-1 rounded-full border border-dashed text-muted-foreground">
                        {p.label} — Unlimited
                      </span>
                    ))}
                  </div>
                )}
                {/* Comp-off balance */}
                {compOffBalance > 0 && (
                  <div className="mt-4 flex items-center gap-2 text-sm bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                    <CalendarDays className="h-4 w-4 text-green-600" />
                    <span><strong>{compOffBalance}</strong> Comp-Off day{compOffBalance !== 1 ? 's' : ''} available — use as leave type "COMP_OFF"</span>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Apply leave form */}
          {showForm && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">New Leave Application</CardTitle>
                <CardDescription>Submit a leave request for your manager's review</CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="leaveType">Leave Type</Label>
                      <select id="leaveType" className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" {...register('leaveType')}>
                        <option value="">— Select type —</option>
                        {leaveTypesForForm.map((t) => <option key={t.leaveType} value={t.leaveType}>{t.label}</option>)}
                      </select>
                      {errors.leaveType && <p className="text-xs text-destructive">{errors.leaveType.message}</p>}
                    </div>
                    <div className="space-y-2">
                      <Label>Duration</Label>
                      <div className="flex gap-1 p-1 rounded-lg bg-muted w-fit">
                        {(['SINGLE', 'MULTIPLE'] as const).map((dt) => (
                          <button key={dt} type="button" onClick={() => setValue('durationType', dt, { shouldValidate: true })}
                            className="px-4 py-1.5 rounded-md text-sm font-medium transition-all"
                            style={durationType === dt ? { backgroundColor: '#361963', color: '#fff' } : { color: '#361963' }}>
                            {dt === 'SINGLE' ? 'Single Day' : 'Multiple Days'}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {durationType === 'SINGLE' ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Date</Label>
                        <Input type="date" {...register('singleDate')} />
                        {errors.singleDate && <p className="text-xs text-destructive">{errors.singleDate.message}</p>}
                      </div>
                      <div className="space-y-2">
                        <Label>Session</Label>
                        <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" {...register('singleDayType')}>
                          <option value="FULL">Full Day</option>
                          <option value="FIRST_HALF">1st Half (Morning)</option>
                          <option value="SECOND_HALF">2nd Half (Afternoon)</option>
                        </select>
                        {errors.singleDayType && <p className="text-xs text-destructive">{errors.singleDayType.message}</p>}
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Start Date</Label>
                        <div className="flex gap-2">
                          <Input type="date" className="flex-1" {...register('startDate')} />
                          <select className="flex h-10 rounded-md border border-input bg-background px-2 py-2 text-sm w-44" {...register('startDayType')}>
                            <option value="FULL">Full Day</option>
                            <option value="FROM_SECOND_HALF">From 2nd Half</option>
                          </select>
                        </div>
                        {(errors.startDate || errors.startDayType) && <p className="text-xs text-destructive">{errors.startDate?.message || errors.startDayType?.message}</p>}
                      </div>
                      <div className="space-y-2">
                        <Label>End Date</Label>
                        <div className="flex gap-2">
                          <Input type="date" className="flex-1" {...register('endDate')} />
                          <select className="flex h-10 rounded-md border border-input bg-background px-2 py-2 text-sm w-44" {...register('endDayType')}>
                            <option value="FULL">Full Day</option>
                            <option value="UNTIL_FIRST_HALF">Until 1st Half</option>
                          </select>
                        </div>
                        {(errors.endDate || errors.endDayType) && <p className="text-xs text-destructive">{errors.endDate?.message || errors.endDayType?.message}</p>}
                      </div>
                    </div>
                  )}

                  <div className="space-y-2">
                    <Label>Reason</Label>
                    <Input placeholder="Brief reason for leave…" {...register('reason')} />
                    {errors.reason && <p className="text-xs text-destructive">{errors.reason.message}</p>}
                  </div>

                  <div className="flex gap-2">
                    <Button type="submit" disabled={isSubmitting} style={{ backgroundColor: '#361963' }} className="text-white">
                      {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      Submit Application
                    </Button>
                    <Button type="button" variant="outline" onClick={() => { setShowForm(false); reset(); }}>Cancel</Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          )}

          {/* My leave requests */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <CalendarDays className="h-4 w-4" style={{ color: '#361963' }} />
                <CardTitle className="text-base">My Leave Requests</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="space-y-2">{[1,2,3].map((i) => <div key={i} className="h-16 rounded-xl bg-muted animate-pulse" />)}</div>
              ) : myLeaves.length === 0 ? (
                <Empty icon={CalendarDays} text="No leave requests yet. Click 'Apply Leave' to get started." />
              ) : (
                <div className="space-y-3">
                  {myLeaves.map((leave) => (
                    <LeaveRow
                      key={leave.id} leave={leave}
                      showEmployee={false}
                      canAction={false}
                      canWithdraw={leave.status === 'PENDING'}
                      actionLoading={actionLoading}
                      onApprove={handleApprove}
                      onRejectClick={(id) => { setRejectId(id); setRejectComment(''); }}
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
        </div>
      )}

      {/* ── TAB: APPROVALS ─────────────────────────────────────────────────── */}
      {tab === 'approvals' && isManagerOrAdmin && (
        <div className="space-y-5">

          {/* Reject modal (shared) */}
          {rejectId && (
            <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
              <div className="bg-white rounded-xl shadow-xl max-w-sm w-full p-6 space-y-4">
                <h3 className="font-semibold text-sm">Reject Leave Request</h3>
                <div className="space-y-1.5">
                  <Label>Reason <span className="text-muted-foreground font-normal">(optional)</span></Label>
                  <Input placeholder="Briefly explain the reason…" value={rejectComment} onChange={(e) => setRejectComment(e.target.value)} />
                </div>
                <div className="flex gap-2 justify-end">
                  <Button variant="outline" size="sm" onClick={() => { setRejectId(null); setRejectComment(''); }}>Cancel</Button>
                  <Button size="sm" variant="destructive" onClick={handleReject} disabled={!!actionLoading}>
                    {actionLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Reject'}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Team leave requests */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">
                {isAdmin ? 'All Leave Requests' : 'Team Leave Requests'}
              </CardTitle>
              <CardDescription>
                {isAdmin ? 'All pending and past leave requests' : 'Requests from your direct reports'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="space-y-2">{[1,2,3].map((i) => <div key={i} className="h-16 rounded-xl bg-muted animate-pulse" />)}</div>
              ) : teamLeaves.length === 0 ? (
                <Empty icon={CalendarDays} text="No team leave requests." />
              ) : (
                <div className="space-y-3">
                  {teamLeaves.map((leave) => (
                    <LeaveRow
                      key={leave.id} leave={leave}
                      showEmployee={true}
                      canAction={leave.status === 'PENDING'}
                      canWithdraw={false}
                      actionLoading={actionLoading}
                      onApprove={handleApprove}
                      onRejectClick={(id) => { setRejectId(id); setRejectComment(''); }}
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
        </div>
      )}

      {/* ── TAB: TEAM BALANCES ──────────────────────────────────────────────── */}
      {tab === 'team-balances' && isManagerOrAdmin && (
        <div className="space-y-5">

          {/* Team balance table */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base">Team Leave Balances — FY {_curFY}-{(_curFY + 1).toString().slice(-2)}</CardTitle>
                  <CardDescription className="mt-0.5">Remaining days per employee</CardDescription>
                </div>
                <Button size="sm" variant="outline" onClick={fetchTeamOverview} disabled={teamLoading}>
                  <RefreshCw className={`h-3.5 w-3.5 ${teamLoading ? 'animate-spin' : ''}`} />
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {teamLoading ? (
                <div className="space-y-2">{[1,2,3].map((i) => <div key={i} className="h-10 rounded-xl bg-muted animate-pulse" />)}</div>
              ) : teamOverview.length === 0 ? (
                <Empty icon={Users} text="No team members found." />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-muted-foreground text-xs">
                        <th className="text-left pb-2 pr-4 font-medium">Employee</th>
                        {policies.filter((p) => !p.isUnlimited && p.isActive).map((p) => (
                          <th key={p.leaveType} className="text-center pb-2 px-2 font-medium">{p.label}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {teamOverview.map((u) => (
                        <tr key={u.id} className="border-b last:border-0 hover:bg-muted/20">
                          <td className="py-2.5 pr-4">
                            <p className="font-medium">{u.profile?.firstName} {u.profile?.lastName}</p>
                            <p className="text-xs text-muted-foreground font-mono">{u.profile?.employeeId}</p>
                          </td>
                          {policies.filter((p) => !p.isUnlimited && p.isActive).map((p) => {
                            const b    = u.leaveBalances.find((x) => x.leaveType === p.leaveType);
                            const left = b ? Math.max(b.total - b.used, 0) : 0;
                            const isLow = b && left <= 2 && b.total > 0;
                            return (
                              <td key={p.leaveType} className="text-center py-2.5 px-2">
                                <span className="text-xs font-semibold px-2 py-0.5 rounded-full"
                                  style={{ backgroundColor: isLow ? '#fee2e2' : '#f3f0fa', color: isLow ? '#b91c1c' : '#361963' }}>
                                  {left}/{b?.total ?? 0}
                                </span>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── TAB: APPLY ON BEHALF (Admin only) ─────────────────────────────── */}
      {tab === 'on-behalf' && isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Apply Leave on Behalf of Employee</CardTitle>
            <CardDescription>As HR Admin, submit a leave request for any employee</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {obError && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-2">{obError}</div>}
            {obSuccess && <div className="text-sm text-green-600 bg-green-50 border border-green-200 rounded-lg px-4 py-2">{obSuccess}</div>}

            <div className="grid grid-cols-2 gap-4">
              {/* Employee selector */}
              <div className="space-y-1.5">
                <Label>Employee *</Label>
                <select
                  value={obSelectedEmp}
                  onChange={(e) => { setObSelectedEmp(e.target.value); setObLeaveType(''); }}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="">— Select employee —</option>
                  {obEmployees.map((e) => (
                    <option key={e.id} value={e.id}>{e.name} {e.employeeId ? `(${e.employeeId})` : ''}</option>
                  ))}
                </select>
              </div>

              {/* Leave type */}
              <div className="space-y-1.5">
                <Label>Leave Type *</Label>
                <select
                  value={obLeaveType}
                  onChange={(e) => setObLeaveType(e.target.value)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="">— Select type —</option>
                  {policies.filter((p) => {
                    if (!p.isActive || p.leaveType === 'TRAVELLING') return false;
                    if (obSelectedEmp && p.allowedFor && p.allowedFor !== 'ALL') {
                      const selectedEmpData = obEmployees.find((e) => e.id === obSelectedEmp);
                      if (selectedEmpData && p.allowedFor !== selectedEmpData.employmentType) return false;
                    }
                    return true;
                  }).map((p) => (
                    <option key={p.leaveType} value={p.leaveType}>{p.label}</option>
                  ))}
                </select>
              </div>

              {/* Duration type */}
              <div className="space-y-1.5">
                <Label>Duration</Label>
                <select
                  value={obDurationType}
                  onChange={(e) => setObDurationType(e.target.value as 'SINGLE' | 'MULTIPLE')}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="SINGLE">Single Day</option>
                  <option value="MULTIPLE">Multiple Days</option>
                </select>
              </div>

              {/* Single day fields */}
              {obDurationType === 'SINGLE' && (
                <>
                  <div className="space-y-1.5">
                    <Label>Date *</Label>
                    <Input type="date" value={obSingleDate} onChange={(e) => setObSingleDate(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Session</Label>
                    <select value={obSingleDayType} onChange={(e) => setObSingleDayType(e.target.value)}
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
                      <option value="FULL">Full Day</option>
                      <option value="FIRST_HALF">First Half</option>
                      <option value="SECOND_HALF">Second Half</option>
                    </select>
                  </div>
                </>
              )}

              {/* Multiple day fields */}
              {obDurationType === 'MULTIPLE' && (
                <>
                  <div className="space-y-1.5">
                    <Label>Start Date *</Label>
                    <Input type="date" value={obStartDate} onChange={(e) => setObStartDate(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Start Session</Label>
                    <select value={obStartDayType} onChange={(e) => setObStartDayType(e.target.value)}
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
                      <option value="FULL">Full Day</option>
                      <option value="FROM_SECOND_HALF">From Second Half</option>
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>End Date *</Label>
                    <Input type="date" value={obEndDate} onChange={(e) => setObEndDate(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>End Session</Label>
                    <select value={obEndDayType} onChange={(e) => setObEndDayType(e.target.value)}
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
                      <option value="FULL">Full Day</option>
                      <option value="UNTIL_FIRST_HALF">Until First Half</option>
                    </select>
                  </div>
                </>
              )}
            </div>

            {/* Reason */}
            <div className="space-y-1.5">
              <Label>Reason *</Label>
              <textarea
                value={obReason}
                onChange={(e) => setObReason(e.target.value)}
                placeholder="Enter reason for leave..."
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[80px]"
              />
            </div>

            <Button
              onClick={handleOnBehalfSubmit}
              disabled={obSubmitting || !obSelectedEmp || !obLeaveType}
              style={{ backgroundColor: '#361963' }}
              className="text-white"
            >
              {obSubmitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Apply Leave on Behalf
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ── TAB: MANAGE (Admin only) ────────────────────────────────────────── */}
      {tab === 'manage' && isAdmin && (
        <div className="space-y-5">

          {/* Leave Policy table */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <Settings2 className="h-4 w-4" style={{ color: '#361963' }} />
                <CardTitle className="text-base">Leave Policy Configuration</CardTitle>
              </div>
              <CardDescription>
                Set org-wide defaults and toggle leave categories. Use "Apply Defaults to All" to push defaults to every employee's balance.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {policyDraft.length === 0 ? (
                <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
              ) : (
                <div className="space-y-4">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-muted-foreground text-xs">
                          <th className="text-left pb-2 pr-4 font-medium">Code</th>
                          <th className="text-left pb-2 pr-4 font-medium w-52">Label</th>
                          <th className="text-center pb-2 px-4 font-medium w-28">Default Days</th>
                          <th className="text-center pb-2 px-4 font-medium w-24">Unlimited</th>
                          <th className="text-center pb-2 px-4 font-medium w-20">Active</th>
                          <th className="text-center pb-2 px-4 font-medium w-20">Delete</th>
                        </tr>
                      </thead>
                      <tbody>
                        {policyDraft.map((p) => (
                          <tr key={p.leaveType} className="border-b last:border-0">
                            <td className="py-3 pr-4">
                              <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded bg-muted">{p.leaveType}</span>
                            </td>
                            <td className="py-3 pr-4">
                              <Input value={p.label} onChange={(e) => updatePolicyDraft(p.leaveType, 'label', e.target.value)} className="h-8 text-sm w-48" />
                            </td>
                            <td className="py-3 px-4 text-center">
                              {p.isUnlimited
                                ? <span className="text-xs text-muted-foreground">—</span>
                                : <Input type="number" min={0} value={p.defaultTotal} onChange={(e) => updatePolicyDraft(p.leaveType, 'defaultTotal', Number(e.target.value))} className="h-8 text-sm w-20 mx-auto text-center" />
                              }
                            </td>
                            <td className="py-3 px-4 text-center">
                              <span className={`text-xs px-2 py-0.5 rounded-full ${p.isUnlimited ? 'bg-purple-50 text-purple-700' : 'bg-gray-100 text-gray-500'}`}>
                                {p.isUnlimited ? 'Yes' : 'No'}
                              </span>
                            </td>
                            <td className="py-3 px-4 text-center">
                              <input type="checkbox" checked={p.isActive} onChange={(e) => updatePolicyDraft(p.leaveType, 'isActive', e.target.checked)} className="h-4 w-4 accent-[#361963]" />
                            </td>
                            <td className="py-3 px-4 text-center">
                              <button onClick={() => handleDeletePolicy(p.id, p.leaveType)} className="text-muted-foreground hover:text-destructive transition-colors">
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Add new leave type */}
                  <div className="border-t pt-4">
                    <p className="text-xs font-medium text-muted-foreground mb-2">Add New Leave Type</p>
                    <div className="flex flex-wrap gap-2 items-end">
                      <div className="space-y-1">
                        <Label className="text-xs">Code</Label>
                        <Input placeholder="e.g. ML" value={newLT.code} onChange={(e) => setNewLT((v) => ({ ...v, code: e.target.value }))} className="h-8 w-24 text-sm uppercase" />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Label</Label>
                        <Input placeholder="e.g. Maternity Leave" value={newLT.label} onChange={(e) => setNewLT((v) => ({ ...v, label: e.target.value }))} className="h-8 w-44 text-sm" />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Default Days (0 = unlimited)</Label>
                        <Input type="number" min={0} value={newLT.days} onChange={(e) => setNewLT((v) => ({ ...v, days: Number(e.target.value) }))} className="h-8 w-24 text-sm" />
                      </div>
                      <Button size="sm" variant="outline" onClick={handleAddLeaveType}>
                        <Plus className="h-3.5 w-3.5 mr-1" /> Add
                      </Button>
                    </div>
                  </div>

                  {/* Action buttons */}
                  <div className="flex flex-wrap items-center gap-2 border-t pt-4">
                    <Button size="sm" onClick={handleSavePolicy} disabled={savingPolicy} style={{ backgroundColor: '#361963' }} className="text-white">
                      {savingPolicy && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
                      Save Policy
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setPolicyDraft(policies.map((p) => ({ ...p })))} disabled={savingPolicy}>
                      Reset
                    </Button>
                    <Button size="sm" variant="outline" onClick={handleApplyToAll} disabled={applyingAll || savingPolicy} className="text-amber-700 border-amber-300 hover:bg-amber-50">
                      {applyingAll && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
                      Apply Defaults to All Employees
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* FY Rollover */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Year-End FY Reset</CardTitle>
              <CardDescription>
                Carry forward unused Paid Leave to the new financial year. Run this once at the start of each FY (April 1).
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap items-end gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">From FY</Label>
                  <Input type="number" value={fyFrom} onChange={(e) => setFyFrom(Number(e.target.value))} className="h-8 w-24 text-sm" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">To FY</Label>
                  <Input type="number" value={fyTo} onChange={(e) => setFyTo(Number(e.target.value))} className="h-8 w-24 text-sm" />
                </div>
                <Button size="sm" variant="outline" onClick={handleFYReset} disabled={resettingFY} className="text-amber-700 border-amber-300 hover:bg-amber-50">
                  {resettingFY && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
                  Run FY Reset
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Per-employee quota overrides */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Individual Quota Overrides</CardTitle>
              <CardDescription>Adjust specific employees' annual leave quota (e.g. someone earning extra days)</CardDescription>
            </CardHeader>
            <CardContent>
              {teamLoading ? (
                <div className="space-y-2">{[1,2,3].map((i) => <div key={i} className="h-10 rounded-xl bg-muted animate-pulse" />)}</div>
              ) : teamOverview.length === 0 ? (
                <Empty icon={Users} text="No employees found." />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-muted-foreground text-xs">
                        <th className="text-left pb-2 pr-4 font-medium">Employee</th>
                        {policies.filter((p) => !p.isUnlimited && p.isActive).map((p) => (
                          <th key={p.leaveType} className="text-center pb-2 px-2 font-medium">{p.label}</th>
                        ))}
                        <th className="text-center pb-2 px-2 font-medium w-16">Edit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {teamOverview.map((u) => (
                        <Fragment key={u.id}>
                          <tr className={`border-b ${editingUserId === u.id ? 'bg-muted/30' : 'hover:bg-muted/20'}`}>
                            <td className="py-2.5 pr-4">
                              <p className="font-medium">{u.profile?.firstName} {u.profile?.lastName}</p>
                              <p className="text-xs text-muted-foreground font-mono">{u.profile?.employeeId}</p>
                            </td>
                            {policies.filter((p) => !p.isUnlimited && p.isActive).map((p) => {
                              const b    = u.leaveBalances.find((x) => x.leaveType === p.leaveType);
                              const left = b ? Math.max(b.total - b.used, 0) : 0;
                              return (
                                <td key={p.leaveType} className="text-center py-2.5 px-2">
                                  <span className="text-xs" style={{ color: '#361963' }}>{left}/{b?.total ?? 0}</span>
                                </td>
                              );
                            })}
                            <td className="text-center py-2.5 px-2">
                              {editingUserId === u.id ? (
                                <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setEditingUserId(null)}><X className="h-3 w-3" /></Button>
                              ) : (
                                <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => openQuotaEdit(u)}><Pencil className="h-3 w-3" /></Button>
                              )}
                            </td>
                          </tr>
                          {editingUserId === u.id && (
                            <tr className="border-b bg-muted/10">
                              <td className="py-3 pr-4">
                                <p className="text-xs font-medium text-muted-foreground">Set quotas for {u.profile?.firstName}</p>
                              </td>
                              {policies.filter((p) => !p.isUnlimited && p.isActive).map((p) => (
                                <td key={p.leaveType} className="py-3 px-2">
                                  <Input type="number" min={0} value={quotaDraft[p.leaveType] ?? 0}
                                    onChange={(e) => setQuotaDraft((prev) => ({ ...prev, [p.leaveType]: Number(e.target.value) }))}
                                    className="h-7 text-xs text-center w-16 mx-auto px-1" />
                                </td>
                              ))}
                              <td className="py-3 px-2 text-center">
                                <Button size="sm" disabled={savingQuota} style={{ backgroundColor: '#361963' }} className="text-white h-7 px-2" onClick={() => handleSaveQuota(u.id)}>
                                  {savingQuota ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
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
        </div>
      )}
    </div>
  );
}

// ─── LeaveRow sub-component ───────────────────────────────────────────────────

function LeaveRow({
  leave, showEmployee, canAction, canWithdraw, actionLoading,
  onApprove, onRejectClick, onWithdraw, isAdmin, onChangeType, policies,
}: {
  leave:         LeaveRequest;
  showEmployee:  boolean;
  canAction:     boolean;
  canWithdraw:   boolean;
  actionLoading: string | null;
  onApprove:     (id: string, convertTo?: string) => void;
  onRejectClick: (id: string) => void;
  onWithdraw:    (id: string) => void;
  isAdmin:       boolean;
  onChangeType:  (id: string, newType: string) => void;
  policies:      LeavePolicy[];
}) {
  const [showTypeChange, setShowTypeChange] = useState(false);
  const [selectedType,   setSelectedType]   = useState(leave.leaveType);
  const canChangeType = isAdmin && leave.status === 'PENDING';

  // Keep selectedType in sync when the parent refreshes the leave data after a conversion
  useEffect(() => { setSelectedType(leave.leaveType); }, [leave.leaveType]);

  const handleSaveType = () => {
    if (selectedType !== leave.leaveType) onChangeType(leave.id, selectedType);
    setShowTypeChange(false);
  };

  const policyLabel = (lt: string) => policies.find((p) => p.leaveType === lt)?.label ?? lt;

  return (
    <div className="flex items-start justify-between p-4 border rounded-xl gap-4">
      <div className="flex-1 min-w-0">
        {showEmployee && leave.employee?.profile && (
          <p className="text-sm font-medium mb-1">
            {leave.employee.profile.firstName} {leave.employee.profile.lastName}
            <span className="text-muted-foreground text-xs ml-2 font-mono">{leave.employee.profile.employeeId}</span>
          </p>
        )}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold">{policyLabel(leave.leaveType)}</span>
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
                {leave.startDayType === 'FROM_SECOND_HALF' && <span className="ml-0.5 text-xs text-[#361963]"> (from 2nd half)</span>}
                {' — '}
                {formatDate(leave.endDate)}
                {leave.endDayType === 'UNTIL_FIRST_HALF' && <span className="ml-0.5 text-xs text-[#361963]"> (until 1st half)</span>}
              </>
            )}
            <span className="ml-1">({leave.totalDays === 0.5 ? '½ day' : `${leave.totalDays} day${leave.totalDays !== 1 ? 's' : ''}`})</span>
          </span>
        </div>
        <p className="text-sm text-muted-foreground mt-1 truncate">{leave.reason}</p>
        {leave.appliedById && (
          <span className="inline-flex items-center text-xs font-medium mt-1 px-2 py-0.5 rounded-full bg-violet-100 text-violet-700">
            Applied by HR{leave.appliedBy?.profile ? ` (${leave.appliedBy.profile.firstName} ${leave.appliedBy.profile.lastName})` : ''}
          </span>
        )}
        {leave.status === 'REJECTED' && leave.managerComment && (
          <p className="text-xs text-rose-600 mt-1 italic font-medium">Rejection reason: {leave.managerComment}</p>
        )}
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <span className={`text-xs font-medium px-2 py-1 rounded-full ${leaveStatusColor(leave.status)}`}>{leave.status}</span>

        {canChangeType && !showTypeChange && (
          <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-[#361963] px-2" title="Change leave type"
            onClick={() => { setSelectedType(leave.leaveType); setShowTypeChange(true); }} disabled={!!actionLoading}>
            <ArrowLeftRight className="h-3.5 w-3.5" />
          </Button>
        )}
        {canChangeType && showTypeChange && (
          <div className="flex items-center gap-1.5">
            <select value={selectedType} onChange={(e) => setSelectedType(e.target.value)}
              className="text-xs border border-input rounded-md px-2 py-1 bg-background focus:outline-none focus:ring-1 focus:ring-ring">
              {policies.filter((p) => p.isActive && p.leaveType !== 'TRAVELLING').map((p) => <option key={p.leaveType} value={p.leaveType}>{p.label}</option>)}
            </select>
            <Button size="sm" variant="outline" className="px-2 text-[#361963] border-[#361963]/40"
              onClick={handleSaveType} disabled={actionLoading === leave.id + '-changetype' || selectedType === leave.leaveType}>
              {actionLoading === leave.id + '-changetype' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
            </Button>
            <Button size="sm" variant="ghost" className="px-2 text-muted-foreground" onClick={() => setShowTypeChange(false)}>
              <X className="h-3 w-3" />
            </Button>
          </div>
        )}

        {canAction && (
          <>
            <Button size="sm" variant="outline" className="text-green-600 border-green-300 hover:bg-green-50"
              onClick={() => onApprove(leave.id, selectedType !== leave.leaveType ? selectedType : undefined)}
              disabled={!!actionLoading}>
              {actionLoading === leave.id + '-approve' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
            </Button>
            <Button size="sm" variant="outline" className="text-destructive border-destructive/30 hover:bg-destructive/10" onClick={() => onRejectClick(leave.id)} disabled={!!actionLoading}>
              {actionLoading === leave.id + '-reject' ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
            </Button>
          </>
        )}

        {canWithdraw && (
          <Button size="sm" variant="outline" className="text-destructive border-destructive/30 hover:bg-destructive/10"
            onClick={() => onWithdraw(leave.id)} disabled={actionLoading === leave.id + '-withdraw'} title="Withdraw request">
            {actionLoading === leave.id + '-withdraw' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
          </Button>
        )}
      </div>
    </div>
  );
}
