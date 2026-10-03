#!/bin/bash
# Rebuild a PRODUCTION-LIKE (pre-fix, hand-built) database with data and real GoTrue logins.
set -e
cd /tmp/claude-0/base
/tmp/claude-0/h/up.sh >/dev/null; /tmp/claude-0/h/rest.sh >/dev/null
export PGPASSWORD=postgres; P="psql -h localhost -p 54399 -U postgres -d postgres -q"
for f in supabase/migrations/*.sql src/db/migration_phase1b_safe.sql src/db/migration_signup_approval.sql; do $P -f $f >/dev/null 2>&1 || true; done
python3 - <<'PY' > /tmp/claude-0/h/conf.sql
s=open('/tmp/claude-0/base/src/db/schema.sql').read()
print('create extension if not exists "uuid-ossp";'+s[s.index('-- ─── Confessions'):s.index('-- ─── Testimonies')])
PY
$P -f /tmp/claude-0/h/conf.sql >/dev/null 2>&1 || true
. /tmp/claude-0/h/keys.env
for who in coord admin leader1 leader2 member1 member2 member3 member4 pending; do
  curl -s -X POST localhost:9999/signup -H "apikey: $ANON" -H 'content-type: application/json' \
    -d "{\"email\":\"legacy.$who@test.invalid\",\"password\":\"Legacy-Pass-123!\",\"data\":{\"full_name\":\"Legacy $who\"}}" >/dev/null
done
$P -c "update profiles set status='active'; update profiles set role='coordinator' where email like 'legacy.coord@%'; update profiles set role='admin' where email like 'legacy.admin@%'; update profiles set role='cell_leader' where email like 'legacy.leader%'; update profiles set status='pending' where email like 'legacy.pending@%';"
$P -f ops/rehearsal/legacy-data.sql
for w in testcoord testleader testmember; do curl -s -X POST localhost:9999/signup -H "apikey: $ANON" -H 'content-type: application/json' -d "{\"email\":\"owner+$w@test.invalid\",\"password\":\"Test1234!\",\"data\":{\"full_name\":\"Test $w\"}}" >/dev/null; done
$P -c "update profiles set status='active', role='coordinator' where email like 'owner+testcoord@%'; update profiles set status='active', role='cell_leader' where email like 'owner+testleader@%'; update profiles set status='active' where email like 'owner+testmember@%'"
docker restart sbrest >/dev/null; sleep 3
echo "legacy DB ready"
