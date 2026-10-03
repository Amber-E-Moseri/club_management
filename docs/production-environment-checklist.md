# Production Environment Checklist

No secret values appear in this repository or in this document. "Where" says where the value must live.
**Status** reflects what could be verified from the repository in this review; production dashboards were not accessible, so every
"configured in production?" item is **UNVERIFIED** until an operator ticks it.

## 1. Variables and secrets

### Browser (Vercel → Project → Settings → Environment Variables; compiled into the public bundle)

| Name | Class | Notes |
|---|---|---|
| `REACT_APP_SUPABASE_URL` | **REQUIRED** | `https://<ref>.supabase.co`. Without it the app silently falls back to `placeholder.supabase.co` (`src/lib/supabase.ts`) |
| `REACT_APP_SUPABASE_ANON_KEY` | **REQUIRED** | anon/publishable key only. Safe to expose *because* RLS is enforced (anon has no table privileges after migration 010) |
| `REACT_APP_PUBLIC_APP_URL` | OPTIONAL | fallback origin in email helpers; defaults to `https://blw-york.vercel.app` — **set it to the real domain** |
| `REACT_APP_VAPID_PUBLIC_KEY` | OPTIONAL (push is disabled, §3) | public half only |
| `REACT_APP_GOOGLE_DRIVE_API_KEY`, `REACT_APP_GOOGLE_DRIVE_UPLOAD_ENDPOINT` | OPTIONAL | Drive link metadata; restrict the API key by HTTP referrer in Google Cloud |
| `REACT_APP_SENTRY_DSN` | OPTIONAL | listed in `.env.example` but **not read by any code** |
| `GENERATE_SOURCEMAP=false` | set by `vercel.json` build command | prevents publishing source maps |

### Edge Function secrets (`supabase secrets set …`; never `REACT_APP_*`)

