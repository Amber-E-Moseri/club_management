-- Migration 005: cells, contacts, and contact settings tables

-- ─── Cells ───────────────────────────────────────────────────────────────────

create table if not exists public.cells (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(name) >= 1),
  leader_id  uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists cells_updated_at on public.cells;
create trigger cells_updated_at
  before update on public.cells
  for each row execute procedure public.set_updated_at();

alter table public.cells enable row level security;

drop policy if exists cells_read on public.cells;
create policy cells_read on public.cells
  for select using (auth.role() = 'authenticated');

drop policy if exists cells_manage on public.cells;
create policy cells_manage on public.cells
  for all using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'coordinator')
  )
  with check (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'coordinator')
  );

-- ─── Contact Tags ─────────────────────────────────────────────────────────────

create table if not exists public.tags_settings (
  id             uuid primary key default gen_random_uuid(),
  coordinator_id uuid not null references public.profiles(id) on delete cascade,
  tag_name       text not null check (char_length(tag_name) >= 1),
  color          text not null default '#0066FF',
  sort_order     int  not null default 0,
  created_at     timestamptz not null default now()
);

alter table public.tags_settings enable row level security;

drop policy if exists tags_settings_read on public.tags_settings;
create policy tags_settings_read on public.tags_settings
  for select using (auth.role() = 'authenticated');

drop policy if exists tags_settings_manage on public.tags_settings;
create policy tags_settings_manage on public.tags_settings
  for all using (public.is_core_admin())
  with check (public.is_core_admin());

-- ─── Contact Statuses ─────────────────────────────────────────────────────────

create table if not exists public.status_settings (
  id             uuid primary key default gen_random_uuid(),
  coordinator_id uuid not null references public.profiles(id) on delete cascade,
  status_name    text not null check (char_length(status_name) >= 1),
  color          text not null default '#4CAF50',
  sort_order     int  not null default 0,
  created_at     timestamptz not null default now()
);

alter table public.status_settings enable row level security;

drop policy if exists status_settings_read on public.status_settings;
create policy status_settings_read on public.status_settings
  for select using (auth.role() = 'authenticated');

drop policy if exists status_settings_manage on public.status_settings;
create policy status_settings_manage on public.status_settings
  for all using (public.is_core_admin())
  with check (public.is_core_admin());

-- ─── Helper: cell leader check ───────────────────────────────────────────────

create or replace function public.is_cell_leader_of(p_cell_id uuid)
returns boolean language sql stable as $$
  select case
    when p_cell_id is null then false
    else exists (
      select 1 from public.cells
      where id = p_cell_id and leader_id = auth.uid()
    )
  end;
$$;

-- ─── Contacts ────────────────────────────────────────────────────────────────

create table if not exists public.contacts (
  id               uuid primary key default gen_random_uuid(),
  cell_id          uuid references public.cells(id) on delete set null,
  contact_name     text not null check (char_length(contact_name) >= 2),
  contact_phone    text,
  phone_hidden     boolean not null default false,
  tag              text,
  follow_up_status text,
  date_contacted   date not null default current_date,
  notes            text,
  is_member        boolean not null default false,
  member_id        uuid references public.profiles(id) on delete set null,
  logged_by        uuid not null references public.profiles(id) on delete restrict,
  archived         boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

drop trigger if exists contacts_updated_at on public.contacts;
create trigger contacts_updated_at
  before update on public.contacts
  for each row execute procedure public.set_updated_at();

create index if not exists contacts_cell_idx      on public.contacts (cell_id);
create index if not exists contacts_logged_by_idx on public.contacts (logged_by);
create index if not exists contacts_date_idx      on public.contacts (date_contacted desc);
create index if not exists contacts_archived_idx  on public.contacts (archived) where archived = false;

alter table public.contacts enable row level security;

drop policy if exists contacts_read on public.contacts;
create policy contacts_read on public.contacts
  for select using (
    public.is_core_admin()
    or public.is_cell_leader_of(cell_id)
    or logged_by = auth.uid()
  );

drop policy if exists contacts_insert on public.contacts;
create policy contacts_insert on public.contacts
  for insert with check (
    public.is_core_admin()
    or public.is_cell_leader_of(cell_id)
  );

drop policy if exists contacts_update on public.contacts;
create policy contacts_update on public.contacts
  for update
  using (public.is_core_admin() or public.is_cell_leader_of(cell_id) or logged_by = auth.uid())
  with check (public.is_core_admin() or public.is_cell_leader_of(cell_id) or logged_by = auth.uid());

drop policy if exists contacts_delete on public.contacts;
create policy contacts_delete on public.contacts
  for delete using (public.is_core_admin() or logged_by = auth.uid());
