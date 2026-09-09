import { supabase } from './supabase';
import type { Event, Member, Announcement, PrayerRequest, DashboardStats } from '../types';

// ─── Events ──────────────────────────────────────────────────────────────────

export async function getUpcomingEvents(limit = 3): Promise<Event[]> {
  const today = new Date().toISOString().split('T')[0];
  const { data, error } = await supabase
    .from('events')
    .select('*')
    .gte('date', today)
    .order('date', { ascending: true })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

export async function getAllEvents(): Promise<Event[]> {
  const { data, error } = await supabase
    .from('events')
    .select('*')
    .order('date', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function rsvpEvent(eventId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from('event_rsvps')
    .upsert({ event_id: eventId, user_id: userId });
  if (error) throw error;
}

export async function cancelRsvp(eventId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from('event_rsvps')
    .delete()
    .match({ event_id: eventId, user_id: userId });
  if (error) throw error;
}

// ─── Members ─────────────────────────────────────────────────────────────────

export async function getMembers(): Promise<Member[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .order('full_name', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

// ─── Announcements ───────────────────────────────────────────────────────────

export async function getAnnouncements(limit = 5): Promise<Announcement[]> {
  const { data, error } = await supabase
    .from('announcements')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

export async function createAnnouncement(
  title: string,
  body: string,
  authorId: string,
  authorName: string
): Promise<void> {
  const { error } = await supabase
    .from('announcements')
    .insert({ title, body, author_id: authorId, author_name: authorName });
  if (error) throw error;
}

// ─── Prayer Requests ─────────────────────────────────────────────────────────

export async function getPrayerRequests(): Promise<PrayerRequest[]> {
  const { data, error } = await supabase
    .from('prayer_requests')
    .select('*')
    .eq('is_active', true)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

// ─── Dashboard Stats ─────────────────────────────────────────────────────────

export async function getDashboardStats(): Promise<DashboardStats> {
  const today = new Date().toISOString().split('T')[0];
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  const [members, newMembers, events, announcements, prayers] = await Promise.all([
    supabase.from('profiles').select('id', { count: 'exact', head: true }),
    supabase.from('profiles').select('id', { count: 'exact', head: true }).gte('joined_at', monthAgo),
    supabase.from('events').select('id', { count: 'exact', head: true }).gte('date', today).lte('date', new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]),
    supabase.from('announcements').select('id', { count: 'exact', head: true }),
    supabase.from('prayer_requests').select('id', { count: 'exact', head: true }).eq('is_active', true).gte('created_at', weekAgo),
  ]);

  return {
    member_count: members.count ?? 0,
    member_growth: newMembers.count ?? 0,
    upcoming_events: events.count ?? 0,
    announcement_count: announcements.count ?? 0,
    unread_announcements: 0,
    active_prayer_requests: prayers.count ?? 0,
  };
}
