-- ══════════════════════════════════════════════════════════════
-- Phase 1B + Missing Tables — Safe / Idempotent Migration
-- Run in Supabase SQL Editor.  Safe to re-run: uses IF NOT EXISTS
-- and DROP POLICY IF EXISTS so duplicates never cause errors.
-- ══════════════════════════════════════════════════════════════

-- ── 1. Meetings: add missing columns ───────────────────────────
ALTER TABLE public.meetings
  ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'general'
    CHECK (category IN ('general','bsc','cell','leadership')),
  ADD COLUMN IF NOT EXISTS allow_join_requests boolean NOT NULL DEFAULT false;

-- ── 2. weekly_messages (may already exist) ─────────────────────
CREATE TABLE IF NOT EXISTS public.weekly_messages (
  id               UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  created_by       UUID          NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  author_name      VARCHAR(255)  NOT NULL,
  scope            VARCHAR(20)   NOT NULL DEFAULT 'org'
                   CHECK (scope IN ('org','personal')),
  title            VARCHAR(255)  NOT NULL,
  body             TEXT          NOT NULL,
  drive_link       VARCHAR(2048),
  week_start       DATE          NOT NULL,
  week_end         DATE          NOT NULL,
  is_recurring     BOOLEAN       NOT NULL DEFAULT FALSE,
  recurrence_type  VARCHAR(20)   NOT NULL DEFAULT 'none'
                   CHECK (recurrence_type IN ('none','weekly','biweekly')),
  recurrence_weeks INT           NOT NULL DEFAULT 1,
  created_at       TIMESTAMPTZ   DEFAULT now(),
  updated_at       TIMESTAMPTZ   DEFAULT now()
);
ALTER TABLE public.weekly_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "read org or own personal messages" ON public.weekly_messages;
CREATE POLICY "read org or own personal messages" ON public.weekly_messages FOR SELECT
  USING (scope = 'org' OR auth.uid() = created_by);

DROP POLICY IF EXISTS "create messages by scope" ON public.weekly_messages;
CREATE POLICY "create messages by scope" ON public.weekly_messages FOR INSERT
  WITH CHECK (
    auth.uid() = created_by AND (
      scope = 'personal' OR
      EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('coordinator','admin'))
    )
  );

DROP POLICY IF EXISTS "update own or admin" ON public.weekly_messages;
CREATE POLICY "update own or admin" ON public.weekly_messages FOR UPDATE
  USING (
    auth.uid() = created_by OR
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('coordinator','admin'))
  );

DROP POLICY IF EXISTS "delete own or admin" ON public.weekly_messages;
CREATE POLICY "delete own or admin" ON public.weekly_messages FOR DELETE
  USING (
    auth.uid() = created_by OR
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('coordinator','admin'))
  );

-- ── 3. habit_templates ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.habit_templates (
  id          UUID         DEFAULT gen_random_uuid() PRIMARY KEY,
  name        VARCHAR(100) NOT NULL,
  description TEXT,
  icon        VARCHAR(10)  NOT NULL DEFAULT '✅',
  target_days INT[]        DEFAULT NULL,
  created_by  UUID         NOT NULL REFERENCES public.profiles(id),
  is_active   BOOLEAN      NOT NULL DEFAULT TRUE,
  "order"     INT          NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ  DEFAULT now()
);
ALTER TABLE public.habit_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "all authenticated read habits" ON public.habit_templates;
CREATE POLICY "all authenticated read habits" ON public.habit_templates FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "coordinators manage habit templates" ON public.habit_templates;
CREATE POLICY "coordinators manage habit templates" ON public.habit_templates FOR ALL
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('coordinator','admin'))
  );

-- ── 4. habit_entries ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.habit_entries (
  id           UUID         DEFAULT gen_random_uuid() PRIMARY KEY,
  template_id  UUID         NOT NULL REFERENCES public.habit_templates(id) ON DELETE CASCADE,
  user_id      UUID         NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  entry_date   DATE         NOT NULL,
  status       VARCHAR(10)  NOT NULL CHECK (status IN ('done','skipped')),
  created_at   TIMESTAMPTZ  DEFAULT now(),
  UNIQUE (template_id, user_id, entry_date)
);
ALTER TABLE public.habit_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "members own entries" ON public.habit_entries;
CREATE POLICY "members own entries" ON public.habit_entries FOR ALL
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "coordinators read all entries" ON public.habit_entries;
CREATE POLICY "coordinators read all entries" ON public.habit_entries FOR SELECT
  USING (
    auth.uid() = user_id OR
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('coordinator','admin'))
  );

-- ── 5. events ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.events (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  title        TEXT        NOT NULL,
  description  TEXT,
  date         DATE        NOT NULL,
  time         TIME,
  location     TEXT,
  image_url    TEXT,
  category     TEXT        NOT NULL DEFAULT 'Other'
               CHECK (category IN ('Bible Study','Worship','Fellowship','Outreach','Prayer','Other')),
  created_by   UUID        NOT NULL REFERENCES public.profiles(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "events_read" ON public.events;
CREATE POLICY "events_read" ON public.events FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "events_manage" ON public.events;
CREATE POLICY "events_manage" ON public.events FOR ALL
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin','coordinator'))
  );

CREATE TABLE IF NOT EXISTS public.event_rsvps (
  event_id   UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, user_id)
);
ALTER TABLE public.event_rsvps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rsvps_own" ON public.event_rsvps;
CREATE POLICY "rsvps_own" ON public.event_rsvps FOR ALL
  USING (auth.uid() = user_id);

-- ── 6. announcements ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.announcements (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  title       TEXT        NOT NULL,
  body        TEXT        NOT NULL,
  author_id   UUID        NOT NULL REFERENCES public.profiles(id),
  author_name TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ann_read" ON public.announcements;
CREATE POLICY "ann_read" ON public.announcements FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "ann_manage" ON public.announcements;
CREATE POLICY "ann_manage" ON public.announcements FOR ALL
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid()
      AND role IN ('admin','coordinator','cell_leader'))
  );

-- ── 7. user_profiles ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_profiles (
  user_id        UUID        PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  first_name     TEXT        NOT NULL DEFAULT '',
  last_name      TEXT        NOT NULL DEFAULT '',
  phone          TEXT,
  avatar_url     TEXT,
  bio            TEXT,
  student_number TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_profiles_own" ON public.user_profiles;
CREATE POLICY "user_profiles_own" ON public.user_profiles FOR ALL
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "user_profiles_admin_read" ON public.user_profiles;
CREATE POLICY "user_profiles_admin_read" ON public.user_profiles FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin','coordinator'))
  );
