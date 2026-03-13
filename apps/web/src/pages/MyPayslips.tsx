/**
 * Athena V2 - My Payslips (All roles)
 * Employees can view their finalized payslip history with earnings/deductions breakdown.
 */

import { useState, useEffect } from 'react';
import { Card, CardContent }   from '@/components/ui/card';
import { Badge }               from '@/components/ui/badge';
import api                     from '@/lib/api';

// ─── Types ────────────────────────────────────────────────────────────────────
interface PayslipEntry {
  id:             string;
  monthlyCtc:     number;
  workingDays:    number;
  lwpDays:        number;
  paidDays:       number;
  earnings:       Record<string, number>;
  deductions:     Record<string, number>;
  reimbursements: number;
  grossPay:       number;
  totalDeductions:number;
  netPay:         number;
  payrollRun: {
    month:  number;
    year:   number;
    status: string;
  };
}

const MONTHS = [
  '', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function fmt(n: number) {
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function MyPayslips() {
  const [payslips, setPayslips] = useState<PayslipEntry[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get('/payroll/my-payslips');
        setPayslips(res.data);
      } catch {
        setError('Failed to load payslips.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <p className="text-gray-400 text-sm p-6">Loading payslips…</p>;
  if (error)   return <p className="text-red-500 text-sm p-6">{error}</p>;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold" style={{ color: '#361963' }}>My Payslips</h1>
        <p className="text-sm text-gray-500 mt-1">Your finalized monthly salary breakdowns</p>
      </div>

      {payslips.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-gray-400 text-sm">No payslips available yet.</p>
            <p className="text-gray-400 text-xs mt-1">Finalized payslips will appear here once HR processes the monthly payroll.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {payslips.map((slip) => {
            const isOpen = expanded === slip.id;
            const month  = MONTHS[slip.payrollRun.month];
            const year   = slip.payrollRun.year;

            const earningKeys   = Object.keys(slip.earnings);
            const deductionKeys = Object.keys(slip.deductions);

            return (
              <Card
                key={slip.id}
                className={`transition-shadow hover:shadow-md ${isOpen ? 'border-[#361963]' : ''}`}
              >
                {/* Row header — always visible */}
                <CardContent
                  className="flex items-center justify-between py-4 cursor-pointer"
                  onClick={() => setExpanded(isOpen ? null : slip.id)}
                >
                  <div className="flex items-center gap-4">
                    <div
                      className="w-10 h-10 rounded-lg flex items-center justify-center text-white text-sm font-bold flex-shrink-0"
                      style={{ backgroundColor: '#361963' }}
                    >
                      {slip.payrollRun.month.toString().padStart(2, '0')}
                    </div>
                    <div>
                      <p className="font-semibold text-gray-800">{month} {year}</p>
                      <p className="text-xs text-gray-400">
                        {slip.paidDays} paid days
                        {slip.lwpDays > 0 && (
                          <span className="ml-2 text-red-500">{slip.lwpDays} LWP</span>
                        )}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-6">
                    <div className="text-right hidden sm:block">
                      <p className="text-xs text-gray-400">Gross Pay</p>
                      <p className="text-sm font-medium text-gray-700">₹{fmt(slip.grossPay)}</p>
                    </div>
                    <div className="text-right hidden sm:block">
                      <p className="text-xs text-gray-400">Deductions</p>
                      <p className="text-sm font-medium text-red-600">−₹{fmt(slip.totalDeductions)}</p>
                    </div>
                    {slip.reimbursements > 0 && (
                      <div className="text-right hidden sm:block">
                        <p className="text-xs text-gray-400">Reimb.</p>
                        <p className="text-sm font-medium text-green-600">+₹{fmt(slip.reimbursements)}</p>
                      </div>
                    )}
                    <div className="text-right">
                      <p className="text-xs text-gray-400">Net Pay</p>
                      <p className="text-lg font-bold" style={{ color: '#361963' }}>₹{fmt(slip.netPay)}</p>
                    </div>
                    <span className="text-gray-400 text-sm">{isOpen ? '▲' : '▼'}</span>
                  </div>
                </CardContent>

                {/* Expanded breakdown */}
                {isOpen && (
                  <div className="border-t mx-4 pb-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4">
                      {/* Earnings */}
                      <div>
                        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Earnings</p>
                        <div className="space-y-2">
                          {earningKeys.map((key) => (
                            <div key={key} className="flex justify-between text-sm">
                              <span className="text-gray-600">{key}</span>
                              <span className="font-medium text-gray-800">₹{fmt(slip.earnings[key])}</span>
                            </div>
                          ))}
                          <div className="flex justify-between text-sm font-semibold border-t pt-2 mt-2">
                            <span style={{ color: '#361963' }}>Gross Pay</span>
                            <span style={{ color: '#361963' }}>₹{fmt(slip.grossPay)}</span>
                          </div>
                        </div>
                      </div>

                      {/* Deductions + Net */}
                      <div>
                        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Deductions</p>
                        <div className="space-y-2">
                          {deductionKeys.length === 0 ? (
                            <p className="text-xs text-gray-400">No deductions this month.</p>
                          ) : (
                            deductionKeys.map((key) => (
                              <div key={key} className="flex justify-between text-sm">
                                <span className="text-gray-600">{key}</span>
                                <span className="font-medium text-red-600">−₹{fmt(slip.deductions[key])}</span>
                              </div>
                            ))
                          )}
                          <div className="flex justify-between text-sm font-semibold border-t pt-2 mt-2">
                            <span className="text-red-600">Total Deductions</span>
                            <span className="text-red-600">−₹{fmt(slip.totalDeductions)}</span>
                          </div>
                        </div>

                        {/* Reimbursements */}
                        {slip.reimbursements > 0 && (
                          <div className="mt-4">
                            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Reimbursements</p>
                            <div className="flex justify-between text-sm">
                              <span className="text-gray-600">Approved Claims</span>
                              <span className="font-medium text-green-600">+₹{fmt(slip.reimbursements)}</span>
                            </div>
                          </div>
                        )}

                        {/* Net Pay */}
                        <div
                          className="mt-4 rounded-lg p-3 flex justify-between items-center"
                          style={{ backgroundColor: '#361963' }}
                        >
                          <span className="text-white font-semibold">Net Pay (Take Home)</span>
                          <span className="text-white font-bold text-lg">₹{fmt(slip.netPay)}</span>
                        </div>

                        {/* CTC info */}
                        <div className="mt-3 flex justify-between text-xs text-gray-400">
                          <span>Monthly CTC</span>
                          <span>₹{fmt(slip.monthlyCtc)}</span>
                        </div>
                        <div className="flex justify-between text-xs text-gray-400">
                          <span>Working Days / Paid Days</span>
                          <span>{slip.workingDays} / {slip.paidDays}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
