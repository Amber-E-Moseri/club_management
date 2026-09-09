import { supabase } from '../supabase';
import type { ZoomSettings, ZoomAttendance, ZoomMeetingData, ZoomParticipant } from '../../types';

export async function updateMeetingWithZoom(
  meetingId: string,
  zoomData: ZoomMeetingData
): Promise<void> {
  const { error } = await supabase
    .from('meetings')
    .update({
      zoom_meeting_id: zoomData.zoom_meeting_id,
      zoom_join_url: zoomData.zoom_join_url,
      zoom_start_url: zoomData.zoom_start_url,
      zoom_password: zoomData.zoom_password,
      zoom_created: zoomData.zoom_created,
    })
    .eq('id', meetingId);
  if (error) throw error;
}

export async function fetchZoomSettings(): Promise<ZoomSettings | null> {
  const { data, error } = await supabase
    .from('zoom_settings')
    .select('*')
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function upsertZoomSettings(
  patch: Partial<Pick<ZoomSettings, 'zoom_account_id' | 'zoom_user_id' | 'is_active'>>
): Promise<ZoomSettings> {
  const existing = await fetchZoomSettings();
  if (existing) {
    const { data, error } = await supabase
      .from('zoom_settings')
      .update(patch)
      .eq('id', existing.id)
      .select()
      .single();
    if (error) throw error;
    return data;
  }
  const { data, error } = await supabase
    .from('zoom_settings')
    .insert(patch)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Save a batch of Zoom participant records for a given meeting. */
export async function createZoomAttendance(
  meetingId: string,
  records: ZoomAttendance[]
): Promise<void> {
  if (!records.length) return;
  const { error } = await supabase
    .from('zoom_attendance')
    .upsert(records.map((r) => ({ ...r, meeting_id: meetingId })));
  if (error) throw error;
}

export async function fetchZoomAttendance(meetingId: string): Promise<ZoomAttendance[]> {
  const { data, error } = await supabase
    .from('zoom_attendance')
    .select('*')
    .eq('meeting_id', meetingId)
    .order('join_time', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/**
 * Match Zoom participants to portal members by email address.
 * Returns the participant list with member_id filled in where a match is found.
 */
export async function matchZoomAttendeesToMembers(
  participants: ZoomParticipant[]
): Promise<Array<ZoomParticipant & { member_id: string | null }>> {
  const emails = participants.map((p) => p.user_email).filter(Boolean);
  if (!emails.length) return participants.map((p) => ({ ...p, member_id: null }));

  const { data } = await supabase
    .from('profiles')
    .select('id, email')
    .in('email', emails);

  const emailToId = Object.fromEntries((data ?? []).map((r: { id: string; email: string }) => [r.email, r.id]));

  return participants.map((p) => ({
    ...p,
    member_id: emailToId[p.user_email] ?? null,
  }));
}

export async function deleteZoomAttendance(meetingId: string): Promise<void> {
  const { error } = await supabase
    .from('zoom_attendance')
    .delete()
    .eq('meeting_id', meetingId);
  if (error) throw error;
}
