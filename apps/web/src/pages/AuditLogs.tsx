/**
 * Athena V2 - Audit Logs Page (Admin Only)
 * Paginated, filterable log of critical system actions.
 */

import { useEffect, useState, useCallback } from 'react';
import api from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input }  from '@/components/ui/input';
import { Badge }  from '@/components/ui/badge';
import { Loader2, ShieldCheck, ChevronLeft, ChevronRight, Search, Filter } from 'lucide-react';

interface AuditLog {
  id:        string;
  actorId:   string;
  action:    string;
  entity:    string;
  entityId:  string | null;
  subjectEntity: string | null;
  subjectId: string | null;
  subjectLabel: string | null;
  subjectMeta: Record<string, any> | null;
  oldValues: Record<string, any> | null;
  newValues: Record<string, any> | null;
  createdAt: string;
  actor: {
    profile: { firstName: string; lastName: string; employeeId: string } | null;
  };
}

const ACTION_COLORS: Record<string, string> = {
  LEAVE_APPROVED:           'bg-green-100 text-green-800',
  LEAVE_REJECTED:           'bg-red-100 text-red-800',
  EMPLOYEE_DEACTIVATED:     'bg-red-100 text-red-800',
  EMPLOYMENT_STATUS_CHANGED:'bg-blue-100 text-blue-800',
  PROFILE_UPDATED:          'bg-yellow-100 text-yellow-800',
  ATTENDANCE_CORRECTED:     'bg-orange-100 text-orange-800',
};

function formatActionLabel(action: string) {
  return action.replace(/_/g, ' ');
}

function formatValues(values: Record<string, any> | null) {
  if (!values) return '—';
  return Object.entries(values)
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ');
}

function formatSubject(log: AuditLog) {
  const primary = log.subjectLabel || log.subjectId || '—';
  if (!log.subjectMeta) return primary;
  const extra = Object.entries(log.subjectMeta)
    .filter(([, value]) => value != null && value !== '')
    .map(([key, value]) => `${key}: ${value}`)
    .join(', ');
  return extra ? `${primary} • ${extra}` : primary;
}

export default function AuditLogs() {
  const [logs,    setLogs]    = useState<AuditLog[]>([]);
  const [total,   setTotal]   = useState(0);
  const [page,    setPage]    = useState(1);
  const [pages,   setPages]   = useState(1);
  const [loading, setLoading] = useState(true);

  // Filters
  const [actionFilter, setActionFilter] = useState('');
  const [entityFilter, setEntityFilter] = useState('');
  const [search,       setSearch]       = useState('');

  const limit = 50;

  const fetchLogs = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const params: Record<string, any> = { page: p, limit };
      if (actionFilter) params.action = actionFilter;
      if (entityFilter) params.entity = entityFilter;
      const res = await api.get('/audit-logs', { params });
      setLogs(res.data.logs);
      setTotal(res.data.total);
      setPages(res.data.pages);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [actionFilter, entityFilter]);

  useEffect(() => {
    setPage(1);
    fetchLogs(1);
  }, [actionFilter, entityFilter, fetchLogs]);

  const filteredLogs = logs.filter((l) => {
    if (!search) return true;
    const actor = l.actor?.profile ? `${l.actor.profile.firstName} ${l.actor.profile.lastName}` : '';
    return (
      actor.toLowerCase().includes(search.toLowerCase()) ||
      (l.subjectLabel || '').toLowerCase().includes(search.toLowerCase()) ||
      l.action.toLowerCase().includes(search.toLowerCase()) ||
      l.entity.toLowerCase().includes(search.toLowerCase())
    );
  });

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ backgroundColor: '#361963' }}>
          <ShieldCheck className="h-5 w-5 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold">Audit Logs</h1>
          <p className="text-sm text-muted-foreground">{total} total entries</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search actor, action, entity..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 w-64"
          />
        </div>
        <div className="relative">
          <Filter className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Filter by action..."
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            className="pl-9 w-48"
          />
        </div>
        <div className="relative">
          <Filter className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Filter by entity..."
            value={entityFilter}
            onChange={(e) => setEntityFilter(e.target.value)}
            className="pl-9 w-48"
          />
        </div>
        {(actionFilter || entityFilter) && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => { setActionFilter(''); setEntityFilter(''); }}
          >
            Clear filters
          </Button>
        )}
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Activity History</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16 gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading logs...
            </div>
          ) : filteredLogs.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">No audit logs found.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-gray-50/50">
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Timestamp</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Actor</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Action</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Whose</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Entity</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Changes</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredLogs.map((log, i) => {
                    const actor = log.actor?.profile
                      ? `${log.actor.profile.firstName} ${log.actor.profile.lastName} (${log.actor.profile.employeeId})`
                      : log.actorId;
                    const colorClass = ACTION_COLORS[log.action] || 'bg-gray-100 text-gray-800';
                    return (
                      <tr key={log.id} className={`border-b last:border-0 ${i % 2 === 0 ? '' : 'bg-gray-50/30'}`}>
                        <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                          {new Date(log.createdAt).toLocaleString('en-IN', {
                            day: '2-digit', month: 'short', year: 'numeric',
                            hour: '2-digit', minute: '2-digit',
                          })}
                        </td>
                        <td className="px-4 py-3 font-medium">{actor}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${colorClass}`}>
                            {formatActionLabel(log.action)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-700 max-w-xs">
                          {formatSubject(log)}
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant="outline" className="text-xs">{log.entity}</Badge>
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground max-w-xs">
                          {log.newValues && (
                            <span className="text-green-700">→ {formatValues(log.newValues)}</span>
                          )}
                          {log.oldValues && log.newValues && <span className="mx-1 text-gray-400">|</span>}
                          {log.oldValues && (
                            <span className="text-red-600">← {formatValues(log.oldValues)}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {pages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">Page {page} of {pages}</p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => { const p = page - 1; setPage(p); fetchLogs(p); }}
            >
              <ChevronLeft className="h-4 w-4" />
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= pages}
              onClick={() => { const p = page + 1; setPage(p); fetchLogs(p); }}
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
