/**
 * Athena V3.1 - Compensatory Off Page
 * Employees request comp-off for worked holidays/weekends; Admin/Manager approves.
 */

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import api from '@/lib/api';
import { formatDate } from '@/lib/utils';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Loader2, Plus, Check, X, CalendarPlus } from 'lucide-react';

// ─── Schema ─────────────────────────────────────────────────────────────────────

const compoffSchema = z.object({
  earnedDate: z.string().min(1, 'Date is required'),
  reason:     z.string().min(5, 'Reason must be at least 5 characters'),
});

type CompOffFormData = z.infer<typeof compoffSchema>;

interface CompOffItem {
  id:         string;
  userId:     string;
  earnedDate: string;
  reason:     string;
  status:     string;
  approvedBy?: string;
  usedOn?:    string;
  expiresAt:  string;
  createdAt:  string;
  user?: {
    email?: string;
    profile?: { firstName: string; lastName: string; employeeId: string; department?: string };
  };
}

const STATUS_COLORS: Record<string, string> = {
  PENDING:  'bg-yellow-100 text-yellow-800',
  APPROVED: 'bg-green-100 text-green-800',
  USED:     'bg-blue-100 text-blue-800',
  EXPIRED:  'bg-gray-100 text-gray-800',
  REJECTED: 'bg-red-100 text-red-800',
};

export default function CompOff() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const isAdmin = user?.role === 'ADMIN' || user?.role === 'OWNER' || user?.role === 'MANAGER';
  const [tab, setTab] = useState<'my' | 'manage'>('my');
  const [showForm, setShowForm] = useState(false);

  const { data: compoffs = [], isLoading } = useQuery<CompOffItem[]>({
    queryKey: ['compoffs'],
    queryFn: () => api.get('/compoff').then(r => r.data),
  });

  const { data: balanceData } = useQuery<{ balance: number }>({
    queryKey: ['compoff-balance'],
    queryFn: () => api.get('/compoff/balance').then(r => r.data),
  });

  const form = useForm<CompOffFormData>({
    resolver: zodResolver(compoffSchema),
    defaultValues: { earnedDate: '', reason: '' },
  });

  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(data: CompOffFormData) {
    setSubmitting(true);
    try {
      await api.post('/compoff', data);
      qc.invalidateQueries({ queryKey: ['compoffs'] });
      qc.invalidateQueries({ queryKey: ['compoff-balance'] });
      form.reset();
      setShowForm(false);
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to submit comp-off request');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleApprove(id: string) {
    try {
      await api.patch(`/compoff/${id}/approve`);
      qc.invalidateQueries({ queryKey: ['compoffs'] });
      qc.invalidateQueries({ queryKey: ['compoff-balance'] });
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to approve');
    }
  }

  async function handleReject(id: string) {
    const reason = prompt('Reason for rejection (optional):');
    try {
      await api.patch(`/compoff/${id}/reject`, { reason });
      qc.invalidateQueries({ queryKey: ['compoffs'] });
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to reject');
    }
  }

  const myCompOffs = compoffs.filter(c => c.userId === user?.id);
  const pendingCompOffs = compoffs.filter(c => c.status === 'PENDING');
  const balance = balanceData?.balance ?? 0;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Compensatory Off</h1>
        <Button onClick={() => setShowForm(!showForm)} size="sm">
          <Plus className="h-4 w-4 mr-1" /> Request Comp-Off
        </Button>
      </div>

      {/* Tabs */}
      {isAdmin && (
        <div className="flex gap-2 border-b">
          <button className={`px-4 py-2 text-sm font-medium border-b-2 ${tab === 'my' ? 'border-[#361963] text-[#361963]' : 'border-transparent text-muted-foreground'}`} onClick={() => setTab('my')}>My Comp-Offs</button>
          <button className={`px-4 py-2 text-sm font-medium border-b-2 ${tab === 'manage' ? 'border-[#361963] text-[#361963]' : 'border-transparent text-muted-foreground'}`} onClick={() => setTab('manage')}>
            Manage {pendingCompOffs.length > 0 && <Badge variant="secondary" className="ml-1 text-xs">{pendingCompOffs.length}</Badge>}
          </button>
        </div>
      )}

      {/* Balance Card */}
      {tab === 'my' && (
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-[#361963]/10 flex items-center justify-center">
                <CalendarPlus className="h-5 w-5 text-[#361963]" />
              </div>
              <div>
                <p className="text-2xl font-bold">{balance}</p>
                <p className="text-sm text-muted-foreground">Available comp-off day{balance !== 1 ? 's' : ''}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Request Form */}
      {showForm && tab === 'my' && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Request Comp-Off</CardTitle>
            <CardDescription>Request comp-off for a weekend or holiday you worked on.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 max-w-md">
              <div>
                <Label>Date Worked (must be weekend/holiday)</Label>
                <Input type="date" {...form.register('earnedDate')} />
                {form.formState.errors.earnedDate && <p className="text-xs text-red-500 mt-1">{form.formState.errors.earnedDate.message}</p>}
              </div>
              <div>
                <Label>Reason</Label>
                <textarea {...form.register('reason')} className="w-full border rounded-lg p-2 text-sm min-h-[60px]" placeholder="Why did you work on this day?" />
                {form.formState.errors.reason && <p className="text-xs text-red-500 mt-1">{form.formState.errors.reason.message}</p>}
              </div>
              <div className="flex gap-2">
                <Button type="submit" disabled={submitting} size="sm">
                  {submitting && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Submit
                </Button>
                <Button type="button" variant="outline" size="sm" disabled={submitting} onClick={() => { setShowForm(false); form.reset(); }}>Cancel</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* List */}
      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading...</div>
      ) : (
        <div className="space-y-3">
          {(tab === 'my' ? myCompOffs : compoffs).map(co => (
            <Card key={co.id}>
              <CardContent className="pt-4">
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    {tab === 'manage' && co.user?.profile && (
                      <p className="text-sm font-medium">{co.user.profile.firstName} {co.user.profile.lastName} ({co.user.profile.employeeId})</p>
                    )}
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">Worked on: {formatDate(co.earnedDate)}</span>
                      <Badge className={STATUS_COLORS[co.status] || 'bg-gray-100'}>{co.status}</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">{co.reason}</p>
                    <div className="flex gap-3 text-xs text-muted-foreground">
                      <span>Applied: {formatDate(co.createdAt)}</span>
                      {co.status === 'APPROVED' && <span>Expires: {formatDate(co.expiresAt)}</span>}
                      {co.usedOn && <span>Used on: {formatDate(co.usedOn)}</span>}
                    </div>
                  </div>

                  {/* Admin actions */}
                  {tab === 'manage' && co.status === 'PENDING' && (
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => handleApprove(co.id)}>
                        <Check className="h-3 w-3 mr-1" /> Approve
                      </Button>
                      <Button size="sm" variant="outline" className="text-red-600" onClick={() => handleReject(co.id)}>
                        <X className="h-3 w-3 mr-1" /> Reject
                      </Button>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
          {(tab === 'my' ? myCompOffs : compoffs).length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">No comp-off requests found.</p>
          )}
        </div>
      )}
    </div>
  );
}
