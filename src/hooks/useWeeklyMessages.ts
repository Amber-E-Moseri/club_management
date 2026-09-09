import { useState, useEffect, useCallback } from 'react';
import {
  fetchCurrentWeekOrgMessage,
  fetchMonthMessages,
  fetchWeekMessages,
  createWeeklyMessage,
  updateWeeklyMessage,
  deleteWeeklyMessage,
} from '../lib/queries/weeklyMessages';
import type { WeeklyMessage, WeeklyMessageInput } from '../types';

export function useCurrentWeekMessage() {
  const [message, setMessage] = useState<WeeklyMessage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    fetchCurrentWeekOrgMessage()
      .then((m) => { if (mounted) setMessage(m); })
      .catch((e: Error) => { if (mounted) setError(e.message); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, []);

  return { message, loading, error };
}

export function useMonthMessages(year: number, month: number, userId?: string) {
  const [messages, setMessages] = useState<WeeklyMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    let mounted = true;
    setLoading(true);
    fetchMonthMessages(year, month, userId)
      .then((m) => { if (mounted) setMessages(m); })
      .catch((e: Error) => { if (mounted) setError(e.message); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [year, month, userId]);

  useEffect(() => load(), [load]);

  return { messages, loading, error, reload: load };
}

export function useWeekMessages(weekStart: string, userId?: string) {
  const [messages, setMessages] = useState<WeeklyMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    let mounted = true;
    setLoading(true);
    fetchWeekMessages(weekStart, userId)
      .then((m) => { if (mounted) setMessages(m); })
      .catch((e: Error) => { if (mounted) setError(e.message); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [weekStart, userId]);

  useEffect(() => load(), [load]);

  return { messages, loading, error, reload: load };
}

export function useWeeklyMessageMutations(reload: () => void) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = useCallback(
    async (
      input: WeeklyMessageInput,
      userId: string,
      authorName: string,
      id?: string,
    ) => {
      setSaving(true);
      setError(null);
      try {
        if (id) {
          await updateWeeklyMessage(id, input);
        } else {
          await createWeeklyMessage(input, userId, authorName);
        }
        reload();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Save failed.');
      } finally {
        setSaving(false);
      }
    },
    [reload],
  );

  const remove = useCallback(
    async (id: string) => {
      setSaving(true);
      setError(null);
      try {
        await deleteWeeklyMessage(id);
        reload();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Delete failed.');
      } finally {
        setSaving(false);
      }
    },
    [reload],
  );

  return { save, remove, saving, error };
}
