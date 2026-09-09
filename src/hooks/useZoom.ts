import { useState, useEffect, useCallback } from 'react';
import type { ZoomSettings, ZoomAttendance, ZoomMeetingData } from '../types';
import {
  createZoomMeeting,
  getZoomAttendees,
  testZoomConnection,
  type CreateZoomMeetingInput,
} from '../lib/zoom/zoomIntegration';
import {
  fetchZoomSettings,
  upsertZoomSettings,
  fetchZoomAttendance,
  createZoomAttendance,
  matchZoomAttendeesToMembers,
  updateMeetingWithZoom,
} from '../lib/queries/zoomMeetings';

export function useZoomSettings() {
  const [settings, setSettings] = useState<ZoomSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchZoomSettings();
        if (!cancelled) setSettings(data);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return { settings, loading, error };
}

export function useCreateZoomMeeting() {
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = useCallback(async (
    meetingId: string,
    input: CreateZoomMeetingInput
  ): Promise<ZoomMeetingData | null> => {
    setCreating(true);
    setError(null);
    try {
      const zoomData = await createZoomMeeting(input);
      await updateMeetingWithZoom(meetingId, zoomData);
      return zoomData;
    } catch (err) {
      setError((err as Error).message);
      return null;
    } finally {
      setCreating(false);
    }
  }, []);

  return { create, creating, error };
}

export function useZoomMeetingLink(meetingId: string | undefined) {
  const [joinUrl, setJoinUrl] = useState<string | null>(null);
  const [startUrl, setStartUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!meetingId) return;
    // Join/start URLs are stored on the meeting row — fetch from DB via useMeeting hook
    // This hook is a lightweight accessor when you already have the URLs
  }, [meetingId]);

  return { joinUrl, startUrl, setJoinUrl, setStartUrl };
}

export function useZoomAttendance(meetingId: string | undefined) {
  const [attendees, setAttendees] = useState<ZoomAttendance[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!meetingId) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const data = await fetchZoomAttendance(meetingId);
        if (!cancelled) setAttendees(data);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [meetingId]);

  return { attendees, loading };
}

export function useSyncZoomAttendance() {
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sync = useCallback(async (meetingId: string, zoomMeetingId: string): Promise<void> => {
    setSyncing(true);
    setError(null);
    try {
      const participants = await getZoomAttendees(zoomMeetingId);
      const matched = await matchZoomAttendeesToMembers(participants);
      const records = matched.map((p) => ({
        id: crypto.randomUUID(),
        meeting_id: meetingId,
        zoom_participant_id: p.id,
        participant_name: p.name,
        participant_email: p.user_email,
        member_id: p.member_id,
        join_time: p.join_time,
        leave_time: p.leave_time,
        duration_minutes: Math.round(p.duration / 60),
        synced_from_zoom: true,
        created_at: new Date().toISOString(),
      }));
      await createZoomAttendance(meetingId, records);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSyncing(false);
    }
  }, []);

  return { sync, syncing, error };
}

export function useTestZoomConnection() {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  const test = useCallback(async (): Promise<void> => {
    setTesting(true);
    setResult(null);
    setError(null);
    try {
      const ok = await testZoomConnection();
      setResult(ok);
      if (!ok) setError('Connection test failed — check credentials in Supabase secrets.');
      else await upsertZoomSettings({ is_active: true });
    } catch (err) {
      setError((err as Error).message);
      setResult(false);
    } finally {
      setTesting(false);
    }
  }, []);

  return { test, testing, result, error };
}
