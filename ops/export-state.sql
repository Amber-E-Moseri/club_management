-- Pre-deploy state export (read-only) = input for classify-policies.mjs AND gen-rollback.mjs.
--   psql "$PROD_DB_URL" -X -At -f ops/export-state.sql > prod-state.json      (keep it private; no secrets inside, but it is your rollback source)
select json_build_object(
  'policies', (select coalesce(json_agg(json_build_object('schema', schemaname, 'table', tablename, 'name', policyname, 'permissive', permissive,
      'roles', array_to_string(roles, ','), 'cmd', cmd, 'using', regexp_replace(coalesce(qual, ''), '\s+', ' ', 'g'),
      'check', regexp_replace(coalesce(with_check, ''), '\s+', ' ', 'g')) order by schemaname, tablename, policyname), '[]'::json)
    from pg_policies where schemaname in ('public', 'storage')),
  'functions', (select coalesce(json_agg(json_build_object('name', p.proname, 'def', pg_get_functiondef(p.oid))), '[]'::json)
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('is_core_admin','is_cell_leader_of','is_devotional_admin','handle_new_user','set_updated_at')),
  'grants', (select coalesce(json_agg(json_build_object('table', table_name, 'grantee', grantee, 'privilege', privilege_type)), '[]'::json)
    from information_schema.role_table_grants where table_schema = 'public' and grantee in ('anon', 'authenticated')),
  'profiles_status_default', (select column_default from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='status'),
  'rls_tables', (select coalesce(json_agg(relname), '[]'::json) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and relkind='r' and relrowsecurity)
);
