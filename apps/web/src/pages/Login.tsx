/**
 * Athena V2 - Login Page
 * Uses React Hook Form + Zod for validated, clean form submission.
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Eye, EyeOff, Loader2, HelpCircle, X } from 'lucide-react';

// Zod schema: enforces valid email and minimum password length
const loginSchema = z.object({
  email:    z.string().email('Please enter a valid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});

type LoginFormData = z.infer<typeof loginSchema>;

export default function Login() {
  const navigate         = useNavigate();
  const { login }        = useAuth();
  const [apiError, setApiError]           = useState('');
  const [showPassword, setShowPassword]   = useState(false);
  const [showForgot, setShowForgot]       = useState(false);

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
      // Show the server's error message or a fallback
      setApiError(
        err?.response?.data?.error || 'Login failed. Please check your credentials.'
      );
    }
  };

  return (
    <div className="min-h-screen flex" style={{ backgroundColor: '#f5f4f9' }}>
      {/* Left panel — brand */}
      <div
        className="hidden lg:flex flex-col justify-between w-2/5 p-12 text-white"
        style={{ backgroundColor: '#361963' }}
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center"
               style={{ backgroundColor: '#FD8C27' }}>
            <span className="font-bold text-lg">A</span>
          </div>
          <span className="font-bold text-xl">Athena HRMS</span>
        </div>

        <div>
          <h2 className="text-4xl font-bold leading-tight mb-4">
            Manage your workforce,<br />
            <span style={{ color: '#FD8C27' }}>seamlessly.</span>
          </h2>
          <p style={{ color: 'rgba(255,255,255,0.65)' }} className="text-sm leading-relaxed">
            Leaves, claims, payroll compliance and your entire employee lifecycle — all in one place.
          </p>
        </div>

        <p style={{ color: 'rgba(255,255,255,0.35)' }} className="text-xs">
          © 2026 Ewards. All rights reserved.
        </p>
      </div>

      {/* Right panel — form */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-md space-y-8">
          {/* Mobile brand (shown only on small screens) */}
          <div className="flex items-center gap-3 lg:hidden">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center"
                 style={{ backgroundColor: '#361963' }}>
              <span className="text-white font-bold">A</span>
            </div>
            <span className="font-bold text-lg" style={{ color: '#361963' }}>Athena HRMS</span>
          </div>

          <div>
            <h1 className="text-2xl font-bold tracking-tight" style={{ color: '#361963' }}>
              Welcome back
            </h1>
            <p className="text-muted-foreground text-sm mt-1">Sign in to your Ewards account to continue</p>
          </div>

          <Card className="shadow-md border-0">
            <CardContent className="pt-6">
              <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
                {/* Email */}
                <div className="space-y-2">
                  <Label htmlFor="email" className="text-sm font-medium">Email address</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="you@ewards.com"
                    autoComplete="email"
                    className="h-11"
                    {...register('email')}
                  />
                  {errors.email && (
                    <p className="text-xs text-destructive">{errors.email.message}</p>
                  )}
                </div>

                {/* Password */}
                <div className="space-y-2">
                  <Label htmlFor="password" className="text-sm font-medium">Password</Label>
                  <div className="relative">
                    <Input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      placeholder="••••••••"
                      autoComplete="current-password"
                      className="h-11 pr-10"
                      {...register('password')}
                    />
                    <button
                      type="button"
                      className="absolute inset-y-0 right-3 flex items-center text-muted-foreground hover:text-foreground"
                      onClick={() => setShowPassword(!showPassword)}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  {errors.password && (
                    <p className="text-xs text-destructive">{errors.password.message}</p>
                  )}
                </div>

                {/* API error */}
                {apiError && (
                  <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-md px-3 py-2">
                    {apiError}
                  </div>
                )}

                <Button
                  type="submit"
                  className="w-full h-11 text-white font-semibold"
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
                  <div className="relative rounded-lg px-4 py-3 text-sm"
                       style={{ backgroundColor: '#f5f4f9', border: '1px solid #e8e5f0' }}>
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
                        <p className="text-muted-foreground leading-relaxed">
                          Please contact your <strong>HR Administrator</strong> to reset your password.
                          They will generate a temporary password for you, which you can change after logging in
                          from <strong>My Profile → Change Password</strong>.
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </form>

            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
