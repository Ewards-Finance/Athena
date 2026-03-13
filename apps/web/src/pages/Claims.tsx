/**
 * Athena V2 - Reimbursement Claims Page
 * Employees submit claims; Admin/Manager approve/reject; Admin marks as paid.
 */

import { useEffect, useRef, useState } from 'react';
import { useForm }     from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z }           from 'zod';
import { useAuth }     from '@/hooks/useAuth';
import api             from '@/lib/api';
import { formatDate, claimStatusColor } from '@/lib/utils';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input }  from '@/components/ui/input';
import { Label }  from '@/components/ui/label';
import { Loader2, Plus, Check, X, Receipt, IndianRupee, Paperclip, Trash2 } from 'lucide-react';

// ─── Schema (billUrl is managed separately, not part of RHF) ─────────────────

const claimSchema = z.object({
  category:    z.enum(['TRAVEL', 'FOOD', 'INTERNET', 'MISCELLANEOUS']),
  amount:      z.coerce.number().positive('Amount must be positive'),
  description: z.string().min(5, 'Description must be at least 5 characters'),
});

type ClaimFormData = z.infer<typeof claimSchema>;

interface Claim {
  id:           string;
  employeeId:   string;
  category:     string;
  amount:       number;
  description:  string;
  billUrl?:     string;
  status:       string;
  paidAt?:      string;
  createdAt:    string;
  employee?: {
    profile?: { firstName: string; lastName: string; employeeId: string };
  };
}

const CATEGORIES = [
  { value: 'TRAVEL',        label: 'Travel' },
  { value: 'FOOD',          label: 'Food' },
  { value: 'INTERNET',      label: 'Internet' },
  { value: 'MISCELLANEOUS', label: 'Miscellaneous' },
];

// ─── Component ───────────────────────────────────────────────────────────────

