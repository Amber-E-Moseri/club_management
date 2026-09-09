-- ═══════════════════════════════════════════════════════════════
-- Phase 6 Schema: Zoom Integration
-- Run this in Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════

-- ─── Add Zoom columns to meetings ────────────────────────────────────────────

ALTER TABLE public.meetings
  ADD COLUMN IF NOT EXISTS zoom_meeting_id VARCHAR,
  ADD COLUMN IF NOT EXISTS zoom_join_url   VARCHAR,
  ADD COLUMN IF NOT EXISTS zoom_start_url  VARCHAR,
  ADD COLUMN IF NOT EXISTS zoom_password   VARCHAR,
  ADD COLUMN IF NOT EXISTS zoom_created    BOOLEAN NOT NULL DEFAULT false;

-- ─── Zoom Settings ───────────────────────────────────────────────────────────
-- Stores per-org Zoom connection status; actual secrets live in Supabase project secrets

CREATE TABLE IF NOT EXISTS public.zoom_settings (
  id               UUID         DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id  UUID         REFERENCES public.profiles(id) ON DELETE SET NULL,
  zoom_account_id  VARCHAR(100) NOT NULL DEFAULT '',
  zoom_user_id     VARCHAR(100) NOT NULL DEFAULT '',
  is_active        BOOLEAN      NOT NULL DEFAULT false,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT now()
);

ALTER TABLE public.zoom_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "zoom_settings_admin"
  ON public.zoom_settings FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('admin', 'coordinator')
    )
  );

CREATE TRIGGER set_zoom_settings_updated_at
  BEFORE UPDATE ON public.zoom_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── Zoom Attendance ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.zoom_attendance (
  id                   UUID         DEFAULT gen_random_uuid() PRIMARY KEY,
  meeting_id           UUID         NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  zoom_participant_id  VARCHAR(100) NOT NULL,
  participant_name     VARCHAR(200) NOT NULL,
  participant_email    VARCHAR(320) NOT NULL DEFAULT '',
  member_id            UUID         REFERENCES public.profiles(id) ON DELETE SET NULL,
  join_time            TIMESTAMPTZ  NOT NULL,
  leave_time           TIMESTAMPTZ  NOT NULL,
  duration_minutes     INT          NOT NULL DEFAULT 0,
  synced_from_zoom     BOOLEAN      NOT NULL DEFAULT true,
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_zoom_attendance_meeting ON public.zoom_attendance (meeting_id);
CREATE INDEX IF NOT EXISTS idx_zoom_attendance_member  ON public.zoom_attendance (member_id);

ALTER TABLE public.zoom_attendance ENABLE ROW LEVEL SECURITY;

CREATE POLICY "zoom_attendance_admin_read"
  ON public.zoom_attendance FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('admin', 'coordinator', 'cell_leader')
    )
  );

-- Writes restricted to service role (synced via edge function)