| Name | Class | Used by | Notes |
|---|---|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | **REQUIRED**, auto-injected | all functions | service role never leaves Edge Functions — verified absent from `build/static/**/*.js` (CI re-checks) |
| `RESEND_API_KEY` **or** `SENDGRID_API_KEY` | **REQUIRED** for any email | send-email, process-scheduled-emails | |
| `EMAIL_FROM` | **REQUIRED** (verified sender/domain with the provider; SPF/DKIM/DMARC) | same | default `no-reply@blwyork.org` is a placeholder |
| `UNSUBSCRIBE_SECRET` | **REQUIRED** | send-email (signs), unsubscribe (verifies) | ≥ 32 random bytes. Rotating it invalidates links already in inboxes |
| `CRON_SECRET` | **REQUIRED** | process-scheduled-emails | ≥ 16 chars enforced, use ≥ 32 random bytes. Function returns 503 if unset |
| `PUBLIC_APP_URL` | **REQUIRED** | unsubscribe redirect, preference links | Supabase serves function HTML as `text/plain`; with this set the browser lands on `/email-preferences` instead |
| `ALLOWED_ORIGINS` | RECOMMENDED | send-email CORS | comma list, e.g. `https://blw-york.vercel.app`. Unset ⇒ `*` (bearer-token auth, no cookies) |
| `ZOOM_ACCOUNT_ID/CLIENT_ID/CLIENT_SECRET` | OPTIONAL — **no consumer exists** (`zoom-api` function absent) | — | |
| `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | OPTIONAL — **no consumer exists** (`send-push` absent) | — | |

### CI / development only

| Name | Class |
|---|---|
| `E2E_REAL_BACKEND`, `PW_CHROMIUM_PATH`, `REQUIRE_INTEGRATION`, `AUTH_URL`, `REST_URL` | DEVELOPMENT ONLY (tests) |
| `app.expect_seed` (psql GUC) | DEVELOPMENT ONLY |

## 2. Supabase project settings (dashboard) — all UNVERIFIED

- [ ] **Site URL** = production origin; **Redirect URLs** contain only production (+ preview) origins. `config.toml` still says `127.0.0.1:3000` (local only).
- [ ] Email **confirmations enabled** (local config has them off), password minimum ≥ 8, CAPTCHA/rate limits on sign-up (open sign-up + approval queue is spammable).
- [ ] SMTP for Auth emails configured (the built-in sender is rate-limited and not for production).
- [ ] Edge Functions deployed from this commit: `send-email` (verify JWT **on**), `unsubscribe` (verify JWT **off**), `process-scheduled-emails` (verify JWT **off**). `supabase functions deploy` reads `config.toml`.
- [ ] Secrets in §1 set; `UNSUBSCRIBE_SECRET` and `CRON_SECRET` generated with `openssl rand -base64 48` and stored only in the secret manager.
- [ ] Scheduler (§4) created.
- [ ] PITR/backups enabled before applying migration 010 (it resets policies and revokes `anon` privileges).
- [ ] Exposed schemas = `public` only; no service-role key in any Vercel variable.

## 3. Integrations — launch classification

| Integration | Verdict | Evidence / required action |
|---|---|---|
| Email (Resend/SendGrid) | **REQUIRED FOR LAUNCH** if notifications are advertised | code path + auth + suppression + unsubscribe verified end-to-end with a **stubbed provider**; a live send with real credentials and domain authentication is **UNVERIFIED** |
| Scheduled email processing | **REQUIRED** if scheduled/reminder mail is advertised | function secured and tested; **no scheduler exists in the repo** → create it (§4) or do not advertise reminders |
| Zoom | **DISABLED/UNCONFIGURED, but advertised** | Admin Panel shows "Zoom Integration — auto-create video meetings", UI invokes `zoom-api`, which is **not in the repository**. Either hide the tile for launch or build/deploy the function (use `_shared/auth.ts`) |
| Web push | **DISABLED/UNCONFIGURED** | `send-push` absent; client now writes `member_id` (was `user_id`, mismatching the schema). Leave `REACT_APP_VAPID_PUBLIC_KEY` unset so the UI reports "not configured" |
| Google Drive | **OPTIONAL** | client-side links/metadata only; needs referrer-restricted API key if used |

## 4. Scheduler for `process-scheduled-emails` (pick one; not present in repo)

Supabase `pg_cron` + `pg_net`, secret kept in Vault (run once in the SQL editor, replace `<ref>`):

```sql
select vault.create_secret('<paste CRON_SECRET>', 'cron_secret');
select cron.schedule('process-scheduled-emails', '*/5 * * * *', $$
  select net.http_post(
    url     := 'https://<ref>.supabase.co/functions/v1/process-scheduled-emails',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
    body    := '{}'::jsonb);
$$);
```
Any external scheduler works if it sends `POST` with header `x-cron-secret: <CRON_SECRET>`.

## 5. First-time database bootstrap

1. Take a backup. Export `pg_policies`, `pg_proc` (see `rls-audit.md` §4) and diff after.
2. `supabase db push` (applies `000…010`; if production was built by hand, migrations are idempotent and 009/010 were tested on a populated pre-fix schema).
3. **There is no default coordinator.** New accounts are always `member/pending`. Promote the first coordinator in the SQL editor:
   `update public.profiles set role='coordinator', status='active' where email='<owner email>';`
4. Delete leftover test accounts (`…+testcoord/+testleader/+testmember@…`) if they exist in production.
5. Run `npm run test:db` (needs `supabase start`/`db reset`) against a **staging copy** before production.

## 6. Other checks performed

| Check | Result |
|---|---|
| Service-role key / provider keys / cron+unsubscribe secrets in browser JS | none (`grep` on `build/static/**/*.js`; JWT-shaped strings in bundle: none; the only `REACT_APP_*` variables read are those listed above) |
| Committed secrets (`git grep`) | none in tracked files; removed `create-test-users.js` held the production project URL/anon key (anon key is public by design) and weak test passwords still present in history |
| CORS | `send-email` allow-list via `ALLOWED_ORIGINS`; other functions have no browser callers except `unsubscribe` (navigation, not XHR) |
| `vercel.json` | SPA rewrite + build command; **no security headers** (CSP, X-Frame-Options, HSTS) configured → recommended before broad rollout |
