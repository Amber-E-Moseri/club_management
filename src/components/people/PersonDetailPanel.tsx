import React from 'react';
import { X, Mail, Phone, Calendar, Building2, ExternalLink } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { useUserProfile } from '../../hooks/useUserProfile';
import { PersonStatusBadge } from './PersonStatusBadge';
import { getInitials } from '../../lib/utils';
import type { AuthUser } from '../../lib/auth';

const ROLE_LEVEL: Record<AuthUser['role'], number> = {
  member: 0, cell_leader: 1, admin: 2, coordinator: 3,
};

interface PersonDetailPanelProps {
  memberId: string | null;
  onClose: () => void;
  currentUser: AuthUser;
}

function maskPhone(phone?: string): string {
  if (!phone) return '';
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 7) return phone;
  return `•••-•••-${digits.slice(-4)}`;
}

function safeFormat(dateStr?: string): string {
  if (!dateStr) return '—';
  try { return format(parseISO(dateStr), 'MMMM yyyy'); } catch { return dateStr; }
}

export const PersonDetailPanel: React.FC<PersonDetailPanelProps> = ({
  memberId, onClose, currentUser,
}) => {
  const { profile, loading } = useUserProfile(memberId ?? undefined);
  const level = ROLE_LEVEL[currentUser.role] ?? 0;
  const isAdmin = level >= 2;
  const isOwnProfile = memberId === currentUser.id;

  if (!memberId) return null;

  const displayName = profile
    ? `${profile.firstName} ${profile.lastName}`.trim() || profile.email
    : '…';
  const initials = profile
    ? `${profile.firstName[0] ?? ''}${profile.lastName[0] ?? ''}`.toUpperCase() || profile.email[0]?.toUpperCase()
    : '?';

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/30 dark:bg-black/50 z-40 lg:hidden"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <aside className="fixed right-0 top-0 bottom-0 w-full max-w-sm z-50 bg-white dark:bg-slate-900 shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-gray-100 dark:border-slate-700">
          <h2 className="text-sm font-bold text-gray-900 dark:text-slate-100">Member profile</h2>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-xl flex items-center justify-center hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors"
          >
            <X className="w-4 h-4 text-gray-500" />
          </button>
        </div>

        {loading ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="w-8 h-8 border-4 border-york-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : !profile ? (
          <div className="flex-1 flex items-center justify-center p-6">
            <p className="text-sm text-gray-400">Profile not found.</p>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto">
            {/* Avatar + name */}
            <div className="px-5 pt-6 pb-5 border-b border-gray-100 dark:border-slate-700">
              <div className="flex items-start gap-4">
                <div className="w-16 h-16 rounded-full bg-york-600 text-white flex items-center justify-center text-xl font-bold shrink-0 overflow-hidden">
                  {profile.avatarUrl ? (
                    <img src={profile.avatarUrl} alt={displayName} className="w-full h-full object-cover" />
                  ) : (
                    initials
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-base font-bold text-gray-900 dark:text-slate-100 truncate">{displayName}</h3>
                  {profile.spiritualRole && (
                    <p className="text-xs text-gray-400 dark:text-slate-500 mt-0.5">{profile.spiritualRole}</p>
                  )}
                  <div className="mt-2 flex flex-wrap gap-2">
                    {/* Role badge comes from currentUser since this is the viewer's role -
                        but we need the VIEWED person's role. We read it from profile via UserProfile which
                        joins profiles - however UserProfile doesn't return role. We'll show what we have. */}
                  </div>
                  <div className="mt-2">
                    <span className="text-xs text-gray-400 dark:text-slate-500">
                      Joined {safeFormat(profile.joinedAt)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Quick actions */}
              {(isAdmin || isOwnProfile) && (
                <div className="flex gap-2 mt-4">
                  {profile.email && (
                    <a
                      href={`mailto:${profile.email}`}
                      className="flex items-center gap-1.5 h-8 px-3 text-xs font-semibold text-york-600 dark:text-york-400 border border-york-200 dark:border-york-800 rounded-lg hover:bg-york-50 dark:hover:bg-york-900/20 transition-colors"
                    >
                      <Mail className="w-3.5 h-3.5" /> Email
                    </a>
                  )}
                  {profile.phone && isAdmin && (
                    <a
                      href={`tel:${profile.phone}`}
                      className="flex items-center gap-1.5 h-8 px-3 text-xs font-semibold text-gray-600 dark:text-slate-400 border border-gray-200 dark:border-slate-700 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors"
                    >
                      <Phone className="w-3.5 h-3.5" /> Call
                    </a>
                  )}
                </div>
              )}
            </div>

            {/* Details */}
            <div className="px-5 py-4 space-y-4">
              {/* Contact info */}
              <section>
                <p className="text-[10px] font-bold text-gray-400 dark:text-slate-500 uppercase tracking-wider mb-2">Contact</p>
                <div className="space-y-2">
                  <Detail icon={<Mail className="w-3.5 h-3.5" />} label="Email" value={profile.email} />
                  {isAdmin ? (
                    <Detail icon={<Phone className="w-3.5 h-3.5" />} label="Phone" value={profile.phone || '—'} />
                  ) : profile.phone ? (
                    <Detail icon={<Phone className="w-3.5 h-3.5" />} label="Phone" value={maskPhone(profile.phone)} />
                  ) : null}
                </div>
              </section>

              {/* Ministry info */}
              <section>
                <p className="text-[10px] font-bold text-gray-400 dark:text-slate-500 uppercase tracking-wider mb-2">Ministry</p>
                <div className="space-y-2">
                  {profile.cellName && (
                    <Detail icon={<Building2 className="w-3.5 h-3.5" />} label="Cell" value={profile.cellName} />
                  )}
                  {profile.bscAssignment && (
                    <Detail icon={<Building2 className="w-3.5 h-3.5" />} label="BSC" value={profile.bscAssignment} />
                  )}
                  <Detail icon={<Calendar className="w-3.5 h-3.5" />} label="Joined" value={safeFormat(profile.joinedAt)} />
                  {isAdmin && profile.studentNumber && (
                    <Detail icon={<ExternalLink className="w-3.5 h-3.5" />} label="Student #" value={profile.studentNumber} />
                  )}
                </div>
              </section>

              {/* Bio */}
              {profile.bio && (
                <section>
                  <p className="text-[10px] font-bold text-gray-400 dark:text-slate-500 uppercase tracking-wider mb-2">About</p>
                  <p className="text-sm text-gray-600 dark:text-slate-300 leading-relaxed">{profile.bio}</p>
                </section>
              )}

              {/* Outreach bridge — admin only, non-self */}
              {isAdmin && !isOwnProfile && (
                <section className="pt-2 border-t border-gray-100 dark:border-slate-700">
                  <a
                    href="/contacts"
                    className="flex items-center gap-2 text-xs font-semibold text-york-600 dark:text-york-400 hover:underline"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    View outreach records
                  </a>
                </section>
              )}
            </div>
          </div>
        )}
      </aside>
    </>
  );
};

const Detail: React.FC<{ icon: React.ReactNode; label: string; value: string }> = ({ icon, label, value }) => (
  <div className="flex items-start gap-2">
    <span className="w-4 h-4 mt-0.5 text-gray-300 dark:text-slate-600 shrink-0">{icon}</span>
    <div className="min-w-0">
      <p className="text-[10px] text-gray-400 dark:text-slate-500 font-medium">{label}</p>
      <p className="text-sm text-gray-800 dark:text-slate-200 break-words">{value}</p>
    </div>
  </div>
);
