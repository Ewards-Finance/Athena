/**
 * Athena V3.1 - Founder MIS Dashboard (OWNER only)
 * 7 sections: Headcount, Payroll Cost, Attendance, Leave Risk, Probation, Asset/Exit, Transfers
 */

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import api from '@/lib/api';

function fmt(n: number) {
  return n.toLocaleString('en-IN', { maximumFractionDigits: 0 });
}
function fmtCurrency(n: number) {
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(2)} Cr`;
  if (n >= 100000)   return `₹${(n / 100000).toFixed(2)} L`;
  return `₹${fmt(n)}`;
}

export default function FounderDashboard() {
  const [headcount, setHeadcount]     = useState<any>(null);
  const [payrollCost, setPayrollCost] = useState<any>(null);
  const [attendance, setAttendance]   = useState<any>(null);
  const [leaveRisk, setLeaveRisk]     = useState<any>(null);
  const [probation, setProbation]     = useState<any>(null);
  const [assetExit, setAssetExit]     = useState<any>(null);
  const [transfers, setTransfers]     = useState<any>(null);
  const [loading, setLoading]         = useState(true);

  useEffect(() => {
    Promise.all([
      api.get('/founder-dashboard/headcount').catch(() => ({ data: null })),
      api.get('/founder-dashboard/payroll-cost').catch(() => ({ data: null })),
      api.get('/founder-dashboard/attendance').catch(() => ({ data: null })),
      api.get('/founder-dashboard/leave-risk').catch(() => ({ data: null })),
      api.get('/founder-dashboard/probation').catch(() => ({ data: null })),
      api.get('/founder-dashboard/asset-exit').catch(() => ({ data: null })),
      api.get('/founder-dashboard/transfers').catch(() => ({ data: null })),
    ]).then(([h, p, a, l, pr, ae, t]) => {
      setHeadcount(h.data);
      setPayrollCost(p.data);
      setAttendance(a.data);
      setLeaveRisk(l.data);
      setProbation(pr.data);
      setAssetExit(ae.data);
      setTransfers(t.data);
    }).finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <p className="text-gray-400 text-sm p-6">Loading founder dashboard...</p>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold" style={{ color: '#361963' }}>Founder Dashboard</h1>
        <p className="text-sm text-gray-500 mt-1">Group-level MIS overview — real-time</p>
      </div>

      {/* Row 1: Headcount + Payroll Cost */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Headcount */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base" style={{ color: '#361963' }}>Group Headcount</CardTitle>
          </CardHeader>
          <CardContent>
            {headcount ? (
              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-3">
                  <StatBox label="Total Active" value={headcount.totalActive} color="#361963" />
                  <StatBox label="On Probation" value={headcount.onProbation} color="#F59E0B" />
                  <StatBox label="On Notice" value={headcount.onNotice} color="#EF4444" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <StatBox label="New Joins (Month)" value={headcount.newJoinsThisMonth} color="#10B981" />
                  <StatBox label="Exits (Month)" value={headcount.exitsThisMonth} color="#EF4444" />
                </div>
                {headcount.byCompany?.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-gray-500 uppercase mb-2">By Company</p>
                    <div className="space-y-1">
                      {headcount.byCompany.map((c: any) => (
                        <div key={c.companyId} className="flex justify-between text-sm">
                          <span className="text-gray-600 truncate">{c.companyName}</span>
                          <span className="font-medium">{c.count}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : <NoData />}
          </CardContent>
        </Card>

        {/* Payroll Cost */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base" style={{ color: '#361963' }}>Payroll Cost</CardTitle>
          </CardHeader>
          <CardContent>
            {payrollCost ? (
              <div className="space-y-4">
                {payrollCost.trend?.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Recent Months</p>
                    <div className="space-y-2">
                      {payrollCost.trend.slice(-3).map((t: any) => (
                        <div key={t.label} className="flex justify-between text-sm items-center">
                          <span className="text-gray-600">{t.label}</span>
                          <div className="text-right">
                            <span className="font-medium">{fmtCurrency(t.totalNet)}</span>
                            <span className="text-xs text-gray-400 ml-2">({t.employees} emp)</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3 pt-2 border-t">
                  <StatBox label="Pending F&F" value={payrollCost.pendingFFCount} color="#EF4444" />
                  <StatBox label="Outstanding Loans" value={fmtCurrency(payrollCost.outstandingLoanAmount)} color="#F59E0B" isText />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <StatBox label="Pending Claims" value={fmtCurrency(payrollCost.pendingClaimsAmount)} color="#3B82F6" isText />
                  <StatBox label="Active Loans" value={payrollCost.outstandingLoanCount} color="#F59E0B" />
                </div>
              </div>
            ) : <NoData />}
          </CardContent>
        </Card>
      </div>

      {/* Row 2: Attendance + Leave Risk */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Attendance */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base" style={{ color: '#361963' }}>Attendance Risk</CardTitle>
          </CardHeader>
          <CardContent>
            {attendance ? (
              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-3">
                  <StatBox label="Late Marks" value={attendance.lateMarkCount} color="#EF4444" />
                  <StatBox label="Late Rate" value={`${attendance.lateMarkRate}%`} color="#F59E0B" isText />
                  <StatBox label="Exceptions" value={attendance.exceptionCount} color="#EF4444" />
                </div>
                {attendance.topAbsentees?.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Top Absentees (LWP)</p>
                    <div className="space-y-1">
                      {attendance.topAbsentees.map((a: any, i: number) => (
                        <div key={a.userId} className="flex justify-between text-sm">
                          <span className="text-gray-600">{i + 1}. {a.name}</span>
                          <Badge className="bg-red-100 text-red-700 border-red-200 text-xs">{a.lwpDays} days</Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : <NoData />}
          </CardContent>
        </Card>

        {/* Leave Risk */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base" style={{ color: '#361963' }}>Leave Risk</CardTitle>
          </CardHeader>
          <CardContent>
            {leaveRisk ? (
              <div className="space-y-4">
                {leaveRisk.highConsumers?.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-gray-500 uppercase mb-2">
                      High Leave Consumption ({'>'}80%)
                    </p>
                    <div className="space-y-1 max-h-40 overflow-y-auto">
                      {leaveRisk.highConsumers.slice(0, 10).map((c: any) => (
                        <div key={`${c.userId}-${c.leaveType}`} className="flex justify-between text-sm">
                          <span className="text-gray-600 truncate">{c.name} <span className="text-xs text-gray-400">({c.leaveType})</span></span>
                          <Badge className="bg-amber-100 text-amber-700 border-amber-200 text-xs">{c.pct}%</Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {leaveRisk.lwpTrend?.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-gray-500 uppercase mb-2">LWP Trend (6 months)</p>
                    <div className="flex items-end gap-1 h-16">
                      {leaveRisk.lwpTrend.map((t: any) => {
                        const maxDays = Math.max(...leaveRisk.lwpTrend.map((x: any) => x.days), 1);
                        const height = Math.max(4, (t.days / maxDays) * 100);
                        return (
                          <div key={t.label} className="flex-1 flex flex-col items-center gap-1">
                            <span className="text-[9px] text-gray-500">{t.days}</span>
                            <div
                              className="w-full rounded-t"
                              style={{ height: `${height}%`, backgroundColor: '#EF4444', minHeight: 4 }}
                            />
                            <span className="text-[9px] text-gray-400">{t.label.split(' ')[0]}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            ) : <NoData />}
          </CardContent>
        </Card>
      </div>

      {/* Row 3: Probation + Asset/Exit */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Probation */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base" style={{ color: '#361963' }}>Probation / HR Watchlist</CardTitle>
          </CardHeader>
          <CardContent>
            {probation ? (
              <div className="space-y-4">
                <StatBox label="Total on Probation" value={probation.totalOnProbation} color="#F59E0B" />
                {probation.endingIn30Days?.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Ending in 30 Days</p>
                    <div className="space-y-2">
                      {probation.endingIn30Days.map((p: any) => (
                        <div key={p.userId} className="flex justify-between text-sm items-center">
                          <div>
                            <span className="text-gray-700 font-medium">{p.name}</span>
                            <span className="text-xs text-gray-400 ml-2">{p.department}</span>
                          </div>
                          <span className="text-xs text-gray-500">
                            {new Date(p.probationEndDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {probation.endingIn30Days?.length === 0 && probation.totalOnProbation > 0 && (
                  <p className="text-xs text-gray-400">No probations ending in the next 30 days.</p>
                )}
                {probation.overdue?.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-red-500 uppercase mb-2">Overdue Confirmations</p>
                    <div className="space-y-1">
                      {probation.overdue.map((p: any) => (
                        <div key={p.userId} className="flex justify-between text-sm items-center">
                          <span className="text-gray-700 font-medium">{p.name}</span>
                          <Badge className="bg-red-100 text-red-700 border-red-200 text-xs">Not confirmed</Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {probation.lowAttendance?.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-orange-500 uppercase mb-2">Low Attendance This Month (&lt;80%)</p>
                    <div className="space-y-1">
                      {probation.lowAttendance.map((p: any) => (
                        <div key={p.userId} className="flex justify-between text-sm items-center">
                          <span className="text-gray-700">{p.name}</span>
                          <Badge className="bg-orange-100 text-orange-700 border-orange-200 text-xs">{p.attendancePct}%</Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : <NoData />}
          </CardContent>
        </Card>

        {/* Asset / Exit Risk */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base" style={{ color: '#361963' }}>Asset / Exit Risk</CardTitle>
          </CardHeader>
          <CardContent>
            {assetExit ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <StatBox label="Active Exits" value={assetExit.activeExitCount} color="#EF4444" />
                  <StatBox label="Overdue Clearances" value={assetExit.overdueClearanceCount} color="#F59E0B" />
                </div>
                {assetExit.unreturnedAssets?.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Unreturned Assets (Exited Employees)</p>
                    <div className="space-y-1 max-h-32 overflow-y-auto">
                      {assetExit.unreturnedAssets.map((a: any, i: number) => (
                        <div key={i} className="flex justify-between text-sm">
                          <span className="text-gray-600 truncate">{a.employeeName}</span>
                          <span className="text-xs text-gray-500">{a.assetName} ({a.assetTag})</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {assetExit.activeExits?.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Active Exits</p>
                    <div className="space-y-1">
                      {assetExit.activeExits.slice(0, 5).map((ex: any) => (
                        <div key={ex.id} className="flex justify-between text-sm items-center">
                          <span className="text-gray-600">{ex.name}</span>
                          <div className="flex items-center gap-2">
                            <Badge className="text-[10px] bg-gray-100 text-gray-600">{ex.status.replace('_', ' ')}</Badge>
                            {ex.pendingClearances.length > 0 && (
                              <span className="text-[10px] text-red-500">{ex.pendingClearances.length} pending</span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : <NoData />}
          </CardContent>
        </Card>
      </div>

      {/* Row 4: Transfers (full width) */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base" style={{ color: '#361963' }}>Recent Transfers & Company Headcount</CardTitle>
        </CardHeader>
        <CardContent>
          {transfers ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Company Headcount</p>
                {transfers.companyHeadcount?.length > 0 ? (
                  <div className="space-y-2">
                    {transfers.companyHeadcount.map((c: any) => {
                      const maxCount = Math.max(...transfers.companyHeadcount.map((x: any) => x.count), 1);
                      return (
                        <div key={c.companyId} className="flex items-center gap-3">
                          <span className="text-sm text-gray-600 w-32 truncate">{c.companyName}</span>
                          <div className="flex-1 h-5 bg-gray-100 rounded overflow-hidden">
                            <div
                              className="h-full rounded"
                              style={{ width: `${(c.count / maxCount) * 100}%`, backgroundColor: '#361963' }}
                            />
                          </div>
                          <span className="text-sm font-medium w-8 text-right">{c.count}</span>
                        </div>
                      );
                    })}
                  </div>
                ) : <p className="text-xs text-gray-400">No active assignments.</p>}
              </div>

              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Recent Transfers (90 days)</p>
                {transfers.recentTransfers?.length > 0 ? (
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {transfers.recentTransfers.map((t: any, i: number) => (
                      <div key={i} className="flex justify-between text-sm items-center border-b border-gray-50 pb-1">
                        <div>
                          <span className="text-gray-700 font-medium">{t.name}</span>
                          <span className="text-xs text-gray-400 ml-2">from {t.fromCompany}</span>
                        </div>
                        <span className="text-xs text-gray-500">
                          {new Date(t.transferDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : <p className="text-xs text-gray-400">No transfers in the last 90 days.</p>}
              </div>
            </div>
          ) : <NoData />}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function StatBox({ label, value, color, isText }: { label: string; value: any; color: string; isText?: boolean }) {
  return (
    <div className="bg-gray-50 rounded-lg p-3">
      <p className="text-xs text-gray-500 mb-0.5">{label}</p>
      <p className={`${isText ? 'text-base' : 'text-xl'} font-bold`} style={{ color }}>{value}</p>
    </div>
  );
}

function NoData() {
  return <p className="text-xs text-gray-400 text-center py-4">No data available</p>;
}
