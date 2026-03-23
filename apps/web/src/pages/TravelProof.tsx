/**
 * Athena - Travel Proof Page
 *
 * Employee view: apply for travelling, list their TRAVELLING leaves,
 *               see daily proof status, submit GPS proof for today if APPROVED.
 *
 * Admin / Manager / Owner view: full log of all travel proofs across all
 *               employees — submitted proofs link to Google Maps, missing
 *               proofs are flagged.
 */

import { useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MapPin, CheckCircle2, Clock, XCircle, Loader2, Info, Plus } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge }  from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input }  from '@/components/ui/input';
import { Label }  from '@/components/ui/label';
import { useAuth } from '@/hooks/useAuth';
import api from '@/lib/api';
import { toast } from 'sonner';

// ── helpers ──────────────────────────────────────────────────────────────────

function localDateStr(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true,
  });
}

// Generate every calendar date between two ISO date strings (inclusive)
function datesBetween(startIso: string, endIso: string): string[] {
  const dates: string[] = [];
  const cur = new Date(startIso);
  cur.setHours(0, 0, 0, 0);
  const end = new Date(endIso);
  end.setHours(0, 0, 0, 0);
  while (cur <= end) {
    dates.push(localDateStr(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

// ── Travel application schema ─────────────────────────────────────────────────

const travelSchema = z.object({
  startDate: z.string().min(1, 'Start date is required'),
  endDate:   z.string().min(1, 'End date is required'),
  reason:    z.string().min(5, 'Reason must be at least 5 characters'),
}).refine((d) => new Date(d.startDate) <= new Date(d.endDate), {
  message: 'End date must be on or after start date',
  path: ['endDate'],
});

type TravelFormData = z.infer<typeof travelSchema>;

// ── Employee view ─────────────────────────────────────────────────────────────

function EmployeeTravelProof() {
  const queryClient = useQueryClient();
  const [submittingProof, setSubmittingProof] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const submitGuard = useRef(false);

  const form = useForm<TravelFormData>({
    resolver: zodResolver(travelSchema),
    defaultValues: { startDate: '', endDate: '', reason: '' },
  });
  const [submittingTravel, setSubmittingTravel] = useState(false);

  // All TRAVELLING leave requests for this employee
  const leavesQuery = useQuery<any[]>({
    queryKey: ['my-travel-leaves'],
    queryFn: () =>
      api.get('/leaves', { params: { leaveType: 'TRAVELLING' } }).then(r =>
        (r.data as any[]).filter((l: any) => l.leaveType === 'TRAVELLING')
      ),
  });

  // All travel proofs for this employee
  const proofsQuery = useQuery<any[]>({
    queryKey: ['my-travel-proofs'],
    queryFn: () => api.get('/travel-proof').then(r => r.data),
  });

  const leaves = leavesQuery.data ?? [];
  const proofs  = proofsQuery.data ?? [];

  // Build a lookup: proofDate string → proof object
  const proofByDate: Record<string, any> = {};
  for (const p of proofs) {
    proofByDate[localDateStr(new Date(p.proofDate))] = p;
  }

  const todayStr = localDateStr();

  // ── Apply for Travel ───────────────────────────────────────────────────────

  const onSubmitTravel = async (data: TravelFormData) => {
    if (submitGuard.current) return;
    submitGuard.current = true;
    setSubmittingTravel(true);
    try {
      await api.post('/leaves', {
        leaveType:    'TRAVELLING',
        durationType: 'MULTIPLE',
        startDate:    data.startDate,
        startDayType: 'FULL',
        endDate:      data.endDate,
        endDayType:   'FULL',
        reason:       data.reason,
      });
      toast.success('Travel request submitted! Awaiting manager approval.');
      form.reset();
      setShowForm(false);
      queryClient.invalidateQueries({ queryKey: ['my-travel-leaves'] });
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to submit travel request');
    } finally {
      setSubmittingTravel(false);
      submitGuard.current = false;
    }
  };

  // ── GPS proof submission ───────────────────────────────────────────────────

  const submitProof = async (leaveRequestId: string) => {
    if (!navigator.geolocation) {
      toast.error('Geolocation is not supported by your browser.');
      return;
    }

    // Check permission state first — if already blocked, the browser won't show a popup
    // and will silently return PERMISSION_DENIED. Tell the user how to fix it upfront.
    if (navigator.permissions) {
      try {
        const status = await navigator.permissions.query({ name: 'geolocation' });
        if (status.state === 'denied') {
          const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
          if (isIOS) {
            toast.error(
              'Location is blocked. On iPhone: go to Settings → Privacy & Security → Location Services → your browser → set to "While Using".',
              { duration: 8000 }
            );
          } else {
            toast.error(
              'Location is blocked. On Android: go to Settings → Apps → your browser → Permissions → Location → Allow.',
              { duration: 8000 }
            );
          }
          return;
        }
      } catch {
        // Permissions API not supported — continue normally
      }
    }

    setSubmittingProof(true);

    const doPost = async (lat: number, lng: number) => {
      try {
        await api.post('/travel-proof', {
          leaveRequestId,
          proofDate: todayStr,
          geoLat: lat,
          geoLng: lng,
        });
        toast.success('Location proof submitted!');
        queryClient.invalidateQueries({ queryKey: ['my-travel-proofs'] });
      } catch (err: any) {
        toast.error(err?.response?.data?.error || 'Failed to submit proof');
      } finally {
        setSubmittingProof(false);
      }
    };

    const onError = (err: GeolocationPositionError, wasHighAccuracy: boolean) => {
      // On timeout/unavailable with high accuracy, retry with low accuracy (cell/WiFi — works better indoors)
      if ((err.code === err.TIMEOUT || err.code === err.POSITION_UNAVAILABLE) && wasHighAccuracy) {
        navigator.geolocation.getCurrentPosition(
          (pos) => doPost(pos.coords.latitude, pos.coords.longitude),
          (err2) => {
            setSubmittingProof(false);
            if (err2.code === err2.PERMISSION_DENIED) {
              toast.error('Location blocked. Open your phone Settings → find your browser → set Location to "Allow while using".',  { duration: 8000 });
            } else {
              toast.error('Unable to get your location. Try moving outdoors or enabling WiFi.');
            }
          },
          { enableHighAccuracy: false, timeout: 15000, maximumAge: 60000 },
        );
      } else if (err.code === err.PERMISSION_DENIED) {
        setSubmittingProof(false);
        toast.error('Location blocked. Open your phone Settings → find your browser → set Location to "Allow while using".', { duration: 8000 });
      } else if (err.code === err.TIMEOUT) {
        setSubmittingProof(false);
        toast.error('Location timed out. Please try again outdoors or with WiFi enabled.');
      } else {
        setSubmittingProof(false);
        toast.error('Unable to get your location. Please try again.');
      }
    };

    // Try GPS first (high accuracy), fall back to WiFi/cell on failure
    navigator.geolocation.getCurrentPosition(
      (pos) => doPost(pos.coords.latitude, pos.coords.longitude),
      (err) => onError(err, true),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 },
    );
  };

  if (leavesQuery.isLoading || proofsQuery.isLoading) {
    return <div className="flex items-center gap-2 text-gray-500"><Loader2 className="h-5 w-5 animate-spin" /> Loading...</div>;
  }

  return (
    <div className="space-y-4">

      {/* ── Apply for Travel ─────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Plan a business trip or travel period.</p>
        <Button
          size="sm"
          onClick={() => { setShowForm(v => !v); form.reset(); }}
          style={{ backgroundColor: '#361963' }}
          className="text-white"
        >
          <Plus className="h-4 w-4 mr-1" />
          {showForm ? 'Cancel' : 'Request Travel'}
        </Button>
      </div>

      {showForm && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Request Travelling</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={form.handleSubmit(onSubmitTravel)} className="space-y-3 max-w-md">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Start Date</Label>
                  <Input type="date" {...form.register('startDate')} className="h-9 text-sm" />
                  {form.formState.errors.startDate && (
                    <p className="text-xs text-red-500 mt-1">{form.formState.errors.startDate.message}</p>
                  )}
                </div>
                <div>
                  <Label className="text-xs">End Date</Label>
                  <Input type="date" {...form.register('endDate')} className="h-9 text-sm" />
                  {form.formState.errors.endDate && (
                    <p className="text-xs text-red-500 mt-1">{form.formState.errors.endDate.message}</p>
                  )}
                </div>
              </div>
              <div>
                <Label className="text-xs">Reason / Destination</Label>
                <textarea
                  {...form.register('reason')}
                  rows={2}
                  placeholder="e.g. Client visit to Mumbai — TechCorp HQ"
                  className="w-full border rounded-lg p-2 text-sm resize-none mt-1 focus:outline-none focus:ring-2 focus:ring-[#361963]/40"
                />
                {form.formState.errors.reason && (
                  <p className="text-xs text-red-500 mt-1">{form.formState.errors.reason.message}</p>
                )}
              </div>
              <div className="flex gap-2">
                <Button
                  type="submit"
                  size="sm"
                  disabled={submittingTravel}
                  style={{ backgroundColor: '#361963' }}
                  className="text-white"
                >
                  {submittingTravel && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
                  Submit Request
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={submittingTravel}
                  onClick={() => { setShowForm(false); form.reset(); }}
                >
                  Cancel
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* ── Travel Leaves List ────────────────────────────────────────── */}
      {leaves.length === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground text-center py-6">
              No travelling requests yet. Click <strong>Request Travel</strong> above to apply.
            </p>
          </CardContent>
        </Card>
      ) : (
        leaves.map((leave: any) => {
          const days = datesBetween(
            localDateStr(new Date(leave.startDate)),
            localDateStr(new Date(leave.endDate))
          );
          const isPending  = leave.status === 'PENDING';
          const isApproved = leave.status === 'APPROVED';
          const isRejected = leave.status === 'REJECTED' || leave.status === 'CANCELLED';

          return (
            <Card key={leave.id}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <CardTitle className="text-sm font-semibold">
                    {fmtDate(leave.startDate)} — {fmtDate(leave.endDate)}
                    <span className="text-xs font-normal text-muted-foreground ml-2">
                      ({leave.totalDays} day{leave.totalDays !== 1 ? 's' : ''})
                    </span>
                  </CardTitle>
                  <Badge
                    className={
                      isApproved ? 'bg-green-100 text-green-700 border-green-200' :
                      isPending  ? 'bg-blue-100 text-blue-700 border-blue-200' :
                                   'bg-red-100 text-red-700 border-red-200'
                    }
                  >
                    {leave.status}
                  </Badge>
                </div>
                {leave.reason && (
                  <p className="text-xs text-muted-foreground italic">"{leave.reason}"</p>
                )}
                {isPending && (
                  <div className="flex items-start gap-2 mt-1 text-xs text-blue-700 bg-blue-50 rounded p-2">
                    <Info className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                    Waiting for manager approval. You can submit location proof once approved.
                  </div>
                )}
                {isRejected && (
                  <div className="flex items-start gap-2 mt-1 text-xs text-red-700 bg-red-50 rounded p-2">
                    <XCircle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                    This travel request was {leave.status.toLowerCase()}. No proof submission required.
                  </div>
                )}
              </CardHeader>

              {!isRejected && (
                <CardContent className="pt-0">
                  <div className="space-y-1.5">
                    {days.map((dateStr) => {
                      const proof      = proofByDate[dateStr];
                      const isToday    = dateStr === todayStr;
                      const isPast     = dateStr < todayStr;
                      const submitted  = !!proof?.submittedAt;

                      return (
                        <div
                          key={dateStr}
                          className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm border ${
                            submitted   ? 'bg-green-50 border-green-200' :
                            isToday     ? 'bg-amber-50 border-amber-200' :
                            isPast      ? 'bg-red-50 border-red-100' :
                                          'bg-gray-50 border-gray-100'
                          }`}
                        >
                          <span className={`font-medium ${isToday ? 'text-amber-800' : ''}`}>
                            {new Date(dateStr).toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short' })}
                            {isToday && <span className="ml-1.5 text-xs font-normal text-amber-600">Today</span>}
                          </span>

                          <div className="flex items-center gap-2">
                            {submitted ? (
                              <>
                                <CheckCircle2 className="h-4 w-4 text-green-600" />
                                <span className="text-xs text-green-700">
                                  Submitted {fmtDateTime(proof.submittedAt)}
                                </span>
                                {proof.mapsLink && (
                                  <a
                                    href={proof.mapsLink}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-xs text-blue-600 hover:underline flex items-center gap-0.5"
                                  >
                                    <MapPin className="h-3 w-3" /> Map
                                  </a>
                                )}
                              </>
                            ) : isToday && isApproved ? (
                              <Button
                                size="sm"
                                className="h-7 text-xs bg-amber-500 hover:bg-amber-600 text-white"
                                disabled={submittingProof}
                                onClick={() => submitProof(leave.id)}
                              >
                                {submittingProof ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <MapPin className="h-3 w-3 mr-1" />}
                                Submit Proof
                              </Button>
                            ) : isToday && isPending ? (
                              <span className="text-xs text-blue-600 flex items-center gap-1">
                                <Clock className="h-3 w-3" /> Awaiting approval
                              </span>
                            ) : isPast ? (
                              <span className="text-xs text-red-500 flex items-center gap-1">
                                <XCircle className="h-3 w-3" /> Not submitted
                              </span>
                            ) : (
                              <span className="text-xs text-gray-400">Upcoming</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              )}
            </Card>
          );
        })
      )}
    </div>
  );
}

// ── Admin / Manager view ──────────────────────────────────────────────────────

function AdminTravelProofLog() {
  const proofsQuery = useQuery<any[]>({
    queryKey: ['travel-proof-all'],
    queryFn: () => api.get('/travel-proof').then(r => r.data),
  });

  const proofs    = proofsQuery.data ?? [];
  const submitted = proofs.filter((p: any) => p.submittedAt);
  const missing   = proofs.filter((p: any) => !p.submittedAt);

  if (proofsQuery.isLoading) {
    return <div className="flex items-center gap-2 text-gray-500"><Loader2 className="h-5 w-5 animate-spin" /> Loading...</div>;
  }

  return (
    <div className="space-y-4">
      {/* Summary badges */}
      <div className="flex gap-3 flex-wrap">
        <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
          <CheckCircle2 className="h-4 w-4 text-green-600" />
          <span className="text-sm font-medium text-green-800">{submitted.length} proofs submitted</span>
        </div>
        {missing.length > 0 && (
          <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            <XCircle className="h-4 w-4 text-amber-600" />
            <span className="text-sm font-medium text-amber-800">{missing.length} missing</span>
          </div>
        )}
      </div>

      {proofs.length === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground text-center py-6">No travel proof records found.</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="pt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b text-xs uppercase tracking-wide">
                  <th className="py-2 pr-4">Employee</th>
                  <th className="py-2 pr-4">Travel Date</th>
                  <th className="py-2 pr-4">Submitted At</th>
                  <th className="py-2">Location</th>
                </tr>
              </thead>
              <tbody>
                {proofs.map((p: any) => (
                  <tr key={p.id} className="border-b last:border-0 hover:bg-gray-50">
                    <td className="py-2.5 pr-4">
                      <span className="font-medium">
                        {p.user?.profile?.firstName} {p.user?.profile?.lastName}
                      </span>
                      <span className="text-xs text-gray-400 ml-1.5">({p.user?.profile?.employeeId})</span>
                    </td>
                    <td className="py-2.5 pr-4 text-gray-700">
                      {fmtDate(p.proofDate)}
                    </td>
                    <td className="py-2.5 pr-4 text-xs text-gray-500">
                      {p.submittedAt ? fmtDateTime(p.submittedAt) : '—'}
                    </td>
                    <td className="py-2.5">
                      {p.mapsLink ? (
                        <a
                          href={p.mapsLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-blue-600 hover:underline text-xs font-medium"
                        >
                          <MapPin className="h-3 w-3" /> View on Maps
                        </a>
                      ) : (
                        <Badge variant="outline" className="text-amber-600 border-amber-300 text-xs">
                          No Proof
                        </Badge>
                      )}
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

// ── Main page ─────────────────────────────────────────────────────────────────

export default function TravelProof() {
  const { user } = useAuth();
  const isAdminOrManager = user?.role === 'ADMIN' || user?.role === 'MANAGER' || user?.role === 'OWNER';

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <MapPin className="h-6 w-6 text-amber-500" />
          Travelling
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Request travelling and submit your daily location proof once approved.
        </p>
      </div>

      {/* Everyone sees their own travel section */}
      <EmployeeTravelProof />

      {/* Admin / Manager also see the full team proof log */}
      {isAdminOrManager && (
        <div className="space-y-3 pt-2 border-t">
          <h2 className="text-base font-semibold text-gray-800">All Employee Proofs</h2>
          <AdminTravelProofLog />
        </div>
      )}
    </div>
  );
}
