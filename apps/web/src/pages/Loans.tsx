/**
 * Athena V3.1 - Loans & Advances Page
 * Employees request loans; Admin approves/rejects (can edit amount & tenure); EMI auto-deducted in payroll.
 * EMI computed via standard reducing-balance formula at the configured annual interest rate.
 */

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import api from '@/lib/api';
import { formatDate, formatCurrency } from '@/lib/utils';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Loader2, Plus, Check, X, Landmark, IndianRupee, ChevronDown, ChevronUp } from 'lucide-react';

// ─── EMI preview helper (reducing balance) ────────────────────────────────────

function calcEMI(principal: number, annualRate: number, tenure: number): number {
  if (!principal || !tenure || principal <= 0 || tenure <= 0) return 0;
  if (annualRate === 0) return Math.round((principal / tenure) * 100) / 100;
  const r = annualRate / 12 / 100;
  const emi = (principal * r * Math.pow(1 + r, tenure)) / (Math.pow(1 + r, tenure) - 1);
  return Math.round(emi * 100) / 100;
}

// ─── Schema ─────────────────────────────────────────────────────────────────────

const loanSchema = z.object({
  amount:       z.coerce.number().positive('Amount must be positive'),
  installments: z.coerce.number().int().min(1, 'Min 1').max(60, 'Max 60 months'),
  reason:       z.string().min(5, 'Reason must be at least 5 characters'),
});

type LoanFormData = z.infer<typeof loanSchema>;

interface Loan {
  id:               string;
  userId:           string;
  amount:           number;
  installments:     number;
  monthlyEMI:       number;
  interestRate:     number;
  reason:           string;
  status:           string;
  approvedBy?:      string;
  approvedAt?:      string;
  startMonth?:      number;
  startYear?:       number;
  paidInstallments: number;
  createdAt:        string;
  user?: {
    email?: string;
    profile?: { firstName: string; lastName: string; employeeId: string };
  };
}

interface ScheduleRow {
  emiNo:     number;
  month:     number;
  year:      number;
  emi:       number;
  principal: number;
  interest:  number;
  remaining: number;
}

const STATUS_COLORS: Record<string, string> = {
  PENDING:  'bg-yellow-100 text-yellow-800',
  APPROVED: 'bg-blue-100 text-blue-800',
  ACTIVE:   'bg-green-100 text-green-800',
  CLOSED:   'bg-gray-100 text-gray-800',
  REJECTED: 'bg-red-100 text-red-800',
};

