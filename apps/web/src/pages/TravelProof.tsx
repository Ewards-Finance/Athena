/**
 * Athena - Travel Proof Page
 *
 * Employee view: list their TRAVELLING leaves, see daily proof status,
 *               submit GPS proof for today if leave is APPROVED.
 *
 * Admin / Manager / Owner view: full log of all travel proofs across all
 *               employees — submitted proofs link to Google Maps, missing
 *               proofs are flagged.
 */

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MapPin, CheckCircle2, Clock, XCircle, Loader2, Info } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge }  from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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

// ── Employee view ─────────────────────────────────────────────────────────────

function EmployeeTravelProof() {
  const queryClient = useQueryClient();
  const [submitting, setSubmitting] = useState(false);

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

  const submitProof = (leaveRequestId: string) => {
    if (!navigator.geolocation) {
      toast.error('Geolocation is not supported by your browser.');
      return;
    }
    setSubmitting(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          await api.post('/travel-proof', {
            leaveRequestId,
            proofDate: todayStr,
            geoLat: pos.coords.latitude,
            geoLng: pos.coords.longitude,
          });
          toast.success('Location proof submitted!');
          queryClient.invalidateQueries({ queryKey: ['my-travel-proofs'] });
          queryClient.invalidateQueries({ queryKey: ['travel-proof-today'] });
        } catch (err: any) {
          toast.error(err?.response?.data?.error || 'Failed to submit proof');
        } finally {
          setSubmitting(false);
        }
      },
      () => {
        toast.error('Location access is required. Please allow location in your browser settings.');
        setSubmitting(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  if (leavesQuery.isLoading || proofsQuery.isLoading) {
    return <div className="flex items-center gap-2 text-gray-500"><Loader2 className="h-5 w-5 animate-spin" /> Loading...</div>;
  }

  if (leaves.length === 0) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-sm text-muted-foreground text-center py-6">
            You have no travelling leave requests. Apply from the <a href="/leaves" className="text-blue-600 hover:underline">Leaves</a> page.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {leaves.map((leave: any) => {
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
                  This leave was {leave.status.toLowerCase()}. No proof submission required.
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
                    const isFuture   = dateStr > todayStr;
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
                              disabled={submitting}
                              onClick={() => submitProof(leave.id)}
                            >
                              {submitting ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <MapPin className="h-3 w-3 mr-1" />}
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
      })}
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
  const isEmployee = user?.role === 'EMPLOYEE';

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <MapPin className="h-6 w-6 text-amber-500" />
          Travel Proof
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {isEmployee
            ? 'Submit your daily location proof for approved travelling leave.'
            : 'View all employee travel geo proofs.'}
        </p>
      </div>

      {isEmployee ? <EmployeeTravelProof /> : <AdminTravelProofLog />}
    </div>
  );
}
