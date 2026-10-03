# Production Certification

**Candidate commit (code + migrations + CI frozen):** `65c3895296e27a17f6269672b1fca2b61e467e6b` on `claude/trusting-rubin-o4dgub`
(base `origin/main` = `86c2a91…`). Commits after it are documentation-only (`git diff 65c3895..HEAD --stat` touches `docs/` only).
Every result below was produced by running the command, from a **clean clone of that commit**, unless marked UNVERIFIED.

> **Read this first.** The vulnerabilities found by this review exist in whatever is deployed today. Fixing the repository does
> nothing until the migrations are applied and the Edge Functions are redeployed. See BLOCKERS B-1 and B-2.

## 1. Verdict

```
FEATURE COMPLETE: NO
PILOT READY:      YES  — conditional on BLOCKERS B-1…B-3 being executed at deploy time (they are procedures, not code)
PRODUCTION READY: NO
```

### FEATURE COMPLETE: NO — remaining gates
1. **Zoom**: the Admin Panel advertises it and the UI invokes `zoom-api`, but the function does not exist in the repo. Implement it (reusing `_shared/auth.ts`) **or** remove/hide the tile.
2. **Web push**: `send-push` does not exist (client subscribes, nothing can send). Implement **or** leave unconfigured and hide the opt-in UI.
3. **Scheduled email**: `process-scheduled-emails` is secured and tested, but no scheduler exists anywhere in the repo. Create it (`production-environment-checklist.md` §4) **or** stop advertising reminders.
4. `prayer_requests` had no schema in any SQL (now created by 009) and no UI reads/writes it except the dashboard counter — decide whether it is a launch feature.

