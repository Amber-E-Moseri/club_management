-- ============================================================
-- BLW York Hub - Phase 2 database migration
-- Run in Supabase SQL Editor. Safe to re-run.
-- ============================================================

create extension if not exists "uuid-ossp";

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- 1. Meetings columns required by MeetingInput
alter table public.meetings
  add column if not exists category text not null default 'general'
    check (category in ('general', 'bsc', 'cell', 'leadership')),
  add column if not exists allow_join_requests boolean not null default false;

-- 2. Extended user profile data
create table if not exists public.user_profiles (
  user_id        uuid primary key references public.profiles(id) on delete cascade,
  first_name     text not null default '',
  last_name      text not null default '',
  phone          text,
  avatar_url     text,
  bio            text check (char_length(bio) <= 500),
  student_number text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

drop trigger if exists user_profiles_updated_at on public.user_profiles;
create trigger user_profiles_updated_at
  before update on public.user_profiles
  for each row execute procedure public.set_updated_at();

alter table public.user_profiles enable row level security;

drop policy if exists "user_profiles_own_select" on public.user_profiles;
create policy "user_profiles_own_select"
  on public.user_profiles for select
  using (auth.uid() = user_id);

drop policy if exists "user_profiles_admin_read" on public.user_profiles;
create policy "user_profiles_admin_read"
  on public.user_profiles for select
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('admin', 'coordinator')
    )
  );

drop policy if exists "user_profiles_own_insert" on public.user_profiles;
create policy "user_profiles_own_insert"
  on public.user_profiles for insert
  with check (auth.uid() = user_id);

drop policy if exists "user_profiles_own_update" on public.user_profiles;
create policy "user_profiles_own_update"
  on public.user_profiles for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 3. Events and RSVPs
create table if not exists public.events (
  id           uuid primary key default uuid_generate_v4(),
  title        text not null,
  description  text,
  date         date not null,
  time         time,
  location     text,
  image_url    text,
  category     text not null default 'Other'
               check (category in ('Bible Study','Worship','Fellowship','Outreach','Prayer','Other')),
  created_by   uuid not null references public.profiles(id),
  created_at   timestamptz not null default now()
);

alter table public.events enable row level security;

drop policy if exists "events_read" on public.events;
create policy "events_read"
  on public.events for select
  using (auth.role() = 'authenticated');

drop policy if exists "events_manage" on public.events;
create policy "events_manage"
  on public.events for all
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('admin', 'coordinator')
    )
  );

create table if not exists public.event_rsvps (
  event_id   uuid not null references public.events(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

alter table public.event_rsvps enable row level security;

drop policy if exists "rsvps_own" on public.event_rsvps;
create policy "rsvps_own"
  on public.event_rsvps for all
  using (auth.uid() = user_id);

-- 4. Announcements
create table if not exists public.announcements (
  id          uuid primary key default uuid_generate_v4(),
  title       text not null,
  body        text not null,
  author_id   uuid not null references public.profiles(id),
  author_name text not null,
  created_at  timestamptz not null default now()
);

alter table public.announcements enable row level security;

drop policy if exists "ann_read" on public.announcements;
create policy "ann_read"
  on public.announcements for select
  using (auth.role() = 'authenticated');

drop policy if exists "ann_manage" on public.announcements;
create policy "ann_manage"
  on public.announcements for all
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('admin', 'coordinator', 'cell_leader')
    )
  );

-- 5. After this file, run src/db/schema-phase1b.sql separately
-- to create weekly_messages, habit_templates, and habit_entries.
