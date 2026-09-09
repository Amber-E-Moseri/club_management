create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.is_devotional_admin()
returns boolean
language sql
stable
as $$
  select coalesce(auth.jwt() -> 'user_metadata' ->> 'role', '') in ('admin', 'coordinator')
      or coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') in ('admin', 'coordinator');
$$;

create table if not exists public.monthly_devotionals (
  id uuid primary key default gen_random_uuid(),
  month int not null check (month between 1 and 12),
  year int not null check (year between 2000 and 2100),
  title varchar(160) not null,
  book_title varchar(160) not null,
  author varchar(160),
  total_days int not null check (total_days between 28 and 31),
  total_pages int not null check (total_pages > 0),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (month, year, book_title)
);

drop trigger if exists monthly_devotionals_updated_at on public.monthly_devotionals;
create trigger monthly_devotionals_updated_at
  before update on public.monthly_devotionals
  for each row execute procedure public.set_updated_at();

create table if not exists public.devotional_daily_pages (
  id uuid primary key default gen_random_uuid(),
  devotional_id uuid not null references public.monthly_devotionals(id) on delete cascade,
  day_of_month int not null check (day_of_month between 1 and 31),
  page_range varchar(32) not null,
  image_url varchar(2048) not null,
  title varchar(160),
  created_at timestamptz not null default now(),
  unique (devotional_id, day_of_month)
);

create table if not exists public.devotional_views (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references auth.users(id) on delete cascade,
  devotional_id uuid not null references public.monthly_devotionals(id) on delete cascade,
  day_of_month int not null check (day_of_month between 1 and 31),
  viewed_date date not null,
  viewed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (member_id, devotional_id, day_of_month, viewed_date)
);

create index if not exists devotional_views_viewed_date_devotional_idx
  on public.devotional_views (viewed_date, devotional_id);

create index if not exists devotional_daily_pages_devotional_day_idx
  on public.devotional_daily_pages (devotional_id, day_of_month);

alter table public.monthly_devotionals enable row level security;
alter table public.devotional_daily_pages enable row level security;
alter table public.devotional_views enable row level security;

drop policy if exists monthly_devotionals_select on public.monthly_devotionals;
create policy monthly_devotionals_select
  on public.monthly_devotionals for select
  using (auth.role() = 'authenticated');

drop policy if exists monthly_devotionals_insert_admin on public.monthly_devotionals;
create policy monthly_devotionals_insert_admin
  on public.monthly_devotionals for insert
  with check (auth.uid() = created_by and public.is_devotional_admin());

drop policy if exists monthly_devotionals_update_admin on public.monthly_devotionals;
create policy monthly_devotionals_update_admin
  on public.monthly_devotionals for update
  using (public.is_devotional_admin())
  with check (public.is_devotional_admin());

drop policy if exists monthly_devotionals_delete_admin on public.monthly_devotionals;
create policy monthly_devotionals_delete_admin
  on public.monthly_devotionals for delete
  using (public.is_devotional_admin());

drop policy if exists devotional_daily_pages_select on public.devotional_daily_pages;
create policy devotional_daily_pages_select
  on public.devotional_daily_pages for select
  using (auth.role() = 'authenticated');

drop policy if exists devotional_daily_pages_insert_admin on public.devotional_daily_pages;
create policy devotional_daily_pages_insert_admin
  on public.devotional_daily_pages for insert
  with check (public.is_devotional_admin());

drop policy if exists devotional_daily_pages_update_admin on public.devotional_daily_pages;
create policy devotional_daily_pages_update_admin
  on public.devotional_daily_pages for update
  using (public.is_devotional_admin())
  with check (public.is_devotional_admin());

drop policy if exists devotional_daily_pages_delete_admin on public.devotional_daily_pages;
create policy devotional_daily_pages_delete_admin
  on public.devotional_daily_pages for delete
  using (public.is_devotional_admin());

drop policy if exists devotional_views_select_own_or_admin on public.devotional_views;
create policy devotional_views_select_own_or_admin
  on public.devotional_views for select
  using (auth.uid() = member_id or public.is_devotional_admin());

drop policy if exists devotional_views_insert_own on public.devotional_views;
create policy devotional_views_insert_own
  on public.devotional_views for insert
  with check (auth.uid() = member_id);

drop policy if exists devotional_views_update_own on public.devotional_views;
create policy devotional_views_update_own
  on public.devotional_views for update
  using (auth.uid() = member_id)
  with check (auth.uid() = member_id);

insert into storage.buckets (id, name, public)
values ('devotional-images', 'devotional-images', true)
on conflict (id) do nothing;

drop policy if exists devotional_images_public_read on storage.objects;
create policy devotional_images_public_read
  on storage.objects for select
  using (bucket_id = 'devotional-images');

drop policy if exists devotional_images_admin_write on storage.objects;
create policy devotional_images_admin_write
  on storage.objects for insert
  with check (bucket_id = 'devotional-images' and public.is_devotional_admin());

drop policy if exists devotional_images_admin_update on storage.objects;
create policy devotional_images_admin_update
  on storage.objects for update
  using (bucket_id = 'devotional-images' and public.is_devotional_admin())
  with check (bucket_id = 'devotional-images' and public.is_devotional_admin());
