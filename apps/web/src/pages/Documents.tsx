/**
 * Athena V2 - Employee Document Vault
 * Admin: can upload/delete docs for any employee
 * Employee/Manager: can view and upload their own docs
 */

import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import api                    from '../lib/api';
import { useAuth }             from '../hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button }              from '../components/ui/button';
import { Badge }               from '../components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '../components/ui/dialog.tsx';

const DOC_CATEGORIES = [
  { value: 'OFFER_LETTER',        label: 'Offer Letter'        },
  { value: 'APPOINTMENT_LETTER',  label: 'Appointment Letter'  },
  { value: 'EXPERIENCE_LETTER',   label: 'Experience Letter'   },
  { value: 'KYC',                 label: 'KYC'                 },
  { value: 'CONTRACT',            label: 'Contract'            },
  { value: 'PAYSLIP',             label: 'Payslip'             },
  { value: 'OTHER',               label: 'Other'               },
] as const;

const CATEGORY_COLORS: Record<string, string> = {
  OFFER_LETTER: 'bg-blue-100 text-blue-800',
  APPOINTMENT_LETTER: 'bg-purple-100 text-purple-800',
  EXPERIENCE_LETTER: 'bg-green-100 text-green-800',
  KYC: 'bg-amber-100 text-amber-800',
  CONTRACT: 'bg-red-100 text-red-800',
  PAYSLIP: 'bg-teal-100 text-teal-800',
  OTHER: 'bg-gray-100 text-gray-700',
};

interface Employee { id: string; profile: { firstName: string; lastName: string; employeeId: string } | null }
interface Doc {
  id: string; category: string; name: string; fileUrl: string;
  description?: string; createdAt: string;
}

