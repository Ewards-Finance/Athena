/**
 * Athena V2 - Organization Page (Admin Only)
 * Tab 1: Employee Directory — add, view, deactivate employees
 * Tab 2: Leave Quota Management — set per-employee annual leave totals
 */

import { useEffect, useState } from 'react';
import { useForm }     from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z }           from 'zod';
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
  UserPlus, UserX, Eye, EyeOff, Pencil,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Employee {
  id:    string;
  email: string;
  role:  string;
  profile?: {
    firstName:       string;
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

interface LeavePolicy { leaveType: string; label: string; }
interface LeaveBalance { leaveType: string; total: number; used: number; }
interface OverviewUser {
  id:            string;
  profile?:      { firstName: string; lastName: string; employeeId: string };
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
  const name = user.profile ? `${user.profile.firstName} ${user.profile.lastName}` : user.id;

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
  const [tab, setTab]           = useState<'directory' | 'quotas'>('directory');
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [overview, setOverview]   = useState<OverviewUser[]>([]);
  const [loading, setLoading]     = useState(true);
  const [quotaLoading, setQuotaLoading] = useState(false);
  const [search, setSearch]       = useState('');
  const [year, setYear]           = useState(new Date().getFullYear());
  const [leaveTypes, setLeaveTypes] = useState<LeavePolicy[]>([]);

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

  const {
    register, handleSubmit, reset,
    formState: { errors, isSubmitting },
  } = useForm<AddEmployeeForm>({
    resolver: zodResolver(addEmployeeSchema),
    defaultValues: { role: 'EMPLOYEE' },
  });

  const fetchEmployees = () => {
    setLoading(true);
    api.get<Employee[]>('/employees')
      .then(({ data }) => setEmployees(data))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchEmployees(); }, []);

  useEffect(() => {
    if (tab === 'quotas') {
      setQuotaLoading(true);
      api.get<OverviewUser[]>(`/leave-balance/overview?year=${year}`)
        .then(({ data }) => setOverview(data))
        .finally(() => setQuotaLoading(false));
      api.get('/leave-policy').then(({ data }) =>
        setLeaveTypes(data.map((p: any) => ({ leaveType: p.leaveType, label: p.label })))
      );
    }
  }, [tab, year]);

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
      ? `${emp.profile.firstName} ${emp.profile.lastName}`
      : emp.email;

    if (!confirm(`Deactivate ${name}?\n\nThis will disable their login and hide them from the directory. This cannot be undone from the UI.`)) return;

    setDeactivatingId(emp.id);
    try {
      await api.delete(`/employees/${emp.id}`);
      setEmployees((prev) => prev.filter((e) => e.id !== emp.id));
    } catch (err: any) {
      alert(err?.response?.data?.error || 'Failed to deactivate employee');
    } finally {
      setDeactivatingId(null);
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

  const filtered = employees.filter((emp) => {
    const q = search.toLowerCase();
    return (
      emp.profile?.firstName?.toLowerCase().includes(q) ||
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
          <p className="text-muted-foreground text-sm">Employee directory and leave quota management</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5 text-muted-foreground text-sm">
            <Users className="h-4 w-4" />
            {employees.length} active employees
          </span>
          {tab === 'directory' && (
            <Button
              onClick={() => { setShowAddForm((v) => !v); reset(); setShowPassword(false); }}
              style={{ backgroundColor: '#361963' }}
              className="text-white"
            >
              <UserPlus className="h-4 w-4 mr-2" />
              Add Employee
            </Button>
          )}
        </div>
      </div>

      {/* ── Tab switcher ── */}
      <div className="flex gap-1 p-1 rounded-lg w-fit" style={{ backgroundColor: '#f3f0fa' }}>
        {(['directory', 'quotas'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="px-4 py-1.5 rounded-md text-sm font-medium transition-all"
            style={tab === t ? { backgroundColor: '#361963', color: '#fff' } : { color: '#361963' }}
          >
            {t === 'directory'
              ? <span className="flex items-center gap-1.5"><Users className="h-3.5 w-3.5" />Directory</span>
              : <span className="flex items-center gap-1.5"><Settings2 className="h-3.5 w-3.5" />Leave Quotas</span>}
          </button>
        ))}
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          Tab: Directory
      ══════════════════════════════════════════════════════════════════════ */}
      {tab === 'directory' && (
        <>
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
                  <div className="space-y-2">
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
                          {m.profile?.firstName} {m.profile?.lastName}
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
                  Edit — {editingEmp.profile?.firstName} {editingEmp.profile?.lastName}
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
                            {m.profile?.firstName} {m.profile?.lastName}
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
                        <th className="text-left pb-3 pr-4 font-medium">Status</th>
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
                                {emp.profile?.firstName} {emp.profile?.lastName}
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
                            <td className="py-3 text-right">
                              <div className="flex items-center justify-end gap-1">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className={`h-7 w-7 p-0 ${editingEmp?.id === emp.id ? 'text-[#361963]' : 'text-muted-foreground hover:text-[#361963]'}`}
                                  onClick={() => editingEmp?.id === emp.id ? setEditingEmp(null) : openEdit(emp)}
                                  title="Edit employee"
                                >
                                  <Pencil className="h-3.5 w-3.5" />
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
        </>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          Tab: Leave Quotas
      ══════════════════════════════════════════════════════════════════════ */}
      {tab === 'quotas' && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <CardTitle className="text-base">Leave Quota Management</CardTitle>
                <CardDescription>Set annual leave totals per employee. Click a row to expand and edit.</CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Label className="text-sm text-muted-foreground">Year</Label>
                <Input
                  type="number" min={2020} max={2100}
                  value={year}
                  onChange={(e) => setYear(Number(e.target.value))}
                  className="w-24 h-9 text-sm"
                />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {quotaLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : overview.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">No employees found.</p>
            ) : (
              <div className="space-y-2">
                {overview.map((u) => <QuotaRow key={u.id} user={u} year={year} policyTypes={leaveTypes} />)}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
