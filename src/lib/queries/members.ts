import { supabase } from '../supabase';
import type { Member } from '../../types';

export interface MemberFilters {
  search?: string;
  role?: string;
  cellId?: string;
}

export async function fetchMembersFiltered(filters: MemberFilters = {}): Promise<Member[]> {
  let q = supabase
    .from('profiles')
    .select('id, full_name, email, avatar_url, role, joined_at, phone, student_number, cell_id')
    .order('full_name', { ascending: true });

  if (filters.search) {
    const like = `%${filters.search}%`;
    q = q.or(`full_name.ilike.${like},email.ilike.${like}`);
  }
  if (filters.role) q = q.eq('role', filters.role);
  if (filters.cellId) q = q.eq('cell_id', filters.cellId);

  const { data, error } = await q;
  if (error) throw new Error(error.message ?? 'Failed to load members.');
  return (data ?? []) as Member[];
}
