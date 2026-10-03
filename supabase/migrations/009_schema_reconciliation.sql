-- Migration 009: schema reconciliation (idempotent; safe on an already-populated production DB)
--
-- Why: the application depends on tables/columns that were historically created by hand from
-- src/db/*.sql in the Supabase SQL editor and therefore did not exist in this migration chain.
-- A database built from supabase/migrations alone could not run the app. This migration adds
-- ONLY what is missing (IF NOT EXISTS everywhere), enables RLS on the new tables, and defines
-- NO policies: all policies are defined in 010_security_hardening.sql.

-- ─── profiles: approval workflow columns ─────────────────────────────────────
-- Existing rows stay 'active' (they were approved before this column existed); the column default is
-- then flipped to 'pending' so every NEW row is fail-closed.
alter table public.profiles
  add column if not exists status text not null default 'active'
    check (status in ('pending', 'active', 'rejected')),
  add column if not exists student_number text;
alter table public.profiles alter column status set default 'pending';

-- ─── meetings: columns required by MeetingInput ──────────────────────────────
alter table public.meetings
  add column if not exists category text not null default 'general'
    check (category in ('general', 'bsc', 'cell', 'leadership')),
  add column if not exists allow_join_requests boolean not null default false;

-- ─── settings tables: allow seeding default rows without a coordinator ───────
alter table public.tags_settings alter column coordinator_id drop not null;
alter table public.status_settings alter column coordinator_id drop not null;

-- ─── email_log.status: add 'suppressed' (recipient opted out) ────────────────
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.email_log'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%status%'
  loop
    execute format('alter table public.email_log drop constraint %I', c.conname);
  end loop;
  alter table public.email_log
    add constraint email_log_status_check
    check (status in ('queued', 'sent', 'failed', 'bounced', 'suppressed'));
end $$;

-- ─── events / RSVPs / announcements ───────────────────────────────────────────
create table if not exists public.events (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  description text,
  date        date not null,
  time        time,
  location    text,
  image_url   text,
  category    text not null default 'Other'
              check (category in ('Bible Study','Worship','Fellowship','Outreach','Prayer','Other')),
  created_by  uuid not null references public.profiles(id),
  created_at  timestamptz not null default now()
);
alter table public.events enable row level security;

create table if not exists public.event_rsvps (
  event_id   uuid not null references public.events(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (event_id, user_id)
);
alter table public.event_rsvps enable row level security;

create table if not exists public.announcements (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  body        text not null,
  author_id   uuid not null references public.profiles(id),
  author_name text not null,
  created_at  timestamptz not null default now()
);
alter table public.announcements enable row level security;

-- ─── Message of the week / habits ────────────────────────────────────────────
create table if not exists public.weekly_messages (
  id               uuid primary key default gen_random_uuid(),
  created_by       uuid not null references public.profiles(id) on delete cascade,
  author_name      varchar(255) not null,
  scope            varchar(20) not null default 'org' check (scope in ('org','personal')),
  title            varchar(255) not null,
  body             text not null,
  drive_link       varchar(2048),
  week_start       date not null,
  week_end         date not null,
  is_recurring     boolean not null default false,
  recurrence_type  varchar(20) not null default 'none' check (recurrence_type in ('none','weekly','biweekly')),
  recurrence_weeks int not null default 1,
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);
create index if not exists idx_weekly_messages_week on public.weekly_messages (week_start, week_end);
create index if not exists idx_weekly_messages_scope on public.weekly_messages (scope);
create index if not exists idx_weekly_messages_creator on public.weekly_messages (created_by);
alter table public.weekly_messages enable row level security;
drop trigger if exists set_weekly_messages_updated_at on public.weekly_messages;
create trigger set_weekly_messages_updated_at
  before update on public.weekly_messages
  for each row execute function public.set_updated_at();

create table if not exists public.habit_templates (
  id          uuid primary key default gen_random_uuid(),
  name        varchar(100) not null,
  description text,
  icon        varchar(10) not null default '✅',
  target_days int[] default null,
  created_by  uuid not null references public.profiles(id),
  is_active   boolean not null default true,
  "order"     int not null default 0,
  created_at  timestamptz default now()
);
create index if not exists idx_habit_templates_active on public.habit_templates (is_active, "order");
alter table public.habit_templates enable row level security;

create table if not exists public.habit_entries (
  id          uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.habit_templates(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  entry_date  date not null,
  status      varchar(10) not null check (status in ('done','skipped')),
  created_at  timestamptz default now(),
  unique (template_id, user_id, entry_date)
);
create index if not exists idx_habit_entries_user_date on public.habit_entries (user_id, entry_date);
create index if not exists idx_habit_entries_template on public.habit_entries (template_id, entry_date);
alter table public.habit_entries enable row level security;

-- ─── Confessions ─────────────────────────────────────────────────────────────
create table if not exists public.confessions (
  id             uuid primary key default gen_random_uuid(),
  title          text not null,
  body           text not null,
  scheduled_date date not null,
  created_by     uuid not null references public.profiles(id),
  is_active      boolean not null default true,
  created_at     timestamptz not null default now()
);
alter table public.confessions enable row level security;

create table if not exists public.confession_declarations (
  id            uuid primary key default gen_random_uuid(),
  confession_id uuid not null references public.confessions(id) on delete cascade,
  user_id       uuid not null references public.profiles(id) on delete cascade,
  declared_at   timestamptz not null default now(),
  unique (confession_id, user_id)
);
alter table public.confession_declarations enable row level security;

-- ─── Prayer requests (read by the dashboard stats; shape = PrayerRequest type) ─
create table if not exists public.prayer_requests (
  id           uuid primary key default gen_random_uuid(),
  content      text not null,
  author_id    uuid not null references public.profiles(id) on delete cascade,
  author_name  text not null,
  is_anonymous boolean not null default false,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now()
);
alter table public.prayer_requests enable row level security;

-- ─── Storage: avatar bucket used by useUserProfile ───────────────────────────
insert into storage.buckets (id, name, public)
values ('user-media', 'user-media', true)
on conflict (id) do nothing;
