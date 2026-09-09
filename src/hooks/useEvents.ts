import { useState, useEffect } from 'react';
import { getUpcomingEvents, getAllEvents } from '../lib/queries';
import type { Event } from '../types';

export function useUpcomingEvents(limit = 3) {
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getUpcomingEvents(limit)
      .then(setEvents)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [limit]);

  return { events, loading, error };
}

export function useAllEvents() {
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getAllEvents()
      .then(setEvents)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return { events, loading, error };
}
