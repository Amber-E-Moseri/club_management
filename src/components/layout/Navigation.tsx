import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  BookMarked, BookOpen, Calendar, CalendarDays, ClipboardList,
  Download, Flame, Library, LayoutDashboard, Mail, MailOpen,
  Megaphone, MessageSquare, Settings, Star, User, Users,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import type { AuthUser } from '../../lib/auth';

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

export interface NavigationProps {
  userRole?: AuthUser['role'];
  mobileOpen?: boolean;
  onMobileToggle?: () => void;
}

export const Navigation: React.FC<NavigationProps> = ({
  userRole = 'member', mobileOpen: externalOpen, onMobileToggle,
}) => {
  const [internalOpen, setInternalOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  const isMobileOpen = externalOpen !== undefined ? externalOpen : internalOpen;
  const handleInternalToggle = useCallback(() => setInternalOpen((v) => !v), []);
  const toggleMobile = onMobileToggle ?? handleInternalToggle;

  useEffect(() => {
    if (!isMobileOpen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') toggleMobile(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isMobileOpen, toggleMobile]);

  const level = ROLE_LEVEL[userRole] ?? 0;
  const visible = NAV_ITEMS.filter((item) => level >= item.minRole);

  const NavLinks = ({ onItemClick }: { onItemClick?: () => void }) => (
    <>
      {visible.map((item) => {
        const active = location.pathname === item.path;
        return (
          <button
            key={item.path}
            type="button"
            onClick={() => { navigate(item.path); onItemClick?.(); }}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex items-center gap-2.5 px-4 py-3 rounded-md text-sm font-medium w-full text-left',
              'transition-colors duration-150 min-h-[44px]',
              active ? 'bg-red-50 text-york-600 font-semibold dark:bg-york-900/30 dark:text-york-300' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-100'
            )}
          >
            <item.icon className="w-4 h-4 shrink-0" /><span>{item.label}</span>
          </button>
        );
      })}
    </>
  );

  return (
    <>
      {/* Mobile hamburger — only rendered in uncontrolled (standalone) mode;
          when MainLayout provides mobileOpen, Header supplies the toggle button */}
      {externalOpen === undefined && (
        <button
          type="button"
          onClick={toggleMobile}
          aria-label="Toggle navigation menu"
          aria-expanded={isMobileOpen}
          className="md:hidden flex items-center justify-center w-10 h-10 rounded-md text-gray-600 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-york-600 transition-colors"
        >
          {isMobileOpen ? (
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          ) : (
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          )}
        </button>
      )}

      {/* Mobile drawer */}
      {isMobileOpen && (
        <>
          <div className="md:hidden fixed inset-0 bg-black/40 z-40" onClick={toggleMobile} aria-hidden="true" />
          <div
            id="mobile-nav-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Navigation menu"
            className="md:hidden fixed left-0 top-0 bottom-0 w-72 bg-white z-50 flex flex-col shadow-xl animate-[slideInLeft_0.25s_ease-out] dark:bg-slate-900"
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-slate-700">
              <div className="flex items-center gap-2">
                <img src="/logo.png" alt="BLW York" className="w-8 h-8 rounded-md" />
                <span className="text-base font-bold text-york-600">BLW York Hub</span>
              </div>
              <button
                onClick={toggleMobile}
                aria-label="Close navigation menu"
                className="w-10 h-10 flex items-center justify-center rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-york-600"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <nav className="flex-1 px-3 py-4 flex flex-col gap-0.5 overflow-y-auto" aria-label="Main navigation">
              <NavLinks onItemClick={toggleMobile} />
            </nav>
          </div>
        </>
      )}
    </>
  );
};
