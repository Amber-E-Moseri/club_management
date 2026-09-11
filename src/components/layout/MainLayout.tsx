import React, { useState } from 'react';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { Navigation } from './Navigation';
import { PWAInstallBanner } from '../feature/PWAInstallBanner';
import { cn } from '../../lib/utils';
import type { AuthUser } from '../../lib/auth';

export interface MainLayoutProps {
  children: React.ReactNode;
  user: AuthUser | null;
  onSignOut: () => void;
  showSidebar?: boolean;
}

export const MainLayout: React.FC<MainLayoutProps> = ({
  children, user, onSignOut, showSidebar = true,
}) => {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <div className="flex flex-col min-h-screen bg-gray-50 text-gray-600 dark:bg-slate-950 dark:text-slate-300">
      {/* Skip link for keyboard/screen reader users */}
      <a href="#main-content" className="skip-link">Skip to main content</a>

      {/* Mobile header */}
      <Header
        userName={user?.name}
        userRole={user?.role}
        onLogout={onSignOut}
        className="md:hidden safe-header"
        onMenuToggle={() => setMobileNavOpen((v) => !v)}
        mobileNavOpen={mobileNavOpen}
      />

      {/* Mobile navigation drawer */}
      <Navigation
        userRole={user?.role}
        mobileOpen={mobileNavOpen}
        onMobileToggle={() => setMobileNavOpen((v) => !v)}
      />

      <div className="flex flex-1 min-h-0">
        {showSidebar && (
          <div className="hidden md:block">
            <Sidebar
              user={user}
              onSignOut={onSignOut}
              collapsed={collapsed}
              onToggleCollapse={() => setCollapsed((v) => !v)}
            />
          </div>
        )}

        <div className="flex flex-col flex-1 min-w-0">
          {/* Desktop header */}
          <Header userName={user?.name} userRole={user?.role} onLogout={onSignOut} className="hidden md:flex" />

          <main id="main-content" className={cn('flex-1 overflow-y-auto bg-gray-50 dark:bg-slate-950', 'px-4 py-5 sm:px-6 sm:py-6 lg:px-8 lg:py-8')}>
            {children}
          </main>
        </div>
      </div>
      <PWAInstallBanner />
    </div>
  );
};
