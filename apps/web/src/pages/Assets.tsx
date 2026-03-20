/**
 * Athena V2 - Asset Management Page
 * Admin: full inventory CRUD, assign/return, import from Excel.
 * Employee: view my assigned assets.
 */

import { useEffect, useState } from 'react';
import api from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
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
import { Package, Plus, Upload, Pencil, RotateCcw } from 'lucide-react';

// ─── Category labels ────────────────────────────────────────────────────────────
const CATEGORY_LABELS: Record<string, string> = {
  LAPTOP: 'Laptop',
  PHONE: 'Phone',
  CHARGER: 'Charger',
  MONITOR: 'Monitor',
  KEYBOARD: 'Keyboard',
  MOUSE: 'Mouse',
  SIM_CARD: 'SIM Card',
  ACCESS_CARD: 'Access Card',
  ID_CARD: 'ID Card',
  SOFTWARE_LICENSE: 'Software License',
  OTHER: 'Other',
};

const CATEGORIES = Object.keys(CATEGORY_LABELS);

const STATUS_OPTIONS = ['AVAILABLE', 'ASSIGNED', 'UNDER_REPAIR', 'RETIRED'] as const;

function statusBadge(status: string) {
  const map: Record<string, string> = {
    AVAILABLE: 'bg-green-100 text-green-800',
    ASSIGNED: 'bg-blue-100 text-blue-800',
    UNDER_REPAIR: 'bg-orange-100 text-orange-800',
    RETIRED: 'bg-gray-100 text-gray-600',
  };
  return (
    <Badge className={map[status] || 'bg-gray-100 text-gray-600'}>
      {status.replace(/_/g, ' ')}
    </Badge>
  );
}

