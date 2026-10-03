-- Migration 010: security hardening (authorization model of record)
--
-- Replaces every RLS policy on application tables with ONE canonical, reviewed set, so the final
-- state does not depend on which historical SQL file was run by hand in production.
--
-- Model
--   * profiles.status = 'active' is required for ANY access to application data (pending/rejected
--     users can read only their own profile row). Enforced by a RESTRICTIVE policy on every table.
--   * profiles.role / admin_role / cell_id / status can NOT be changed through the API except by the
--     people allowed to (trigger profiles_guard). New sign-ups are always role=member, status=pending.
--   * Fine-grained admin_role_permissions are enforced in the database via has_admin_permission().
--   * anon has no table privileges; service_role (Edge Functions) bypasses RLS as before.
--
-- BEFORE APPLYING TO PRODUCTION: snapshot `select * from pg_policies where schemaname='public'`
-- (policies not defined in this repo are dropped by the reset below).

-- ─── Helper functions (SECURITY DEFINER avoids RLS recursion on profiles) ─────
create or replace function public.is_active_member()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and status = 'active');
$$;

create or replace function public.is_core_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles
                 where id = auth.uid() and status = 'active' and role in ('admin', 'coordinator'));
$$;

create or replace function public.is_coordinator()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles
                 where id = auth.uid() and status = 'active' and role = 'coordinator');
$$;

create or replace function public.is_staff_role()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles
                 where id = auth.uid() and status = 'active' and role in ('admin', 'coordinator', 'cell_leader'));
$$;

