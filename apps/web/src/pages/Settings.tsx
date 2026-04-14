/**
 * Athena V2 - System Settings Page (Admin Only)
 * Configure: extension arrival time, half-day cutoff, late threshold,
 * probation duration, notice period.
 */

import { useEffect, useState } from 'react';
import api from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Settings2, Save, Clock, CalendarDays, AlertCircle, Key, DatabaseBackup, Copy, Check, Trash2, RefreshCw, Users2, IndianRupee, Leaf } from 'lucide-react';

interface Settings {
  extension_arrival_time:    string;
  half_day_cutoff_time:      string;
  late_warning_threshold:    string;
  probation_duration_months: string;
  notice_period_days:        string;
  loan_interest_rate:        string;
}

const FIELD_META: { key: keyof Settings; label: string; hint: string; type: 'time' | 'number' }[] = [
  {
    key:   'extension_arrival_time',
    label: 'Extension Day Arrival Cutoff',
    hint:  'On extension days, employees must punch in by this time to be marked on-time.',
    type:  'time',
  },
  {
    key:   'half_day_cutoff_time',
    label: 'First-Half Leave Arrival Cutoff',
    hint:  'Employees on first-half leave must punch in by this time to avoid being marked late.',
    type:  'time',
  },
  {
    key:   'late_warning_threshold',
    label: 'Free Late Arrivals (before LWP)',
    hint:  'Number of late arrivals allowed per month before LWP deductions begin.',
    type:  'number',
  },
  {
    key:   'probation_duration_months',
    label: 'Default Probation Period (months)',
    hint:  'Standard probation duration for new full-time employees.',
    type:  'number',
  },
  {
    key:   'notice_period_days',
    label: 'Standard Notice Period (days)',
    hint:  'Default notice period for employees in Notice Period status.',
    type:  'number',
  },
];

// ─── API Key types ────────────────────────────────────────────────────────────
interface ApiKey { id: string; name: string; prefix: string; isActive: boolean; scopes: string[]; expiresAt: string | null; lastUsedAt: string | null; createdAt: string }

// ─── Backup types ─────────────────────────────────────────────────────────────
interface BackupLog { id: string; triggeredBy: string; status: string; fileName: string | null; fileSizeKb: number | null; commitSha: string | null; error: string | null; createdAt: string }
interface BackupStatus { configured: boolean; owner: string | null; repo: string | null; retainDays: number; pgDumpAvailable: boolean; pgDumpMessage: string | null }

