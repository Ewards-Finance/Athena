/**
 * Athena V3.1 Sprint 5 — HR Service Desk (Helpdesk)
 * Employees raise tickets, admins manage and resolve them.
 */

import { useEffect, useState } from 'react';
import api from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LifeBuoy, Plus, X, Loader2, ChevronDown, MessageSquare } from 'lucide-react';

interface Ticket {
  id: string;
  userId: string;
  category: string;
  subject: string;
  description: string;
  status: string;
  assignedTo: string | null;
  resolvedAt: string | null;
  resolution: string | null;
  createdAt: string;
  updatedAt: string;
  user?: {
    email: string;
    profile?: { firstName: string; lastName: string; employeeId: string };
  };
  reportingManager?: {
    id: string;
    email: string;
    profile?: { firstName: string; lastName: string; employeeId: string };
  } | null;
}

const CATEGORIES = [
  { value: 'SALARY_ISSUE',          label: 'Salary Issue' },
  { value: 'ATTENDANCE_CORRECTION', label: 'Attendance Correction' },
  { value: 'DOCUMENT_REQUEST',      label: 'Document Request' },
  { value: 'REIMBURSEMENT_ISSUE',   label: 'Reimbursement Issue' },
  { value: 'LEAVE_CORRECTION',      label: 'Leave Correction' },
  { value: 'LETTER_REQUEST',        label: 'Letter Request' },
  { value: 'IT_SUPPORT',            label: 'IT Support' },
  { value: 'OTHER',                 label: 'Other' },
];

const STATUS_OPTIONS = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];

function statusColor(s: string) {
  switch (s) {
    case 'OPEN':        return 'bg-red-100 text-red-700';
    case 'IN_PROGRESS': return 'bg-yellow-100 text-yellow-700';
    case 'RESOLVED':    return 'bg-green-100 text-green-700';
    case 'CLOSED':      return 'bg-gray-100 text-gray-600';
    default:            return 'bg-gray-100 text-gray-600';
  }
}

function categoryLabel(c: string) {
  return CATEGORIES.find((cat) => cat.value === c)?.label || c.replace(/_/g, ' ');
}