export default function Documents() {
  const { user }              = useAuth();
  const isAdmin               = user?.role === 'ADMIN';
  const queryClient           = useQueryClient();

  const [selectedUserId, setSelectedUserId] = useState<string>('');

  // Upload dialog
  const [showUpload, setShowUpload]   = useState(false);
  const [uploading, setUploading]     = useState(false);
  const [uploadErr, setUploadErr]     = useState('');
  const [form, setForm]               = useState({
    category: 'OTHER', name: '', description: '', fileUrl: '',
  });
  const [uploadingFile, setUploadingFile] = useState(false);

  // Admin employees list
  const { data: employees = [] } = useQuery({
    queryKey: ['employees-list'],
    queryFn: () => api.get<Employee[]>('/employees').then((r) => r.data),
    enabled: isAdmin,
  });

  // Set initial selected user once employees load (admin) or from own id (non-admin)
  useEffect(() => {
    if (isAdmin) {
      if (employees.length > 0 && !selectedUserId) {
        setSelectedUserId(employees[0].id);
      }
    } else {
      setSelectedUserId(user?.id ?? '');
    }
  }, [isAdmin, employees, user?.id]);

  // Docs list for selected user
  const { data: docs = [], isLoading: loadingDocs } = useQuery({
    queryKey: ['documents', selectedUserId],
    queryFn: () => api.get<Doc[]>(`/documents/${selectedUserId}`).then((r) => r.data),
    enabled: !!selectedUserId,
  });

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingFile(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await api.post('/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      setForm((prev) => ({ ...prev, fileUrl: r.data.url, name: prev.name || file.name }));
    } catch {
      setUploadErr('File upload failed');
    } finally {
      setUploadingFile(false);
    }
  }

  async function handleSubmit() {
    if (!form.name || !form.fileUrl) { setUploadErr('Name and file are required'); return; }
    setUploading(true);
    setUploadErr('');
    try {
      await api.post(`/documents/${selectedUserId}`, form);
      setShowUpload(false);
      setForm({ category: 'OTHER', name: '', description: '', fileUrl: '' });
      await queryClient.invalidateQueries({ queryKey: ['documents', selectedUserId] });
    } catch (err: any) {
      setUploadErr(err?.response?.data?.error ?? 'Failed to add document');
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(docId: string) {
    if (!confirm('Delete this document?')) return;
    try {
      await api.delete(`/documents/${docId}`);
      await queryClient.invalidateQueries({ queryKey: ['documents', selectedUserId] });
    } catch {}
  }

  const selectedEmployee = employees.find((e) => e.id === selectedUserId);

  // Group docs by category
  const grouped = DOC_CATEGORIES.map((cat) => ({
    ...cat,
    items: docs.filter((d) => d.category === cat.value),
  })).filter((g) => g.items.length > 0);

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Document Vault</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Manage employee documents by category</p>
        </div>
        <Button onClick={() => { setShowUpload(true); setUploadErr(''); }}>
          + Add Document
        </Button>
      </div>

      {/* Employee selector (Admin only) */}
      {isAdmin && employees.length > 0 && (
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-3">
              <label className="text-sm font-medium text-muted-foreground whitespace-nowrap">Employee:</label>
              <select
                className="border rounded-md px-3 py-1.5 text-sm bg-white flex-1 max-w-xs"
                value={selectedUserId}
                onChange={(e) => setSelectedUserId(e.target.value)}
              >
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.profile?.firstName} {e.profile?.lastName} ({e.profile?.employeeId})
                  </option>
                ))}
              </select>
            </div>
          </CardContent>
        </Card>
      )}

      {loadingDocs && <p className="text-muted-foreground">Loading documents...</p>}

      {!loadingDocs && docs.length === 0 && (
        <Card>
          <CardContent className="pt-8 pb-8 text-center text-muted-foreground">
            No documents uploaded yet.
          </CardContent>
        </Card>
      )}

      {/* Documents grouped by category */}
      {grouped.map((group) => (
        <Card key={group.value}>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${CATEGORY_COLORS[group.value]}`}>
                {group.label}
              </span>
              <span className="text-sm text-muted-foreground font-normal">
                {group.items.length} file{group.items.length !== 1 ? 's' : ''}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {group.items.map((doc) => (
              <div key={doc.id} className="flex items-center justify-between gap-3 border rounded-lg px-4 py-3 hover:bg-gray-50">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">{doc.name}</p>
                  {doc.description && (
                    <p className="text-xs text-muted-foreground truncate">{doc.description}</p>
                  )}
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {new Date(doc.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <a
                    href={doc.fileUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-[#361963] hover:underline font-medium"
                  >
                    View
                  </a>
                  {isAdmin && (
                    <button
                      onClick={() => handleDelete(doc.id)}
                      className="text-xs text-red-500 hover:text-red-700"
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ))}

      {/* Upload dialog */}
      <Dialog open={showUpload} onOpenChange={setShowUpload}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Document</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {isAdmin && selectedEmployee && (
              <p className="text-sm text-muted-foreground">
                For: <strong>{selectedEmployee.profile?.firstName} {selectedEmployee.profile?.lastName}</strong>
              </p>
            )}

            <div>
              <label className="block text-sm font-medium mb-1">Category</label>
              <select
                className="w-full border rounded-md px-3 py-2 text-sm bg-white"
                value={form.category}
                onChange={(e) => setForm((p) => ({ ...p, category: e.target.value }))}
              >
                {DOC_CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Document Name *</label>
              <input
                className="w-full border rounded-md px-3 py-2 text-sm"
                placeholder="e.g. Offer Letter 2024"
                value={form.name}
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Description (optional)</label>
              <input
                className="w-full border rounded-md px-3 py-2 text-sm"
                placeholder="Brief description"
                value={form.description}
                onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">File *</label>
              <input
                type="file"
                className="w-full text-sm"
                accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xlsx"
                onChange={handleFileChange}
                disabled={uploadingFile}
              />
              {uploadingFile && <p className="text-xs text-muted-foreground mt-1">Uploading file...</p>}
              {form.fileUrl && <p className="text-xs text-green-600 mt-1">File uploaded</p>}
            </div>

            {uploadErr && <p className="text-sm text-red-500">{uploadErr}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowUpload(false)}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={uploading || uploadingFile}>
              {uploading ? 'Saving...' : 'Add Document'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
