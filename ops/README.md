# ops/ — production deployment tooling (NOT part of the deployed application)

Nothing here is bundled, deployed or run by CI. These are the tools used to inspect production, rehearse and verify the upgrade.

| Tool | Purpose | Touches production? |
|---|---|---|
| `inspect-readonly.sql` | One-shot **read-only** snapshot: migration history, RLS, policies, functions, triggers, grants, privileged + suspicious accounts (masked), scheduler, vault secret *names*, email abuse summary | read-only transaction |
| `export-state.sql` | JSON of policies/functions/grants/defaults = input for the classifier and the rollback generator | read-only |
| `classify-policies.mjs` | Classifies each production policy vs migration 010: EXPECTED / STALE / PRODUCTION-ONLY / UNKNOWN. **Exit 2 = stop, a human must review** | offline |
| `gen-rollback.mjs` | Generates `rollback-010.sql` (policies, functions, grants, defaults) from the pre-deploy export | offline |
| `post-deploy-smoke.mjs` | Post-deploy security smoke (anon / pending / member / coordinator / function auth). Creates no data | read + refused writes |
| `rehearsal/` | Builds a production-like pre-fix database with data and proves the upgrade (`build-legacy.sh`, `continuity.test.mjs`, `fingerprint.sql`) | local only |

## Run the read-only preflight (≈2 minutes)

```bash
# Dashboard → Project Settings → Database → Connection string. Prefer a READ-ONLY role. Keep it out of chat/logs.
export PROD_DB_URL='postgresql://...'
psql "$PROD_DB_URL" -X -A -F $'\t' -f ops/inspect-readonly.sql        > prod-snapshot.txt
psql "$PROD_DB_URL" -X -At        -f ops/export-state.sql              > prod-state.json     # also the rollback source — keep safely
psql "$PROD_DB_URL" -X -At        -f ops/rehearsal/fingerprint.sql     > prod-fingerprint-before.txt
node ops/classify-policies.mjs prod-state.json                         # exit 2 => STOP
node ops/gen-rollback.mjs prod-state.json > rollback-010.sql           # review it, do not run it yet
```
`prod-snapshot.txt` contains masked emails only (no secrets, no tokens). Share it, `prod-state.json` classification output and nothing else.
Also run (Supabase CLI, logged in): `supabase functions list`, `supabase secrets list` (names + digests only), and the Auth config
`curl -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" https://api.supabase.com/v1/projects/<ref>/config/auth` (redact keys before sharing).

## Windows / Git Bash notes
* Use **Git Bash** (not cmd/PowerShell) for the commands above; `$'\t'` and `>` redirection behave as shown. Node >= 18, PostgreSQL client tools (`psql`, `pg_dump`) >= 14.
* `.gitattributes` keeps these files LF; psql reads CRLF too (tested), but keep LF anyway.
* **Server-enforced read-only (recommended):** before running any `psql`, `export PGOPTIONS='-c default_transaction_read_only=on'` — the *server* then refuses every write in that session, independent of script content
  (tested: `ops/rehearsal/readonly-proof.sh`). Works on direct connections (port 5432) and the session pooler; the *transaction* pooler (port 6543) rejects startup options — use direct/session mode.
* Every SQL script here is additionally self-protecting (`set default_transaction_read_only = on`; `inspect-readonly.sql` is one `BEGIN READ ONLY … ROLLBACK`).
* Secrets: never type the connection string on the command line (shell history). Use `read -rs PROD_DB_URL; export PROD_DB_URL` (input is hidden and not recorded), and `unset PROD_DB_URL` afterwards.