export default function Helpdesk() {
  const { user } = useAuth();
  const isHrAdmin = user?.role === 'ADMIN' || user?.role === 'OWNER';
  const canManage = isHrAdmin || user?.role === 'MANAGER';
  const canRaise = true; // all roles can raise tickets; other admin resolves

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);

  // Form state
  const [category, setCategory] = useState('OTHER');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Admin update state
  const [updatingId, setUpdatingId] = useState('');
  const [resolution, setResolution] = useState('');

  const fetchTickets = () => {
    api.get('/service-requests')
      .then((r) => setTickets(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchTickets(); }, []);

  const handleSubmit = async () => {
    if (!subject.trim() || !description.trim()) return;
    setSubmitting(true);
    try {
      await api.post('/service-requests', { category, subject, description });
      setShowForm(false);
      setSubject('');
      setDescription('');
      setCategory('OTHER');
      fetchTickets();
    } catch {
      alert('Failed to submit ticket');
    } finally {
      setSubmitting(false);
    }
  };

  const handleStatusUpdate = async (ticketId: string, newStatus: string) => {
    setUpdatingId(ticketId);
    try {
      const data: any = { status: newStatus };
      if (newStatus === 'RESOLVED' && resolution.trim()) data.resolution = resolution;
      if (newStatus === 'IN_PROGRESS') data.assignedTo = user?.id;
      await api.patch(`/service-requests/${ticketId}`, data);
      setResolution('');
      setSelectedTicket(null);
      fetchTickets();
    } catch {
      alert('Failed to update ticket');
    } finally {
      setUpdatingId('');
    }
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ backgroundColor: '#361963' }}>
            <LifeBuoy className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold">HR Helpdesk</h1>
            <p className="text-sm text-muted-foreground">
              {canManage ? 'Manage employee tickets' : 'Raise and track support tickets'}
            </p>
          </div>
        </div>
        {canRaise && (
          <Button onClick={() => setShowForm(!showForm)} style={{ backgroundColor: '#361963' }}>
            <Plus className="h-4 w-4 mr-2" />
            Raise Ticket
          </Button>
        )}
      </div>

      {/* Status summary (admin) */}
      {canManage && (
        <div className="grid grid-cols-4 gap-4">
          {STATUS_OPTIONS.map((s) => {
            const count = tickets.filter((t) => t.status === s).length;
            return (
              <Card key={s}>
                <CardContent className="pt-4 text-center">
                  <div className="text-2xl font-bold">{count}</div>
                  <div className="text-xs text-muted-foreground">{s.replace('_', ' ')}</div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* New ticket form */}
      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center justify-between">
              Raise a New Ticket
              <button onClick={() => setShowForm(false)}><X className="h-4 w-4 text-gray-400" /></button>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label>Category</Label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full border rounded-md px-3 py-2 text-sm"
              >
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Subject</Label>
              <Input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Brief summary of your issue"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe your issue in detail..."
                className="w-full border rounded-md px-3 py-2 text-sm min-h-[100px] resize-y"
              />
            </div>
            <Button onClick={handleSubmit} disabled={submitting || !subject.trim() || !description.trim()} style={{ backgroundColor: '#361963' }}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Submit Ticket
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Ticket list */}
      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading tickets...
        </div>
      ) : tickets.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <MessageSquare className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p>No tickets yet.{canRaise && ' Click "Raise Ticket" to get started.'}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {tickets.map((ticket) => (
            <Card
              key={ticket.id}
              className={`cursor-pointer hover:shadow-md transition-shadow ${selectedTicket?.id === ticket.id ? 'ring-2 ring-purple-300' : ''}`}
              onClick={() => setSelectedTicket(selectedTicket?.id === ticket.id ? null : ticket)}
            >
              <CardContent className="pt-4">
                <div className="flex items-start justify-between">
                  <div className="space-y-1 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{ticket.subject}</span>
                      <Badge variant="outline" className="text-xs">{categoryLabel(ticket.category)}</Badge>
                    </div>
                    {canManage && ticket.user?.profile && (
                      <p className="text-xs text-muted-foreground">
                        {ticket.user.profile.firstName} {ticket.user.profile.lastName} ({ticket.user.profile.employeeId})
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      {new Date(ticket.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${statusColor(ticket.status)}`}>
                      {ticket.status.replace('_', ' ')}
                    </span>
                    <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform ${selectedTicket?.id === ticket.id ? 'rotate-180' : ''}`} />
                  </div>
                </div>

                {/* Expanded detail */}
                {selectedTicket?.id === ticket.id && (
                  <div className="mt-4 pt-4 border-t space-y-3" onClick={(e) => e.stopPropagation()}>
                    <div>
                      <p className="text-xs font-medium text-gray-500 mb-1">Description</p>
                      <p className="text-sm whitespace-pre-wrap">{ticket.description}</p>
                    </div>

                    {ticket.resolution && (
                      <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                        <p className="text-xs font-medium text-green-700 mb-1">Resolution</p>
                        <p className="text-sm">{ticket.resolution}</p>
                      </div>
                    )}

                    {/* Manage actions */}
                    {canManage && ticket.status !== 'CLOSED' && (
                      <div className="space-y-3 pt-2">
                        {ticket.status === 'OPEN' && (
                          <div className="flex flex-wrap gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleStatusUpdate(ticket.id, 'IN_PROGRESS')}
                              disabled={updatingId === ticket.id}
                            >
                              {updatingId === ticket.id ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                              Assign to Me & Start
                            </Button>
                            {isHrAdmin && ticket.reportingManager?.id && ticket.reportingManager.id !== user?.id && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  setUpdatingId(ticket.id);
                                  api.patch(`/service-requests/${ticket.id}`, {
                                    status: 'IN_PROGRESS',
                                    assignedTo: ticket.reportingManager?.id,
                                  }).then(() => {
                                    setSelectedTicket(null);
                                    fetchTickets();
                                  }).catch(() => {
                                    alert('Failed to assign to reporting manager');
                                  }).finally(() => setUpdatingId(''));
                                }}
                                disabled={updatingId === ticket.id}
                              >
                                Assign to Reporting Manager
                              </Button>
                            )}
                          </div>
                        )}

                        {isHrAdmin && ticket.reportingManager?.profile && (
                          <p className="text-xs text-muted-foreground">
                            Reporting manager: {ticket.reportingManager.profile.firstName} {ticket.reportingManager.profile.lastName}
                            {ticket.reportingManager.profile.employeeId ? ` (${ticket.reportingManager.profile.employeeId})` : ''}
                          </p>
                        )}

                        {(ticket.status === 'OPEN' || ticket.status === 'IN_PROGRESS') && (
                          <div className="space-y-2">
                            <textarea
                              value={resolution}
                              onChange={(e) => setResolution(e.target.value)}
                              placeholder="Enter resolution..."
                              className="w-full border rounded-md px-3 py-2 text-sm min-h-[60px] resize-y"
                            />
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                onClick={() => handleStatusUpdate(ticket.id, 'RESOLVED')}
                                disabled={updatingId === ticket.id || !resolution.trim()}
                                style={{ backgroundColor: '#361963' }}
                              >
                                Resolve
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleStatusUpdate(ticket.id, 'CLOSED')}
                                disabled={updatingId === ticket.id}
                              >
                                Close
                              </Button>
                            </div>
                          </div>
                        )}

                        {ticket.status === 'RESOLVED' && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleStatusUpdate(ticket.id, 'CLOSED')}
                            disabled={updatingId === ticket.id}
                          >
                            Close Ticket
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
