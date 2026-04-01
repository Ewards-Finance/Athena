/**
 * Athena V2 - Payroll Run Detail (Admin only)
 * Shows all payslip entries for a run.
 * MANUAL component cells are editable while status = DRAFT.
 * Admin can finalize and download the .xlsx report.
 */

import { useState, useEffect } from 'react';
import { useParams, useNavigate }           from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent }                from '@/components/ui/card';
import { Button }                           from '@/components/ui/button';
import { Badge }                            from '@/components/ui/badge';
import api from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';

// ─── Types ────────────────────────────────────────────────────────────────────
interface PayrollComponent {
  id:       string;
  name:     string;
  type:     'EARNING' | 'DEDUCTION';
  calcType: 'PERCENTAGE_OF_CTC' | 'FIXED' | 'MANUAL' | 'AUTO_PT';
  order:    number;
}

interface PayslipEntry {
  id:             string;
  userId:         string;
  monthlyCtc:     number;
  workingDays:    number;
  lwpDays:        number;
  paidDays:       number;
  earnings:       Record<string, number>;
  deductions:     Record<string, number>;
  reimbursements: number;
  grossPay:       number;
  totalDeductions:number;
  netPay:         number;
  arrearsAmount?: number | null;
  arrearsNote?:   string | null;
  user: {
    profile: {
      firstName:   string;
      lastName:    string;
      employeeId:  string;
      designation: string;
      department:  string;
    } | null;
  };
}

interface PayrollRun {
  id:         string;
  month:      number;
  year:       number;
  status:     'DRAFT' | 'SUBMITTED' | 'FINALIZED';
  runType?:   'REGULAR' | 'FULL_AND_FINAL';
  createdAt:  string;
  entries:    PayslipEntry[];
  components: PayrollComponent[];
}

