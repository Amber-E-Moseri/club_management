import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Clock, Users, CalendarDays, Megaphone, BookMarked, CheckSquare,
  BarChart2, KeyRound, ClipboardList, Video, Download, Mail, Settings,
  Heart, ChevronRight, type LucideIcon,
} from 'lucide-react';
import type { AuthUser } from '../lib/auth';

interface Props { user: AuthUser | null; }

const ADMIN_ITEMS: { label: string; desc: string; icon: LucideIcon; path?: string }[] = [
  { label: 'Pending Approvals',    desc: 'Review and approve new member sign-up requests',        icon: Clock,         path: '/admin/pending' },
  { label: 'Manage Members',       desc: 'View, promote, or remove members',                      icon: Users,         path: '/members' },
  { label: 'Manage Events',        desc: 'Schedule or archive club events',                       icon: CalendarDays,  path: '/events' },
  { label: 'Manage Announcements', desc: 'Post or archive announcements',                         icon: Megaphone,     path: '/announcements' },
  { label: 'Daily Bread Upload',   desc: 'Convert monthly PDFs into daily images',                icon: BookMarked,    path: '/admin/devotionals' },
  { label: 'Testimony Moderation', desc: 'Approve or reject submitted testimonies',               icon: CheckSquare,   path: '/admin/testimonies' },
  { label: 'Devotional Reports',   desc: 'View daily devotional engagement stats',                icon: BarChart2,     path: '/admin/reports' },
  { label: 'Role Management',      desc: 'Create custom admin roles and assign permissions',      icon: KeyRound,      path: '/admin/roles' },
  { label: 'Contact Reports',      desc: 'Evangelism and outreach activity analytics',            icon: ClipboardList, path: '/admin/contact-reports' },
  { label: 'Zoom Integration',     desc: 'Connect Zoom to auto-create video meetings',           icon: Video,         path: '/admin/zoom' },
  { label: 'Data Export',          desc: 'Download members, contacts, and attendance backups',    icon: Download,      path: '/admin/exports' },
  { label: 'Email Log',            desc: 'View sent, failed and bounced emails',                  icon: Mail,          path: '/admin/email-log' },
  { label: 'Settings',             desc: 'Club settings and preferences',                         icon: Settings },
  { label: 'Prayer Requests',      desc: 'Moderate prayer request board',                         icon: Heart },
];

export const AdminHub: React.FC<Props> = ({ user }) => {
  const navigate = useNavigate();

  if (!['admin', 'coordinator', 'cell_leader'].includes(user?.role ?? '')) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <p className="text-sm text-gray-400">Access denied.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-4">
      {/* Header */}
      <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-2xl shadow-sm overflow-hidden">
        <div className="border-t-4 border-york-600 px-5 py-5">
          <p className="text-xs font-semibold text-york-600 uppercase tracking-wider">Management</p>
          <h1 className="text-xl font-bold text-gray-900 dark:text-slate-100 mt-1">Admin Panel</h1>
          <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">
            Tools and settings for running the ministry.
          </p>
        </div>
      </div>

      {/* Admin tools grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {ADMIN_ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.label}
              type="button"
              disabled={!item.path}
              onClick={item.path ? () => navigate(item.path!) : undefined}
              className={`flex items-center gap-4 p-4 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-2xl shadow-sm text-left transition-all group ${
                item.path
                  ? 'hover:border-york-300 dark:hover:border-york-700 hover:shadow-md cursor-pointer'
                  : 'opacity-50 cursor-not-allowed'
              }`}
            >
              <div className="w-10 h-10 rounded-xl bg-york-50 dark:bg-york-900/20 flex items-center justify-center shrink-0">
                <Icon className="w-5 h-5 text-york-600 dark:text-york-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-900 dark:text-slate-100 truncate">{item.label}</p>
                <p className="text-xs text-gray-400 dark:text-slate-500 mt-0.5 leading-snug line-clamp-2">{item.desc}</p>
              </div>
              {item.path && (
                <ChevronRight className="w-4 h-4 text-gray-300 dark:text-slate-600 shrink-0 group-hover:translate-x-0.5 transition-transform" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};
