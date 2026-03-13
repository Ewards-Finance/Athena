/**
 * Athena V2 - Worklogs Page
 *
 * My Worklogs      — all roles: submit, view history, status badges
 * Team Worklogs    — Manager/Admin: view direct reports, reject/restore
 * All Worklogs     — Admin only: search all employees
 * Declare WFH      — Admin only: declare company-wide WFH days
 */

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/hooks/useAuth';
import api from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Loader2, FileText, Users, Pencil, Trash2,
  ChevronLeft, ChevronRight, Search, CalendarCheck,
  XCircle, CheckCircle, RotateCcw,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

interface WorkLog {
  id:            string;
  userId:        string;
  date:          string;
  content:       string;
  status:        'APPROVED' | 'REJECTED';
  rejectionNote: string | null;
  createdAt:     string;
}

interface TeamWorkLog extends WorkLog {
  user: {
    profile: {
      firstName:      string;
      lastName:       string;
      employeeId:     string;
      designation:    string;
      employmentType: string;
    } | null;
  };
}

interface DeclaredWFH {
  id:        string;
  date:      string;
  reason:    string | null;
  createdBy: string;
  createdAt: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC',
  });
}

function StatusBadge({ status }: { status: string }) {
  return status === 'APPROVED' ? (
    <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-green-100 text-green-700">
      <CheckCircle className="h-3 w-3" /> Approved
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-red-100 text-red-700">
      <XCircle className="h-3 w-3" /> Rejected
    </span>
  );
}

function EmployeeAvatar({ name }: { name: string }) {
  const initials = name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
  return (
    <div
      className="h-7 w-7 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
      style={{ backgroundColor: '#361963' }}
    >
      {initials}
    </div>
  );
}

function MonthNav({ month, year, onPrev, onNext }: {
  month: number; year: number; onPrev: () => void; onNext: () => void;
}) {
  return (
    <div className="flex items-center gap-1.5 border border-gray-200 rounded-lg px-2 py-1.5 bg-white">
      <button onClick={onPrev} className="p-0.5 text-gray-400 hover:text-gray-700">
        <ChevronLeft className="h-4 w-4" />
      </button>
      <span className="text-sm font-medium w-32 text-center">
        {MONTHS[month - 1]} {year}
      </span>
      <button onClick={onNext} className="p-0.5 text-gray-400 hover:text-gray-700">
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function Worklogs() {
  const { user } = useAuth();
  const isManager = user?.role === 'MANAGER' || user?.role === 'ADMIN';
  const isAdmin   = user?.role === 'ADMIN';

  type TabId = 'mine' | 'team' | 'all' | 'declare';
  const [tab, setTab] = useState<TabId>('mine');

  const tabs: { id: TabId; label: string; icon: React.ReactNode; show: boolean }[] = [
    { id: 'mine',    label: 'My Worklogs',    icon: <FileText   className="h-4 w-4" />, show: true },
    { id: 'team',    label: 'Team Worklogs',  icon: <Users      className="h-4 w-4" />, show: isManager },
    { id: 'all',     label: 'All Worklogs',   icon: <Search     className="h-4 w-4" />, show: isAdmin },
    { id: 'declare', label: 'Declare WFH',    icon: <CalendarCheck className="h-4 w-4" />, show: isAdmin },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Worklogs</h1>
        <p className="text-sm text-gray-500 mt-1">
          Submit daily work updates. Worklogs are required on WFH Saturdays and declared WFH days.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200">
        {tabs.filter(t => t.show).map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors',
              tab === t.id
                ? 'border-[#361963] text-[#361963]'
                : 'border-transparent text-gray-500 hover:text-gray-700',
            )}
          >
            {t.icon}{t.label}
          </button>
        ))}
      </div>

      {tab === 'mine'    && <MyWorklogsTab />}
      {tab === 'team'    && isManager && <TeamWorklogsTab isAdmin={isAdmin} />}
      {tab === 'all'     && isAdmin   && <AllWorklogsTab />}
      {tab === 'declare' && isAdmin   && <DeclareWFHTab />}
    </div>
  );
}

// ─── My Worklogs Tab ──────────────────────────────────────────────────────────

