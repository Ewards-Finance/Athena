/**
 * Athena V2 - My Profile Page
 * Displays and allows editing of personal, employment, and statutory details.
 */

import { useEffect, useRef, useState } from 'react';
import { useForm }     from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z }           from 'zod';
import { useAuth }     from '@/hooks/useAuth';
import api             from '@/lib/api';
import { formatDate, resolveUploadUrl }  from '@/lib/utils';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button }  from '@/components/ui/button';
import { Input }   from '@/components/ui/input';
import { Label }   from '@/components/ui/label';
import { Badge }   from '@/components/ui/badge';
import { Loader2, Save, User, Briefcase, CreditCard, Building, FileText, Upload, ExternalLink, KeyRound, CalendarPlus, Landmark, FileDown } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';

// PAN format: 5 uppercase letters + 4 digits + 1 uppercase letter
const panRegex  = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
const ifscRegex = /^[A-Z]{4}0[A-Z0-9]{6}$/;

const profileSchema = z.object({
  gender:           z.enum(['Male', 'Female', 'Other', 'Prefer not to say']).optional().or(z.literal('')),
  phone:            z.string().optional(),
  emergencyContact: z.string().optional(),
  bloodGroup:       z.string().optional(),
  personalEmail:    z.string().email('Invalid email').optional().or(z.literal('')),
  pan:              z.string().regex(panRegex, 'Format: AAAAA1234A').optional().or(z.literal('')),
  aadharNumber:     z.string().regex(/^\d{12}$/, 'Aadhar must be 12 digits').optional().or(z.literal('')),
  uan:              z.string().optional(),
  bankAccountNumber: z.string().optional(),
  ifscCode:         z.string().regex(ifscRegex, 'Format: AAAA0XXXXXX').optional().or(z.literal('')),
  bankName:         z.string().optional(),
});

type ProfileFormData = z.infer<typeof profileSchema>;

interface ProfileData {
  firstName:        string;
  lastName:         string;
  employeeId:       string;
  designation?:     string;
  department?:      string;
  dateOfJoining?:   string;
  dateOfBirth?:     string;
  gender?:          string;
  officeLocation?:  string;
  phone?:           string;
  emergencyContact?: string;
  bloodGroup?:      string;
  personalEmail?:   string;
  pan?:             string;
  aadharNumber?:    string;
  uan?:             string;
  bankAccountNumber?: string;
  ifscCode?:        string;
  bankName?:        string;
  kycDocumentUrl?:       string;
  appointmentLetterUrl?: string;
  annualCtc?:            number | null;
  employmentType?:       string;
}

interface ReportsTo {
  firstName:  string;
  lastName:   string;
  employeeId: string;
}

interface CompanyAssignment {
  company: { displayName: string; code: string };
  designation: string | null;
  department: string | null;
  effectiveFrom: string;
  status: string;
}

// Simple info row for read-only display
function InfoRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{value || '—'}</span>
    </div>
  );
}

