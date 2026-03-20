/**
 * Athena V3.1 - Companies Page
 * Lists all group companies with headcount, allows OWNER to edit details.
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
import { Building2, Users, Pencil } from 'lucide-react';

interface Company {
  id: string;
  code: string;
  legalName: string;
  displayName: string;
  payrollPrefix: string | null;
  pan: string | null;
  tan: string | null;
  gstin: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  isActive: boolean;
  headcount: number;
}

interface AssignedEmployee {
  id: string;
  email: string;
  role: string;
  profile: {
    firstName: string;
    lastName: string;
    employeeId: string;
    designation: string;
    department: string;
    phone: string | null;
  } | null;
}

export default function Companies() {
  const { user } = useAuth();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCompany, setSelectedCompany] = useState<Company | null>(null);
  const [employees, setEmployees] = useState<AssignedEmployee[]>([]);
  const [loadingEmployees, setLoadingEmployees] = useState(false);
  const [editCompany, setEditCompany] = useState<Company | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get('/companies')
      .then(r => setCompanies(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const viewEmployees = async (company: Company) => {
    setSelectedCompany(company);
    setLoadingEmployees(true);
    try {
      const r = await api.get(`/companies/${company.id}`);
      setEmployees(r.data.assignments?.map((a: any) => a.user) ?? []);
    } catch {
      setEmployees([]);
    } finally {
      setLoadingEmployees(false);
    }
  };

  const handleSaveEdit = async () => {
    if (!editCompany) return;
    setSaving(true);
    try {
      const { id, legalName, displayName, pan, tan, gstin, addressLine1, addressLine2, city, state, pincode } = editCompany;
      await api.patch(`/companies/${id}`, { legalName, displayName, pan, tan, gstin, addressLine1, addressLine2, city, state, pincode });
      setCompanies(prev => prev.map(c => c.id === id ? { ...c, ...editCompany } : c));
      setEditCompany(null);
    } catch {
      alert('Failed to save changes');
    } finally {
      setSaving(false);
    }
  };

  const totalHeadcount = companies.reduce((sum, c) => sum + c.headcount, 0);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Group Companies</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {companies.length} companies &middot; {totalHeadcount} total employees
          </p>
        </div>
      </div>

      {loading ? (
        <p className="text-muted-foreground">Loading companies...</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {companies.map(company => (
            <Card key={company.id} className="hover:shadow-md transition-shadow">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: '#361963' }}>
                      <Building2 className="h-4 w-4 text-white" />
                    </div>
                    <div>
                      <CardTitle className="text-sm font-semibold">{company.displayName}</CardTitle>
                      <p className="text-xs text-muted-foreground font-mono">{company.code}</p>
                    </div>
                  </div>
                  <Badge variant="secondary" className="flex items-center gap-1">
                    <Users className="h-3 w-3" />
                    {company.headcount}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="pt-0 space-y-3">
                <p className="text-xs text-muted-foreground truncate">{company.legalName}</p>
                {company.city && (
                  <p className="text-xs text-muted-foreground">{company.city}{company.state ? `, ${company.state}` : ''}</p>
                )}
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" className="flex-1 text-xs" onClick={() => viewEmployees(company)}>
                    View Employees
                  </Button>
                  {user?.role === 'OWNER' && (
                    <Button size="sm" variant="ghost" className="text-xs" onClick={() => setEditCompany({ ...company })}>
                      <Pencil className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* View Employees Dialog */}
      <Dialog open={!!selectedCompany} onOpenChange={() => setSelectedCompany(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{selectedCompany?.displayName} — Employees</DialogTitle>
          </DialogHeader>
          {loadingEmployees ? (
            <p className="text-muted-foreground py-4">Loading...</p>
          ) : employees.length === 0 ? (
            <p className="text-muted-foreground py-4">No employees assigned to this company.</p>
          ) : (
            <div className="space-y-2">
              {employees.map(emp => (
                <div key={emp.id} className="flex items-center justify-between p-3 rounded-lg border">
                  <div>
                    <p className="text-sm font-medium">
                      {emp.profile?.firstName} {emp.profile?.lastName}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {emp.profile?.employeeId} &middot; {emp.profile?.designation}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-muted-foreground">{emp.profile?.department}</p>
                    <Badge variant="outline" className="text-xs capitalize">{emp.role.toLowerCase()}</Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Edit Company Dialog (OWNER only) */}
      <Dialog open={!!editCompany} onOpenChange={() => setEditCompany(null)}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit {editCompany?.displayName}</DialogTitle>
          </DialogHeader>
          {editCompany && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Legal Name</Label>
                  <Input value={editCompany.legalName} onChange={e => setEditCompany({ ...editCompany, legalName: e.target.value })} />
                </div>
                <div>
                  <Label>Display Name</Label>
                  <Input value={editCompany.displayName} onChange={e => setEditCompany({ ...editCompany, displayName: e.target.value })} />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <Label>PAN</Label>
                  <Input value={editCompany.pan ?? ''} onChange={e => setEditCompany({ ...editCompany, pan: e.target.value || null })} />
                </div>
                <div>
                  <Label>TAN</Label>
                  <Input value={editCompany.tan ?? ''} onChange={e => setEditCompany({ ...editCompany, tan: e.target.value || null })} />
                </div>
                <div>
                  <Label>GSTIN</Label>
                  <Input value={editCompany.gstin ?? ''} onChange={e => setEditCompany({ ...editCompany, gstin: e.target.value || null })} />
                </div>
              </div>
              <div>
                <Label>Address Line 1</Label>
                <Input value={editCompany.addressLine1 ?? ''} onChange={e => setEditCompany({ ...editCompany, addressLine1: e.target.value || null })} />
              </div>
              <div>
                <Label>Address Line 2</Label>
                <Input value={editCompany.addressLine2 ?? ''} onChange={e => setEditCompany({ ...editCompany, addressLine2: e.target.value || null })} />
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <Label>City</Label>
                  <Input value={editCompany.city ?? ''} onChange={e => setEditCompany({ ...editCompany, city: e.target.value || null })} />
                </div>
                <div>
                  <Label>State</Label>
                  <Input value={editCompany.state ?? ''} onChange={e => setEditCompany({ ...editCompany, state: e.target.value || null })} />
                </div>
                <div>
                  <Label>Pincode</Label>
                  <Input value={editCompany.pincode ?? ''} onChange={e => setEditCompany({ ...editCompany, pincode: e.target.value || null })} />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setEditCompany(null)}>Cancel</Button>
                <Button onClick={handleSaveEdit} disabled={saving}>
                  {saving ? 'Saving...' : 'Save Changes'}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
