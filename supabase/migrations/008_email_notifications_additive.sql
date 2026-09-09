-- Migration 008: Email notification hardening
-- Additive, production-safe schema for Prompt 6.2.

create table if not exists public.email_preferences (
  id                    uuid primary key default gen_random_uuid(),
  member_id             uuid not null references public.profiles(id) on delete cascade,
  meeting_reminders_8am boolean not null default true,
  meeting_reminders_1hr boolean not null default true,
  message_notifications boolean not null default true,
  habit_milestones      boolean not null default true,
  devotional_reminders  boolean not null default true,
  testimony_approved    boolean not null default true,
  weekly_digest         boolean not null default false,
  admin_announcements   boolean not null default true,
  opt_out_all           boolean not null default false,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (member_id)
);

alter table public.email_preferences
  add column if not exists meeting_reminders_8am boolean not null default true,
  add column if not exists meeting_reminders_1hr boolean not null default true,
  add column if not exists message_notifications boolean not null default true,
  add column if not exists habit_milestones boolean not null default true,
  add column if not exists devotional_reminders boolean not null default true,
  add column if not exists testimony_approved boolean not null default true,
  add column if not exists weekly_digest boolean not null default false,
  add column if not exists admin_announcements boolean not null default true,
  add column if not exists opt_out_all boolean not null default false;

create table if not exists public.email_log (
  id              uuid primary key default gen_random_uuid(),
  member_id       uuid references public.profiles(id) on delete set null,
  recipient_email varchar(320) not null,
  subject         varchar(998) not null,
  template_type   varchar(50) not null default 'generic',
  status          varchar(20) not null default 'queued',
  sent_at         timestamptz,
  failed_reason   varchar(500),
  opened_at       timestamptz,
  clicked_at      timestamptz,
  html_content    text,
  text_content    text,
  provider_message_id text,
  retry_count     integer not null default 0,
  created_at      timestamptz not null default now()
);

alter table public.email_log
  add column if not exists html_content text,
  add column if not exists text_content text,
  add column if not exists provider_message_id text,
  add column if not exists retry_count integer not null default 0;

create table if not exists public.scheduled_emails (
  id              uuid primary key default gen_random_uuid(),
  recipient_email varchar(320) not null,
  subject         varchar(998) not null,
  html_content    text not null,
  scheduled_for   timestamptz not null,
  sent            boolean not null default false,
  sent_at         timestamptz,
  created_at      timestamptz not null default now()
);

create index if not exists idx_email_prefs_member on public.email_preferences (member_id);
create index if not exists idx_email_log_member on public.email_log (member_id);
create index if not exists idx_email_log_status on public.email_log (status, created_at desc);
create index if not exists idx_email_log_template on public.email_log (template_type, created_at desc);
create index if not exists idx_scheduled_emails_pending on public.scheduled_emails (scheduled_for) where sent = false;

alter table public.email_preferences enable row level security;
alter table public.email_log enable row level security;
alter table public.scheduled_emails enable row level security;

drop policy if exists email_prefs_own_read on public.email_preferences;
create policy email_prefs_own_read on public.email_preferences
  for select using (auth.uid() = member_id);

drop policy if exists email_prefs_own_write on public.email_preferences;
create policy email_prefs_own_write on public.email_preferences
  for all using (auth.uid() = member_id)
  with check (auth.uid() = member_id);

drop policy if exists email_prefs_admin_read on public.email_preferences;
create policy email_prefs_admin_read on public.email_preferences
  for select using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('admin', 'coordinator')
    )
  );

drop policy if exists email_log_own_read on public.email_log;
create policy email_log_own_read on public.email_log
  for select using (auth.uid() = member_id);

drop policy if exists email_log_admin_read on public.email_log;
create policy email_log_admin_read on public.email_log
  for select using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('admin', 'coordinator')
    )
  );

drop policy if exists email_log_admin_manage on public.email_log;
create policy email_log_admin_manage on public.email_log
  for all using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('admin', 'coordinator')
    )
  )
  with check (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('admin', 'coordinator')
    )
  );