create or replace function public.has_admin_permission(p_key text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_core_admin()
      or exists (
        select 1
        from public.admin_role_assignments a
        join public.admin_role_permissions rp on rp.role_id = a.role_id
        where a.user_id = auth.uid() and rp.permission_key = p_key and public.is_active_member()
      );
$$;

create or replace function public.is_cell_leader_of(p_cell_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case when p_cell_id is null or not public.is_active_member() then false
    else exists (select 1 from public.cells where id = p_cell_id and leader_id = auth.uid()) end;
$$;

-- Devotional admin was derived from user-editable JWT user_metadata (any user could self-grant it).
create or replace function public.is_devotional_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_admin_permission('devotionals.manage');
$$;

-- ─── New sign-ups: always member + pending, never trust client metadata ───────
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, student_number, avatar_url, role, status, joined_at)
  values (
    new.id,
    new.email,
    coalesce(nullif(new.raw_user_meta_data->>'full_name', ''), split_part(new.email, '@', 1)),
    new.raw_user_meta_data->>'student_number',
    new.raw_user_meta_data->>'avatar_url',
    'member',
    'pending',
    new.created_at
  )
  on conflict (id) do update set
    email      = excluded.email,
    updated_at = now();
  return new;
end;
$$;

-- ─── profiles: protect privileged columns from API callers ────────────────────
create or replace function public.profiles_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  -- Trusted contexts (SQL editor/migrations as postgres, Edge Functions as service_role,
  -- SECURITY DEFINER code) are not restricted. Only API roles are.
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if new.id is distinct from old.id or new.email is distinct from old.email
     or new.joined_at is distinct from old.joined_at then
    raise exception 'id, email and joined_at cannot be changed' using errcode = '42501';
  end if;

  if (new.role is distinct from old.role or new.admin_role is distinct from old.admin_role)
     and not public.is_coordinator() then
    raise exception 'only a coordinator can change roles' using errcode = '42501';
  end if;

  if new.cell_id is distinct from old.cell_id and not public.is_core_admin() then
    raise exception 'only an admin or coordinator can change cell membership' using errcode = '42501';
  end if;

  if new.status is distinct from old.status then
    if not public.is_staff_role() then
      raise exception 'only staff can approve or reject accounts' using errcode = '42501';
    end if;
    if old.id = auth.uid() then
      raise exception 'you cannot change your own approval status' using errcode = '42501';
    end if;
    if not public.is_core_admin() and old.role <> 'member' then
      raise exception 'cell leaders can only approve or reject members' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard before update on public.profiles
  for each row execute function public.profiles_guard();

-- ─── testimonies: moderation cannot be bypassed by the author ─────────────────
create or replace function public.testimonies_guard()
returns trigger language plpgsql set search_path = public as $$
declare moderator boolean;
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  moderator := public.has_admin_permission('testimonies.approve');

  if tg_op = 'INSERT' then
    if not moderator then
      new.status := case when new.visibility in ('draft', 'private') then 'approved' else 'pending' end;
      new.archived_at := null;
    end if;
    return new;
  end if;

  -- UPDATE
  if not moderator then
    if new.author_id is distinct from old.author_id then
      raise exception 'author cannot be changed' using errcode = '42501';
    end if;
    if new.status is distinct from old.status and new.status <> 'archived' then
      raise exception 'only a moderator can approve or reject testimonies' using errcode = '42501';
    end if;
    if new.status = old.status and new.visibility not in ('draft', 'private') and (
         old.visibility in ('draft', 'private')
         or (old.status in ('approved', 'rejected')
             and (new.title is distinct from old.title or new.body is distinct from old.body
                  or new.visibility is distinct from old.visibility or new.entry_type is distinct from old.entry_type))
       ) then
      new.status := 'pending';   -- shared or materially edited content goes back through moderation
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists testimonies_guard on public.testimonies;
create trigger testimonies_guard before insert or update on public.testimonies
  for each row execute function public.testimonies_guard();

-- ─── meeting_attendances: only staff may mark `attended` ──────────────────────
create or replace function public.attendance_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if public.is_staff_role() then
    return new;
  end if;
  if tg_op = 'INSERT' and new.attended is not null then
    raise exception 'only staff can mark attendance' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and (new.attended is distinct from old.attended
                           or new.user_id is distinct from old.user_id
                           or new.meeting_id is distinct from old.meeting_id) then
    raise exception 'only staff can mark attendance' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists attendance_guard on public.meeting_attendances;
create trigger attendance_guard before insert or update on public.meeting_attendances
  for each row execute function public.attendance_guard();

-- ─── RESET: drop every existing policy on application tables ─────────────────
do $$
declare
  t text;
  pol record;
  tables text[] := array[
    'profiles','user_profiles','cells','tags_settings','status_settings','contacts','contact_tags',
    'contact_follow_ups','contact_audit_log','admin_roles','admin_role_permissions','admin_role_assignments',
    'drive_link_metadata','email_preferences','email_log','scheduled_emails','email_notification_log',
    'push_subscriptions','push_notification_log','attendance_imports','attendance_member_matches',
    'meetings','meeting_attendances','zoom_settings','zoom_attendance','monthly_devotionals',
    'devotional_daily_pages','devotional_views','books_of_month','testimonies','testimony_reactions',
    'testimony_comments','events','event_rsvps','announcements','weekly_messages','habit_templates',
    'habit_entries','confessions','confession_declarations','prayer_requests'
  ];
begin
  foreach t in array tables loop
    if to_regclass('public.' || quote_ident(t)) is null then continue; end if;
    execute format('alter table public.%I enable row level security', t);
    for pol in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy %I on public.%I', pol.policyname, t);
    end loop;
  end loop;
end $$;

-- ─── profiles ────────────────────────────────────────────────────────────────
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_active_member());
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = auth.uid() and public.is_active_member())
  with check (id = auth.uid());
create policy profiles_update_staff on public.profiles for update to authenticated
  using (public.is_staff_role()) with check (public.is_staff_role());
create policy profiles_coordinator_all on public.profiles for all to authenticated
  using (public.is_coordinator()) with check (public.is_coordinator());

create policy user_profiles_select on public.user_profiles for select to authenticated
  using (user_id = auth.uid() or public.is_core_admin());
create policy user_profiles_insert on public.user_profiles for insert to authenticated
  with check (user_id = auth.uid());
create policy user_profiles_update on public.user_profiles for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy user_profiles_delete on public.user_profiles for delete to authenticated
  using (user_id = auth.uid());

-- ─── cells / settings ────────────────────────────────────────────────────────
create policy cells_read on public.cells for select to authenticated using (true);
create policy cells_manage on public.cells for all to authenticated
  using (public.is_core_admin()) with check (public.is_core_admin());

create policy tags_settings_read on public.tags_settings for select to authenticated using (true);
create policy tags_settings_manage on public.tags_settings for all to authenticated
  using (public.has_admin_permission('settings.manage_tags'))
  with check (public.has_admin_permission('settings.manage_tags'));
create policy status_settings_read on public.status_settings for select to authenticated using (true);
create policy status_settings_manage on public.status_settings for all to authenticated
  using (public.has_admin_permission('settings.manage_tags'))
  with check (public.has_admin_permission('settings.manage_tags'));

