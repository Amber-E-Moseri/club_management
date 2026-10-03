# Production Pre-Deploy Security Snapshot

## Status: **NOT CAPTURED — production was not reachable**

This review ran in a sandbox whose egress policy denies `*.supabase.co` (connection rejected by the organisation policy), and no
Supabase access token, database URL, service key or Vercel token exists in the environment. **Nothing in this document describes
real production state.** Every "production" claim below is explicitly marked UNVERIFIED.

What *is* ready is the capture tooling, tested end to end on a production-like rehearsal database (see
`production-deployment-certification.md` §5):

```bash
psql "$PROD_DB_URL" -X -A -F $'\t' -f ops/inspect-readonly.sql > prod-snapshot.txt   # 16 sections, read-only transaction, masked emails
psql "$PROD_DB_URL" -X -At        -f ops/export-state.sql      > prod-state.json     # policies, function bodies, grants, defaults
node ops/classify-policies.mjs prod-state.json                                        # exit 2 = STOP
```

## What the snapshot must answer (checklist, all UNVERIFIED until run)

| Item | Where in `prod-snapshot.txt` | Gate |
|---|---|---|
| Migration history table present? which versions? | §02 | If absent (expected: hand-built), plan uses `migration repair`; **never plain `db push`** (see risk R-1) |
| Tables / RLS enabled / row counts | §03 | every table in 010's list exists; any extra table is flagged UNKNOWN (010 does not manage it) |
| Policies | §04, `classify-policies.mjs` | **0 PRODUCTION-ONLY and 0 UNKNOWN** else STOP |
| Functions + fingerprints | §05 | `handle_new_user` variant tells which sign-up trigger production runs (decides whether self-registration-as-coordinator was live) |
| Triggers on `auth.users` | §06 | `on_auth_user_created` present |
| Table privileges for anon/authenticated | §07 | baseline for rollback |
| `profiles.status` exists + defaults + role/status distribution | §08 | prerequisite for the new functions |
| Privileged accounts | §09 | **≥ 1 (prefer ≥ 2) legitimate active coordinator/admin** else STOP |
| Suspicious accounts | §10 | see Phase 4 below |
| Scheduler (pg_cron) / Vault secret names | §13–14 | is there anything calling `process-scheduled-emails`? |
| Email abuse window | §15 | unexpected sends with `member_id IS NULL`, odd recipient domains, bursts |

## Classification rules (implemented in `ops/classify-policies.mjs`)

| Class | Meaning | Action |
|---|---|---|
| EXPECTED | identical to the canonical post-010 policy, or a canonical policy 010 will create | none |
| STALE POLICY | repo-known name **and** definition identical to the repo's legacy SQL; 010 drops and replaces it | none (rollback script restores it) |
| PRODUCTION-ONLY POLICY | name defined nowhere in the repo; 010 would silently **destroy** it | **STOP** — decide per policy: port into a migration or accept loss |
| UNKNOWN | repo-known name but hand-edited definition, or a table 010 does not manage | **STOP** — review |

Tested: against the rehearsal's pre-fix state → 103 STALE, 2 EXPECTED, 0 blocking, exit 0; after the upgrade → 153/153 EXPECTED;
with an injected treasurer-only policy and a hand-edited `events_read` → both detected, exit 2.
Note: `pg_policies` prints `auth.uid()` or `uid()` depending on the connecting role's `search_path`; the classifier normalises this
(a first version did not and produced false alarms when run as `postgres`).

## Phase 4 — suspicious accounts (UNVERIFIED in production)

Search is built into §10 of the snapshot: `+test` tags, `testcoord|testleader|testmember|test-admin`, signup metadata containing
`role`, privileged accounts named `Test*`. Output columns: id, masked email (the `+tag` is preserved), role, status, created_at,
last_sign_in_at, reason. **Nothing is deleted or modified by the inspection.** The original seeder used
`blwcan.elvanto+testcoord|testleader|testmember@gmail.com` / password `Test1234!`; the rehearsal seeds the equivalent (`owner+test…`) and the
query flags all three. Treat any hit that is privileged *and* has a recent `last_sign_in_at` as a security incident.
Remediation order (needs your approval): ban + demote → review what they created (`contacts.logged_by`, audit log) → delete only when no
`ON DELETE RESTRICT` data depends on them (contacts, audit log reference `profiles` with RESTRICT).
