/**
 * Athena V2 - Organization Page (Admin Only)
 * Tab 1: Employee Directory — add, view, deactivate employees
 * Tab 2: Leave Quota Management — set per-employee annual leave totals
 */

import { useState } from 'react';
import { useForm }     from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z }           from 'zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth }     from '@/hooks/useAuth';
import api             from '@/lib/api';
import { formatDate }  from '@/lib/utils';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge }   from '@/components/ui/badge';
import { Button }  from '@/components/ui/button';
import { Input }   from '@/components/ui/input';
import { Label }   from '@/components/ui/label';
import {
  Loader2, Users, Search, Settings2,
  ChevronDown, ChevronUp, Check,
  UserPlus, UserX, Eye, EyeOff, Pencil, TrendingUp, Upload, Download, KeyRound, Copy, X,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Employee {
  id:               string;
  email:            string;
  role:             string;
  employmentStatus?: string;
  profile?: {
    firstName:       string;
    middleName?:     string;
    lastName:        string;
    employeeId:      string;
    designation?:    string;
    department?:     string;
    dateOfJoining?:  string;
    officeLocation?:  string;
    managerId?:       string;
    annualCtc?:       number | null;
    employmentType?:  string;
  };
}

const EMPLOYMENT_STATUS_OPTIONS = [
  { value: 'PENDING_JOIN',      label: 'Pending Join',    color: 'bg-yellow-100 text-yellow-700' },
  { value: 'PROBATION',         label: 'Probation',       color: 'bg-orange-100 text-orange-700' },
  { value: 'INTERNSHIP',        label: 'Internship',      color: 'bg-sky-100 text-sky-700' },
  { value: 'REGULAR_FULL_TIME', label: 'Regular',         color: 'bg-green-100 text-green-700' },
  { value: 'NOTICE_PERIOD',     label: 'Notice Period',   color: 'bg-red-100 text-red-700' },
  { value: 'INACTIVE',          label: 'Inactive',        color: 'bg-gray-100 text-gray-500' },
];

function fullName(profile?: { firstName?: string; middleName?: string; lastName?: string } | null) {
  return [profile?.firstName, profile?.middleName, profile?.lastName].filter(Boolean).join(' ');
}

function getStatusMeta(status?: string) {
  return EMPLOYMENT_STATUS_OPTIONS.find((s) => s.value === status)
    || { value: status || '', label: status || 'Unknown', color: 'bg-gray-100 text-gray-500' };
}

interface LeavePolicy { leaveType: string; label: string; }
interface LeaveBalance { leaveType: string; total: number; used: number; }
interface OverviewUser {
  id:            string;
  profile?:      { firstName: string; middleName?: string; lastName: string; employeeId: string };
  leaveBalances: LeaveBalance[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const ROLE_COLORS: Record<string, string> = {
  ADMIN:    'bg-purple-100 text-purple-700',
  MANAGER:  'bg-blue-100 text-blue-700',
  EMPLOYEE: 'bg-gray-100 text-gray-700',
};

const DEPARTMENTS = [
  'HR & Finance',
  'eWards Marketing',
  'eWards Sales',
  'eWards Developer',
  'eWards Product Analyst',
  'eWards Support',
  'eWards MC',
  'SN Designer',
  'SN Tech',
  'SN Servicing',
  'SN Sales',
  'Second Hugs',
];

// ─── Add Employee form schema ─────────────────────────────────────────────────

const panRegex  = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
const ifscRegex = /^[A-Z]{4}0[A-Z0-9]{6}$/;

const addEmployeeSchema = z.object({
  // Account
  firstName:         z.string().min(1, 'Required'),
  middleName:        z.string().optional(),
  lastName:          z.string().min(1, 'Required'),
  email:             z.string().email('Invalid email'),
  password:          z.string().min(8, 'Minimum 8 characters'),
  employeeId:        z.string().min(1, 'Required'),
  role:              z.enum(['EMPLOYEE', 'MANAGER', 'ADMIN']),
  employmentType:    z.enum(['FULL_TIME', 'INTERN']).default('FULL_TIME'),
  // Employment
  designation:       z.string().min(1, 'Required'),
  department:        z.string().min(1, 'Required'),
  officeLocation:    z.string().optional(),
  dateOfJoining:     z.string().optional(),
  managerId:         z.string().min(1, 'Reporting manager is required'),
  annualCtc:         z.coerce.number().min(1, 'Annual CTC is required'),
  // Personal
  dateOfBirth:       z.string().optional(),
  gender:            z.enum(['Male', 'Female', 'Other', 'Prefer not to say']).optional().or(z.literal('')),
  phone:             z.string().optional(),
  personalEmail:     z.string().email('Invalid email').optional().or(z.literal('')),
  emergencyContact:  z.string().optional(),
  bloodGroup:        z.string().optional(),
  // Statutory
  pan:               z.string().regex(panRegex, 'Format: AAAAA1234A').optional().or(z.literal('')),
  aadharNumber:      z.string().regex(/^\d{12}$/, 'Must be 12 digits').optional().or(z.literal('')),
  uan:               z.string().optional(),
  // Bank
  bankAccountNumber: z.string().min(1, 'Required'),
  ifscCode:          z.string().regex(ifscRegex, 'Format: AAAA0XXXXXX').min(1, 'Required'),
  bankName:          z.string().min(1, 'Required'),
});

type AddEmployeeForm = z.infer<typeof addEmployeeSchema>;

// ─── Leave Quota Row ──────────────────────────────────────────────────────────

function QuotaRow({ user, year, policyTypes }: { user: OverviewUser; year: number; policyTypes: LeavePolicy[] }) {
  const name = user.profile ? fullName(user.profile) : user.id;

  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving]     = useState(false);
  const [saved, setSaved]       = useState(false);
  const [form, setForm]         = useState<Record<string, number>>(() => {
    const init: Record<string, number> = {};
    policyTypes.forEach((p) => {
      const b = user.leaveBalances.find((x) => x.leaveType === p.leaveType);
      init[p.leaveType] = b?.total ?? 0;
    });
    return init;
  });

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.put(`/leave-balance/${user.id}`, { year, ...form });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      alert('Failed to save quotas');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="border rounded-lg overflow-hidden">
      <button
        className="w-full flex items-center gap-4 px-4 py-3 hover:bg-muted/40 transition-colors text-left"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">{name}</p>
          <p className="text-xs text-muted-foreground font-mono">{user.profile?.employeeId}</p>
        </div>
        <div className="hidden md:flex items-center gap-2">
          {policyTypes.map((p) => p.leaveType).map((lt) => {
            const b    = user.leaveBalances.find((x) => x.leaveType === lt);
            const left = b ? Math.max(b.total - b.used, 0) : 0;
            const isLow = b && left <= 2 && b.total > 0;
            return (
              <span
                key={lt}
                className="text-xs px-2 py-0.5 rounded-full font-medium"
                style={{
                  backgroundColor: isLow ? '#fee2e2' : '#f3f0fa',
                  color:           isLow ? '#b91c1c' : '#361963',
                }}
              >
                {policyTypes.find((p) => p.leaveType === lt)?.label ?? lt}: {left}/{b?.total ?? 0}
              </span>
            );
          })}
        </div>
        {expanded
          ? <ChevronUp   className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          : <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />}
      </button>

      {expanded && (
        <div className="border-t px-4 py-4 bg-muted/20">
          <p className="text-xs text-muted-foreground mb-3 font-medium">
            Set annual leave totals for {name} ({year})
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 mb-4">
            {policyTypes.map((p) => {
              const lt = p.leaveType;
              const b = user.leaveBalances.find((x) => x.leaveType === lt);
              return (
                <div key={lt} className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">
                    {policyTypes.find((pt) => pt.leaveType === lt)?.label ?? lt}
                    {b && <span className="ml-1 text-[10px] text-muted-foreground/70">({b.used} used)</span>}
                  </Label>
                  <Input
                    type="number" min={0} max={365}
                    value={form[lt]}
                    onChange={(e) => setForm((prev) => ({ ...prev, [lt]: Number(e.target.value) }))}
                    className="h-9 text-sm"
                  />
                </div>
              );
            })}
          </div>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={saving}
            style={{ backgroundColor: saved ? '#16a34a' : '#361963' }}
            className="text-white"
          >
            {saving ? <><Loader2 className="h-3 w-3 mr-2 animate-spin" />Saving…</>
              : saved ? <><Check className="h-3 w-3 mr-2" />Saved!</>
              : 'Save Quotas'}
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function Organization() {
  const { user: currentUser }   = useAuth();
  const queryClient             = useQueryClient();
  const [search, setSearch]     = useState('');

  // Employment status change state
  const [statusEmp,      setStatusEmp]      = useState<Employee | null>(null);
  const [newStatus,      setNewStatus]      = useState('');
  const [savingStatus,   setSavingStatus]   = useState(false);
  const [statusError,    setStatusError]    = useState('');


  // Add employee state
  const [showAddForm, setShowAddForm]   = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Deactivate state
  const [deactivatingId, setDeactivatingId] = useState<string | null>(null);

  // Edit employee state
  const [editingEmp, setEditingEmp]     = useState<Employee | null>(null);
  const [editDraft, setEditDraft]       = useState<Record<string, string>>({});
  const [savingEdit, setSavingEdit]     = useState(false);
  const [editError, setEditError]       = useState('');

  // Salary revision history state
  const [salRevEmp,      setSalRevEmp]      = useState<Employee | null>(null);
  const [salRevisions,   setSalRevisions]   = useState<any[]>([]);
  const [loadingSalRev,  setLoadingSalRev]  = useState(false);

  // Reset password state
  const [resettingPwdId, setResettingPwdId] = useState<string | null>(null);
  const [resetResult,    setResetResult]    = useState<{ empName: string; tempPassword: string } | null>(null);
  const [copiedPwd,      setCopiedPwd]      = useState(false);

  // Bulk import state
  const [showImport,    setShowImport]    = useState(false);
  const [importFile,    setImportFile]    = useState<File | null>(null);
  const [importing,     setImporting]     = useState(false);
  const [importResults, setImportResults] = useState<any | null>(null);

  const {
    register, handleSubmit, reset,
    formState: { errors, isSubmitting },
  } = useForm<AddEmployeeForm>({
    resolver: zodResolver(addEmployeeSchema),
    defaultValues: { role: 'EMPLOYEE' },
  });

  const { data: employees = [], isLoading: loading } = useQuery({
    queryKey: ['employees'],
    queryFn: () => api.get<Employee[]>('/employees').then(({ data }) => data),
  });

  const fetchEmployees = () => queryClient.invalidateQueries({ queryKey: ['employees'] });


  // ── Add Employee ──
  const onAddEmployee = async (data: AddEmployeeForm) => {
    try {
      await api.post('/employees', {
        ...data,
        dateOfJoining: data.dateOfJoining || undefined,
      });
      reset();
      setShowAddForm(false);
      setShowPassword(false);
      fetchEmployees();
    } catch (err: any) {
      alert(err?.response?.data?.error || 'Failed to add employee');
    }
  };

  // ── Deactivate Employee ──
  const handleDeactivate = async (emp: Employee) => {
    const name = emp.profile
      ? fullName(emp.profile)
      : emp.email;

    if (!confirm(`Deactivate ${name}?\n\nThis will disable their login and hide them from the directory. This cannot be undone from the UI.`)) return;

    setDeactivatingId(emp.id);
    try {
      await api.delete(`/employees/${emp.id}`);
      await queryClient.invalidateQueries({ queryKey: ['employees'] });
    } catch (err: any) {
      alert(err?.response?.data?.error || 'Failed to deactivate employee');
    } finally {
      setDeactivatingId(null);
    }
  };

  // ── Reset Password ──
  const handleResetPassword = async (emp: Employee) => {
    const name = emp.profile ? fullName(emp.profile) : emp.email;
    if (!confirm(`Reset password for ${name}?\n\nA temporary password will be generated. Share it with the employee so they can log in and set a new one.`)) return;
    setResettingPwdId(emp.id);
    try {
      const { data } = await api.post<{ tempPassword: string }>(`/auth/reset-password/${emp.id}`);
      setResetResult({ empName: name, tempPassword: data.tempPassword });
    } catch (err: any) {
      alert(err?.response?.data?.error || 'Failed to reset password');
    } finally {
      setResettingPwdId(null);
    }
  };

  // ── Edit Employee ──
  const openEdit = (emp: Employee) => {
    setShowAddForm(false);
    setEditError('');
    setEditingEmp(emp);
    const p = emp.profile as any;
    setEditDraft({
      firstName:         p?.firstName      ?? '',
      middleName:        p?.middleName     ?? '',
      lastName:          p?.lastName       ?? '',
      employeeId:        p?.employeeId     ?? '',
      email:             emp.email,
      role:              emp.role,
      employmentType:    p?.employmentType ?? 'FULL_TIME',
      // Employment
      designation:       p?.designation    ?? '',
      department:        p?.department     ?? '',
      officeLocation:    p?.officeLocation ?? '',
      dateOfJoining:     p?.dateOfJoining  ? new Date(p.dateOfJoining).toISOString().split('T')[0]  : '',
      managerId:         p?.managerId      ?? '',
      annualCtc:         p?.annualCtc != null ? String(p.annualCtc) : '',
      // Personal
      dateOfBirth:       p?.dateOfBirth    ? new Date(p.dateOfBirth).toISOString().split('T')[0] : '',
      gender:            p?.gender         ?? '',
      phone:             p?.phone          ?? '',
      personalEmail:     p?.personalEmail  ?? '',
      emergencyContact:  p?.emergencyContact ?? '',
      bloodGroup:        p?.bloodGroup     ?? '',
      // Statutory
      pan:               p?.pan            ?? '',
      aadharNumber:      p?.aadharNumber   ?? '',
      uan:               p?.uan            ?? '',
      // Bank
      bankAccountNumber: p?.bankAccountNumber ?? '',
      ifscCode:          p?.ifscCode          ?? '',
      bankName:          p?.bankName          ?? '',
    });
  };

  const handleSaveEdit = async () => {
    if (!editingEmp) return;
    setEditError('');
    setSavingEdit(true);
    try {
      await api.put(`/employees/${editingEmp.id}`, {
        firstName:         editDraft.firstName         || undefined,
        middleName:        editDraft.middleName        || undefined,
        lastName:          editDraft.lastName          || undefined,
        employeeId:        editDraft.employeeId        || undefined,
        email:             editDraft.email             || undefined,
        role:              editDraft.role              || undefined,
        employmentType:    editDraft.employmentType    || undefined,
        designation:       editDraft.designation       || undefined,
        department:        editDraft.department        || undefined,
        officeLocation:    editDraft.officeLocation    || undefined,
        dateOfJoining:     editDraft.dateOfJoining     || undefined,
        managerId:         editDraft.managerId         || undefined,
        annualCtc:         editDraft.annualCtc ? parseFloat(editDraft.annualCtc) : undefined,
        dateOfBirth:       editDraft.dateOfBirth       || undefined,
        gender:            editDraft.gender            || undefined,
        phone:             editDraft.phone             || undefined,
        personalEmail:     editDraft.personalEmail     || undefined,
        emergencyContact:  editDraft.emergencyContact  || undefined,
        bloodGroup:        editDraft.bloodGroup        || undefined,
        pan:               editDraft.pan               || undefined,
        aadharNumber:      editDraft.aadharNumber      || undefined,
        uan:               editDraft.uan               || undefined,
        bankAccountNumber: editDraft.bankAccountNumber || undefined,
        ifscCode:          editDraft.ifscCode          || undefined,
        bankName:          editDraft.bankName          || undefined,
      });
      setEditingEmp(null);
      fetchEmployees();
    } catch (err: any) {
      setEditError(err?.response?.data?.error || 'Failed to save changes');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleStatusChange = async () => {
    if (!statusEmp || !newStatus) return;
    setSavingStatus(true);
    setStatusError('');
    try {
      await api.patch(`/employees/${statusEmp.id}/status`, { employmentStatus: newStatus });
      await queryClient.invalidateQueries({ queryKey: ['employees'] });
      setStatusEmp(null);
      setNewStatus('');
    } catch (err: any) {
      setStatusError(err?.response?.data?.error || 'Failed to update status');
    } finally {
      setSavingStatus(false);
    }
  };

  // Open salary revision history for an employee
  const openSalRev = async (emp: Employee) => {
    setSalRevEmp(emp);
    setSalRevisions([]);
    setLoadingSalRev(true);
    try {
      const r = await api.get(`/salary-revisions/${emp.id}`);
      setSalRevisions(r.data);
    } catch { /* ignore */ }
    finally { setLoadingSalRev(false); }
  };

  // Bulk import
  const handleImport = async () => {
    if (!importFile) return;
    setImporting(true);
    setImportResults(null);
    try {
      const fd = new FormData();
      fd.append('file', importFile);
      const r = await api.post('/employees/import', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      setImportResults(r.data);
      fetchEmployees();
    } catch (err: any) {
      setImportResults({ error: err?.response?.data?.error || 'Import failed' });
    } finally {
      setImporting(false);
    }
  };

  const filtered = employees.filter((emp) => {
    const q = search.toLowerCase();
    return (
      emp.profile?.firstName?.toLowerCase().includes(q) ||
      emp.profile?.middleName?.toLowerCase().includes(q) ||
      emp.profile?.lastName?.toLowerCase().includes(q) ||
      emp.profile?.employeeId?.toLowerCase().includes(q) ||
      emp.profile?.department?.toLowerCase().includes(q) ||
      emp.email?.toLowerCase().includes(q)
    );
  });

  // Managers available for reporting-manager dropdown
  const managers = employees.filter((e) => e.role === 'MANAGER' || e.role === 'ADMIN');

  return (
    <div className="space-y-6 max-w-6xl">

      {/* ── Header ── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Organization</h1>
          <p className="text-muted-foreground text-sm">Employee directory</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5 text-muted-foreground text-sm">
            <Users className="h-4 w-4" />
            {employees.length} active employees
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => { setShowImport(true); setImportFile(null); setImportResults(null); }}
            >
              <Upload className="h-4 w-4 mr-2" />
              Bulk Import
            </Button>
            <Button
              onClick={() => { setShowAddForm((v) => !v); reset(); setShowPassword(false); }}
              style={{ backgroundColor: '#361963' }}
              className="text-white"
            >
              <UserPlus className="h-4 w-4 mr-2" />
              Add Employee
            </Button>
          </div>
        </div>
      </div>

          {/* ── Add Employee Form ── */}
          {showAddForm && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">New Employee Account</CardTitle>
                <CardDescription>
                  Creates a login account and profile. The employee can update their own details after first login.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form
                  onSubmit={handleSubmit(onAddEmployee)}
                  className="grid grid-cols-1 md:grid-cols-3 gap-4"
                >
                  {/* Row 1 — Name + Employee ID */}
                  <div className="space-y-2">
                    <Label htmlFor="firstName">First Name <span className="text-destructive">*</span></Label>
                    <Input id="firstName" placeholder="Rahul" {...register('firstName')} />
                    {errors.firstName && <p className="text-xs text-destructive">{errors.firstName.message}</p>}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="middleName">Middle Name</Label>
                    <Input id="middleName" placeholder="Kumar" {...register('middleName')} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="lastName">Last Name <span className="text-destructive">*</span></Label>
                    <Input id="lastName" placeholder="Verma" {...register('lastName')} />
                    {errors.lastName && <p className="text-xs text-destructive">{errors.lastName.message}</p>}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="employeeId">Employee ID <span className="text-destructive">*</span></Label>
                    <Input id="employeeId" placeholder="EWD-005" className="font-mono" {...register('employeeId')} />
                    {errors.employeeId && <p className="text-xs text-destructive">{errors.employeeId.message}</p>}
                  </div>

                  {/* Row 2 — Email + Password + Role */}
                  <div className="space-y-2 md:col-span-2">
                    <Label htmlFor="email">Work Email <span className="text-destructive">*</span></Label>
                    <Input id="email" type="email" placeholder="rahul@ewards.com" {...register('email')} />
                    {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="password">Temporary Password <span className="text-destructive">*</span></Label>
                    <div className="relative">
                      <Input
                        id="password"
                        type={showPassword ? 'text' : 'password'}
                        placeholder="Min. 8 characters"
                        className="pr-9"
                        {...register('password')}
                      />
                      <button
                        type="button"
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        onClick={() => setShowPassword((v) => !v)}
                      >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                    {errors.password && <p className="text-xs text-destructive">{errors.password.message}</p>}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="role">Role <span className="text-destructive">*</span></Label>
                    <select
                      id="role"
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      {...register('role')}
                    >
                      <option value="EMPLOYEE">Employee</option>
                      <option value="MANAGER">Manager</option>
                      <option value="ADMIN">Admin</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="employmentType">Status <span className="text-destructive">*</span></Label>
                    <select
                      id="employmentType"
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      {...register('employmentType')}
                    >
                      <option value="FULL_TIME">Full Time</option>
                      <option value="INTERN">Intern</option>
                    </select>
                  </div>

                  {/* Row 3 — Department + Designation + Joining Date */}
                  <div className="space-y-2">
                    <Label htmlFor="department">Department <span className="text-destructive">*</span></Label>
                    <select
                      id="department"
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      {...register('department')}
                    >
                      <option value="">— Select department —</option>
                      {DEPARTMENTS.map((d) => (
                        <option key={d} value={d}>{d}</option>
                      ))}
                    </select>
                    {errors.department && <p className="text-xs text-destructive">{errors.department.message}</p>}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="designation">Designation <span className="text-destructive">*</span></Label>
                    <Input id="designation" placeholder="Software Engineer" {...register('designation')} />
                    {errors.designation && <p className="text-xs text-destructive">{errors.designation.message}</p>}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="officeLocation">Office Location</Label>
                    <Input id="officeLocation" placeholder="Kolkata" {...register('officeLocation')} />
                  </div>

                  {/* Row 4 — Dates + Manager + CTC */}
                  <div className="space-y-2">
                    <Label htmlFor="dateOfJoining">Date of Joining</Label>
                    <Input id="dateOfJoining" type="date" {...register('dateOfJoining')} />
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label htmlFor="managerId">Reporting Manager <span className="text-destructive">*</span></Label>
                    <select
                      id="managerId"
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      {...register('managerId')}
                    >
                      <option value="">— Select manager —</option>
                      {managers.map((m) => (
                        <option key={m.id} value={m.id}>
                          {fullName(m.profile)}
                          {m.profile?.employeeId ? ` (${m.profile.employeeId})` : ''} — {m.role}
                        </option>
                      ))}
                    </select>
                    {errors.managerId && <p className="text-xs text-destructive">{errors.managerId.message}</p>}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="annualCtc">Annual Gross CTC (₹) <span className="text-destructive">*</span></Label>
                    <Input id="annualCtc" type="number" min={0} placeholder="e.g. 600000" {...register('annualCtc')} />
                    {errors.annualCtc && <p className="text-xs text-destructive">{errors.annualCtc.message}</p>}
                  </div>

                  {/* Divider — Personal Details */}
                  <div className="md:col-span-3 pt-2 pb-1 border-t">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Personal Details</p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="dateOfBirth">Date of Birth</Label>
                    <Input id="dateOfBirth" type="date" {...register('dateOfBirth')} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="gender">Gender</Label>
                    <select
                      id="gender"
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      {...register('gender')}
                    >
                      <option value="">— Select —</option>
                      <option value="Male">Male</option>
                      <option value="Female">Female</option>
                      <option value="Other">Other</option>
                      <option value="Prefer not to say">Prefer not to say</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="bloodGroup">Blood Group</Label>
                    <Input id="bloodGroup" placeholder="e.g. O+" {...register('bloodGroup')} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="phone">Phone Number</Label>
                    <Input id="phone" placeholder="+91-9876543210" {...register('phone')} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="personalEmail">Personal Email</Label>
                    <Input id="personalEmail" type="email" placeholder="personal@gmail.com" {...register('personalEmail')} />
                    {errors.personalEmail && <p className="text-xs text-destructive">{errors.personalEmail.message}</p>}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="emergencyContact">Emergency Contact</Label>
                    <Input id="emergencyContact" placeholder="+91-9876543210" {...register('emergencyContact')} />
                  </div>

                  {/* Divider — Statutory */}
                  <div className="md:col-span-3 pt-2 pb-1 border-t">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Statutory Compliance</p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="pan">PAN Number</Label>
                    <Input id="pan" placeholder="ABRPS1234A" className="font-mono uppercase" {...register('pan')} />
                    {errors.pan && <p className="text-xs text-destructive">{errors.pan.message}</p>}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="aadharNumber">Aadhar Number</Label>
                    <Input id="aadharNumber" placeholder="123456789012" className="font-mono" {...register('aadharNumber')} />
                    {errors.aadharNumber && <p className="text-xs text-destructive">{errors.aadharNumber.message}</p>}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="uan">UAN (PF)</Label>
                    <Input id="uan" placeholder="100123456789" className="font-mono" {...register('uan')} />
                  </div>

                  {/* Divider — Bank Details */}
                  <div className="md:col-span-3 pt-2 pb-1 border-t">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Bank Details</p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="bankAccountNumber">Account Number <span className="text-destructive">*</span></Label>
                    <Input id="bankAccountNumber" placeholder="e.g. 001234567890" className="font-mono" {...register('bankAccountNumber')} />
                    {errors.bankAccountNumber && <p className="text-xs text-destructive">{errors.bankAccountNumber.message}</p>}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="ifscCode">IFSC Code <span className="text-destructive">*</span></Label>
                    <Input id="ifscCode" placeholder="e.g. HDFC0001234" className="uppercase font-mono" {...register('ifscCode')} />
                    {errors.ifscCode && <p className="text-xs text-destructive">{errors.ifscCode.message}</p>}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="bankName">Bank Name <span className="text-destructive">*</span></Label>
                    <Input id="bankName" placeholder="e.g. HDFC Bank" {...register('bankName')} />
                    {errors.bankName && <p className="text-xs text-destructive">{errors.bankName.message}</p>}
                  </div>

                  {/* Actions */}
                  <div className="md:col-span-3 flex gap-2 pt-1">
                    <Button
                      type="submit"
                      disabled={isSubmitting}
                      style={{ backgroundColor: '#361963' }}
                      className="text-white"
                    >
                      {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      Create Employee
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => { setShowAddForm(false); reset(); setShowPassword(false); }}
                    >
                      Cancel
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          )}

          {/* ── Edit Employee Form ── */}
          {editingEmp && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  Edit — {fullName(editingEmp.profile)}
                  <span className="ml-2 text-sm font-normal text-muted-foreground font-mono">
                    {editingEmp.profile?.employeeId}
                  </span>
                </CardTitle>
                <CardDescription>Changes are saved immediately to the employee's profile.</CardDescription>
              </CardHeader>
              <CardContent>
                {/* Error banner */}
                {editError && (
                  <div className="mb-4 rounded-md bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">
                    {editError}
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {/* Name */}
                  <div className="space-y-2">
                    <Label>First Name</Label>
                    <Input
                      value={editDraft.firstName}
                      onChange={(e) => setEditDraft((p) => ({ ...p, firstName: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Middle Name</Label>
                    <Input
                      value={editDraft.middleName}
                      onChange={(e) => setEditDraft((p) => ({ ...p, middleName: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Last Name</Label>
                    <Input
                      value={editDraft.lastName}
                      onChange={(e) => setEditDraft((p) => ({ ...p, lastName: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Employee ID</Label>
                    <Input
                      className="font-mono"
                      value={editDraft.employeeId}
                      onChange={(e) => { setEditError(''); setEditDraft((p) => ({ ...p, employeeId: e.target.value })); }}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Work Email</Label>
                    <Input
                      type="email"
                      value={editDraft.email}
                      onChange={(e) => { setEditError(''); setEditDraft((p) => ({ ...p, email: e.target.value })); }}
                    />
                  </div>
                  <div className="space-y-2 md:col-span-2" /> {/* spacer */}

                  <div className="space-y-2">
                    <Label>Role</Label>
                    <select
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      value={editDraft.role}
                      onChange={(e) => setEditDraft((p) => ({ ...p, role: e.target.value }))}
                    >
                      <option value="EMPLOYEE">Employee</option>
                      <option value="MANAGER">Manager</option>
                      <option value="ADMIN">Admin</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label>Status</Label>
                    <select
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      value={editDraft.employmentType}
                      onChange={(e) => setEditDraft((p) => ({ ...p, employmentType: e.target.value }))}
                    >
                      <option value="FULL_TIME">Full Time</option>
                      <option value="INTERN">Intern</option>
                    </select>
                  </div>

                  {/* Employment */}
                  <div className="space-y-2">
                    <Label>Designation</Label>
                    <Input
                      placeholder="Software Engineer"
                      value={editDraft.designation}
                      onChange={(e) => setEditDraft((p) => ({ ...p, designation: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Department</Label>
                    <select
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      value={editDraft.department}
                      onChange={(e) => setEditDraft((p) => ({ ...p, department: e.target.value }))}
                    >
                      <option value="">— Select department —</option>
                      {DEPARTMENTS.map((d) => (
                        <option key={d} value={d}>{d}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label>Office Location</Label>
                    <Input
                      placeholder="Kolkata"
                      value={editDraft.officeLocation}
                      onChange={(e) => setEditDraft((p) => ({ ...p, officeLocation: e.target.value }))}
                    />
                  </div>

                  {/* Personal details (admin-editable) */}
                  <div className="space-y-2">
                    <Label>Gender</Label>
                    <select
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      value={editDraft.gender}
                      onChange={(e) => setEditDraft((p) => ({ ...p, gender: e.target.value }))}
                    >
                      <option value="">— Select —</option>
                      <option value="Male">Male</option>
                      <option value="Female">Female</option>
                      <option value="Other">Other</option>
                      <option value="Prefer not to say">Prefer not to say</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label>Date of Birth</Label>
                    <Input
                      type="date"
                      value={editDraft.dateOfBirth}
                      onChange={(e) => setEditDraft((p) => ({ ...p, dateOfBirth: e.target.value }))}
                    />
                  </div>

                  {/* Date of Joining + Manager + CTC */}
                  <div className="space-y-2">
                    <Label>Date of Joining</Label>
                    <Input
                      type="date"
                      value={editDraft.dateOfJoining}
                      onChange={(e) => setEditDraft((p) => ({ ...p, dateOfJoining: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Annual Gross CTC (₹)</Label>
                    <Input
                      type="number" min={0} placeholder="e.g. 600000"
                      value={editDraft.annualCtc ?? ''}
                      onChange={(e) => setEditDraft((p) => ({ ...p, annualCtc: e.target.value }))}
                    />
                    <p className="text-xs text-muted-foreground">Used for payroll calculation</p>
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label>Reporting Manager</Label>
                    <select
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      value={editDraft.managerId}
                      onChange={(e) => setEditDraft((p) => ({ ...p, managerId: e.target.value }))}
                    >
                      <option value="">— No manager assigned —</option>
                      {managers
                        .filter((m) => m.id !== editingEmp.id)
                        .map((m) => (
                          <option key={m.id} value={m.id}>
                            {fullName(m.profile)}
                            {m.profile?.employeeId ? ` (${m.profile.employeeId})` : ''} — {m.role}
                          </option>
                        ))}
                    </select>
                  </div>

                  {/* Divider — Personal Details */}
                  <div className="md:col-span-3 pt-2 pb-1 border-t">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Personal Details</p>
                  </div>
                  <div className="space-y-2">
                    <Label>Date of Birth</Label>
                    <Input
                      type="date"
                      value={editDraft.dateOfBirth}
                      onChange={(e) => setEditDraft((p) => ({ ...p, dateOfBirth: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Gender</Label>
                    <select
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      value={editDraft.gender}
                      onChange={(e) => setEditDraft((p) => ({ ...p, gender: e.target.value }))}
                    >
                      <option value="">— Select —</option>
                      <option value="Male">Male</option>
                      <option value="Female">Female</option>
                      <option value="Other">Other</option>
                      <option value="Prefer not to say">Prefer not to say</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label>Blood Group</Label>
                    <Input
                      placeholder="e.g. O+"
                      value={editDraft.bloodGroup}
                      onChange={(e) => setEditDraft((p) => ({ ...p, bloodGroup: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Phone Number</Label>
                    <Input
                      placeholder="+91-9876543210"
                      value={editDraft.phone}
                      onChange={(e) => setEditDraft((p) => ({ ...p, phone: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Personal Email</Label>
                    <Input
                      type="email" placeholder="personal@gmail.com"
                      value={editDraft.personalEmail}
                      onChange={(e) => setEditDraft((p) => ({ ...p, personalEmail: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Emergency Contact</Label>
                    <Input
                      placeholder="+91-9876543210"
                      value={editDraft.emergencyContact}
                      onChange={(e) => setEditDraft((p) => ({ ...p, emergencyContact: e.target.value }))}
                    />
                  </div>

                  {/* Divider — Statutory */}
                  <div className="md:col-span-3 pt-2 pb-1 border-t">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Statutory Compliance</p>
                  </div>
                  <div className="space-y-2">
                    <Label>PAN Number</Label>
                    <Input
                      placeholder="ABRPS1234A" className="font-mono uppercase"
                      value={editDraft.pan}
                      onChange={(e) => setEditDraft((p) => ({ ...p, pan: e.target.value.toUpperCase() }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Aadhar Number</Label>
                    <Input
                      placeholder="123456789012" className="font-mono"
                      value={editDraft.aadharNumber}
                      onChange={(e) => setEditDraft((p) => ({ ...p, aadharNumber: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>UAN (PF)</Label>
                    <Input
                      placeholder="100123456789" className="font-mono"
                      value={editDraft.uan}
                      onChange={(e) => setEditDraft((p) => ({ ...p, uan: e.target.value }))}
                    />
                  </div>

                  {/* Divider — Bank Details */}
                  <div className="md:col-span-3 pt-2 pb-1 border-t">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Bank Details</p>
                  </div>
                  <div className="space-y-2">
                    <Label>Account Number</Label>
                    <Input
                      placeholder="001234567890" className="font-mono"
                      value={editDraft.bankAccountNumber}
                      onChange={(e) => setEditDraft((p) => ({ ...p, bankAccountNumber: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>IFSC Code</Label>
                    <Input
                      placeholder="HDFC0001234" className="font-mono uppercase"
                      value={editDraft.ifscCode}
                      onChange={(e) => setEditDraft((p) => ({ ...p, ifscCode: e.target.value.toUpperCase() }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Bank Name</Label>
                    <Input
                      placeholder="HDFC Bank"
                      value={editDraft.bankName}
                      onChange={(e) => setEditDraft((p) => ({ ...p, bankName: e.target.value }))}
                    />
                  </div>

                  {/* Actions */}
                  <div className="md:col-span-3 flex gap-2 pt-1">
                    <Button
                      disabled={savingEdit}
                      style={{ backgroundColor: '#361963' }}
                      className="text-white"
                      onClick={handleSaveEdit}
                    >
                      {savingEdit && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      Save Changes
                    </Button>
                    <Button variant="outline" onClick={() => { setEditingEmp(null); setEditError(''); }}>
                      Cancel
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* ── Search ── */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by name, ID, department, or email..."
              className="pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {/* ── Directory Table ── */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Employee Directory</CardTitle>
              <CardDescription>
                {filtered.length} {filtered.length === 1 ? 'employee' : 'employees'} found
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : filtered.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">No employees found.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-muted-foreground">
                        <th className="text-left pb-3 pr-4 font-medium">Employee</th>
                        <th className="text-left pb-3 pr-4 font-medium">ID</th>
                        <th className="text-left pb-3 pr-4 font-medium">Department</th>
                        <th className="text-left pb-3 pr-4 font-medium">Designation</th>
                        <th className="text-left pb-3 pr-4 font-medium">Joined</th>
                        <th className="text-left pb-3 pr-4 font-medium">Annual CTC</th>
                        <th className="text-left pb-3 pr-4 font-medium">Role</th>
                        <th className="text-left pb-3 pr-4 font-medium">Type</th>
                        <th className="text-left pb-3 pr-4 font-medium">Lifecycle</th>
                        <th className="pb-3 font-medium w-10" />
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((emp) => {
                        const isSelf        = emp.id === currentUser?.id;
                        const isDeactivating = deactivatingId === emp.id;
                        return (
                          <tr key={emp.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                            <td className="py-3 pr-4">
                              <p className="font-medium">
                                {fullName(emp.profile)}
                              </p>
                              <p className="text-xs text-muted-foreground">{emp.email}</p>
                            </td>
                            <td className="py-3 pr-4 font-mono text-xs">{emp.profile?.employeeId || '—'}</td>
                            <td className="py-3 pr-4">{emp.profile?.department || '—'}</td>
                            <td className="py-3 pr-4">{emp.profile?.designation || '—'}</td>
                            <td className="py-3 pr-4 text-muted-foreground">
                              {emp.profile?.dateOfJoining ? formatDate(emp.profile.dateOfJoining) : '—'}
                            </td>
                            <td className="py-3 pr-4">
                              {emp.profile?.annualCtc != null ? (
                                <span className="text-sm font-medium" style={{ color: '#361963' }}>
                                  ₹{emp.profile.annualCtc.toLocaleString('en-IN')}
                                </span>
                              ) : (
                                <span className="text-xs text-muted-foreground">Not set</span>
                              )}
                            </td>
                            <td className="py-3 pr-4">
                              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${ROLE_COLORS[emp.role] || ''}`}>
                                {emp.role}
                              </span>
                            </td>
                            <td className="py-3 pr-4">
                              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                                emp.profile?.employmentType === 'INTERN'
                                  ? 'bg-amber-100 text-amber-700'
                                  : 'bg-green-100 text-green-700'
                              }`}>
                                {emp.profile?.employmentType === 'INTERN' ? 'Intern' : 'Full Time'}
                              </span>
                            </td>
                            <td className="py-3 pr-4">
                              {(() => {
                                const meta = getStatusMeta(emp.employmentStatus);
                                return (
                                  <button
                                    onClick={() => { setStatusEmp(emp); setNewStatus(emp.employmentStatus || 'REGULAR_FULL_TIME'); setStatusError(''); }}
                                    className={`text-xs font-medium px-2 py-0.5 rounded-full cursor-pointer hover:opacity-80 ${meta.color}`}
                                    title="Click to change status"
                                  >
                                    {meta.label}
                                  </button>
                                );
                              })()}
                            </td>
                            <td className="py-3 text-right">
                              <div className="flex items-center justify-end gap-1">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 w-7 p-0 text-muted-foreground hover:text-[#361963]"
                                  onClick={() => openSalRev(emp)}
                                  title="Salary revision history"
                                >
                                  <TrendingUp className="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className={`h-7 w-7 p-0 ${editingEmp?.id === emp.id ? 'text-[#361963]' : 'text-muted-foreground hover:text-[#361963]'}`}
                                  onClick={() => editingEmp?.id === emp.id ? setEditingEmp(null) : openEdit(emp)}
                                  title="Edit employee"
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 w-7 p-0 text-muted-foreground hover:text-amber-600"
                                  disabled={resettingPwdId === emp.id}
                                  onClick={() => handleResetPassword(emp)}
                                  title="Reset password"
                                >
                                  {resettingPwdId === emp.id
                                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    : <KeyRound className="h-3.5 w-3.5" />}
                                </Button>
                                {!isSelf && (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                                    disabled={isDeactivating}
                                    onClick={() => handleDeactivate(emp)}
                                    title="Deactivate employee"
                                  >
                                    {isDeactivating
                                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                      : <UserX className="h-3.5 w-3.5" />}
                                  </Button>
                                )}
                              </div>
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

      {/* Employment Status Change Modal */}
      {statusEmp && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <Card className="w-full max-w-sm">
            <CardHeader>
              <CardTitle className="text-base">Change Employment Status</CardTitle>
              <CardDescription>
                {fullName(statusEmp.profile)} ({statusEmp.profile?.employeeId})
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label>New Status</Label>
                <select
                  value={newStatus}
                  onChange={(e) => setNewStatus(e.target.value)}
                  className="w-full border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#361963]"
                >
                  {EMPLOYMENT_STATUS_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
              {statusError && <p className="text-xs text-red-600">{statusError}</p>}
              <div className="flex gap-2 justify-end">
                <Button variant="outline" size="sm" onClick={() => { setStatusEmp(null); setStatusError(''); }}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  disabled={savingStatus || newStatus === statusEmp.employmentStatus}
                  onClick={handleStatusChange}
                  style={{ backgroundColor: '#361963' }}
                >
                  {savingStatus ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
                  Update Status
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}


      {/* ── Salary Revision History Modal ── */}
      {salRevEmp && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <Card className="w-full max-w-lg max-h-[90vh] flex flex-col">
            <CardHeader className="flex-shrink-0">
              <div className="flex items-start justify-between">
                <div>
                  <CardTitle className="text-base">Salary Revision History</CardTitle>
                  <CardDescription>
                    {fullName(salRevEmp.profile)} ({salRevEmp.profile?.employeeId})
                  </CardDescription>
                </div>
                <button
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => setSalRevEmp(null)}
                >✕</button>
              </div>
            </CardHeader>
            <CardContent className="flex-1 overflow-y-auto">
              {loadingSalRev ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : salRevisions.length === 0 ? (
                <p className="text-center text-muted-foreground py-8 text-sm">
                  No salary revisions recorded yet. Changes to Annual CTC will be logged here automatically.
                </p>
              ) : (
                <div className="space-y-3">
                  {salRevisions.map((rev: any, i: number) => (
                    <div key={rev.id} className="border rounded-lg p-3 text-sm">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-medium">
                          {new Date(rev.effectiveDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                        </span>
                        {i === 0 && <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">Latest</span>}
                      </div>
                      <div className="flex items-center gap-3 text-muted-foreground">
                        <span>₹{rev.oldCtc.toLocaleString('en-IN')}</span>
                        <span className="text-xs">→</span>
                        <span className="font-medium text-foreground">₹{rev.newCtc.toLocaleString('en-IN')}</span>
                        <span className={`text-xs ml-auto ${rev.newCtc > rev.oldCtc ? 'text-green-600' : 'text-red-600'}`}>
                          {rev.newCtc > rev.oldCtc ? '▲' : '▼'} ₹{Math.abs(rev.newCtc - rev.oldCtc).toLocaleString('en-IN')}
                        </span>
                      </div>
                      {rev.reason && <p className="text-xs text-muted-foreground mt-1">{rev.reason}</p>}
                      <p className="text-xs text-muted-foreground mt-0.5">
                        By: {rev.revisor?.profile ? fullName(rev.revisor.profile) : 'Admin'}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── Bulk Import Modal ── */}
      {showImport && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <Card className="w-full max-w-lg">
            <CardHeader>
              <div className="flex items-start justify-between">
                <div>
                  <CardTitle className="text-base">Bulk Employee Import</CardTitle>
                  <CardDescription>Upload an Excel file with employee data</CardDescription>
                </div>
                <button className="text-muted-foreground hover:text-foreground" onClick={() => setShowImport(false)}>✕</button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-2">
                <a
                  href={`${(api.defaults as any).baseURL || '/api'}/employees/import-template`}
                  className="inline-flex items-center gap-2 text-sm text-[#361963] hover:underline font-medium"
                  onClick={(e) => {
                    e.preventDefault();
                    // Use axios to trigger auth-protected download
                    api.get('/employees/import-template', { responseType: 'blob' }).then((r) => {
                      const url = URL.createObjectURL(new Blob([r.data]));
                      const a   = document.createElement('a');
                      a.href    = url;
                      a.download = 'athena_employee_import_template.xlsx';
                      a.click();
                      URL.revokeObjectURL(url);
                    }).catch(() => {});
                  }}
                >
                  <Download className="h-4 w-4" />
                  Download Sample Template
                </a>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Upload Filled Template (.xlsx)</label>
                <input
                  type="file"
                  accept=".xlsx"
                  className="w-full text-sm"
                  onChange={(e) => { setImportFile(e.target.files?.[0] ?? null); setImportResults(null); }}
                />
              </div>

              {importResults && (
                <div className={`text-sm rounded-md p-3 ${importResults.error ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-green-50 text-green-800 border border-green-200'}`}>
                  {importResults.error ? (
                    <p>{importResults.error}</p>
                  ) : (
                    <>
                      <p className="font-medium">{importResults.message}</p>
                      {importResults.results?.filter((r: any) => r.status === 'skipped').map((r: any) => (
                        <p key={r.row} className="text-xs text-amber-700 mt-0.5">
                          Row {r.row} ({r.employeeId || 'unknown'}): {r.reason}
                        </p>
                      ))}
                    </>
                  )}
                </div>
              )}

              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => setShowImport(false)}>Close</Button>
                <Button
                  disabled={!importFile || importing}
                  onClick={handleImport}
                  style={{ backgroundColor: '#361963' }}
                  className="text-white"
                >
                  {importing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Upload className="h-4 w-4 mr-2" />}
                  {importing ? 'Importing...' : 'Import'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Reset Password Result Modal */}
      {resetResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <KeyRound className="h-5 w-5" style={{ color: '#361963' }} />
                <h3 className="font-semibold text-base">Password Reset</h3>
              </div>
              <button
                className="text-muted-foreground hover:text-foreground"
                onClick={() => { setResetResult(null); setCopiedPwd(false); }}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <p className="text-sm text-muted-foreground">
              Temporary password generated for <strong>{resetResult.empName}</strong>.
              Share this with them — they should change it after logging in.
            </p>

            <div className="flex items-center gap-2 rounded-lg border px-3 py-2.5" style={{ backgroundColor: '#f5f4f9' }}>
              <span className="flex-1 font-mono text-lg font-bold tracking-widest" style={{ color: '#361963' }}>
                {resetResult.tempPassword}
              </span>
              <button
                className="text-muted-foreground hover:text-foreground flex-shrink-0"
                title="Copy password"
                onClick={() => {
                  navigator.clipboard.writeText(resetResult!.tempPassword);
                  setCopiedPwd(true);
                  setTimeout(() => setCopiedPwd(false), 2000);
                }}
              >
                {copiedPwd ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
              </button>
            </div>

            <p className="text-xs text-muted-foreground">
              The employee can update their password after login via <strong>My Profile → Change Password</strong>.
            </p>

            <Button
              className="w-full text-white"
              style={{ backgroundColor: '#361963' }}
              onClick={() => { setResetResult(null); setCopiedPwd(false); }}
            >
              Done
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