-- ─── contacts (sensitive: names, phones, notes) ──────────────────────────────
create policy contacts_read on public.contacts for select to authenticated using (
  public.has_admin_permission('contacts.view_all') or public.is_cell_leader_of(cell_id) or logged_by = auth.uid());
create policy contacts_insert on public.contacts for insert to authenticated with check (
  logged_by = auth.uid()
  and (public.has_admin_permission('contacts.write') or public.is_cell_leader_of(cell_id)));
create policy contacts_update on public.contacts for update to authenticated
  using (public.has_admin_permission('contacts.write') or public.is_cell_leader_of(cell_id) or logged_by = auth.uid())
  with check (public.has_admin_permission('contacts.write') or public.is_cell_leader_of(cell_id) or logged_by = auth.uid());
create policy contacts_delete on public.contacts for delete to authenticated
  using (public.has_admin_permission('contacts.write') or logged_by = auth.uid());

create policy contact_tags_read on public.contact_tags for select to authenticated using (
  public.has_admin_permission('contacts.view_all')
  or exists (select 1 from public.contacts c where c.id = contact_id));
create policy contact_tags_insert on public.contact_tags for insert to authenticated with check (
  tagged_by = auth.uid()
  and exists (select 1 from public.contacts c where c.id = contact_id));
create policy contact_tags_delete on public.contact_tags for delete to authenticated using (
  public.has_admin_permission('contacts.write')
  or exists (select 1 from public.contacts c where c.id = contact_id and (public.is_cell_leader_of(c.cell_id) or c.logged_by = auth.uid())));

create policy contact_follow_ups_read on public.contact_follow_ups for select to authenticated using (
  assigned_to = auth.uid() or public.has_admin_permission('contacts.view_all')
  or exists (select 1 from public.contacts c where c.id = contact_id));
create policy contact_follow_ups_insert on public.contact_follow_ups for insert to authenticated with check (
  assigned_by = auth.uid() and exists (select 1 from public.contacts c where c.id = contact_id));
create policy contact_follow_ups_update on public.contact_follow_ups for update to authenticated
  using (assigned_to = auth.uid() or public.has_admin_permission('contacts.write')
         or exists (select 1 from public.contacts c where c.id = contact_id and (public.is_cell_leader_of(c.cell_id) or c.logged_by = auth.uid())))
  with check (assigned_to = auth.uid() or public.has_admin_permission('contacts.write')
         or exists (select 1 from public.contacts c where c.id = contact_id and (public.is_cell_leader_of(c.cell_id) or c.logged_by = auth.uid())));

-- Audit log is append-only for API callers (no update/delete policy).
create policy contact_audit_log_read on public.contact_audit_log for select to authenticated
  using (public.is_core_admin());
create policy contact_audit_log_insert on public.contact_audit_log for insert to authenticated with check (
  changed_by = auth.uid()
  and (public.has_admin_permission('contacts.write')
       or exists (select 1 from public.contacts c where c.id = contact_id and (public.is_cell_leader_of(c.cell_id) or c.logged_by = auth.uid()))));

-- ─── role management ─────────────────────────────────────────────────────────
create policy admin_roles_read on public.admin_roles for select to authenticated using (public.is_core_admin());
create policy admin_roles_manage on public.admin_roles for all to authenticated
  using (public.is_coordinator()) with check (public.is_coordinator());
create policy admin_role_permissions_read on public.admin_role_permissions for select to authenticated using (public.is_core_admin());
create policy admin_role_permissions_manage on public.admin_role_permissions for all to authenticated
  using (public.is_coordinator()) with check (public.is_coordinator());
create policy admin_role_assignments_read on public.admin_role_assignments for select to authenticated
  using (public.is_core_admin() or user_id = auth.uid());
create policy admin_role_assignments_manage on public.admin_role_assignments for all to authenticated
  using (public.is_coordinator()) with check (public.is_coordinator());

-- ─── drive links / integrations ──────────────────────────────────────────────
create policy drive_links_read on public.drive_link_metadata for select to authenticated using (true);
create policy drive_links_manage on public.drive_link_metadata for all to authenticated
  using (owner_id = auth.uid() or public.is_core_admin())
  with check (owner_id = auth.uid() or public.is_core_admin());
create policy zoom_settings_admin on public.zoom_settings for all to authenticated
  using (public.has_admin_permission('integrations.manage'))
  with check (public.has_admin_permission('integrations.manage'));
