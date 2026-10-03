-- JSON export of policies for ops/classify-policies.mjs.   psql "$PROD_DB_URL" -X -At -f ops/export-policies.sql > prod-policies.json
select coalesce(json_agg(json_build_object('schema', schemaname, 'table', tablename, 'name', policyname, 'permissive', permissive,
  'roles', array_to_string(roles, ','), 'cmd', cmd, 'using', regexp_replace(coalesce(qual, ''), '\s+', ' ', 'g'),
  'check', regexp_replace(coalesce(with_check, ''), '\s+', ' ', 'g')) order by schemaname, tablename, policyname), '[]'::json)
from pg_policies where schemaname in ('public', 'storage');
