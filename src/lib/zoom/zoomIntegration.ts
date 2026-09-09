import { supabase } from '../supabase';
import type { ZoomParticipant, ZoomMeetingData, Meeting } from '../../types';

export interface CreateZoomMeetingInput {
  topic: string;
  startTime: string;
  durationMinutes: number;
  timezone?: string;
  password?: boolean;
}

/**
 * Create a Zoom meeting via the Supabase Edge Function.
 * The Zoom Server-to-Server OAuth credentials live in Supabase project secrets.
 */
export async function createZoomMeeting(
  input: CreateZoomMeetingInput
): Promise<ZoomMeetingData> {
  const { data, error } = await supabase.functions.invoke('zoom-api', {
    body: { action: 'create_meeting', ...input },
  });
  if (error) throw new Error(`Zoom create failed: ${error.message}`);
  return data as ZoomMeetingData;
}

/** Fetch info about an existing Zoom meeting. */
export async function getZoomMeetingInfo(
  zoomMeetingId: string
): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.functions.invoke('zoom-api', {
    body: { action: 'get_meeting', zoomMeetingId },
  });
  if (error) throw new Error(`Zoom get failed: ${error.message}`);
  return data as Record<string, unknown>;
}

/** Delete a Zoom meeting by its Zoom-issued ID. */
export async function deleteZoomMeeting(zoomMeetingId: string): Promise<void> {
  const { error } = await supabase.functions.invoke('zoom-api', {
    body: { action: 'delete_meeting', zoomMeetingId },
  });
  if (error) throw new Error(`Zoom delete failed: ${error.message}`);
}

/** Fetch the participant list for a completed Zoom meeting. */
export async function getZoomAttendees(
  zoomMeetingId: string
): Promise<ZoomParticipant[]> {
  const { data, error } = await supabase.functions.invoke('zoom-api', {
    body: { action: 'get_participants', zoomMeetingId },
  });
  if (error) throw new Error(`Zoom participants failed: ${error.message}`);
  return (data as { participants: ZoomParticipant[] }).participants ?? [];
}

/** Verify that the Zoom credentials are valid and the connection is active. */
export async function testZoomConnection(): Promise<boolean> {
  try {
    const { data, error } = await supabase.functions.invoke('zoom-api', {
      body: { action: 'test_connection' },
    });
    if (error) return false;
    return !!(data as { ok: boolean }).ok;
  } catch {
    return false;
  }
}

/**
 * Generate an iCal (.ics) string for downloading a calendar invite.
 * Suitable for attaching to email or letting the user download.
 */
export function generateCalendarInvite(meeting: Meeting): string {
  const startDate = new Date(`${meeting.date}T${meeting.time}`);
  const endDate = meeting.end_time
    ? new Date(`${meeting.date}T${meeting.end_time}`)
    : new Date(startDate.getTime() + 2 * 60 * 60 * 1000);

  const fmt = (d: Date) =>
    d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

  const location = meeting.zoom_join_url
    ? meeting.zoom_join_url
    : meeting.location ?? '';

  const description = meeting.zoom_join_url
    ? `Join Zoom Meeting: ${meeting.zoom_join_url}${meeting.zoom_password ? `\\nMeeting Password: ${meeting.zoom_password}` : ''}`
    : meeting.description ?? '';

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//BLW York Hub//Portal//EN',
    'BEGIN:VEVENT',
    `SUMMARY:${meeting.title}`,
    `DTSTART:${fmt(startDate)}`,
    `DTEND:${fmt(endDate)}`,
    `LOCATION:${location}`,
    `DESCRIPTION:${description}`,
    meeting.zoom_join_url ? `URL:${meeting.zoom_join_url}` : '',
    `UID:meeting-${meeting.id}@christianclub.york`,
    'END:VEVENT',
    'END:VCALENDAR',
  ]
    .filter(Boolean)
    .join('\r\n');
}

/** Trigger a browser download of the iCal file. */
export function downloadCalendarInvite(meeting: Meeting): void {
  const ics = generateCalendarInvite(meeting);
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${meeting.title.replace(/\s+/g, '-')}.ics`;
  a.click();
  URL.revokeObjectURL(url);
}
