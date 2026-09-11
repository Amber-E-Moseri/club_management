import { supabase } from '../supabase';
import type { Meeting, MeetingInput, MeetingAttendance } from '../../types';

export async function fetchMeetings(upcoming = true): Promise<Meeting[]> {
  const today = new Date().toISOString().split('T')[0];
  const userId = (await supabase.auth.getUser()).data.user?.id;

  let q = supabase
    .from('meetings')
    .select('*, meeting_attendances(id, user_id)')
    .order('date', { ascending: true })
    .order('time', { ascending: true });

  if (upcoming) q = q.gte('date', today);

  const { data, error } = await q;
  if (error) throw new Error(error.message);

  return (data ?? []).map((row: Record<string, unknown>) => {
    const attendances = (row.meeting_attendances as { user_id: string }[]) ?? [];
    return {
      ...(row as unknown as Meeting),
      attendance_count: attendances.length,
      user_confirmed: attendances.some((a) => a.user_id === userId),
    };
  });
}

export async function fetchMeeting(id: string): Promise<Meeting | null> {
  const { data, error } = await supabase
    .from('meetings').select('*').eq('id', id).single();
  if (error) throw new Error(error.message);
  return data;
}

export async function createMeeting(
  input: MeetingInput & { created_by: string }
): Promise<Meeting> {
  const { data, error } = await supabase
    .from('meetings').insert(input).select().single();
  if (error) throw new Error(error.message);
  return data;
}

export async function updateMeeting(
  id: string,
  input: Partial<MeetingInput>
): Promise<Meeting> {
  const { data, error } = await supabase
    .from('meetings').update(input).eq('id', id).select().single();
  if (error) throw new Error(error.message);
  return data;
}

export async function deleteMeeting(id: string): Promise<void> {
  const { error } = await supabase.from('meetings').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

export async function confirmAttendance(
  meetingId: string,
  userId: string,
  userName: string
): Promise<void> {
  const { error } = await supabase
    .from('meeting_attendances')
    .upsert({ meeting_id: meetingId, user_id: userId, user_name: userName });
  if (error) throw new Error(error.message);
}

export async function cancelAttendance(meetingId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from('meeting_attendances')
    .delete()
    .match({ meeting_id: meetingId, user_id: userId });
  if (error) throw new Error(error.message);
}

export async function fetchAttendances(meetingId: string): Promise<MeetingAttendance[]> {
  const { data, error } = await supabase
    .from('meeting_attendances')
    .select('*')
    .eq('meeting_id', meetingId)
    .order('confirmed_at', { ascending: true });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function markAttended(
  meetingId: string,
  userId: string,
  attended: boolean
): Promise<void> {
  const { error } = await supabase
    .from('meeting_attendances')
    .update({ attended })
    .match({ meeting_id: meetingId, user_id: userId });
  if (error) throw new Error(error.message);
}
