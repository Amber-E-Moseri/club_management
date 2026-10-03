#!/usr/bin/env bash
# Proves the three production-inspection SQL scripts cannot mutate a database, even when run by a superuser.
#   DB_URL=postgresql://... bash ops/rehearsal/readonly-proof.sh      (use a THROWAWAY database, never production)
set -uo pipefail
: "${DB_URL:?}"
cd "$(dirname "$0")/../.."
psql "$DB_URL" -X -At -c "select 1" >/dev/null 2>&1 || { echo "ABORT: cannot connect to DB_URL (no tests were run)"; exit 2; }
T=$(mktemp -d); fail=0
ok()  { echo "PASS  $1"; }
bad() { echo "FAIL  $1"; fail=1; }
PS="psql $DB_URL -X -v ON_ERROR_STOP=0"
state() { $PS -At -f ops/rehearsal/fingerprint.sql | grep -v '^rows:zz_' | md5sum; $PS -At -f ops/export-state.sql | md5sum; }

BEFORE=$(state)
$PS -A -F $'\t' -f ops/inspect-readonly.sql > "$T/snap.txt" 2> "$T/snap.err";  [ ! -s "$T/snap.err" ] && ok "inspect-readonly.sql runs with no errors" || { bad "inspect-readonly.sql errors: $(head -2 "$T/snap.err")"; }
$PS -At -f ops/export-state.sql > "$T/state.json" 2>"$T/state.err"
python3 -c "import json,sys; json.load(open('$T/state.json'))" 2>/dev/null && ok "export-state.sql output is pure JSON (no BEGIN/ROLLBACK noise)" || bad "export-state.sql output is not clean JSON"
$PS -At -f ops/rehearsal/fingerprint.sql > "$T/fp.txt" 2>"$T/fp.err"; ! grep -qE '^(SET|BEGIN|ROLLBACK)' "$T/fp.txt" && ok "fingerprint.sql output has no command-tag noise" || bad "fingerprint noise"
[ "$BEFORE" = "$(state)" ] && ok "data + catalog fingerprint identical after running all three" || bad "STATE CHANGED"
grep -qiE "password|secret|token|apikey|api_key" "$T/snap.txt" "$T/state.json" && echo "NOTE  words like 'secret' appear (names only) - review" || ok "no password/secret/token strings in outputs"

# Injected writes must be REFUSED
inject() { # file marker-line-regex statement
  python3 - "$1" "$2" "$3" "$T/mut.sql" <<'PY'
import sys,re
src,marker,stmt,out=sys.argv[1:5]
s=open(src).read()
if marker=="EOF": s=s.rstrip("\n")+"\n"+stmt+"\n"
else: s=s.replace(marker, stmt+"\n"+marker,1) if marker in s else s+"\n"+stmt+"\n"
open(out,"w").write(s)
PY
}
for spec in "ops/inspect-readonly.sql|rollback;" "ops/export-state.sql|rollback;" "ops/rehearsal/fingerprint.sql|EOF"; do
  f=${spec%%|*}; m=${spec##*|}
  for stmt in "create table zz_should_not_exist(a int);" "update public.profiles set role='coordinator';" "delete from public.email_log;"; do
    inject "$f" "$m" "$stmt"; $PS -At -f "$T/mut.sql" >/dev/null 2>"$T/mut.err"
    grep -q "read-only transaction" "$T/mut.err" && ok "$f blocks: ${stmt%%(*}" || bad "$f did NOT block: $stmt  ($(head -1 "$T/mut.err"))"
  done
done
[ "$($PS -At -c "select to_regclass('public.zz_should_not_exist') is null")" = "t" ] && ok "no injected table exists" || bad "injected table EXISTS"
[ "$BEFORE" = "$(state)" ] && ok "state still identical after injection attempts" || bad "STATE CHANGED by injection"

# Server-enforced guard (recommended for production): PGOPTIONS makes the whole session read-only regardless of script content
PGOPTIONS='-c default_transaction_read_only=on' psql "$DB_URL" -X -At -c "create table zz_pgoptions(a int)" >/dev/null 2>"$T/o.err"
grep -q "read-only transaction" "$T/o.err" && ok "PGOPTIONS=default_transaction_read_only blocks writes server-side" || bad "PGOPTIONS guard did not block"

# Windows CRLF check (what a Git checkout with autocrlf=true would produce)
for f in ops/inspect-readonly.sql ops/export-state.sql ops/rehearsal/fingerprint.sql; do
  sed 's/$/\r/' "$f" > "$T/crlf.sql"; $PS -A -F $'\t' -f "$T/crlf.sql" > "$T/crlf.out" 2>"$T/crlf.err"
  [ ! -s "$T/crlf.err" ] && echo "INFO  $f works with CRLF" || echo "INFO  $f BREAKS with CRLF (.gitattributes forces LF): $(head -1 "$T/crlf.err" | cut -c1-90)"
done
echo; [ $fail = 0 ] && echo "READ-ONLY PROOF: ALL PASSED" || { echo "READ-ONLY PROOF: FAILED"; exit 1; }
