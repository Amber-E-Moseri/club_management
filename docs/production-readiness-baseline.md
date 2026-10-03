# Production Readiness — Baseline (Phase 0 / Phase 1)

Captured 2026-10-03 **before any security change**. Nothing in this document was
assumed from earlier reports; every number below comes from a command that was run.

## 1. Repository state

| Item | Value |
|---|---|
| Branch | `claude/trusting-rubin-o4dgub` |
| HEAD SHA | `86c2a91d4f91e6d13d5656cb6eb7d085c93da1b4` |
| `origin/main` SHA | `86c2a91d4f91e6d13d5656cb6eb7d085c93da1b4` (identical to HEAD) |
| Working tree | clean at start (no uncommitted work existed) |
| Node / npm | v22.22.0 / 10.9.4 (CI uses Node 20) |
| Supabase CLI | not installed at start; 2.119.0 installed to a scratch dir for replay tests |
| Docker / psql | Docker 29.6.2 (daemon started manually), psql 16.14 |

## 2. Inventory (verified from the tree)

| Area | Finding |
|---|---|
| Frontend | CRA 5 + React 18 + TypeScript 4.9 + Tailwind; 27 pages, 19 hooks; Vercel (`vercel.json`) |
| Supabase migrations | `supabase/migrations/000…008` (10 files; **two share version `006`**) |
| Out-of-band SQL | `src/db/*.sql` (10 files) — run by hand in the SQL editor; **NOT in the migration chain** (see §5) |
| Edge Functions in repo | `send-email`, `process-scheduled-emails`, `unsubscribe` |
| Edge Functions called but absent | `send-push` (pushService.ts), `zoom-api` (zoomIntegration.ts) |
| `supabase/config.toml` | no `[functions.*]` section → all functions use default `verify_jwt = true`; `[db.seed]` points to `./seed.sql` which does not exist |
| Auth / approval | `profiles.status` (`pending/active/rejected`) exists only in `src/db/migration_signup_approval.sql`; approval UI = `AdminPendingApprovals.tsx` (admin/coordinator/cell_leader) |
| Roles | `profiles.role` ∈ coordinator/admin/cell_leader/member; extra staff permissions in `admin_roles`, `admin_role_permissions`, `admin_role_assignments` (10 permission keys, **not enforced anywhere in RLS or functions**) |
| Email | Resend or SendGrid via `send-email`; tables `email_log`, `email_preferences`, `scheduled_emails` |
| Scheduled jobs | **none defined in the repo** (no pg_cron migration, no Vercel cron, no workflow). Caller of `process-scheduled-emails` is unknown → UNVERIFIED |
| Unsubscribe | client builds `btoa(JSON)` token (`emailService.buildUnsubscribeUrl`); `unsubscribe` function does `JSON.parse(atob(token))` — unsigned |
| Zoom | frontend calls missing `zoom-api` function; tables `zoom_settings`, `zoom_attendance` exist |
| Push | frontend upserts `push_subscriptions(user_id…)` but the migration schema column is `member_id` and no INSERT policy exists; `send-push` function absent |
| Google Drive | client-side link metadata (`REACT_APP_GOOGLE_DRIVE_API_KEY`), table `drive_link_metadata` |
| CI | one job (`build-test`): `npm ci`, `npm test`, `npm run build` on Node 20. No lint step, no DB job, no E2E, no security tests |
| Unit tests | 5 suites / 7 tests (StatCard, Badge, CSV exports, dashboard stats) |
| E2E | 5 Playwright tests (`e2e/auth.spec.ts`) against a **mocked** Supabase (`e2e/supabaseMock.ts`) |
| Stray artifact | `create-test-users.js` — committed seeder with the production project URL + anon key and weak test passwords; it promotes accounts by updating `profiles.role` from the browser client (only works because of defect D-1 below) |

## 3. Phase 1 results (existing validation commands, untouched code)

| Command | Result |
|---|---|
| `npm ci` | OK. `npm audit`: 77 vulns total (3 low / 10 moderate / 64 high) — all dev-toolchain (react-scripts). `npm audit --omit=dev`: **2 moderate** (react-router-dom) |
| `CI=true npm test` | **5 suites passed, 7 tests passed, 0 failed, 0 skipped**. Coverage only on 4 files (14% statements of those; collection is restricted by the npm script) |
| `npm run build` (`CI=true` and `CI=false`) | **Compiled successfully**, no warnings. main.js 299.42 kB gzip |
| `npx tsc --noEmit` | exit 0, no errors |
| Lint | no separate script; `react-app` ESLint runs inside the build — clean |
| `npx playwright test` (as committed) | **FAIL — 0/5 run: `Timed out waiting 120000ms from config.webServer`** |