create policy zoom_attendance_read on public.zoom_attendance for select to authenticated
  using (public.is_staff_role());
create policy attendance_imports_admin on public.attendance_imports for all to authenticated
  using (public.has_admin_permission('attendance.view_all')) with check (public.has_admin_permission('attendance.view_all'));
create policy attendance_matches_admin on public.attendance_member_matches for all to authenticated
  using (public.has_admin_permission('attendance.view_all')) with check (public.has_admin_permission('attendance.view_all'));

-- ─── email / push (writes to logs happen via service role in Edge Functions) ──
create policy email_prefs_own on public.email_preferences for all to authenticated
  using (member_id = auth.uid()) with check (member_id = auth.uid());
create policy email_prefs_admin_read on public.email_preferences for select to authenticated using (public.is_core_admin());
create policy email_log_own_read on public.email_log for select to authenticated using (member_id = auth.uid());
create policy email_log_admin_read on public.email_log for select to authenticated using (public.is_core_admin());
create policy email_log_admin_delete on public.email_log for delete to authenticated using (public.is_core_admin());
-- scheduled_emails: intentionally NO policies (service role only)
create policy email_notification_log_read on public.email_notification_log for select to authenticated
  using (public.is_core_admin() or user_id = auth.uid());

create policy push_subs_own on public.push_subscriptions for all to authenticated
  using (member_id = auth.uid()) with check (member_id = auth.uid());
create policy push_subs_admin_read on public.push_subscriptions for select to authenticated using (public.is_core_admin());
create policy push_log_own_read on public.push_notification_log for select to authenticated using (member_id = auth.uid());
create policy push_log_admin_read on public.push_notification_log for select to authenticated using (public.is_core_admin());

-- ─── meetings / attendance ───────────────────────────────────────────────────
create policy meetings_read on public.meetings for select to authenticated using (
  created_by = auth.uid()
  or public.is_core_admin()
  or visibility = 'public'
  or (visibility = 'leaders' and public.is_staff_role())
  or (visibility = 'cell' and exists (select 1 from public.profiles p where p.id = auth.uid() and p.cell_id = meetings.cell_id)));
create policy meetings_insert on public.meetings for insert to authenticated
  with check (created_by = auth.uid() and public.is_staff_role());
create policy meetings_update on public.meetings for update to authenticated
  using (public.is_staff_role() and (created_by = auth.uid() or public.is_core_admin()))
  with check (public.is_staff_role() and (created_by = auth.uid() or public.is_core_admin()));
create policy meetings_delete on public.meetings for delete to authenticated
  using (public.is_staff_role() and (created_by = auth.uid() or public.is_core_admin()));

create policy attendance_read on public.meeting_attendances for select to authenticated
  using (user_id = auth.uid() or public.is_staff_role());
create policy attendance_insert on public.meeting_attendances for insert to authenticated
  with check (user_id = auth.uid() and exists (select 1 from public.meetings m where m.id = meeting_id));
create policy attendance_update on public.meeting_attendances for update to authenticated
  using (user_id = auth.uid() or public.is_staff_role())
  with check (user_id = auth.uid() or public.is_staff_role());
create policy attendance_delete on public.meeting_attendances for delete to authenticated
  using (user_id = auth.uid() or public.is_staff_role());

-- ─── devotionals / books ─────────────────────────────────────────────────────
create policy monthly_devotionals_select on public.monthly_devotionals for select to authenticated using (true);
create policy monthly_devotionals_insert on public.monthly_devotionals for insert to authenticated
  with check (created_by = auth.uid() and public.is_devotional_admin());
create policy monthly_devotionals_update on public.monthly_devotionals for update to authenticated
  using (public.is_devotional_admin()) with check (public.is_devotional_admin());
create policy monthly_devotionals_delete on public.monthly_devotionals for delete to authenticated
  using (public.is_devotional_admin());

create policy devotional_daily_pages_select on public.devotional_daily_pages for select to authenticated using (true);
create policy devotional_daily_pages_write on public.devotional_daily_pages for all to authenticated
  using (public.is_devotional_admin()) with check (public.is_devotional_admin());

create policy devotional_views_select on public.devotional_views for select to authenticated
  using (member_id = auth.uid() or public.is_devotional_admin());
create policy devotional_views_insert on public.devotional_views for insert to authenticated with check (member_id = auth.uid());
create policy devotional_views_update on public.devotional_views for update to authenticated
  using (member_id = auth.uid()) with check (member_id = auth.uid());

