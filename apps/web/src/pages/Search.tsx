/**
 * Athena V2 - Advanced Search
 * Search across employees, leaves, claims, and documents.
 * Admin/Manager: full access. Employee: own data only.
 */

import { useState } from 'react';
import api from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, Search as SearchIcon, User, CalendarDays, FileText, FolderOpen } from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────
type Tab = 'employees' | 'leaves' | 'claims' | 'documents';

const LEAVE_STATUS_COLORS: Record<string, string> = {
  PENDING:   'bg-yellow-100 text-yellow-700',
  APPROVED:  'bg-green-100 text-green-700',
  REJECTED:  'bg-red-100 text-red-700',
  CANCELLED: 'bg-gray-100 text-gray-500',
};
const CLAIM_STATUS_COLORS: Record<string, string> = {
  PENDING:  'bg-yellow-100 text-yellow-700',
  APPROVED: 'bg-blue-100 text-blue-700',
  PAID:     'bg-green-100 text-green-700',
  REJECTED: 'bg-red-100 text-red-700',
};
const EMP_STATUS_COLORS: Record<string, string> = {
  REGULAR_FULL_TIME: 'bg-green-100 text-green-700',
  PROBATION:         'bg-blue-100 text-blue-700',
  INTERNSHIP:        'bg-purple-100 text-purple-700',
  NOTICE_PERIOD:     'bg-amber-100 text-amber-700',
  PENDING_JOIN:      'bg-gray-100 text-gray-600',
  INACTIVE:          'bg-red-100 text-red-700',
};

const DEPARTMENTS = ['Engineering', 'Finance', 'HR', 'Sales', 'Operations', 'Marketing', 'Design', 'Legal'];
const EMP_STATUSES = ['REGULAR_FULL_TIME','PROBATION','INTERNSHIP','NOTICE_PERIOD','PENDING_JOIN','INACTIVE'];
const LEAVE_STATUSES = ['PENDING','APPROVED','REJECTED','CANCELLED'];
const CLAIM_STATUSES = ['PENDING','APPROVED','PAID','REJECTED'];
const CLAIM_CATEGORIES = ['TRAVEL','FOOD','INTERNET','MISCELLANEOUS'];
const DOC_CATEGORIES = ['OFFER_LETTER','APPOINTMENT_LETTER','EXPERIENCE_LETTER','KYC','CONTRACT','PAYSLIP','OTHER'];

function fmt(label: string) {
  return label.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}