function MyWorklogsTab() {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year,  setYear]  = useState(now.getFullYear());

  const [date,    setDate]    = useState(today());
  const [content, setContent] = useState('');
  const [saving,  setSaving]  = useState(false);
  const [saveErr, setSaveErr] = useState('');
  const [saveOk,  setSaveOk]  = useState('');

  const [logs,     setLogs]     = useState<WorkLog[]>([]);
  const [loading,  setLoading]  = useState(false);
  const [fetchErr, setFetchErr] = useState('');

  const [editId,      setEditId]      = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [editSaving,  setEditSaving]  = useState(false);
  const [deleting,    setDeleting]    = useState<string | null>(null);

  const fetchLogs = useCallback(async () => {
    setLoading(true); setFetchErr('');
    try {
      const res = await api.get(`/worklogs/mine?month=${month}&year=${year}`);
      setLogs(res.data);
    } catch (err: any) {
      setFetchErr(err.response?.data?.error || 'Failed to load');
    } finally { setLoading(false); }
  }, [month, year]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true); setSaveErr(''); setSaveOk('');
    try {
      await api.post('/worklogs', { date, content });
      setSaveOk('Worklog saved successfully.');
      setContent('');
      fetchLogs();
    } catch (err: any) {
      setSaveErr(err.response?.data?.error || 'Failed to save worklog');
    } finally { setSaving(false); }
  };

  const handleEdit = async (id: string) => {
    setEditSaving(true);
    try {
      await api.put(`/worklogs/${id}`, { content: editContent });
      setEditId(null); fetchLogs();
    } catch { /* keep open */ } finally { setEditSaving(false); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this worklog?')) return;
    setDeleting(id);
    try { await api.delete(`/worklogs/${id}`); fetchLogs(); }
    catch { /* no-op */ } finally { setDeleting(null); }
  };

  const prev = () => { if (month === 1) { setMonth(12); setYear(y => y - 1); } else setMonth(m => m - 1); };
  const next = () => { if (month === 12) { setMonth(1); setYear(y => y + 1); } else setMonth(m => m + 1); };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
      {/* Submit Form */}
      <Card className="lg:col-span-2">
        <CardHeader><CardTitle className="text-base">Submit Worklog</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-700">Date</label>
              <input
                type="date"
                value={date}
                max={today()}
                onChange={e => setDate(e.target.value)}
                required
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#361963]/40"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-700">Work Summary</label>
              <textarea
                value={content}
                onChange={e => setContent(e.target.value)}
                required rows={8}
                placeholder="Describe what you worked on today..."
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-[#361963]/40"
              />
              <p className="text-xs text-gray-400">{content.length} / 10,000</p>
            </div>
            {saveErr && <p className="text-sm text-red-600">{saveErr}</p>}
            {saveOk  && <p className="text-sm text-green-600">{saveOk}</p>}
            <Button type="submit" disabled={saving} className="w-full" style={{ backgroundColor: '#361963' }}>
              {saving ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Saving…</> : 'Submit Worklog'}
            </Button>
          </form>
          <p className="text-xs text-gray-400 mt-3">
            Re-submitting for the same date overwrites the existing entry and resets status to Approved.
          </p>
        </CardContent>
      </Card>

      {/* History */}
      <div className="lg:col-span-3 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-gray-800">My History</h2>
          <MonthNav month={month} year={year} onPrev={prev} onNext={next} />
        </div>

        {loading && <div className="flex items-center justify-center py-12 text-gray-400"><Loader2 className="h-5 w-5 animate-spin mr-2" />Loading…</div>}
        {fetchErr && <p className="text-sm text-red-600">{fetchErr}</p>}

        {!loading && logs.length === 0 && (
          <div className="text-center py-12 text-gray-400">
            <FileText className="h-8 w-8 mx-auto mb-2 opacity-40" />
            <p className="text-sm">No worklogs for {MONTHS[month - 1]} {year}.</p>
          </div>
        )}

        <div className="space-y-3">
          {logs.map((log) => (
            <Card key={log.id} className="border border-gray-200">
              <CardContent className="pt-4">
                {editId === log.id ? (
                  <div className="space-y-3">
                    <textarea
                      value={editContent}
                      onChange={e => setEditContent(e.target.value)}
                      rows={6}
                      className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-[#361963]/40"
                    />
                    <div className="flex gap-2">
                      <Button size="sm" disabled={editSaving} onClick={() => handleEdit(log.id)} style={{ backgroundColor: '#361963' }}>
                        {editSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Save'}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setEditId(null)}>Cancel</Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-gray-800">{fmtDate(log.date)}</span>
                        <StatusBadge status={log.status} />
                      </div>
                      <div className="flex gap-1">
                        <button
                          className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600"
                          onClick={() => { setEditId(log.id); setEditContent(log.content); }}
                          title="Edit"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          className="p-1.5 rounded hover:bg-red-50 text-gray-400 hover:text-red-500"
                          onClick={() => handleDelete(log.id)}
                          disabled={deleting === log.id}
                          title="Delete"
                        >
                          {deleting === log.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                        </button>
                      </div>
                    </div>
                    {log.status === 'REJECTED' && log.rejectionNote && (
                      <div className="mb-2 text-xs text-red-600 bg-red-50 border border-red-100 rounded px-2 py-1.5">
                        Rejection note: {log.rejectionNote}
                      </div>
                    )}
                    <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{log.content}</p>
                  </>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Team Worklogs Tab (Manager/Admin) ────────────────────────────────────────

function TeamWorklogsTab({ isAdmin }: { isAdmin: boolean }) {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year,  setYear]  = useState(now.getFullYear());
  const [selectedUser, setSelectedUser] = useState('all');

  const [logs,     setLogs]     = useState<TeamWorkLog[]>([]);
  const [loading,  setLoading]  = useState(false);
  const [fetchErr, setFetchErr] = useState('');

  // Reject state
  const [rejectingId,   setRejectingId]   = useState<string | null>(null);
  const [rejectNote,    setRejectNote]    = useState('');
  const [rejectSaving,  setRejectSaving]  = useState(false);
  const [restoringId,   setRestoringId]   = useState<string | null>(null);

  const endpoint = isAdmin ? '/worklogs/team' : '/worklogs/team';

  const fetchTeam = useCallback(async () => {
    setLoading(true); setFetchErr('');
    try {
      const params = new URLSearchParams({ month: String(month), year: String(year) });
      if (selectedUser !== 'all') params.set('userId', selectedUser);
      const res = await api.get(`${endpoint}?${params}`);
      setLogs(res.data);
    } catch (err: any) {
      setFetchErr(err.response?.data?.error || 'Failed to load');
    } finally { setLoading(false); }
  }, [month, year, selectedUser]);

  useEffect(() => { fetchTeam(); }, [fetchTeam]);

  const handleReject = async (id: string) => {
    setRejectSaving(true);
    try {
      await api.put(`/worklogs/${id}/reject`, { rejectionNote: rejectNote || undefined });
      setRejectingId(null); setRejectNote(''); fetchTeam();
    } catch { /* keep open */ } finally { setRejectSaving(false); }
  };

  const handleRestore = async (id: string) => {
    setRestoringId(id);
    try { await api.put(`/worklogs/${id}/restore`); fetchTeam(); }
    catch { /* no-op */ } finally { setRestoringId(null); }
  };

  const teamMembers = Array.from(
    new Map(logs.map(l => [l.userId, l.user?.profile])).entries()
  );

  const prev = () => { if (month === 1) { setMonth(12); setYear(y => y - 1); } else setMonth(m => m - 1); };
  const next = () => { if (month === 12) { setMonth(1); setYear(y => y + 1); } else setMonth(m => m + 1); };

  const groupedByDate: Record<string, TeamWorkLog[]> = {};
  for (const log of logs) {
    const key = log.date.slice(0, 10);
    if (!groupedByDate[key]) groupedByDate[key] = [];
    groupedByDate[key].push(log);
  }
  const sortedDates = Object.keys(groupedByDate).sort((a, b) => b.localeCompare(a));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <MonthNav month={month} year={year} onPrev={prev} onNext={next} />
        <select
          value={selectedUser}
          onChange={e => setSelectedUser(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#361963]/40"
        >
          <option value="all">All Team Members</option>
          {teamMembers.map(([uid, p]) => (
            <option key={uid} value={uid}>
              {p ? `${p.firstName} ${p.lastName}` : uid}
            </option>
          ))}
        </select>
        <span className="text-sm text-gray-400 ml-auto">{logs.length} entr{logs.length === 1 ? 'y' : 'ies'}</span>
      </div>

      {loading && <div className="flex items-center justify-center py-16 text-gray-400"><Loader2 className="h-5 w-5 animate-spin mr-2" />Loading…</div>}
      {fetchErr && <p className="text-sm text-red-600">{fetchErr}</p>}

      {!loading && logs.length === 0 && (
        <div className="text-center py-16 text-gray-400">
          <Users className="h-8 w-8 mx-auto mb-2 opacity-40" />
          <p className="text-sm">No team worklogs found for {MONTHS[month - 1]} {year}.</p>
        </div>
      )}

      {sortedDates.map((dateKey) => (
        <div key={dateKey} className="space-y-2">
          <div className="flex items-center gap-3">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
              {fmtDate(dateKey + 'T00:00:00.000Z')}
            </span>
            <div className="flex-1 h-px bg-gray-200" />
            <span className="text-xs text-gray-400">{groupedByDate[dateKey].length} member{groupedByDate[dateKey].length > 1 ? 's' : ''}</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {groupedByDate[dateKey].map((log) => {
              const p    = log.user?.profile;
              const name = p ? `${p.firstName} ${p.lastName}` : 'Unknown';
              return (
                <Card key={log.id} className="border border-gray-200">
                  <CardContent className="pt-4">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <EmployeeAvatar name={name} />
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-gray-800 truncate">{name}</p>
                          <p className="text-xs text-gray-400 truncate">
                            {p?.employeeId}{p?.designation ? ` · ${p.designation}` : ''}
                            {p?.employmentType ? ` · ${p.employmentType === 'INTERN' ? 'Intern' : 'Full Time'}` : ''}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                        <StatusBadge status={log.status} />
                        {log.status === 'APPROVED' ? (
                          <button
                            className="p-1.5 rounded hover:bg-red-50 text-gray-400 hover:text-red-500"
                            title="Reject worklog"
                            onClick={() => { setRejectingId(log.id); setRejectNote(''); }}
                          >
                            <XCircle className="h-4 w-4" />
                          </button>
                        ) : (
                          <button
                            className="p-1.5 rounded hover:bg-green-50 text-gray-400 hover:text-green-600"
                            title="Restore worklog"
                            disabled={restoringId === log.id}
                            onClick={() => handleRestore(log.id)}
                          >
                            {restoringId === log.id
                              ? <Loader2 className="h-4 w-4 animate-spin" />
                              : <RotateCcw className="h-4 w-4" />}
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Rejection inline form */}
                    {rejectingId === log.id && (
                      <div className="mb-3 space-y-2 bg-red-50 border border-red-100 rounded-md p-3">
                        <p className="text-xs font-medium text-red-700">Rejection note (optional)</p>
                        <input
                          type="text"
                          value={rejectNote}
                          onChange={e => setRejectNote(e.target.value)}
                          placeholder="Reason for rejection…"
                          className="w-full border border-red-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-red-300"
                        />
                        <div className="flex gap-2">
                          <Button size="sm" disabled={rejectSaving} onClick={() => handleReject(log.id)}
                            className="bg-red-600 hover:bg-red-700 text-white h-7 text-xs">
                            {rejectSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Confirm Reject'}
                          </Button>
                          <Button size="sm" variant="outline" className="h-7 text-xs"
                            onClick={() => { setRejectingId(null); setRejectNote(''); }}>
                            Cancel
                          </Button>
                        </div>
                      </div>
                    )}

                    {log.status === 'REJECTED' && log.rejectionNote && (
                      <div className="mb-2 text-xs text-red-600 bg-red-50 border border-red-100 rounded px-2 py-1.5">
                        Rejection note: {log.rejectionNote}
                      </div>
                    )}

                    <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{log.content}</p>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── All Worklogs Tab (Admin) ─────────────────────────────────────────────────

function AllWorklogsTab() {
  const now = new Date();
  const [month,  setMonth]  = useState(now.getMonth() + 1);
  const [year,   setYear]   = useState(now.getFullYear());
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  const [logs,     setLogs]     = useState<TeamWorkLog[]>([]);
  const [loading,  setLoading]  = useState(false);
  const [fetchErr, setFetchErr] = useState('');

  const [rejectingId,  setRejectingId]  = useState<string | null>(null);
  const [rejectNote,   setRejectNote]   = useState('');
  const [rejectSaving, setRejectSaving] = useState(false);
  const [restoringId,  setRestoringId]  = useState<string | null>(null);

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const fetchAll = useCallback(async () => {
    setLoading(true); setFetchErr('');
    try {
      const params = new URLSearchParams({ month: String(month), year: String(year) });
      if (debouncedSearch) params.set('search', debouncedSearch);
      const res = await api.get(`/worklogs/all?${params}`);
      setLogs(res.data);
    } catch (err: any) {
      setFetchErr(err.response?.data?.error || 'Failed to load');
    } finally { setLoading(false); }
  }, [month, year, debouncedSearch]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const handleReject = async (id: string) => {
    setRejectSaving(true);
    try {
      await api.put(`/worklogs/${id}/reject`, { rejectionNote: rejectNote || undefined });
      setRejectingId(null); setRejectNote(''); fetchAll();
    } catch { /* keep open */ } finally { setRejectSaving(false); }
  };

  const handleRestore = async (id: string) => {
    setRestoringId(id);
    try { await api.put(`/worklogs/${id}/restore`); fetchAll(); }
    catch { /* no-op */ } finally { setRestoringId(null); }
  };

  const prev = () => { if (month === 1) { setMonth(12); setYear(y => y - 1); } else setMonth(m => m - 1); };
  const next = () => { if (month === 12) { setMonth(1); setYear(y => y + 1); } else setMonth(m => m + 1); };

  const groupedByDate: Record<string, TeamWorkLog[]> = {};
  for (const log of logs) {
    const key = log.date.slice(0, 10);
    if (!groupedByDate[key]) groupedByDate[key] = [];
    groupedByDate[key].push(log);
  }
  const sortedDates = Object.keys(groupedByDate).sort((a, b) => b.localeCompare(a));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <MonthNav month={month} year={year} onPrev={prev} onNext={next} />
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input
            placeholder="Search by name or employee ID…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9 h-9 text-sm"
          />
        </div>
        <span className="text-sm text-gray-400">{logs.length} entr{logs.length === 1 ? 'y' : 'ies'}</span>
      </div>

      {loading && <div className="flex items-center justify-center py-16 text-gray-400"><Loader2 className="h-5 w-5 animate-spin mr-2" />Loading…</div>}
      {fetchErr && <p className="text-sm text-red-600">{fetchErr}</p>}

      {!loading && logs.length === 0 && (
        <div className="text-center py-16 text-gray-400">
          <FileText className="h-8 w-8 mx-auto mb-2 opacity-40" />
          <p className="text-sm">No worklogs found{search ? ` for "${search}"` : ''} in {MONTHS[month - 1]} {year}.</p>
        </div>
      )}

      {sortedDates.map((dateKey) => (
        <div key={dateKey} className="space-y-2">
          <div className="flex items-center gap-3">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
              {fmtDate(dateKey + 'T00:00:00.000Z')}
            </span>
            <div className="flex-1 h-px bg-gray-200" />
            <span className="text-xs text-gray-400">{groupedByDate[dateKey].length} entr{groupedByDate[dateKey].length === 1 ? 'y' : 'ies'}</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {groupedByDate[dateKey].map((log) => {
              const p    = log.user?.profile;
              const name = p ? `${p.firstName} ${p.lastName}` : 'Unknown';
              return (
                <Card key={log.id} className="border border-gray-200">
                  <CardContent className="pt-4">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <EmployeeAvatar name={name} />
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-gray-800 truncate">{name}</p>
                          <p className="text-xs text-gray-400 truncate">
                            {p?.employeeId}
                            {p?.employmentType && (
                              <span className={`ml-1.5 px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                p.employmentType === 'INTERN' ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'
                              }`}>
                                {p.employmentType === 'INTERN' ? 'Intern' : 'Full Time'}
                              </span>
                            )}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                        <StatusBadge status={log.status} />
                        {log.status === 'APPROVED' ? (
                          <button
                            className="p-1.5 rounded hover:bg-red-50 text-gray-400 hover:text-red-500"
                            title="Reject" onClick={() => { setRejectingId(log.id); setRejectNote(''); }}>
                            <XCircle className="h-4 w-4" />
                          </button>
                        ) : (
                          <button
                            className="p-1.5 rounded hover:bg-green-50 text-gray-400 hover:text-green-600"
                            title="Restore" disabled={restoringId === log.id}
                            onClick={() => handleRestore(log.id)}>
                            {restoringId === log.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                          </button>
                        )}
                      </div>
                    </div>

                    {rejectingId === log.id && (
                      <div className="mb-3 space-y-2 bg-red-50 border border-red-100 rounded-md p-3">
                        <p className="text-xs font-medium text-red-700">Rejection note (optional)</p>
                        <input
                          type="text" value={rejectNote}
                          onChange={e => setRejectNote(e.target.value)}
                          placeholder="Reason for rejection…"
                          className="w-full border border-red-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-red-300"
                        />
                        <div className="flex gap-2">
                          <Button size="sm" disabled={rejectSaving} onClick={() => handleReject(log.id)}
                            className="bg-red-600 hover:bg-red-700 text-white h-7 text-xs">
                            {rejectSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Confirm Reject'}
                          </Button>
                          <Button size="sm" variant="outline" className="h-7 text-xs"
                            onClick={() => { setRejectingId(null); setRejectNote(''); }}>Cancel</Button>
                        </div>
                      </div>
                    )}

                    {log.status === 'REJECTED' && log.rejectionNote && (
                      <div className="mb-2 text-xs text-red-600 bg-red-50 border border-red-100 rounded px-2 py-1.5">
                        Rejection note: {log.rejectionNote}
                      </div>
                    )}

                    <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed line-clamp-5">{log.content}</p>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Declare WFH Tab (Admin) ──────────────────────────────────────────────────

function DeclareWFHTab() {
  const [days,    setDays]    = useState<DeclaredWFH[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetchErr, setFetchErr] = useState('');

  const [date,    setDate]    = useState('');
  const [reason,  setReason]  = useState('');
  const [saving,  setSaving]  = useState(false);
  const [saveErr, setSaveErr] = useState('');
  const [saveOk,  setSaveOk]  = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchDays = useCallback(async () => {
    setLoading(true); setFetchErr('');
    try {
      const res = await api.get('/worklogs/declared-wfh');
      setDays(res.data);
    } catch (err: any) {
      setFetchErr(err.response?.data?.error || 'Failed to load');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchDays(); }, [fetchDays]);

  const handleDeclare = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true); setSaveErr(''); setSaveOk('');
    try {
      await api.post('/worklogs/declared-wfh', { date, reason: reason || undefined });
      setSaveOk('WFH day declared.');
      setDate(''); setReason('');
      fetchDays();
    } catch (err: any) {
      setSaveErr(err.response?.data?.error || 'Failed to declare WFH day');
    } finally { setSaving(false); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Remove this declared WFH day?')) return;
    setDeletingId(id);
    try { await api.delete(`/worklogs/declared-wfh/${id}`); fetchDays(); }
    catch { /* no-op */ } finally { setDeletingId(null); }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
      {/* Declare Form */}
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="text-base">Declare a WFH Day</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleDeclare} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-700">Date</label>
              <input
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
                required
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#361963]/40"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-700">Reason <span className="text-gray-400 text-xs">(optional)</span></label>
              <textarea
                value={reason}
                onChange={e => setReason(e.target.value)}
                rows={3}
                placeholder="e.g. Office closed due to flooding"
                maxLength={300}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[#361963]/40"
              />
            </div>
            {saveErr && <p className="text-sm text-red-600">{saveErr}</p>}
            {saveOk  && <p className="text-sm text-green-600">{saveOk}</p>}
            <Button type="submit" disabled={saving} className="w-full" style={{ backgroundColor: '#361963' }}>
              {saving ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Declaring…</> : 'Declare WFH Day'}
            </Button>
          </form>
          <p className="text-xs text-gray-400 mt-3">
            All employees must submit a worklog for declared WFH dates. Missing entries result in 1 LWP day each in payroll.
          </p>
        </CardContent>
      </Card>

      {/* Declared Days List */}
      <div className="lg:col-span-3 space-y-4">
        <h2 className="font-semibold text-gray-800">Declared WFH Days</h2>

        {loading && <div className="flex items-center justify-center py-12 text-gray-400"><Loader2 className="h-5 w-5 animate-spin mr-2" />Loading…</div>}
        {fetchErr && <p className="text-sm text-red-600">{fetchErr}</p>}

        {!loading && days.length === 0 && (
          <div className="text-center py-12 text-gray-400">
            <CalendarCheck className="h-8 w-8 mx-auto mb-2 opacity-40" />
            <p className="text-sm">No WFH days declared yet.</p>
          </div>
        )}

        <div className="space-y-2">
          {days.map((day) => (
            <div
              key={day.id}
              className="flex items-center justify-between border border-gray-200 rounded-lg px-4 py-3 bg-white"
            >
              <div>
                <p className="text-sm font-semibold text-gray-800">{fmtDate(day.date)}</p>
                {day.reason && <p className="text-xs text-gray-500 mt-0.5">{day.reason}</p>}
              </div>
              <button
                className="p-1.5 rounded hover:bg-red-50 text-gray-400 hover:text-red-500"
                onClick={() => handleDelete(day.id)}
                disabled={deletingId === day.id}
                title="Remove"
              >
                {deletingId === day.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