create policy books_select on public.books_of_month for select to authenticated using (true);
create policy books_manage on public.books_of_month for all to authenticated
  using (public.is_core_admin()) with check (public.is_core_admin());

-- ─── testimonies ─────────────────────────────────────────────────────────────
create policy testimonies_select on public.testimonies for select to authenticated using (
  author_id = auth.uid()
  or public.has_admin_permission('testimonies.view_all')
  or public.has_admin_permission('testimonies.approve')
  or (status = 'approved' and (
        visibility in ('members', 'public')
        or (visibility = 'cell' and exists (select 1 from public.profiles p where p.id = auth.uid() and p.cell_id = testimonies.cell_id)))));
create policy testimonies_insert on public.testimonies for insert to authenticated with check (author_id = auth.uid());
create policy testimonies_update on public.testimonies for update to authenticated
  using (author_id = auth.uid() or public.has_admin_permission('testimonies.approve'))
  with check (author_id = auth.uid() or public.has_admin_permission('testimonies.approve'));
create policy testimonies_delete on public.testimonies for delete to authenticated
  using (author_id = auth.uid() or public.has_admin_permission('testimonies.approve'));

-- reactions/comments are only reachable for testimonies the caller can already see (testimonies RLS applies in the subquery)
create policy testimony_reactions_select on public.testimony_reactions for select to authenticated
  using (exists (select 1 from public.testimonies t where t.id = testimony_id));
create policy testimony_reactions_insert on public.testimony_reactions for insert to authenticated
  with check (user_id = auth.uid() and exists (select 1 from public.testimonies t where t.id = testimony_id));
create policy testimony_reactions_delete on public.testimony_reactions for delete to authenticated using (user_id = auth.uid());
create policy testimony_comments_select on public.testimony_comments for select to authenticated
  using (exists (select 1 from public.testimonies t where t.id = testimony_id));
create policy testimony_comments_insert on public.testimony_comments for insert to authenticated
  with check (author_id = auth.uid() and exists (select 1 from public.testimonies t where t.id = testimony_id));
create policy testimony_comments_delete on public.testimony_comments for delete to authenticated
  using (author_id = auth.uid() or public.has_admin_permission('testimonies.approve'));

-- ─── community content ───────────────────────────────────────────────────────
create policy events_read on public.events for select to authenticated using (true);
create policy events_manage on public.events for all to authenticated
  using (public.is_core_admin()) with check (public.is_core_admin());
create policy event_rsvps_own on public.event_rsvps for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy event_rsvps_admin_read on public.event_rsvps for select to authenticated using (public.is_core_admin());

create policy announcements_read on public.announcements for select to authenticated using (true);
create policy announcements_insert on public.announcements for insert to authenticated
  with check (author_id = auth.uid() and public.is_staff_role());
create policy announcements_update on public.announcements for update to authenticated
  using (public.is_staff_role() and (author_id = auth.uid() or public.is_core_admin()))
  with check (public.is_staff_role() and (author_id = auth.uid() or public.is_core_admin()));
create policy announcements_delete on public.announcements for delete to authenticated
  using (public.is_staff_role() and (author_id = auth.uid() or public.is_core_admin()));

create policy weekly_messages_read on public.weekly_messages for select to authenticated
  using (scope = 'org' or created_by = auth.uid());
create policy weekly_messages_insert on public.weekly_messages for insert to authenticated
  with check (created_by = auth.uid() and (scope = 'personal' or public.is_core_admin()));
create policy weekly_messages_update on public.weekly_messages for update to authenticated
  using (created_by = auth.uid() or public.is_core_admin())
  with check ((created_by = auth.uid() and (scope = 'personal' or public.is_core_admin())) or public.is_core_admin());
create policy weekly_messages_delete on public.weekly_messages for delete to authenticated
  using (created_by = auth.uid() or public.is_core_admin());

create policy habit_templates_read on public.habit_templates for select to authenticated using (true);
create policy habit_templates_manage on public.habit_templates for all to authenticated
  using (public.is_core_admin()) with check (public.is_core_admin());
create policy habit_entries_own on public.habit_entries for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy habit_entries_admin_read on public.habit_entries for select to authenticated using (public.is_core_admin());

create policy confessions_read on public.confessions for select to authenticated
  using (is_active = true or public.is_core_admin());
create policy confessions_manage on public.confessions for all to authenticated
  using (public.is_core_admin()) with check (public.is_core_admin());
