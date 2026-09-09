import React, { useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import { MainLayout } from './components/layout/MainLayout';
import { Dashboard } from './pages/Dashboard';
import { Events } from './pages/Events';
import { Members } from './pages/Members';
import { Announcements } from './pages/Announcements';
import { UserProfile } from './pages/UserProfile';
import { AdminPanel } from './pages/AdminPanel';
import { AdminDevotionalReport } from './pages/AdminDevotionalReport';
import { Login } from './pages/Login';
import { ContactLogging } from './pages/ContactLogging';
import { DailyConfessions } from './pages/DailyConfessions';
import { TestimonyLog } from './pages/TestimonyLog';
import { Meetings } from './pages/Meetings';
import { DevotionalViewer } from './pages/DevotionalViewer';
import { AdminDevotionalUpload } from './pages/AdminDevotionalUpload';
import { AdminTestimonies } from './pages/AdminTestimonies';
import { BookOfMonthPage } from './pages/BookOfMonth';
import { WeeklyMessages } from './pages/WeeklyMessages';
import { HabitTracker } from './pages/HabitTracker';
import { AdminRoleManagement } from './pages/AdminRoleManagement';
import { AdminContactReports } from './pages/AdminContactReports';
import { EmailPreferences } from './pages/EmailPreferences';
import { AdminZoomSettings } from './pages/AdminZoomSettings';
import { AdminDataExport } from './pages/AdminDataExport';
import { AdminEmailLog } from './pages/AdminEmailLog';
import { PushPermissionPrompt } from './components/feature/PushPermissionPrompt';
import { usePushNotifications } from './hooks/usePushNotifications';
import { PendingApproval } from './pages/PendingApproval';
import { AdminPendingApprovals } from './pages/AdminPendingApprovals';

function AppShell() {
  const { user, loading, error, signIn, signUp, signOut } = useAuth();
  const { subscribe } = usePushNotifications(user?.id);
  const [showPushPrompt, setShowPushPrompt] = useState(true);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-york-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) {
    return <Login onSignIn={signIn} onSignUp={signUp} error={error} loading={loading} />;
  }

  if (user.status === 'pending' || user.status === 'rejected') {
    return <PendingApproval user={user} onSignOut={signOut} />;
  }

  return (
    <MainLayout user={user} onSignOut={signOut}>
      <Routes>
        <Route path="/" element={<Dashboard user={user} />} />
        <Route path="/events" element={<Events user={user} />} />
        <Route path="/members" element={<Members user={user} />} />
        <Route path="/announcements" element={<Announcements user={user} />} />
        <Route path="/devotionals" element={<DevotionalViewer user={user} />} />
        <Route path="/profile" element={<UserProfile currentUser={user} />} />
        <Route path="/email-preferences" element={<EmailPreferences user={user} />} />
        <Route path="/admin" element={<AdminPanel user={user} />} />
        <Route path="/admin/devotionals" element={<AdminDevotionalUpload user={user} />} />
        <Route path="/admin/testimonies" element={<AdminTestimonies user={user} />} />
        <Route path="/admin/reports" element={<AdminDevotionalReport user={user} />} />
        <Route path="/admin/roles" element={<AdminRoleManagement user={user} />} />
        <Route path="/admin/contact-reports" element={<AdminContactReports user={user} />} />
        <Route path="/admin/zoom" element={<AdminZoomSettings user={user} />} />
        <Route path="/admin/exports" element={<AdminDataExport user={user} />} />
        <Route path="/admin/email-log" element={<AdminEmailLog user={user} />} />
        <Route path="/admin/pending" element={<AdminPendingApprovals user={user} />} />
        <Route path="/books" element={<BookOfMonthPage user={user} />} />
        <Route path="/contacts" element={<ContactLogging user={user} />} />
        <Route path="/confessions" element={<DailyConfessions user={user} />} />
        <Route path="/testimonies" element={<TestimonyLog user={user} />} />
        <Route path="/meetings" element={<Meetings user={user} />} />
        <Route path="/messages" element={<WeeklyMessages user={user} />} />
        <Route path="/habits" element={<HabitTracker user={user} />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      {showPushPrompt && (
        <PushPermissionPrompt
          onAllow={async () => { setShowPushPrompt(false); await subscribe(); }}
          onDismiss={() => setShowPushPrompt(false)}
        />
      )}
    </MainLayout>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppShell />
    </BrowserRouter>
  );
}
