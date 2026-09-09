-- ═══════════════════════════════════════════════════════════════
-- Phase 6 Schema: Web Push Notifications
-- Run this in Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════

-- ─── Push Subscriptions ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id            UUID         DEFAULT gen_random_uuid() PRIMARY KEY,
  member_id     UUID         NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  endpoint      TEXT         NOT NULL,
  auth          VARCHAR(512) NOT NULL,
  p256dh        VARCHAR(512) NOT NULL,
  user_agent    VARCHAR(500),
  is_active     BOOLEAN      NOT NULL DEFAULT true,
  subscribed_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
  last_used     TIMESTAMPTZ,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (endpoint)
);

CREATE INDEX IF NOT EXISTS idx_push_subs_member ON public.push_subscriptions (member_id, is_active);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "push_subs_own_read"
  ON public.push_subscriptions FOR SELECT
  USING (auth.uid() = member_id);

CREATE POLICY "push_subs_own_delete"
  ON public.push_subscriptions FOR DELETE
  USING (auth.uid() = member_id);

CREATE POLICY "push_subs_admin_read"
  ON public.push_subscriptions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('admin', 'coordinator')
    )
  );

-- Insert/update restricted to service role (subscription saved via edge function)

-- ─── Push Notification Log ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.push_notification_log (
  id                UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  member_id         UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  notification_type VARCHAR(30) NOT NULL
                    CHECK (notification_type IN ('meeting','message','prophecy','habit','devotional')),
  title             VARCHAR(200) NOT NULL,
  body              VARCHAR(500) NOT NULL,
  status            VARCHAR(20)  NOT NULL
                    CHECK (status IN ('sent','failed','clicked','dismissed')),
  sent_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),
  clicked_at        TIMESTAMPTZ,
  response_data     JSONB,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_push_log_member ON public.push_notification_log (member_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_push_log_type   ON public.push_notification_log (notification_type, sent_at DESC);

ALTER TABLE public.push_notification_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "push_log_own_read"
  ON public.push_notification_log FOR SELECT
  USING (auth.uid() = member_id);

CREATE POLICY "push_log_admin_read"
  ON public.push_notification_log FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('admin', 'coordinator')
    )
  );

-- Writes restricted to service role
