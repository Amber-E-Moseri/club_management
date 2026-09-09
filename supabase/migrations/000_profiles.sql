-- Core profiles table — mirrors auth.users with app-level role/cell data.
-- Must run before any other migration that references public.profiles.

create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text,
  full_name   text,
  role        text not null default 'member'
                check (role in ('coordinator','admin','cell_leader','member')),
  cell_id     uuid,
  admin_role  text,
  avatar_url  text,
  joined_at   timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Keep updated_at current
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at
  before update on public.profiles
  for each row execute procedure public.set_updated_at();

-- Auto-create a profile row when a new auth user is created
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, role, avatar_url, joined_at)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)),
    coalesce(new.raw_user_meta_data->>'role', 'member'),
    new.raw_user_meta_data->>'avatar_url',
    new.created_at
  )
  on conflict (id) do update set
    email      = excluded.email,
    full_name  = coalesce(excluded.full_name, profiles.full_name),
    updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Backfill existing auth users
insert into public.profiles (id, email, full_name, role, avatar_url, joined_at)
select
  id,
  email,
  coalesce(raw_user_meta_data->>'full_name', split_part(email,'@',1)),
  coalesce(raw_user_meta_data->>'role', 'member'),
  raw_user_meta_data->>'avatar_url',
  created_at
from auth.users
on conflict (id) do nothing;

-- RLS
alter table public.profiles enable row level security;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select using (auth.role() = 'authenticated');

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists profiles_coordinator on public.profiles;
create policy profiles_coordinator on public.profiles
  for all using (
    exists (select 1 from public.profiles p2 where p2.id = auth.uid() and p2.role = 'coordinator')
  )
  with check (
    exists (select 1 from public.profiles p2 where p2.id = auth.uid() and p2.role = 'coordinator')
  );
