/**
 * Athena V2 - Login Page
 */

import { useState }      from 'react';
import { useNavigate }   from 'react-router-dom';
import { useForm }       from 'react-hook-form';
import { zodResolver }   from '@hookform/resolvers/zod';
import { z }             from 'zod';
import { useAuth }       from '@/hooks/useAuth';
import { Button }        from '@/components/ui/button';
import { Input }         from '@/components/ui/input';
import { Label }         from '@/components/ui/label';
import { Eye, EyeOff, Loader2, HelpCircle, X, Users, CalendarCheck, Banknote } from 'lucide-react';

const loginSchema = z.object({
  email:    z.string().email('Please enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});

type LoginFormData = z.infer<typeof loginSchema>;

const features = [
  { icon: Users,         text: 'Employee lifecycle & org management' },
  { icon: CalendarCheck, text: 'Leaves, attendance & work logs' },
  { icon: Banknote,      text: 'Payroll, claims & compliance' },
];

export default function Login() {
  const navigate         = useNavigate();
  const { login }        = useAuth();
  const [apiError, setApiError]         = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showForgot, setShowForgot]     = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormData>({ resolver: zodResolver(loginSchema) });

  const onSubmit = async (data: LoginFormData) => {
    setApiError('');
    try {
      await login(data.email, data.password);
      navigate('/dashboard');
    } catch (err: any) {
      setApiError(err?.response?.data?.error || 'Login failed. Please check your credentials.');
    }
  };

  return (
    <div className="min-h-screen flex" style={{ backgroundColor: '#f5f4f9' }}>

      {/* ── Left panel ── */}
      <div
        className="hidden lg:flex flex-col justify-between w-2/5 p-12 text-white relative overflow-hidden"
        style={{ backgroundColor: '#361963' }}
      >
        {/* Decorative circles */}
        <div className="absolute -top-24 -right-24 w-72 h-72 rounded-full opacity-10" style={{ backgroundColor: '#FD8C27' }} />
        <div className="absolute bottom-32 -left-16 w-48 h-48 rounded-full opacity-5" style={{ backgroundColor: '#FD8C27' }} />

        {/* Logo */}
        <div className="flex items-center gap-3 relative z-10">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center shadow-lg"
            style={{ backgroundColor: '#FD8C27' }}
          >
            <span className="font-black text-white text-lg tracking-tight">A</span>
          </div>
          <span className="font-bold text-xl tracking-tight">Athena</span>
        </div>

        {/* Headline */}
        <div className="relative z-10">
          <h2 className="text-4xl font-black leading-tight mb-5 tracking-tight">
            Your workforce,<br />
            <span style={{ color: '#FD8C27' }}>one platform.</span>
          </h2>
          <div className="space-y-3 mb-8">
            {features.map(({ icon: Icon, text }) => (
              <div key={text} className="flex items-center gap-3">
                <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: 'rgba(255,255,255,0.1)' }}>
                  <Icon className="h-3.5 w-3.5 text-white/80" />
                </div>
                <span className="text-sm" style={{ color: 'rgba(255,255,255,0.72)' }}>{text}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="relative z-10 space-y-1">
          <p style={{ color: 'rgba(255,255,255,0.35)' }} className="text-xs">
            © 2026 Ewards Technology Pvt. Ltd.
          </p>
          <p style={{ color: 'rgba(255,255,255,0.2)' }} className="text-xs font-mono">
            v2.0.0 · build 2026.03 · node/express · postgresql
          </p>
        </div>
      </div>

      {/* ── Right panel ── */}
      <div className="flex-1 flex flex-col items-center justify-center p-8">
        <div className="w-full max-w-sm space-y-7">

          {/* Mobile brand */}
          <div className="flex items-center gap-3 lg:hidden">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ backgroundColor: '#361963' }}>
              <span className="text-white font-black">A</span>
            </div>
            <span className="font-bold text-lg" style={{ color: '#361963' }}>Athena</span>
          </div>

          {/* Heading */}
          <div>
            <h1 className="text-2xl font-bold tracking-tight" style={{ color: '#361963' }}>
              Welcome back
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Sign in to your Ewards account
            </p>
          </div>

          {/* Form card */}
          <div className="bg-white rounded-2xl shadow-lg border-0 p-7 space-y-5">
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">

              {/* Email */}
              <div className="space-y-1.5">
                <Label htmlFor="email" className="text-sm font-medium">Email address</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@ewards.com"
                  autoComplete="email"
                  className="h-11 rounded-lg"
                  {...register('email')}
                />
                {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
              </div>

              {/* Password */}
              <div className="space-y-1.5">
                <Label htmlFor="password" className="text-sm font-medium">Password</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="••••••••"
                    autoComplete="current-password"
                    className="h-11 pr-10 rounded-lg"
                    {...register('password')}
                  />
                  <button
                    type="button"
                    className="absolute inset-y-0 right-3 flex items-center text-muted-foreground hover:text-foreground"
                    onClick={() => setShowPassword(!showPassword)}
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {errors.password && <p className="text-xs text-destructive">{errors.password.message}</p>}
              </div>

              {/* API error */}
              {apiError && (
                <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">
                  {apiError}
                </div>
              )}

              <Button
                type="submit"
                className="w-full h-11 text-white font-semibold rounded-lg"
                style={{ backgroundColor: '#361963' }}
                disabled={isSubmitting}
              >
                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {isSubmitting ? 'Signing in...' : 'Sign In'}
              </Button>

              <div className="text-center">
                <button
                  type="button"
                  className="text-xs text-muted-foreground hover:underline"
                  onClick={() => setShowForgot((v) => !v)}
                >
                  Forgot your password?
                </button>
              </div>

              {showForgot && (
                <div className="relative rounded-xl px-4 py-3 text-sm" style={{ backgroundColor: '#f5f4f9', border: '1px solid #e8e5f0' }}>
                  <button
                    type="button"
                    className="absolute top-2 right-2 text-muted-foreground hover:text-foreground"
                    onClick={() => setShowForgot(false)}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                  <div className="flex gap-2">
                    <HelpCircle className="h-4 w-4 mt-0.5 flex-shrink-0" style={{ color: '#361963' }} />
                    <div>
                      <p className="font-semibold mb-0.5" style={{ color: '#361963' }}>Password Reset</p>
                      <p className="text-muted-foreground leading-relaxed text-xs">
                        Contact your <strong>HR Administrator</strong> to reset your password.
                        They'll generate a temporary password — change it after login via{' '}
                        <strong>My Profile → Change Password</strong>.
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </form>
          </div>

          {/* Version footer */}
          <p className="text-center text-xs font-mono" style={{ color: '#b0a8c4' }}>
            Athena v2.0.0 · Ewards Technology
          </p>

        </div>
      </div>
    </div>
  );
}
