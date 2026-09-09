-- ═══════════════════════════════════════════════════════════════
-- Phase 1B Schema: Message of the Week + Habit Tracker
-- ═══════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────
-- Message of the Week
-- ────────────────────────────────────────────────────────────────

CREATE TABLE public.weekly_messages (
  id               UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  created_by       UUID          NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  author_name      VARCHAR(255)  NOT NULL,
  scope            VARCHAR(20)   NOT NULL DEFAULT 'org'
                   CHECK (scope IN ('org', 'personal')),
  title            VARCHAR(255)  NOT NULL,
  body             TEXT          NOT NULL,
  drive_link       VARCHAR(2048),
  week_start       DATE          NOT NULL,
  week_end         DATE          NOT NULL,
  is_recurring     BOOLEAN       NOT NULL DEFAULT FALSE,
  recurrence_type  VARCHAR(20)   NOT NULL DEFAULT 'none'
                   CHECK (recurrence_type IN ('none', 'weekly', 'biweekly')),
  recurrence_weeks INT           NOT NULL DEFAULT 1,
  created_at       TIMESTAMPTZ   DEFAULT now(),
  updated_at       TIMESTAMPTZ   DEFAULT now()
);

CREATE INDEX idx_weekly_messages_week ON public.weekly_messages (week_start, week_end);
CREATE INDEX idx_weekly_messages_scope ON public.weekly_messages (scope);
CREATE INDEX idx_weekly_messages_creator ON public.weekly_messages (created_by);

ALTER TABLE public.weekly_messages ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read org messages; users can read their own personal messages
CREATE POLICY "read org or own personal messages"
  ON public.weekly_messages FOR SELECT
  USING (
    scope = 'org' OR auth.uid() = created_by
  );

-- Members can create personal messages; coordinators/admins create org messages
CREATE POLICY "create messages by scope"
  ON public.weekly_messages FOR INSERT
  WITH CHECK (
    auth.uid() = created_by AND (
      scope = 'personal' OR
      EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid() AND role IN ('coordinator', 'admin')
      )
    )
  );

-- Owner or coordinator/admin can update
CREATE POLICY "update own or admin"
  ON public.weekly_messages FOR UPDATE
  USING (
    auth.uid() = created_by OR
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('coordinator', 'admin')
    )
  );

-- Owner or coordinator/admin can delete
CREATE POLICY "delete own or admin"
  ON public.weekly_messages FOR DELETE
  USING (
    auth.uid() = created_by OR
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('coordinator', 'admin')
    )
  );

-- Auto-update updated_at
CREATE TRIGGER set_weekly_messages_updated_at
  BEFORE UPDATE ON public.weekly_messages
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ────────────────────────────────────────────────────────────────
-- Habit Tracker
-- ────────────────────────────────────────────────────────────────

CREATE TABLE public.habit_templates (
  id          UUID         DEFAULT gen_random_uuid() PRIMARY KEY,
  name        VARCHAR(100) NOT NULL,
  description TEXT,
  icon        VARCHAR(10)  NOT NULL DEFAULT '✅',
  target_days INT[]        DEFAULT NULL,  -- NULL = every day; [0-6] = specific weekdays (0=Sun)
  created_by  UUID         NOT NULL REFERENCES public.profiles(id),
  is_active   BOOLEAN      NOT NULL DEFAULT TRUE,
  "order"     INT          NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ  DEFAULT now()
);

CREATE INDEX idx_habit_templates_active ON public.habit_templates (is_active, "order");

ALTER TABLE public.habit_templates ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read active templates
CREATE POLICY "all authenticated read habits"
  ON public.habit_templates FOR SELECT
  USING (auth.role() = 'authenticated');

-- Only coordinators/admins can manage templates
CREATE POLICY "coordinators manage habit templates"
  ON public.habit_templates FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('coordinator', 'admin')
    )
  );

CREATE TABLE public.habit_entries (
  id           UUID         DEFAULT gen_random_uuid() PRIMARY KEY,
  template_id  UUID         NOT NULL REFERENCES public.habit_templates(id) ON DELETE CASCADE,
  user_id      UUID         NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  entry_date   DATE         NOT NULL,
  status       VARCHAR(10)  NOT NULL CHECK (status IN ('done', 'skipped')),
  created_at   TIMESTAMPTZ  DEFAULT now(),
  UNIQUE (template_id, user_id, entry_date)
);

CREATE INDEX idx_habit_entries_user_date ON public.habit_entries (user_id, entry_date);
CREATE INDEX idx_habit_entries_template ON public.habit_entries (template_id, entry_date);

ALTER TABLE public.habit_entries ENABLE ROW LEVEL SECURITY;

-- Members manage only their own entries
CREATE POLICY "members own entries"
  ON public.habit_entries FOR ALL
  USING (auth.uid() = user_id);

-- Coordinators/admins can read all entries (for analytics)
CREATE POLICY "coordinators read all entries"
  ON public.habit_entries FOR SELECT
  USING (
    auth.uid() = user_id OR
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('coordinator', 'admin')
    )
  );
