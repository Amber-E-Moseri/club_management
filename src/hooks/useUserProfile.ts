import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

export interface UserProfile {
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  avatarUrl?: string;
  bio?: string;
  studentNumber?: string;
  cellId?: string;
  cellName?: string;
  bscAssignment?: string;
  spiritualRole?: string;
  joinedAt: string;
}

export interface ProfileUpdatePayload {
  firstName: string;
  lastName: string;
  phone?: string;
  avatarUrl?: string;
  bio?: string;
  studentNumber?: string;
}

interface UseUserProfileReturn {
  profile: UserProfile | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
  refetch: () => void;
  updateProfile: (payload: ProfileUpdatePayload) => Promise<void>;
  uploadAvatar: (file: File) => Promise<string>;
}

export function useUserProfile(userId: string | undefined): UseUserProfileReturn {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const refetch = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!userId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);

    supabase
      .from('user_profiles')
      .select(`
        user_id,
        first_name,
        last_name,
        phone,
        avatar_url,
        bio,
        created_at,
        profiles!inner (
          email,
          role,
          joined_at,
          cell_id,
          bsc_assignment,
          spiritual_role
        )
      `)
      .eq('user_id', userId)
      .single()
      .then(({ data, error: err }) => {
        if (err && err.code !== 'PGRST116') {
          setError(err.message);
          setLoading(false);
          return;
        }
        if (!data) {
          // Profile row not yet created — fetch base profile only
          supabase
            .from('profiles')
            .select('email, joined_at, cell_id, bsc_assignment, spiritual_role')
            .eq('id', userId)
            .single()
            .then(({ data: base }) => {
              if (base) {
                setProfile({
                  userId,
                  firstName: '',
                  lastName: '',
                  email: base.email ?? '',
                  joinedAt: base.joined_at ?? '',
                  cellId: base.cell_id,
                  bscAssignment: base.bsc_assignment,
                  spiritualRole: base.spiritual_role,
                });
              }
              setLoading(false);
            });
          return;
        }

        const p = data as Record<string, unknown>;
        const base = (p['profiles'] as Record<string, unknown>) ?? {};
        setProfile({
          userId,
          firstName: (p['first_name'] as string) ?? '',
          lastName: (p['last_name'] as string) ?? '',
          email: (base['email'] as string) ?? '',
          phone: p['phone'] as string | undefined,
          avatarUrl: p['avatar_url'] as string | undefined,
          bio: p['bio'] as string | undefined,
          studentNumber: p['student_number'] as string | undefined,
          cellId: base['cell_id'] as string | undefined,
          bscAssignment: base['bsc_assignment'] as string | undefined,
          spiritualRole: base['spiritual_role'] as string | undefined,
          joinedAt: (base['joined_at'] as string) ?? (p['created_at'] as string) ?? '',
        });
        setLoading(false);
      });
  }, [userId, tick]);

  const updateProfile = useCallback(
    async (payload: ProfileUpdatePayload) => {
      if (!userId) return;
      setSaving(true);
      setError(null);
      try {
        const { error: err } = await supabase
          .from('user_profiles')
          .upsert({
            user_id: userId,
            first_name: payload.firstName,
            last_name: payload.lastName,
            phone: payload.phone ?? null,
            avatar_url: payload.avatarUrl ?? null,
            bio: payload.bio ?? null,
            student_number: payload.studentNumber ?? null,
            updated_at: new Date().toISOString(),
          });
        if (err) throw err;
        refetch();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Save failed.');
      } finally {
        setSaving(false);
      }
    },
    [userId, refetch]
  );

  const uploadAvatar = useCallback(
    async (file: File): Promise<string> => {
      if (!userId) throw new Error('Not authenticated.');
      if (file.size > 5 * 1024 * 1024) throw new Error('Image must be under 5 MB.');
      const ext = file.name.split('.').pop();
      const path = `avatars/${userId}.${ext}`;
      const { error: err } = await supabase.storage.from('user-media').upload(path, file, { upsert: true });
      if (err) throw err;
      const { data } = supabase.storage.from('user-media').getPublicUrl(path);
      return data.publicUrl;
    },
    [userId]
  );

  return { profile, loading, saving, error, refetch, updateProfile, uploadAvatar };
}
