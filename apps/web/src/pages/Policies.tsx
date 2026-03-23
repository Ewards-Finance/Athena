/**
 * Athena V3.1 - Policy Engine Page (OWNER only)
 * Manage versioned policy rules that control payroll/leave/attendance logic.
 * Supports Global policies and Company-Specific overrides.
 */

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import api from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollText, Plus, Eye, Send, Check, Trash2, Globe, Building2 } from 'lucide-react';

interface PolicyRule {
  id: string;
  ruleKey: string;
  ruleValue: string;
  valueType: string;
  description: string | null;
}

interface PolicyVersion {
  id: string;
  name: string;
  versionCode: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  isActive: boolean;
  scope: 'GLOBAL' | 'COMPANY_SPECIFIC';
  companyId: string | null;
  company: { id: string; displayName: string; code: string } | null;
  publishedBy: string | null;
  publishedAt: string | null;
  notes: string | null;
  rules?: PolicyRule[];
  _count?: { rules: number; acknowledgements: number };
}

interface Acknowledgement {
  id: string;
  isAcknowledged: boolean;
  acknowledgedAt: string | null;
  user: {
    id: string;
    email: string;
    profile: { firstName: string; lastName: string } | null;
  };
}

interface Company {
  id: string;
  displayName: string;
  code: string;
}