create policy confession_declarations_own on public.confession_declarations for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy confession_declarations_admin_read on public.confession_declarations for select to authenticated using (public.is_core_admin());

create policy prayer_requests_read on public.prayer_requests for select to authenticated
  using (is_active = true or author_id = auth.uid() or public.is_core_admin());
create policy prayer_requests_insert on public.prayer_requests for insert to authenticated with check (author_id = auth.uid());
create policy prayer_requests_manage on public.prayer_requests for update to authenticated
  using (author_id = auth.uid() or public.is_core_admin()) with check (author_id = auth.uid() or public.is_core_admin());
create policy prayer_requests_delete on public.prayer_requests for delete to authenticated
  using (author_id = auth.uid() or public.is_core_admin());

-- ─── Gate: nothing is reachable unless the caller's account is ACTIVE ─────────
-- RESTRICTIVE policies are ANDed with every permissive policy above, for every command and role.
do $$
declare
  t text;
  gated text[] := array[
    'user_profiles','cells','tags_settings','status_settings','contacts','contact_tags',
    'contact_follow_ups','contact_audit_log','admin_roles','admin_role_permissions','admin_role_assignments',
    'drive_link_metadata','email_preferences','email_log','scheduled_emails','email_notification_log',
    'push_subscriptions','push_notification_log','attendance_imports','attendance_member_matches',
    'meetings','meeting_attendances','zoom_settings','zoom_attendance','monthly_devotionals',
    'devotional_daily_pages','devotional_views','books_of_month','testimonies','testimony_reactions',
    'testimony_comments','events','event_rsvps','announcements','weekly_messages','habit_templates',
    'habit_entries','confessions','confession_declarations','prayer_requests'
  ];
begin
  foreach t in array gated loop
    if to_regclass('public.' || quote_ident(t)) is null then continue; end if;
    execute format('drop policy if exists require_active_member on public.%I', t);
    execute format(
      'create policy require_active_member on public.%I as restrictive for all to public
         using (public.is_active_member()) with check (public.is_active_member())', t);
  end loop;
end $$;

-- ─── Storage policies for buckets owned by this app ──────────────────────────
drop policy if exists devotional_images_admin_write on storage.objects;
drop policy if exists devotional_images_admin_update on storage.objects;
drop policy if exists devotional_images_admin_delete on storage.objects;
create policy devotional_images_admin_write on storage.objects for insert to authenticated
  with check (bucket_id = 'devotional-images' and public.is_devotional_admin());
create policy devotional_images_admin_update on storage.objects for update to authenticated
  using (bucket_id = 'devotional-images' and public.is_devotional_admin())
  with check (bucket_id = 'devotional-images' and public.is_devotional_admin());
create policy devotional_images_admin_delete on storage.objects for delete to authenticated
  using (bucket_id = 'devotional-images' and public.is_devotional_admin());

drop policy if exists testimony_images_insert on storage.objects;
drop policy if exists testimony_images_update on storage.objects;
drop policy if exists testimony_images_delete on storage.objects;
create policy testimony_images_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'testimony-images' and public.is_active_member()
              and (storage.foldername(name))[1] = auth.uid()::text);
create policy testimony_images_update on storage.objects for update to authenticated
  using (bucket_id = 'testimony-images' and public.is_active_member() and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'testimony-images' and public.is_active_member() and (storage.foldername(name))[1] = auth.uid()::text);
create policy testimony_images_delete on storage.objects for delete to authenticated
  using (bucket_id = 'testimony-images' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists user_media_read on storage.objects;
drop policy if exists user_media_insert on storage.objects;
drop policy if exists user_media_update on storage.objects;
drop policy if exists user_media_delete on storage.objects;
create policy user_media_read on storage.objects for select using (bucket_id = 'user-media');
create policy user_media_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'user-media' and public.is_active_member() and name like 'avatars/' || auth.uid()::text || '.%');
create policy user_media_update on storage.objects for update to authenticated
  using (bucket_id = 'user-media' and name like 'avatars/' || auth.uid()::text || '.%')
  with check (bucket_id = 'user-media' and name like 'avatars/' || auth.uid()::text || '.%');
create policy user_media_delete on storage.objects for delete to authenticated
  using (bucket_id = 'user-media' and name like 'avatars/' || auth.uid()::text || '.%');

-- ─── Privileges: anon has no direct table access; authenticated is bounded by RLS ─
revoke all on all tables in schema public from anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;