export default function Profile() {
  const { user }                      = useAuth();
  const [profile, setProfile]         = useState<ProfileData | null>(null);
  const [reportsTo, setReportsTo]     = useState<ReportsTo | null>(null);
  const [companyAssignment, setCompanyAssignment] = useState<CompanyAssignment | null>(null);
  const [loading, setLoading]         = useState(true);
  const [saving, setSaving]           = useState(false);
  const [successMsg, setSuccessMsg]   = useState('');
  const [errorMsg, setErrorMsg]       = useState('');

  // Change password state
  const [currentPassword, setCurrentPassword]   = useState('');
  const [newPassword, setNewPassword]           = useState('');
  const [confirmPassword, setConfirmPassword]   = useState('');
  const [changingPwd, setChangingPwd]           = useState(false);
  const [pwdSuccess, setPwdSuccess]             = useState('');
  const [pwdError, setPwdError]                 = useState('');

  // Letter generation state
  const [showLetterModal, setShowLetterModal]   = useState(false);
  const [letterType, setLetterType]             = useState('');
  const [letterTypes, setLetterTypes]           = useState<{key: string; label: string}[]>([]);
  const [generatingLetter, setGeneratingLetter] = useState(false);
  const [letterAdditional, setLetterAdditional] = useState<Record<string, string>>({});

  // Document upload state
  const [uploadingKyc, setUploadingKyc]         = useState(false);
  const [uploadingAppt, setUploadingAppt]       = useState(false);
  const kycInputRef  = useRef<HTMLInputElement>(null);
  const apptInputRef = useRef<HTMLInputElement>(null);

  const { register, handleSubmit, reset, formState: { errors } } = useForm<ProfileFormData>({
    resolver: zodResolver(profileSchema),
  });

  useEffect(() => {
    const fetchProfile = async () => {
      try {
        const { data } = await api.get(`/employees/${user?.id}`);
        setProfile(data.profile);
        setReportsTo(data.reportsTo ?? null);
        if (data.companyAssignments?.[0]) {
          setCompanyAssignment(data.companyAssignments[0]);
        }
        // Pre-fill form with existing data
        reset({
          gender:            (data.profile?.gender as any) || '',
          phone:             data.profile?.phone       || '',
          emergencyContact:  data.profile?.emergencyContact || '',
          bloodGroup:        data.profile?.bloodGroup  || '',
          personalEmail:     data.profile?.personalEmail || '',
          pan:               data.profile?.pan         || '',
          aadharNumber:      data.profile?.aadharNumber || '',
          uan:               data.profile?.uan         || '',
          bankAccountNumber: data.profile?.bankAccountNumber || '',
          ifscCode:          data.profile?.ifscCode    || '',
          bankName:          data.profile?.bankName    || '',
        });
      } catch {
        setErrorMsg('Failed to load profile');
      } finally {
        setLoading(false);
      }
    };
    if (user?.id) fetchProfile();
  }, [user?.id, reset]);

  const onSubmit = async (data: ProfileFormData) => {
    // Bank fields cannot be cleared once set
    const bankErrors: string[] = [];
    if (profile?.bankAccountNumber && data.bankAccountNumber === '')
      bankErrors.push('Account Number cannot be removed once set');
    if (profile?.ifscCode && data.ifscCode === '')
      bankErrors.push('IFSC Code cannot be removed once set');
    if (profile?.bankName && data.bankName === '')
      bankErrors.push('Bank Name cannot be removed once set');
    if (bankErrors.length > 0) {
      setErrorMsg(bankErrors.join('. '));
      return;
    }

    setSaving(true);
    setSuccessMsg('');
    setErrorMsg('');
    try {
      await api.put(`/employees/${user?.id}`, data);
      setSuccessMsg('Profile updated successfully!');
    } catch (err: any) {
      setErrorMsg(err?.response?.data?.error || 'Failed to save profile');
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async () => {
    setPwdSuccess('');
    setPwdError('');
    if (newPassword !== confirmPassword) {
      setPwdError('New passwords do not match');
      return;
    }
    setChangingPwd(true);
    try {
      await api.post('/auth/change-password', { currentPassword, newPassword });
      setPwdSuccess('Password changed successfully!');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      setPwdError(err?.response?.data?.error || 'Failed to change password');
    } finally {
      setChangingPwd(false);
    }
  };

  const handleDocUpload = async (
    file: File,
    field: 'kycDocumentUrl' | 'appointmentLetterUrl',
    setUploading: (v: boolean) => void
  ) => {
    setUploading(true);
    setSuccessMsg('');
    setErrorMsg('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const { data: uploadData } = await api.post<{ url: string }>('/upload?folder=docs', fd, {
        headers: { 'Content-Type': undefined as any },
      });
      await api.put(`/employees/${user?.id}`, { [field]: uploadData.url });
      setProfile((prev) => prev ? { ...prev, [field]: uploadData.url } : prev);
      setSuccessMsg('Document uploaded successfully!');
    } catch (err: any) {
      setErrorMsg(err?.response?.data?.error || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const openLetterModal = async () => {
    setShowLetterModal(true);
    setLetterType('');
    setLetterAdditional({});
    try {
      const { data } = await api.get('/letters/templates');
      setLetterTypes(data);
    } catch {
      setLetterTypes([]);
    }
  };

  const handleGenerateLetter = async () => {
    if (!letterType || !user?.id) return;
    setGeneratingLetter(true);
    try {
      const res = await api.post('/letters/generate',
        { userId: user.id, type: letterType, additionalData: letterAdditional },
        { responseType: 'blob' },
      );
      const url = window.URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `${letterType.toLowerCase()}_${profile?.firstName?.toLowerCase() || 'letter'}.pdf`;
      link.click();
      window.URL.revokeObjectURL(url);
      setShowLetterModal(false);
    } catch {
      alert('Failed to generate letter. Puppeteer may not be available.');
    } finally {
      setGeneratingLetter(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">My Profile</h1>
          <p className="text-muted-foreground text-sm">Manage your personal and statutory information</p>
        </div>
        <div className="flex items-center gap-3">
          {(user?.role === 'ADMIN' || user?.role === 'OWNER') && (
            <Button size="sm" variant="outline" onClick={openLetterModal}>
              <FileDown className="h-4 w-4 mr-1" />
              Generate Letter
            </Button>
          )}
          <Badge variant="outline" className="font-mono">
            {profile?.employeeId}
          </Badge>
        </div>
      </div>

      {/* Personal Details - read only (changed by Admin only) */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <User className="h-4 w-4" />
            <CardTitle className="text-base">Personal Information</CardTitle>
          </div>
          <CardDescription>Basic personal details — contact HR to update name/DOB</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <InfoRow label="Full Name"       value={`${profile?.firstName} ${profile?.lastName}`} />
          <InfoRow label="Date of Birth"   value={profile?.dateOfBirth ? formatDate(profile.dateOfBirth) : undefined} />
          <InfoRow label="Designation"     value={profile?.designation} />
          <InfoRow label="Department"      value={profile?.department} />
          <InfoRow label="Date of Joining" value={profile?.dateOfJoining ? formatDate(profile.dateOfJoining) : undefined} />
          <InfoRow label="Office"          value={profile?.officeLocation} />
          <InfoRow
            label="Reports To"
            value={
              reportsTo
                ? `${reportsTo.firstName} ${reportsTo.lastName} (${reportsTo.employeeId})`
                : undefined
            }
          />
          <InfoRow
            label="Employment Status"
            value={profile?.employmentType === 'INTERN' ? 'Intern' : profile?.employmentType ? 'Full Time' : undefined}
          />
          <InfoRow
            label="Annual Gross CTC"
            value={profile?.annualCtc != null ? `₹${profile.annualCtc.toLocaleString('en-IN')}` : undefined}
          />
        </CardContent>
      </Card>

      {/* Company Assignment */}
      {companyAssignment && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Building className="h-4 w-4" />
              <CardTitle className="text-base">Company Assignment</CardTitle>
            </div>
            <CardDescription>Your current company assignment within the group</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <InfoRow label="Company" value={companyAssignment.company.displayName} />
            <InfoRow label="Designation" value={companyAssignment.designation} />
            <InfoRow label="Department" value={companyAssignment.department} />
            <InfoRow label="Since" value={companyAssignment.effectiveFrom ? formatDate(companyAssignment.effectiveFrom) : undefined} />
          </CardContent>
        </Card>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        {/* Editable contact info */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Briefcase className="h-4 w-4" />
              <CardTitle className="text-base">Contact Details</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
            <div className="space-y-2">
              <Label htmlFor="bloodGroup">Blood Group</Label>
              <Input id="bloodGroup" placeholder="O+" {...register('bloodGroup')} />
            </div>
          </CardContent>
        </Card>

        {/* Statutory Compliance (PAN, Aadhar, UAN) */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <CreditCard className="h-4 w-4" />
              <CardTitle className="text-base">Statutory Compliance</CardTitle>
            </div>
            <CardDescription>PAN, Aadhar, UAN — stored securely as-is</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
          </CardContent>
        </Card>

        {/* Bank Details */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Building className="h-4 w-4" />
              <CardTitle className="text-base">Bank Details</CardTitle>
            </div>
            <CardDescription>Used for salary and reimbursement processing</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="bankName">Bank Name</Label>
              <Input id="bankName" placeholder="HDFC Bank" {...register('bankName')} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="bankAccountNumber">Account Number</Label>
              <Input id="bankAccountNumber" placeholder="001234567890" className="font-mono" {...register('bankAccountNumber')} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ifscCode">IFSC Code</Label>
              <Input id="ifscCode" placeholder="HDFC0001234" className="font-mono uppercase" {...register('ifscCode')} />
              {errors.ifscCode && <p className="text-xs text-destructive">{errors.ifscCode.message}</p>}
            </div>
          </CardContent>
        </Card>

        {/* Documents */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4" />
              <CardTitle className="text-base">Documents</CardTitle>
            </div>
            <CardDescription>KYC proof and appointment letter — JPG, PNG, PDF up to 5 MB</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-6">

            {/* KYC Document */}
            <div className="space-y-2">
              <Label>KYC Document</Label>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={uploadingKyc}
                  onClick={() => kycInputRef.current?.click()}
                >
                  {uploadingKyc
                    ? <Loader2 className="h-4 w-4 animate-spin mr-1" />
                    : <Upload className="h-4 w-4 mr-1" />}
                  {uploadingKyc ? 'Uploading…' : 'Upload'}
                </Button>
                {profile?.kycDocumentUrl && (
                  <a
                    href={resolveUploadUrl(profile.kycDocumentUrl)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-blue-600 underline"
                  >
                    <ExternalLink className="h-3 w-3" />
                    View current
                  </a>
                )}
                {!profile?.kycDocumentUrl && !uploadingKyc && (
                  <span className="text-xs text-muted-foreground">Not uploaded</span>
                )}
              </div>
              <input
                ref={kycInputRef}
                type="file"
                accept=".jpg,.jpeg,.png,.gif,.webp,.pdf"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleDocUpload(f, 'kycDocumentUrl', setUploadingKyc);
                  e.target.value = '';
                }}
              />
            </div>

            {/* Appointment Letter */}
            <div className="space-y-2">
              <Label>Appointment Letter</Label>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={uploadingAppt}
                  onClick={() => apptInputRef.current?.click()}
                >
                  {uploadingAppt
                    ? <Loader2 className="h-4 w-4 animate-spin mr-1" />
                    : <Upload className="h-4 w-4 mr-1" />}
                  {uploadingAppt ? 'Uploading…' : 'Upload'}
                </Button>
                {profile?.appointmentLetterUrl && (
                  <a
                    href={resolveUploadUrl(profile.appointmentLetterUrl)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-blue-600 underline"
                  >
                    <ExternalLink className="h-3 w-3" />
                    View current
                  </a>
                )}
                {!profile?.appointmentLetterUrl && !uploadingAppt && (
                  <span className="text-xs text-muted-foreground">Not uploaded</span>
                )}
              </div>
              <input
                ref={apptInputRef}
                type="file"
                accept=".jpg,.jpeg,.png,.gif,.webp,.pdf"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleDocUpload(f, 'appointmentLetterUrl', setUploadingAppt);
                  e.target.value = '';
                }}
              />
            </div>

          </CardContent>
        </Card>

        {/* Success / Error messages */}
        {successMsg && (
          <div className="bg-green-50 border border-green-200 text-green-800 rounded-md px-4 py-3 text-sm">
            {successMsg}
          </div>
        )}
        {errorMsg && (
          <div className="bg-destructive/10 border border-destructive/20 text-destructive rounded-md px-4 py-3 text-sm">
            {errorMsg}
          </div>
        )}

        <div className="flex justify-end">
          <Button type="submit" disabled={saving}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            {saving ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      </form>

      {/* Comp-Off Balance */}
      <CompOffBalanceCard />

      {/* Active Loans */}
      <ActiveLoansCard />

      {/* Change Password */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <KeyRound className="h-4 w-4" />
            <CardTitle className="text-base">Change Password</CardTitle>
          </div>
          <CardDescription>Must be at least 6 characters</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-2">
            <Label htmlFor="currentPassword">Current Password</Label>
            <Input
              id="currentPassword"
              type="password"
              value={currentPassword}
              onChange={e => setCurrentPassword(e.target.value)}
              placeholder="Enter current password"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="newPassword">New Password</Label>
            <Input
              id="newPassword"
              type="password"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              placeholder="Enter new password"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirmPassword">Confirm New Password</Label>
            <Input
              id="confirmPassword"
              type="password"
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              placeholder="Re-enter new password"
            />
          </div>
        </CardContent>
        <CardContent className="pt-0 space-y-3">
          {pwdSuccess && (
            <div className="bg-green-50 border border-green-200 text-green-800 rounded-md px-4 py-3 text-sm">
              {pwdSuccess}
            </div>
          )}
          {pwdError && (
            <div className="bg-destructive/10 border border-destructive/20 text-destructive rounded-md px-4 py-3 text-sm">
              {pwdError}
            </div>
          )}
          <div className="flex justify-end">
            <Button
              type="button"
              onClick={handleChangePassword}
              disabled={changingPwd || !currentPassword || !newPassword || !confirmPassword}
            >
              {changingPwd ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <KeyRound className="mr-2 h-4 w-4" />}
              {changingPwd ? 'Changing...' : 'Change Password'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Letter Generation Modal */}
      {showLetterModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-lg shadow-lg w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">Generate Letter</h3>
              <button onClick={() => setShowLetterModal(false)} className="text-gray-400 hover:text-gray-600">
                <span className="text-xl">&times;</span>
              </button>
            </div>

            <div className="space-y-1.5">
              <Label>Letter Type</Label>
              <select
                value={letterType}
                onChange={(e) => { setLetterType(e.target.value); setLetterAdditional({}); }}
                className="w-full border rounded-md px-3 py-2 text-sm"
              >
                <option value="">Select a letter type...</option>
                {letterTypes.map((t) => (
                  <option key={t.key} value={t.key}>{t.label}</option>
                ))}
              </select>
            </div>

            {/* Additional fields based on letter type */}
            {letterType === 'INCREMENT' && (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label>New Annual CTC</Label>
                  <Input type="number" placeholder="e.g. 800000" onChange={(e) => setLetterAdditional((prev) => ({ ...prev, newCtc: e.target.value, incrementAmount: String(Number(e.target.value) - (profile?.annualCtc || 0)), incrementPercentage: String(Math.round(((Number(e.target.value) - (profile?.annualCtc || 0)) / (profile?.annualCtc || 1)) * 100)), newMonthly: String(Math.round(Number(e.target.value) / 12)) }))} />
                </div>
                <div className="space-y-1.5">
                  <Label>Effective Date</Label>
                  <Input type="date" onChange={(e) => setLetterAdditional((prev) => ({ ...prev, effectiveDate: e.target.value }))} />
                </div>
              </div>
            )}

            {letterType === 'WARNING' && (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label>Warning Reason</Label>
                  <Input placeholder="Reason for warning" onChange={(e) => setLetterAdditional((prev) => ({ ...prev, warningReason: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label>Details (optional)</Label>
                  <textarea placeholder="Additional details..." className="w-full border rounded-md px-3 py-2 text-sm min-h-[60px]" onChange={(e) => setLetterAdditional((prev) => ({ ...prev, warningDetails: e.target.value }))} />
                </div>
              </div>
            )}

            {letterType === 'TRANSFER' && (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label>From Company</Label>
                  <Input placeholder="Current company" onChange={(e) => setLetterAdditional((prev) => ({ ...prev, fromCompany: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label>To Company</Label>
                  <Input placeholder="New company" onChange={(e) => setLetterAdditional((prev) => ({ ...prev, toCompany: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label>Effective Date</Label>
                  <Input type="date" onChange={(e) => setLetterAdditional((prev) => ({ ...prev, effectiveDate: e.target.value }))} />
                </div>
              </div>
            )}

            {letterType === 'PROBATION_CONFIRMATION' && (
              <div className="space-y-1.5">
                <Label>Confirmation Date</Label>
                <Input type="date" onChange={(e) => setLetterAdditional((prev) => ({ ...prev, confirmationDate: e.target.value }))} />
              </div>
            )}

            <div className="flex gap-2 justify-end pt-2">
              <Button variant="outline" onClick={() => setShowLetterModal(false)}>Cancel</Button>
              <Button
                onClick={handleGenerateLetter}
                disabled={!letterType || generatingLetter}
                style={{ backgroundColor: '#361963' }}
              >
                {generatingLetter ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <FileDown className="h-4 w-4 mr-2" />}
                {generatingLetter ? 'Generating...' : 'Generate & Download'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Comp-Off Balance Card ────────────────────────────────────────────────────

function CompOffBalanceCard() {
  const { data } = useQuery<{ balance: number }>({
    queryKey: ['compoff-balance-profile'],
    queryFn: () => api.get('/compoff/balance').then(r => r.data),
  });
  const balance = data?.balance ?? 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <CalendarPlus className="h-4 w-4" />
          <CardTitle className="text-base">Comp-Off Balance</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-3">
          <div className="text-2xl font-bold">{balance}</div>
          <span className="text-sm text-muted-foreground">available comp-off day{balance !== 1 ? 's' : ''}</span>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Active Loans Card ────────────────────────────────────────────────────────

function ActiveLoansCard() {
  const { data: loans = [] } = useQuery<any[]>({
    queryKey: ['loans-profile'],
    queryFn: () => api.get('/loans').then(r => r.data),
  });

  const activeLoans = loans.filter((l: any) => l.status === 'ACTIVE' || l.status === 'APPROVED');
  if (activeLoans.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <Landmark className="h-4 w-4" />
          <CardTitle className="text-base">Active Loans</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {activeLoans.map((loan: any) => (
          <div key={loan.id} className="space-y-1">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">
                {new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(loan.amount)}
              </span>
              <span className="text-muted-foreground">{loan.paidInstallments}/{loan.installments} EMIs paid</span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
              <div className="h-full rounded-full bg-[#361963]" style={{ width: `${(loan.paidInstallments / loan.installments) * 100}%` }} />
            </div>
            <p className="text-xs text-muted-foreground">
              EMI: {new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(loan.monthlyEMI)}/month
            </p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