const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export default function Loans() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const isAdmin = user?.role === 'ADMIN' || user?.role === 'OWNER';
  const [tab, setTab] = useState<'my' | 'manage'>('my');
  const [showForm, setShowForm] = useState(false);

  // Approve dialog state
  const [approveId, setApproveId]           = useState<string | null>(null);
  const [approveAmount, setApproveAmount]   = useState<number>(0);
  const [approveMonths, setApproveMonths]   = useState<number>(6);
  const [approveMonth, setApproveMonth]     = useState(new Date().getMonth() + 2 > 12 ? 1 : new Date().getMonth() + 2);
  const [approveYear, setApproveYear]       = useState(new Date().getMonth() + 2 > 12 ? new Date().getFullYear() + 1 : new Date().getFullYear());

  // Schedule viewer state
  const [scheduleOpen, setScheduleOpen]     = useState<string | null>(null);
  const [scheduleData, setScheduleData]     = useState<{ schedule: ScheduleRow[]; paidInstallments: number } | null>(null);
  const [scheduleLoading, setScheduleLoading] = useState(false);

  const { data: loans = [], isLoading } = useQuery<Loan[]>({
    queryKey: ['loans'],
    queryFn: () => api.get('/loans').then(r => r.data),
  });

  // Current loan interest rate (for EMI preview)
  const { data: rateData } = useQuery<{ rate: number }>({
    queryKey: ['loan-rate'],
    queryFn: () => api.get('/loans/rate').then(r => r.data),
  });
  const interestRate = rateData?.rate ?? 9;

  const form = useForm<LoanFormData>({
    resolver: zodResolver(loanSchema),
    defaultValues: { amount: 0, installments: 12, reason: '' },
  });

  const watchAmount      = form.watch('amount');
  const watchInstallments = form.watch('installments');
  const previewEMI = calcEMI(Number(watchAmount), interestRate, Number(watchInstallments));

  const [submitting, setSubmitting] = useState(false);
  const [processingId, setProcessingId] = useState<string | null>(null);

  async function onSubmit(data: LoanFormData) {
    setSubmitting(true);
    try {
      await api.post('/loans', data);
      qc.invalidateQueries({ queryKey: ['loans'] });
      form.reset();
      setShowForm(false);
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to submit loan request');
    } finally {
      setSubmitting(false);
    }
  }

  // Open the approve dialog, pre-fill amount & installments from the loan
  function openApprove(loan: Loan) {
    setApproveId(loan.id);
    setApproveAmount(loan.amount);
    setApproveMonths(loan.installments);
  }

  async function handleApprove(id: string) {
    setProcessingId(id);
    try {
      await api.patch(`/loans/${id}/approve`, {
        startMonth:   approveMonth,
        startYear:    approveYear,
        installments: approveMonths,
        amount:       approveAmount,
      });
      qc.invalidateQueries({ queryKey: ['loans'] });
      setApproveId(null);
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to approve');
    } finally {
      setProcessingId(null);
    }
  }

  async function handleReject(id: string) {
    const reason = prompt('Reason for rejection (optional):');
    setProcessingId(id);
    try {
      await api.patch(`/loans/${id}/reject`, { reason });
      qc.invalidateQueries({ queryKey: ['loans'] });
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to reject');
    } finally {
      setProcessingId(null);
    }
  }

  async function toggleSchedule(loan: Loan) {
    if (scheduleOpen === loan.id) {
      setScheduleOpen(null);
      setScheduleData(null);
      return;
    }
    setScheduleOpen(loan.id);
    setScheduleData(null);
    setScheduleLoading(true);
    try {
      const { data } = await api.get(`/loans/${loan.id}/schedule`);
      setScheduleData(data);
    } catch {
      setScheduleData({ schedule: [], paidInstallments: 0 });
    } finally {
      setScheduleLoading(false);
    }
  }

  const myLoans     = loans.filter(l => l.userId === user?.id);
  const pendingLoans = loans.filter(l => l.status === 'PENDING');
  const activeLoan  = myLoans.find(l => l.status === 'ACTIVE' || l.status === 'APPROVED');

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Loans & Advances</h1>
        {!isAdmin && !activeLoan && (
          <Button onClick={() => setShowForm(!showForm)} size="sm" style={{ backgroundColor: '#361963' }} className="text-white">
            <Plus className="h-4 w-4 mr-1" /> Request Loan
          </Button>
        )}
      </div>

      {/* ── Tabs (admin only) ── */}
      {isAdmin && (
        <div className="flex gap-2 border-b">
          <button
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === 'my' ? 'border-[#361963] text-[#361963]' : 'border-transparent text-muted-foreground'}`}
            onClick={() => setTab('my')}
          >
            My Loans
          </button>
          <button
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === 'manage' ? 'border-[#361963] text-[#361963]' : 'border-transparent text-muted-foreground'}`}
            onClick={() => setTab('manage')}
          >
            Manage {pendingLoans.length > 0 && <Badge variant="secondary" className="ml-1 text-xs">{pendingLoans.length}</Badge>}
          </button>
        </div>
      )}

      {/* ── Active Loan Summary card ── */}
      {tab === 'my' && activeLoan && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <Landmark className="h-4 w-4 text-[#361963]" />
              <CardTitle className="text-base">Active Loan</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground">Amount</p>
                <p className="font-semibold">{formatCurrency(activeLoan.amount)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Monthly EMI</p>
                <p className="font-semibold">{formatCurrency(activeLoan.monthlyEMI)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Paid</p>
                <p className="font-semibold">{activeLoan.paidInstallments} / {activeLoan.installments}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Interest Rate</p>
                <p className="font-semibold">{activeLoan.interestRate}% p.a.</p>
              </div>
            </div>
            {/* Progress bar */}
            <div>
              <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full bg-[#361963] transition-all"
                  style={{ width: `${(activeLoan.paidInstallments / activeLoan.installments) * 100}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {Math.round((activeLoan.paidInstallments / activeLoan.installments) * 100)}% repaid
                {activeLoan.startMonth && activeLoan.startYear && ` | EMI started ${MONTHS[activeLoan.startMonth]} ${activeLoan.startYear}`}
              </p>
            </div>
            {/* Schedule toggle */}
            {activeLoan.startMonth && (
              <button
                className="flex items-center gap-1 text-xs text-[#361963] hover:underline"
                onClick={() => toggleSchedule(activeLoan)}
              >
                {scheduleOpen === activeLoan.id ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                {scheduleOpen === activeLoan.id ? 'Hide Schedule' : 'View Repayment Schedule'}
              </button>
            )}
            {scheduleOpen === activeLoan.id && <ScheduleTable scheduleData={scheduleData} loading={scheduleLoading} />}
          </CardContent>
        </Card>
      )}

      {/* ── Request Form ── */}
      {showForm && tab === 'my' && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Request Loan / Advance</CardTitle>
            <CardDescription>
              EMI will be auto-deducted from salary. Current interest rate: <strong>{interestRate}% p.a.</strong> (reducing balance method)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 max-w-md">
              <div>
                <Label>Amount (₹)</Label>
                <Input type="number" {...form.register('amount')} placeholder="e.g. 50000" />
                {form.formState.errors.amount && <p className="text-xs text-red-500 mt-1">{form.formState.errors.amount.message}</p>}
              </div>
              <div>
                <Label>Tenure (months)</Label>
                <Input type="number" {...form.register('installments')} placeholder="e.g. 12" />
                {form.formState.errors.installments && <p className="text-xs text-red-500 mt-1">{form.formState.errors.installments.message}</p>}
              </div>
              {previewEMI > 0 && (
                <div className="flex items-center gap-2 text-sm bg-muted/50 rounded-lg p-3">
                  <IndianRupee className="h-4 w-4" />
                  <span>
                    Estimated monthly EMI: <strong>{formatCurrency(previewEMI)}</strong>
                    <span className="text-xs text-muted-foreground ml-1">(at {interestRate}% p.a. — admin may adjust)</span>
                  </span>
                </div>
              )}
              <div>
                <Label>Reason</Label>
                <textarea
                  {...form.register('reason')}
                  className="w-full border rounded-lg p-2 text-sm min-h-[60px] resize-none"
                  placeholder="Reason for loan request..."
                />
                {form.formState.errors.reason && <p className="text-xs text-red-500 mt-1">{form.formState.errors.reason.message}</p>}
              </div>
              <div className="flex gap-2">
                <Button type="submit" disabled={submitting} size="sm" style={{ backgroundColor: '#361963' }} className="text-white">
                  {submitting && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Submit Request
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => { setShowForm(false); form.reset(); }}>Cancel</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* ── Loan List ── */}
      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading...</div>
      ) : (
        <div className="space-y-3">
          {(tab === 'my' ? myLoans : loans).map(loan => (
            <Card key={loan.id}>
              <CardContent className="pt-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1 flex-1">
                    {tab === 'manage' && loan.user?.profile && (
                      <p className="text-sm font-medium">
                        {loan.user.profile.firstName} {loan.user.profile.lastName}
                        <span className="text-muted-foreground text-xs ml-2 font-mono">({loan.user.profile.employeeId})</span>
                      </p>
                    )}
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold">{formatCurrency(loan.amount)}</span>
                      <Badge className={STATUS_COLORS[loan.status] || 'bg-gray-100'}>{loan.status}</Badge>
                      {loan.interestRate > 0 && (
                        <span className="text-xs text-muted-foreground">{loan.interestRate}% p.a.</span>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {loan.installments} months | EMI: {formatCurrency(loan.monthlyEMI)}
                      {loan.paidInstallments > 0 && ` | Paid: ${loan.paidInstallments}/${loan.installments}`}
                    </p>
                    <p className="text-sm text-muted-foreground">{loan.reason}</p>
                    <p className="text-xs text-muted-foreground">Applied: {formatDate(loan.createdAt)}</p>

                    {/* Schedule toggle for approved/active loans */}
                    {(loan.status === 'ACTIVE' || loan.status === 'APPROVED' || loan.status === 'CLOSED') && loan.startMonth && (
                      <button
                        className="flex items-center gap-1 text-xs text-[#361963] hover:underline mt-1"
                        onClick={() => toggleSchedule(loan)}
                      >
                        {scheduleOpen === loan.id ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                        {scheduleOpen === loan.id ? 'Hide Schedule' : 'View Repayment Schedule'}
                      </button>
                    )}
                    {scheduleOpen === loan.id && <ScheduleTable scheduleData={scheduleData} loading={scheduleLoading} paidInstallments={loan.paidInstallments} />}
                  </div>

                  {/* Admin actions */}
                  {tab === 'manage' && loan.status === 'PENDING' && (
                    <div className="flex-shrink-0">
                      {approveId === loan.id ? (
                        <div className="space-y-3 text-sm border rounded-lg p-3 bg-muted/30 min-w-[240px]">
                          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Approve Loan</p>

                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <Label className="text-xs">Amount (₹)</Label>
                              <Input
                                type="number"
                                value={approveAmount}
                                onChange={e => setApproveAmount(Number(e.target.value))}
                                className="h-8 text-sm"
                              />
                            </div>
                            <div>
                              <Label className="text-xs">Months</Label>
                              <Input
                                type="number"
                                value={approveMonths}
                                min={1}
                                max={60}
                                onChange={e => setApproveMonths(Number(e.target.value))}
                                className="h-8 text-sm"
                              />
                            </div>
                          </div>

                          {/* EMI preview */}
                          {approveAmount > 0 && approveMonths > 0 && (
                            <div className="text-xs bg-white border rounded px-2 py-1.5">
                              <span className="text-muted-foreground">EMI at {interestRate}% p.a.: </span>
                              <strong>{formatCurrency(calcEMI(approveAmount, interestRate, approveMonths))}/mo</strong>
                            </div>
                          )}

                          <div>
                            <Label className="text-xs">EMI Start Month</Label>
                            <div className="flex gap-1 mt-1">
                              <select
                                value={approveMonth}
                                onChange={e => setApproveMonth(Number(e.target.value))}
                                className="border rounded px-2 py-1 text-sm flex-1"
                              >
                                {MONTHS.slice(1).map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
                              </select>
                              <Input
                                type="number"
                                value={approveYear}
                                onChange={e => setApproveYear(Number(e.target.value))}
                                className="w-20 h-8"
                              />
                            </div>
                          </div>

                          <div className="flex gap-1">
                            <Button size="sm" onClick={() => handleApprove(loan.id)} disabled={processingId === loan.id} style={{ backgroundColor: '#361963' }} className="text-white">
                              {processingId === loan.id ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Check className="h-3 w-3 mr-1" />} Approve
                            </Button>
                            <Button size="sm" variant="ghost" disabled={processingId === loan.id} onClick={() => setApproveId(null)}>Cancel</Button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex gap-2">
                          <Button size="sm" variant="outline" disabled={processingId === loan.id} onClick={() => openApprove(loan)}>
                            <Check className="h-3 w-3 mr-1" /> Approve
                          </Button>
                          <Button size="sm" variant="outline" className="text-red-600 border-red-200 hover:bg-red-50" disabled={processingId === loan.id} onClick={() => handleReject(loan.id)}>
                            {processingId === loan.id ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <X className="h-3 w-3 mr-1" />} Reject
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Repayment progress for active/closed loans */}
                {(loan.status === 'ACTIVE' || loan.status === 'CLOSED') && loan.installments > 0 && (
                  <div className="mt-3">
                    <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full bg-[#361963] transition-all"
                        style={{ width: `${(loan.paidInstallments / loan.installments) * 100}%` }}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {loan.paidInstallments}/{loan.installments} installments paid
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}

          {(tab === 'my' ? myLoans : loans).length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">No loan requests found.</p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Schedule Table Component ──────────────────────────────────────────────────

function ScheduleTable({
  scheduleData,
  loading,
  paidInstallments = 0,
}: {
  scheduleData: { schedule: ScheduleRow[]; paidInstallments: number } | null;
  loading: boolean;
  paidInstallments?: number;
}) {
  const MONTH_NAMES = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const paid = scheduleData?.paidInstallments ?? paidInstallments;

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground text-xs py-2">
        <Loader2 className="h-3 w-3 animate-spin" /> Loading schedule...
      </div>
    );
  }

  if (!scheduleData || scheduleData.schedule.length === 0) {
    return <p className="text-xs text-muted-foreground py-2">Schedule not available yet.</p>;
  }

  return (
    <div className="mt-2 overflow-x-auto rounded-lg border">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-muted/50 text-muted-foreground uppercase tracking-wide">
            <th className="px-3 py-2 text-left">#</th>
            <th className="px-3 py-2 text-left">Month</th>
            <th className="px-3 py-2 text-right">EMI</th>
            <th className="px-3 py-2 text-right">Principal</th>
            <th className="px-3 py-2 text-right">Interest</th>
            <th className="px-3 py-2 text-right">Balance</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {scheduleData.schedule.map((row) => (
            <tr
              key={row.emiNo}
              className={`${row.emiNo <= paid ? 'bg-green-50 text-muted-foreground' : 'hover:bg-muted/20'}`}
            >
              <td className="px-3 py-1.5 font-mono">{row.emiNo}</td>
              <td className="px-3 py-1.5">{MONTH_NAMES[row.month]} {row.year}</td>
              <td className="px-3 py-1.5 text-right font-medium">₹{row.emi.toLocaleString('en-IN')}</td>
              <td className="px-3 py-1.5 text-right">₹{row.principal.toLocaleString('en-IN')}</td>
              <td className="px-3 py-1.5 text-right text-orange-600">₹{row.interest.toLocaleString('en-IN')}</td>
              <td className="px-3 py-1.5 text-right">₹{row.remaining.toLocaleString('en-IN')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