### PRODUCTION READY: NO — remaining gates
1. B-1 … B-3 executed **and** rehearsed on a staging copy of production data (the repo cannot know production's real policy state).
2. Everything under "FIX BEFORE BROAD ROLLOUT" below closed or explicitly accepted.
3. Live-provider email verification (real credentials, domain authentication, real inbox click-through of the unsubscribe link).
4. Production Supabase Auth configuration verified (§ Fix-before-broad #1).
5. A green CI run on the final merge commit (the green run above is on the branch via `workflow_dispatch`, not on a PR or `main`).

## 2. BLOCKERS — issues that make production deployment unsafe

| ID | Blocker | Why | Required action (owner) |
|---|---|---|---|
| **B-1** | **Fixes are not deployed.** Production (if it exists) is still exposed to: public `send-email` (anyone can send mail through the org's provider account and write logs), public `process-scheduled-emails`, forgeable unsubscribe tokens, self-service role/approval changes through the REST API, and (depending on which trigger version production has) self-registration as `coordinator`. | Confirmed in a real stack before the fixes (30/33 of the new security tests fail on a production-like pre-fix schema) | Back up → export `pg_policies`/`pg_proc` → rehearse `supabase db push` on a staging copy and run `npm run test:db` against it → apply to production → `supabase functions deploy send-email unsubscribe process-scheduled-emails` with secrets set (`production-environment-checklist.md`). Because `send-email` was callable by anyone, **review the email provider's sent-mail log and rotate the provider API key**. |
| **B-2** | **Possible live backdoor accounts.** The removed `create-test-users.js` (still in git history) created accounts `blwcan.elvanto+testcoord/+testleader/+testmember@gmail.com` with the shared password `Test1234!` against the production Supabase project and promoted them (`coordinator`, `cell_leader`) — possible only because of defects S-4/S-5. | Anyone with read access to the repository history could log in as a coordinator **if those accounts exist** (UNVERIFIED) | Check `auth.users`/`profiles` for those emails; delete them or reset their passwords and demote; rotate any session. |
| **B-3** | **No default coordinator after the hardening** (new accounts are always `member/pending`, and only a coordinator can approve staff or change roles). If production has no active coordinator, nobody can approve anyone. | Fail-closed by design | Verify an active coordinator exists, otherwise promote one via the SQL editor (`production-environment-checklist.md` §5). |

## 3. FIX BEFORE BROAD ROLLOUT — do not necessarily block a controlled pilot

1. **Supabase Auth settings (UNVERIFIED in production):** require email confirmation (local config has it off), password ≥ 8, CAPTCHA / sign-up rate limits, production SMTP, Site URL + redirect URLs.
2. **Email in production:** live send with real credentials, SPF/DKIM/DMARC, real-inbox unsubscribe click (Supabase serves function HTML as `text/plain`; `PUBLIC_APP_URL` redirect mitigates), scheduler + failure alerting. Only a stubbed provider was exercised.
3. **Zoom / push tiles are advertised but non-functional** (see Feature-complete gates 1–2).
4. **Member directory PII:** every active member can read every profile's `email` and `student_number` (needed for the directory today). Expose a minimal view and restrict the base table.
5. **Security headers** (CSP, HSTS, X-Frame-Options, Referrer-Policy) are not configured in `vercel.json`.
6. **Operations:** backups/PITR confirmed, rollback plan for migration 010, error monitoring (`REACT_APP_SENTRY_DSN` is documented but nothing reads it), alerting on Edge Function failures.
7. **Browser-level test depth:** real-backend browser coverage is limited to sign-up → approval → login. Contacts, meetings, email-preferences, testimonies are certified at the API/database level only.
8. **Rate limiting** for `send-email` per user and for anonymous endpoints (staff-only today, capped at 200 recipients/call).
9. **Dependency hygiene:** 2 moderate advisories in production deps (react-router); 64 high in the dev toolchain (react-scripts — build-time only).
10. **Storage API:** bucket policies were tested at SQL level with real roles; actual file uploads through the Storage API were not exercised.

## 4. CAN WAIT

* Unsubscribe is a state-changing `GET` (scanner prefetch) — one-click `POST` already supported.
* `prayer_requests.is_anonymous` does not hide `author_id` over the API (no UI uses it).
* Cell leaders can see all cells' RSVPs and Zoom attendance.
* Legacy unused tables (`email_notification_log`, `attendance_imports/matches`, `drive_link_metadata` workflows).
* Meeting `explicit` visibility has no reader other than creator/admin.
* CRA → Vite migration, Node 20 deprecation notice on GitHub Actions, higher unit-test coverage (scripted coverage covers 4 files).
* Public storage buckets (unguessable-by-timestamp URLs, not secret).

## 5. Evidence (candidate commit, clean clone, 2026-10-03)

| Gate | Command | Result |
|---|---|---|
| `git status` | `git status --short` in the clean clone | **empty** (clean); HEAD = `65c3895…` |
| Install | `npm ci` | OK |
| Typecheck | `npm run typecheck` (`tsc --noEmit`) | **0 errors** |
| Lint | CRA ESLint runs inside the build with `CI=true` (warnings = errors) | **clean** |
| Unit tests | `CI=true npm test` | **6 suites / 16 tests passed, 0 failed, 0 skipped** (baseline: 5 / 7) |
| Build | `CI=true npm run build` | **Compiled successfully**, main.js 299.25 kB gzip |
| Prod deps audit | `npm audit --omit=dev --audit-level=high` | exit 0 (2 moderate remain) |
| Secrets in bundle | grep `service_role`, provider/cron/unsubscribe secret names in `build/static/**/*.js` | **none** |
| Edge Function type-check | `deno check` (handlers, `_shared`, tests) | **0 errors** |
| Edge Function security tests | `deno test` `_tests/security_test.ts` | **20 passed, 0 failed** |
| **Fresh DB replay** | `supabase db push` (CLI 2.119.0) on a brand-new `supabase/postgres:17.6.1.066` + GoTrue v2.188.1 + storage-api v1.54.0 | **12/12 migrations applied**; seed OK; second push → `upToDate:true` (baseline: **failed at 006**, duplicate version) |
| Schema integrity (SQL) | `schema_integrity.sql` | **ALL ASSERTIONS PASSED** (41 tables RLS-on; gate on 40; no anon-reachable policy; no anon table privileges; functions, triggers, FKs, unique constraints, indexes, storage-policy role tests) |
| **RLS / security (real API)** | `node --test tests/security/*.test.mjs` | **33 passed, 0 failed** (30/33 fail on the pre-fix schema) |
| Email workflow (real DB + real JWTs) | `deno test` `_tests/integration_test.ts` | **7 steps passed**: authn/authz, forged JWT, delegate permission, unsubscribe → suppression, scheduled processing, resend |
| E2E mocked | `npx playwright test` | **5 passed** |
| **E2E real backend** | `E2E_REAL_BACKEND=1 npx playwright test` | **6 passed** (adds sign-up → pending → blocked self-approval → approval → login) (baseline: 0/5 ran — Windows-only `set PORT=` config) |
| Upgrade path | original migrations + hand-run `src/db` scripts (production-like) → apply 009+010 twice → suite | **33/33 passed**, idempotent |
| CI (GitHub Actions) | `workflow_dispatch` on this commit | **run [37135192569](https://github.com/Amber-E-Moseri/club_management/actions/runs/37135192569) — all 4 jobs succeeded** (Frontend; Edge Functions; mocked E2E; Database incl. `supabase start` + `db reset` + SQL integrity + 33 API tests + email workflow + real-backend E2E + idempotent re-push). Triggered by `workflow_dispatch` on the branch: it has **not** run on a PR or on `main` |

Not reproduced in the sandbox: the repo's CI runs the **full** `supabase start` stack (kong, GoTrue, PostgREST, storage-api); here an equivalent stack (same Postgres image, GoTrue and storage-api images; PostgREST v12.2.12; a 30-line CORS gateway) was used because the ECR registry is unreachable. The GitHub run is the authoritative check of the CI workflow itself.

### Baseline → final

| | Baseline (`86c2a91`) | Final (`65c3895`) |
|---|---|---|
| Unit tests | 7 | 16 |
| E2E | 0/5 could run | 6/6 (incl. real backend) |
| Fresh DB replay | ✗ fails | ✓ 12/12, idempotent |
| Tables the app needs but no migration creates | 9 | 0 |
| API security tests | n/a | 33/33 |
| Edge Function security tests | n/a | 20 + 7 |
| CI gates | install, test, build | + typecheck, audit, bundle scan, mocked E2E, Deno tests, fresh-DB replay, SQL integrity, RLS API suite, email workflow, real-backend E2E, migration idempotency |

## 6. Phase checklist

| Phase | Outcome |
|---|---|
| 0 Baseline | `production-readiness-baseline.md` |
| 1 Clean baseline | done; pre-existing failures classified (TEST DEFECT: Windows-only Playwright config; ENVIRONMENT: browser build) and fixed |
| 2 send-email auth | confirmed critical → fixed + 20 unit / 7 real-DB tests |
| 3 scheduled-email auth | confirmed critical → `CRON_SECRET` + tests; **caller in production UNVERIFIED** (none in repo) |
| 4 signed unsubscribe | confirmed high → HMAC tokens, legacy rejected (tradeoff documented) |
| 5 RLS audit | `rls-audit.md`; 15 defects fixed, each reproduced first |
| 6 Fresh replay | duplicate-version blocker fixed; reconciliation (009) + hardening (010) migrations |
| 7 Workflows | auth/approval (API + browser), members, contacts/cells, meetings/attendance, email → suppression, scheduled — all verified; integrations classified (`production-environment-checklist.md` §3) |
| 8 CI gates | 4 jobs; first GitHub run caught and fixed two CI-only defects (Deno/package.json, idempotency message) |
| 9 Production config | `production-environment-checklist.md`; no server secret in bundle; **dashboard settings UNVERIFIED** |
| 10 Final gate | this document |

## 7. UNVERIFIED (could not be tested here — do not read as PASS)

* Production database/policy state, Auth dashboard settings, deployed function versions, secrets, scheduler, CORS origins.
* Live email provider delivery and domain authentication; actual inbox unsubscribe click on the Supabase domain.
* Edge Functions inside the hosted Supabase Edge Runtime (verified in Deno, in-process, against real GoTrue/Postgres).
* Storage API uploads; performance/load; mobile/cross-browser rendering; accessibility.
* Whether the `+test…` accounts exist in production (B-2).
