/**
 * Athena V2 - Attendance Page
 *
 * Admin tabs:
 *   Records  — monthly summary per employee (days present, hours)
 *   Import   — upload ZKTeco .txt file + history of past imports
 *   Mapping  — manage EnNo ↔ Employee mappings, see unresolved EnNos
 *
 * Employee / Manager tab:
 *   My Attendance — own daily check-in/check-out records
 */

import { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/hooks/useAuth';
import api from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Loader2, Upload, Trash2, Plus, AlertCircle, Pencil, Check, X, ChevronDown, ChevronUp, MapPin } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SummaryRow {
  userId:             string;
  daysPresent:        number; // weekday punches + weekends
  weekdayDaysPresent: number; // actual biometric punch days
  weekendDays:        number;
  totalHours:         number;
  avgHours:           number;
  lateCount:          number;
  totalLwpDeduction:  number;
  profile: {
    firstName:  string;
    lastName:   string;
    employeeId: string;
    department: string;
  } | null;
}

interface AttendanceRecord {
  id:            string;
  userId:        string;
  date:          string;
  checkIn:       string | null;
  checkInManual: string | null;
  checkOut:      string | null;
  hoursWorked:   number | null;
  isLate:        boolean;
  lwpDeduction:  number;
  user: {
    profile: { firstName: string; lastName: string; employeeId: string; department: string } | null;
  };
}

interface ImportBatch {
  id:             string;
  month:          number;
  year:           number;
  fileName:       string;
  importedBy:     string;
  recordCount:    number;
  unmappedEnNos:  number[];
  arrivalTime:    string | null;
  extensionDates: string[]; // "YYYY-MM-DD" — days with 11:00 AM cutoff
  createdAt:      string;
  _count:         { records: number };
}

interface PunchMapping {
  id:     string;
  enNo:   number;
  userId: string;
  label:  string | null;
  user: {
    profile: { firstName: string; lastName: string; employeeId: string; department: string } | null;
  };
}

interface Employee {
  id:      string;
  email:   string;
  profile: { firstName: string; lastName: string; employeeId: string } | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MONTHS = ['','January','February','March','April','May','June',
                'July','August','September','October','November','December'];

const MONTH_SHORT = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function fmtTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', weekday: 'short' });
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function Attendance() {
  const { user } = useAuth();
  const isAdmin   = user?.role === 'ADMIN' || user?.role === 'OWNER';
  const isManager = user?.role === 'MANAGER';

  const now = new Date();
  const [tab, setTab]     = useState<'records' | 'import' | 'mapping' | 'mine' | 'exceptions' | 'team'>(
    isAdmin ? 'records' : 'mine'
  );
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear]   = useState(now.getFullYear());

