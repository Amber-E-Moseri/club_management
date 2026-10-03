#!/usr/bin/env bash
# Runs every database/security test against a freshly reset Supabase stack.
#   Local:  supabase start && supabase db reset && eval "$(supabase status -o env | sed 's/^/export /')" && scripts/run-db-tests.sh
# Required env: API_URL, ANON_KEY, SERVICE_ROLE_KEY, DB_URL   (as printed by `supabase status -o env`)
set -euo pipefail
: "${API_URL:?}" "${ANON_KEY:?}" "${SERVICE_ROLE_KEY:?}" "${DB_URL:?}"

export SUPABASE_URL="$API_URL" SUPABASE_ANON_KEY="$ANON_KEY" SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" REQUIRE_INTEGRATION=1

echo "== 1/3 schema integrity + RLS coverage (SQL)"
PGOPTIONS='-c app.expect_seed=on' psql "$DB_URL" -v ON_ERROR_STOP=1 -v VERBOSITY=terse -f supabase/tests/database/schema_integrity.sql

echo "== 2/3 authorization tests through the real API (GoTrue + PostgREST)"
node --test tests/security/*.test.mjs

echo "== 3/3 email workflow against the real database (Edge Function handlers)"
deno test --allow-net --allow-env --allow-read supabase/functions/_tests/integration_test.ts
