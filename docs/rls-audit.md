# RLS / Authorization Audit

Result of auditing all **41** application tables (+3 app-owned storage buckets). Authorization was certified by
exercising a **real database through the real API** (GoTrue-issued JWTs → PostgREST → Postgres RLS), not by reading SQL:

* `tests/security/rls.test.mjs` — 33 tests: anonymous, pending, rejected, member, cell leader (own/other cell), admin,
  coordinator, permission-delegate; every write is attempted by direct HTTP, never through the UI.
* `supabase/tests/database/schema_integrity.sql` — structural coverage (RLS on every table, gate on every table, no
  anon-reachable permissive policy, no anon table privileges, helper functions/triggers/FKs/unique/indexes) and
  role-context tests of the storage policies.
* Same suite run on a **pre-fix, production-like** database (original migrations + the hand-run `src/db` scripts):
  **30 of 33 tests fail**; after migrations 009+010 **33/33 pass** — so the tests do detect the defects.

## 1. Authorization model (migration `010_security_hardening.sql`)

| Mechanism | Effect |
|---|---|
| `profiles.status` | `pending` (default for every new account) → `active` (approved) / `rejected` |
| **Restrictive policy `require_active_member`** on all 40 non-`profiles` tables | ANDed with every permissive policy, for every command and role: unless the caller's profile is `active` nothing is reachable (anon included). One mechanism instead of 40 edits; a SQL test fails CI if a future table lacks it |
| `profiles` policies | select: own row, or any row if active. update: own (active) / staff / coordinator-all |
| `profiles_guard` trigger (API roles only) | `id/email/joined_at` immutable; **role/admin_role: coordinator only**; **cell_id: admin/coordinator**; **status: staff only, never self, cell leaders only for `member` targets** |
| `handle_new_user` | always `member` + `pending`; ignores any client metadata |
| Helpers (`SECURITY DEFINER`, pinned `search_path`) | `is_active_member`, `is_core_admin`, `is_coordinator`, `is_staff_role`, `has_admin_permission(key)`, `is_cell_leader_of` |
| `has_admin_permission` | makes the `admin_role_permissions` keys real: `contacts.view_all/write`, `testimonies.view_all/approve`, `attendance.view_all`, `settings.manage_tags`, `devotionals.manage`, `integrations.manage` (core admins implicitly hold all; `notifications.send` is enforced in the Edge Function) |
| Policy reset | migration drops **every** existing policy on app tables then creates the canonical set, so the result does not depend on which hand-run SQL production happened to receive |
| Grants | `anon`: no privileges on any public table (defence in depth); `authenticated`: CRUD bounded by RLS; `service_role`: all (Edge Functions) |

Role abbreviations below: **A** = active member (any role) · **S** = staff (`admin`/`coordinator`/`cell_leader`) ·
**CA** = core admin (`admin`/`coordinator`) · **C** = coordinator · **own** = row owner · **svc** = service role only.
Every cell additionally requires *active* (the gate). Anonymous: no access to anything.

## 2. Matrix (all tables RLS **enabled**)

| Table | SELECT | INSERT | UPDATE | DELETE | Service-role dependency | Residual risk |
|---|---|---|---|---|---|---|
| profiles | own, or A | C only (accounts are created by trigger) | own(A) · S · C — columns guarded by `profiles_guard` | C | trigger as definer; Edge fn reads | PII (email, student_number) visible to all active members → directory view recommended |
| user_profiles | own · CA | own | own | own | — | none (tightened from "any authenticated" — phone numbers) |
| cells | A | CA | CA | CA | — | low |
| tags_settings / status_settings | A | perm `settings.manage_tags` / CA | same | same | — | low |
| contacts | CA/`contacts.view_all` · leader of the cell · logger | `logged_by = self` and (`contacts.write`/CA or leader of that cell) | same gate | `contacts.write`/CA · logger | — | `phone_hidden` is a UI flag only (cannot hide a column in RLS) |
| contact_tags / contact_follow_ups | via visible contact (+ `view_all`, assignee) | via visible contact, `tagged_by/assigned_by = self` | follow-ups: assignee / write-perm / contact owner | tags: write-perm / contact owner | — | low |
| contact_audit_log | CA | self-attributed, only for contacts the caller may touch | **none (append-only)** | **none** | — | low |
| admin_roles / admin_role_permissions | CA | C | C | C | — | low |
| admin_role_assignments | CA · own | C | C | C | — | low |
| drive_link_metadata | A | owner/CA | owner/CA | owner/CA | — | low |
| email_preferences | own · CA | own | own | own | `unsubscribe` fn upserts (svc) | none |
| email_log | own · CA | **svc only** | **svc only** | CA (retention purge) | `send-email` writes (svc) | low |
| scheduled_emails | **nobody** (no policy) | svc | svc | svc | `send-email`, `process-scheduled-emails` | none |
| email_notification_log (legacy) | CA · own | none | none | none | — | unused legacy table |
| push_subscriptions | own · CA | own | own | own | `send-push` (absent) would read as svc | integration disabled |
| push_notification_log | own · CA | svc | svc | svc | `send-push` | integration disabled |
| attendance_imports / attendance_member_matches | `attendance.view_all`/CA | same | same | same | — | CMP import is not wired in the UI |
| meetings | creator · CA · public · leaders-only(S) · same-cell | S with `created_by = self` | creator(S) · CA | creator(S) · CA | — | `explicit` visibility has no reader except creator/CA |
| meeting_attendances | own · S | own, `attended` must be null | own (cannot change `attended`/ids, enforced by `attendance_guard`) · S marks attendance | own · S | — | S sees all cells' RSVPs |
| zoom_settings | `integrations.manage`/CA | same | same | same | zoom-api (absent) | integration disabled |
| zoom_attendance | S | svc | svc | svc | zoom-api (absent) | S sees all cells |
| monthly_devotionals / devotional_daily_pages | A | `devotionals.manage`/CA | same | same | — | fixed: admin was derived from editable JWT metadata |
| devotional_views | own · devotional admin | own | own | none | — | low |
| books_of_month | A | CA | CA | CA | — | fixed: was any authenticated / anon-readable |
| testimonies | own · moderator (`approve`/`view_all`/CA) · approved & (members/public, or same-cell for `cell`) | own | own (status guarded by `testimonies_guard`) · moderator | own · moderator | — | public ≡ all active members (not anon) |
| testimony_reactions / testimony_comments | only for testimonies the caller can see | own, on visible testimonies | — | own · moderator (comments) | — | fixed: previously readable for all testimonies |
| events / event_rsvps | A · own+CA | CA / own | CA / own | CA / own | — | low |
| announcements | A | S, `author_id = self` | author(S) · CA | author(S) · CA | — | low |
| weekly_messages | `org` scope or own | own `personal`; `org` needs CA | own · CA (scope re-checked) | own · CA | — | low |
| habit_templates / habit_entries | A / own+CA | CA / own | CA / own | CA / own | — | low |
| confessions / confession_declarations | active ones (CA: all) / own+CA | CA / own | CA / own | CA / own | — | low |
| prayer_requests | active or own or CA | own | own · CA | own · CA | — | `is_anonymous` does not hide `author_id` over the API; no UI reads the table today |

