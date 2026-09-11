-- ============================================================
-- Christian Club Portal – Database Schema
-- Run this in the Supabase SQL Editor (Project > SQL Editor)
-- ============================================================

create extension if not exists "uuid-ossp";

-- ─── Profiles ────────────────────────────────────────────────────────────────
-- Extends auth.users; populated by a trigger on sign-up

create table if not exists public.profiles (
  id          uuid primary key references auth.users on delete cascade,
  email       text not null,
  full_name   text not null default '',
  role        text not null default 'member'
              check (role in ('coordinator','admin','cell_leader','member')),
  cell_id     uuid,
  admin_role  text,
  avatar_url  text,
  joined_at   timestamptz not null default now()
);

alter table public.profiles enable row level security;
create policy "profiles_read"   on public.profiles for select using (auth.role() = 'authenticated');
create policy "profiles_update" on public.profiles for update using (auth.uid() = id);

-- Auto-create profile row on sign-up
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ─── Cells ───────────────────────────────────────────────────────────────────

create table if not exists public.cells (
  id         uuid primary key default uuid_generate_v4(),
  name       text not null,
  leader_id  uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.cells enable row level security;
create policy "cells_read"   on public.cells for select using (auth.role() = 'authenticated');
create policy "cells_manage" on public.cells for all using (
  exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','coordinator'))
);

-- Seed one default cell
insert into public.cells (name) values ('Cell 1') on conflict do nothing;

-- ─── Tag Settings ────────────────────────────────────────────────────────────

create table if not exists public.tags_settings (
  id             uuid primary key default uuid_generate_v4(),
  coordinator_id uuid references public.profiles(id) on delete set null,
  tag_name       text not null,
  color          text not null default '#0066FF',
  "order"        int  not null default 0,
  created_at     timestamptz not null default now()
);

alter table public.tags_settings enable row level security;
create policy "tags_read"   on public.tags_settings for select using (auth.role() = 'authenticated');
create policy "tags_manage" on public.tags_settings for all using (
  exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','coordinator'))
);

insert into public.tags_settings (tag_name, color, "order") values
  ('Interested',      '#2196F3', 1),
  ('First Timer',     '#E31837', 2),
  ('Regular Visitor', '#4CAF50', 3),
  ('New Convert',     '#FF9800', 4),
  ('Church Member',   '#9C27B0', 5)
on conflict do nothing;

-- ─── Status Settings ─────────────────────────────────────────────────────────

create table if not exists public.status_settings (
  id             uuid primary key default uuid_generate_v4(),
  coordinator_id uuid references public.profiles(id) on delete set null,
  status_name    text not null,
  color          text not null default '#666666',
  "order"        int  not null default 0,
  created_at     timestamptz not null default now()
);

alter table public.status_settings enable row level security;
create policy "statuses_read"   on public.status_settings for select using (auth.role() = 'authenticated');
create policy "statuses_manage" on public.status_settings for all using (
  exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','coordinator'))
);

insert into public.status_settings (status_name, color, "order") values
  ('Will Follow Up',  '#FF9800', 1),
  ('Contacted',       '#4CAF50', 2),
  ('Not Interested',  '#E31837', 3),
  ('Following Up',    '#2196F3', 4),
  ('Joined Cell',     '#9C27B0', 5)
on conflict do nothing;

-- ─── Contacts (CRM) ──────────────────────────────────────────────────────────

create table if not exists public.contacts (
  id               uuid primary key default uuid_generate_v4(),
  cell_id          uuid references public.cells(id) on delete set null,
  contact_name     text not null,
  contact_phone    text,
  phone_hidden     boolean not null default false,
  tag              text not null,
  follow_up_status text not null,
  date_contacted   date not null default current_date,
  notes            text,
  is_member        boolean not null default false,
  member_id        uuid references public.profiles(id) on delete set null,
  logged_by        uuid not null references public.profiles(id),
  archived         boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

alter table public.contacts enable row level security;

-- Coordinator / Admin: full access to all contacts
create policy "contacts_admin" on public.contacts for all using (
  exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','coordinator'))
);

-- Cell leader: own cell only
create policy "contacts_leader" on public.contacts for all using (
  exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'cell_leader' and cell_id = contacts.cell_id
  )
);

-- Member: read own cell, non-archived
create policy "contacts_member_read" on public.contacts for select using (
  exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'member' and cell_id = contacts.cell_id
  ) and archived = false
);

