import { supabase } from '../supabase';
import type { ContactFilters } from '../../types';
import { fetchContacts } from './contacts';

function csvValue(value: string | number | boolean | null | undefined): string {
  const raw = value == null ? '' : String(value);
  return `"${raw.replace(/"/g, '""')}"`;
}

export function downloadCSV(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export async function exportMembersCSV(): Promise<string> {
  const { data, error } = await supabase
    .from('profiles')
    .select('full_name,email,role,joined_at,cell_id')
    .order('full_name', { ascending: true });
  if (error) throw error;

  return [
    ['Name', 'Email', 'Role', 'Joined At', 'Cell'].join(','),
    ...((data ?? []) as any[]).map((row) => [
      csvValue(row.full_name),
      csvValue(row.email),
      csvValue(row.role),
      csvValue(row.joined_at),
      csvValue(row.cell_id),
    ].join(',')),
  ].join('\n');
}

export async function exportContactsCSV(filters: ContactFilters = {}): Promise<string> {
  const rows = await fetchContacts(filters);
  return [
    ['Name', 'Phone', 'Tag', 'Status', 'Date Contacted', 'Logged By', 'Notes'].join(','),
    ...rows.map((row) => [
      csvValue(row.contact_name),
      csvValue(row.phone_hidden ? 'Hidden' : row.contact_phone),
      csvValue(row.tag),
      csvValue(row.follow_up_status),
      csvValue(row.date_contacted),
      csvValue(row.logged_by),
      csvValue(row.notes),
    ].join(',')),
  ].join('\n');
}

export async function exportMeetingAttendanceCSV(meetingId: string): Promise<string> {
  const { data, error } = await supabase
    .from('meeting_attendances')
    .select('user_name,user_id,confirmed_at,attended')
    .eq('meeting_id', meetingId)
    .order('confirmed_at', { ascending: true });
  if (error) throw error;

  return [
    ['Name', 'User ID', 'Confirmed At', 'Attended'].join(','),
    ...((data ?? []) as any[]).map((row) => [
      csvValue(row.user_name),
      csvValue(row.user_id),
      csvValue(row.confirmed_at),
      csvValue(row.attended),
    ].join(',')),
  ].join('\n');
}
