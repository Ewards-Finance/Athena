/**
 * Athena V3.1 - Loans & Advances Page
 * Employees request loans; Admin approves/rejects; EMI auto-deducted in payroll.
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
import { Loader2, Plus, Check, X, Landmark, IndianRupee } from 'lucide-react';

// ─── Schema ─────────────────────────────────────────────────────────────────────

const loanSchema = z.object({
  amount:       z.coerce.number().positive('Amount must be positive'),
  installments: z.coerce.number().int().min(1, 'Min 1').max(60, 'Max 60'),
  reason:       z.string().min(5, 'Reason must be at least 5 characters'),
});

type LoanFormData = z.infer<typeof loanSchema>;

interface Loan {
  id:               string;
  userId:           string;
  amount:           number;
  installments:     number;
  monthlyEMI:       number;
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
  const [approveId, setApproveId] = useState<string | null>(null);
  const [approveMonth, setApproveMonth] = useState(new Date().getMonth() + 2 > 12 ? 1 : new Date().getMonth() + 2);
  const [approveYear, setApproveYear] = useState(new Date().getMonth() + 2 > 12 ? new Date().getFullYear() + 1 : new Date().getFullYear());

  const { data: loans = [], isLoading } = useQuery<Loan[]>({
    queryKey: ['loans'],
    queryFn: () => api.get('/loans').then(r => r.data),
  });

  const form = useForm<LoanFormData>({
    resolver: zodResolver(loanSchema),
    defaultValues: { amount: 0, installments: 6, reason: '' },
  });

  const watchAmount = form.watch('amount');
  const watchInstallments = form.watch('installments');
  const previewEMI = watchAmount > 0 && watchInstallments > 0
    ? Math.round((watchAmount / watchInstallments) * 100) / 100
    : 0;

  const [submitting, setSubmitting] = useState(false);

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

  async function handleApprove(id: string) {
    try {
      await api.patch(`/loans/${id}/approve`, {
        startMonth: approveMonth,
        startYear: approveYear,
      });
      qc.invalidateQueries({ queryKey: ['loans'] });
      setApproveId(null);
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to approve');
    }
  }

  async function handleReject(id: string) {
    const reason = prompt('Reason for rejection (optional):');
    try {
      await api.patch(`/loans/${id}/reject`, { reason });
      qc.invalidateQueries({ queryKey: ['loans'] });
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to reject');
    }
  }

  const myLoans = loans.filter(l => l.userId === user?.id);
  const pendingLoans = loans.filter(l => l.status === 'PENDING');

  // Active loan summary
  const activeLoan = myLoans.find(l => l.status === 'ACTIVE' || l.status === 'APPROVED');

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Loans & Advances</h1>
        {!isAdmin && !activeLoan && (
          <Button onClick={() => setShowForm(!showForm)} size="sm">
            <Plus className="h-4 w-4 mr-1" /> Request Loan
          </Button>
        )}
      </div>

      {/* Tabs */}
      {isAdmin && (
        <div className="flex gap-2 border-b">
          <button className={`px-4 py-2 text-sm font-medium border-b-2 ${tab === 'my' ? 'border-[#361963] text-[#361963]' : 'border-transparent text-muted-foreground'}`} onClick={() => setTab('my')}>My Loans</button>
          <button className={`px-4 py-2 text-sm font-medium border-b-2 ${tab === 'manage' ? 'border-[#361963] text-[#361963]' : 'border-transparent text-muted-foreground'}`} onClick={() => setTab('manage')}>
            Manage {pendingLoans.length > 0 && <Badge variant="secondary" className="ml-1 text-xs">{pendingLoans.length}</Badge>}
          </button>
        </div>
      )}

      {/* Active Loan Summary */}
      {tab === 'my' && activeLoan && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <Landmark className="h-4 w-4 text-[#361963]" />
              <CardTitle className="text-base">Active Loan</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
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
                <p className="text-muted-foreground">Outstanding</p>
                <p className="font-semibold">{formatCurrency(activeLoan.amount - (activeLoan.paidInstallments * activeLoan.monthlyEMI))}</p>
              </div>
            </div>
            {/* Progress bar */}
            <div className="mt-3">
              <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                <div className="h-full rounded-full bg-[#361963] transition-all" style={{ width: `${(activeLoan.paidInstallments / activeLoan.installments) * 100}%` }} />
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {Math.round((activeLoan.paidInstallments / activeLoan.installments) * 100)}% repaid
                {activeLoan.startMonth && activeLoan.startYear && ` | EMI started ${MONTHS[activeLoan.startMonth]} ${activeLoan.startYear}`}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Request Form */}
      {showForm && tab === 'my' && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Request Loan / Advance</CardTitle>
            <CardDescription>Submit a loan request for admin approval. EMI will be auto-deducted from salary.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 max-w-md">
              <div>
                <Label>Amount</Label>
                <Input type="number" {...form.register('amount')} placeholder="e.g. 50000" />
                {form.formState.errors.amount && <p className="text-xs text-red-500 mt-1">{form.formState.errors.amount.message}</p>}
              </div>
              <div>
                <Label>Installments (months)</Label>
                <Input type="number" {...form.register('installments')} placeholder="e.g. 12" />
                {form.formState.errors.installments && <p className="text-xs text-red-500 mt-1">{form.formState.errors.installments.message}</p>}
              </div>
              {previewEMI > 0 && (
                <div className="flex items-center gap-2 text-sm bg-muted/50 rounded-lg p-3">
                  <IndianRupee className="h-4 w-4" />
                  <span>Estimated monthly EMI: <strong>{formatCurrency(previewEMI)}</strong></span>
                </div>
              )}
              <div>
                <Label>Reason</Label>
                <textarea {...form.register('reason')} className="w-full border rounded-lg p-2 text-sm min-h-[60px]" placeholder="Reason for loan request..." />
                {form.formState.errors.reason && <p className="text-xs text-red-500 mt-1">{form.formState.errors.reason.message}</p>}
              </div>
              <div className="flex gap-2">
                <Button type="submit" disabled={submitting} size="sm">
                  {submitting && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Submit Request
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => { setShowForm(false); form.reset(); }}>Cancel</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Loan List */}
      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading...</div>
      ) : (
        <div className="space-y-3">
          {(tab === 'my' ? myLoans : tab === 'manage' ? loans : []).map(loan => (
            <Card key={loan.id}>
              <CardContent className="pt-4">
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    {tab === 'manage' && loan.user?.profile && (
                      <p className="text-sm font-medium">{loan.user.profile.firstName} {loan.user.profile.lastName} ({loan.user.profile.employeeId})</p>
                    )}
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{formatCurrency(loan.amount)}</span>
                      <Badge className={STATUS_COLORS[loan.status] || 'bg-gray-100'}>{loan.status}</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {loan.installments} installments | EMI: {formatCurrency(loan.monthlyEMI)}
                      {loan.paidInstallments > 0 && ` | Paid: ${loan.paidInstallments}/${loan.installments}`}
                    </p>
                    <p className="text-sm text-muted-foreground">{loan.reason}</p>
                    <p className="text-xs text-muted-foreground">Applied: {formatDate(loan.createdAt)}</p>
                  </div>

                  {/* Admin actions */}
                  {tab === 'manage' && loan.status === 'PENDING' && (
                    <div className="flex gap-2">
                      {approveId === loan.id ? (
                        <div className="space-y-2 text-sm">
                          <div className="flex gap-2">
                            <select value={approveMonth} onChange={e => setApproveMonth(Number(e.target.value))} className="border rounded px-2 py-1 text-sm">
                              {MONTHS.slice(1).map((m, i) => <option key={i+1} value={i+1}>{m}</option>)}
                            </select>
                            <Input type="number" value={approveYear} onChange={e => setApproveYear(Number(e.target.value))} className="w-20 h-8" />
                          </div>
                          <div className="flex gap-1">
                            <Button size="sm" onClick={() => handleApprove(loan.id)}>
                              <Check className="h-3 w-3 mr-1" /> Approve
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setApproveId(null)}>Cancel</Button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <Button size="sm" variant="outline" onClick={() => setApproveId(loan.id)}>
                            <Check className="h-3 w-3 mr-1" /> Approve
                          </Button>
                          <Button size="sm" variant="outline" className="text-red-600" onClick={() => handleReject(loan.id)}>
                            <X className="h-3 w-3 mr-1" /> Reject
                          </Button>
                        </>
                      )}
                    </div>
                  )}
                </div>

                {/* Repayment progress for non-pending */}
                {(loan.status === 'ACTIVE' || loan.status === 'CLOSED') && (
                  <div className="mt-3">
                    <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                      <div className="h-full rounded-full bg-[#361963]" style={{ width: `${(loan.paidInstallments / loan.installments) * 100}%` }} />
                    </div>
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