export default function Settings() {
  const [settings, setSettings] = useState<Settings>({
    extension_arrival_time:    '11:00',
    half_day_cutoff_time:      '14:30',
    late_warning_threshold:    '3',
    probation_duration_months: '6',
    notice_period_days:        '30',
    loan_interest_rate:        '9',
  });
  const [loading,  setLoading]  = useState(true);
  const [saving,   setSaving]   = useState(false);
  const [saved,    setSaved]    = useState(false);
  const [error,    setError]    = useState('');

  // ── API Keys state ──────────────────────────────────────────────────────────
  const [apiKeys, setApiKeys]         = useState<ApiKey[]>([]);
  const [newKeyName, setNewKeyName]   = useState('');
  const [creatingKey, setCreatingKey] = useState(false);
  const [newKeyValue, setNewKeyValue] = useState('');   // shown once after creation
  const [keyCopied, setKeyCopied]     = useState(false);
  const [keyError, setKeyError]       = useState('');

  // ── Backup state ────────────────────────────────────────────────────────────
  const [backupStatus, setBackupStatus]   = useState<BackupStatus | null>(null);
  const [backupLogs, setBackupLogs]       = useState<BackupLog[]>([]);
  const [triggeringBackup, setTriggeringBackup] = useState(false);
  const [backupMsg, setBackupMsg]         = useState('');

  // ── Delegation state ───────────────────────────────────────────────────────
  interface Delegation { id: string; delegator: { email: string; profile?: { firstName: string; lastName: string; employeeId: string } }; delegate: { email: string; profile?: { firstName: string; lastName: string; employeeId: string } }; fromDate: string; toDate: string; isActive: boolean }
  interface ManagerUser { id: string; email: string; profile?: { firstName: string; lastName: string } }
  const [delegations, setDelegations]     = useState<Delegation[]>([]);
  const [managers, setManagers]           = useState<ManagerUser[]>([]);
  const [delDelegatorId, setDelDelegatorId] = useState('');
  const [delDelegateId, setDelDelegateId]   = useState('');
  const [delFromDate, setDelFromDate]       = useState('');
  const [delToDate, setDelToDate]           = useState('');
  const [creatingDel, setCreatingDel]       = useState(false);
  const [delError, setDelError]             = useState('');

  // ── Leave Eligibility state ─────────────────────────────────────────────
  interface LeaveEligibility { id: string; leaveType: string; label: string; allowedFor: string; isActive: boolean; defaultTotal: number }
  const [leavePolicies, setLeavePolicies] = useState<LeaveEligibility[]>([]);
  const [eligibilityDraft, setEligibilityDraft] = useState<Record<string, string>>({});
  const [savingEligibility, setSavingEligibility] = useState(false);
  const [eligibilitySaved, setEligibilitySaved] = useState(false);

  const fetchDelegations = () => {
    api.get('/delegates/active').then((r) => setDelegations(r.data)).catch(() => {});
  };

  useEffect(() => {
    Promise.all([
      api.get('/settings'),
      api.get('/api-keys'),
      api.get('/backups/status'),
      api.get('/backups'),
      api.get('/delegates/active'),
      api.get('/employees').then((r) => r.data.filter((u: any) => u.role === 'ADMIN' || u.role === 'MANAGER' || u.role === 'OWNER')).catch(() => []),
      api.get('/leave-policy').catch(() => ({ data: [] })),
    ]).then(([settingsRes, keysRes, statusRes, logsRes, delRes, mgrs, policiesRes]) => {
      setSettings(settingsRes.data);
      setApiKeys(keysRes.data);
      setBackupStatus(statusRes.data);
      setBackupLogs(logsRes.data);
      setDelegations(delRes.data);
      setManagers(mgrs);
      const policies = policiesRes.data as LeaveEligibility[];
      setLeavePolicies(policies);
      const draft: Record<string, string> = {};
      policies.forEach((p: LeaveEligibility) => { draft[p.id] = p.allowedFor || 'ALL'; });
      setEligibilityDraft(draft);
    }).catch(() => setError('Failed to load settings'))
      .finally(() => setLoading(false));
  }, []);

  const refreshBackupLogs = () => {
    api.get('/backups').then((r) => setBackupLogs(r.data)).catch(() => {});
  };

  const handleCreateKey = async () => {
    if (!newKeyName.trim()) { setKeyError('Key name is required'); return; }
    setCreatingKey(true);
    setKeyError('');
    setNewKeyValue('');
    try {
      const r = await api.post('/api-keys', { name: newKeyName.trim() });
      setNewKeyValue(r.data.key);
      setNewKeyName('');
      setApiKeys((prev) => [{
        id: r.data.id,
        name: r.data.name,
        prefix: r.data.prefix,
        isActive: true,
        scopes: r.data.scopes ?? [],
        expiresAt: r.data.expiresAt ?? null,
        lastUsedAt: null,
        createdAt: r.data.createdAt,
      }, ...prev]);
    } catch (err: any) {
      setKeyError(err?.response?.data?.error ?? 'Failed to create key');
    } finally {
      setCreatingKey(false);
    }
  };

  const handleDeleteKey = async (id: string) => {
    if (!confirm('Revoke this API key? Any application using it will immediately lose access.')) return;
    try {
      await api.delete(`/api-keys/${id}`);
      setApiKeys((prev) => prev.filter((k) => k.id !== id));
    } catch { alert('Failed to revoke key'); }
  };

  const handleTriggerBackup = async () => {
    setTriggeringBackup(true);
    setBackupMsg('');
    try {
      const r = await api.post('/backups/run');
      setBackupMsg(r.data.message);
      // Poll for result after a few seconds
      setTimeout(refreshBackupLogs, 8000);
    } catch (err: any) {
      setBackupMsg(err?.response?.data?.error ?? 'Failed to trigger backup');
    } finally {
      setTriggeringBackup(false);
    }
  };

  const handleChange = (key: keyof Settings, value: string) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      const updated = await api.put('/settings', settings);
      setSettings(updated.data);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch {
      setError('Failed to save settings. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="p-6 flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading settings...
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-2xl">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ backgroundColor: '#361963' }}>
          <Settings2 className="h-5 w-5 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold">System Settings</h1>
          <p className="text-sm text-muted-foreground">Configure HR policy parameters</p>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          {error}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Clock className="h-4 w-4" />
            Attendance Timings
          </CardTitle>
          <CardDescription>Controls late marking and LWP deduction logic</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {FIELD_META.filter((f) => f.key === 'extension_arrival_time' || f.key === 'half_day_cutoff_time').map((field) => (
            <div key={field.key} className="space-y-1.5">
              <Label htmlFor={field.key}>{field.label}</Label>
              <Input
                id={field.key}
                type="time"
                value={settings[field.key]}
                onChange={(e) => handleChange(field.key, e.target.value)}
                className="w-40"
              />
              <p className="text-xs text-muted-foreground">{field.hint}</p>
            </div>
          ))}
          <div className="space-y-1.5">
            <Label htmlFor="late_warning_threshold">{FIELD_META[2].label}</Label>
            <Input
              id="late_warning_threshold"
              type="number"
              min={0}
              max={20}
              value={settings.late_warning_threshold}
              onChange={(e) => handleChange('late_warning_threshold', e.target.value)}
              className="w-24"
            />
            <p className="text-xs text-muted-foreground">{FIELD_META[2].hint}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarDays className="h-4 w-4" />
            Employee Lifecycle Defaults
          </CardTitle>
          <CardDescription>Reference durations shown in the employee status panel</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {FIELD_META.filter((f) => f.key === 'probation_duration_months' || f.key === 'notice_period_days').map((field) => (
            <div key={field.key} className="space-y-1.5">
              <Label htmlFor={field.key}>{field.label}</Label>
              <Input
                id={field.key}
                type="number"
                min={1}
                value={settings[field.key]}
                onChange={(e) => handleChange(field.key, e.target.value)}
                className="w-24"
              />
              <p className="text-xs text-muted-foreground">{field.hint}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <IndianRupee className="h-4 w-4" />
            Loans & Advances
          </CardTitle>
          <CardDescription>Interest rate applied when admin approves employee loan requests</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="loan_interest_rate">Annual Interest Rate (%)</Label>
            <div className="flex items-center gap-2">
              <Input
                id="loan_interest_rate"
                type="number"
                min={0}
                max={36}
                step={0.1}
                value={settings.loan_interest_rate}
                onChange={(e) => handleChange('loan_interest_rate', e.target.value)}
                className="w-24"
              />
              <span className="text-sm text-muted-foreground">% p.a.</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Reducing-balance EMI formula. Set to 0 for interest-free loans. Default: 9%.
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center gap-3">
        <Button onClick={handleSave} disabled={saving} style={{ backgroundColor: '#361963' }}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
          {saving ? 'Saving...' : 'Save Settings'}
        </Button>
        {saved && (
          <span className="text-sm text-green-600 font-medium">Settings saved successfully.</span>
        )}
      </div>

      {/* ── Leave Eligibility by Employment Type ─────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Leaf className="h-4 w-4" />
            Leave Eligibility by Employment Type
          </CardTitle>
          <CardDescription>
            Control which leave types are available for full-time employees vs interns. Set to "All" for both.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {leavePolicies.filter((p) => p.isActive).length === 0 ? (
            <p className="text-sm text-muted-foreground">No active leave policies found.</p>
          ) : (
            <>
              <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b text-xs text-gray-500 uppercase">
                      <th className="px-4 py-2 text-left">Leave Type</th>
                      <th className="px-4 py-2 text-left">Available For</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {leavePolicies.filter((p) => p.isActive).map((p) => (
                      <tr key={p.id} className="hover:bg-gray-50">
                        <td className="px-4 py-2 font-medium">{p.label} <span className="text-xs text-muted-foreground">({p.leaveType})</span></td>
                        <td className="px-4 py-2">
                          <select
                            value={eligibilityDraft[p.id] || 'ALL'}
                            onChange={(e) => setEligibilityDraft((prev) => ({ ...prev, [p.id]: e.target.value }))}
                            className="border rounded-md px-3 py-1.5 text-sm bg-background"
                          >
                            <option value="ALL">All Employees</option>
                            <option value="FULL_TIME">Full-Time Only</option>
                            <option value="INTERN">Intern Only</option>
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center gap-3">
                <Button
                  disabled={savingEligibility}
                  onClick={async () => {
                    setSavingEligibility(true);
                    setEligibilitySaved(false);
                    try {
                      const updates = leavePolicies.filter((p) => p.isActive).map((p) => ({
                        id: p.id,
                        label: p.label,
                        defaultTotal: p.defaultTotal,
                        isActive: true,
                        allowedFor: eligibilityDraft[p.id] || 'ALL',
                      }));
                      await api.put('/leave-policy', updates);
                      setEligibilitySaved(true);
                      setTimeout(() => setEligibilitySaved(false), 3000);
                    } catch {
                      alert('Failed to save leave eligibility');
                    } finally {
                      setSavingEligibility(false);
                    }
                  }}
                  style={{ backgroundColor: '#361963' }}
                >
                  {savingEligibility ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                  Save Eligibility
                </Button>
                {eligibilitySaved && <span className="text-sm text-green-600 font-medium">Eligibility saved.</span>}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* ── API Keys ──────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Key className="h-4 w-4" />
            Integration API Keys
          </CardTitle>
          <CardDescription>
            API keys allow external systems (e.g. your SLA application) to read Athena data via <code className="text-xs bg-gray-100 px-1 rounded">/api/v1/*</code>.
            Pass the key as <code className="text-xs bg-gray-100 px-1 rounded">X-API-Key</code> header. Keys are shown only once at creation and currently expire automatically after 365 days.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Create new key */}
          <div className="flex gap-2">
            <Input
              placeholder="Key name, e.g. SLA Application"
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreateKey(); }}
              className="max-w-xs"
            />
            <Button onClick={handleCreateKey} disabled={creatingKey} style={{ backgroundColor: '#361963' }}>
              {creatingKey ? <Loader2 className="h-4 w-4 animate-spin" /> : '+ Generate Key'}
            </Button>
          </div>
          {keyError && <p className="text-sm text-red-500">{keyError}</p>}

          {/* Newly created key — show once */}
          {newKeyValue && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-3 space-y-2">
              <p className="text-sm font-medium text-green-800">Key created — copy it now. It will not be shown again.</p>
              <div className="flex items-center gap-2">
                <code className="text-sm bg-white border rounded px-2 py-1 flex-1 font-mono overflow-x-auto">{newKeyValue}</code>
                <button
                  onClick={() => { navigator.clipboard.writeText(newKeyValue); setKeyCopied(true); setTimeout(() => setKeyCopied(false), 2000); }}
                  className="text-green-700 hover:text-green-900"
                >
                  {keyCopied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </button>
              </div>
            </div>
          )}

          {/* Keys list */}
          {apiKeys.length === 0 ? (
            <p className="text-sm text-muted-foreground">No API keys yet.</p>
          ) : (
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b text-xs text-gray-500 uppercase">
                    <th className="px-4 py-2 text-left">Name</th>
                    <th className="px-4 py-2 text-left">Prefix</th>
                    <th className="px-4 py-2 text-left">Last Used</th>
                    <th className="px-4 py-2 text-left">Expires</th>
                    <th className="px-4 py-2 text-left">Created</th>
                    <th className="px-4 py-2"></th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {apiKeys.map((k) => (
                    <tr key={k.id} className="hover:bg-gray-50">
                      <td className="px-4 py-2 font-medium">{k.name}</td>
                      <td className="px-4 py-2 font-mono text-xs text-gray-500">{k.prefix}…</td>
                      <td className="px-4 py-2 text-gray-500 text-xs">
                        {k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : 'Never'}
                      </td>
                      <td className="px-4 py-2 text-gray-500 text-xs">
                        {k.expiresAt ? new Date(k.expiresAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : 'Never'}
                      </td>
                      <td className="px-4 py-2 text-gray-500 text-xs">
                        {new Date(k.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                      </td>
                      <td className="px-4 py-2 text-right">
                        <button onClick={() => handleDeleteKey(k.id)} className="text-red-400 hover:text-red-600">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Database Backups ──────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <DatabaseBackup className="h-4 w-4" />
            Database Backups
          </CardTitle>
          <CardDescription>
            {backupStatus?.configured
              ? <>Automatic daily backup to GitHub repo <strong>{backupStatus.owner}/{backupStatus.repo}</strong>. Backups older than {backupStatus.retainDays} days are auto-deleted.</>
              : <>Backup not configured. Add <code className="text-xs bg-gray-100 px-1 rounded">BACKUP_GITHUB_TOKEN</code>, <code className="text-xs bg-gray-100 px-1 rounded">BACKUP_GITHUB_OWNER</code>, and <code className="text-xs bg-gray-100 px-1 rounded">BACKUP_GITHUB_REPO</code> to your <code className="text-xs bg-gray-100 px-1 rounded">.env</code> file.</>
            }
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!backupStatus?.pgDumpAvailable && (
            <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              Backup cannot run until `pg_dump` is available on this machine.
              {backupStatus?.pgDumpMessage ? ` ${backupStatus.pgDumpMessage}` : ''}
            </div>
          )}
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              disabled={triggeringBackup || !backupStatus?.configured || !backupStatus?.pgDumpAvailable}
              onClick={handleTriggerBackup}
            >
              {triggeringBackup ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Run Backup Now
            </Button>
            <button onClick={refreshBackupLogs} className="text-gray-400 hover:text-gray-600">
              <RefreshCw className="h-4 w-4" />
            </button>
            {backupMsg && <span className="text-sm text-green-600">{backupMsg}</span>}
          </div>

          {backupLogs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No backups yet.</p>
          ) : (
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b text-xs text-gray-500 uppercase">
                    <th className="px-4 py-2 text-left">When</th>
                    <th className="px-4 py-2 text-left">Triggered By</th>
                    <th className="px-4 py-2 text-left">Status</th>
                    <th className="px-4 py-2 text-left">Size</th>
                    <th className="px-4 py-2 text-left">Commit</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {backupLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-gray-50">
                      <td className="px-4 py-2 text-xs text-gray-500">
                        {new Date(log.createdAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td className="px-4 py-2 text-xs">{log.triggeredBy === 'SCHEDULED' ? 'Scheduled' : 'Manual'}</td>
                      <td className="px-4 py-2">
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                          log.status === 'SUCCESS' ? 'bg-green-100 text-green-700' :
                          log.status === 'FAILED'  ? 'bg-red-100 text-red-700' :
                          'bg-yellow-100 text-yellow-700'
                        }`}>
                          {log.status}
                        </span>
                        {log.error && <p className="text-xs text-red-500 mt-0.5 truncate max-w-[200px]">{log.error}</p>}
                      </td>
                      <td className="px-4 py-2 text-xs text-gray-500">{log.fileSizeKb ? `${log.fileSizeKb} KB` : '—'}</td>
                      <td className="px-4 py-2 font-mono text-xs text-gray-400">{log.commitSha ? log.commitSha.slice(0, 7) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Approval Delegation ──────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Users2 className="h-4 w-4" />
            Approval Delegation
          </CardTitle>
          <CardDescription>
            When a manager is on leave, delegate their approval authority to another manager or admin.
            The delegate can approve leaves and claims on behalf of the delegator during the specified period.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Add delegation form */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Delegator (Manager on leave)</Label>
              <select value={delDelegatorId} onChange={(e) => setDelDelegatorId(e.target.value)} className="w-full border rounded-md px-3 py-2 text-sm">
                <option value="">Select manager...</option>
                {managers.map((m) => (
                  <option key={m.id} value={m.id}>{m.profile ? `${m.profile.firstName} ${m.profile.lastName}` : m.email}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Delegate (Covers during absence)</Label>
              <select value={delDelegateId} onChange={(e) => setDelDelegateId(e.target.value)} className="w-full border rounded-md px-3 py-2 text-sm">
                <option value="">Select delegate...</option>
                {managers.filter((m) => m.id !== delDelegatorId).map((m) => (
                  <option key={m.id} value={m.id}>{m.profile ? `${m.profile.firstName} ${m.profile.lastName}` : m.email}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>From Date</Label>
              <Input type="date" value={delFromDate} onChange={(e) => setDelFromDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>To Date</Label>
              <Input type="date" value={delToDate} onChange={(e) => setDelToDate(e.target.value)} />
            </div>
          </div>
          {delError && <p className="text-sm text-red-500">{delError}</p>}
          <Button
            disabled={creatingDel || !delDelegatorId || !delDelegateId || !delFromDate || !delToDate}
            onClick={async () => {
              setCreatingDel(true);
              setDelError('');
              try {
                await api.post('/delegates', { delegatorId: delDelegatorId, delegateId: delDelegateId, fromDate: delFromDate, toDate: delToDate });
                setDelDelegatorId(''); setDelDelegateId(''); setDelFromDate(''); setDelToDate('');
                fetchDelegations();
              } catch (err: any) {
                setDelError(err?.response?.data?.error || 'Failed to create delegation');
              } finally {
                setCreatingDel(false);
              }
            }}
            style={{ backgroundColor: '#361963' }}
          >
            {creatingDel ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Add Delegation
          </Button>

          {/* Active delegations list */}
          {delegations.length === 0 ? (
            <p className="text-sm text-muted-foreground">No active delegations.</p>
          ) : (
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b text-xs text-gray-500 uppercase">
                    <th className="px-4 py-2 text-left">Delegator</th>
                    <th className="px-4 py-2 text-left">Delegate</th>
                    <th className="px-4 py-2 text-left">From</th>
                    <th className="px-4 py-2 text-left">To</th>
                    <th className="px-4 py-2"></th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {delegations.map((d) => (
                    <tr key={d.id} className="hover:bg-gray-50">
                      <td className="px-4 py-2">
                        {d.delegator?.profile ? `${d.delegator.profile.firstName} ${d.delegator.profile.lastName}` : d.delegator?.email}
                      </td>
                      <td className="px-4 py-2">
                        {d.delegate?.profile ? `${d.delegate.profile.firstName} ${d.delegate.profile.lastName}` : d.delegate?.email}
                      </td>
                      <td className="px-4 py-2 text-xs text-gray-500">
                        {new Date(d.fromDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                      </td>
                      <td className="px-4 py-2 text-xs text-gray-500">
                        {new Date(d.toDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                      </td>
                      <td className="px-4 py-2 text-right">
                        <button
                          onClick={async () => {
                            if (!confirm('Remove this delegation?')) return;
                            try {
                              await api.delete(`/delegates/${d.id}`);
                              fetchDelegations();
                            } catch { alert('Failed to remove'); }
                          }}
                          className="text-red-400 hover:text-red-600"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
