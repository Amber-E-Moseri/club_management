# Production Deployment Certification

**Status: PHASES 0–10 DONE (as far as possible without production access) · PHASE 11 PLAN PRESENTED · NO PRODUCTION MUTATION PERFORMED**
Nothing has been changed in production. Phases 12–17 have not been executed and are not claimed.

## 1. Release candidate (Phase 0)

| Item | Value |
|---|---|
| Branch | `claude/trusting-rubin-o4dgub` |
| `origin/main` | `86c2a91d4f91e6d13d5656cb6eb7d085c93da1b4` (unchanged; not yet merged) |
| Previously certified candidate | `65c3895296e27a17f6269672b1fca2b61e467e6b` |
| Commits after it | `8826ebb` docs: certification · `9b29efd` docs: link baseline · `a0e4691` docs: record green CI |
| `git diff --name-only 65c3895..a0e4691` | `docs/production-certification.md`, `docs/production-readiness-baseline.md` — **docs only** |
| `git diff 65c3895 a0e4691 -- . ':!docs'` | **0 lines** (identical executable/config tree) |
| Paths checked for change (src, supabase, tests, e2e, package*.json, .github, playwright/vite config, scripts, vercel.json, .env*) | **none changed** |
| **Deployment candidate** | **`a0e4691ce841666d21803493a51064dbbaba283f`** — its non-doc tree is byte-identical to the certified `65c3895` |

Later commits on this branch add only `docs/` and `ops/` (tooling that is not bundled, deployed, or run by CI). Verify at any time:
`git diff a0e4691 HEAD --stat -- . ':!docs' ':!ops'` must be empty. **Deploy from `a0e4691`'s tree** (merge, or cherry-pick nothing else).

## 2. CI on the exact SHA (Phase 1)

