-- Structural + authorization-coverage assertions for a freshly replayed database.
-- Run:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/database/schema_integrity.sql
-- Any failed assertion aborts with a descriptive message (non-zero exit).
\set ON_ERROR_STOP on
begin;

-- 1. every expected application table exists and has RLS enabled ------------------------------
do $$
declare t text; missing text[] := '{}';
  expected text[] := array[
    'profiles','user_profiles','cells','tags_settings','status_settings','contacts','contact_tags',
    'contact_follow_ups','contact_audit_log','admin_roles','admin_role_permissions','admin_role_assignments',
    'drive_link_metadata','email_preferences','email_log','scheduled_emails','email_notification_log',
    'push_subscriptions','push_notification_log','attendance_imports','attendance_member_matches',
    'meetings','meeting_attendances','zoom_settings','zoom_attendance','monthly_devotionals',
    'devotional_daily_pages','devotional_views','books_of_month','testimonies','testimony_reactions',
    'testimony_comments','events','event_rsvps','announcements','weekly_messages','habit_templates',
    'habit_entries','confessions','confession_declarations','prayer_requests'];
begin
  foreach t in array expected loop
    if to_regclass('public.' || t) is null then missing := missing || t; end if;
  end loop;
  assert cardinality(missing) = 0, 'missing tables: ' || array_to_string(missing, ', ');
end $$;

-- every table the frontend queries must exist (guards against code/schema drift)
do $$
declare t text;
begin
  foreach t in array array['profiles','contacts','testimonies','meetings','push_subscriptions','devotional_views',
    'weekly_messages','habit_templates','testimony_reactions','meeting_attendances','habit_entries','confessions',
    'books_of_month','announcements','testimony_comments','email_log','contact_tags','contact_follow_ups','admin_roles',
    'admin_role_assignments','zoom_settings','zoom_attendance','scheduled_emails','prayer_requests','monthly_devotionals',
    'events','devotional_daily_pages','confession_declarations','user_profiles','push_notification_log','event_rsvps',
    'email_preferences','contact_audit_log','admin_role_permissions','tags_settings','status_settings','drive_link_metadata','cells']
  loop assert to_regclass('public.' || t) is not null, 'frontend table missing: ' || t; end loop;
end $$;

do $$
declare r record; bad text[] := '{}';
begin
  for r in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity loop
    bad := bad || r.relname::text;
  end loop;
  assert cardinality(bad) = 0, 'RLS disabled on: ' || array_to_string(bad, ', ');
end $$;

-- 2. every table except profiles carries the restrictive active-member gate --------------------
do $$
declare r record; bad text[] := '{}';
begin
  for r in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'r' and c.relname <> 'profiles'
             and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname
                             and p.policyname = 'require_active_member' and p.permissive = 'RESTRICTIVE') loop
    bad := bad || r.relname::text;
  end loop;
  assert cardinality(bad) = 0, 'missing require_active_member gate on: ' || array_to_string(bad, ', ');
end $$;

-- 3. no policy lets the anon role (or PUBLIC) through, other than the restrictive gate ----------
do $$
declare r record; bad text[] := '{}';
begin
  for r in select tablename, policyname, roles from pg_policies
           where schemaname = 'public' and permissive = 'PERMISSIVE'
             and (roles && array['anon','public']::name[]) loop
    bad := bad || (r.tablename || '.' || r.policyname);
  end loop;
  assert cardinality(bad) = 0, 'permissive policy reachable by anon/public: ' || array_to_string(bad, ', ');
end $$;

-- 4. anon has no table privileges; service_role keeps full access -------------------------------
do $$
declare r record; bad text[] := '{}';
begin
  for r in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'r' loop
    if has_table_privilege('anon', format('public.%I', r.relname), 'select,insert,update,delete') then bad := bad || r.relname::text; end if;
    assert has_table_privilege('service_role', format('public.%I', r.relname), 'select,insert,update,delete'),
      'service_role lost access to ' || r.relname;
  end loop;
  assert cardinality(bad) = 0, 'anon still has privileges on: ' || array_to_string(bad, ', ');
end $$;

-- 5. functions and triggers -----------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array['is_active_member','is_core_admin','is_coordinator','is_staff_role','has_admin_permission',
    'is_cell_leader_of','is_devotional_admin','handle_new_user','profiles_guard','testimonies_guard','attendance_guard','set_updated_at']
  loop assert exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = f),
    'function missing: ' || f; end loop;
  -- SECURITY DEFINER helpers must pin search_path
  assert not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef and not coalesce(p.proconfig::text, '') ilike '%search_path%'),
    'a SECURITY DEFINER function in public has no pinned search_path';
end $$;

do $$
declare pair text[];
begin
  foreach pair slice 1 in array array[
    array['profiles','profiles_guard'], array['profiles','profiles_updated_at'],
    array['testimonies','testimonies_guard'], array['meeting_attendances','attendance_guard'],
    array['cells','cells_updated_at'], array['contacts','contacts_updated_at'],
    array['monthly_devotionals','monthly_devotionals_updated_at'], array['weekly_messages','set_weekly_messages_updated_at']]
  loop assert exists (select 1 from pg_trigger t where t.tgrelid = ('public.' || pair[1])::regclass and t.tgname = pair[2] and not t.tgisinternal),
    'trigger missing: ' || pair[1] || '.' || pair[2]; end loop;
  assert exists (select 1 from pg_trigger where tgrelid = 'auth.users'::regclass and tgname = 'on_auth_user_created'),
    'auth.users trigger on_auth_user_created missing';
end $$;