-- Updated-at trigger
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

create trigger contacts_updated_at before update on public.contacts
  for each row execute procedure public.set_updated_at();

-- ─── Confessions ─────────────────────────────────────────────────────────────

create table if not exists public.confessions (
  id             uuid primary key default uuid_generate_v4(),
  title          text not null,
  body           text not null,
  scheduled_date date not null,
  created_by     uuid not null references public.profiles(id),
  is_active      boolean not null default true,
  created_at     timestamptz not null default now()
);

alter table public.confessions enable row level security;
create policy "confessions_read" on public.confessions
  for select using (auth.role() = 'authenticated' and is_active = true);
create policy "confessions_manage" on public.confessions for all using (
  exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','coordinator'))
);

create table if not exists public.confession_declarations (
  id            uuid primary key default uuid_generate_v4(),
  confession_id uuid not null references public.confessions(id) on delete cascade,
  user_id       uuid not null references public.profiles(id) on delete cascade,
  declared_at   timestamptz not null default now(),
  unique (confession_id, user_id)
);

alter table public.confession_declarations enable row level security;
create policy "declarations_own" on public.confession_declarations
  for all using (auth.uid() = user_id);
create policy "declarations_admin_read" on public.confession_declarations
  for select using (
    exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','coordinator'))
  );

-- ─── Testimonies ─────────────────────────────────────────────────────────────

create table if not exists public.testimonies (
  id          uuid primary key default uuid_generate_v4(),
  author_id   uuid not null references public.profiles(id) on delete cascade,
  author_name text not null,
  title       text not null,
  body        text not null,
  category    text not null
              check (category in ('provision','healing','prayer_answered','growth','other')),
  visibility  text not null default 'members'
              check (visibility in ('private','members','cell','public')),
  cell_id     uuid references public.cells(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.testimonies enable row level security;

create trigger testimonies_updated_at before update on public.testimonies
  for each row execute procedure public.set_updated_at();

create policy "testimonies_own"    on public.testimonies for all using (auth.uid() = author_id);
create policy "testimonies_members" on public.testimonies for select using (
  auth.role() = 'authenticated' and visibility in ('members','public')
);
create policy "testimonies_cell"   on public.testimonies for select using (
  visibility = 'cell' and exists (
    select 1 from public.profiles where id = auth.uid() and cell_id = testimonies.cell_id
  )
);

-- ─── Meetings ────────────────────────────────────────────────────────────────

create table if not exists public.meetings (
  id             uuid primary key default uuid_generate_v4(),
  title          text not null,
  description    text,
  date           date not null,
  time           time not null,
  end_time       time,
  location       text,
  zoom_link      text,
  visibility     text not null default 'public'
                 check (visibility in ('public','leaders','cell','explicit')),
  category       text not null default 'general'
                 check (category in ('general','bsc','cell','leadership')),
  allow_join_requests boolean not null default false,
  cell_id        uuid references public.cells(id),
  created_by     uuid not null references public.profiles(id),
  reminder_sent  boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

alter table public.meetings enable row level security;

create trigger meetings_updated_at before update on public.meetings
  for each row execute procedure public.set_updated_at();

create policy "meetings_public_read" on public.meetings for select using (
  auth.role() = 'authenticated' and visibility = 'public'
);
create policy "meetings_leaders_read" on public.meetings for select using (
  visibility = 'leaders' and exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('cell_leader','admin','coordinator')
  )
);
create policy "meetings_cell_read" on public.meetings for select using (
  visibility = 'cell' and exists (
    select 1 from public.profiles where id = auth.uid() and cell_id = meetings.cell_id
  )
);
create policy "meetings_manage" on public.meetings for all using (
  exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('admin','coordinator','cell_leader')
  )
);

create table if not exists public.meeting_attendances (
  id           uuid primary key default uuid_generate_v4(),
  meeting_id   uuid not null references public.meetings(id) on delete cascade,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  user_name    text not null,
  confirmed_at timestamptz not null default now(),
  attended     boolean,
  unique (meeting_id, user_id)
);

alter table public.meeting_attendances enable row level security;
create policy "attendance_own"   on public.meeting_attendances for all using (auth.uid() = user_id);
create policy "attendance_admin" on public.meeting_attendances for select using (
  exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('admin','coordinator','cell_leader')
  )
);
