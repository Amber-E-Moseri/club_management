import { useState, useEffect, useCallback } from 'react';
import type { Testimony, TestimonyInput, ReactionType, TestimonyComment } from '../types';
import type { TestimonyFilters } from '../lib/queries/testimonies';
import {
  fetchTestimonies, fetchPendingTestimonies,
  createTestimony, updateTestimony, deleteTestimony,
  approveTestimony, rejectTestimony, archiveTestimony,
  toggleReaction, fetchComments, createComment, deleteComment,
  uploadTestimonyImage,
} from '../lib/queries/testimonies';

export function useTestimonies(filters: TestimonyFilters = {}) {
  const [testimonies, setTestimonies] = useState<Testimony[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const filtersKey = JSON.stringify(filters);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchTestimonies(JSON.parse(filtersKey));
      setTestimonies(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load.');
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtersKey]);

  useEffect(() => { load(); }, [load]);

  const save = useCallback(async (
    input: TestimonyInput & { author_id: string; author_name: string; cell_id?: string },
    id?: string
  ) => {
    if (id) {
      const updated = await updateTestimony(id, input);
      setTestimonies((prev) => prev.map((t) => (t.id === id ? { ...t, ...updated } : t)));
    } else {
      const created = await createTestimony(input);
      setTestimonies((prev) => [created, ...prev]);
    }
  }, []);

  const remove = useCallback(async (id: string) => {
    await deleteTestimony(id);
    setTestimonies((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const approve = useCallback(async (id: string) => {
    await approveTestimony(id);
    setTestimonies((prev) => prev.map((t) => t.id === id ? { ...t, status: 'approved' } : t));
  }, []);

  const reject = useCallback(async (id: string) => {
    await rejectTestimony(id);
    setTestimonies((prev) => prev.map((t) => t.id === id ? { ...t, status: 'rejected' } : t));
  }, []);

  const archive = useCallback(async (id: string) => {
    await archiveTestimony(id);
    setTestimonies((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const react = useCallback(async (testimonyId: string, reactionType: ReactionType) => {
    const added = await toggleReaction(testimonyId, reactionType);
    setTestimonies((prev) => prev.map((t) => {
      if (t.id !== testimonyId) return t;
      const counts = { ...(t.reaction_counts ?? { heart: 0, fire: 0, pray: 0 }) };
      const mine = [...(t.my_reactions ?? [])];
      if (added) {
        counts[reactionType]++;
        if (!mine.includes(reactionType)) mine.push(reactionType);
      } else {
        counts[reactionType] = Math.max(0, (counts[reactionType] ?? 1) - 1);
        const idx = mine.indexOf(reactionType);
        if (idx > -1) mine.splice(idx, 1);
      }
      return { ...t, reaction_counts: counts, my_reactions: mine };
    }));
  }, []);

  return { testimonies, loading, error, refetch: load, save, remove, approve, reject, archive, react };
}

export function usePendingTestimonies() {
  const [pending, setPending] = useState<Testimony[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setPending(await fetchPendingTestimonies());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const approve = async (id: string) => {
    await approveTestimony(id);
    setPending((prev) => prev.filter((t) => t.id !== id));
  };

  const reject = async (id: string) => {
    await rejectTestimony(id);
    setPending((prev) => prev.filter((t) => t.id !== id));
  };

  return { pending, loading, refetch: load, approve, reject };
}

export function useTestimonyComments(testimonyId: string) {
  const [comments, setComments] = useState<TestimonyComment[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setComments(await fetchComments(testimonyId));
      setLoaded(true);
    } finally {
      setLoading(false);
    }
  }, [testimonyId]);

  const addComment = async (body: string, authorName: string) => {
    const c = await createComment(testimonyId, body, authorName);
    setComments((prev) => [...prev, c]);
  };

  const removeComment = async (id: string) => {
    await deleteComment(id);
    setComments((prev) => prev.filter((c) => c.id !== id));
  };

  return { comments, loading, loaded, load, addComment, removeComment };
}

export { uploadTestimonyImage };