export default function Claims() {
  const { user }                = useAuth();
  const [claims, setClaims]     = useState<Claim[]>([]);
  const [loading, setLoading]   = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Bill file upload state (outside RHF)
  const [billFile, setBillFile]         = useState<File | null>(null);
  const [billUrl, setBillUrl]           = useState<string>('');
  const [uploadingBill, setUploadingBill] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } =
    useForm<ClaimFormData>({ resolver: zodResolver(claimSchema) });

  const fetchClaims = async () => {
    try {
      const { data } = await api.get<Claim[]>('/claims');
      setClaims(data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchClaims(); }, []);

  // ── Upload bill file immediately on select ──
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBillFile(file);
    setUploadingBill(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const { data } = await api.post<{ url: string }>('/upload?folder=bills', fd, {
        headers: { 'Content-Type': undefined as any },
      });
      setBillUrl(data.url);
    } catch (err: any) {
      alert(err?.response?.data?.error || 'Failed to upload receipt');
      setBillFile(null);
      setBillUrl('');
      if (fileInputRef.current) fileInputRef.current.value = '';
    } finally {
      setUploadingBill(false);
    }
  };

  const clearBill = () => {
    setBillFile(null);
    setBillUrl('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const onSubmit = async (data: ClaimFormData) => {
    try {
      await api.post('/claims', {
        ...data,
        billUrl: billUrl || undefined,
      });
      setShowForm(false);
      reset();
      clearBill();
      fetchClaims();
    } catch (err: any) {
      alert(err?.response?.data?.error || 'Failed to submit claim');
    }
  };

  const handleCancel = () => {
    setShowForm(false);
    reset();
    clearBill();
  };

  const handleAction = async (id: string, action: 'approve' | 'reject' | 'pay') => {
    setActionLoading(id + '-' + action);
    try {
      await api.patch(`/claims/${id}/${action}`);
      fetchClaims();
    } finally {
      setActionLoading(null);
    }
  };

  const handleWithdraw = async (id: string) => {
    if (!confirm('Withdraw this claim? This cannot be undone.')) return;
    setActionLoading(id + '-withdraw');
    try {
      await api.delete(`/claims/${id}`);
      fetchClaims();
    } catch (err: any) {
      alert(err?.response?.data?.error || 'Failed to withdraw claim');
    } finally {
      setActionLoading(null);
    }
  };

  const isManagerOrAdmin = user?.role === 'ADMIN' || user?.role === 'MANAGER';

  // Absolute URL for receipts stored on our server
  const resolveUrl = (url: string) =>
    url.startsWith('/uploads') ? `http://localhost:3001${url}` : url;

  return (
    <div className="space-y-6 max-w-5xl">

      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Reimbursement Claims</h1>
          <p className="text-muted-foreground text-sm">
            {isManagerOrAdmin ? 'Review and process employee claims' : 'Submit and track your expense claims'}
          </p>
        </div>
        <Button
          onClick={() => setShowForm(!showForm)}
          style={{ backgroundColor: '#361963' }}
          className="text-white"
        >
          <Plus className="h-4 w-4 mr-2" />
          File Claim
        </Button>
      </div>

      {/* ── Submit claim form ── */}
      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">New Reimbursement Claim</CardTitle>
            <CardDescription>Upload your receipt (image or PDF, max 5 MB)</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit(onSubmit)} className="grid grid-cols-1 md:grid-cols-2 gap-4">

              <div className="space-y-2">
                <Label>Category</Label>
                <select
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  {...register('category')}
                >
                  {CATEGORIES.map((c) => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="amount">Amount (INR)</Label>
                <Input id="amount" type="number" placeholder="0.00" step="0.01" {...register('amount')} />
                {errors.amount && <p className="text-xs text-destructive">{errors.amount.message}</p>}
              </div>

              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="description">Description</Label>
                <Input id="description" placeholder="Describe the expense..." {...register('description')} />
                {errors.description && <p className="text-xs text-destructive">{errors.description.message}</p>}
              </div>

              {/* ── File upload ── */}
              <div className="space-y-2 md:col-span-2">
                <Label>Receipt / Bill (optional)</Label>
                {!billFile ? (
                  <div
                    className="flex items-center justify-center border-2 border-dashed rounded-md h-20 cursor-pointer hover:bg-muted/40 transition-colors"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <div className="flex flex-col items-center gap-1 text-muted-foreground">
                      <Paperclip className="h-5 w-5" />
                      <span className="text-xs">Click to attach receipt (JPG, PNG, PDF — max 5 MB)</span>
                    </div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".jpg,.jpeg,.png,.gif,.webp,.pdf"
                      className="hidden"
                      onChange={handleFileSelect}
                    />
                  </div>
                ) : (
                  <div className="flex items-center gap-3 border rounded-md px-3 py-2 bg-muted/30">
                    {uploadingBill ? (
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground flex-shrink-0" />
                    ) : (
                      <Paperclip className="h-4 w-4 text-[#361963] flex-shrink-0" />
                    )}
                    <span className="text-sm flex-1 truncate">
                      {uploadingBill ? 'Uploading…' : billFile.name}
                    </span>
                    {!uploadingBill && billUrl && (
                      <span className="text-xs text-green-600 font-medium">Uploaded</span>
                    )}
                    <button
                      type="button"
                      onClick={clearBill}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </div>

              <div className="md:col-span-2 flex gap-2">
                <Button
                  type="submit"
                  disabled={isSubmitting || uploadingBill}
                  style={{ backgroundColor: '#361963' }}
                  className="text-white"
                >
                  {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Submit Claim
                </Button>
                <Button type="button" variant="outline" onClick={handleCancel}>
                  Cancel
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* ── Claims list ── */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Receipt className="h-4 w-4" />
            <CardTitle className="text-base">
              {isManagerOrAdmin ? 'All Claims' : 'My Claims'}
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : claims.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">No claims found.</p>
          ) : (
            <div className="space-y-3">
              {claims.map((claim) => (
                <div key={claim.id} className="flex items-start justify-between p-4 border rounded-lg gap-4">
                  <div className="flex-1">
                    {isManagerOrAdmin && claim.employee?.profile && (
                      <p className="text-sm font-medium mb-1">
                        {claim.employee.profile.firstName} {claim.employee.profile.lastName}
                        <span className="text-muted-foreground text-xs ml-2 font-mono">
                          {claim.employee.profile.employeeId}
                        </span>
                      </p>
                    )}
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-semibold">{claim.category}</span>
                      <span className="flex items-center text-sm font-bold text-green-700">
                        <IndianRupee className="h-3 w-3" />
                        {claim.amount.toLocaleString('en-IN')}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground mt-0.5">{claim.description}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Filed on {formatDate(claim.createdAt)}
                      {claim.paidAt && ` • Paid on ${formatDate(claim.paidAt)}`}
                    </p>
                    {claim.billUrl && (
                      <a
                        href={resolveUrl(claim.billUrl)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-blue-600 underline mt-1"
                      >
                        <Paperclip className="h-3 w-3" />
                        View Receipt
                      </a>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className={`text-xs font-medium px-2 py-1 rounded-full ${claimStatusColor(claim.status)}`}>
                      {claim.status}
                    </span>
                    {isManagerOrAdmin && claim.status === 'PENDING' && (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-green-600 border-green-300 hover:bg-green-50"
                          onClick={() => handleAction(claim.id, 'approve')}
                          disabled={!!actionLoading}
                        >
                          <Check className="h-3 w-3" />
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-destructive border-destructive/30 hover:bg-destructive/10"
                          onClick={() => handleAction(claim.id, 'reject')}
                          disabled={!!actionLoading}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </>
                    )}
                    {user?.role === 'ADMIN' && claim.status === 'APPROVED' && (
                      <Button
                        size="sm"
                        onClick={() => handleAction(claim.id, 'pay')}
                        disabled={!!actionLoading}
                        style={{ backgroundColor: '#361963' }}
                        className="text-white"
                      >
                        Mark Paid
                      </Button>
                    )}
                    {claim.status === 'PENDING' && claim.employeeId === user?.id && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-destructive border-destructive/30 hover:bg-destructive/10"
                        onClick={() => handleWithdraw(claim.id)}
                        disabled={actionLoading === claim.id + '-withdraw'}
                        title="Withdraw claim"
                      >
                        {actionLoading === claim.id + '-withdraw'
                          ? <Loader2 className="h-3 w-3 animate-spin" />
                          : <Trash2 className="h-3 w-3" />}
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