const MONTHS = [
  '', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function fmt(n: number) {
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function PayrollRunDetail() {
  const { id }   = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();

  // Track local edits to MANUAL cells: { entryId: { componentName: value } }
  const [manualEdits, setManualEdits] = useState<Record<string, Record<string, string>>>({});
  const [savingEntry, setSavingEntry] = useState<Record<string, boolean>>({});
  const [saveError, setSaveError]     = useState<Record<string, string>>({});

  const [finalizing, setFinalizing]   = useState(false);
  const [finalizeError, setFinalizeError] = useState('');
  const [downloading, setDownloading]         = useState(false);
  const [downloadingBank, setDownloadingBank] = useState(false);
  const [reopening, setReopening]     = useState(false);

  // ── Fetch run ─────────────────────────────────────────────────────────────
  const { data: run, isLoading: loading, isError } = useQuery({
    queryKey: ['payroll-run', id],
    queryFn: () => api.get<PayrollRun>(`/payroll/runs/${id}`).then((r) => r.data),
    enabled: !!id,
  });

  const error = isError ? 'Failed to load payroll run.' : '';

  const fetchRun = () => queryClient.invalidateQueries({ queryKey: ['payroll-run', id] });

  // Initialise manual edit state when run data changes
  useEffect(() => {
    if (!run) return;
    const initEdits: Record<string, Record<string, string>> = {};
    for (const entry of run.entries) {
      initEdits[entry.id] = {};
      for (const comp of run.components.filter((c) => c.calcType === 'MANUAL')) {
        const v = comp.type === 'EARNING'
          ? (entry.earnings[comp.name] ?? 0)
          : (entry.deductions[comp.name] ?? 0);
        initEdits[entry.id][comp.name] = String(v);
      }
    }
    setManualEdits(initEdits);
  }, [run]);

  // ── Save manual edits for one entry ───────────────────────────────────────
  const handleSaveEntry = async (entry: PayslipEntry) => {
    const edits = manualEdits[entry.id] ?? {};
    const manualComps = (run?.components ?? []).filter((c) => c.calcType === 'MANUAL');

    const manualEarnings:   Record<string, number> = {};
    const manualDeductions: Record<string, number> = {};

    for (const comp of manualComps) {
      const val = parseFloat(edits[comp.name] ?? '0') || 0;
      if (comp.type === 'EARNING')   manualEarnings[comp.name]   = val;
      if (comp.type === 'DEDUCTION') manualDeductions[comp.name] = val;
    }

    setSavingEntry((p) => ({ ...p, [entry.id]: true }));
    setSaveError((p) => ({ ...p, [entry.id]: '' }));
    try {
      await api.patch(`/payroll/runs/${id}/entries/${entry.id}`, {
        manualEarnings,
        manualDeductions,
      });
      await queryClient.invalidateQueries({ queryKey: ['payroll-run', id] });
    } catch (err: any) {
      setSaveError((p) => ({
        ...p,
        [entry.id]: err?.response?.data?.error ?? 'Save failed.',
      }));
    } finally {
      setSavingEntry((p) => ({ ...p, [entry.id]: false }));
    }
  };

  // ── Finalize ──────────────────────────────────────────────────────────────
  const handleFinalize = async () => {
    if (!confirm('Finalize this payroll run? Once finalized, no further edits are possible.')) return;
    setFinalizing(true);
    setFinalizeError('');
    try {
      await api.post(`/payroll/runs/${id}/finalize`);
      fetchRun();
    } catch (err: any) {
      setFinalizeError(err?.response?.data?.error ?? 'Finalization failed.');
    } finally {
      setFinalizing(false);
    }
  };

  // ── Reopen ────────────────────────────────────────────────────────────────
  const handleReopen = async () => {
    if (!run) return;
    if (!confirm(`Reopen ${MONTHS[run.month]} ${run.year} payroll run? It will go back to DRAFT and employees will no longer see it as finalized until you re-finalize.`)) return;
    setReopening(true);
    try {
      await api.post(`/payroll/runs/${id}/reopen`);
      fetchRun();
    } catch (err: any) {
      alert(err?.response?.data?.error ?? 'Failed to reopen run.');
    } finally {
      setReopening(false);
    }
  };

  // ── Submit for review ────────────────────────────────────────────────────
  const [submittingForReview, setSubmittingForReview] = useState(false);
  const handleSubmitForReview = async () => {
    if (!run) return;
    if (!confirm(`Submit ${MONTHS[run.month]} ${run.year} payroll for Owner review?`)) return;
    setSubmittingForReview(true);
    try {
      await api.post(`/payroll/runs/${id}/submit`);
      fetchRun();
    } catch (err: any) {
      alert(err?.response?.data?.error ?? 'Failed to submit.');
    } finally {
      setSubmittingForReview(false);
    }
  };

  // ── Download .xlsx ────────────────────────────────────────────────────────
  const handleDownload = async () => {
    if (!run) return;
    setDownloading(true);
    try {
      const res = await api.get(`/payroll/runs/${id}/export`, { responseType: 'blob' });
      const url  = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `payroll-${MONTHS[run.month].toLowerCase()}-${run.year}.xlsx`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      alert('Export failed. Please try again.');
    } finally {
      setDownloading(false);
    }
  };

  // ── Download Bank Transfer Sheet ─────────────────────────────────────────
  const handleBankExport = async () => {
    if (!run) return;
    setDownloadingBank(true);
    try {
      const res = await api.get(`/payroll/runs/${id}/bank-export`, { responseType: 'blob' });
      const url  = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `bank-transfer-${MONTHS[run.month].toLowerCase()}-${run.year}.xlsx`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      alert('Bank export failed. Please try again.');
    } finally {
      setDownloadingBank(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  if (loading)   return <p className="text-gray-400 text-sm p-6">Loading…</p>;
  if (error)     return <p className="text-red-500 text-sm p-6">{error}</p>;
  if (!run)      return null;

  const isDraft  = run.status === 'DRAFT';
  const manualComps = run.components.filter((c) => c.calcType === 'MANUAL');
  const earningCols = run.components.filter((c) => c.type === 'EARNING').sort((a, b) => a.order - b.order);
  const deductionCols = run.components.filter((c) => c.type === 'DEDUCTION').sort((a, b) => a.order - b.order);

  const lwpExists = run.entries.some((e) => (e.deductions['LWP Deduction'] ?? 0) > 0);
  const allDeductionCols = [...(lwpExists ? [{ id: 'lwp', name: 'LWP Deduction', type: 'DEDUCTION', calcType: 'AUTO_PT', order: -1 }] as PayrollComponent[] : []), ...deductionCols];

  // Totals
  const totals = run.entries.reduce(
    (acc, e) => ({
      gross:         acc.gross + e.grossPay,
      deductions:    acc.deductions + e.totalDeductions,
      reimbursements:acc.reimbursements + e.reimbursements,
      net:           acc.net + e.netPay,
    }),
    { gross: 0, deductions: 0, reimbursements: 0, net: 0 }
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <button
            onClick={() => navigate('/payroll/runs')}
            className="text-xs text-gray-400 hover:text-gray-600 mb-1 flex items-center gap-1"
          >
            ← Back to Payroll Runs
          </button>
          <h1 className="text-2xl font-bold" style={{ color: '#361963' }}>
            {MONTHS[run.month]} {run.year} Payroll
            {run.runType === 'FULL_AND_FINAL' && (
              <Badge className="ml-3 bg-red-100 text-red-700 border-red-200 text-xs font-normal align-middle">Full & Final</Badge>
            )}
          </h1>
          <div className="flex items-center gap-3 mt-1">
            <Badge className={
              run.status === 'FINALIZED' ? 'bg-green-100 text-green-700 border-green-200'
              : run.status === 'SUBMITTED' ? 'bg-blue-100 text-blue-700 border-blue-200'
              : 'bg-yellow-100 text-yellow-700 border-yellow-200'
            }>
              {run.status === 'FINALIZED' ? 'Finalized' : run.status === 'SUBMITTED' ? 'Submitted for Review' : 'Draft'}
            </Badge>
            <span className="text-xs text-gray-400">
              {run.entries.length} employee{run.entries.length !== 1 ? 's' : ''} •
              Generated {new Date(run.createdAt).toLocaleDateString('en-IN')}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {isDraft && manualComps.length > 0 && (
            <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-md">
              Edit manual columns below, then submit for review.
            </p>
          )}
          {/* DRAFT: Admin submits for review (not OWNER — they approve, not submit) */}
          {isDraft && user?.role === 'ADMIN' && (
            <Button
              onClick={handleSubmitForReview}
              disabled={submittingForReview}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              {submittingForReview ? 'Submitting…' : 'Submit for Review'}
            </Button>
          )}
          {/* SUBMITTED: Admin or Owner can finalize */}
          {run.status === 'SUBMITTED' && (user?.role === 'OWNER' || user?.role === 'ADMIN') && (
            <Button
              onClick={handleFinalize}
              disabled={finalizing}
              className="bg-green-600 hover:bg-green-700 text-white"
            >
              {finalizing ? 'Approving…' : 'Approve & Finalize'}
            </Button>
          )}
          {run.status === 'SUBMITTED' && user?.role !== 'OWNER' && user?.role !== 'ADMIN' && (
            <span className="text-sm text-blue-600 italic bg-blue-50 border border-blue-200 px-3 py-1.5 rounded-md">
              Awaiting approval
            </span>
          )}
          {/* FINALIZED: Admin or Owner can reopen */}
          {run.status === 'FINALIZED' && (user?.role === 'OWNER' || user?.role === 'ADMIN') && (
            <Button
              onClick={handleReopen}
              disabled={reopening}
              variant="outline"
              className="border-amber-400 text-amber-600 hover:bg-amber-50"
            >
              {reopening ? 'Reopening…' : 'Reopen Run'}
            </Button>
          )}
          {run.status === 'FINALIZED' && (
            <Button
              onClick={handleBankExport}
              disabled={downloadingBank}
              variant="outline"
              className="border-green-500 text-green-700 hover:bg-green-50"
            >
              {downloadingBank ? 'Generating…' : '🏦 Bank Transfer Sheet'}
            </Button>
          )}
          <Button
            onClick={handleDownload}
            disabled={downloading}
            style={{ backgroundColor: '#FD8C27' }}
            className="text-white"
          >
            {downloading ? 'Generating…' : '↓ Download .xlsx'}
          </Button>
        </div>
      </div>

      {finalizeError && (
        <p className="text-red-500 text-sm bg-red-50 border border-red-200 px-4 py-2 rounded-md">
          {finalizeError}
        </p>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Total Gross Pay',   value: `₹${fmt(totals.gross)}`,         color: '#361963' },
          { label: 'Total Deductions',  value: `₹${fmt(totals.deductions)}`,    color: '#DC2626' },
          { label: 'Reimbursements',    value: `₹${fmt(totals.reimbursements)}`, color: '#059669' },
          { label: 'Total Net Pay',     value: `₹${fmt(totals.net)}`,           color: '#FD8C27' },
        ].map((card) => (
          <Card key={card.label}>
            <CardContent className="pt-4 pb-4">
              <p className="text-xs text-gray-500 mb-1">{card.label}</p>
              <p className="text-lg font-bold" style={{ color: card.color }}>{card.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Payroll Register Table */}
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left border-b" style={{ backgroundColor: '#361963', color: 'white' }}>
                <th className="px-3 py-3 font-medium sticky left-0" style={{ backgroundColor: '#361963' }}>Emp ID</th>
                <th className="px-3 py-3 font-medium min-w-[140px]">Name</th>
                <th className="px-3 py-3 font-medium">Dept</th>
                <th className="px-3 py-3 font-medium text-right">Monthly CTC</th>
                <th className="px-3 py-3 font-medium text-center">Work Days</th>
                <th className="px-3 py-3 font-medium text-center">LWP</th>
                <th className="px-3 py-3 font-medium text-center">Paid Days</th>
                {/* Earnings */}
                {earningCols.map((c) => (
                  <th key={c.id} className={`px-3 py-3 font-medium text-right min-w-[110px] ${c.calcType === 'MANUAL' && isDraft ? 'text-amber-200' : ''}`}>
                    {c.name} {c.calcType === 'MANUAL' && isDraft ? '✏️' : ''}
                  </th>
                ))}
                <th className="px-3 py-3 font-medium text-right border-l border-white/20">Gross Pay</th>
                {/* Deductions */}
                {allDeductionCols.map((c) => (
                  <th key={c.id} className={`px-3 py-3 font-medium text-right min-w-[110px] ${c.calcType === 'MANUAL' && isDraft ? 'text-amber-200' : ''}`}>
                    {c.name} {c.calcType === 'MANUAL' && isDraft ? '✏️' : ''}
                  </th>
                ))}
                <th className="px-3 py-3 font-medium text-right border-l border-white/20">Reimb.</th>
                <th className="px-3 py-3 font-medium text-right border-l border-white/20 min-w-[110px]">Net Pay</th>
                {isDraft && <th className="px-3 py-3 font-medium text-center min-w-[80px]">Save</th>}
              </tr>
            </thead>
            <tbody className="divide-y">
              {run.entries.map((entry, idx) => {
                const profile = entry.user.profile;
                const shade   = idx % 2 === 1;
                const hasManual = manualComps.length > 0;
                const isDirty = hasManual && manualComps.some((c) => {
                  const orig = c.type === 'EARNING'
                    ? (entry.earnings[c.name] ?? 0)
                    : (entry.deductions[c.name] ?? 0);
                  const edit = parseFloat(manualEdits[entry.id]?.[c.name] ?? String(orig));
                  return edit !== orig;
                });

                return (
                  <tr key={entry.id} className={shade ? 'bg-gray-50' : 'bg-white'}>
                    <td className="px-3 py-2.5 font-mono text-gray-600">{profile?.employeeId ?? '—'}</td>
                    <td className="px-3 py-2.5 font-medium text-gray-800">{profile ? `${profile.firstName} ${profile.lastName}` : '—'}</td>
                    <td className="px-3 py-2.5 text-gray-500">{profile?.department ?? '—'}</td>
                    <td className="px-3 py-2.5 text-right text-gray-600">₹{fmt(entry.monthlyCtc)}</td>
                    <td className="px-3 py-2.5 text-center text-gray-600">{entry.workingDays}</td>
                    <td className="px-3 py-2.5 text-center">
                      {entry.lwpDays > 0 ? (
                        <span className="text-red-600 font-medium">{entry.lwpDays}</span>
                      ) : (
                        <span className="text-gray-400">0</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-center text-gray-600">{entry.paidDays}</td>

                    {/* Earnings */}
                    {earningCols.map((comp) => (
                      <td key={comp.id} className="px-3 py-2.5 text-right">
                        {comp.calcType === 'MANUAL' && isDraft ? (
                          <input
                            type="number"
                            min={0}
                            className="w-24 h-6 border rounded px-2 text-right text-xs bg-amber-50 border-amber-300 focus:outline-none focus:ring-1 focus:ring-amber-400"
                            value={manualEdits[entry.id]?.[comp.name] ?? '0'}
                            onChange={(e) =>
                              setManualEdits((p) => ({
                                ...p,
                                [entry.id]: { ...(p[entry.id] ?? {}), [comp.name]: e.target.value },
                              }))
                            }
                          />
                        ) : (
                          <span className="text-gray-700">₹{fmt(entry.earnings[comp.name] ?? 0)}</span>
                        )}
                      </td>
                    ))}

                    {/* Gross Pay */}
                    <td className="px-3 py-2.5 text-right font-medium border-l text-gray-800">
                      ₹{fmt(entry.grossPay)}
                    </td>

                    {/* Deductions */}
                    {allDeductionCols.map((comp) => {
                      const val = comp.name === 'LWP Deduction'
                        ? (entry.deductions['LWP Deduction'] ?? 0)
                        : (entry.deductions[comp.name] ?? 0);
                      return (
                        <td key={comp.id} className="px-3 py-2.5 text-right">
                          {comp.calcType === 'MANUAL' && isDraft ? (
                            <input
                              type="number"
                              min={0}
                              className="w-24 h-6 border rounded px-2 text-right text-xs bg-amber-50 border-amber-300 focus:outline-none focus:ring-1 focus:ring-amber-400"
                              value={manualEdits[entry.id]?.[comp.name] ?? '0'}
                              onChange={(e) =>
                                setManualEdits((p) => ({
                                  ...p,
                                  [entry.id]: { ...(p[entry.id] ?? {}), [comp.name]: e.target.value },
                                }))
                              }
                            />
                          ) : (
                            <span className={val > 0 ? 'text-red-600' : 'text-gray-400'}>
                              {val > 0 ? `₹${fmt(val)}` : '—'}
                            </span>
                          )}
                        </td>
                      );
                    })}

                    {/* Reimbursements */}
                    <td className="px-3 py-2.5 text-right border-l">
                      {entry.reimbursements > 0 ? (
                        <span className="text-green-600 font-medium">₹{fmt(entry.reimbursements)}</span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>

                    {/* Net Pay */}
                    <td className="px-3 py-2.5 text-right font-bold border-l" style={{ color: '#361963' }}>
                      ₹{fmt(entry.netPay)}
                      {(entry.arrearsAmount ?? 0) > 0 && (
                        <div className="text-[10px] font-normal text-amber-600" title={entry.arrearsNote ?? ''}>
                          +₹{fmt(entry.arrearsAmount!)} arrears
                        </div>
                      )}
                    </td>

                    {/* Save button (DRAFT only) */}
                    {isDraft && (
                      <td className="px-3 py-2.5 text-center">
                        {manualComps.length > 0 ? (
                          <div>
                            <button
                              disabled={savingEntry[entry.id] || !isDirty}
                              onClick={() => handleSaveEntry(entry)}
                              className={`text-xs px-2 py-1 rounded font-medium transition-colors ${
                                isDirty
                                  ? 'bg-[#361963] text-white hover:bg-[#2a1050]'
                                  : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                              }`}
                            >
                              {savingEntry[entry.id] ? '…' : isDirty ? 'Save' : '✓'}
                            </button>
                            {saveError[entry.id] && (
                              <p className="text-red-500 text-[10px] mt-0.5">{saveError[entry.id]}</p>
                            )}
                          </div>
                        ) : (
                          <span className="text-gray-300 text-xs">—</span>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>

            {/* Totals Row */}
            <tfoot>
              <tr style={{ backgroundColor: '#FD8C27', color: 'white' }}>
                <td className="px-3 py-2.5 font-bold" colSpan={7}>TOTAL</td>
                {earningCols.map((c) => (
                  <td key={c.id} className="px-3 py-2.5 text-right font-semibold">
                    ₹{fmt(run.entries.reduce((s, e) => s + (e.earnings[c.name] ?? 0), 0))}
                  </td>
                ))}
                <td className="px-3 py-2.5 text-right font-bold border-l border-white/30">
                  ₹{fmt(totals.gross)}
                </td>
                {allDeductionCols.map((c) => (
                  <td key={c.id} className="px-3 py-2.5 text-right font-semibold">
                    ₹{fmt(run.entries.reduce((s, e) => s + (e.deductions[c.name] ?? 0), 0))}
                  </td>
                ))}
                <td className="px-3 py-2.5 text-right font-semibold border-l border-white/30">
                  ₹{fmt(totals.reimbursements)}
                </td>
                <td className="px-3 py-2.5 text-right font-bold border-l border-white/30">
                  ₹{fmt(totals.net)}
                </td>
                {isDraft && <td />}
              </tr>
            </tfoot>
          </table>
        </CardContent>
      </Card>

      {isDraft && user?.role === 'ADMIN' && (
        <div className="flex justify-end">
          <Button
            onClick={handleSubmitForReview}
            disabled={submittingForReview}
            className="bg-blue-600 hover:bg-blue-700 text-white"
          >
            {submittingForReview ? 'Submitting…' : 'Submit for Review'}
          </Button>
        </div>
      )}
      {run.status === 'SUBMITTED' && (user?.role === 'OWNER' || user?.role === 'ADMIN') && (
        <div className="flex justify-end">
          <Button
            onClick={handleFinalize}
            disabled={finalizing}
            className="bg-green-600 hover:bg-green-700 text-white"
          >
            {finalizing ? 'Approving…' : 'Approve & Finalize Payroll Run'}
          </Button>
        </div>
      )}
    </div>
  );
}
