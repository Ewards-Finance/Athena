/**
 * Athena V2 - Holiday Calendar
 * All roles: view the company holiday calendar.
 * Admin only: add or delete holidays.
 */

import { useState } from 'react';
import { useForm }     from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z }           from 'zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth }     from '@/hooks/useAuth';
import api             from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input }  from '@/components/ui/input';
import { Label }  from '@/components/ui/label';
import { Badge }  from '@/components/ui/badge';
import { Loader2, Plus, Trash2, CalendarDays, Sun } from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Holiday {
  id:        string;
  name:      string;
  date:      string;
  type?:     string;
  createdAt: string;
}

// ─── Form schema ──────────────────────────────────────────────────────────────

const holidaySchema = z.object({
  name: z.string().min(1, 'Name is required'),
  date: z.string().min(1, 'Date is required'),
  type: z.string().optional(),
});

type HolidayFormData = z.infer<typeof holidaySchema>;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TYPE_COLORS: Record<string, string> = {
  National: 'bg-orange-100 text-orange-800',
  Regional: 'bg-blue-100 text-blue-800',
  Company:  'bg-purple-100 text-purple-800',
};

const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];

function formatDay(dateStr: string) {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', weekday: 'short' });
}

function isUpcoming(dateStr: string) {
  return new Date(dateStr) >= new Date(new Date().toDateString()); // today or future
}

