import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { Badge } from '../components/foundation/Badge';
import { Button } from '../components/foundation/Button';
import { getInitials } from '../lib/utils';
import { approvePendingMember } from '../lib/queries/members';
import type { AuthUser } from '../lib/auth';

interface Props { user: AuthUser | null; }

interface PendingProfile {
  id: string;
  email: string;
  full_name: string;
  student_number: string | null;
  joined_at: string;
  status: 'pending' | 'rejected';
}

const CAN_APPROVE = ['admin', 'coordinator', 'cell_leader'];

export const AdminPendingApprovals: React.FC<Props> = ({ user }) => {
  const [pending, setPending] = useState<PendingProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const canApprove = CAN_APPROVE.includes(user?.role ?? '');

  useEffect(() => {
    if (!canApprove) { setLoading(false); return; }
    supabase
      .from('profiles')
      .select('id, email, full_name, student_number, joined_at, status')
      .in('status', ['pending', 'rejected'])
      .order('joined_at', { ascending: true })
      .then(({ data, error: e }) => {
        if (e) setError(e.message);
        else setPending((data ?? []) as PendingProfile[]);
        setLoading(false);
      });
  }, [canApprove]);

  const handleApprove = async (id: string) => {
    if (!user?.id) return;
    setWorking(id);
    setError('');
    setNotice('');
    try {
      const result = await approvePendingMember(id, user.id);
      if (result.approval === 'success') {
        setPending((prev) => prev.filter((p) => p.id !== id));
        setNotice(
          result.email === 'sent'
            ? 'Member approved and notification sent.'
            : 'Member approved, but the notification email could not be sent.',
        );
      } else if (result.approval === 'not_pending') {
        setPending((prev) => prev.filter((p) => p.id !== id));
        setNotice('Member is already active.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Approval failed.');
    }
    setWorking(null);
  };

  const handleReject = async (id: string) => {
    setWorking(id);
    setError('');
    setNotice('');
    const { error: e } = await supabase.from('profiles').update({ status: 'rejected' }).eq('id', id);
    if (e) { setError(e.message); }
    else { setPending((prev) => prev.filter((p) => p.id !== id)); }
    setWorking(null);
  };

  if (!canApprove) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <p className="text-sm text-gray-400">Access denied.</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-8">
      <div className="max-w-3xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Pending Approvals</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            New members waiting for access to BLW York Hub
          </p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm mb-4">{error}</div>
        )}
        {notice && (
          <div className="bg-green-50 border border-green-200 text-green-700 rounded-lg px-4 py-3 text-sm mb-4">{notice}</div>
        )}

        {loading && (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => <div key={i} className="h-20 bg-gray-100 rounded-lg animate-pulse" />)}
          </div>
        )}

        {!loading && pending.length === 0 && (
          <div className="text-center py-16 bg-white border border-gray-200 rounded-lg">
            <p className="text-3xl mb-3">✅</p>
            <p className="text-base font-semibold text-gray-700">No pending requests</p>
            <p className="text-sm text-gray-400 mt-1">All accounts are up to date</p>
          </div>
        )}

        {!loading && pending.length > 0 && (
          <div className="space-y-3">
            {pending.map((p) => (
              <div key={p.id} className="bg-white border border-gray-200 rounded-lg p-5 flex items-center gap-4">
                <div className="w-10 h-10 rounded-full bg-york-600 text-white flex items-center justify-center text-sm font-bold shrink-0">
                  {getInitials(p.full_name || p.email)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold text-gray-900">{p.full_name || '(no name)'}</p>
                    {p.status === 'rejected' && <Badge variant="error" size="small">Previously rejected</Badge>}
                  </div>
                  <p className="text-sm text-gray-500">{p.email}</p>
                  {p.student_number && (
                    <p className="text-xs text-gray-400 font-mono mt-0.5">#{p.student_number}</p>
                  )}
                  <p className="text-xs text-gray-300 mt-0.5">
                    Applied {new Date(p.joined_at).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <Button
                    variant="primary"
                    size="small"
                    loading={working === p.id}
                    onClick={() => handleApprove(p.id)}
                  >
                    Approve
                  </Button>
                  <Button
                    variant="ghost"
                    size="small"
                    loading={working === p.id}
                    onClick={() => handleReject(p.id)}
                  >
                    Reject
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
