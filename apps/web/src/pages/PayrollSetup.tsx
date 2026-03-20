/**
 * Athena V2 - Payroll Setup (Admin only)
 * Tab 1: Salary Components — add / edit / delete payroll columns
 * Tab 2: Employee CTC      — set annual Gross CTC per employee
 */

import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Card, CardContent, CardHeader, CardTitle,
} from '@/components/ui/card';
import { Button }  from '@/components/ui/button';
import { Input }   from '@/components/ui/input';
import { Label }   from '@/components/ui/label';
import { Badge }   from '@/components/ui/badge';
import api         from '@/lib/api';
import { formatCurrency } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────
interface PayrollComponent {
  id:       string;
  name:     string;
  type:     'EARNING' | 'DEDUCTION';
  calcType: 'PERCENTAGE_OF_CTC' | 'FIXED' | 'MANUAL' | 'AUTO_PT' | 'AUTO_TDS';
  value:    number;
  isActive: boolean;
  order:    number;
}

interface EmployeeCTC {
  userId:      string;
  employeeId:  string;
  firstName:   string;
  lastName:    string;
  designation: string;
  department:  string;
  annualCtc:   number | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const CALC_LABELS: Record<string, string> = {
  PERCENTAGE_OF_CTC: '% of Gross CTC',
  FIXED:             'Fixed (₹/month)',
  MANUAL:            'Manual (per employee)',
  AUTO_PT:           'Auto — Professional Tax (WB)',
  AUTO_TDS:          'Auto — TDS (New Regime)',
};

const CALC_OPTIONS: { value: string; label: string }[] = [
  { value: 'PERCENTAGE_OF_CTC', label: '% of Gross CTC' },
  { value: 'FIXED',             label: 'Fixed ₹/month (same for all)' },
  { value: 'MANUAL',            label: 'Manual (HR enters per employee)' },
  { value: 'AUTO_TDS',          label: 'Auto — TDS / Income Tax (New Regime)' },
  { value: 'AUTO_PT',           label: 'Auto — Professional Tax (West Bengal)' },
];

// ─── Main Component ───────────────────────────────────────────────────────────
export default function PayrollSetup() {
  const [tab, setTab] = useState<'components' | 'ctc'>('components');
  const queryClient = useQueryClient();

  // --- Components state ---
  const [showAddForm, setShowAddForm] = useState(false);
  const [newComp, setNewComp]         = useState({
    name: '', type: 'EARNING' as 'EARNING' | 'DEDUCTION',
    calcType: 'PERCENTAGE_OF_CTC' as PayrollComponent['calcType'],
    value: '',
  });
  const [addError, setAddError]   = useState('');
  const [addLoading, setAddLoading] = useState(false);

  // --- CTC state ---
  const [ctcValues, setCtcValues]   = useState<Record<string, string>>({});
  const [ctcSaving, setCtcSaving]   = useState<Record<string, boolean>>({});
  const [ctcErrors, setCtcErrors]   = useState<Record<string, string>>({});

  // ── Fetch components ────────────────────────────────────────────────────────
  const { data: components = [], isLoading: compLoading, isError: compIsError } = useQuery({
    queryKey: ['payroll-components'],
    queryFn: () => api.get<PayrollComponent[]>('/payroll/components').then((r) => r.data),
  });

  const compError = compIsError ? 'Failed to load payroll components.' : '';

  // ── Fetch employees with CTC ─────────────────────────────────────────────────
  const { data: employees = [], isLoading: ctcLoading } = useQuery({
    queryKey: ['payroll-employees-ctc'],
    queryFn: () => api.get<EmployeeCTC[]>('/payroll/employees-ctc').then((r) => r.data),
    enabled: tab === 'ctc',
  });

  // Initialise CTC values when employees data loads
  useEffect(() => {
    if (employees.length === 0) return;
    const vals: Record<string, string> = {};
    for (const emp of employees) {
      vals[emp.userId] = emp.annualCtc != null ? String(emp.annualCtc) : '';
    }
    setCtcValues(vals);
  }, [employees]);

  // ── Add component ────────────────────────────────────────────────────────────
  const handleAddComponent = async () => {
    setAddError('');
    if (!newComp.name.trim()) { setAddError('Name is required.'); return; }
    if ((newComp.calcType === 'PERCENTAGE_OF_CTC' || newComp.calcType === 'FIXED') && !newComp.value) {
      setAddError('Value is required for this calculation type.'); return;
    }
    const numVal = parseFloat(newComp.value) || 0;
    if (newComp.calcType === 'PERCENTAGE_OF_CTC' && (numVal <= 0 || numVal > 100)) {
      setAddError('Percentage must be between 1 and 100.'); return;
    }
    setAddLoading(true);
    try {
      await api.post('/payroll/components', {
        name:     newComp.name.trim(),
        type:     newComp.type,
        calcType: newComp.calcType,
        value:    numVal,
      });
      setNewComp({ name: '', type: 'EARNING', calcType: 'PERCENTAGE_OF_CTC', value: '' });
      setShowAddForm(false);
      await queryClient.invalidateQueries({ queryKey: ['payroll-components'] });
    } catch (err: any) {
      setAddError(err?.response?.data?.error ?? 'Failed to add component.');
    } finally {
      setAddLoading(false);
    }
  };

  // ── Delete component ─────────────────────────────────────────────────────────
  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
    try {
      await api.delete(`/payroll/components/${id}`);
      await queryClient.invalidateQueries({ queryKey: ['payroll-components'] });
    } catch (err: any) {
      alert(err?.response?.data?.error ?? 'Failed to delete component.');
    }
  };

