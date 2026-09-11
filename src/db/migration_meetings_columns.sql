-- Fix meetings table: add columns that MeetingInput type requires
-- Run in Supabase SQL Editor

ALTER TABLE public.meetings
  ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'general'
    CHECK (category IN ('general', 'bsc', 'cell', 'leadership')),
  ADD COLUMN IF NOT EXISTS allow_join_requests boolean NOT NULL DEFAULT false;
