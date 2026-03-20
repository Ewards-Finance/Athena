/**
 * Athena V2 - Exit Management
 * Full exit lifecycle: initiation, notice period, clearance, settlement.
 */

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useAuth } from '../hooks/useAuth';
import api from '@/lib/api';
import { ArrowLeft, Plus, Calculator, XCircle } from 'lucide-react';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const formatINR = (amount: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount);

const STATUS_COLORS: Record<string, string> = {
  INITIATED:          'bg-yellow-100 text-yellow-700',
  NOTICE_PERIOD:      'bg-blue-100 text-blue-700',
  CLEARANCE_PENDING:  'bg-orange-100 text-orange-700',
  SETTLED:            'bg-green-100 text-green-700',
  CANCELLED:          'bg-gray-100 text-gray-500',
};

const STATUS_LABELS: Record<string, string> = {
  INITIATED:          'Initiated',
  NOTICE_PERIOD:      'Notice Period',
  CLEARANCE_PENDING:  'Clearance Pending',
  SETTLED:            'Settled',
  CANCELLED:          'Cancelled',
};

const CLEARANCE_LABELS: Record<string, string> = {
  PENDING: 'bg-yellow-100 text-yellow-700',
  CLEARED: 'bg-green-100 text-green-700',
};

const FILTER_TABS = ['ALL', 'INITIATED', 'NOTICE_PERIOD', 'CLEARANCE_PENDING', 'SETTLED', 'CANCELLED'];

const CLEARANCE_DEPARTMENTS = ['IT', 'Finance', 'HR', 'Admin', 'Manager'];

// ─── Component ───────────────────────────────────────────────────────────────

