import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ActivityFeed, AnnouncementCard, BookWidget, EventCard, StatCard } from '../components/feature';
import { Badge } from '../components/foundation/Badge';
import { Button } from '../components/foundation/Button';
import { useDashboardStats } from '../hooks/useDashboardStats';
import { useCurrentWeekMessage } from '../hooks/useWeeklyMessages';
import { useHabits } from '../hooks/useHabits';
import { useDevotional } from '../hooks/useDevotional';
import { getAnnouncements, getUpcomingEvents, rsvpEvent } from '../lib/queries';
import type { Announcement, Event } from '../types';
import type { AuthUser } from '../lib/auth';
import { useTranslation } from '../i18n';

interface DashboardProps {
  user: AuthUser | null;
}

export const Dashboard: React.FC<DashboardProps> = ({ user }) => {
  const navigate = useNavigate();
  const { t } = useTranslation('dashboard');
  const { stats, activity, meetings, loading, error } = useDashboardStats(user);
  const { message } = useCurrentWeekMessage();
  const { habitsWithStats } = useHabits(user?.id);
  const devotional = useDevotional();
  const [events, setEvents] = useState<Event[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);

  useEffect(() => {
    getUpcomingEvents(3).then(setEvents).catch(console.error);
    getAnnouncements(3).then(setAnnouncements).catch(console.error);
  }, []);

  async function handleRsvp(eventId: string) {
    if (!user) return;
    await rsvpEvent(eventId, user.id);
    setEvents((ev) => ev.map((e) => e.id === eventId ? { ...e, user_rsvp: true } : e));
  }

  const role = user?.role ?? 'member';
  const isAdmin = role === 'admin' || role === 'coordinator';
  const isCellLeader = role === 'cell_leader';
  const isMember = role === 'member';
  const firstName = user?.name?.split(' ')[0] ?? 'there';
  const today = format(new Date(), 'EEEE, MMMM d, yyyy');
  const doneHabits = habitsWithStats.filter((h) => h.today_status === 'done').length;
  const topHabits = habitsWithStats.slice(0, 3);

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-gray-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
        <div className="border-t-4 border-york-600 px-5 py-5 sm:px-6">
          <p className="text-small text-gray-400">{today}</p>
          <div className="mt-1 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h1 className="text-h1 dark:text-slate-100">{t('welcome', { name: firstName })}</h1>
              <p className="text-small text-gray-500 dark:text-slate-300">
                {loading ? 'Loading your portal snapshot...' : 'Your ministry, meetings, and personal progress at a glance.'}
              </p>
            </div>
            <Button onClick={() => navigate('/devotionals')}>Open Daily Bread</Button>
          </div>
        </div>
      </div>

      {error && <div className="rounded-md border border-york-200 bg-york-50 p-4 text-small text-york-700">{error}</div>}

      {stats && (
        <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
          <StatCard label="Members" value={stats.member_count} sub={`${stats.member_growth} this month`} />
          <StatCard label="Meetings" value={stats.meetings_this_month} sub="This month" />
          <StatCard label="Testimonies" value={stats.testimonies_this_month} sub="This month" />
          <StatCard label="Contacts" value={stats.contacts_this_week} sub="This week" />
          {isCellLeader && <StatCard label="Cell Contacts" value={stats.cell_contacts_this_week ?? 0} sub="This week" />}
          {isMember && (
            <>
              <StatCard label="Habit Streak" value={stats.habit_streak_avg ?? 0} sub="7-day average" />
              <StatCard label="Devotionals" value={stats.devotional_views_this_month ?? 0} sub="Viewed this month" />
            </>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <section className="rounded-lg border border-gray-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
              <div className="section-header px-6 pt-5 pb-0">
                <h2 className="text-h3">Today&apos;s Devotional</h2>
                <button onClick={() => navigate('/devotionals')} className="see-all-link">Open</button>
              </div>
              <div className="divider mx-6" />
              <div className="px-6 pb-5">
                {devotional.page ? (
                  <div className="space-y-3">
                    <img src={devotional.page.image_url} alt="Today's devotional" className="aspect-[2/1] w-full rounded-md border border-gray-200 object-contain dark:border-slate-700" />
                    <div>
                      <p className="text-small font-bold text-gray-900 dark:text-slate-100">Day {devotional.page.day_of_month}: {devotional.page.title || devotional.devotional?.title}</p>
                      <p className="text-tiny text-gray-400">Pages {devotional.page.page_range}</p>
                    </div>
                    {devotional.view && <Badge variant="success" size="small">Viewed today</Badge>}
                  </div>
                ) : (
                  <p className="text-small text-gray-400">No devotional is available for today.</p>
                )}
              </div>
            </section>

            <section className="rounded-lg border border-gray-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
              <div className="section-header px-6 pt-5 pb-0">
                <h2 className="text-h3">Message of the Week</h2>
                <button onClick={() => navigate('/messages')} className="see-all-link">Read</button>
              </div>
              <div className="divider mx-6" />
              <div className="px-6 pb-5">
                {message ? (
                  <div className="space-y-2">
                    <p className="text-tiny font-bold uppercase text-york-600">{message.author_name || 'Coordinator'}</p>
                    <p className="text-small font-bold text-gray-900 dark:text-slate-100">{message.title}</p>
                    <p className="line-clamp-2 text-small text-gray-500 dark:text-slate-300">{message.body}</p>
                    {message.drive_link && <a href={message.drive_link} target="_blank" rel="noreferrer" className="text-small font-semibold text-york-600">Open resource</a>}
                  </div>
                ) : (
                  <p className="text-small text-gray-400">No weekly message is scheduled.</p>
                )}
              </div>
            </section>

            <section className="rounded-lg border border-gray-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
              <div className="section-header px-6 pt-5 pb-0">
                <h2 className="text-h3">Daily Habits</h2>
                <button onClick={() => navigate('/habits')} className="see-all-link">View all</button>
              </div>
              <div className="divider mx-6" />
              <div className="space-y-3 px-6 pb-5">
                {topHabits.length === 0 ? (
                  <p className="text-small text-gray-400">No habits set up yet.</p>
                ) : (
                  <>
                    {topHabits.map((habit) => (
                      <div key={habit.template.id} className="flex items-center justify-between text-small">
                        <span className="font-semibold text-gray-900 dark:text-slate-100">{habit.template.name}</span>
                        <span className={habit.today_status === 'done' ? 'font-bold text-success' : 'text-gray-400'}>
                          {habit.today_status === 'done' ? 'Completed' : 'Not completed'}
                        </span>
                      </div>
                    ))}
                    <p className="text-tiny text-gray-400">{doneHabits} of {habitsWithStats.length} today</p>
                  </>
                )}
              </div>
            </section>

            <section className="rounded-lg border border-gray-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
              <div className="section-header px-6 pt-5 pb-0">
                <h2 className="text-h3">Upcoming Events</h2>
                <button onClick={() => navigate('/events')} className="see-all-link">See all</button>
              </div>
              <div className="divider mx-6" />
              <div className="pb-2">
                {events.length === 0
                  ? <p className="px-6 py-4 text-small text-gray-400">No upcoming events.</p>
                  : events.map((e) => <EventCard key={e.id} event={e} onRsvp={handleRsvp} />)}
              </div>
            </section>
          </div>

          <BookWidget />

          {(isAdmin || isCellLeader) && (
            <section className="rounded-lg border border-gray-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
              <div className="section-header px-6 pt-5 pb-0">
                <h2 className="text-h3">Contacts Logged</h2>
              </div>
              <div className="divider mx-6" />
              <div className="h-72 px-4 pb-5">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={stats?.contacts_last_7_days ?? []}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" />
                    <YAxis allowDecimals={false} />
                    <Tooltip />
                    <Bar dataKey="count" fill="#E31837" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>
          )}
        </div>

        <aside className="space-y-6">
          <section className="rounded-lg border border-gray-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
            <div className="section-header px-6 pt-5 pb-0">
              <h2 className="text-h3">Upcoming Meetings</h2>
              <button onClick={() => navigate('/meetings')} className="see-all-link">Open</button>
            </div>
            <div className="divider mx-6" />
            <div className="space-y-3 px-6 pb-5">
              {meetings.length === 0 ? (
                <p className="text-small text-gray-400">No meetings scheduled.</p>
              ) : meetings.map((meeting) => (
                <div key={meeting.id} className="rounded-md border border-gray-200 p-3 dark:border-slate-700">
                  <p className="text-small font-bold text-gray-900 dark:text-slate-100">{meeting.title}</p>
                  <p className="text-tiny text-york-600">{meeting.date} - {meeting.time}</p>
                  {meeting.location && <p className="text-tiny text-gray-400">{meeting.location}</p>}
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-lg border border-gray-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
            <div className="section-header px-6 pt-5 pb-0">
              <h2 className="text-h3">Announcements</h2>
              <button onClick={() => navigate('/announcements')} className="see-all-link">See all</button>
            </div>
            <div className="divider mx-6" />
            <div className="px-6 pb-4">
              {announcements.length === 0
                ? <p className="py-4 text-small text-gray-400">No announcements yet.</p>
                : announcements.map((a) => <AnnouncementCard key={a.id} announcement={a} />)}
            </div>
          </section>
        </aside>
      </div>

      <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800">
        <h2 className="text-h3">Recent Activity</h2>
        <div className="divider" />
        <ActivityFeed items={activity} />
      </section>
    </div>
  );
};
