/**
 * Athena V3.1 - Employee Assignment History Page
 * Shows company assignment timeline for a specific employee.
 * Allows OWNER/ADMIN to initiate inter-company transfers.
 */

import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
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
import { ArrowLeftRight, Building2, ArrowLeft } from 'lucide-react';

interface Company {
  id: string;
  code: string;
  displayName: string;
  legalName?: string;
}

interface Assignment {
  id: string;
  companyId: string;
  company: Company;
  employeeCode: string | null;
  designation: string | null;
  department: string | null;
  annualCTC: number | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  status: 'ACTIVE' | 'TRANSFERRED' | 'CLOSED';
  notes: string | null;
  reportingManager: {
    id: string;
    profile: { firstName: string; lastName: string } | null;
  } | null;
}

interface EmployeeInfo {
  id: string;
  email: string;
  role: string;
  profile: {
    firstName: string;
    lastName: string;
    employeeId: string;
    designation: string;
    department: string;
  } | null;
}

export default function Assignments() {
  const { userId } = useParams<{ userId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [employee, setEmployee] = useState<EmployeeInfo | null>(null);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [showTransfer, setShowTransfer] = useState(false);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [transferring, setTransferring] = useState(false);

  // Transfer form state
  const [toCompanyId, setToCompanyId] = useState('');
  const [effectiveDate, setEffectiveDate] = useState('');
  const [newDesignation, setNewDesignation] = useState('');
  const [newDepartment, setNewDepartment] = useState('');
  const [newCTC, setNewCTC] = useState('');
  const [transferNotes, setTransferNotes] = useState('');

  const fetchData = async () => {
    try {
      const r = await api.get(`/assignments/${userId}`);
      setEmployee(r.data.employee);
      setAssignments(r.data.assignments);
    } catch {
      // pass
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (userId) fetchData();
  }, [userId]);

  const openTransfer = async () => {
    try {
      const r = await api.get('/companies');
      setCompanies(r.data);
    } catch {}
    setShowTransfer(true);
  };

  const handleTransfer = async () => {
    if (!toCompanyId || !effectiveDate) return;
    setTransferring(true);
    try {
      await api.post(`/assignments/${userId}/transfer`, {
        toCompanyId,
        effectiveDate,
        newDesignation: newDesignation || undefined,
        newDepartment: newDepartment || undefined,
        newCTC: newCTC || undefined,
        notes: transferNotes || undefined,
      });
      setShowTransfer(false);
      setToCompanyId('');
      setEffectiveDate('');
      setNewDesignation('');
      setNewDepartment('');
      setNewCTC('');
      setTransferNotes('');
      fetchData();
    } catch (err: any) {
      alert(err.response?.data?.error ?? 'Transfer failed');
    } finally {
      setTransferring(false);
    }
  };

  const activeAssignment = assignments.find(a => a.status === 'ACTIVE');
  const isAdminOrOwner = user?.role === 'ADMIN' || user?.role === 'OWNER';

  const statusColor = (status: string) => {
    switch (status) {
      case 'ACTIVE': return 'bg-green-100 text-green-800';
      case 'TRANSFERRED': return 'bg-blue-100 text-blue-800';
      case 'CLOSED': return 'bg-gray-100 text-gray-800';
      default: return '';
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate('/organization')}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Back
        </Button>
      </div>

      {loading ? (
        <p className="text-muted-foreground">Loading...</p>
      ) : !employee ? (
        <p className="text-muted-foreground">Employee not found.</p>
      ) : (
        <>
          {/* Employee Header */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-semibold">
                {employee.profile?.firstName} {employee.profile?.lastName}
              </h1>
              <p className="text-muted-foreground text-sm">
                {employee.profile?.employeeId} &middot; {employee.profile?.designation} &middot; {employee.email}
              </p>
            </div>
            {isAdminOrOwner && activeAssignment && (
              <Button onClick={openTransfer}>
                <ArrowLeftRight className="h-4 w-4 mr-2" /> Transfer
              </Button>
            )}
          </div>

          {/* Current Assignment */}
          {activeAssignment && (
            <Card className="border-green-300 bg-green-50/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Building2 className="h-4 w-4" />
                  Current Assignment
                  <Badge className={statusColor('ACTIVE')}>ACTIVE</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div>
                    <p className="text-muted-foreground text-xs">Company</p>
                    <p className="font-medium">{activeAssignment.company.displayName}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">Designation</p>
                    <p className="font-medium">{activeAssignment.designation ?? '-'}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">Department</p>
                    <p className="font-medium">{activeAssignment.department ?? '-'}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">CTC</p>
                    <p className="font-medium">
                      {activeAssignment.annualCTC ? `${(activeAssignment.annualCTC / 100000).toFixed(1)}L` : '-'}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">Since</p>
                    <p className="font-medium">{new Date(activeAssignment.effectiveFrom).toLocaleDateString()}</p>
                  </div>
                  {activeAssignment.reportingManager && (
                    <div>
                      <p className="text-muted-foreground text-xs">Manager</p>
                      <p className="font-medium">
                        {activeAssignment.reportingManager.profile?.firstName} {activeAssignment.reportingManager.profile?.lastName}
                      </p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Assignment History */}
          <div>
            <h2 className="text-lg font-semibold mb-3">Assignment History</h2>
            {assignments.length === 0 ? (
              <p className="text-muted-foreground text-sm">No assignments yet.</p>
            ) : (
              <div className="space-y-3">
                {assignments.map((a, i) => (
                  <div key={a.id} className="flex gap-4">
                    {/* Timeline line */}
                    <div className="flex flex-col items-center">
                      <div className={`w-3 h-3 rounded-full ${a.status === 'ACTIVE' ? 'bg-green-500' : 'bg-gray-300'}`} />
                      {i < assignments.length - 1 && <div className="w-0.5 flex-1 bg-gray-200" />}
                    </div>
                    {/* Card */}
                    <Card className="flex-1 mb-0">
                      <CardContent className="py-3">
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm">{a.company.displayName}</span>
                            <Badge className={`text-xs ${statusColor(a.status)}`}>{a.status}</Badge>
                          </div>
                          <span className="text-xs text-muted-foreground">
                            {new Date(a.effectiveFrom).toLocaleDateString()}
                            {a.effectiveTo ? ` — ${new Date(a.effectiveTo).toLocaleDateString()}` : ' — Present'}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {a.designation ?? ''}{a.department ? ` | ${a.department}` : ''}
                          {a.annualCTC ? ` | ${(a.annualCTC / 100000).toFixed(1)}L CTC` : ''}
                        </p>
                        {a.notes && <p className="text-xs text-muted-foreground mt-1 italic">{a.notes}</p>}
                      </CardContent>
                    </Card>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* Transfer Dialog */}
      <Dialog open={showTransfer} onOpenChange={setShowTransfer}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Transfer Employee</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>To Company *</Label>
              <select
                className="w-full border rounded-md px-3 py-2 text-sm"
                value={toCompanyId}
                onChange={e => setToCompanyId(e.target.value)}
              >
                <option value="">Select company...</option>
                {companies
                  .filter(c => c.id !== activeAssignment?.companyId)
                  .map(c => (
                    <option key={c.id} value={c.id}>{c.displayName}</option>
                  ))
                }
              </select>
            </div>
            <div>
              <Label>Effective Date *</Label>
              <Input type="date" value={effectiveDate} onChange={e => setEffectiveDate(e.target.value)} />
            </div>
            <div>
              <Label>New Designation (optional)</Label>
              <Input value={newDesignation} onChange={e => setNewDesignation(e.target.value)} placeholder="Leave blank to keep current" />
            </div>
            <div>
              <Label>New Department (optional)</Label>
              <Input value={newDepartment} onChange={e => setNewDepartment(e.target.value)} placeholder="Leave blank to keep current" />
            </div>
            <div>
              <Label>New CTC (optional)</Label>
              <Input type="number" value={newCTC} onChange={e => setNewCTC(e.target.value)} placeholder="Leave blank to keep current" />
            </div>
            <div>
              <Label>Transfer Notes</Label>
              <Input value={transferNotes} onChange={e => setTransferNotes(e.target.value)} placeholder="Reason for transfer..." />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setShowTransfer(false)}>Cancel</Button>
              <Button onClick={handleTransfer} disabled={transferring || !toCompanyId || !effectiveDate}>
                {transferring ? 'Transferring...' : 'Confirm Transfer'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