export default function Policies() {
  const [versions, setVersions] = useState<PolicyVersion[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedVersion, setSelectedVersion] = useState<PolicyVersion | null>(null);
  const [acknowledgements, setAcknowledgements] = useState<Acknowledgement[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newCode, setNewCode] = useState('');
  const [newDate, setNewDate] = useState('');
  const [newScope, setNewScope] = useState<'GLOBAL' | 'COMPANY_SPECIFIC'>('GLOBAL');
  const [newCompanyId, setNewCompanyId] = useState('');
  const [creating, setCreating] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [editingRules, setEditingRules] = useState<Record<string, string>>({});
  const [savingRules, setSavingRules] = useState(false);
  const [tab, setTab] = useState<'rules' | 'acks'>('rules');
  const [ackFilter, setAckFilter] = useState<'all' | 'pending' | 'acked'>('all');
  const [sendingReminder, setSendingReminder] = useState(false);

  const fetchVersions = () => {
    api.get('/policies')
      .then(r => setVersions(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchVersions();
    api.get('/companies').then(r => setCompanies(r.data)).catch(() => {});
  }, []);

  const viewVersion = async (v: PolicyVersion) => {
    try {
      const r = await api.get(`/policies/${v.id}`);
      setSelectedVersion(r.data);
      setAcknowledgements(r.data.acknowledgements ?? []);
      const ruleMap: Record<string, string> = {};
      (r.data.rules ?? []).forEach((rule: PolicyRule) => {
        ruleMap[rule.ruleKey] = rule.ruleValue;
      });
      setEditingRules(ruleMap);
      setTab('rules');
    } catch {
      alert('Failed to load policy version');
    }
  };

  const handleCreate = async () => {
    if (!newName || !newCode || !newDate) return;
    if (newScope === 'COMPANY_SPECIFIC' && !newCompanyId) return;
    setCreating(true);
    try {
      await api.post('/policies', {
        name: newName,
        versionCode: newCode,
        effectiveFrom: newDate,
        copyFromActive: true,
        scope: newScope,
        companyId: newScope === 'COMPANY_SPECIFIC' ? newCompanyId : undefined,
      });
      setShowCreate(false);
      setNewName(''); setNewCode(''); setNewDate('');
      setNewScope('GLOBAL'); setNewCompanyId('');
      fetchVersions();
    } catch (err: any) {
      alert(err.response?.data?.error ?? 'Failed to create version');
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (v: PolicyVersion) => {
    if (!confirm(`Delete draft "${v.name}"? This cannot be undone.`)) return;
    setDeleting(v.id);
    try {
      await api.delete(`/policies/${v.id}`);
      fetchVersions();
    } catch (err: any) {
      alert(err.response?.data?.error ?? 'Failed to delete');
    } finally {
      setDeleting(null);
    }
  };

  const handleSaveRules = async () => {
    if (!selectedVersion) return;
    setSavingRules(true);
    try {
      const rules = Object.entries(editingRules).map(([ruleKey, ruleValue]) => ({ ruleKey, ruleValue }));
      const r = await api.post(`/policies/${selectedVersion.id}/rules`, { rules });
      setSelectedVersion(r.data);
    } catch {
      alert('Failed to save rules');
    } finally {
      setSavingRules(false);
    }
  };

  const handlePublish = async () => {
    if (!selectedVersion) return;
    const scopeNote = selectedVersion.scope === 'COMPANY_SPECIFIC'
      ? ` for ${selectedVersion.company?.displayName}`
      : ' for ALL companies';
    if (!confirm(`This will activate this policy${scopeNote}. All future payroll runs will use these rules. Confirm?`)) return;
    setPublishing(true);
    try {
      await api.patch(`/policies/${selectedVersion.id}/publish`);
      setSelectedVersion(null);
      fetchVersions();
    } catch (err: any) {
      alert(err.response?.data?.error ?? 'Failed to publish');
    } finally {
      setPublishing(false);
    }
  };

  // Group versions by scope for display
  const globalVersions = versions.filter(v => v.scope === 'GLOBAL');
  const companyVersions = versions.filter(v => v.scope === 'COMPANY_SPECIFIC');

  const renderVersionCard = (v: PolicyVersion) => (
    <Card key={v.id} className={v.isActive ? 'border-green-300 bg-green-50/50' : ''}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ScrollText className="h-5 w-5 text-muted-foreground" />
            <div>
              <CardTitle className="text-sm font-semibold">{v.name}</CardTitle>
              <p className="text-xs text-muted-foreground font-mono">{v.versionCode}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={v.isActive ? 'default' : 'secondary'}>
              {v.isActive ? 'ACTIVE' : 'DRAFT'}
            </Badge>
            <span className="text-xs text-muted-foreground">{v._count?.rules ?? 0} rules</span>
            <Button size="sm" variant="outline" onClick={() => viewVersion(v)}>
              <Eye className="h-3 w-3 mr-1" /> View
            </Button>
            {!v.isActive && (
              <Button
                size="sm"
                variant="ghost"
                className="text-red-500 hover:text-red-700 hover:bg-red-50"
                disabled={deleting === v.id}
                onClick={() => handleDelete(v)}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="flex gap-4 text-xs text-muted-foreground">
          <span>Effective: {new Date(v.effectiveFrom).toLocaleDateString()}</span>
          {v.publishedAt && <span>Published: {new Date(v.publishedAt).toLocaleDateString()}</span>}
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Policy Engine</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Manage versioned rules that control payroll, leaves, and attendance
          </p>
        </div>
        <Button onClick={() => setShowCreate(true)}>
          <Plus className="h-4 w-4 mr-2" /> New Version
        </Button>
      </div>

      {loading ? (
        <p className="text-muted-foreground">Loading policy versions...</p>
      ) : versions.length === 0 ? (
        <p className="text-muted-foreground">No policy versions found. Create one to get started.</p>
      ) : (
        <div className="space-y-6">
          {/* Global Policies */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Globe className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                Global Policies — Apply to all companies
              </h2>
            </div>
            {globalVersions.length === 0 ? (
              <p className="text-xs text-muted-foreground pl-6">No global policy versions yet.</p>
            ) : (
              globalVersions.map(renderVersionCard)
            )}
          </div>

          {/* Company-Specific Policies */}
          {companyVersions.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Building2 className="h-4 w-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                  Company-Specific Overrides
                </h2>
              </div>
              <p className="text-xs text-muted-foreground pl-6">
                These rules override the global policy for their respective company.
              </p>
              {companyVersions.map(v => (
                <div key={v.id} className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground pl-1 flex items-center gap-1">
                    <Building2 className="h-3 w-3" />
                    {v.company?.displayName ?? v.companyId}
                  </p>
                  {renderVersionCard(v)}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* View/Edit Version Dialog */}
      <Dialog open={!!selectedVersion} onOpenChange={() => setSelectedVersion(null)}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 flex-wrap">
              {selectedVersion?.name}
              <Badge variant={selectedVersion?.isActive ? 'default' : 'secondary'}>
                {selectedVersion?.isActive ? 'ACTIVE' : 'DRAFT'}
              </Badge>
              {selectedVersion?.scope === 'COMPANY_SPECIFIC' ? (
                <Badge variant="outline" className="text-xs">
                  <Building2 className="h-3 w-3 mr-1" />
                  {selectedVersion.company?.displayName ?? 'Company-Specific'}
                </Badge>
              ) : (
                <Badge variant="outline" className="text-xs">
                  <Globe className="h-3 w-3 mr-1" />
                  Global
                </Badge>
              )}
            </DialogTitle>
          </DialogHeader>

          {/* Tabs */}
          <div className="flex gap-2 border-b pb-2">
            <Button size="sm" variant={tab === 'rules' ? 'default' : 'ghost'} onClick={() => setTab('rules')}>
              Rules ({selectedVersion?.rules?.length ?? 0})
            </Button>
            <Button size="sm" variant={tab === 'acks' ? 'default' : 'ghost'} onClick={() => setTab('acks')}>
              Acknowledgements ({acknowledgements.length})
            </Button>
          </div>

          {tab === 'rules' && selectedVersion?.rules && (
            <div className="space-y-3">
              {selectedVersion.scope === 'COMPANY_SPECIFIC' && (
                <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
                  Rules in this version <strong>override the global policy</strong> for {selectedVersion.company?.displayName}.
                  Only rules defined here will override — all other rules fall back to the active global policy.
                </div>
              )}
              <div className="rounded-lg border overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium">Rule</th>
                      <th className="text-left px-3 py-2 font-medium w-32">Value</th>
                      <th className="text-left px-3 py-2 font-medium w-20">Type</th>
                      <th className="text-left px-3 py-2 font-medium">Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedVersion.rules.map(rule => (
                      <tr key={rule.id} className="border-t">
                        <td className="px-3 py-2 font-mono text-xs">{rule.ruleKey}</td>
                        <td className="px-3 py-2">
                          {!selectedVersion.isActive ? (
                            <Input
                              className="h-7 text-xs"
                              value={editingRules[rule.ruleKey] ?? rule.ruleValue}
                              onChange={e => setEditingRules(prev => ({ ...prev, [rule.ruleKey]: e.target.value }))}
                            />
                          ) : (
                            <span className="font-mono text-xs">{rule.ruleValue}</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <Badge variant="outline" className="text-xs">{rule.valueType}</Badge>
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">{rule.description}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {!selectedVersion.isActive && (
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={handleSaveRules} disabled={savingRules}>
                    {savingRules ? 'Saving...' : 'Save Rules'}
                  </Button>
                  <Button onClick={handlePublish} disabled={publishing}>
                    <Send className="h-3 w-3 mr-1" />
                    {publishing ? 'Publishing...' : 'Publish Version'}
                  </Button>
                </div>
              )}
            </div>
          )}

          {tab === 'acks' && (() => {
            const ackedCount = acknowledgements.filter(a => a.isAcknowledged).length;
            const totalCount = acknowledgements.length;
            const pendingCount = totalCount - ackedCount;
            const pct = totalCount > 0 ? Math.round((ackedCount / totalCount) * 100) : 0;
            const filtered = ackFilter === 'all' ? acknowledgements
              : ackFilter === 'pending' ? acknowledgements.filter(a => !a.isAcknowledged)
              : acknowledgements.filter(a => a.isAcknowledged);

            const handleSendReminder = async () => {
              if (!selectedVersion) return;
              setSendingReminder(true);
              try {
                const res = await api.post(`/policies/${selectedVersion.id}/remind`);
                toast.success(res.data?.message || 'Reminders sent');
              } catch {
                toast.error('Failed to send reminders');
              } finally {
                setSendingReminder(false);
              }
            };

            return (
              <div className="space-y-3">
                {/* Summary */}
                {totalCount > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">{ackedCount} of {totalCount} acknowledged ({pct}%)</span>
                      {pendingCount > 0 && (
                        <Button size="sm" variant="outline" onClick={handleSendReminder} disabled={sendingReminder}>
                          <Send className="h-3 w-3 mr-1" />
                          {sendingReminder ? 'Sending...' : `Remind ${pendingCount} pending`}
                        </Button>
                      )}
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div className="bg-green-500 h-2 rounded-full transition-all" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                )}

                {/* Filter buttons */}
                <div className="flex gap-1">
                  {(['all', 'pending', 'acked'] as const).map(f => (
                    <Button key={f} size="sm" variant={ackFilter === f ? 'default' : 'ghost'} onClick={() => setAckFilter(f)}>
                      {f === 'all' ? `All (${totalCount})` : f === 'pending' ? `Pending (${pendingCount})` : `Acknowledged (${ackedCount})`}
                    </Button>
                  ))}
                </div>

                {/* List */}
                {filtered.length === 0 ? (
                  <p className="text-muted-foreground text-sm py-4">
                    {totalCount === 0 ? 'No acknowledgement records yet.' : 'No records match this filter.'}
                  </p>
                ) : (
                  filtered.map(ack => (
                    <div key={ack.id} className="flex items-center justify-between p-3 rounded-lg border">
                      <div>
                        <p className="text-sm font-medium">
                          {ack.user.profile?.firstName} {ack.user.profile?.lastName}
                        </p>
                        <p className="text-xs text-muted-foreground">{ack.user.email}</p>
                      </div>
                      <div>
                        {ack.isAcknowledged ? (
                          <Badge className="bg-green-100 text-green-800">
                            <Check className="h-3 w-3 mr-1" /> Acknowledged
                          </Badge>
                        ) : (
                          <Badge variant="secondary">Pending</Badge>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* Create New Version Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Create New Policy Version</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Version Name</Label>
              <Input placeholder="e.g. FY 2026-27 Policy" value={newName} onChange={e => setNewName(e.target.value)} />
            </div>
            <div>
              <Label>Version Code</Label>
              <Input placeholder="e.g. POL-2026-001" value={newCode} onChange={e => setNewCode(e.target.value)} />
            </div>
            <div>
              <Label>Effective From</Label>
              <Input type="date" value={newDate} onChange={e => setNewDate(e.target.value)} />
            </div>

            {/* Scope selector */}
            <div>
              <Label>Scope</Label>
              <div className="flex gap-3 mt-1">
                <button
                  type="button"
                  onClick={() => { setNewScope('GLOBAL'); setNewCompanyId(''); }}
                  className={`flex-1 flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
                    newScope === 'GLOBAL' ? 'border-primary bg-primary/5 text-primary' : 'border-muted hover:border-muted-foreground'
                  }`}
                >
                  <Globe className="h-4 w-4" />
                  <div className="text-left">
                    <div className="font-medium">Global</div>
                    <div className="text-xs text-muted-foreground">All companies</div>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setNewScope('COMPANY_SPECIFIC')}
                  className={`flex-1 flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
                    newScope === 'COMPANY_SPECIFIC' ? 'border-primary bg-primary/5 text-primary' : 'border-muted hover:border-muted-foreground'
                  }`}
                >
                  <Building2 className="h-4 w-4" />
                  <div className="text-left">
                    <div className="font-medium">Company-Specific</div>
                    <div className="text-xs text-muted-foreground">Override for one company</div>
                  </div>
                </button>
              </div>
            </div>

            {/* Company dropdown — only when COMPANY_SPECIFIC */}
            {newScope === 'COMPANY_SPECIFIC' && (
              <div>
                <Label>Company</Label>
                <select
                  className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={newCompanyId}
                  onChange={e => setNewCompanyId(e.target.value)}
                >
                  <option value="">Select a company...</option>
                  {companies.map(c => (
                    <option key={c.id} value={c.id}>{c.displayName} ({c.code})</option>
                  ))}
                </select>
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              Rules will be copied from the currently active global version. You can edit them before publishing.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
              <Button
                onClick={handleCreate}
                disabled={creating || !newName || !newCode || !newDate || (newScope === 'COMPANY_SPECIFIC' && !newCompanyId)}
              >
                {creating ? 'Creating...' : 'Create Draft'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