function isToday(dateStr: string) {
  return new Date(dateStr).toDateString() === new Date().toDateString();
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function Holidays() {
  const { user } = useAuth();
  const queryClient             = useQueryClient();
  const [showForm, setShowForm]     = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());

  const isAdmin = user?.role === 'ADMIN';

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } =
    useForm<HolidayFormData>({ resolver: zodResolver(holidaySchema) });

  const { data: holidays = [], isLoading: loading } = useQuery({
    queryKey: ['holidays'],
    queryFn: () => api.get<Holiday[]>('/holidays').then((r) => r.data),
  });

  const onSubmit = async (data: HolidayFormData) => {
    try {
      await api.post('/holidays', data);
      reset();
      setShowForm(false);
      await queryClient.invalidateQueries({ queryKey: ['holidays'] });
    } catch (err: any) {
      alert(err?.response?.data?.error || 'Failed to add holiday');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Remove this holiday from the calendar?')) return;
    setDeletingId(id);
    try {
      await api.delete(`/holidays/${id}`);
      await queryClient.invalidateQueries({ queryKey: ['holidays'] });
    } catch (err: any) {
      alert(err?.response?.data?.error || 'Failed to delete holiday');
    } finally {
      setDeletingId(null);
    }
  };

  // ── Filter + group by month for the selected year ──
  const yearHolidays = holidays.filter(
    (h) => new Date(h.date).getFullYear() === selectedYear
  );

  const byMonth: Record<number, Holiday[]> = {};
  yearHolidays.forEach((h) => {
    const m = new Date(h.date).getMonth(); // 0-11
    if (!byMonth[m]) byMonth[m] = [];
    byMonth[m].push(h);
  });

  const nextHoliday = holidays
    .filter((h) => isUpcoming(h.date))
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())[0];

  // Year range for selector
  const currentYear = new Date().getFullYear();
  const years = [currentYear - 1, currentYear, currentYear + 1];

  return (
    <div className="space-y-6 max-w-4xl">

      {/* ── Header ── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Holiday Calendar</h1>
          <p className="text-muted-foreground text-sm">
            Company holidays are excluded from leave day calculations
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Year selector */}
          <div className="flex rounded-md border overflow-hidden text-sm">
            {years.map((y) => (
              <button
                key={y}
                onClick={() => setSelectedYear(y)}
                className={`px-3 py-1.5 transition-colors ${
                  selectedYear === y
                    ? 'text-white font-semibold'
                    : 'text-muted-foreground hover:bg-muted'
                }`}
                style={selectedYear === y ? { backgroundColor: '#361963' } : {}}
              >
                {y}
              </button>
            ))}
          </div>
          {isAdmin && (
            <Button
              onClick={() => setShowForm((v) => !v)}
              style={{ backgroundColor: '#361963' }}
              className="text-white"
            >
              <Plus className="h-4 w-4 mr-2" />
              Add Holiday
            </Button>
          )}
        </div>
      </div>

      {/* ── Next holiday banner ── */}
      {nextHoliday && (
        <div
          className="flex items-center gap-4 rounded-xl px-5 py-4"
          style={{ backgroundColor: '#f3f0fa', border: '1px solid #d8cef5' }}
        >
          <div
            className="h-10 w-10 rounded-full flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: '#361963' }}
          >
            <Sun className="h-5 w-5 text-white" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
              {isToday(nextHoliday.date) ? 'Today is a holiday' : 'Next Holiday'}
            </p>
            <p className="font-semibold text-sm" style={{ color: '#361963' }}>
              {nextHoliday.name}
              {nextHoliday.type && (
                <span className="ml-2 text-xs font-normal text-muted-foreground">({nextHoliday.type})</span>
              )}
            </p>
            <p className="text-xs text-muted-foreground">{formatDay(nextHoliday.date)}</p>
          </div>
        </div>
      )}

      {/* ── Add Holiday Form (admin) ── */}
      {isAdmin && showForm && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Add Holiday</CardTitle>
            <CardDescription>New holidays are immediately reflected in leave day calculations</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit(onSubmit)} className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="name">Holiday Name</Label>
                <Input id="name" placeholder="e.g. Diwali" {...register('name')} />
                {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="date">Date</Label>
                <Input id="date" type="date" {...register('date')} />
                {errors.date && <p className="text-xs text-destructive">{errors.date.message}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="type">Type</Label>
                <select
                  id="type"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  {...register('type')}
                >
                  <option value="">— Select type —</option>
                  <option value="National">National</option>
                  <option value="Regional">Regional</option>
                  <option value="Company">Company</option>
                </select>
              </div>
              <div className="md:col-span-3 flex gap-2">
                <Button
                  type="submit"
                  disabled={isSubmitting}
                  style={{ backgroundColor: '#361963' }}
                  className="text-white"
                >
                  {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Save Holiday
                </Button>
                <Button type="button" variant="outline" onClick={() => { setShowForm(false); reset(); }}>
                  Cancel
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* ── Holiday List ── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <CalendarDays className="h-4 w-4" style={{ color: '#361963' }} />
            <CardTitle className="text-base">
              Holidays — {selectedYear}
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                ({yearHolidays.length} {yearHolidays.length === 1 ? 'day' : 'days'})
              </span>
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : yearHolidays.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground">
              <CalendarDays className="h-10 w-10 mx-auto mb-2 opacity-30" />
              <p className="text-sm">No holidays added for {selectedYear}.</p>
              {isAdmin && (
                <p className="text-xs mt-1">Click "Add Holiday" to get started.</p>
              )}
            </div>
          ) : (
            <div className="space-y-6">
              {MONTHS.map((month, idx) => {
                const monthHolidays = byMonth[idx];
                if (!monthHolidays) return null;
                return (
                  <div key={idx}>
                    <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 pb-1 border-b">
                      {month}
                    </h3>
                    <div className="space-y-1.5">
                      {monthHolidays.map((h) => {
                        const past     = !isUpcoming(h.date) && !isToday(h.date);
                        const today    = isToday(h.date);
                        return (
                          <div
                            key={h.id}
                            className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors ${
                              today ? 'ring-2' : 'hover:bg-muted/40'
                            } ${past ? 'opacity-50' : ''}`}
                            style={today ? { outline: '2px solid #361963', backgroundColor: '#f3f0fa' } : {}}
                          >
                            {/* Date badge */}
                            <div
                              className="flex-shrink-0 w-10 h-10 rounded-lg flex flex-col items-center justify-center text-center"
                              style={{
                                backgroundColor: today ? '#361963' : past ? '#e5e7eb' : '#f3f0fa',
                                color: today ? '#fff' : past ? '#9ca3af' : '#361963',
                              }}
                            >
                              <span className="text-xs font-bold leading-none">
                                {new Date(h.date).getDate()}
                              </span>
                              <span className="text-[10px] leading-none mt-0.5">
                                {new Date(h.date).toLocaleDateString('en-IN', { weekday: 'short' })}
                              </span>
                            </div>

                            {/* Name + type */}
                            <div className="flex-1 min-w-0">
                              <p className={`text-sm font-medium truncate ${today ? 'text-[#361963]' : ''}`}>
                                {h.name}
                                {today && <span className="ml-2 text-xs font-normal text-muted-foreground">Today</span>}
                              </p>
                            </div>

                            {h.type && (
                              <Badge
                                variant="outline"
                                className={`text-xs flex-shrink-0 ${TYPE_COLORS[h.type] ?? 'bg-gray-100 text-gray-700'}`}
                              >
                                {h.type}
                              </Badge>
                            )}

                            {/* Admin delete */}
                            {isAdmin && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-muted-foreground hover:text-destructive h-7 w-7 p-0 flex-shrink-0"
                                onClick={() => handleDelete(h.id)}
                                disabled={deletingId === h.id}
                              >
                                {deletingId === h.id
                                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  : <Trash2 className="h-3.5 w-3.5" />}
                              </Button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