Storage: `devotional-images` — public read, write/update/delete by devotional admin; `testimony-images` — public read,
write only into the caller's own `<uid>/` folder (active members); `user-media` (new bucket, previously missing) — public
read, write only to `avatars/<own uid>.*`. Public buckets mean object URLs are world-readable (by design, URLs unguessable only by timestamp).

## 3. Defects found and fixed (all reproduced first)

| # | Defect | Severity | Fixed by |
|---|---|---|---|
| R-1 | Self-registration with `role` metadata → coordinator (migration chain) | Critical | `handle_new_user` |
| R-2 | User can PATCH own `role`/`status`/`cell_id` → approval bypass and privilege escalation | Critical | `profiles_guard` + narrowed policies |
| R-3 | Cell leader can update any column of any profile (`leaders_manage_profiles`), incl. promoting to coordinator | Critical | same |
| R-4 | No policy considered `status`; a pending user had full member read access to org data | High | `require_active_member` gate |
| R-5 | `is_devotional_admin()` trusted user-editable JWT metadata | High | DB-backed permission |
| R-6 | `testimonies` SELECT: every row (private/draft/pending) visible to anyone with a `user_profiles` row; author could self-approve (client chose `status`); admins could not moderate others' items (update was author-only) | High | rewritten policies + `testimonies_guard` |
| R-7 | `books_of_month` writable by any authenticated user, readable anonymously | Medium | CA-only writes, authenticated reads |
| R-8 | `weekly_messages` org messages readable by anon | Medium | gate + `authenticated` role only |
| R-9 | `meeting_attendances`: RLS on with **zero** policies in the chain (feature unusable); member could mark own `attended` | Medium | policies + `attendance_guard` |
| R-10 | Any leader could edit/delete any meeting; any member could forge `contact_audit_log` rows; contact INSERT accepted forged `logged_by` | Medium | creator/CA rules; gated audit insert; `logged_by = self` |
| R-11 | Admin could forge/edit `email_log` | Low | svc-only writes |
| R-12 | `user_profiles` phone numbers readable by all members | Medium | own + CA |
| R-13 | `user-media` bucket referenced by the app but never created; testimony image uploads not owner-scoped | Medium | bucket + policies |
| R-14 | `anon` held table privileges on every table (RLS was the only barrier) | Low | revoked |
| R-15 | `admin_role_permissions` keys were decorative (nothing enforced them) | Medium | `has_admin_permission` in RLS |

## 4. What this audit does **not** prove

* **Production drift — UNVERIFIED.** Production was built by pasting SQL by hand, so its live policies/functions may differ
  from every file in the repo. Migration 010 resets all policies on app tables, but you must (a) export
  `select * from pg_policies where schemaname in ('public','storage')` and `pg_proc` before applying, (b) diff after, and
  (c) run `tests/security` against a **staging copy** of production data. The upgrade path *was* tested: original
  migrations + hand-run `src/db` scripts → apply 009+010 (twice) → 33/33.
* Existing production profiles: 009 keeps existing rows `active` (column added with default `active`, then default flipped to
  `pending`). If production already has the column, check for rows that should be `pending`.
* Cross-tenant/perf: no load testing; policies call `SECURITY DEFINER` helpers per row (indexes on `profiles.id` PK suffice at this scale).
* Reading `profiles` by pending/rejected users of *other* ids is blocked; reading own is allowed (needed to render the pending screen).
