-- ═══════════════════════════════════════════════════════════════
-- Phase 6 Schema: Email Notifications
-- Run this in Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════

-- ─── Email Preferences ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.email_preferences (
  id                    UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  member_id             UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  meeting_reminders_8am BOOLEAN     NOT NULL DEFAULT true,
  meeting_reminders_1hr BOOLEAN     NOT NULL DEFAULT true,
  message_notifications BOOLEAN     NOT NULL DEFAULT true,
  habit_milestones      BOOLEAN     NOT NULL DEFAULT true,
  devotional_reminders  BOOLEAN     NOT NULL DEFAULT true,
  testimony_approved    BOOLEAN     NOT NULL DEFAULT true,
  weekly_digest         BOOLEAN     NOT NULL DEFAULT false,
  admin_announcements   BOOLEAN     NOT NULL DEFAULT true,
  opt_out_all           BOOLEAN     NOT NULL DEFAULT false,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (member_id)
);

CREATE INDEX IF NOT EXISTS idx_email_prefs_member ON public.email_preferences (member_id);

ALTER TABLE public.email_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "email_prefs_own_read"
  ON public.email_preferences FOR SELECT
  USING (auth.uid() = member_id);

CREATE POLICY "email_prefs_own_write"
  ON public.email_preferences FOR ALL
  USING (auth.uid() = member_id);

CREATE POLICY "email_prefs_admin_read"
  ON public.email_preferences FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('admin', 'coordinator')
    )
  );

CREATE TRIGGER set_email_prefs_updated_at
  BEFORE UPDATE ON public.email_preferences
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── Email Log ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.email_log (
  id             UUID         DEFAULT gen_random_uuid() PRIMARY KEY,
  member_id      UUID         REFERENCES public.profiles(id) ON DELETE SET NULL,
  recipient_email VARCHAR(320) NOT NULL,
  subject        VARCHAR(998) NOT NULL,
  template_type  VARCHAR(50)  NOT NULL
                 CHECK (template_type IN (
                   'meeting_reminder_8am','meeting_reminder_1hr',
                   'message_notification','habit_milestone',
                   'devotional_reminder','testimony_approved',
                   'weekly_digest','generic'
                 )),
  status         VARCHAR(20)  NOT NULL DEFAULT 'queued'
                 CHECK (status IN ('queued','sent','failed','bounced')),
  sent_at        TIMESTAMPTZ,
  failed_reason  VARCHAR(500),
  opened_at      TIMESTAMPTZ,
  clicked_at     TIMESTAMPTZ,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_log_member   ON public.email_log (member_id);
CREATE INDEX IF NOT EXISTS idx_email_log_status   ON public.email_log (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_log_template ON public.email_log (template_type, created_at DESC);

ALTER TABLE public.email_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "email_log_own_read"
  ON public.email_log FOR SELECT
  USING (auth.uid() = member_id);

CREATE POLICY "email_log_admin_read"
  ON public.email_log FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('admin', 'coordinator')
    )
  );

-- Insert restricted to service role (edge functions use service key)

-- ─── Scheduled Emails ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.scheduled_emails (
  id              UUID         DEFAULT gen_random_uuid() PRIMARY KEY,
  recipient_email VARCHAR(320) NOT NULL,
  subject         VARCHAR(998) NOT NULL,
  html_content    TEXT         NOT NULL,
  scheduled_for   TIMESTAMPTZ  NOT NULL,
  sent            BOOLEAN      NOT NULL DEFAULT false,
  sent_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scheduled_emails_pending
  ON public.scheduled_emails (scheduled_for)
  WHERE sent = false;

ALTER TABLE public.scheduled_emails ENABLE ROW LEVEL SECURITY;
-- Only service role may access scheduled_emails; no user-facing policies needed