-- 6. foreign keys, unique constraints, indexes --------------------------------------------------
do $$
declare spec text[];
begin
  -- [table, referenced table]
  foreach spec slice 1 in array array[
    array['contacts','cells'], array['contacts','profiles'], array['contact_tags','contacts'],
    array['contact_follow_ups','contacts'], array['meeting_attendances','meetings'], array['meeting_attendances','profiles'],
    array['testimony_comments','testimonies'], array['testimony_reactions','testimonies'], array['habit_entries','habit_templates'],
    array['event_rsvps','events'], array['email_preferences','profiles'], array['email_log','profiles'],
    array['admin_role_assignments','admin_roles'], array['admin_role_permissions','admin_roles'],
    array['devotional_daily_pages','monthly_devotionals'], array['confession_declarations','confessions'],
    array['zoom_attendance','meetings'], array['profiles','users']]
  loop
    assert exists (select 1 from pg_constraint c where c.contype = 'f' and c.conrelid = ('public.' || spec[1])::regclass
                   and c.confrelid::regclass::text in ('public.' || spec[2], spec[2], 'auth.' || spec[2])),
      'foreign key missing: ' || spec[1] || ' -> ' || spec[2];
  end loop;

  -- unique constraints / unique indexes that application upserts depend on
  foreach spec slice 1 in array array[
    array['email_preferences','member_id'], array['meeting_attendances','meeting_id, user_id'],
    array['push_subscriptions','endpoint'], array['habit_entries','template_id, user_id, entry_date'],
    array['confession_declarations','confession_id, user_id'], array['admin_role_assignments','role_id, user_id'],
    array['devotional_views','member_id, devotional_id, day_of_month, viewed_date'],
    array['testimony_reactions','testimony_id, user_id, reaction_type']]
  loop
    assert exists (
      select 1 from pg_index i
      where i.indrelid = ('public.' || spec[1])::regclass and i.indisunique
        and (select string_agg(a.attname, ', ' order by k.ord)
             from unnest(i.indkey) with ordinality k(attnum, ord) join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum) = spec[2]),
      'unique constraint missing: ' || spec[1] || '(' || spec[2] || ')';
  end loop;

  foreach spec slice 1 in array array[
    array['contacts_cell_idx'], array['contacts_logged_by_idx'], array['idx_email_log_member'], array['idx_email_log_status'],
    array['idx_scheduled_emails_pending'], array['idx_email_prefs_member'], array['idx_habit_entries_user_date'],
    array['idx_weekly_messages_week'], array['admin_role_assignments_user_idx']]
  loop assert to_regclass('public.' || spec[1]) is not null, 'index missing: ' || spec[1]; end loop;
end $$;

-- 7. schema pieces the approval workflow depends on ---------------------------------------------
do $$
begin
  assert (select column_default from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='status') like '%pending%',
    'profiles.status must default to pending (fail closed)';
  assert exists (select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='student_number');
  assert exists (select 1 from information_schema.columns where table_schema='public' and table_name='meetings' and column_name='allow_join_requests');
  assert (select pg_get_constraintdef(oid) from pg_constraint where conrelid='public.email_log'::regclass and conname='email_log_status_check') like '%suppressed%',
    'email_log.status must allow suppressed';
end $$;

-- 8. seed/bootstrap data present (when `supabase db reset` ran seed.sql) -----------------------
do $$
begin
  if current_setting('app.expect_seed', true) = 'on' then
    assert (select count(*) from public.tags_settings) >= 5, 'seed: tags_settings';
    assert (select count(*) from public.status_settings) >= 5, 'seed: status_settings';
    assert (select count(*) from public.cells) >= 1, 'seed: cells';
  end if;
end $$;

-- 9. storage policies: owner-scoped writes, role-context test (real roles, real claims) ----------
do $$
declare me uuid := gen_random_uuid(); other uuid := gen_random_uuid(); pend uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (me, me || '@t.invalid', '{"full_name":"Me","role":"coordinator"}'),
    (pend, pend || '@t.invalid', '{"full_name":"Pend"}');
  assert (select role || '/' || status from public.profiles where id = me) = 'member/pending',
    'trigger must ignore metadata role and start accounts pending';
  update public.profiles set status = 'active' where id = me;

  perform set_config('request.jwt.claims', json_build_object('sub', me, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- own folder OK
  insert into storage.objects (bucket_id, name, owner) values ('testimony-images', me || '/ok.png', me);
  -- someone else's folder rejected
  begin
    insert into storage.objects (bucket_id, name, owner) values ('testimony-images', other || '/bad.png', me);
    raise exception 'insert into another user''s folder was allowed';
  exception when insufficient_privilege then null;
  end;
  -- avatar path must be the caller's own
  insert into storage.objects (bucket_id, name, owner) values ('user-media', 'avatars/' || me || '.png', me);
  begin
    insert into storage.objects (bucket_id, name, owner) values ('user-media', 'avatars/' || other || '.png', me);
    raise exception 'overwriting another user''s avatar was allowed';
  exception when insufficient_privilege then null;
  end;
  -- a plain member may not upload devotional images
  begin
    insert into storage.objects (bucket_id, name, owner) values ('devotional-images', 'x/y.jpg', me);
    raise exception 'member uploaded a devotional image';
  exception when insufficient_privilege then null;
  end;
  reset role;

  -- pending account may not upload at all
  perform set_config('request.jwt.claims', json_build_object('sub', pend, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into storage.objects (bucket_id, name, owner) values ('testimony-images', pend || '/x.png', pend);
    raise exception 'pending account uploaded a file';
  exception when insufficient_privilege then null;
  end;
  reset role;
end $$;

rollback;
\echo 'schema_integrity: ALL ASSERTIONS PASSED'