  // ── Save CTC for one employee ────────────────────────────────────────────────
  const handleSaveCTC = async (userId: string) => {
    const val = ctcValues[userId];
    const num = parseFloat(val);
    if (isNaN(num) || num < 0) {
      setCtcErrors((p) => ({ ...p, [userId]: 'Enter a valid positive number.' }));
      return;
    }
    setCtcSaving((p) => ({ ...p, [userId]: true }));
    setCtcErrors((p) => ({ ...p, [userId]: '' }));
    try {
      await api.put(`/payroll/employees-ctc/${userId}`, { annualCtc: num });
    } catch (err: any) {
      setCtcErrors((p) => ({ ...p, [userId]: err?.response?.data?.error ?? 'Save failed.' }));
    } finally {
      setCtcSaving((p) => ({ ...p, [userId]: false }));
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────────
  const earningComps   = components.filter((c) => c.type === 'EARNING');
  const deductionComps = components.filter((c) => c.type === 'DEDUCTION');

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold" style={{ color: '#361963' }}>Payroll Setup</h1>
        <p className="text-sm text-gray-500 mt-1">Configure salary components and employee CTC</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b">
        {(['components', 'ctc'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t
                ? 'border-[#FD8C27] text-[#361963]'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t === 'components' ? 'Salary Components' : 'Employee CTC'}
          </button>
        ))}
      </div>

      {/* ── Tab 1: Salary Components ─────────────────────────────────────────── */}
      {tab === 'components' && (
        <div className="space-y-6">
          {compLoading ? (
            <p className="text-gray-400 text-sm">Loading components…</p>
          ) : compError ? (
            <p className="text-red-500 text-sm">{compError}</p>
          ) : (
            <>
              {/* Earnings */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center justify-between">
                    <span style={{ color: '#361963' }}>Earnings</span>
                    <Badge className="text-xs bg-green-100 text-green-700 border-green-200">
                      {earningComps.length} active
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs text-gray-500 border-b">
                          <th className="pb-2 font-medium">Component Name</th>
                          <th className="pb-2 font-medium">Calculation</th>
                          <th className="pb-2 font-medium text-right">Value</th>
                          <th className="pb-2"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {earningComps.map((comp) => (
                          <tr key={comp.id} className="hover:bg-gray-50">
                            <td className="py-2.5 font-medium text-gray-800">{comp.name}</td>
                            <td className="py-2.5 text-gray-500">{CALC_LABELS[comp.calcType]}</td>
                            <td className="py-2.5 text-right text-gray-700">
                              {comp.calcType === 'PERCENTAGE_OF_CTC' && `${comp.value}%`}
                              {comp.calcType === 'FIXED'             && formatCurrency(comp.value)}
                              {comp.calcType === 'MANUAL'            && '—'}
                              {comp.calcType === 'AUTO_PT'           && 'Auto (PT)'}
                              {comp.calcType === 'AUTO_TDS'          && 'Auto (TDS)'}
                            </td>
                            <td className="py-2.5 text-right">
                              <button
                                onClick={() => handleDelete(comp.id, comp.name)}
                                className="text-xs text-red-400 hover:text-red-600 px-2 py-1 rounded"
                              >
                                Remove
                              </button>
                            </td>
                          </tr>
                        ))}
                        {earningComps.length === 0 && (
                          <tr><td colSpan={4} className="py-4 text-center text-gray-400 text-xs">No earning components</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>

              {/* Deductions */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center justify-between">
                    <span style={{ color: '#361963' }}>Deductions</span>
                    <Badge className="text-xs bg-red-100 text-red-700 border-red-200">
                      {deductionComps.length} active
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs text-gray-500 border-b">
                          <th className="pb-2 font-medium">Component Name</th>
                          <th className="pb-2 font-medium">Calculation</th>
                          <th className="pb-2 font-medium text-right">Value</th>
                          <th className="pb-2"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {deductionComps.map((comp) => (
                          <tr key={comp.id} className="hover:bg-gray-50">
                            <td className="py-2.5 font-medium text-gray-800">{comp.name}</td>
                            <td className="py-2.5 text-gray-500">{CALC_LABELS[comp.calcType]}</td>
                            <td className="py-2.5 text-right text-gray-700">
                              {comp.calcType === 'AUTO_PT' ? 'Auto (PT)' : comp.calcType === 'AUTO_TDS' ? 'Auto (TDS)' : comp.calcType === 'FIXED' ? formatCurrency(comp.value) : comp.calcType === 'MANUAL' ? '—' : `${comp.value}%`}
                            </td>
                            <td className="py-2.5 text-right">
                              {comp.calcType !== 'AUTO_PT' ? (
                                <button
                                  onClick={() => handleDelete(comp.id, comp.name)}
                                  className="text-xs text-red-400 hover:text-red-600 px-2 py-1 rounded"
                                >
                                  Remove
                                </button>
                              ) : (
                                <span className="text-xs text-gray-400 px-2">System</span>
                              )}
                            </td>
                          </tr>
                        ))}
                        {deductionComps.length === 0 && (
                          <tr><td colSpan={4} className="py-4 text-center text-gray-400 text-xs">No deduction components</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  <p className="text-xs text-gray-400 mt-3">
                    * "LWP Deduction" is auto-calculated by the system from approved LWP-type leaves — it does not appear here.
                  </p>
                </CardContent>
              </Card>

              {/* Add Component Form */}
              {showAddForm ? (
                <Card className="border-[#FD8C27]">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base" style={{ color: '#361963' }}>Add New Component</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <Label>Component Name</Label>
                        <Input
                          placeholder="e.g. Bonus, Transport Allowance"
                          value={newComp.name}
                          onChange={(e) => setNewComp((p) => ({ ...p, name: e.target.value }))}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label>Type</Label>
                        <select
                          value={newComp.type}
                          onChange={(e) => setNewComp((p) => ({ ...p, type: e.target.value as 'EARNING' | 'DEDUCTION' }))}
                          className="w-full h-9 border rounded-md px-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#361963]/30"
                        >
                          <option value="EARNING">Earning</option>
                          <option value="DEDUCTION">Deduction</option>
                        </select>
                      </div>
                      <div className="space-y-1">
                        <Label>Calculation Type</Label>
                        <select
                          value={newComp.calcType}
                          onChange={(e) => setNewComp((p) => ({ ...p, calcType: e.target.value as PayrollComponent['calcType'], value: '' }))}
                          className="w-full h-9 border rounded-md px-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#361963]/30"
                        >
                          {CALC_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                      </div>
                      {(newComp.calcType === 'PERCENTAGE_OF_CTC' || newComp.calcType === 'FIXED') && (
                        <div className="space-y-1">
                          <Label>
                            {newComp.calcType === 'PERCENTAGE_OF_CTC' ? 'Percentage (%)' : 'Fixed Amount (₹)'}
                          </Label>
                          <Input
                            type="number"
                            min={0}
                            max={newComp.calcType === 'PERCENTAGE_OF_CTC' ? 100 : undefined}
                            placeholder={newComp.calcType === 'PERCENTAGE_OF_CTC' ? 'e.g. 10' : 'e.g. 500'}
                            value={newComp.value}
                            onChange={(e) => setNewComp((p) => ({ ...p, value: e.target.value }))}
                          />
                        </div>
                      )}
                      {newComp.calcType === 'MANUAL' && (
                        <div className="col-span-2 rounded-md bg-blue-50 border border-blue-200 p-3 text-sm text-blue-700">
                          HR Admin will enter the value per employee when running monthly payroll.
                        </div>
                      )}
                    </div>
                    {addError && <p className="text-red-500 text-xs">{addError}</p>}
                    <div className="flex gap-2 justify-end">
                      <Button variant="outline" size="sm" onClick={() => { setShowAddForm(false); setAddError(''); }}>
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        disabled={addLoading}
                        onClick={handleAddComponent}
                        style={{ backgroundColor: '#361963' }}
                        className="text-white"
                      >
                        {addLoading ? 'Saving…' : 'Add Component'}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <Button
                  onClick={() => setShowAddForm(true)}
                  style={{ backgroundColor: '#FD8C27' }}
                  className="text-white"
                >
                  + Add Component
                </Button>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Tab 2: Employee CTC ───────────────────────────────────────────────── */}
      {tab === 'ctc' && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base" style={{ color: '#361963' }}>
              Annual Gross CTC per Employee
            </CardTitle>
            <p className="text-xs text-gray-500 mt-1">
              Monthly CTC = Annual CTC ÷ 12. Salary components are calculated as a % of Monthly CTC.
            </p>
          </CardHeader>
          <CardContent>
            {ctcLoading ? (
              <p className="text-gray-400 text-sm">Loading…</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-500 border-b">
                      <th className="pb-2 font-medium">Emp ID</th>
                      <th className="pb-2 font-medium">Name</th>
                      <th className="pb-2 font-medium">Designation</th>
                      <th className="pb-2 font-medium">Department</th>
                      <th className="pb-2 font-medium">Annual CTC (₹)</th>
                      <th className="pb-2 font-medium">Monthly CTC</th>
                      <th className="pb-2"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {employees.map((emp) => {
                      const monthly = ctcValues[emp.userId]
                        ? (parseFloat(ctcValues[emp.userId]) / 12).toFixed(0)
                        : '—';
                      return (
                        <tr key={emp.userId} className="hover:bg-gray-50">
                          <td className="py-3 font-mono text-xs">{emp.employeeId}</td>
                          <td className="py-3 font-medium text-gray-800">
                            {emp.firstName} {emp.lastName}
                          </td>
                          <td className="py-3 text-gray-500">{emp.designation ?? '—'}</td>
                          <td className="py-3 text-gray-500">{emp.department ?? '—'}</td>
                          <td className="py-3">
                            <div className="flex items-center gap-2">
                              <span className="text-gray-400 text-sm">₹</span>
                              <Input
                                type="number"
                                min={0}
                                className="w-36 h-8 text-sm"
                                placeholder="e.g. 600000"
                                value={ctcValues[emp.userId] ?? ''}
                                onChange={(e) =>
                                  setCtcValues((p) => ({ ...p, [emp.userId]: e.target.value }))
                                }
                              />
                            </div>
                            {ctcErrors[emp.userId] && (
                              <p className="text-red-500 text-xs mt-1">{ctcErrors[emp.userId]}</p>
                            )}
                          </td>
                          <td className="py-3 text-gray-500 text-sm">
                            {ctcValues[emp.userId] && !isNaN(parseFloat(ctcValues[emp.userId]))
                              ? `₹${parseInt(monthly).toLocaleString('en-IN')}`
                              : '—'
                            }
                          </td>
                          <td className="py-3">
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={ctcSaving[emp.userId]}
                              onClick={() => handleSaveCTC(emp.userId)}
                              className="h-7 text-xs"
                            >
                              {ctcSaving[emp.userId] ? 'Saving…' : 'Save'}
                            </Button>
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
      )}
    </div>
  );
}
