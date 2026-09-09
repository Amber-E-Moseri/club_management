import React, { useState } from 'react';
import { EventCard } from '../components/feature';
import { useAllEvents } from '../hooks/useEvents';
import type { AuthUser } from '../lib/auth';
import type { EventCategory } from '../types';

const CATEGORIES: EventCategory[] = ['Bible Study', 'Worship', 'Fellowship', 'Outreach', 'Prayer', 'Other'];

interface EventsProps { user: AuthUser | null; }

export const Events: React.FC<EventsProps> = () => {
  const { events, loading } = useAllEvents();
  const [filter, setFilter] = useState<EventCategory | 'All'>('All');

  const filtered = filter === 'All' ? events : events.filter((e) => e.category === filter);

  return (
    <div className="flex-1 overflow-y-auto p-8">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-h1 mb-6">Events</h1>

        <div className="flex flex-wrap gap-2 mb-6">
          {(['All', ...CATEGORIES] as const).map((cat) => (
            <button
              key={cat}
              onClick={() => setFilter(cat)}
              className={`text-tiny font-semibold px-3 py-1 rounded-full cursor-pointer transition-colors ${
                filter === cat ? 'bg-york-600 text-white' : 'bg-gray-200 text-gray-600 hover:bg-gray-300'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        {loading ? (
          <p className="text-small text-gray-400">Loading events…</p>
        ) : filtered.length === 0 ? (
          <p className="text-small text-gray-400">No events found.</p>
        ) : (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 divide-y divide-gray-100">
            {filtered.map((e) => <EventCard key={e.id} event={e} />)}
          </div>
        )}
      </div>
    </div>
  );
};
