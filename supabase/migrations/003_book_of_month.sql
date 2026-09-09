-- ─── 003_book_of_month.sql ───────────────────────────────────────────────────
-- Run this in: Supabase Dashboard → SQL Editor → New Query → Run

create table if not exists public.books_of_month (
  id              uuid primary key default gen_random_uuid(),
  title           text not null,
  author          text not null,
  description     text,
  cover_image_url text,
  drive_url       text not null,
  active_from     date not null,
  active_until    date not null,
  created_by      uuid references auth.users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint valid_date_range check (active_until >= active_from)
);

drop trigger if exists books_updated_at on public.books_of_month;
create trigger books_updated_at
  before update on public.books_of_month
  for each row execute procedure public.set_updated_at();

alter table public.books_of_month enable row level security;

drop policy if exists "books_select"  on public.books_of_month;
drop policy if exists "books_insert"  on public.books_of_month;
drop policy if exists "books_update"  on public.books_of_month;
drop policy if exists "books_delete"  on public.books_of_month;

-- Everyone (even anonymous) can view books
create policy "books_select" on public.books_of_month
  for select using (true);

-- Only coordinators/admins insert/update/delete (enforced at app layer; basic RLS: must be auth)
create policy "books_insert" on public.books_of_month
  for insert with check (auth.role() = 'authenticated');

create policy "books_update" on public.books_of_month
  for update using (auth.role() = 'authenticated');

create policy "books_delete" on public.books_of_month
  for delete using (auth.role() = 'authenticated');
