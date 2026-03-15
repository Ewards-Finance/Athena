/**
 * Athena V2 - Reports & Analytics Page
 * Tabs: HR Overview, Attendance, Payroll (Admin only) + Daily Attendance (all roles)
 */

import { useEffect, useState } from 'react';
import api from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Loader2, UserCheck } from 'lucide-react';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function fmt(n: number) {
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(n);
}

function fmtCtc(n: number) {
  if (n >= 100000) return `₹${(n / 100000).toFixed(2)}L`;
  return `₹${fmt(n)}`;
}

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <Card>
      <CardContent className="pt-5 pb-4">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="text-2xl font-bold mt-1">{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
      </CardContent>
    </Card>
  );
}

function SimpleBar({ label, count, max, color }: { label: string; count: number; max: number; color: string }) {
  const pct = max > 0 ? (count / max) * 100 : 0;
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="w-40 truncate text-right text-muted-foreground">{label}</span>
      <div className="flex-1 bg-gray-100 rounded-full h-3 overflow-hidden">
        <div className="h-3 rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <span className="w-8 text-right font-medium">{count}</span>
    </div>
  );
}

function HRReport() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/reports/hr')
      .then((r) => setData(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="text-muted-foreground py-6">Loading...</p>;
  if (!data) return <p className="text-red-500 py-6">Failed to load HR report.</p>;

  const maxDept = Math.max(...(data.byDepartment?.map((d: any) => d.count) ?? [1]));
  const maxTenure = Math.max(...(data.tenureBuckets?.map((t: any) => t.count) ?? [1]));

  const STATUS_LABELS: Record<string, string> = {
    PENDING_JOIN: 'Pending Join',
    PROBATION: 'Probation',
    INTERNSHIP: 'Internship',
    REGULAR_FULL_TIME: 'Regular',
    NOTICE_PERIOD: 'Notice Period',
    INACTIVE: 'Inactive',
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Active Employees" value={data.totalActive} />
        <StatCard label="Inactive Employees" value={data.totalInactive} />
        <StatCard label="Recent Joiners (90d)" value={data.recentJoiners} />
        <StatCard label="Departments" value={data.byDepartment?.length ?? 0} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle className="text-base">By Department</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {data.byDepartment?.map((d: any) => (
              <SimpleBar key={d.dept} label={d.dept} count={d.count} max={maxDept} color="#361963" />
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Tenure Distribution</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {data.tenureBuckets?.map((t: any) => (
              <SimpleBar key={t.label} label={t.label} count={t.count} max={maxTenure} color="#FD8C27" />
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Employment Status</CardTitle></CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {data.byStatus?.map((s: any) => (
                <div key={s.status} className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2 border">
                  <span className="text-sm text-muted-foreground">{STATUS_LABELS[s.status] ?? s.status}</span>
                  <Badge variant="secondary">{s.count}</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Employment Type &amp; Role</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div>
              <p className="text-xs text-muted-foreground mb-1.5 font-medium uppercase tracking-wide">Type</p>
              <div className="flex gap-3">
                {data.byType?.map((t: any) => (
                  <div key={t.type} className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2 border">
                    <span className="text-sm">{t.type === 'FULL_TIME' ? 'Full-time' : 'Intern'}</span>
                    <Badge variant="secondary">{t.count}</Badge>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1.5 font-medium uppercase tracking-wide">Role</p>
              <div className="flex gap-3">
                {data.byRole?.map((r: any) => (
                  <div key={r.role} className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2 border">
                    <span className="text-sm capitalize">{r.role.toLowerCase()}</span>
                    <Badge variant="secondary">{r.count}</Badge>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function AttendanceReport() {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  function load() {
    setLoading(true);
    api.get(`/reports/attendance?month=${month}&year=${year}`)
      .then((r) => setData(r.data))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <select className="border rounded-md px-3 py-1.5 text-sm bg-white" value={month} onChange={(e) => setMonth(Number(e.target.value))}>
          {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
        </select>
        <select className="border rounded-md px-3 py-1.5 text-sm bg-white" value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {[2024, 2025, 2026, 2027].map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        <Button size="sm" onClick={load} disabled={loading}>{loading ? 'Loading...' : 'Load'}</Button>
      </div>

      {!data && !loading && <p className="text-muted-foreground">Select a month and click Load.</p>}
      {loading && <p className="text-muted-foreground">Loading...</p>}

      {data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard label="Total Present Records" value={data.totalPresent} />
            <StatCard label="Late Arrivals" value={data.totalLateCount} />
            <StatCard label="Marked Absences" value={data.totalAbsences} />
            <StatCard label="Employees Tracked" value={data.employees?.length ?? 0} />
          </div>

          {data.deptSummary?.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-base">Department Summary</CardTitle></CardHeader>
              <CardContent>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 text-muted-foreground font-medium">Department</th>
                      <th className="text-right py-2 text-muted-foreground font-medium">Late Days</th>
                      <th className="text-right py-2 text-muted-foreground font-medium">LWP Days</th>
                      <th className="text-right py-2 text-muted-foreground font-medium">Absences</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.deptSummary.map((d: any) => (
                      <tr key={d.dept} className="border-b last:border-0">
                        <td className="py-2">{d.dept}</td>
                        <td className="text-right py-2">{d.totalLate}</td>
                        <td className="text-right py-2">{d.totalLwp}</td>
                        <td className="text-right py-2">{d.totalAbsent}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader><CardTitle className="text-base">Employee Attendance - {MONTHS[month - 1]} {year}</CardTitle></CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-sm min-w-[600px]">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 text-muted-foreground font-medium">Employee</th>
                    <th className="text-left py-2 text-muted-foreground font-medium">Department</th>
                    <th className="text-right py-2 text-muted-foreground font-medium">Present</th>
                    <th className="text-right py-2 text-muted-foreground font-medium">Late</th>
                    <th className="text-right py-2 text-muted-foreground font-medium">LWP</th>
                    <th className="text-right py-2 text-muted-foreground font-medium">Absent</th>
                    <th className="text-right py-2 text-muted-foreground font-medium">Leave</th>
                  </tr>
                </thead>
                <tbody>
                  {data.employees?.map((e: any) => (
                    <tr key={e.employeeId} className="border-b last:border-0 hover:bg-gray-50">
                      <td className="py-2">
                        <p className="font-medium">{e.name}</p>
                        <p className="text-xs text-muted-foreground">{e.employeeId}</p>
                      </td>
                      <td className="py-2 text-muted-foreground">{e.department}</td>
                      <td className="text-right py-2">{e.presentDays}</td>
                      <td className="text-right py-2">{e.lateDays > 0 ? <span className="text-amber-600 font-medium">{e.lateDays}</span> : '-'}</td>
                      <td className="text-right py-2">{e.lwpDays > 0 ? <span className="text-red-600 font-medium">{e.lwpDays.toFixed(1)}</span> : '-'}</td>
                      <td className="text-right py-2">{e.absenceDays > 0 ? <span className="text-red-700 font-medium">{e.absenceDays}</span> : '-'}</td>
                      <td className="text-right py-2">{e.leaveDays > 0 ? e.leaveDays.toFixed(1) : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function PayrollReport() {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  function load() {
    setLoading(true);
    api.get(`/reports/payroll?month=${month}&year=${year}`)
      .then((r) => setData(r.data))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <select className="border rounded-md px-3 py-1.5 text-sm bg-white" value={month} onChange={(e) => setMonth(Number(e.target.value))}>
          {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
        </select>
        <select className="border rounded-md px-3 py-1.5 text-sm bg-white" value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {[2024, 2025, 2026, 2027].map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        <Button size="sm" onClick={load} disabled={loading}>{loading ? 'Loading...' : 'Load'}</Button>
      </div>

      {!data && !loading && <p className="text-muted-foreground">Select a month and click Load.</p>}
      {loading && <p className="text-muted-foreground">Loading...</p>}

      {data && data.status === 'NO_PAYROLL' && (
        <p className="text-muted-foreground py-4">No payroll run found for {MONTHS[month - 1]} {year}.</p>
      )}

      {data && data.status !== 'NO_PAYROLL' && (
        <>
          <div className="flex items-center gap-2">
            <Badge variant={data.status === 'FINALIZED' ? 'default' : 'secondary'}>{data.status}</Badge>
            <span className="text-sm text-muted-foreground">{MONTHS[month - 1]} {year}</span>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <StatCard label="Employees" value={data.totals?.headcount ?? 0} />
            <StatCard label="Total Gross Pay" value={fmtCtc(data.totals?.totalGross ?? 0)} />
            <StatCard label="Total Net Pay" value={fmtCtc(data.totals?.totalNet ?? 0)} />
            <StatCard label="Total TDS" value={fmtCtc(data.totals?.totalTds ?? 0)} />
            <StatCard label="Reimbursements" value={fmtCtc(data.totals?.totalReimbursements ?? 0)} />
            <StatCard label="Total Deductions" value={fmtCtc(data.totals?.totalDeductions ?? 0)} />
          </div>

          {data.deptSummary?.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-base">Department Cost Summary</CardTitle></CardHeader>
              <CardContent>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 text-muted-foreground font-medium">Department</th>
                      <th className="text-right py-2 text-muted-foreground font-medium">Headcount</th>
                      <th className="text-right py-2 text-muted-foreground font-medium">Gross Pay</th>
                      <th className="text-right py-2 text-muted-foreground font-medium">Net Pay</th>
                      <th className="text-right py-2 text-muted-foreground font-medium">TDS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.deptSummary.map((d: any) => (
                      <tr key={d.dept} className="border-b last:border-0">
                        <td className="py-2">{d.dept}</td>
                        <td className="text-right py-2">{d.headcount}</td>
                        <td className="text-right py-2">{fmtCtc(d.totalGross)}</td>
                        <td className="text-right py-2">{fmtCtc(d.totalNet)}</td>
                        <td className="text-right py-2">{fmtCtc(d.totalTds)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader><CardTitle className="text-base">Employee Payroll - {MONTHS[month - 1]} {year}</CardTitle></CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-sm min-w-[700px]">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 text-muted-foreground font-medium">Employee</th>
                    <th className="text-left py-2 text-muted-foreground font-medium">Dept</th>
                    <th className="text-right py-2 text-muted-foreground font-medium">Gross</th>
                    <th className="text-right py-2 text-muted-foreground font-medium">Deductions</th>
                    <th className="text-right py-2 text-muted-foreground font-medium">TDS</th>
                    <th className="text-right py-2 text-muted-foreground font-medium">Net Pay</th>
                    <th className="text-right py-2 text-muted-foreground font-medium">LWP</th>
                  </tr>
                </thead>
                <tbody>
                  {data.entries?.map((e: any) => (
                    <tr key={e.employeeId} className="border-b last:border-0 hover:bg-gray-50">
                      <td className="py-2">
                        <p className="font-medium">{e.name}</p>
                        <p className="text-xs text-muted-foreground">{e.employeeId}</p>
                      </td>
                      <td className="py-2 text-muted-foreground">{e.department}</td>
                      <td className="text-right py-2">{fmtCtc(e.grossPay)}</td>
                      <td className="text-right py-2">{fmtCtc(e.totalDeductions)}</td>
                      <td className="text-right py-2">{e.tds > 0 ? fmtCtc(e.tds) : '-'}</td>
                      <td className="text-right py-2 font-medium">{fmtCtc(e.netPay)}</td>
                      <td className="text-right py-2">{e.lwpDays > 0 ? <span className="text-red-600">{e.lwpDays.toFixed(1)}</span> : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function fmtLeaveType(s: string) {
  const map: Record<string, string> = {
    TEMPORARY_WFH: 'Temporary WFH',
    TRAVELLING: 'Travelling',
  };
  return map[s] ?? s;
}

function EmployeeChip({ item }: { item: any }) {
  const name = `${item.employee?.profile?.firstName ?? ''} ${item.employee?.profile?.lastName ?? ''}`.trim();
  const empId = item.employee?.profile?.employeeId ?? '';
  const dept = item.employee?.profile?.department ?? '';
  return (
    <div className="bg-gray-50 border rounded-lg px-3 py-2">
      <p className="text-sm font-medium">{name} <span className="text-xs text-muted-foreground">({empId})</span></p>
      <p className="text-xs text-muted-foreground">{dept}</p>
    </div>
  );
}

function Section({ title, items, emptyText }: { title: string; items: any[]; emptyText?: string }) {
  if (items.length === 0 && !emptyText) return null;
  return (
    <div>
      <p className="text-sm font-semibold mb-2 text-[#361963]">{title} <span className="text-xs font-normal text-muted-foreground">({items.length})</span></p>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">{emptyText}</p>
      ) : (
        <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => <EmployeeChip key={item.id} item={item} />)}
        </div>
      )}
    </div>
  );
}

function DailyAttendance() {
  const todayStr = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(todayStr);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  function load() {
    setLoading(true);
    api.get(`/daily-attendance?date=${date}`)
      .then((r) => setData(r.data))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, [date]);

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3 flex-wrap">
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-44 text-sm" />
        {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </div>

      {!loading && data && (
        <div className="space-y-5">
          <Section title="On Leave" items={data.onLeave} />
          <Section title="Half Day AM" items={data.halfDayAM} />
          <Section title="Half Day PM" items={data.halfDayPM} />
          <Section title="On WFH" items={data.onWFH} />
          <Section title="Travelling" items={data.onTravelling} />

          {data.onLeave.length === 0 && data.halfDayAM.length === 0 && data.halfDayPM.length === 0 &&
           data.onWFH.length === 0 && data.onTravelling.length === 0 && (
            <div className="flex items-center gap-2 py-4 text-muted-foreground text-sm">
              <UserCheck className="h-4 w-4 text-green-500" />
              Everyone is present on this date.
            </div>
          )}

          {data.upcoming?.length > 0 && (
            <div className="pt-2 border-t">
              <p className="text-sm font-semibold mb-3 text-[#361963]">
                Upcoming Leaves - Next 60 Days <span className="text-xs font-normal text-muted-foreground">({data.upcoming.length})</span>
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[500px]">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 text-xs text-muted-foreground font-medium">Employee</th>
                      <th className="text-left py-2 text-xs text-muted-foreground font-medium">Type</th>
                      <th className="text-left py-2 text-xs text-muted-foreground font-medium">From</th>
                      <th className="text-left py-2 text-xs text-muted-foreground font-medium">To</th>
                      <th className="text-right py-2 text-xs text-muted-foreground font-medium">Days</th>
                      <th className="text-right py-2 text-xs text-muted-foreground font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.upcoming.map((leave: any) => (
                      <tr key={leave.id} className="border-b last:border-0 hover:bg-gray-50">
                        <td className="py-2">
                          <p className="font-medium">{leave.employee?.profile?.firstName} {leave.employee?.profile?.lastName}</p>
                          <p className="text-xs text-muted-foreground">{leave.employee?.profile?.employeeId} · {leave.employee?.profile?.department}</p>
                        </td>
                        <td className="py-2 text-muted-foreground">{fmtLeaveType(leave.leaveType)}</td>
                        <td className="py-2 text-muted-foreground">{new Date(leave.startDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}</td>
                        <td className="py-2 text-muted-foreground">{new Date(leave.endDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}</td>
                        <td className="py-2 text-right">{leave.totalDays}</td>
                        <td className="py-2 text-right">
                          <Badge className={`text-xs ${leave.status === 'APPROVED' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                            {leave.status}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {!loading && !data && <p className="text-sm text-red-500">Failed to load attendance data.</p>}
    </div>
  );
}

export default function Reports() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';

  type Tab = 'Daily Attendance' | 'HR Overview' | 'Attendance' | 'Payroll';

  const allTabs: { key: Tab; adminOnly: boolean }[] = [
    { key: 'Daily Attendance', adminOnly: false },
    { key: 'HR Overview', adminOnly: true },
    { key: 'Attendance', adminOnly: true },
    { key: 'Payroll', adminOnly: true },
  ];
  const tabs = allTabs.filter((t) => !t.adminOnly || isAdmin);

  const [tab, setTab] = useState<Tab>('Daily Attendance');

  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">Reports &amp; Analytics</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Workforce, attendance, and payroll insights</p>
      </div>

      <div className="flex gap-1 border-b">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
              tab === t.key
                ? 'border-[#361963] text-[#361963]'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.key}
          </button>
        ))}
      </div>

      {tab === 'Daily Attendance' && <DailyAttendance />}
      {tab === 'HR Overview' && <HRReport />}
      {tab === 'Attendance' && <AttendanceReport />}
      {tab === 'Payroll' && <PayrollReport />}
    </div>
  );
}
