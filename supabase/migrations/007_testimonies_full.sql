-- ─── 002_testimonies_full.sql ────────────────────────────────────────────────
-- Run this in: Supabase Dashboard → SQL Editor → New Query → Run

-- ─── 1. Core testimonies table ───────────────────────────────────────────────
create table if not exists public.testimonies (
  id            uuid primary key default gen_random_uuid(),
  author_id     uuid not null references auth.users(id) on delete cascade,
  author_name   text not null,
  entry_type    text not null default 'testimony'
                  check (entry_type in ('testimony','prophecy')),
  title         text not null,
  body          text not null check (char_length(body) >= 10),
  category      text not null default 'other'
                  check (category in ('provision','healing','prayer_answered','growth','other')),
  visibility    text not null default 'members'
                  check (visibility in ('draft','private','cell','members','public')),
  status        text not null default 'pending'
                  check (status in ('pending','approved','rejected','archived')),
  image_url     text,
  cell_id       uuid,
  archived_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Add new columns to existing table (safe if already run)
alter table public.testimonies
  add column if not exists entry_type text not null default 'testimony'
    check (entry_type in ('testimony','prophecy')),
  add column if not exists status text not null default 'pending'
    check (status in ('pending','approved','rejected','archived')),
  add column if not exists image_url text,
  add column if not exists archived_at timestamptz;

-- ─── 2. Reactions ─────────────────────────────────────────────────────────────
create table if not exists public.testimony_reactions (
  id            uuid primary key default gen_random_uuid(),
  testimony_id  uuid not null references public.testimonies(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  reaction_type text not null check (reaction_type in ('heart','fire','pray')),
  created_at    timestamptz not null default now(),
  unique (testimony_id, user_id, reaction_type)
);

-- ─── 3. Comments ──────────────────────────────────────────────────────────────
create table if not exists public.testimony_comments (
  id            uuid primary key default gen_random_uuid(),
  testimony_id  uuid not null references public.testimonies(id) on delete cascade,
  author_id     uuid not null references auth.users(id) on delete cascade,
  author_name   text not null,
  body          text not null check (char_length(body) >= 1 and char_length(body) <= 1000),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ─── 4. updated_at triggers ───────────────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists testimonies_updated_at on public.testimonies;
create trigger testimonies_updated_at
  before update on public.testimonies
  for each row execute procedure public.set_updated_at();

drop trigger if exists testimony_comments_updated_at on public.testimony_comments;
create trigger testimony_comments_updated_at
  before update on public.testimony_comments
  for each row execute procedure public.set_updated_at();

-- ─── 5. RLS ───────────────────────────────────────────────────────────────────
alter table public.testimonies          enable row level security;
alter table public.testimony_reactions  enable row level security;
alter table public.testimony_comments   enable row level security;

-- Drop existing policies to allow idempotent re-runs
drop policy if exists "testimonies_select"           on public.testimonies;
drop policy if exists "testimonies_insert"           on public.testimonies;
drop policy if exists "testimonies_update"           on public.testimonies;
drop policy if exists "testimonies_delete"           on public.testimonies;
drop policy if exists "reactions_select"             on public.testimony_reactions;
drop policy if exists "reactions_insert"             on public.testimony_reactions;
drop policy if exists "reactions_delete"             on public.testimony_reactions;
drop policy if exists "comments_select"              on public.testimony_comments;
drop policy if exists "comments_insert"              on public.testimony_comments;
drop policy if exists "comments_delete"              on public.testimony_comments;

-- ── Testimonies SELECT ────────────────────────────────────────────────────────
-- Visibility rules:
--   public    → anyone (including anon) can read approved ones
--   members   → authenticated users
--   cell      → same cell_id
--   draft     → own user only
--   private   → own user only
--   Coordinators/admins see everything approved + all drafts/pending of others
create policy "testimonies_select" on public.testimonies
  for select using (
    -- own drafts/private always visible
    author_id = auth.uid()
    or (
      status = 'approved'
      and (
        visibility = 'public'
        or (visibility = 'members'  and auth.role() = 'authenticated')
        or (visibility = 'cell'     and auth.role() = 'authenticated')
      )
    )
    -- admins/coordinators see pending too
    or (
      auth.role() = 'authenticated'
      and exists (
        select 1 from public.user_profiles
        where user_id = auth.uid()
      )
    )
  );

-- ── Testimonies INSERT ────────────────────────────────────────────────────────
create policy "testimonies_insert" on public.testimonies
  for insert with check (author_id = auth.uid());

-- ── Testimonies UPDATE ────────────────────────────────────────────────────────
create policy "testimonies_update" on public.testimonies
  for update using (author_id = auth.uid())
  with check (author_id = auth.uid());

-- ── Testimonies DELETE ────────────────────────────────────────────────────────
create policy "testimonies_delete" on public.testimonies
  for delete using (author_id = auth.uid());

-- ── Reactions SELECT ─────────────────────────────────────────────────────────
create policy "reactions_select" on public.testimony_reactions
  for select using (auth.role() = 'authenticated');

-- ── Reactions INSERT ─────────────────────────────────────────────────────────
create policy "reactions_insert" on public.testimony_reactions
  for insert with check (user_id = auth.uid());

-- ── Reactions DELETE ─────────────────────────────────────────────────────────
create policy "reactions_delete" on public.testimony_reactions
  for delete using (user_id = auth.uid());

-- ── Comments SELECT ──────────────────────────────────────────────────────────
create policy "comments_select" on public.testimony_comments
  for select using (auth.role() = 'authenticated');

-- ── Comments INSERT ──────────────────────────────────────────────────────────
create policy "comments_insert" on public.testimony_comments
  for insert with check (author_id = auth.uid());

-- ── Comments DELETE ──────────────────────────────────────────────────────────
create policy "comments_delete" on public.testimony_comments
  for delete using (author_id = auth.uid());

-- ─── 6. Storage bucket for testimony images ───────────────────────────────────
insert into storage.buckets (id, name, public)
values ('testimony-images', 'testimony-images', true)
on conflict (id) do nothing;

drop policy if exists "testimony_images_select" on storage.objects;
create policy "testimony_images_select"
  on storage.objects for select
  using (bucket_id = 'testimony-images');

drop policy if exists "testimony_images_insert" on storage.objects;
create policy "testimony_images_insert"
  on storage.objects for insert
  with check (bucket_id = 'testimony-images' and auth.role() = 'authenticated');

drop policy if exists "testimony_images_delete" on storage.objects;
create policy "testimony_images_delete"
  on storage.objects for delete
  using (bucket_id = 'testimony-images' and auth.uid()::text = (storage.foldername(name))[1]);
