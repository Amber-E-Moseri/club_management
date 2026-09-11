-- ══════════════════════════════════════════════════════════
-- BLW York Hub — Missing Tables Migration
-- Run in Supabase SQL Editor (safe to re-run: IF NOT EXISTS)
-- ══════════════════════════════════════════════════════════

-- ── 1. Fix meetings table (restores meeting creation) ──────
ALTER TABLE public.meetings
  ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'general'
    CHECK (category IN ('general', 'bsc', 'cell', 'leadership')),
  ADD COLUMN IF NOT EXISTS allow_join_requests boolean NOT NULL DEFAULT false;

-- ── 2. Events ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.events (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  title        text NOT NULL,
  description  text,
  date         date NOT NULL,
  time         time,
  location     text,
  image_url    text,
  category     text NOT NULL DEFAULT 'Other'
               CHECK (category IN ('Bible Study','Worship','Fellowship','Outreach','Prayer','Other')),
  created_by   uuid NOT NULL REFERENCES public.profiles(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "events_read" ON public.events
  FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "events_manage" ON public.events FOR ALL USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin','coordinator'))
);

CREATE TABLE IF NOT EXISTS public.event_rsvps (
  event_id   uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, user_id)
);
ALTER TABLE public.event_rsvps ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rsvps_own" ON public.event_rsvps FOR ALL USING (auth.uid() = user_id);

-- ── 3. Announcements ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.announcements (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  title       text NOT NULL,
  body        text NOT NULL,
  author_id   uuid NOT NULL REFERENCES public.profiles(id),
  author_name text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ann_read" ON public.announcements
  FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "ann_manage" ON public.announcements FOR ALL USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid()
    AND role IN ('admin','coordinator','cell_leader'))
);

-- ── 4. Weekly messages, habit templates, habit entries ─────
-- Run src/db/schema-phase1b.sql (uses IF NOT EXISTS / CREATE TABLE IF NOT EXISTS)

-- ── 5. User profiles (extended profile data) ───────────────
CREATE TABLE IF NOT EXISTS public.user_profiles (
  user_id        uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  first_name     text NOT NULL DEFAULT '',
  last_name      text NOT NULL DEFAULT '',
  phone          text,
  avatar_url     text,
  bio            text,
  student_number text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_profiles_own" ON public.user_profiles FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "user_profiles_admin_read" ON public.user_profiles FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin','coordinator'))
);
