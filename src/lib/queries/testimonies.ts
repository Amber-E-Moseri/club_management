import { supabase } from '../supabase';
import type {
  Testimony, TestimonyInput, TestimonyCategory, TestimonyVisibility,
  TestimonyEntryType, TestimonyStatus, TestimonyComment, ReactionType,
} from '../../types';

export interface TestimonyFilters {
  entry_type?: TestimonyEntryType;
  category?: TestimonyCategory;
  visibility?: TestimonyVisibility;
  status?: TestimonyStatus | 'pending';
  search?: string;
  my_only?: boolean;
  author_id?: string;
  include_archived?: boolean;
}

export async function fetchTestimonies(filters: TestimonyFilters = {}): Promise<Testimony[]> {
  const userId = (await supabase.auth.getUser()).data.user?.id;

  let q = supabase
    .from('testimonies')
    .select('*')
    .order('created_at', { ascending: false });

  if (filters.entry_type) q = q.eq('entry_type', filters.entry_type);
  if (filters.category)   q = q.eq('category', filters.category);
  if (filters.search)     q = q.ilike('title', `%${filters.search}%`);
  if (filters.my_only && userId) q = q.eq('author_id', userId);
  if (filters.author_id)  q = q.eq('author_id', filters.author_id);
  if (filters.status)     q = q.eq('status', filters.status);
  if (!filters.include_archived) q = q.neq('status', 'archived');

  const { data, error } = await q;
  if (error) throw error;

  const items = (data ?? []) as Testimony[];

  // Enrich with reaction counts + my reactions + comment counts
  if (items.length > 0 && userId) {
    const ids = items.map((t) => t.id);

    const [reactionsRes, myReactionsRes, commentsRes] = await Promise.all([
      supabase.from('testimony_reactions').select('testimony_id,reaction_type').in('testimony_id', ids),
      supabase.from('testimony_reactions').select('testimony_id,reaction_type').in('testimony_id', ids).eq('user_id', userId),
      supabase.from('testimony_comments').select('testimony_id').in('testimony_id', ids),
    ]);

    const reactionMap: Record<string, Record<ReactionType, number>> = {};
    for (const r of reactionsRes.data ?? []) {
      if (!reactionMap[r.testimony_id]) reactionMap[r.testimony_id] = { heart: 0, fire: 0, pray: 0 };
      reactionMap[r.testimony_id][r.reaction_type as ReactionType]++;
    }

    const myReactionMap: Record<string, ReactionType[]> = {};
    for (const r of myReactionsRes.data ?? []) {
      if (!myReactionMap[r.testimony_id]) myReactionMap[r.testimony_id] = [];
      myReactionMap[r.testimony_id].push(r.reaction_type as ReactionType);
    }

    const commentCount: Record<string, number> = {};
    for (const c of commentsRes.data ?? []) {
      commentCount[c.testimony_id] = (commentCount[c.testimony_id] ?? 0) + 1;
    }

    return items.map((t) => ({
      ...t,
      is_mine: t.author_id === userId,
      reaction_counts: reactionMap[t.id] ?? { heart: 0, fire: 0, pray: 0 },
      my_reactions: myReactionMap[t.id] ?? [],
      comment_count: commentCount[t.id] ?? 0,
    }));
  }

  return items.map((t) => ({ ...t, is_mine: t.author_id === userId }));
}

export async function fetchPendingTestimonies(): Promise<Testimony[]> {
  const { data, error } = await supabase
    .from('testimonies')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as Testimony[];
}

export async function fetchTestimony(id: string): Promise<Testimony | null> {
  const { data, error } = await supabase
    .from('testimonies').select('*').eq('id', id).single();
  if (error) throw error;
  return data as Testimony | null;
}

export async function createTestimony(
  input: TestimonyInput & { author_id: string; author_name: string; cell_id?: string }
): Promise<Testimony> {
  const status: TestimonyStatus = input.visibility === 'draft' || input.visibility === 'private'
    ? 'approved'
    : 'pending';
  const { data, error } = await supabase
    .from('testimonies').insert({ ...input, status }).select().single();
  if (error) throw error;
  return data as Testimony;
}

export async function updateTestimony(id: string, input: Partial<TestimonyInput>): Promise<Testimony> {
  const { data, error } = await supabase
    .from('testimonies').update(input).eq('id', id).select().single();
  if (error) throw error;
  return data as Testimony;
}

export async function deleteTestimony(id: string): Promise<void> {
  const { error } = await supabase.from('testimonies').delete().eq('id', id);
  if (error) throw error;
}

export async function approveTestimony(id: string): Promise<void> {
  const { error } = await supabase
    .from('testimonies').update({ status: 'approved' }).eq('id', id);
  if (error) throw error;
}

export async function rejectTestimony(id: string): Promise<void> {
  const { error } = await supabase
    .from('testimonies').update({ status: 'rejected' }).eq('id', id);
  if (error) throw error;
}

export async function archiveTestimony(id: string): Promise<void> {
  const { error } = await supabase
    .from('testimonies').update({ status: 'archived', archived_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}

// ─── Reactions ────────────────────────────────────────────────────────────────

export async function toggleReaction(testimonyId: string, reactionType: ReactionType): Promise<boolean> {
  const userId = (await supabase.auth.getUser()).data.user?.id;
  if (!userId) throw new Error('Not authenticated');

  const { data: existing } = await supabase
    .from('testimony_reactions')
    .select('id')
    .eq('testimony_id', testimonyId)
    .eq('user_id', userId)
    .eq('reaction_type', reactionType)
    .maybeSingle();

  if (existing) {
    await supabase.from('testimony_reactions').delete().eq('id', existing.id);
    return false;
  } else {
    await supabase.from('testimony_reactions').insert({ testimony_id: testimonyId, user_id: userId, reaction_type: reactionType });
    return true;
  }
}

// ─── Comments ─────────────────────────────────────────────────────────────────

export async function fetchComments(testimonyId: string): Promise<TestimonyComment[]> {
  const userId = (await supabase.auth.getUser()).data.user?.id;
  const { data, error } = await supabase
    .from('testimony_comments')
    .select('*')
    .eq('testimony_id', testimonyId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((c) => ({ ...c, is_mine: c.author_id === userId }));
}

export async function createComment(testimonyId: string, body: string, authorName: string): Promise<TestimonyComment> {
  const userId = (await supabase.auth.getUser()).data.user?.id;
  if (!userId) throw new Error('Not authenticated');
  const { data, error } = await supabase
    .from('testimony_comments')
    .insert({ testimony_id: testimonyId, author_id: userId, author_name: authorName, body })
    .select().single();
  if (error) throw error;
  return { ...data, is_mine: true };
}

export async function deleteComment(id: string): Promise<void> {
  const { error } = await supabase.from('testimony_comments').delete().eq('id', id);
  if (error) throw error;
}

// ─── Image upload ─────────────────────────────────────────────────────────────

export async function uploadTestimonyImage(file: File, userId: string): Promise<string> {
  const ext = file.name.split('.').pop();
  const path = `${userId}/${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from('testimony-images').upload(path, file, { upsert: true });
  if (error) throw error;
  const { data } = supabase.storage.from('testimony-images').getPublicUrl(path);
  return data.publicUrl;
}