  // ── Records (admin summary + daily detail) ──────────────────────────────
  const [summary, setSummary]               = useState<SummaryRow[]>([]);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError]     = useState('');
  const [allRecords, setAllRecords]         = useState<AttendanceRecord[]>([]);
  const [currentImport, setCurrentImport]   = useState<ImportBatch | null>(null);
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);

  // Late policy
  const [arrivalTime, setArrivalTime]       = useState('10:00');
  const [applyingPolicy, setApplyingPolicy] = useState(false);
  const [policyError, setPolicyError]       = useState('');

  // Extension dates
  const [extensionDates, setExtensionDates]         = useState<string[]>([]);
  const [extensionDateInput, setExtensionDateInput] = useState('');
  const [savingExtDates, setSavingExtDates]         = useState(false);
  const [extDatesError, setExtDatesError]           = useState('');

  // Manual check-in edit
  const [editingRecordId, setEditingRecordId] = useState<string | null>(null);
  const [editCheckIn, setEditCheckIn]         = useState('');
  const [savingCheckIn, setSavingCheckIn]     = useState(false);

  // Absence auto-marking
  const [showAbsenceModal, setShowAbsenceModal] = useState(false);
  const [absFromDate, setAbsFromDate]           = useState('');
  const [absToDate, setAbsToDate]               = useState('');
  const [markingAbsences, setMarkingAbsences]   = useState(false);
  const [absenceResult, setAbsenceResult]       = useState<string>('');

  // Attendance adjustments
  // Map of userId → adjustmentDays (draft, not yet saved)
  const [adjustments, setAdjustments]         = useState<Record<string, number>>({});
  const [adjustmentReasons, setAdjReasons]    = useState<Record<string, string>>({});
  const [savingAdj, setSavingAdj]             = useState<Record<string, boolean>>({});
  const [adjSaved, setAdjSaved]               = useState<Record<string, boolean>>({});

  // Exception inbox
  const [exceptions, setExceptions]           = useState<any>(null);
  const [exceptionsLoading, setExceptionsLoading] = useState(false);

  const fetchExceptions = async () => {
    setExceptionsLoading(true);
    try {
      const res = await api.get(`/attendance/exceptions?month=${month}&year=${year}`);
      setExceptions(res.data);
    } catch { setExceptions(null); }
    finally { setExceptionsLoading(false); }
  };

  const fetchSummary = async () => {
    setSummaryLoading(true);
    setSummaryError('');
    try {
      const [sumRes, recRes] = await Promise.all([
        api.get(`/attendance/summary?month=${month}&year=${year}`),
        api.get(`/attendance/records?month=${month}&year=${year}`),
      ]);
      setSummary(sumRes.data);
      setAllRecords(recRes.data);
      setExpandedUserId(null);

      // Admin-only: fetch import batch info and adjustments
      if (isAdmin) {
        const [impRes, adjRes] = await Promise.all([
          api.get('/attendance/imports'),
          api.get(`/attendance/adjustments?month=${month}&year=${year}`),
        ]);
        const imp = (impRes.data as ImportBatch[]).find((i) => i.month === month && i.year === year) ?? null;
        setCurrentImport(imp);
        setArrivalTime(imp?.arrivalTime ?? '10:00');
        setExtensionDates(imp?.extensionDates ?? []);
        setExtensionDateInput('');
        setExtDatesError('');
        setPolicyError('');
        const adjMap: Record<string, number> = {};
        const reasonMap: Record<string, string> = {};
        for (const a of adjRes.data) {
          adjMap[a.userId]    = a.adjustmentDays;
          reasonMap[a.userId] = a.reason ?? '';
        }
        setAdjustments(adjMap);
        setAdjReasons(reasonMap);
        setSavingAdj({});
        setAdjSaved({});
      }
    } catch {
      setSummaryError('Failed to load attendance data.');
    } finally {
      setSummaryLoading(false);
    }
  };

  const handleApplyLatePolicy = async () => {
    if (!currentImport) return;
    setApplyingPolicy(true);
    setPolicyError('');
    try {
      await api.post(`/attendance/imports/${currentImport.id}/apply-late-policy`, { arrivalTime });
      await fetchSummary();
    } catch (err: any) {
      setPolicyError(err?.response?.data?.error ?? 'Failed to apply late policy.');
    } finally {
      setApplyingPolicy(false);
    }
  };

  const handleSaveExtensionDates = async (newDates: string[]) => {
    if (!currentImport) return;
    setSavingExtDates(true);
    setExtDatesError('');
    try {
      await api.put(`/attendance/imports/${currentImport.id}/extension-dates`, { dates: newDates });
      setExtensionDates(newDates);
      // arrivalTime is cleared on backend — reflect in UI
      setCurrentImport((prev) => prev ? { ...prev, arrivalTime: null, extensionDates: newDates } : prev);
    } catch (err: any) {
      setExtDatesError(err?.response?.data?.error ?? 'Failed to save extension dates.');
    } finally {
      setSavingExtDates(false);
    }
  };

  const handleAddExtensionDate = () => {
    if (!extensionDateInput) return;
    if (extensionDates.includes(extensionDateInput)) {
      setExtDatesError('This date is already added.');
      return;
    }
    const newDates = [...extensionDates, extensionDateInput].sort();
    setExtDatesError('');
    handleSaveExtensionDates(newDates);
    setExtensionDateInput('');
  };

  const handleRemoveExtensionDate = (date: string) => {
    handleSaveExtensionDates(extensionDates.filter((d) => d !== date));
  };

  const handleSaveCheckIn = async (record: AttendanceRecord) => {
    if (!editCheckIn) return;
    setSavingCheckIn(true);
    try {
      // Build local datetime string from the record's UTC date + entered time
      const d = new Date(record.date);
      const dateStr = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
      const checkInManual = `${dateStr}T${editCheckIn}:00`;
      await api.put(`/attendance/records/${record.id}`, { checkInManual });
      // Refresh data (import arrival time is cleared by backend, need to refetch)
      await fetchSummary();
      setEditingRecordId(null);
    } catch (err: any) {
      alert(err?.response?.data?.error ?? 'Failed to save check-in time.');
    } finally {
      setSavingCheckIn(false);
    }
  };

  const handleClearCheckIn = async (record: AttendanceRecord) => {
    if (!confirm('Remove the manual check-in override for this record?')) return;
    try {
      await api.put(`/attendance/records/${record.id}`, { checkInManual: null });
      await fetchSummary();
    } catch (err: any) {
      alert(err?.response?.data?.error ?? 'Failed to clear check-in override.');
    }
  };

  // ── My Records (employee) ────────────────────────────────────────────────
  const [myRecords, setMyRecords]           = useState<AttendanceRecord[]>([]);
  const [myLoading, setMyLoading]           = useState(false);
  const [myError, setMyError]               = useState('');

  const fetchMyRecords = async () => {
    setMyLoading(true);
    setMyError('');
    try {
      const res = await api.get(`/attendance/records?month=${month}&year=${year}`);
      setMyRecords(res.data);
    } catch {
      setMyError('Failed to load attendance records.');
    } finally {
      setMyLoading(false);
    }
  };

  // ── Import ───────────────────────────────────────────────────────────────
  const [imports, setImports]               = useState<ImportBatch[]>([]);
  const [importsLoading, setImportsLoading] = useState(false);
  const [importResult, setImportResult]     = useState<{
    saved: number; month: number; year: number; unmappedEnNos: number[];
  } | null>(null);
  const [importing, setImporting]           = useState(false);
  const [importError, setImportError]       = useState('');
  const [deletingImport, setDeletingImport] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchImports = async () => {
    setImportsLoading(true);
    try {
      const res = await api.get('/attendance/imports');
      setImports(res.data);
    } catch {
      // silent
    } finally {
      setImportsLoading(false);
    }
  };

  const saveAdjustment = async (userId: string) => {
    setSavingAdj((p) => ({ ...p, [userId]: true }));
    setAdjSaved((p) => ({ ...p, [userId]: false }));
    try {
      const days = adjustments[userId] ?? 0;
      await api.put(`/attendance/adjustments/${userId}`, {
        month,
        year,
        adjustmentDays: days,
        reason: adjustmentReasons[userId] ?? '',
      });
      setAdjSaved((p) => ({ ...p, [userId]: true }));
      setTimeout(() => setAdjSaved((p) => ({ ...p, [userId]: false })), 2000);
    } catch {
      // silently fail — user can retry
    } finally {
      setSavingAdj((p) => ({ ...p, [userId]: false }));
    }
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportError('');
    setImportResult(null);
    setImporting(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await api.post('/attendance/import', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setImportResult(res.data);
      fetchImports();
    } catch (err: any) {
      setImportError(err?.response?.data?.error ?? 'Import failed. Please try again.');
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDeleteImport = async (id: string, month: number, year: number) => {
    if (!confirm(`Delete attendance import for ${MONTHS[month]} ${year}? All ${MONTHS[month]} records will be lost.`)) return;
    setDeletingImport(id);
    try {
      await api.delete(`/attendance/imports/${id}`);
      setImports((prev) => prev.filter((i) => i.id !== id));
      if (importResult?.month === month && importResult?.year === year) setImportResult(null);
    } catch (err: any) {
      alert(err?.response?.data?.error ?? 'Failed to delete import.');
    } finally {
      setDeletingImport(null);
    }
  };

  // ── Mapping ──────────────────────────────────────────────────────────────
  const [mappings, setMappings]             = useState<PunchMapping[]>([]);
  const [mappingsLoading, setMappingsLoading] = useState(false);
  const [employees, setEmployees]           = useState<Employee[]>([]);
  const [newEnNo, setNewEnNo]               = useState('');
  const [newUserId, setNewUserId]           = useState('');
  const [newLabel, setNewLabel]             = useState('');
  const [addingMapping, setAddingMapping]   = useState(false);
  const [mappingError, setMappingError]     = useState('');
  const [deletingMapping, setDeletingMapping] = useState<string | null>(null);
  const [unresolvedEnNos, setUnresolvedEnNos] = useState<number[]>([]);

  const fetchMappings = async () => {
    setMappingsLoading(true);
    try {
      const [mRes, eRes, iRes] = await Promise.all([
        api.get('/attendance/mappings'),
        api.get('/employees'),
        api.get('/attendance/imports'),
      ]);
      setMappings(mRes.data);
      setEmployees(eRes.data);
      // Compute unresolved: EnNos from all imports not yet in mappings
      const allMapped = new Set<number>((mRes.data as PunchMapping[]).map((m) => m.enNo));
      const allUnmapped = new Set<number>();
      for (const imp of iRes.data as ImportBatch[]) {
        for (const en of imp.unmappedEnNos ?? []) allUnmapped.add(en);
      }
      const stillUnresolved = Array.from(allUnmapped).filter((en) => !allMapped.has(en)).sort((a, b) => a - b);
      setUnresolvedEnNos(stillUnresolved);
    } catch {
      // silent
    } finally {
      setMappingsLoading(false);
    }
  };

  const handleAddMapping = async () => {
    setMappingError('');
    const enNoInt = parseInt(newEnNo, 10);
    if (isNaN(enNoInt) || enNoInt < 1) { setMappingError('Enter a valid EnNo (positive integer).'); return; }
    if (!newUserId) { setMappingError('Select an employee.'); return; }
    setAddingMapping(true);
    try {
      await api.post('/attendance/mappings', {
        enNo:   enNoInt,
        userId: newUserId,
        label:  newLabel || undefined,
      });
      setNewEnNo(''); setNewUserId(''); setNewLabel('');
      fetchMappings();
    } catch (err: any) {
      setMappingError(err?.response?.data?.error ?? 'Failed to add mapping.');
    } finally {
      setAddingMapping(false);
    }
  };

  const handleDeleteMapping = async (id: string) => {
    if (!confirm('Remove this mapping?')) return;
    setDeletingMapping(id);
    try {
      await api.delete(`/attendance/mappings/${id}`);
      setMappings((prev) => prev.filter((m) => m.id !== id));
    } catch (err: any) {
      alert(err?.response?.data?.error ?? 'Failed to delete mapping.');
    } finally {
      setDeletingMapping(null);
    }
  };

  // ── Effects ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (tab === 'records' && isAdmin)    fetchSummary();
    if (tab === 'team'    && isManager)  fetchSummary();
    if (tab === 'mine')                  fetchMyRecords();
    if (tab === 'import'  && isAdmin)    fetchImports();
    if (tab === 'mapping' && isAdmin)    fetchMappings();
    if (tab === 'exceptions' && isAdmin) fetchExceptions();
  }, [tab]);

  // Re-fetch when month/year changes on records/team/mine/exceptions tabs
  useEffect(() => {
    if (tab === 'records' && isAdmin)    fetchSummary();
    if (tab === 'team'    && isManager)  fetchSummary();
    if (tab === 'mine')                  fetchMyRecords();
    if (tab === 'exceptions' && isAdmin) fetchExceptions();
  }, [month, year]);

  const yearOptions = Array.from({ length: 5 }, (_, i) => now.getFullYear() - 1 + i);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6 max-w-7xl">

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold" style={{ color: '#361963' }}>Attendance</h1>
        <p className="text-sm text-gray-500 mt-1">
          {isAdmin ? 'View attendance records, import biometric data, and manage device mappings'
                   : 'Your monthly attendance from biometric punch-in data'}
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b">
        {isAdmin && (
          <>
            {(['records', 'import', 'mapping', 'exceptions'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors capitalize ${
                  tab === t
                    ? 'border-[#FD8C27] text-[#361963]'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                {t === 'records' ? 'All Attendance' : t === 'import' ? 'Import' : t === 'mapping' ? 'EnNo Mapping' : 'Exception Inbox'}
              </button>
            ))}
          </>
        )}
        {!isAdmin && (
          <>
            {(['mine', ...(isManager ? ['team'] : [])] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t as any)}
                className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                  tab === t
                    ? 'border-[#FD8C27] text-[#361963]'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                {t === 'mine' ? 'My Attendance' : 'Team Attendance'}
              </button>
            ))}
          </>
        )}
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          Tab: Records (Admin)
      ══════════════════════════════════════════════════════════════════════ */}
      {tab === 'records' && isAdmin && (
        <div className="space-y-4">
          {/* Month/Year selector */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <Label className="text-sm text-gray-600">Month</Label>
              <select
                value={month}
                onChange={(e) => setMonth(Number(e.target.value))}
                className="h-9 border rounded-md px-3 text-sm bg-white focus:outline-none"
              >
                {MONTHS.slice(1).map((m, i) => (
                  <option key={i + 1} value={i + 1}>{m}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <Label className="text-sm text-gray-600">Year</Label>
              <select
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
                className="h-9 border rounded-md px-3 text-sm bg-white focus:outline-none"
              >
                {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
          </div>

          {summaryError && <p className="text-red-500 text-sm">{summaryError}</p>}

          {/* Mark Absences button */}
          <div className="flex justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={() => { setShowAbsenceModal(true); setAbsenceResult(''); setAbsFromDate(''); setAbsToDate(''); }}
            >
              Mark Absences
            </Button>
          </div>

          {/* Attendance Adjustments Panel */}
          {!summaryLoading && summary.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base" style={{ color: '#361963' }}>
                  Attendance Adjustments
                </CardTitle>
                <p className="text-xs text-gray-500 mt-1">
                  Correct attendance before payroll. <strong>+</strong> reduces LWP (employee worked more than recorded),
                  <strong> −</strong> adds LWP. Applied automatically when the payroll run is created.
                </p>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                        <th className="text-left px-4 py-2">Employee</th>
                        <th className="text-left px-4 py-2">Department</th>
                        <th className="text-center px-4 py-2 w-32">Adjustment (days)</th>
                        <th className="text-left px-4 py-2">Reason (optional)</th>
                        <th className="px-4 py-2 w-20"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.map((row) => {
                        const name = row.profile
                          ? `${row.profile.firstName} ${row.profile.lastName}`
                          : row.userId;
                        const dept = row.profile?.department ?? '—';
                        const days = adjustments[row.userId] ?? 0;
                        const reason = adjustmentReasons[row.userId] ?? '';
                        const saving = savingAdj[row.userId] ?? false;
                        const saved  = adjSaved[row.userId]  ?? false;
                        return (
                          <tr key={row.userId} className="border-b last:border-0 hover:bg-gray-50">
                            <td className="px-4 py-2 font-medium">
                              {name}
                              {row.profile?.employeeId && (
                                <span className="ml-1 text-xs text-gray-400">({row.profile.employeeId})</span>
                              )}
                            </td>
                            <td className="px-4 py-2 text-gray-500">{dept}</td>
                            <td className="px-4 py-2">
                              <Input
                                type="number"
                                step="0.5"
                                className="h-7 text-center w-24 mx-auto"
                                value={days}
                                onChange={(e) =>
                                  setAdjustments((p) => ({ ...p, [row.userId]: parseFloat(e.target.value) || 0 }))
                                }
                              />
                            </td>
                            <td className="px-4 py-2">
                              <Input
                                type="text"
                                placeholder="e.g. Fingerprint not working"
                                className="h-7 text-sm"
                                value={reason}
                                onChange={(e) =>
                                  setAdjReasons((p) => ({ ...p, [row.userId]: e.target.value }))
                                }
                              />
                            </td>
                            <td className="px-4 py-2 text-right">
                              <Button
                                size="sm"
                                variant={saved ? 'outline' : 'default'}
                                className="h-7 text-xs"
                                style={saved ? {} : { backgroundColor: '#361963' }}
                                disabled={saving}
                                onClick={() => saveAdjustment(row.userId)}
                              >
                                {saving ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : saved ? (
                                  <><Check className="h-3 w-3 mr-1 text-green-600" />Saved</>
                                ) : (
                                  'Save'
                                )}
                              </Button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Late Policy Card */}
          {!summaryLoading && (
            <Card className={currentImport ? '' : 'opacity-60'}>
              <CardHeader className="pb-3">
                <CardTitle className="text-base" style={{ color: '#361963' }}>
                  Late Arrival Policy
                </CardTitle>
                <p className="text-xs text-gray-500 mt-1">
                  Set the standard arrival time for {MONTHS[month]} {year}. Employees arriving after this time are marked late.
                  First 3 lates per month are free — from the 4th onwards each late = 0.5 LWP day.
                  Employees on approved first-half leave have a fixed 2:30 PM cutoff.
                </p>
              </CardHeader>
              <CardContent>
                {!currentImport ? (
                  <p className="text-sm text-gray-400">No attendance data imported for this month. Import first from the Import tab.</p>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-end gap-3 flex-wrap">
                      <div className="space-y-1">
                        <Label className="text-xs">Standard Arrival Time</Label>
                        <Input
                          type="time"
                          value={arrivalTime}
                          onChange={(e) => setArrivalTime(e.target.value)}
                          className="h-9 w-36"
                        />
                      </div>
                      <Button
                        onClick={handleApplyLatePolicy}
                        disabled={applyingPolicy}
                        style={{ backgroundColor: '#361963' }}
                        className="text-white"
                        size="sm"
                      >
                        {applyingPolicy
                          ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Applying…</>
                          : 'Apply Late Policy'
                        }
                      </Button>
                      {currentImport.arrivalTime && !applyingPolicy && (
                        <span className="text-xs text-green-700 bg-green-50 border border-green-200 rounded px-2 py-1">
                          Last applied at {currentImport.arrivalTime}
                        </span>
                      )}
                      {!currentImport.arrivalTime && (
                        <span className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                          Policy not yet applied for this month
                        </span>
                      )}
                    </div>
                    {policyError && (
                      <div className="flex items-start gap-2 rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
                        <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                        {policyError}
                      </div>
                    )}
                    <p className="text-xs text-gray-400">
                      You can re-apply anytime until payroll for this month is finalized.
                      After manually editing a check-in time below, re-apply to recalculate late status.
                    </p>

                    {/* ── Extension Dates ── */}
                    <div className="border-t pt-4 space-y-3">
                      <div>
                        <p className="text-sm font-medium text-gray-700">Extension Dates</p>
                        <p className="text-xs text-gray-400 mt-0.5">
                          On these dates the late cutoff is <strong>11:00 AM</strong> instead of the standard time.
                          Employees on approved first-half leave still use the standard <strong>2:30 PM</strong> cutoff regardless.
                          Saving changes clears the applied policy — re-apply after editing.
                        </p>
                      </div>

                      {/* Add a date */}
                      <div className="flex items-center gap-2">
                        <input
                          type="date"
                          value={extensionDateInput}
                          onChange={(e) => { setExtDatesError(''); setExtensionDateInput(e.target.value); }}
                          className="h-9 border rounded-md px-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#361963]/40"
                        />
                        <Button
                          size="sm"
                          onClick={handleAddExtensionDate}
                          disabled={!extensionDateInput || savingExtDates}
                          style={{ backgroundColor: '#361963' }}
                          className="text-white"
                        >
                          {savingExtDates ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5 mr-1" />}
                          Add
                        </Button>
                      </div>

                      {extDatesError && (
                        <p className="text-xs text-red-600">{extDatesError}</p>
                      )}

                      {/* Chips */}
                      {extensionDates.length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                          {extensionDates.map((d) => {
                            const label = new Date(d + 'T00:00:00Z').toLocaleDateString('en-IN', {
                              day: '2-digit', month: 'short', year: 'numeric', weekday: 'short', timeZone: 'UTC',
                            });
                            return (
                              <span
                                key={d}
                                className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border"
                                style={{ backgroundColor: '#f3f0fa', color: '#361963', borderColor: '#c4b5e8' }}
                              >
                                {label}
                                <button
                                  onClick={() => handleRemoveExtensionDate(d)}
                                  disabled={savingExtDates}
                                  className="opacity-60 hover:opacity-100 transition-opacity"
                                  title="Remove"
                                >
                                  <X className="h-3 w-3" />
                                </button>
                              </span>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="text-xs text-gray-400 italic">No extension dates set for this month.</p>
                      )}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Summary Table */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center justify-between">
                <span style={{ color: '#361963' }}>
                  {MONTHS[month]} {year} — Attendance Summary
                </span>
                {!summaryLoading && (
                  <span className="text-xs font-normal text-gray-500">
                    {summary.length} employee{summary.length !== 1 ? 's' : ''} with records
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {summaryLoading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
                </div>
              ) : summary.length === 0 ? (
                <div className="text-center py-10 text-gray-400">
                  <p className="text-sm">No attendance records for {MONTHS[month]} {year}.</p>
                  <p className="text-xs mt-1">Import the punch-in file from the Import tab.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs text-gray-500">
                        <th className="pb-2 font-medium">Emp ID</th>
                        <th className="pb-2 font-medium">Name</th>
                        <th className="pb-2 font-medium">Dept</th>
                        <th className="pb-2 font-medium text-center">Days Present</th>
                        <th className="pb-2 font-medium text-center">Lates</th>
                        <th className="pb-2 font-medium text-center">LWP from Lates</th>
                        <th className="pb-2 font-medium text-right">Total Hrs</th>
                        <th className="pb-2 font-medium text-right">Avg Hrs/Day</th>
                        <th className="pb-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {summary.map((row) => {
                        const empRecords = allRecords.filter((r) => r.userId === row.userId);
                        const isExpanded = expandedUserId === row.userId;
                        return (
                          <>
                            <tr
                              key={row.userId}
                              className="border-b hover:bg-gray-50 cursor-pointer"
                              onClick={() => setExpandedUserId(isExpanded ? null : row.userId)}
                            >
                              <td className="py-3 font-mono text-xs text-gray-600">
                                {row.profile?.employeeId ?? '—'}
                              </td>
                              <td className="py-3 font-medium text-gray-800">
                                {row.profile ? `${row.profile.firstName} ${row.profile.lastName}` : '—'}
                              </td>
                              <td className="py-3 text-gray-500 text-xs">{row.profile?.department ?? '—'}</td>
                              <td className="py-3 text-center">
                                <Badge className="bg-green-100 text-green-700 border-green-200 text-xs">
                                  {row.daysPresent}d
                                </Badge>
                              </td>
                              <td className="py-3 text-center">
                                {row.lateCount > 0 ? (
                                  <Badge className={`text-xs ${row.lateCount > 3 ? 'bg-red-100 text-red-700 border-red-200' : 'bg-orange-100 text-orange-700 border-orange-200'}`}>
                                    {row.lateCount}
                                  </Badge>
                                ) : (
                                  <span className="text-xs text-gray-400">—</span>
                                )}
                              </td>
                              <td className="py-3 text-center">
                                {row.totalLwpDeduction > 0 ? (
                                  <Badge className="bg-red-100 text-red-700 border-red-200 text-xs">
                                    {row.totalLwpDeduction}d
                                  </Badge>
                                ) : (
                                  <span className="text-xs text-gray-400">—</span>
                                )}
                              </td>
                              <td className="py-3 text-right font-medium" style={{ color: '#361963' }}>
                                {row.totalHours > 0 ? `${row.totalHours}h` : '—'}
                              </td>
                              <td className="py-3 text-right text-gray-600">
                                {row.avgHours > 0 ? `${row.avgHours}h` : '—'}
                              </td>
                              <td className="py-3 text-right pr-1">
                                {isExpanded
                                  ? <ChevronUp className="h-4 w-4 text-gray-400 inline" />
                                  : <ChevronDown className="h-4 w-4 text-gray-400 inline" />
                                }
                              </td>
                            </tr>

                            {/* Expanded: daily records for this employee */}
                            {isExpanded && (
                              <tr key={`${row.userId}-detail`} className="bg-gray-50/80">
                                <td colSpan={9} className="px-4 py-3">
                                  <table className="w-full text-xs">
                                    <thead>
                                      <tr className="text-gray-400 border-b border-gray-200">
                                        <th className="pb-1.5 font-medium text-left">Date</th>
                                        <th className="pb-1.5 font-medium text-center">Check-In</th>
                                        <th className="pb-1.5 font-medium text-center">Check-Out</th>
                                        <th className="pb-1.5 font-medium text-right">Hours</th>
                                        <th className="pb-1.5 font-medium text-center">Status</th>
                                        <th className="pb-1.5 font-medium text-center">LWP</th>
                                        <th className="pb-1.5" />
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100">
                                      {empRecords.map((rec) => {
                                        const effectiveCheckIn = rec.checkInManual ?? rec.checkIn;
                                        const isEditing = editingRecordId === rec.id;
                                        return (
                                          <tr key={rec.id} className="hover:bg-white">
                                            <td className="py-2 font-medium text-gray-700">{fmtDate(rec.date)}</td>
                                            <td className="py-2 text-center">
                                              {isEditing ? (
                                                <div className="flex items-center justify-center gap-1">
                                                  <Input
                                                    type="time"
                                                    value={editCheckIn}
                                                    onChange={(e) => setEditCheckIn(e.target.value)}
                                                    className="h-7 w-28 text-xs"
                                                    autoFocus
                                                  />
                                                  <button
                                                    onClick={() => handleSaveCheckIn(rec)}
                                                    disabled={savingCheckIn}
                                                    className="p-1 rounded text-green-600 hover:bg-green-50"
                                                    title="Save"
                                                  >
                                                    {savingCheckIn
                                                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                                      : <Check className="h-3.5 w-3.5" />
                                                    }
                                                  </button>
                                                  <button
                                                    onClick={() => setEditingRecordId(null)}
                                                    className="p-1 rounded text-gray-400 hover:bg-gray-100"
                                                    title="Cancel"
                                                  >
                                                    <X className="h-3.5 w-3.5" />
                                                  </button>
                                                </div>
                                              ) : (
                                                <span className={`font-medium ${rec.isLate ? 'text-red-600' : 'text-gray-700'}`}>
                                                  {fmtTime(effectiveCheckIn)}
                                                  {rec.checkInManual && (
                                                    <span className="ml-1 text-[10px] text-blue-500 font-normal">(edited)</span>
                                                  )}
                                                </span>
                                              )}
                                            </td>
                                            <td className="py-2 text-center text-gray-600">{fmtTime(rec.checkOut)}</td>
                                            <td className="py-2 text-right text-gray-600">
                                              {rec.hoursWorked != null ? `${rec.hoursWorked}h` : '—'}
                                            </td>
                                            <td className="py-2 text-center">
                                              {rec.isLate ? (
                                                <Badge className="bg-red-100 text-red-700 border-red-200 text-[10px]">Late</Badge>
                                              ) : (
                                                <Badge className="bg-green-100 text-green-700 border-green-200 text-[10px]">On time</Badge>
                                              )}
                                            </td>
                                            <td className="py-2 text-center">
                                              {rec.lwpDeduction > 0 ? (
                                                <Badge className="bg-red-100 text-red-700 border-red-200 text-[10px]">−{rec.lwpDeduction}d</Badge>
                                              ) : (
                                                <span className="text-gray-300">—</span>
                                              )}
                                            </td>
                                            <td className="py-2 text-right">
                                              {!isEditing && (
                                                <div className="flex items-center justify-end gap-1">
                                                  <button
                                                    onClick={(e) => {
                                                      e.stopPropagation();
                                                      setEditingRecordId(rec.id);
                                                      // Pre-fill with current effective time
                                                      const d = effectiveCheckIn ? new Date(effectiveCheckIn) : null;
                                                      setEditCheckIn(d
                                                        ? `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
                                                        : ''
                                                      );
                                                    }}
                                                    className="p-1 rounded text-gray-400 hover:text-blue-600 hover:bg-blue-50"
                                                    title="Edit check-in time"
                                                  >
                                                    <Pencil className="h-3 w-3" />
                                                  </button>
                                                  {rec.checkInManual && (
                                                    <button
                                                      onClick={(e) => { e.stopPropagation(); handleClearCheckIn(rec); }}
                                                      className="p-1 rounded text-gray-400 hover:text-red-500 hover:bg-red-50"
                                                      title="Clear manual check-in override"
                                                    >
                                                      <X className="h-3 w-3" />
                                                    </button>
                                                  )}
                                                </div>
                                              )}
                                            </td>
                                          </tr>
                                        );
                                      })}
                                    </tbody>
                                  </table>
                                  {empRecords.length === 0 && (
                                    <p className="text-xs text-gray-400 text-center py-3">No daily records found.</p>
                                  )}
                                </td>
                              </tr>
                            )}
                          </>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          Tab: My Attendance (Employee / Manager)
      ══════════════════════════════════════════════════════════════════════ */}
      {tab === 'mine' && (
        <div className="space-y-4">
          {/* Month/Year selector */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <Label className="text-sm text-gray-600">Month</Label>
              <select
                value={month}
                onChange={(e) => setMonth(Number(e.target.value))}
                className="h-9 border rounded-md px-3 text-sm bg-white focus:outline-none"
              >
                {MONTHS.slice(1).map((m, i) => (
                  <option key={i + 1} value={i + 1}>{m}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <Label className="text-sm text-gray-600">Year</Label>
              <select
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
                className="h-9 border rounded-md px-3 text-sm bg-white focus:outline-none"
              >
                {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
          </div>

          {myError && <p className="text-red-500 text-sm">{myError}</p>}

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center justify-between">
                <span style={{ color: '#361963' }}>
                  {MONTHS[month]} {year} — My Attendance
                </span>
                {!myLoading && (
                  <span className="text-xs font-normal text-gray-500">
                    {myRecords.length} day{myRecords.length !== 1 ? 's' : ''} present
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {myLoading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
                </div>
              ) : myRecords.length === 0 ? (
                <div className="text-center py-10 text-gray-400">
                  <p className="text-sm">No attendance records for {MONTHS[month]} {year}.</p>
                  <p className="text-xs mt-1">Contact HR if you believe this is an error.</p>
                </div>
              ) : (
                <>
                  {(() => {
                    const daysInMonth = new Date(year, month, 0).getDate();
                    let weekendCount = 0;
                    for (let d = 1; d <= daysInMonth; d++) {
                      const dow = new Date(year, month - 1, d).getDay();
                      if (dow === 0 || dow === 6) weekendCount++;
                    }
                    return (
                      <p className="text-xs text-gray-500 mb-3 bg-blue-50 border border-blue-100 rounded px-3 py-2">
                        {weekendCount} weekend days are automatically counted as present.
                        Total days present: {myRecords.length} weekday{myRecords.length !== 1 ? 's' : ''} + {weekendCount} weekends = <strong>{myRecords.length + weekendCount}</strong>
                      </p>
                    );
                  })()}
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-left text-xs text-gray-500">
                          <th className="pb-2 font-medium">Date</th>
                          <th className="pb-2 font-medium text-center">Check-In</th>
                          <th className="pb-2 font-medium text-center">Check-Out</th>
                          <th className="pb-2 font-medium text-right">Hours Worked</th>
                          <th className="pb-2 font-medium text-center">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {myRecords.map((rec) => {
                          const hours = rec.hoursWorked;
                          const status = !rec.checkOut ? 'No checkout' : (hours ?? 0) >= 8 ? 'Full Day' : 'Short';
                          const statusColor = !rec.checkOut
                            ? 'bg-yellow-100 text-yellow-700 border-yellow-200'
                            : (hours ?? 0) >= 8
                              ? 'bg-green-100 text-green-700 border-green-200'
                              : 'bg-orange-100 text-orange-700 border-orange-200';
                          return (
                            <tr key={rec.id} className="hover:bg-gray-50">
                              <td className="py-3 font-medium text-gray-800">{fmtDate(rec.date)}</td>
                              <td className="py-3 text-center text-gray-700">{fmtTime(rec.checkIn)}</td>
                              <td className="py-3 text-center text-gray-700">{fmtTime(rec.checkOut)}</td>
                              <td className="py-3 text-right font-medium" style={{ color: '#361963' }}>
                                {rec.hoursWorked != null ? `${rec.hoursWorked} hrs` : '—'}
                              </td>
                              <td className="py-3 text-center">
                                <Badge className={`text-xs ${statusColor}`}>{status}</Badge>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot>
                        <tr className="border-t" style={{ backgroundColor: '#f3f0fa' }}>
                          <td className="py-2 px-0 font-semibold text-xs" style={{ color: '#361963' }}>
                            Total
                          </td>
                          <td colSpan={2} />
                          <td className="py-2 text-right font-bold text-xs" style={{ color: '#361963' }}>
                            {Math.round(myRecords.reduce((s, r) => s + (r.hoursWorked ?? 0), 0) * 100) / 100} hrs
                          </td>
                          <td />
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          Tab: Team Attendance (Manager)
      ══════════════════════════════════════════════════════════════════════ */}
      {tab === 'team' && isManager && (
        <div className="space-y-4">
          {/* Month/Year selector */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <Label className="text-sm text-gray-600">Month</Label>
              <select
                value={month}
                onChange={(e) => setMonth(Number(e.target.value))}
                className="h-9 border rounded-md px-3 text-sm bg-white focus:outline-none"
              >
                {MONTHS.slice(1).map((m, i) => (
                  <option key={i + 1} value={i + 1}>{m}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <Label className="text-sm text-gray-600">Year</Label>
              <select
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
                className="h-9 border rounded-md px-3 text-sm bg-white focus:outline-none"
              >
                {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
          </div>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center justify-between">
                <span style={{ color: '#361963' }}>
                  {MONTHS[month]} {year} — Team Attendance
                </span>
                {!summaryLoading && (
                  <span className="text-xs font-normal text-gray-500">
                    {summary.length} team member{summary.length !== 1 ? 's' : ''} with records
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {summaryLoading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
                </div>
              ) : summaryError ? (
                <p className="text-red-500 text-sm">{summaryError}</p>
              ) : summary.length === 0 ? (
                <div className="text-center py-10 text-gray-400">
                  <p className="text-sm">No attendance records for {MONTHS[month]} {year}.</p>
                  <p className="text-xs mt-1">Attendance data is imported by HR Admin.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs text-gray-500">
                        <th className="pb-2 font-medium">Emp ID</th>
                        <th className="pb-2 font-medium">Name</th>
                        <th className="pb-2 font-medium">Dept</th>
                        <th className="pb-2 font-medium text-center">Days Present</th>
                        <th className="pb-2 font-medium text-center">Lates</th>
                        <th className="pb-2 font-medium text-center">LWP</th>
                        <th className="pb-2 font-medium text-right">Total Hrs</th>
                        <th className="pb-2 font-medium text-right">Avg Hrs/Day</th>
                        <th className="pb-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {summary.map((row) => {
                        const empRecords = allRecords.filter((r) => r.userId === row.userId);
                        const isExpanded = expandedUserId === row.userId;
                        return (
                          <>
                            <tr
                              key={row.userId}
                              className="border-b hover:bg-gray-50 cursor-pointer"
                              onClick={() => setExpandedUserId(isExpanded ? null : row.userId)}
                            >
                              <td className="py-3 font-mono text-xs text-gray-600">{row.profile?.employeeId ?? '—'}</td>
                              <td className="py-3 font-medium text-gray-800">
                                {row.profile ? `${row.profile.firstName} ${row.profile.lastName}` : '—'}
                              </td>
                              <td className="py-3 text-gray-500 text-xs">{row.profile?.department ?? '—'}</td>
                              <td className="py-3 text-center">
                                <Badge className="bg-green-100 text-green-700 border-green-200 text-xs">{row.daysPresent}d</Badge>
                              </td>
                              <td className="py-3 text-center">
                                {row.lateCount > 0 ? (
                                  <Badge className={`text-xs ${row.lateCount > 3 ? 'bg-red-100 text-red-700 border-red-200' : 'bg-orange-100 text-orange-700 border-orange-200'}`}>
                                    {row.lateCount}
                                  </Badge>
                                ) : <span className="text-xs text-gray-400">—</span>}
                              </td>
                              <td className="py-3 text-center">
                                {row.totalLwpDeduction > 0 ? (
                                  <Badge className="bg-red-100 text-red-700 border-red-200 text-xs">{row.totalLwpDeduction}d</Badge>
                                ) : <span className="text-xs text-gray-400">—</span>}
                              </td>
                              <td className="py-3 text-right font-medium" style={{ color: '#361963' }}>
                                {row.totalHours > 0 ? `${row.totalHours}h` : '—'}
                              </td>
                              <td className="py-3 text-right text-gray-600">
                                {row.avgHours > 0 ? `${row.avgHours}h` : '—'}
                              </td>
                              <td className="py-3 text-right pr-1">
                                {isExpanded
                                  ? <ChevronUp className="h-4 w-4 text-gray-400 inline" />
                                  : <ChevronDown className="h-4 w-4 text-gray-400 inline" />
                                }
                              </td>
                            </tr>

                            {/* Expanded: daily records (read-only) */}
                            {isExpanded && (
                              <tr key={`${row.userId}-detail`} className="bg-gray-50/80">
                                <td colSpan={9} className="px-4 py-3">
                                  {empRecords.length === 0 ? (
                                    <p className="text-xs text-gray-400 py-2">No daily records found.</p>
                                  ) : (
                                    <table className="w-full text-xs">
                                      <thead>
                                        <tr className="text-gray-400 border-b border-gray-200">
                                          <th className="pb-1.5 font-medium text-left">Date</th>
                                          <th className="pb-1.5 font-medium text-center">Check-In</th>
                                          <th className="pb-1.5 font-medium text-center">Check-Out</th>
                                          <th className="pb-1.5 font-medium text-right">Hours</th>
                                          <th className="pb-1.5 font-medium text-center">Status</th>
                                          <th className="pb-1.5 font-medium text-center">LWP</th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y divide-gray-100">
                                        {empRecords.map((rec) => (
                                          <tr key={rec.id} className="hover:bg-white">
                                            <td className="py-2 font-medium text-gray-700">{fmtDate(rec.date)}</td>
                                            <td className="py-2 text-center">
                                              <span className={`font-medium ${rec.isLate ? 'text-red-600' : 'text-gray-700'}`}>
                                                {fmtTime(rec.checkInManual ?? rec.checkIn)}
                                                {rec.checkInManual && (
                                                  <span className="ml-1 text-[10px] text-blue-500 font-normal">(edited)</span>
                                                )}
                                              </span>
                                            </td>
                                            <td className="py-2 text-center text-gray-600">{fmtTime(rec.checkOut)}</td>
                                            <td className="py-2 text-right text-gray-600">
                                              {rec.hoursWorked != null ? `${rec.hoursWorked}h` : '—'}
                                            </td>
                                            <td className="py-2 text-center">
                                              {rec.isLate
                                                ? <Badge className="bg-red-100 text-red-700 border-red-200 text-[10px]">Late</Badge>
                                                : <Badge className="bg-green-100 text-green-700 border-green-200 text-[10px]">On time</Badge>
                                              }
                                            </td>
                                            <td className="py-2 text-center">
                                              {rec.lwpDeduction > 0
                                                ? <Badge className="bg-red-100 text-red-700 border-red-200 text-[10px]">−{rec.lwpDeduction}d</Badge>
                                                : <span className="text-gray-300">—</span>
                                              }
                                            </td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  )}
                                </td>
                              </tr>
                            )}
                          </>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          Tab: Import (Admin)
      ══════════════════════════════════════════════════════════════════════ */}
      {tab === 'import' && isAdmin && (
        <div className="space-y-6">

          {/* Upload Card */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base" style={{ color: '#361963' }}>
                Import Biometric Punch-In File
              </CardTitle>
              <p className="text-xs text-gray-500 mt-1">
                Upload the ZKTeco UDISKLOG .txt file exported from the punch-in machine. One import per month.
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-3">
                <label
                  htmlFor="punchFile"
                  className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium text-white cursor-pointer transition-opacity ${
                    importing ? 'opacity-60 pointer-events-none' : ''
                  }`}
                  style={{ backgroundColor: '#FD8C27' }}
                >
                  {importing
                    ? <><Loader2 className="h-4 w-4 animate-spin" /> Processing…</>
                    : <><Upload className="h-4 w-4" /> Select .txt File</>
                  }
                  <input
                    id="punchFile"
                    ref={fileInputRef}
                    type="file"
                    accept=".txt"
                    className="hidden"
                    onChange={handleImport}
                    disabled={importing}
                  />
                </label>
                <span className="text-xs text-gray-400">Max 10 MB • .txt only</span>
              </div>

              {importError && (
                <div className="flex items-start gap-2 rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
                  <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                  {importError}
                </div>
              )}

              {importResult && (
                <div className="rounded-md bg-green-50 border border-green-200 px-4 py-3 space-y-1">
                  <p className="text-sm font-medium text-green-800">
                    Import successful — {MONTHS[importResult.month]} {importResult.year}
                  </p>
                  <p className="text-xs text-green-700">
                    {importResult.saved} attendance record{importResult.saved !== 1 ? 's' : ''} saved.
                  </p>
                  {importResult.unmappedEnNos.length > 0 && (
                    <p className="text-xs text-amber-700 mt-1">
                      {importResult.unmappedEnNos.length} EnNo{importResult.unmappedEnNos.length > 1 ? 's' : ''} not mapped
                      to any employee: {importResult.unmappedEnNos.join(', ')} — go to the <strong>EnNo Mapping</strong> tab to resolve.
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Import History */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base" style={{ color: '#361963' }}>Import History</CardTitle>
            </CardHeader>
            <CardContent>
              {importsLoading ? (
                <div className="flex justify-center py-6">
                  <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
                </div>
              ) : imports.length === 0 ? (
                <p className="text-center text-gray-400 text-sm py-6">No imports yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs text-gray-500">
                        <th className="pb-2 font-medium">Period</th>
                        <th className="pb-2 font-medium">File</th>
                        <th className="pb-2 font-medium text-center">Records</th>
                        <th className="pb-2 font-medium text-center">Unmapped EnNos</th>
                        <th className="pb-2 font-medium">Imported On</th>
                        <th className="pb-2" />
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {imports.map((imp) => (
                        <tr key={imp.id} className="hover:bg-gray-50">
                          <td className="py-3 font-semibold" style={{ color: '#361963' }}>
                            {MONTH_SHORT[imp.month]} {imp.year}
                          </td>
                          <td className="py-3 text-gray-600 text-xs font-mono">{imp.fileName}</td>
                          <td className="py-3 text-center">
                            <Badge className="bg-blue-100 text-blue-700 border-blue-200 text-xs">
                              {imp._count.records}
                            </Badge>
                          </td>
                          <td className="py-3 text-center">
                            {Array.isArray(imp.unmappedEnNos) && imp.unmappedEnNos.length > 0 ? (
                              <Badge className="bg-amber-100 text-amber-700 border-amber-200 text-xs">
                                {imp.unmappedEnNos.length} unresolved
                              </Badge>
                            ) : (
                              <span className="text-xs text-gray-400">All mapped</span>
                            )}
                          </td>
                          <td className="py-3 text-gray-500 text-xs">
                            {new Date(imp.createdAt).toLocaleDateString('en-IN', {
                              day: '2-digit', month: 'short', year: 'numeric',
                            })}
                          </td>
                          <td className="py-3 text-right">
                            <button
                              disabled={deletingImport === imp.id}
                              onClick={() => handleDeleteImport(imp.id, imp.month, imp.year)}
                              className="text-xs text-red-400 hover:text-red-600 p-1 rounded"
                              title="Delete import and all its records"
                            >
                              {deletingImport === imp.id
                                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                : <Trash2 className="h-3.5 w-3.5" />}
                            </button>
                          </td>
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

      {/* ══════════════════════════════════════════════════════════════════════
          Tab: EnNo Mapping (Admin)
      ══════════════════════════════════════════════════════════════════════ */}
      {tab === 'mapping' && isAdmin && (
        <div className="space-y-6">

          {/* Add Mapping */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base" style={{ color: '#361963' }}>Add EnNo Mapping</CardTitle>
              <p className="text-xs text-gray-500 mt-1">
                Map a biometric machine enrollment number to an employee in the system.
              </p>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
                <div className="space-y-1">
                  <Label className="text-xs">Machine EnNo *</Label>
                  <Input
                    type="number"
                    min={1}
                    placeholder="e.g. 49"
                    value={newEnNo}
                    onChange={(e) => setNewEnNo(e.target.value)}
                    className="h-9"
                  />
                </div>
                <div className="space-y-1 md:col-span-2">
                  <Label className="text-xs">Employee *</Label>
                  <select
                    value={newUserId}
                    onChange={(e) => setNewUserId(e.target.value)}
                    className="h-9 w-full border rounded-md px-3 text-sm bg-white focus:outline-none"
                  >
                    <option value="">— Select employee —</option>
                    {employees.map((emp) => (
                      <option key={emp.id} value={emp.id}>
                        {emp.profile?.firstName} {emp.profile?.lastName}
                        {emp.profile?.employeeId ? ` (${emp.profile.employeeId})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Label (optional)</Label>
                  <Input
                    placeholder="e.g. proximity card"
                    value={newLabel}
                    onChange={(e) => setNewLabel(e.target.value)}
                    className="h-9"
                  />
                </div>
                <div className="md:col-span-4">
                  {mappingError && <p className="text-red-500 text-xs mb-2">{mappingError}</p>}
                  <Button
                    disabled={addingMapping}
                    onClick={handleAddMapping}
                    style={{ backgroundColor: '#361963' }}
                    className="text-white"
                    size="sm"
                  >
                    {addingMapping
                      ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Adding…</>
                      : <><Plus className="h-4 w-4 mr-2" />Add Mapping</>
                    }
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Unresolved EnNos */}
          {unresolvedEnNos.length > 0 && (
            <div className="rounded-md bg-amber-50 border border-amber-200 px-4 py-3">
              <p className="text-sm font-medium text-amber-800 flex items-center gap-2">
                <AlertCircle className="h-4 w-4" />
                {unresolvedEnNos.length} unresolved EnNo{unresolvedEnNos.length > 1 ? 's' : ''} from past imports
              </p>
              <p className="text-xs text-amber-700 mt-1">
                These enrollment numbers appeared in imported files but have no employee mapping:
                <span className="font-mono ml-1 font-medium">{unresolvedEnNos.join(', ')}</span>
              </p>
              <p className="text-xs text-amber-600 mt-1">
                Map them above to include their punch-in data in future imports. Past records for these EnNos were skipped.
              </p>
            </div>
          )}

          {/* Existing Mappings */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center justify-between">
                <span style={{ color: '#361963' }}>Current Mappings</span>
                <span className="text-xs font-normal text-gray-500">{mappings.length} mapped</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {mappingsLoading ? (
                <div className="flex justify-center py-6">
                  <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
                </div>
              ) : mappings.length === 0 ? (
                <p className="text-center text-gray-400 text-sm py-6">
                  No mappings yet. Add one above.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs text-gray-500">
                        <th className="pb-2 font-medium">EnNo</th>
                        <th className="pb-2 font-medium">Employee</th>
                        <th className="pb-2 font-medium">Emp ID</th>
                        <th className="pb-2 font-medium">Department</th>
                        <th className="pb-2 font-medium">Label</th>
                        <th className="pb-2" />
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {mappings.map((m) => (
                        <tr key={m.id} className="hover:bg-gray-50">
                          <td className="py-3 font-mono font-semibold text-sm" style={{ color: '#361963' }}>
                            {m.enNo}
                          </td>
                          <td className="py-3 font-medium text-gray-800">
                            {m.user.profile
                              ? `${m.user.profile.firstName} ${m.user.profile.lastName}`
                              : '—'}
                          </td>
                          <td className="py-3 font-mono text-xs text-gray-500">
                            {m.user.profile?.employeeId ?? '—'}
                          </td>
                          <td className="py-3 text-gray-500">{m.user.profile?.department ?? '—'}</td>
                          <td className="py-3 text-gray-400 text-xs">{m.label ?? '—'}</td>
                          <td className="py-3 text-right">
                            <button
                              disabled={deletingMapping === m.id}
                              onClick={() => handleDeleteMapping(m.id)}
                              className="text-xs text-red-400 hover:text-red-600 p-1 rounded"
                            >
                              {deletingMapping === m.id
                                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                : <Trash2 className="h-3.5 w-3.5" />}
                            </button>
                          </td>
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

      {/* ══════════════════════════════════════════════════════════════════════
          Tab: Exception Inbox (Admin)
      ══════════════════════════════════════════════════════════════════════ */}
      {tab === 'exceptions' && isAdmin && (
        <div className="space-y-4">
          {/* Month/Year selector */}
          <div className="flex items-center gap-3">
            <select value={month} onChange={(e) => setMonth(Number(e.target.value))} className="border rounded-md px-3 py-2 text-sm">
              {MONTHS.slice(1).map((m, i) => <option key={i+1} value={i+1}>{m}</option>)}
            </select>
            <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="border rounded-md px-3 py-2 text-sm">
              {Array.from({ length: 5 }, (_, i) => now.getFullYear() - 1 + i).map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
            <Button size="sm" variant="outline" onClick={fetchExceptions}>Refresh</Button>
          </div>

          {exceptionsLoading ? (
            <div className="flex items-center gap-2 text-gray-500"><Loader2 className="h-5 w-5 animate-spin" /> Loading exceptions...</div>
          ) : !exceptions ? (
            <p className="text-muted-foreground">No data. Select a month and click Refresh.</p>
          ) : (
            <div className="space-y-4">
              {/* Missing Punch */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <AlertCircle className="h-4 w-4 text-orange-500" />
                    Missing Punch <Badge variant="outline" className="ml-1">{exceptions.missingPunch?.length || 0}</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {exceptions.missingPunch?.length === 0 ? (
                    <p className="text-sm text-gray-500">No missing punches found.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead><tr className="text-left text-gray-500 border-b">
                          <th className="py-2 pr-4">Employee</th><th className="py-2 pr-4">Date</th><th className="py-2">Check In</th>
                        </tr></thead>
                        <tbody>
                          {exceptions.missingPunch?.map((r: any, i: number) => (
                            <tr key={i} className="border-b last:border-0">
                              <td className="py-2 pr-4">{r.profile?.firstName} {r.profile?.lastName} ({r.profile?.employeeId})</td>
                              <td className="py-2 pr-4">{fmtDate(r.date)}</td>
                              <td className="py-2">{fmtTime(r.checkIn)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Late Marks */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <AlertCircle className="h-4 w-4 text-red-500" />
                    Excessive Late Marks <Badge variant="outline" className="ml-1">{exceptions.lateMark?.length || 0}</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {exceptions.lateMark?.length === 0 ? (
                    <p className="text-sm text-gray-500">No employees with late marks.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead><tr className="text-left text-gray-500 border-b">
                          <th className="py-2 pr-4">Employee</th><th className="py-2 pr-4">Late Count</th><th className="py-2">Dates</th>
                        </tr></thead>
                        <tbody>
                          {exceptions.lateMark?.map((r: any, i: number) => (
                            <tr key={i} className="border-b last:border-0">
                              <td className="py-2 pr-4">{r.profile?.firstName} {r.profile?.lastName}</td>
                              <td className="py-2 pr-4"><Badge className="bg-red-100 text-red-700">{r.count}</Badge></td>
                              <td className="py-2 text-xs text-gray-500">{r.dates?.map((d: string) => fmtDate(d)).join(', ')}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Half-Day Mismatch */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <AlertCircle className="h-4 w-4 text-yellow-500" />
                    Half-Day Mismatches <Badge variant="outline" className="ml-1">{exceptions.halfDayMismatch?.length || 0}</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {exceptions.halfDayMismatch?.length === 0 ? (
                    <p className="text-sm text-gray-500">No mismatches found.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead><tr className="text-left text-gray-500 border-b">
                          <th className="py-2 pr-4">Employee</th><th className="py-2 pr-4">Date</th><th className="py-2 pr-4">Leave Type</th><th className="py-2">Hours Worked</th>
                        </tr></thead>
                        <tbody>
                          {exceptions.halfDayMismatch?.map((r: any, i: number) => (
                            <tr key={i} className="border-b last:border-0">
                              <td className="py-2 pr-4">{r.profile?.firstName} {r.profile?.lastName}</td>
                              <td className="py-2 pr-4">{fmtDate(r.date)}</td>
                              <td className="py-2 pr-4"><Badge className="bg-yellow-100 text-yellow-700">{r.leaveType}</Badge></td>
                              <td className="py-2">{r.hoursWorked?.toFixed(1)}h</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Unmapped Employees */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <AlertCircle className="h-4 w-4 text-gray-500" />
                    No Attendance Records <Badge variant="outline" className="ml-1">{exceptions.unmappedEmployees?.length || 0}</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {exceptions.unmappedEmployees?.length === 0 ? (
                    <p className="text-sm text-gray-500">All mapped employees have attendance records.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead><tr className="text-left text-gray-500 border-b">
                          <th className="py-2 pr-4">Employee</th><th className="py-2">EnNo</th>
                        </tr></thead>
                        <tbody>
                          {exceptions.unmappedEmployees?.map((r: any, i: number) => (
                            <tr key={i} className="border-b last:border-0">
                              <td className="py-2 pr-4">{r.profile?.firstName} {r.profile?.lastName} ({r.profile?.employeeId})</td>
                              <td className="py-2">{r.enNo}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Pending Geo Proofs */}
              <PendingGeoProofs />
            </div>
          )}
        </div>
      )}

      {/* ── Absence Auto-Mark Modal ── */}
      {showAbsenceModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-base font-semibold" style={{ color: '#361963' }}>Mark Absences</h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  Auto-marks employees with no punch and no approved leave as absent. Sundays and holidays are skipped.
                </p>
              </div>
              <button className="text-gray-400 hover:text-gray-600" onClick={() => setShowAbsenceModal(false)}>✕</button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium mb-1">From Date</label>
                <input
                  type="date"
                  className="w-full border rounded-md px-3 py-2 text-sm"
                  value={absFromDate}
                  onChange={(e) => setAbsFromDate(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">To Date</label>
                <input
                  type="date"
                  className="w-full border rounded-md px-3 py-2 text-sm"
                  value={absToDate}
                  onChange={(e) => setAbsToDate(e.target.value)}
                />
              </div>
            </div>

            {absenceResult && (
              <p className="text-sm bg-green-50 text-green-800 border border-green-200 rounded-md px-3 py-2">
                {absenceResult}
              </p>
            )}

            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" onClick={() => setShowAbsenceModal(false)}>Cancel</Button>
              <Button
                size="sm"
                disabled={!absFromDate || !absToDate || markingAbsences}
                style={{ backgroundColor: '#361963' }}
                className="text-white"
                onClick={async () => {
                  setMarkingAbsences(true);
                  setAbsenceResult('');
                  try {
                    const r = await api.post('/attendance/mark-absences', { fromDate: absFromDate, toDate: absToDate });
                    setAbsenceResult(r.data.message);
                  } catch (err: any) {
                    setAbsenceResult(err?.response?.data?.error ?? 'Failed to mark absences');
                  } finally {
                    setMarkingAbsences(false);
                  }
                }}
              >
                {markingAbsences ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                Run
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Pending Geo Proofs Card ─────────────────────────────────────────────────

function PendingGeoProofs() {
  const { data: proofs = [], isLoading } = useQuery<any[]>({
    queryKey: ['travel-proof-all'],
    queryFn: () => api.get('/travel-proof').then(r => r.data),
  });

  const submitted = proofs.filter((p: any) => p.submittedAt);
  const missing   = proofs.filter((p: any) => !p.submittedAt);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <MapPin className="h-4 w-4 text-amber-500" />
          Travel Geo Proofs
          <Badge variant="outline" className="ml-1 text-green-700 border-green-300">{submitted.length} submitted</Badge>
          {missing.length > 0 && (
            <Badge variant="outline" className="text-amber-600 border-amber-300">{missing.length} missing</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading...</div>
        ) : proofs.length === 0 ? (
          <p className="text-sm text-gray-500">No travel proof records found.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-gray-500 border-b">
                <th className="py-2 pr-4">Employee</th>
                <th className="py-2 pr-4">Travel Date</th>
                <th className="py-2 pr-4">Submitted At</th>
                <th className="py-2">Location</th>
              </tr></thead>
              <tbody>
                {proofs.map((p: any) => (
                  <tr key={p.id} className="border-b last:border-0">
                    <td className="py-2 pr-4 font-medium">
                      {p.user?.profile?.firstName} {p.user?.profile?.lastName}
                      <span className="text-xs text-gray-400 ml-1">({p.user?.profile?.employeeId})</span>
                    </td>
                    <td className="py-2 pr-4">
                      {new Date(p.proofDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </td>
                    <td className="py-2 pr-4 text-xs text-gray-500">
                      {p.submittedAt
                        ? new Date(p.submittedAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true })
                        : '—'}
                    </td>
                    <td className="py-2">
                      {p.mapsLink ? (
                        <a href={p.mapsLink} target="_blank" rel="noopener noreferrer"
                           className="inline-flex items-center gap-1 text-blue-600 hover:underline text-xs font-medium">
                          <MapPin className="h-3 w-3" /> View on Maps
                        </a>
                      ) : (
                        <Badge variant="outline" className="text-amber-600 border-amber-300 text-xs">No Proof</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