export default function ExitManagement() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN' || user?.role === 'OWNER';

  // Board state
  const [exits, setExits] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('ALL');

  // Detail state
  const [selectedExit, setSelectedExit] = useState<any>(null);
  const [detailTab, setDetailTab] = useState<'clearance' | 'settlement'>('clearance');

  // Initiate dialog state
  const [showInitDialog, setShowInitDialog] = useState(false);
  const [employees, setEmployees] = useState<any[]>([]);
  const [form, setForm] = useState({
    userId: '',
    reason: '',
    lastWorkingDate: '',
    noticePeriodDays: 90,
    buyoutDays: 0,
  });
  const [submitting, setSubmitting] = useState(false);

  // ─── Data fetching ───────────────────────────────────────────────────────

  const fetchExits = () => {
    setLoading(true);
    api
      .get('/exit')
      .then((r) => setExits(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchExits();
  }, []);

  const fetchExitDetail = (id: string) => {
    api
      .get(`/exit/${id}`)
      .then((r) => setSelectedExit(r.data))
      .catch(() => {});
  };

  const openInitDialog = () => {
    setForm({ userId: '', reason: '', lastWorkingDate: '', noticePeriodDays: 90, buyoutDays: 0 });
    setShowInitDialog(true);
    api
      .get('/employees')
      .then((r) => setEmployees(r.data))
      .catch(() => {});
  };

  // ─── Actions ─────────────────────────────────────────────────────────────

  const handleInitiate = async () => {
    if (!form.userId || !form.reason || !form.lastWorkingDate) return;
    setSubmitting(true);
    try {
      await api.post('/exit', {
        userId: form.userId,
        reason: form.reason,
        lastWorkingDate: form.lastWorkingDate,
        noticePeriodDays: form.noticePeriodDays,
        buyoutDays: form.buyoutDays,
      });
      setShowInitDialog(false);
      fetchExits();
    } catch {
      // silent
    } finally {
      setSubmitting(false);
    }
  };

  const handleMarkCleared = async (department: string) => {
    if (!selectedExit) return;
    try {
      await api.patch(`/exit/${selectedExit.id}/clearance`, {
        department,
        status: 'CLEARED',
      });
      fetchExitDetail(selectedExit.id);
      fetchExits();
    } catch {
      // silent
    }
  };

  const handleCalculateSettlement = async () => {
    if (!selectedExit) return;
    try {
      await api.post(`/exit/${selectedExit.id}/settlement`);
      fetchExitDetail(selectedExit.id);
    } catch {
      // silent
    }
  };

  const handleCancelExit = async () => {
    if (!selectedExit) return;
    try {
      await api.patch(`/exit/${selectedExit.id}/cancel`);
      fetchExitDetail(selectedExit.id);
      fetchExits();
    } catch {
      // silent
    }
  };

  // ─── Filtered exits ──────────────────────────────────────────────────────

  const filteredExits =
    statusFilter === 'ALL' ? exits : exits.filter((e) => e.status === statusFilter);

  // ─── Detail View ─────────────────────────────────────────────────────────

  if (selectedExit) {
    const ex = selectedExit;
    const empName =
      ex.user?.profile
        ? `${ex.user.profile.firstName || ''} ${ex.user.profile.lastName || ''}`.trim()
        : ex.user?.email || '—';
    const empId = ex.user?.employeeId || ex.user?.profile?.employeeId || '—';
    const designation = ex.user?.profile?.designation || '—';
    const department = ex.user?.profile?.department || '—';
    const clearances: Record<string, string> = ex.clearances || {};
    const settlement = ex.settlement || null;

    return (
      <div className="p-6 space-y-6">
        {/* Back button */}
        <button
          onClick={() => {
            setSelectedExit(null);
            setDetailTab('clearance');
          }}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Exits
        </button>

        {/* Employee header */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold">{empName}</h2>
                <p className="text-sm text-muted-foreground">
                  {empId} &middot; {designation} &middot; {department}
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  Initiated: {new Date(ex.createdAt).toLocaleDateString('en-IN')} &middot; LWD:{' '}
                  {ex.lastWorkingDate
                    ? new Date(ex.lastWorkingDate).toLocaleDateString('en-IN')
                    : '—'}
                </p>
              </div>
              <Badge className={STATUS_COLORS[ex.status] || 'bg-gray-100 text-gray-500'}>
                {STATUS_LABELS[ex.status] || ex.status}
              </Badge>
            </div>
          </CardContent>
        </Card>

        {/* Detail tabs */}
        <div className="flex gap-4 border-b">
          {(['clearance', 'settlement'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setDetailTab(tab)}
              className={`pb-2 px-1 text-sm font-medium capitalize transition-colors ${
                detailTab === tab
                  ? 'border-b-2 border-[#361963] text-[#361963]'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Clearance Tab */}
        {detailTab === 'clearance' && (
          <div className="space-y-3">
            {CLEARANCE_DEPARTMENTS.map((dept) => {
              const status = clearances[dept] || 'PENDING';
              return (
                <div
                  key={dept}
                  className="flex items-center justify-between border rounded-lg p-4"
                >
                  <span className="font-medium">{dept}</span>
                  <div className="flex items-center gap-3">
                    <Badge className={CLEARANCE_LABELS[status] || 'bg-gray-100 text-gray-500'}>
                      {status}
                    </Badge>
                    {status === 'PENDING' && isAdmin && (
                      <Button
                        size="sm"
                        style={{ backgroundColor: '#361963' }}
                        className="text-white"
                        onClick={() => handleMarkCleared(dept)}
                      >
                        Mark Cleared
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Settlement Tab */}
        {detailTab === 'settlement' && (
          <div className="space-y-4">
            {isAdmin && (
              <Button
                onClick={handleCalculateSettlement}
                style={{ backgroundColor: '#361963' }}
                className="text-white"
              >
                <Calculator className="w-4 h-4 mr-2" />
                Calculate Settlement
              </Button>
            )}

            {settlement && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Settlement Breakdown</CardTitle>
                </CardHeader>
                <CardContent>
                  <table className="w-full text-sm">
                    <tbody>
                      {/* Earnings */}
                      <tr>
                        <td colSpan={2} className="font-semibold pt-2 pb-1 text-green-700">
                          Earnings
                        </td>
                      </tr>
                      {settlement.proRatedSalary != null && (
                        <tr>
                          <td className="py-1 pl-4">Pro-rated Salary</td>
                          <td className="py-1 text-right">{formatINR(settlement.proRatedSalary)}</td>
                        </tr>
                      )}
                      {settlement.leaveEncashment != null && (
                        <tr>
                          <td className="py-1 pl-4">
                            Leave Encashment
                            {settlement.leaveEncashmentDays
                              ? ` (${settlement.leaveEncashmentDays} days)`
                              : ''}
                          </td>
                          <td className="py-1 text-right">
                            {formatINR(settlement.leaveEncashment)}
                          </td>
                        </tr>
                      )}
                      {settlement.pendingClaims != null && (
                        <tr>
                          <td className="py-1 pl-4">Pending Claims</td>
                          <td className="py-1 text-right">{formatINR(settlement.pendingClaims)}</td>
                        </tr>
                      )}
                      {settlement.arrears != null && (
                        <tr>
                          <td className="py-1 pl-4">Arrears</td>
                          <td className="py-1 text-right">{formatINR(settlement.arrears)}</td>
                        </tr>
                      )}
                      {settlement.bonus != null && (
                        <tr>
                          <td className="py-1 pl-4">Bonus</td>
                          <td className="py-1 text-right">{formatINR(settlement.bonus)}</td>
                        </tr>
                      )}

                      {/* Deductions */}
                      <tr>
                        <td colSpan={2} className="font-semibold pt-4 pb-1 text-red-700">
                          Deductions
                        </td>
                      </tr>
                      {settlement.noticePeriodRecovery != null && (
                        <tr>
                          <td className="py-1 pl-4">Notice Period Recovery</td>
                          <td className="py-1 text-right">
                            {formatINR(settlement.noticePeriodRecovery)}
                          </td>
                        </tr>
                      )}
                      {settlement.loanOutstanding != null && (
                        <tr>
                          <td className="py-1 pl-4">Loan Outstanding</td>
                          <td className="py-1 text-right">
                            {formatINR(settlement.loanOutstanding)}
                          </td>
                        </tr>
                      )}
                      {settlement.otherDeductions != null && (
                        <tr>
                          <td className="py-1 pl-4">Other Deductions</td>
                          <td className="py-1 text-right">
                            {formatINR(settlement.otherDeductions)}
                          </td>
                        </tr>
                      )}

                      {/* Net Total */}
                      <tr className="border-t-2">
                        <td className="py-2 font-bold text-base">Net Payable</td>
                        <td className="py-2 text-right font-bold text-base">
                          {formatINR(settlement.netPayable ?? 0)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            )}

            {/* Cancel Exit */}
            {isAdmin && ex.status !== 'SETTLED' && ex.status !== 'CANCELLED' && (
              <Button
                variant="outline"
                className="text-red-600 border-red-300 hover:bg-red-50"
                onClick={handleCancelExit}
              >
                <XCircle className="w-4 h-4 mr-2" />
                Cancel Exit
              </Button>
            )}
          </div>
        )}
      </div>
    );
  }

  // ─── Board View ──────────────────────────────────────────────────────────

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Exit Management</h1>
        {isAdmin && (
          <Button
            onClick={openInitDialog}
            style={{ backgroundColor: '#361963' }}
            className="text-white"
          >
            <Plus className="w-4 h-4 mr-2" />
            Initiate Exit
          </Button>
        )}
      </div>

      {/* Tab filters */}
      <div className="flex gap-4 border-b overflow-x-auto">
        {FILTER_TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setStatusFilter(tab)}
            className={`pb-2 px-1 text-sm font-medium whitespace-nowrap transition-colors ${
              statusFilter === tab
                ? 'border-b-2 border-[#361963] text-[#361963]'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab === 'ALL' ? 'All' : STATUS_LABELS[tab] || tab}
          </button>
        ))}
      </div>

      {/* List */}
      {loading ? (
        <p className="text-muted-foreground">Loading...</p>
      ) : filteredExits.length === 0 ? (
        <p className="text-muted-foreground">No exit requests found.</p>
      ) : (
        <div className="space-y-3">
          {filteredExits.map((ex) => {
            const empName =
              ex.user?.profile
                ? `${ex.user.profile.firstName || ''} ${ex.user.profile.lastName || ''}`.trim()
                : ex.user?.email || '—';
            const empId = ex.user?.employeeId || ex.user?.profile?.employeeId || '—';

            return (
              <Card
                key={ex.id}
                className="cursor-pointer hover:shadow-md transition-shadow"
                onClick={() => {
                  fetchExitDetail(ex.id);
                  setSelectedExit(ex); // show immediately, detail fetch updates
                  setDetailTab('clearance');
                }}
              >
                <CardContent className="pt-4 flex items-center justify-between">
                  <div>
                    <p className="font-medium">{empName}</p>
                    <p className="text-sm text-muted-foreground">
                      {empId} &middot; LWD:{' '}
                      {ex.lastWorkingDate
                        ? new Date(ex.lastWorkingDate).toLocaleDateString('en-IN')
                        : '—'}
                    </p>
                    {ex.reason && (
                      <p className="text-sm text-muted-foreground mt-1 line-clamp-1">
                        {ex.reason}
                      </p>
                    )}
                  </div>
                  <Badge className={STATUS_COLORS[ex.status] || 'bg-gray-100 text-gray-500'}>
                    {STATUS_LABELS[ex.status] || ex.status}
                  </Badge>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Initiate Exit Dialog */}
      <Dialog open={showInitDialog} onOpenChange={setShowInitDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Initiate Exit</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            {/* Employee select */}
            <div className="space-y-1">
              <Label>Employee</Label>
              <select
                className="w-full border rounded-md px-3 py-2 text-sm bg-background"
                value={form.userId}
                onChange={(e) => setForm({ ...form, userId: e.target.value })}
              >
                <option value="">Select employee...</option>
                {employees.map((emp: any) => {
                  const name = emp.profile
                    ? `${emp.profile.firstName || ''} ${emp.profile.lastName || ''}`.trim()
                    : emp.email;
                  const eid = emp.employeeId || emp.profile?.employeeId || '';
                  return (
                    <option key={emp.id} value={emp.id}>
                      {name} {eid ? `(${eid})` : ''}
                    </option>
                  );
                })}
              </select>
            </div>

            {/* Reason */}
            <div className="space-y-1">
              <Label>Reason</Label>
              <textarea
                className="w-full border rounded-md px-3 py-2 text-sm bg-background min-h-[80px]"
                placeholder="Reason for exit..."
                value={form.reason}
                onChange={(e) => setForm({ ...form, reason: e.target.value })}
              />
            </div>

            {/* Last Working Date */}
            <div className="space-y-1">
              <Label>Last Working Date</Label>
              <Input
                type="date"
                value={form.lastWorkingDate}
                onChange={(e) => setForm({ ...form, lastWorkingDate: e.target.value })}
              />
            </div>

            {/* Notice Period Days */}
            <div className="space-y-1">
              <Label>Notice Period Days</Label>
              <Input
                type="number"
                value={form.noticePeriodDays}
                onChange={(e) =>
                  setForm({ ...form, noticePeriodDays: parseInt(e.target.value) || 0 })
                }
              />
            </div>

            {/* Buyout Days */}
            <div className="space-y-1">
              <Label>Buyout Days (optional)</Label>
              <Input
                type="number"
                value={form.buyoutDays}
                onChange={(e) =>
                  setForm({ ...form, buyoutDays: parseInt(e.target.value) || 0 })
                }
              />
            </div>

            {/* Submit */}
            <Button
              className="w-full text-white"
              style={{ backgroundColor: '#361963' }}
              disabled={submitting || !form.userId || !form.reason || !form.lastWorkingDate}
              onClick={handleInitiate}
            >
              {submitting ? 'Submitting...' : 'Initiate Exit'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
