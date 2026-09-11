import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  BookMarked, BookOpen, Calendar, CalendarDays, ClipboardList,
  Download, Flame, Library, LayoutDashboard, Mail, MailOpen,
  Megaphone, MessageSquare, Settings, Star, User, Users,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import type { AuthUser } from '../../lib/auth';
import { GlobalSearch } from '../feature/GlobalSearch';
import { useTheme } from '../../hooks/useTheme';
import { useTranslation } from '../../i18n';

const NAV_ITEMS: { label: string; path: string; icon: LucideIcon; minRole: number }[] = [
  { label: 'Dashboard',        path: '/',                   icon: LayoutDashboard, minRole: 0 },
  { label: 'Events',           path: '/events',             icon: CalendarDays,    minRole: 0 },
  { label: 'Announcements',    path: '/announcements',      icon: Megaphone,       minRole: 0 },
  { label: 'Meetings',         path: '/meetings',           icon: Calendar,        minRole: 0 },
  { label: 'Messages',         path: '/messages',           icon: MessageSquare,   minRole: 0 },
  { label: 'Habits',           path: '/habits',             icon: Flame,           minRole: 0 },
  { label: 'Confessions',      path: '/confessions',        icon: BookOpen,        minRole: 0 },
  { label: 'Testimonies',      path: '/testimonies',        icon: Star,            minRole: 0 },
  { label: 'Daily Bread',      path: '/devotionals',        icon: BookMarked,      minRole: 0 },
  { label: 'Book of Month',    path: '/books',              icon: Library,         minRole: 0 },
  { label: 'CRM / Contacts',   path: '/contacts',           icon: ClipboardList,   minRole: 1 },
  { label: 'Members',          path: '/members',            icon: Users,           minRole: 1 },
  { label: 'Profile',          path: '/profile',            icon: User,            minRole: 0 },
  { label: 'Email Preferences',path: '/email-preferences',  icon: Mail,            minRole: 0 },
  { label: 'Data Export',      path: '/admin/exports',      icon: Download,        minRole: 2 },
  { label: 'Email Log',        path: '/admin/email-log',    icon: MailOpen,        minRole: 2 },
  { label: 'Admin Panel',      path: '/admin',              icon: Settings,        minRole: 2 },
];

const ROLE_LEVEL: Record<AuthUser['role'], number> = {
  member: 0, cell_leader: 1, admin: 2, coordinator: 3,
};

function getInitials(name: string) {
  return name.split(' ').slice(0, 2).map((n) => n[0]).join('').toUpperCase();
}

export interface SidebarProps {
  user: AuthUser | null;
  onSignOut: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  user, onSignOut, collapsed = false, onToggleCollapse,
}) => {
  const navigate = useNavigate();
  const location = useLocation();
  const level = ROLE_LEVEL[user?.role ?? 'member'] ?? 0;
  const visible = NAV_ITEMS.filter((item) => level >= item.minRole);
  const { theme, setTheme } = useTheme();
  const { t } = useTranslation('nav');

  return (
    <aside
      className={cn(
        'shrink-0 bg-white border-r border-gray-200 flex flex-col h-screen sticky top-0 z-20 dark:border-slate-700 dark:bg-slate-900',
        'transition-[width] duration-200 ease-in-out',
        collapsed ? 'w-16' : 'w-56'
      )}
    >
      {/* Logo */}
      <div className={cn('border-b border-gray-100 dark:border-slate-700', collapsed ? 'px-3 py-5' : 'px-5 py-5')}>
        {collapsed ? (
          <div className="flex flex-col items-center gap-2">
            <img src="/logo.png" alt="BLW York" className="w-8 h-8 object-contain" />
            {onToggleCollapse && (
              <button onClick={onToggleCollapse} title="Expand" className="w-6 h-6 flex items-center justify-center text-gray-400 hover:text-gray-700">›</button>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <img src="/logo.png" alt="BLW York" className="w-8 h-8 rounded-md shrink-0" />
              <div>
              <p className="text-sm font-bold text-gray-900 leading-tight dark:text-slate-100">BLW York Hub</p>
                <p className="text-xs text-gray-400">York University</p>
              </div>
            </div>
            {onToggleCollapse && (
              <button onClick={onToggleCollapse} title="Collapse" className="w-6 h-6 flex items-center justify-center text-gray-400 hover:text-gray-700">‹</button>
            )}
          </div>
        )}
      </div>

      <GlobalSearch user={user} collapsed={collapsed} />

      <div className={cn('px-3 pb-2', collapsed && 'px-2')}>
        <button
          type="button"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          className={cn(
            'flex min-h-[40px] w-full items-center rounded-md text-sm font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-slate-300 dark:hover:bg-slate-800',
            collapsed ? 'justify-center' : 'gap-3 px-4',
          )}
          title="Toggle dark mode"
        >
          <span>{theme === 'dark' ? '☀' : '☾'}</span>
          {!collapsed && <span>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>}
        </button>
      </div>

      {/* Nav */}
      <nav className={cn('flex-1 py-3 space-y-0.5 overflow-y-auto', collapsed ? 'px-2' : 'px-3')}>
        {visible.map((item) => {
          const active = location.pathname === item.path;
          return (
            <button
              key={item.path}
              type="button"
              onClick={() => navigate(item.path)}
              title={collapsed ? item.label : undefined}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex items-center rounded-md text-sm font-medium w-full transition-colors duration-150',
                collapsed ? 'justify-center h-10 w-10 mx-auto' : 'gap-3 px-4 py-2.5',
                active
                  ? 'bg-red-50 text-york-600 font-semibold dark:bg-york-900/30 dark:text-york-300'
                  : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-100'
              )}
            >
              <item.icon className="w-4 h-4 shrink-0" />
              {!collapsed && <span>{t(item.label.toLowerCase().replace(/ \/ /g, '_').replace(/\s+/g, '_'))}</span>}
            </button>
          );
        })}
      </nav>

      {/* User footer */}
      {user && (
        <div className={cn('border-t border-gray-100 dark:border-slate-700', collapsed ? 'px-2 py-3' : 'px-4 py-4')}>
          {collapsed ? (
            <div className="flex flex-col items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-york-600 text-white flex items-center justify-center text-xs font-bold">
                {getInitials(user.name)}
              </div>
              <button onClick={onSignOut} title="Sign out" className="text-xs text-gray-400 hover:text-york-600 transition-colors">↪</button>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-york-600 text-white flex items-center justify-center text-xs font-bold shrink-0">
                  {getInitials(user.name)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-gray-900 truncate dark:text-slate-100">{user.name}</p>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-york-100 text-york-700 font-semibold capitalize">
                    {user.role.replace('_', ' ')}
                  </span>
                </div>
              </div>
              <button onClick={onSignOut} className="mt-3 text-xs text-gray-400 hover:text-gray-600 transition-colors">
                Sign out →
              </button>
            </>
          )}
        </div>
      )}
    </aside>
  );
};
