/**
 * Athena V2 - Payroll Runs (Admin only)
 * Lists all payroll runs and allows creating a new one.
 */

import { useState, useEffect }  from 'react';
import { useNavigate }          from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge }  from '@/components/ui/badge';
import api        from '@/lib/api';
import { formatCurrency } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────
interface PayrollRun {
  id:           string;
  month:        number;
  year:         number;
  status:       'DRAFT' | 'FINALIZED';
  processedBy:  string;
  createdAt:    string;
  _count:       { entries: number };
}

const MONTHS = [
  '', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// ─── Component ────────────────────────────────────────────────────────────────
export default function PayrollRuns() {
  const navigate = useNavigate();

  const [runs, setRuns]       = useState<PayrollRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');

  // New run form
  const [showForm, setShowForm]   = useState(false);
  const [formMonth, setFormMonth] = useState(String(new Date().getMonth() + 1));
  const [formYear, setFormYear]   = useState(String(new Date().getFullYear()));
  const [creating, setCreating]   = useState(false);
  const [createError, setCreateError] = useState('');

  const fetchRuns = async () => {
    setLoading(true);
    try {
      const res = await api.get('/payroll/runs');
      setRuns(res.data);
    } catch {
      setError('Failed to load payroll runs.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchRuns(); }, []);

  // Create new run
  const handleCreate = async () => {
    setCreateError('');
    const month = parseInt(formMonth);
    const year  = parseInt(formYear);
    if (!month || !year) { setCreateError('Select a valid month and year.'); return; }

    setCreating(true);
    try {
      const res = await api.post('/payroll/runs', { month, year });
      setShowForm(false);
      navigate(`/payroll/runs/${res.data.id}`);
    } catch (err: any) {
      setCreateError(err?.response?.data?.error ?? 'Failed to create payroll run.');
    } finally {
      setCreating(false);
    }
  };

  // Delete draft
  const handleDelete = async (id: string, month: number, year: number) => {
    if (!confirm(`Delete DRAFT payroll run for ${MONTHS[month]} ${year}? This cannot be undone.`)) return;
    try {
      await api.delete(`/payroll/runs/${id}`);
      fetchRuns();
    } catch (err: any) {
      alert(err?.response?.data?.error ?? 'Failed to delete.');
    }
  };

  // Reopen finalized run
  const [reopening, setReopening] = useState<string | null>(null);
  const handleReopen = async (id: string, month: number, year: number) => {
    if (!confirm(`Reopen ${MONTHS[month]} ${year} payroll run? It will go back to DRAFT and employees can no longer view it as finalized until you re-finalize.`)) return;
    setReopening(id);
    try {
      await api.post(`/payroll/runs/${id}/reopen`);
      fetchRuns();
    } catch (err: any) {
      alert(err?.response?.data?.error ?? 'Failed to reopen run.');
    } finally {
      setReopening(null);
    }
  };

  const currentYear = new Date().getFullYear();
  const yearOptions = Array.from({ length: 5 }, (_, i) => currentYear - 1 + i);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: '#361963' }}>Payroll</h1>
          <p className="text-sm text-gray-500 mt-1">Process and manage monthly payroll runs</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate('/payroll/setup')}
          >
            Payroll Settings
          </Button>
          <Button
            style={{ backgroundColor: '#FD8C27' }}
            className="text-white"
            onClick={() => { setShowForm(true); setCreateError(''); }}
          >
            + New Payroll Run
          </Button>
        </div>
      </div>

      {/* New Run Form */}
      {showForm && (
        <Card className="border-[#FD8C27]">
          <CardHeader className="pb-3">
            <CardTitle className="text-base" style={{ color: '#361963' }}>
              Create New Payroll Run
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex gap-4 items-end">
              <div className="space-y-1">
                <label className="text-sm font-medium text-gray-700">Month</label>
                <select
                  value={formMonth}
                  onChange={(e) => setFormMonth(e.target.value)}
                  className="h-9 border rounded-md px-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#361963]/30"
                >
                  {MONTHS.slice(1).map((m, i) => (
                    <option key={i + 1} value={i + 1}>{m}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-gray-700">Year</label>
                <select
                  value={formYear}
                  onChange={(e) => setFormYear(e.target.value)}
                  className="h-9 border rounded-md px-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#361963]/30"
                >
                  {yearOptions.map((y) => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
              </div>
              <Button
                disabled={creating}
                onClick={handleCreate}
                style={{ backgroundColor: '#361963' }}
                className="text-white"
              >
                {creating ? 'Processing…' : `Generate ${MONTHS[parseInt(formMonth)]} ${formYear}`}
              </Button>
              <Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
            </div>
            {createError && <p className="text-red-500 text-sm mt-3">{createError}</p>}
            <p className="text-xs text-gray-400 mt-3">
              This will auto-calculate salaries for all active employees with CTC set.
              The run starts as a DRAFT — you can edit manual components before finalizing.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Runs List */}
      {loading ? (
        <p className="text-gray-400 text-sm">Loading payroll runs…</p>
      ) : error ? (
        <p className="text-red-500 text-sm">{error}</p>
      ) : runs.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-gray-400 text-sm">No payroll runs yet.</p>
            <p className="text-gray-400 text-xs mt-1">Click "New Payroll Run" to generate your first one.</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-sm min-w-[500px]">
              <thead>
                <tr className="border-b bg-gray-50 text-left text-xs text-gray-500">
                  <th className="px-4 py-3 font-medium">Period</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium text-center">Employees</th>
                  <th className="px-4 py-3 font-medium">Generated On</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {runs.map((run) => (
                  <tr
                    key={run.id}
                    className="hover:bg-gray-50 cursor-pointer"
                    onClick={() => navigate(`/payroll/runs/${run.id}`)}
                  >
                    <td className="px-4 py-3 font-semibold" style={{ color: '#361963' }}>
                      {MONTHS[run.month]} {run.year}
                    </td>
                    <td className="px-4 py-3">
                      <Badge
                        className={
                          run.status === 'FINALIZED'
                            ? 'bg-green-100 text-green-700 border-green-200'
                            : 'bg-yellow-100 text-yellow-700 border-yellow-200'
                        }
                      >
                        {run.status === 'FINALIZED' ? 'Finalized' : 'Draft'}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-center text-gray-600">{run._count.entries}</td>
                    <td className="px-4 py-3 text-gray-500">
                      {new Date(run.createdAt).toLocaleDateString('en-IN', {
                        day: '2-digit', month: 'short', year: 'numeric',
                      })}
                    </td>
                    <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          onClick={() => navigate(`/payroll/runs/${run.id}`)}
                        >
                          {run.status === 'DRAFT' ? 'Edit' : 'View'}
                        </Button>
                        {run.status === 'DRAFT' && (
                          <button
                            onClick={() => handleDelete(run.id, run.month, run.year)}
                            className="text-xs text-red-400 hover:text-red-600 px-2 py-1 rounded"
                          >
                            Delete
                          </button>
                        )}
                        {run.status === 'FINALIZED' && (
                          <button
                            disabled={reopening === run.id}
                            onClick={() => handleReopen(run.id, run.month, run.year)}
                            className="text-xs text-amber-600 hover:text-amber-800 px-2 py-1 rounded disabled:opacity-50"
                          >
                            {reopening === run.id ? 'Reopening…' : 'Reopen'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
