import React, { useEffect, useState } from 'react';
import { getInitials } from '../lib/utils';
import { Badge } from '../components/foundation/Badge';
import { Input } from '../components/foundation/Input';
import { getMembers } from '../lib/queries';
import type { AuthUser } from '../lib/auth';
import type { Member } from '../types';

interface Props { user: AuthUser | null; }

const LEADER_ROLES = new Set(['cell_leader', 'admin', 'coordinator']);

export const Members: React.FC<Props> = ({ user }) => {
  const [members, setMembers] = useState<Member[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const userRole = user?.role ?? 'member';
  const isAdmin = userRole === 'admin' || userRole === 'coordinator';
  const isCellLeader = isAdmin || userRole === 'cell_leader';

  useEffect(() => {
    getMembers().then(setMembers).catch(console.error).finally(() => setLoading(false));
  }, []);

  const filtered = members.filter(
    (m) =>
      m.full_name.toLowerCase().includes(search.toLowerCase()) ||
      m.email.toLowerCase().includes(search.toLowerCase())
  );

  // Whether the current viewer can see a given member's contact info
  const canSeeContact = (m: Member) =>
    LEADER_ROLES.has(m.role) || isCellLeader;

  const roleVariant = (role: string) =>
    role === 'admin' || role === 'coordinator' ? 'error'
    : role === 'cell_leader' ? 'info'
    : 'gray';

  return (
    <div className="flex-1 overflow-y-auto p-8">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-h1">Members</h1>
            <p className="text-sm text-gray-400 mt-0.5">{members.length} active members</p>
          </div>
        </div>

        <div className="mb-4 max-w-xs">
          <Input
            placeholder="Search by name or email…"
            value={search}
            onChange={setSearch}
          />
        </div>

        {loading ? (
          <p className="text-small text-gray-400">Loading…</p>
        ) : (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Role</th>
                  <th>Contact</th>
                  {isAdmin && <th>Student #</th>}
                  <th>Joined</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((m) => {
                  const showContact = canSeeContact(m);
                  const isLeader = LEADER_ROLES.has(m.role);
                  return (
                    <tr key={m.id}>
                      <td>
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-york-600 text-white flex items-center justify-center text-tiny font-bold shrink-0">
                            {getInitials(m.full_name)}
                          </div>
                          <span className="font-semibold text-gray-900">{m.full_name}</span>
                        </div>
                      </td>
                      <td>
                        <Badge variant={roleVariant(m.role) as 'error' | 'info' | 'gray'}>
                          {m.role.replace('_', ' ')}
                        </Badge>
                        {isLeader && (
                          <span className="ml-1.5 text-xs text-york-600 font-semibold">★</span>
                        )}
                      </td>
                      <td>
                        {showContact ? (
                          <div className="space-y-0.5">
                            <p className="text-sm text-gray-700">{m.email}</p>
                            {m.phone && (
                              <p className="text-xs text-gray-400">{m.phone}</p>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-gray-300 italic">—</span>
                        )}
                      </td>
                      {isAdmin && (
                        <td>
                          <span className="text-sm text-gray-500 font-mono">
                            {m.student_number ?? '—'}
                          </span>
                        </td>
                      )}
                      <td className="text-sm text-gray-500">
                        {new Date(m.joined_at).toLocaleDateString()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <p className="text-xs text-gray-400 mt-3">
          ★ Leader contact info is visible to all members. Student numbers are admin-only.
        </p>
      </div>
    </div>
  );
};
