-- user_profiles: extended profile data beyond auth.users
create table if not exists public.user_profiles (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  first_name  text,
  last_name   text,
  phone       text,
  avatar_url  text,
  bio            text check (char_length(bio) <= 500),
  student_number text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Auto-update updated_at
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists user_profiles_updated_at on public.user_profiles;
create trigger user_profiles_updated_at
  before update on public.user_profiles
  for each row execute procedure public.set_updated_at();

-- RLS
alter table public.user_profiles enable row level security;

-- Any authenticated user can read any profile (for member directory)
create policy "profiles_select"
  on public.user_profiles for select
  using (auth.role() = 'authenticated');

-- Users can only insert/update their own row
create policy "profiles_insert"
  on public.user_profiles for insert
  with check (auth.uid() = user_id);

create policy "profiles_update"
  on public.user_profiles for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "profiles_delete"
  on public.user_profiles for delete
  using (auth.uid() = user_id);