function fmtDate(s: string) {
  return new Date(s).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function Search() {
  const { user } = useAuth();
  const isAdmin   = user?.role === 'ADMIN';
  const isManager = user?.role === 'MANAGER';

  const [tab, setTab]     = useState<Tab>(isAdmin || isManager ? 'employees' : 'leaves');
  const [q, setQ]         = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<any[]>([]);
  const [searched, setSearched] = useState(false);

  // Filters per tab
  const [dept, setDept]           = useState('');
  const [empStatus, setEmpStatus] = useState('');
  const [empType, setEmpType]     = useState('');
  const [leaveStatus, setLeaveStatus] = useState('');
  const [leaveType, setLeaveType]     = useState('');
  const [fromDate, setFromDate]       = useState('');
  const [toDate, setToDate]           = useState('');
  const [claimStatus, setClaimStatus] = useState('');
  const [claimCat, setClaimCat]       = useState('');
  const [docCat, setDocCat]           = useState('');

  const handleSearch = async () => {
    setLoading(true);
    setSearched(true);
    try {
      let url = '';
      const params = new URLSearchParams();
      if (q) params.set('q', q);

      if (tab === 'employees') {
        if (dept)      params.set('department',     dept);
        if (empStatus) params.set('status',         empStatus);
        if (empType)   params.set('employmentType', empType);
        url = `/search/employees?${params}`;
      } else if (tab === 'leaves') {
        if (leaveStatus) params.set('status',    leaveStatus);
        if (leaveType)   params.set('leaveType', leaveType);
        if (fromDate)    params.set('fromDate',  fromDate);
        if (toDate)      params.set('toDate',    toDate);
        url = `/search/leaves?${params}`;
      } else if (tab === 'claims') {
        if (claimStatus) params.set('status',   claimStatus);
        if (claimCat)    params.set('category', claimCat);
        url = `/search/claims?${params}`;
      } else {
        if (docCat) params.set('category', docCat);
        url = `/search/documents?${params}`;
      }

      const r = await api.get(url);
      setResults(r.data);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const handleTabChange = (t: Tab) => {
    setTab(t);
    setResults([]);
    setSearched(false);
    setQ('');
  };

  const tabs: { key: Tab; label: string; icon: React.ReactNode; adminOnly?: boolean }[] = [
    ...(isAdmin || isManager ? [{ key: 'employees' as Tab, label: 'Employees', icon: <User className="h-4 w-4" /> }] : []),
    { key: 'leaves',    label: 'Leaves',    icon: <CalendarDays className="h-4 w-4" /> },
    { key: 'claims',    label: 'Claims',    icon: <FileText className="h-4 w-4" /> },
    { key: 'documents', label: 'Documents', icon: <FolderOpen className="h-4 w-4" /> },
  ];

  return (
    <div className="p-3 md:p-6 space-y-5 max-w-5xl">
      <div>
        <h1 className="text-2xl font-semibold">Search</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Search across employees, leaves, claims, and documents</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b overflow-x-auto">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => handleTabChange(t.key)}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap flex-shrink-0 ${
              tab === t.key
                ? 'border-[#361963] text-[#361963]'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.icon}{t.label}
          </button>
        ))}
      </div>

      {/* Search bar + filters */}
      <Card>
        <CardContent className="pt-4 pb-4 space-y-3">
          <div className="flex gap-2">
            <Input
              placeholder={`Search ${tab}…`}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); }}
              className="flex-1"
            />
            <Button onClick={handleSearch} disabled={loading} style={{ backgroundColor: '#361963' }}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <SearchIcon className="h-4 w-4" />}
              <span className="ml-1.5">Search</span>
            </Button>
          </div>

          {/* Filters */}
          <div className="flex flex-wrap gap-2">
            {tab === 'employees' && (
              <>
                <select className="border rounded px-2 py-1 text-sm bg-white" value={dept} onChange={(e) => setDept(e.target.value)}>
                  <option value="">All Departments</option>
                  {DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
                <select className="border rounded px-2 py-1 text-sm bg-white" value={empStatus} onChange={(e) => setEmpStatus(e.target.value)}>
                  <option value="">All Statuses</option>
                  {EMP_STATUSES.map((s) => <option key={s} value={s}>{fmt(s)}</option>)}
                </select>
                <select className="border rounded px-2 py-1 text-sm bg-white" value={empType} onChange={(e) => setEmpType(e.target.value)}>
                  <option value="">All Types</option>
                  <option value="FULL_TIME">Full Time</option>
                  <option value="INTERN">Intern</option>
                </select>
              </>
            )}
            {tab === 'leaves' && (
              <>
                <select className="border rounded px-2 py-1 text-sm bg-white" value={leaveStatus} onChange={(e) => setLeaveStatus(e.target.value)}>
                  <option value="">All Statuses</option>
                  {LEAVE_STATUSES.map((s) => <option key={s} value={s}>{fmt(s)}</option>)}
                </select>
                <select className="border rounded px-2 py-1 text-sm bg-white" value={leaveType} onChange={(e) => setLeaveType(e.target.value)}>
                  <option value="">All Leave Types</option>
                  <option value="PL">Paid Leave</option>
                  <option value="LWP">Unpaid Leave</option>
                  <option value="TEMPORARY_WFH">Temporary WFH</option>
                  <option value="TRAVELLING">Travelling</option>
                </select>
                <Input type="date" className="h-8 w-36 text-sm" value={fromDate} onChange={(e) => setFromDate(e.target.value)} title="From date" />
                <Input type="date" className="h-8 w-36 text-sm" value={toDate} onChange={(e) => setToDate(e.target.value)} title="To date" />
              </>
            )}
            {tab === 'claims' && (
              <>
                <select className="border rounded px-2 py-1 text-sm bg-white" value={claimStatus} onChange={(e) => setClaimStatus(e.target.value)}>
                  <option value="">All Statuses</option>
                  {CLAIM_STATUSES.map((s) => <option key={s} value={s}>{fmt(s)}</option>)}
                </select>
                <select className="border rounded px-2 py-1 text-sm bg-white" value={claimCat} onChange={(e) => setClaimCat(e.target.value)}>
                  <option value="">All Categories</option>
                  {CLAIM_CATEGORIES.map((c) => <option key={c} value={c}>{fmt(c)}</option>)}
                </select>
              </>
            )}
            {tab === 'documents' && (
              <select className="border rounded px-2 py-1 text-sm bg-white" value={docCat} onChange={(e) => setDocCat(e.target.value)}>
                <option value="">All Categories</option>
                {DOC_CATEGORIES.map((c) => <option key={c} value={c}>{fmt(c)}</option>)}
              </select>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Results */}
      {loading && <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />Searching…</p>}

      {!loading && searched && results.length === 0 && (
        <p className="text-sm text-muted-foreground">No results found.</p>
      )}

      {!loading && results.length > 0 && (
        <div className="text-xs text-muted-foreground mb-1">{results.length} result{results.length !== 1 ? 's' : ''} (max 30 shown)</div>
      )}

      {/* Employee results */}
      {!loading && tab === 'employees' && results.length > 0 && (
        <div className="space-y-2">
          {results.map((emp: any) => (
            <Card key={emp.id}>
              <CardContent className="pt-3 pb-3 flex items-center justify-between gap-3">
                <div>
                  <p className="font-medium text-sm">{emp.profile?.firstName} {emp.profile?.lastName}
                    <span className="ml-2 text-xs text-muted-foreground">({emp.profile?.employeeId})</span>
                  </p>
                  <p className="text-xs text-muted-foreground">{emp.profile?.designation} · {emp.profile?.department}</p>
                  <p className="text-xs text-muted-foreground">{emp.email}</p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5 flex-shrink-0 justify-end max-w-[160px] sm:max-w-none">
                  <Badge className="text-xs">{fmt(emp.role)}</Badge>
                  <Badge className={`text-xs ${EMP_STATUS_COLORS[emp.employmentStatus] ?? ''}`}>{fmt(emp.employmentStatus)}</Badge>
                  <Badge className="text-xs bg-purple-50 text-purple-700">{fmt(emp.profile?.employmentType ?? '')}</Badge>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Leave results */}
      {!loading && tab === 'leaves' && results.length > 0 && (
        <div className="space-y-2">
          {results.map((leave: any) => (
            <Card key={leave.id}>
              <CardContent className="pt-3 pb-3 flex items-center justify-between gap-3">
                <div>
                  <p className="font-medium text-sm">{leave.employee?.profile?.firstName} {leave.employee?.profile?.lastName}
                    <span className="ml-2 text-xs text-muted-foreground">({leave.employee?.profile?.employeeId})</span>
                  </p>
                  <p className="text-xs text-muted-foreground">{leave.leaveType} · {leave.totalDays} day{leave.totalDays !== 1 ? 's' : ''} · {fmtDate(leave.startDate)} – {fmtDate(leave.endDate)}</p>
                  <p className="text-xs text-muted-foreground truncate max-w-md">{leave.reason}</p>
                </div>
                <Badge className={`text-xs flex-shrink-0 ${LEAVE_STATUS_COLORS[leave.status] ?? ''}`}>{fmt(leave.status)}</Badge>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Claim results */}
      {!loading && tab === 'claims' && results.length > 0 && (
        <div className="space-y-2">
          {results.map((claim: any) => (
            <Card key={claim.id}>
              <CardContent className="pt-3 pb-3 flex items-center justify-between gap-3">
                <div>
                  <p className="font-medium text-sm">{claim.employee?.profile?.firstName} {claim.employee?.profile?.lastName}
                    <span className="ml-2 text-xs text-muted-foreground">({claim.employee?.profile?.employeeId})</span>
                  </p>
                  <p className="text-xs text-muted-foreground">{fmt(claim.category)} · ₹{claim.amount.toLocaleString('en-IN')} · {fmtDate(claim.createdAt)}</p>
                  <p className="text-xs text-muted-foreground truncate max-w-md">{claim.description}</p>
                </div>
                <Badge className={`text-xs flex-shrink-0 ${CLAIM_STATUS_COLORS[claim.status] ?? ''}`}>{fmt(claim.status)}</Badge>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Document results */}
      {!loading && tab === 'documents' && results.length > 0 && (
        <div className="space-y-2">
          {results.map((doc: any) => (
            <Card key={doc.id}>
              <CardContent className="pt-3 pb-3 flex items-center justify-between gap-3">
                <div>
                  <p className="font-medium text-sm">{doc.name}</p>
                  <p className="text-xs text-muted-foreground">{doc.user?.profile?.firstName} {doc.user?.profile?.lastName} · {fmtDate(doc.createdAt)}</p>
                  {doc.description && <p className="text-xs text-muted-foreground">{doc.description}</p>}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <Badge className="text-xs">{fmt(doc.category)}</Badge>
                  <a href={doc.fileUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-[#361963] hover:underline">View</a>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