### Failure classification

| Failure | Class | Cause | Action |
|---|---|---|---|
| Playwright webServer timeout | **TEST DEFECT** | `command: 'set PORT=3100&&node …'` is Windows `cmd` syntax; on Linux/macOS `set` does not export the variable so the dev server starts on :3000 and Playwright waits on :3100 forever | Fixed in `playwright.config.ts` (use `webServer.env`) |
| `browserType.launch: Executable doesn't exist` | **ENVIRONMENT** | sandbox ships Chromium r1194, Playwright 1.63 expects r1243 | `PW_CHROMIUM_PATH` env override added; CI uses `playwright install` |

After the two fixes: **5 passed, 0 failed, 0 skipped** (`PW_CHROMIUM_PATH=/opt/pw-browsers/chromium CI=true npx playwright test`).
These E2E tests mock Supabase, so they prove UI behaviour only — **not** auth, approval or RLS.

## 4. Baseline database replay (existing `supabase/migrations`, fresh DB)

Fresh `supabase/postgres:17.6.1.066` + GoTrue v2.188.1 + storage-api v1.54.0
(real `auth`/`storage` schemas). Replay with the real Supabase CLI:

```
supabase db push --db-url …  --include-all
Applying migration 006_contact_enhancements.sql...
Applying migration 006_phase6_integrations.sql...
ERROR: duplicate key value violates unique constraint "schema_migrations_pkey"  Key (version)=(006) already exists
```

**BLOCKER — a fresh database cannot be built with the Supabase CLI.** Applying the same
files with plain `psql` succeeds, so the SQL itself is valid; only the version collision breaks it.

## 5. Baseline schema/code drift (fresh DB built from `supabase/migrations` only)

Tables referenced by the frontend (`.from('…')`) that **no migration creates**:
`weekly_messages`, `habit_templates`, `habit_entries`, `confessions`, `confession_declarations`,
`announcements`, `events`, `event_rsvps`, `prayer_requests` (the last exists in **no** SQL file at all).
Columns missing: `profiles.status`, `profiles.student_number`, `meetings.category`, `meetings.allow_join_requests`.
`meeting_attendances` is created with RLS on and **zero policies** (unusable by any non-service role).
Production was evidently built by pasting `src/db/*.sql` into the SQL editor; the repository cannot
reproduce it. Exact production state is **UNVERIFIED** (no production access in this session).

## 6. Defects confirmed on the baseline (real database, not just SQL reading)

| ID | Defect | Evidence |
|---|---|---|
| D-1 | **Anyone can self-register as `coordinator`**: `handle_new_user` copies `raw_user_meta_data->>'role'` | `POST /auth/v1/signup {data:{role:"coordinator"}}` → `profiles.role = coordinator` |
| D-2 | Users can edit their own `role`/`status`/`cell_id` (`profiles_update_own` has no column limit) → approval bypass + privilege escalation | policy text; reproduced in the regression suite (Phase 5) |
| D-3 | `is_devotional_admin()` trusts `user_metadata.role` (user-editable) | function text |
| D-4 | `send-email`: no caller authentication/authorization, uses service role, `CORS *` | code |
| D-5 | `process-scheduled-emails`: no authentication at all, uses service role | code |
| D-6 | Unsubscribe tokens are unsigned base64 JSON — anyone can unsubscribe any member | code |
| D-7 | `testimonies` SELECT leaks every row (incl. private/draft/pending) to any user who has a `user_profiles` row; authors can self-approve (client chooses `status`) | policy text |
| D-8 | `books_of_month` writable by any authenticated user; readable by anon | policy text |
| D-9 | No RLS policy anywhere considers `profiles.status` → a *pending* user has full member read access | policy audit |

Phases 2–6 fix these with regression tests; `docs/security-audit.md` and `docs/rls-audit.md` track each one.

## 7. Resolution status (added after remediation)

Everything in §3–§6 was re-run after the fixes; the outcome, the evidence and what is still open are in
[`production-certification.md`](production-certification.md). Details of each defect: [`security-audit.md`](security-audit.md) (S-1…S-9)
and [`rls-audit.md`](rls-audit.md) (R-1…R-15). The baseline numbers above are intentionally left unchanged as the "before" record.
