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
import { formatDate }  from '@/lib/utils';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button }  from '@/components/ui/button';
import { Input }   from '@/components/ui/input';
import { Label }   from '@/components/ui/label';
import { Badge }   from '@/components/ui/badge';
import { Loader2, Save, User, Briefcase, CreditCard, Building, FileText, Upload, ExternalLink } from 'lucide-react';

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
  const [loading, setLoading]         = useState(true);
  const [saving, setSaving]           = useState(false);
  const [successMsg, setSuccessMsg]   = useState('');
  const [errorMsg, setErrorMsg]       = useState('');

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
        <Badge variant="outline" className="font-mono">
          {profile?.employeeId}
        </Badge>
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
                    href={`http://localhost:3001${profile.kycDocumentUrl}`}
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
                    href={`http://localhost:3001${profile.appointmentLetterUrl}`}
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
    </div>
  );
}
