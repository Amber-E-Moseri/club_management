-- PRODUCTION READ-ONLY INSPECTION (Phases 2-9). Safe by construction: runs in a READ ONLY transaction,
-- prints no secrets, masks e-mail local parts (the "+tag" is kept so +testcoord style accounts are visible).
--   psql "$PROD_DB_URL" -X -A -F $'\t' -v ON_ERROR_STOP=0 -f ops/inspect-readonly.sql > prod-snapshot.txt
-- Use a connection string from the Supabase dashboard (Database -> Connection string). Do NOT paste it into chat.
\set QUIET on
-- Belt and braces: every transaction in this session is read-only, AND the whole script is one READ ONLY transaction.
set default_transaction_read_only = on;
\pset footer off
begin read only;
\echo '## 01 server'
select version();
select current_user, now() as captured_at;

\echo '## 02 migration history (supabase_migrations.schema_migrations)'
select case when to_regclass('supabase_migrations.schema_migrations') is null then 'NO HISTORY TABLE (schema was built by hand)' else 'present' end as history;
select to_regclass('supabase_migrations.schema_migrations') is not null as has_history \gset
\if :has_history
select version, name from supabase_migrations.schema_migrations order by version;
\endif

\echo '## 03 tables: RLS enabled? exact row counts'
select c.relname as "table", c.relrowsecurity as rls, c.relforcerowsecurity as rls_forced,
       (xpath('/row/c/text()', query_to_xml(format('select count(*) c from public.%I', c.relname), false, true, '')))[1]::text::bigint as rows
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' order by 1;

\echo '## 04 policies (public + storage.objects)'
select schemaname, tablename, policyname, permissive, array_to_string(roles, ',') as roles, cmd,
       regexp_replace(coalesce(qual, ''), '\s+', ' ', 'g') as using_expr,
       regexp_replace(coalesce(with_check, ''), '\s+', ' ', 'g') as check_expr
from pg_policies where schemaname in ('public', 'storage') order by schemaname, tablename, policyname;

\echo '## 05 public functions (definition fingerprint, not source)'
select p.proname, pg_get_function_identity_arguments(p.oid) as args, p.prosecdef as security_definer,
       coalesce(p.proconfig::text, '') as config, md5(p.prosrc) as src_md5
from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' order by 1;

\echo '## 06 triggers (public tables + auth.users)'
select c.relnamespace::regnamespace::text || '.' || c.relname as "table", t.tgname, p.proname as function
from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_proc p on p.oid = t.tgfoid
where not t.tgisinternal and (c.relnamespace::regnamespace::text = 'public' or (c.relnamespace::regnamespace::text = 'auth' and c.relname = 'users'))
order by 1, 2;

\echo '## 07 table privileges held by anon / authenticated (public schema)'
select grantee, count(distinct table_name) as tables, string_agg(distinct privilege_type, ',' order by privilege_type) as privileges
from information_schema.role_table_grants where table_schema = 'public' and grantee in ('anon', 'authenticated') group by grantee;

\echo '## 08 profiles: shape + defaults'
select column_name, data_type, is_nullable, column_default from information_schema.columns
where table_schema = 'public' and table_name = 'profiles' order by ordinal_position;
select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.profiles'::regclass and contype = 'c';
select role, status, count(*) from public.profiles group by 1, 2 order by 1, 2;

\echo '## 09 privileged accounts (coordinator / admin) - masked'
select p.id, regexp_replace(p.email, '^(.{2})[^+@]*(\+[^@]*)?@', '\1***\2@') as email, p.role, p.status, p.admin_role,
       u.created_at, u.last_sign_in_at, u.email_confirmed_at is not null as confirmed
from public.profiles p left join auth.users u on u.id = p.id
where p.role in ('coordinator', 'admin') order by p.role, u.created_at;

\echo '## 10 SUSPICIOUS ACCOUNTS (+test tags, synthetic names, metadata role attempts, test seeder time-window)'
select u.id, regexp_replace(u.email, '^(.{2})[^+@]*(\+[^@]*)?@', '\1***\2@') as email, p.role, p.status, u.created_at,
       u.last_sign_in_at, u.raw_user_meta_data ? 'role' as metadata_role_claimed,
       concat_ws('; ',
         case when u.email ~* '\+test' then 'email has +test tag' end,
         case when u.email ~* '(testcoord|testleader|testmember|test-?admin)' then 'seeder-style name' end,
         case when u.raw_user_meta_data ? 'role' then 'signup metadata contained role=' || (u.raw_user_meta_data->>'role') end,
         case when p.role in ('coordinator','admin','cell_leader') and coalesce(p.full_name,'') ~* '^test' then 'privileged + Test* name' end) as reason
from auth.users u left join public.profiles p on p.id = u.id
where u.email ~* '\+test' or u.email ~* '(testcoord|testleader|testmember|test-?admin)'
   or u.raw_user_meta_data ? 'role' or (p.role in ('coordinator','admin','cell_leader') and coalesce(p.full_name,'') ~* '^test')
order by u.created_at;

\echo '## 11 fine-grained admin role assignments'
select r.name, rp.permission_key, count(distinct a.user_id) as assigned_users
from public.admin_roles r left join public.admin_role_permissions rp on rp.role_id = r.id left join public.admin_role_assignments a on a.role_id = r.id
group by 1, 2 order by 1, 2;

\echo '## 12 storage buckets'
select id, public from storage.buckets order by id;

\echo '## 13 scheduler discovery: pg_cron jobs (command shown only as flags, never the text)'
select to_regclass('cron.job') is not null as has_cron \gset
\if :has_cron
select jobname, schedule, (command ~* 'functions/v1') as targets_edge_function, (command ~* 'x-cron-secret') as sends_cron_header, active from cron.job order by jobid;
\else
select 'pg_cron not installed / not visible' as scheduler;
\endif

\echo '## 14 vault secret NAMES only'
select to_regclass('vault.secrets') is not null as has_vault \gset
\if :has_vault
select name as secret_name from vault.secrets order by 1;
\else
select 'vault not visible' as vault;
\endif

\echo '## 15 email activity (abuse check; recipient domains only)'
select date_trunc('day', created_at)::date as day, template_type, status, count(*) as emails, count(distinct recipient_email) as distinct_recipients,
       count(*) filter (where member_id is null) as no_member_id
from public.email_log where created_at > now() - interval '120 days' group by 1, 2, 3 order by 1 desc, 2 limit 120;
select split_part(recipient_email, '@', 2) as domain, count(*) as emails from public.email_log group by 1 order by 2 desc limit 15;
select count(*) as pending_scheduled from public.scheduled_emails where sent = false;
select count(*) as email_preference_rows from public.email_preferences;

\echo '## 16 extensions'
select extname, extversion from pg_extension order by 1;
rollback;