// ─── Component ──────────────────────────────────────────────────────────────────
export default function Assets() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN' || user?.role === 'OWNER';

  // ── State ──────────────────────────────────────────────────────────────────
  const [assets, setAssets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showAssignDialog, setShowAssignDialog] = useState(false);
  const [showReturnDialog, setShowReturnDialog] = useState(false);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [selectedAsset, setSelectedAsset] = useState<any>(null);
  const [employees, setEmployees] = useState<any[]>([]);
  const [importStep, setImportStep] = useState(1);
  const [importPreview, setImportPreview] = useState<any>(null);
  const [submitting, setSubmitting] = useState(false);

  // Form states
  const [addForm, setAddForm] = useState({
    name: '', assetTag: '', category: 'LAPTOP', serialNumber: '',
    purchaseDate: '', purchaseCost: '', notes: '',
  });
  const [editForm, setEditForm] = useState({
    name: '', assetTag: '', category: 'LAPTOP', serialNumber: '',
    purchaseDate: '', purchaseCost: '', notes: '', status: 'AVAILABLE',
  });
  const [assignForm, setAssignForm] = useState({ userId: '', conditionOut: '', notes: '' });
  const [returnForm, setReturnForm] = useState({ conditionIn: '', notes: '' });

  // ── Fetch assets ───────────────────────────────────────────────────────────
  const fetchAssets = () => {
    setLoading(true);
    const url = isAdmin ? '/assets' : '/assets/my-assets';
    api.get(url)
      .then(r => setAssets(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchAssets(); }, []);

  // ── Filtered assets (admin only) ──────────────────────────────────────────
  const filtered = assets.filter(a => {
    if (categoryFilter !== 'ALL' && a.category !== categoryFilter) return false;
    if (statusFilter !== 'ALL' && a.status !== statusFilter) return false;
    return true;
  });

  // ── Helpers ────────────────────────────────────────────────────────────────
  const currentAssignee = (asset: any) => {
    const active = asset.assignments?.find((a: any) => !a.returnedAt);
    if (!active) return '—';
    const p = active.user?.profile;
    if (p) return `${p.firstName} ${p.lastName}`;
    return active.user?.email || '—';
  };

  const fetchEmployees = () => {
    api.get('/employees').then(r => setEmployees(r.data)).catch(() => {});
  };

  // ── Add asset ──────────────────────────────────────────────────────────────
  const handleAdd = async () => {
    if (!addForm.name || !addForm.assetTag) return;
    setSubmitting(true);
    try {
      await api.post('/assets', {
        ...addForm,
        purchaseCost: addForm.purchaseCost ? parseFloat(addForm.purchaseCost) : undefined,
        purchaseDate: addForm.purchaseDate || undefined,
      });
      setShowAddDialog(false);
      setAddForm({ name: '', assetTag: '', category: 'LAPTOP', serialNumber: '', purchaseDate: '', purchaseCost: '', notes: '' });
      fetchAssets();
    } catch {
      // error
    } finally {
      setSubmitting(false);
    }
  };

  // ── Edit asset ─────────────────────────────────────────────────────────────
  const openEdit = (asset: any) => {
    setSelectedAsset(asset);
    setEditForm({
      name: asset.name || '',
      assetTag: asset.assetTag || '',
      category: asset.category || 'LAPTOP',
      serialNumber: asset.serialNumber || '',
      purchaseDate: asset.purchaseDate ? asset.purchaseDate.slice(0, 10) : '',
      purchaseCost: asset.purchaseCost != null ? String(asset.purchaseCost) : '',
      notes: asset.notes || '',
      status: asset.status || 'AVAILABLE',
    });
    setShowEditDialog(true);
  };

  const handleEdit = async () => {
    if (!selectedAsset) return;
    setSubmitting(true);
    try {
      await api.patch(`/assets/${selectedAsset.id}`, {
        ...editForm,
        purchaseCost: editForm.purchaseCost ? parseFloat(editForm.purchaseCost) : undefined,
        purchaseDate: editForm.purchaseDate || undefined,
      });
      setShowEditDialog(false);
      setSelectedAsset(null);
      fetchAssets();
    } catch {
      // error
    } finally {
      setSubmitting(false);
    }
  };

  // ── Assign asset ───────────────────────────────────────────────────────────
  const openAssign = (asset: any) => {
    setSelectedAsset(asset);
    setAssignForm({ userId: '', conditionOut: '', notes: '' });
    fetchEmployees();
    setShowAssignDialog(true);
  };

  const handleAssign = async () => {
    if (!selectedAsset || !assignForm.userId) return;
    setSubmitting(true);
    try {
      await api.post(`/assets/${selectedAsset.id}/assign`, assignForm);
      setShowAssignDialog(false);
      setSelectedAsset(null);
      fetchAssets();
    } catch {
      // error
    } finally {
      setSubmitting(false);
    }
  };

  // ── Return asset ───────────────────────────────────────────────────────────
  const openReturn = (asset: any) => {
    setSelectedAsset(asset);
    setReturnForm({ conditionIn: '', notes: '' });
    setShowReturnDialog(true);
  };

  const handleReturn = async () => {
    if (!selectedAsset) return;
    setSubmitting(true);
    try {
      await api.patch(`/assets/${selectedAsset.id}/return`, returnForm);
      setShowReturnDialog(false);
      setSelectedAsset(null);
      fetchAssets();
    } catch {
      // error
    } finally {
      setSubmitting(false);
    }
  };

  // ── Import ─────────────────────────────────────────────────────────────────
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSubmitting(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await api.post('/assets/import/preview', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setImportPreview(res.data);
      setImportStep(2);
    } catch {
      // error
    } finally {
      setSubmitting(false);
    }
  };

  const handleImportCommit = async () => {
    if (!importPreview) return;
    setSubmitting(true);
    try {
      await api.post('/assets/import/commit', { rows: importPreview.rows });
      setImportStep(3);
    } catch {
      // error
    } finally {
      setSubmitting(false);
    }
  };

  const resetImport = () => {
    setImportStep(1);
    setImportPreview(null);
    setShowImportDialog(false);
  };

  // ── Loading state ──────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  // ═════════════════════════════════════════════════════════════════════════════
  // EMPLOYEE VIEW
  // ═════════════════════════════════════════════════════════════════════════════
  if (!isAdmin) {
    return (
      <div className="p-6 space-y-4">
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <Package className="w-6 h-6" /> My Assets
        </h1>

        {assets.length === 0 ? (
          <p className="text-muted-foreground">No assets assigned to you.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {assets.map((a: any) => (
              <Card key={a.id}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg">{a.asset?.name || a.name}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-1 text-sm">
                  <p><span className="text-muted-foreground">Asset Tag:</span> {a.asset?.assetTag || a.assetTag}</p>
                  <p><span className="text-muted-foreground">Category:</span> {CATEGORY_LABELS[a.asset?.category || a.category] || a.asset?.category || a.category}</p>
                  <p><span className="text-muted-foreground">Serial Number:</span> {a.asset?.serialNumber || a.serialNumber || '—'}</p>
                  <p><span className="text-muted-foreground">Assigned:</span> {a.assignedAt ? new Date(a.assignedAt).toLocaleDateString() : '—'}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ═════════════════════════════════════════════════════════════════════════════
  // ADMIN VIEW
  // ═════════════════════════════════════════════════════════════════════════════
  return (
    <div className="p-6 space-y-4">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <Package className="w-6 h-6" /> Asset Management
        </h1>
        <div className="flex gap-2">
          <Button
            style={{ backgroundColor: '#361963' }}
            className="text-white"
            onClick={() => setShowAddDialog(true)}
          >
            <Plus className="w-4 h-4 mr-1" /> Add Asset
          </Button>
          <Button
            variant="outline"
            onClick={() => { setImportStep(1); setImportPreview(null); setShowImportDialog(true); }}
          >
            <Upload className="w-4 h-4 mr-1" /> Import from Excel
          </Button>
        </div>
      </div>

      {/* ── Filters ────────────────────────────────────────────────────────── */}
      <div className="flex gap-4">
        <select
          className="border rounded px-3 py-2 text-sm"
          value={categoryFilter}
          onChange={e => setCategoryFilter(e.target.value)}
        >
          <option value="ALL">All Categories</option>
          {CATEGORIES.map(c => (
            <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
          ))}
        </select>
        <select
          className="border rounded px-3 py-2 text-sm"
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
        >
          <option value="ALL">All Statuses</option>
          {STATUS_OPTIONS.map(s => (
            <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
          ))}
        </select>
      </div>

      {/* ── Inventory Table ────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Inventory ({filtered.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {filtered.length === 0 ? (
            <p className="text-muted-foreground">No assets found.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th className="py-2 px-3 font-medium">Asset Tag</th>
                    <th className="py-2 px-3 font-medium">Name</th>
                    <th className="py-2 px-3 font-medium">Category</th>
                    <th className="py-2 px-3 font-medium">Serial Number</th>
                    <th className="py-2 px-3 font-medium">Status</th>
                    <th className="py-2 px-3 font-medium">Assigned To</th>
                    <th className="py-2 px-3 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((asset: any) => (
                    <tr key={asset.id} className="border-b hover:bg-muted/50">
                      <td className="py-2 px-3 font-mono text-xs">{asset.assetTag}</td>
                      <td className="py-2 px-3">{asset.name}</td>
                      <td className="py-2 px-3">{CATEGORY_LABELS[asset.category] || asset.category}</td>
                      <td className="py-2 px-3 font-mono text-xs">{asset.serialNumber || '—'}</td>
                      <td className="py-2 px-3">{statusBadge(asset.status)}</td>
                      <td className="py-2 px-3">{currentAssignee(asset)}</td>
                      <td className="py-2 px-3">
                        <div className="flex gap-1">
                          {asset.status === 'AVAILABLE' && (
                            <Button size="sm" variant="outline" onClick={() => openAssign(asset)}>
                              Assign
                            </Button>
                          )}
                          {asset.status === 'ASSIGNED' && (
                            <Button size="sm" variant="outline" onClick={() => openReturn(asset)}>
                              <RotateCcw className="w-3 h-3 mr-1" /> Return
                            </Button>
                          )}
                          <Button size="sm" variant="ghost" onClick={() => openEdit(asset)}>
                            <Pencil className="w-3 h-3" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ══════════════════════════════════════════════════════════════════════
          DIALOGS
         ══════════════════════════════════════════════════════════════════════ */}

      {/* ── Add Asset Dialog ───────────────────────────────────────────────── */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Asset</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Name *</Label>
              <Input value={addForm.name} onChange={e => setAddForm({ ...addForm, name: e.target.value })} placeholder="e.g. MacBook Pro 14" />
            </div>
            <div>
              <Label>Asset Tag *</Label>
              <Input value={addForm.assetTag} onChange={e => setAddForm({ ...addForm, assetTag: e.target.value })} placeholder="e.g. AST-001" />
            </div>
            <div>
              <Label>Category</Label>
              <select className="w-full border rounded px-3 py-2 text-sm" value={addForm.category} onChange={e => setAddForm({ ...addForm, category: e.target.value })}>
                {CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
              </select>
            </div>
            <div>
              <Label>Serial Number</Label>
              <Input value={addForm.serialNumber} onChange={e => setAddForm({ ...addForm, serialNumber: e.target.value })} />
            </div>
            <div>
              <Label>Purchase Date</Label>
              <Input type="date" value={addForm.purchaseDate} onChange={e => setAddForm({ ...addForm, purchaseDate: e.target.value })} />
            </div>
            <div>
              <Label>Purchase Cost</Label>
              <Input type="number" value={addForm.purchaseCost} onChange={e => setAddForm({ ...addForm, purchaseCost: e.target.value })} placeholder="0.00" />
            </div>
            <div>
              <Label>Notes</Label>
              <Input value={addForm.notes} onChange={e => setAddForm({ ...addForm, notes: e.target.value })} />
            </div>
            <Button
              className="w-full text-white"
              style={{ backgroundColor: '#361963' }}
              disabled={submitting || !addForm.name || !addForm.assetTag}
              onClick={handleAdd}
            >
              {submitting ? 'Adding...' : 'Add Asset'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Edit Asset Dialog ──────────────────────────────────────────────── */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Asset</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Name *</Label>
              <Input value={editForm.name} onChange={e => setEditForm({ ...editForm, name: e.target.value })} />
            </div>
            <div>
              <Label>Asset Tag *</Label>
              <Input value={editForm.assetTag} onChange={e => setEditForm({ ...editForm, assetTag: e.target.value })} />
            </div>
            <div>
              <Label>Category</Label>
              <select className="w-full border rounded px-3 py-2 text-sm" value={editForm.category} onChange={e => setEditForm({ ...editForm, category: e.target.value })}>
                {CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
              </select>
            </div>
            <div>
              <Label>Serial Number</Label>
              <Input value={editForm.serialNumber} onChange={e => setEditForm({ ...editForm, serialNumber: e.target.value })} />
            </div>
            <div>
              <Label>Status</Label>
              <select className="w-full border rounded px-3 py-2 text-sm" value={editForm.status} onChange={e => setEditForm({ ...editForm, status: e.target.value })}>
                {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
              </select>
            </div>
            <div>
              <Label>Purchase Date</Label>
              <Input type="date" value={editForm.purchaseDate} onChange={e => setEditForm({ ...editForm, purchaseDate: e.target.value })} />
            </div>
            <div>
              <Label>Purchase Cost</Label>
              <Input type="number" value={editForm.purchaseCost} onChange={e => setEditForm({ ...editForm, purchaseCost: e.target.value })} />
            </div>
            <div>
              <Label>Notes</Label>
              <Input value={editForm.notes} onChange={e => setEditForm({ ...editForm, notes: e.target.value })} />
            </div>
            <Button
              className="w-full text-white"
              style={{ backgroundColor: '#361963' }}
              disabled={submitting || !editForm.name || !editForm.assetTag}
              onClick={handleEdit}
            >
              {submitting ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Assign Dialog ──────────────────────────────────────────────────── */}
      <Dialog open={showAssignDialog} onOpenChange={setShowAssignDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Assign: {selectedAsset?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Employee *</Label>
              <select
                className="w-full border rounded px-3 py-2 text-sm"
                value={assignForm.userId}
                onChange={e => setAssignForm({ ...assignForm, userId: e.target.value })}
              >
                <option value="">Select employee...</option>
                {employees.map((emp: any) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.profile ? `${emp.profile.firstName} ${emp.profile.lastName}` : emp.email}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label>Condition Out</Label>
              <Input value={assignForm.conditionOut} onChange={e => setAssignForm({ ...assignForm, conditionOut: e.target.value })} placeholder="e.g. Good, Minor scratches" />
            </div>
            <div>
              <Label>Notes</Label>
              <Input value={assignForm.notes} onChange={e => setAssignForm({ ...assignForm, notes: e.target.value })} />
            </div>
            <Button
              className="w-full text-white"
              style={{ backgroundColor: '#361963' }}
              disabled={submitting || !assignForm.userId}
              onClick={handleAssign}
            >
              {submitting ? 'Assigning...' : 'Assign Asset'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Return Dialog ──────────────────────────────────────────────────── */}
      <Dialog open={showReturnDialog} onOpenChange={setShowReturnDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Return: {selectedAsset?.name}</DialogTitle>
          </DialogHeader>
          {selectedAsset && (
            <p className="text-sm text-muted-foreground">
              Currently assigned to: {currentAssignee(selectedAsset)}
            </p>
          )}
          <div className="space-y-3">
            <div>
              <Label>Condition In</Label>
              <Input value={returnForm.conditionIn} onChange={e => setReturnForm({ ...returnForm, conditionIn: e.target.value })} placeholder="e.g. Good, Screen cracked" />
            </div>
            <div>
              <Label>Notes</Label>
              <Input value={returnForm.notes} onChange={e => setReturnForm({ ...returnForm, notes: e.target.value })} />
            </div>
            <Button
              className="w-full text-white"
              style={{ backgroundColor: '#361963' }}
              disabled={submitting}
              onClick={handleReturn}
            >
              {submitting ? 'Returning...' : 'Confirm Return'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Import Dialog ──────────────────────────────────────────────────── */}
      <Dialog open={showImportDialog} onOpenChange={(open) => { if (!open) resetImport(); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Import Assets from Excel</DialogTitle>
          </DialogHeader>

          {/* Step 1: Upload */}
          {importStep === 1 && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Upload an Excel file (.xlsx, .xls) with columns: Name, Asset Tag, Category, Serial Number, Purchase Date, Purchase Cost, Notes.
              </p>
              <Input
                type="file"
                accept=".xlsx,.xls"
                onChange={handleFileUpload}
                disabled={submitting}
              />
              {submitting && <p className="text-sm text-muted-foreground">Processing file...</p>}
            </div>
          )}

          {/* Step 2: Preview */}
          {importStep === 2 && importPreview && (
            <div className="space-y-4">
              <div className="flex gap-4 text-sm">
                <span>Total rows: <strong>{importPreview.totalRows}</strong></span>
                <span className="text-green-600">Valid: <strong>{importPreview.validRows}</strong></span>
                {importPreview.errors > 0 && (
                  <span className="text-red-600">Errors: <strong>{importPreview.errors}</strong></span>
                )}
              </div>
              <div className="overflow-x-auto max-h-64 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b text-left">
                      <th className="py-1 px-2">#</th>
                      <th className="py-1 px-2">Name</th>
                      <th className="py-1 px-2">Asset Tag</th>
                      <th className="py-1 px-2">Category</th>
                      <th className="py-1 px-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {importPreview.rows?.map((row: any, i: number) => (
                      <tr key={i} className={`border-b ${row.error ? 'bg-red-50' : ''}`}>
                        <td className="py-1 px-2">{i + 1}</td>
                        <td className="py-1 px-2">{row.name}</td>
                        <td className="py-1 px-2">{row.assetTag}</td>
                        <td className="py-1 px-2">{row.category}</td>
                        <td className="py-1 px-2">
                          {row.error
                            ? <span className="text-red-600">{row.error}</span>
                            : <span className="text-green-600">OK</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex gap-2">
                <Button
                  className="text-white"
                  style={{ backgroundColor: '#361963' }}
                  disabled={submitting || importPreview.validRows === 0}
                  onClick={handleImportCommit}
                >
                  {submitting ? 'Importing...' : `Commit ${importPreview.validRows} Assets`}
                </Button>
                <Button variant="outline" onClick={resetImport}>Cancel</Button>
              </div>
            </div>
          )}

          {/* Step 3: Success */}
          {importStep === 3 && (
            <div className="space-y-4 text-center py-4">
              <p className="text-green-600 font-medium text-lg">
                Successfully imported {importPreview?.validRows || 0} assets!
              </p>
              <Button
                variant="outline"
                onClick={() => { resetImport(); fetchAssets(); }}
              >
                Close
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