[Run 37135749909](https://github.com/Amber-E-Moseri/club_management/actions/runs/37135749909) — `workflow_dispatch`, head SHA `a0e4691`, **completed / success**.

| Required gate | Job | Result | Skipped steps |
|---|---|---|---|
| frontend / unit | Frontend (typecheck, unit tests, build, audit, bundle-secret scan) | success | none |
| Edge Function security | Edge Functions (type-check + 20 security tests) | success | none |
| database / security | Database (fresh replay, SQL integrity, 33 API tests, email workflow, real-backend E2E, idempotent re-push) | success | none |
| E2E | E2E (Playwright, mocked) | success | none |

Earlier run 37135192569 on `65c3895` is also green. Caveat: CI ran by `workflow_dispatch` on the branch, not on a PR/`main`.

## 3. Production inspection (Phases 2–9) — **BLOCKED: production unreachable**

Cause: the sandbox egress policy rejects `hecropqaidcveeoagsgy.supabase.co:443` (the project URL left in git history by the removed seeder; the
repository itself no longer contains it), and no Supabase/Vercel/provider credentials exist in the environment. To allow it: environment
settings → Network access → add `*.supabase.co` (and provide credentials by a safe route, below). I did **not** try to bypass the policy.

| Phase | Item | Status |
|---|---|---|
| 2 | Migration history vs repo | **UNVERIFIED** — tooling ready (`inspect-readonly.sql` §02). Expectation: hand-built, no history table (see R-1) |
| 3 | `pg_policies`/RLS/functions/triggers/grants snapshot + diff vs 010 | **UNVERIFIED** — `export-state.sql` + `classify-policies.mjs` ready and tested; see `production-predeploy-security-snapshot.md` |
| 4 | Backdoor `+testcoord/+testleader/+testmember` accounts | **UNVERIFIED** — query built in (§10), detection tested on seeded accounts |
| 5 | Administration continuity (≥1, prefer ≥2 active coordinators/admins) | **UNVERIFIED** — §09. **Hard gate: STOP if none** |
| 6 | Auth config (site URL, redirects, confirmations, signup, password rules, JWT) | **UNVERIFIED** — management-API command in `ops/README.md` |
| 7 | Deployed Edge Functions vs Git, JWT-verify flags, secrets configured | **UNVERIFIED** — `supabase functions list/download`, `secrets list` (names only) |
| 8 | Email provider, sender/domain, suspicious sends | **UNVERIFIED** — DB-side abuse summary in §15; provider logs need provider access. Key rotation **recommended** (old `send-email` was unauthenticated) |
| 9 | Backup | **UNVERIFIED — gate: no migration without a verified restore path** (plan Step 2) |

## 4. New findings during this phase

| ID | Finding | Evidence | Consequence |
|---|---|---|---|
| **R-1** | **Migration `0061_phase6_integrations.sql` DROPs `email_preferences`, `email_log`, `scheduled_emails`, `push_*`, `zoom_*` (`CASCADE`).** If the chain is ever replayed onto a database that already holds data, it **erases members' unsubscribe choices and the email log** | Rehearsal: before `3/2/1/1` rows (preferences/log/scheduled/push) → after applying 0061 alone `0/0/0/0` | A plain `supabase db push` on hand-built production is **forbidden**. The plan records the 10 historical versions with `supabase migration repair` first so only 009+010 run. In the rehearsal a naive push happened to abort harmlessly at 001 (policy already exists), but that is luck, not a guarantee for a differently-shaped production |
| R-2 | Hand-built production has **no migration history**; the CLI runs migrations as `postgres` and fails with "must be owner of table" if tables are owned by another role | Rehearsal artefact on first attempt | Preflight must check table owners (`inspect-readonly.sql` §03 is extended by `\dt`; see plan Step 5) |
| R-3 | `pg_policies` text depends on the connecting role's `search_path` | classifier false alarms | fixed in the tool |
| R-4 | 010 does **not** demote/delete the seeder-style accounts; if they exist they stay privileged and keep a known password | continuity test 8 | explicit plan step (needs approval) |

Optional hardening for R-1 (not done: it would change the certified executable tree and require a new certification): guard the `DROP TABLE`s in
`0061` with "only if the table is empty". Recommended **after** this deployment, since the repair step already neutralises it.

## 5. Staging / production-like rehearsal (Phase 10)

Real production could not be copied. The closest faithful stand-in was built and used: **the pre-fix repository state replayed the way production was
built** — original migrations `000–008` plus the hand-run `src/db` scripts, applied as role `postgres` with **no migration history** — populated with
representative data (9 users across all roles with real GoTrue passwords, 2 cells, contacts/tags/follow-ups/audit, meetings + attendance,
email preferences/log/scheduled, push, testimonies, events, announcements, habits, devotionals, books, a permission delegate) plus three seeder-style
accounts. Stack: `supabase/postgres:17.6.1.066`, GoTrue v2.188.1, storage-api v1.54.0, PostgREST v12.2.12; CLI 2.119.0.

| Check | Result |
|---|---|
| Policy classification of the pre-fix state | 103 STALE, 2 EXPECTED, **0 PRODUCTION-ONLY, 0 UNKNOWN** |
| `supabase migration repair --status applied 000…008 (10 versions)` | OK, **no SQL executed** |
| `supabase db push --dry-run` | would apply **only `009`, `010`** |
| `supabase db push` | `009`, `010` applied; second push → `upToDate:true` |
| **Existing data** | 47 fingerprints (row counts + checksums of profiles, contacts, email preferences, attendance, testimonies, email log, auth.users…) **identical before/after**; the only difference is the new empty `prayer_requests` |
| Upgraded policies vs fresh-install canonical | extra 0 · missing 0 · definition differences 0 (153/153 EXPECTED) |
| **Continuity** (`ops/rehearsal/continuity.test.mjs`) | **8/8**: all legacy users log in with old passwords and keep role/status; leaders see only their cell's contacts; leaders-only meeting hidden from members; email preferences intact and private; private/pending testimonies hidden; permission delegate and attendance kept; legacy coordinator approves the legacy pending user; leader cannot escalate; member cannot self-promote |
| Schema integrity SQL on upgraded DB | ALL ASSERTIONS PASSED |
| API authorization suite on upgraded DB | **33/33** |
| Email workflow (real JWTs, real DB) | 7/7 steps |
| Real-backend browser E2E on upgraded DB | 6/6 |
| Post-deploy smoke script (DB half) on upgraded DB | 34/34 |
| **Rollback rehearsal** (`gen-rollback.mjs` from the pre-deploy export, run in one transaction) | policies 105 → 105 (0 missing/extra/changed), the 4 replaced functions byte-identical, grants 560 = 560, `profiles.status` default restored, guards removed, **data fingerprints identical**; 010 re-applied cleanly afterwards (153/153, continuity 8/8) |

Limits of the rehearsal (honest): it proves the *repo-known* upgrade path. It cannot reveal production-only policies, hand-edited functions, extra
tables, or real data shapes — that is precisely what Steps 1–3 of the plan (real snapshot + classifier + restore-to-scratch rehearsal) are for.

## 6. Phase 11 — PRODUCTION CHANGE PLAN (awaiting your approval; nothing below has been executed)

### 6.0 What I need from you to proceed

1. **Access** (any one safe route): (a) allow `*.supabase.co` in this environment's network policy **and** provide a Supabase access token + a *read-only* DB connection string as environment secrets; or (b) run `ops/README.md`'s preflight yourself and paste `prod-snapshot.txt` + classifier output (contains masked emails only, no secrets); plus Vercel/provider read access or screenshots for Phases 6–8.
2. **Decisions**: ① approve the plan below (per step); ② Zoom/push tiles: hide (small UI change + new CI) or leave visible and labelled unavailable; ③ rotate the email key (recommended); ④ confirm a deployment window.

### 6.1 Hard gates (any failure = STOP, do not migrate)

| Gate | Condition |
|---|---|
| G1 Backup | restore path verified (Step 2) |
| G2 Policies | classifier exit 0 (no PRODUCTION-ONLY / UNKNOWN) or each reviewed and ported/accepted by you |
| G3 Admin continuity | ≥ 1 legitimate active coordinator (prefer 2) |
| G4 Shape | `profiles.status` exists; tables owned by `postgres`; migration history state known; `handle_new_user` variant known |
| G5 Candidate | deploying tree == `a0e4691`; CI green on that SHA (done) |

### 6.2 Steps (each: action → expected → rollback → risk)

| # | Action | Expected | Rollback | Risk |
|---|---|---|---|---|
| 1 | **Read-only preflight**: `inspect-readonly.sql`, `export-state.sql`, `fingerprint.sql`, classifier, `supabase functions list`, `functions download` of the 3 deployed functions (diff vs git history), `secrets list` (names), Auth config GET, provider log review | all gates evaluable; snapshot saved privately | n/a (read-only) | none |
| 2 | **Backup (G1)**: confirm PITR/daily backups in dashboard and note the timestamp; take a logical dump (`pg_dump` of `public` + `auth` data) stored encrypted off-platform; save `prod-state.json` and generate + review `rollback-010.sql`; **restore the dump into a scratch project/DB and run `fingerprint.sql` to prove it** | verified restore, recorded timestamp/method | n/a | low (dump of PII — store encrypted) |
| 3 | **Production-copy rehearsal**: on the scratch restore from Step 2 run Steps 7–8 below + `npm run test:db`-subset + `continuity`-style checks | same results as §5 on real data shape | discard scratch | none to prod |
| 4 | Set Edge secrets (`supabase secrets set …`): `UNSUBSCRIBE_SECRET`, `CRON_SECRET` (≥32 random bytes each), `PUBLIC_APP_URL`, `ALLOWED_ORIGINS`; confirm provider key + `EMAIL_FROM` exist (names only) | `secrets list` shows names | `secrets unset` of the new names | low (new names only) |
| 5 | **Deploy functions first** (closes the open email hole independently of the DB): `supabase functions deploy send-email` (verify-jwt on), `unsubscribe` and `process-scheduled-emails` (`--no-verify-jwt`, per `config.toml`) from the `a0e4691` tree | `functions list` shows new versions; `post-deploy-smoke.mjs` function checks: no creds 401, garbage 401, wrong cron secret 401, tampered/legacy unsubscribe 400 | redeploy previous version downloaded in Step 1 (**note: that restores the vulnerable code — only for a functional emergency**) | low; brief window where emails to opted-out members would 500 until Step 8 adds the `suppressed` status |
| 6 | **Test-account cleanup** *(only for accounts you confirm)*: ban (`ban_duration`) → set role `member`, status `rejected` → after reviewing what they created, delete if no `RESTRICT` dependents | no unexpected privileged account remains; sessions revoked | un-ban / restore role from snapshot | medium (identity must be certain; deletion irreversible → prefer demote+ban first) |
| 7 | **Record history, then migrate** — `supabase link`; `supabase migration list`; `supabase migration repair --status applied 000 001 002 003 004 005 0060 0061 007 008` (**exactly the versions Step 1 shows are already reflected in the schema; no SQL runs**); `supabase db push --dry-run` must list **only 009 and 010** (otherwise STOP); then `supabase db push` | `Applying 009…, 010…`; second push `upToDate:true` | `psql -1 -f rollback-010.sql` (rehearsed, exact restore of policies/functions/grants) or PITR restore for data | **medium-high**: *never run `db push` before the repair (R-1)* |
| 8 | **Verify DB**: re-run `inspect-readonly.sql` + `export-state` → classifier = 153/153 EXPECTED; `schema_integrity.sql`; `fingerprint.sql` vs the Step 1 baseline (only `prayer_requests` may differ) | identical data fingerprints | as Step 7 | low |
| 9 | **Verify admin continuity**: a legitimate coordinator logs in, opens `/admin/pending`, approves/rejects a controlled pending account | works | rollback-010.sql | low |
| 10 | **Rotate the email provider key** *(recommended; your approval)*: create new key → `supabase secrets set RESEND_API_KEY=…` (or SendGrid) → controlled test send → revoke the old key | send OK with new key; old key rejected | keep old key active until new one proven | medium (mail outage if mis-set) |
| 11 | **Auth configuration** *(separate approval, per setting)*: Site URL/redirects = production; require email confirmation; password ≥ 8; CAPTCHA/rate limits — only to match the findings from Step 1 | settings match the approval model | restore the saved Auth config JSON | medium (can lock out sign-ups) |
| 12 | **Frontend**: merge `a0e4691` (via PR you request) → Vercel production deploy; confirm env vars (`REACT_APP_SUPABASE_URL`, `…ANON_KEY`, `REACT_APP_PUBLIC_APP_URL`; VAPID unset) | build succeeds; app loads | Vercel "Instant Rollback" to the previous deployment | low (old frontend also works with the new DB) |
| 13 | **Security smoke** with controlled accounts: `ops/post-deploy-smoke.mjs` (anon, pending, member, coordinator, function auth); needs 3 controlled accounts (member, pending, coordinator) — creating them is a production data change that **needs your approval** and they are deleted afterwards | all PASS | delete accounts | low |
| 14 | **Live email certification**: authorised send to a controlled mailbox → arrives → unsubscribe link opens on the real domain → preference flips → next send suppressed; check SPF/DKIM status in the provider | each hop verified | reset the test member's preference | low |
| 15 | **Application smoke** in a browser with controlled accounts: login, pending gate, dashboard, member view, contacts, cells, meetings, attendance, email-admin, logout (no real records altered) | all work | — | low |
| 16 | **Scheduler decision**: scheduled send has **no UI entry point** (nothing imports `scheduleEmail`), so no user-facing feature pretends to work. Create the `pg_cron` job (checklist §4) only if you want scheduled mail; else leave `process-scheduled-emails` unscheduled (it is secured) | — | `cron.unschedule` | low |
| 17 | **Zoom / push** (not implemented, per instructions): today the Admin Panel shows a "Zoom Integration" tile and meetings include a Zoom form; every user is shown a push-permission prompt that errors when VAPID is unset. **Proposed minimal UI change (own tests + CI + your approval):** hide the Zoom tile/form and the push prompt unless configured | no feature advertises a missing backend | revert commit | low (executable change → new CI run required) |
| 18 | Review logs (Edge Function + Auth + provider), finalise this document | no unexpected 4xx/5xx spikes | — | none |

### 6.3 Rollback summary

| Layer | Fast path | Full path |
|---|---|---|
| Policies/functions/grants/defaults (010) | `rollback-010.sql` (≈1 s, rehearsed exact) | PITR restore |
| Data (should never be needed: 009/010 delete nothing; **0061 must never run**) | — | PITR / logical dump (verified in Step 2) |
| Functions | redeploy downloaded previous version (re-opens the hole) | — |
| Frontend | Vercel instant rollback | — |

## 7. Final status (as of this phase)

```
FEATURE COMPLETE: NO   (Zoom and push backends absent; scheduler not created — optional/out of scope for this phase)
PILOT READY:      NOT YET DETERMINABLE — the hardened candidate is rehearsed and green, but production state is UNVERIFIED;
                  becomes YES after Steps 1–9 pass in production
PRODUCTION READY: NO   — deployment not performed; Phases 12–17 outstanding; production state, Auth config, provider and
                  backup are UNVERIFIED
```
A missing optional integration does **not** make the core system unsafe; what blocks "production ready" is that the fixes are not yet in production.
