import React, { useState } from 'react';
import { Calendar } from 'lucide-react';
import { EventCard } from '../components/feature';
import { useAllEvents } from '../hooks/useEvents';
import type { AuthUser } from '../lib/auth';
import type { EventCategory } from '../types';

const CATEGORIES: EventCategory[] = ['Bible Study', 'Worship', 'Fellowship', 'Outreach', 'Prayer', 'Other'];

interface Props { user: AuthUser | null; }

export const Events: React.FC<Props> = () => {
  const { events, loading, error } = useAllEvents();
  const [filter, setFilter] = useState<EventCategory | 'All'>('All');

  const todayStr = new Date().toISOString().split('T')[0];
  const upcomingCount = events.filter((e) => e.date >= todayStr).length;
  const filtered = filter === 'All' ? events : events.filter((e) => e.category === filter);

  return (
    <div className="space-y-5 pb-4">
      {/* Header */}
      <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-2xl shadow-sm overflow-hidden">
        <div className="border-t-4 border-york-600 px-5 py-5">
          <p className="text-xs font-semibold text-york-600 uppercase tracking-wider">Calendar</p>
          <h1 className="text-xl font-bold text-gray-900 dark:text-slate-100 mt-1">Events & services</h1>
          <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">
            Everything the community needs to know, in one rhythm.
          </p>
        </div>
      </div>

      {/* Stats strip */}
      {!loading && (
        <div className="grid grid-cols-2 gap-3">
          <StatChip label="Upcoming" value={upcomingCount} />
          <StatChip label="Total events" value={events.length} />
        </div>
      )}

      {/* Category filter pills */}
      <div className="flex gap-1.5 flex-wrap">
        {(['All', ...CATEGORIES] as const).map((cat) => (
          <button
            key={cat}
            type="button"
            onClick={() => setFilter(cat)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
              filter === cat
                ? 'bg-york-600 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600'
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-xl border border-york-200 bg-york-50 p-4 text-sm text-york-700">
          {error}
        </div>
      )}

      {/* Event list */}
      {loading ? (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-20 bg-gray-100 dark:bg-slate-800 rounded-2xl animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 bg-white border border-gray-200 rounded-2xl dark:bg-slate-800 dark:border-slate-700">
          <Calendar className="w-10 h-10 mx-auto mb-3 text-gray-300 dark:text-slate-600" />
          <p className="text-base font-semibold text-gray-700 dark:text-slate-300">No events found</p>
          {filter !== 'All' && (
            <button
              type="button"
              onClick={() => setFilter('All')}
              className="mt-3 text-sm text-york-600 hover:text-york-700 font-medium"
            >
              Clear filter
            </button>
          )}
        </div>
      ) : (
        <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-2xl shadow-sm overflow-hidden">
          <div className="divide-y divide-gray-100 dark:divide-slate-700">
            {filtered.map((e) => <EventCard key={e.id} event={e} />)}
          </div>
        </div>
      )}
    </div>
  );
};

const StatChip: React.FC<{ label: string; value: number }> = ({ label, value }) => (
  <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-2xl shadow-sm px-4 py-3">
    <p className="text-[10px] font-bold text-gray-400 dark:text-slate-500 uppercase tracking-wider">{label}</p>
    <p className="text-2xl font-bold text-gray-900 dark:text-slate-100 mt-0.5">{value}</p>
  </div>
);
