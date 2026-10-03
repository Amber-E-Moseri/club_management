#!/usr/bin/env node
// Post-deploy security smoke test for PRODUCTION. Non-destructive: it only attempts operations that must be REFUSED, plus reads
// by controlled test accounts. It creates NO data. Supply controlled accounts you created for this purpose (never real members).
//   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_ANON_KEY=... \
//   SMOKE_MEMBER_EMAIL=... SMOKE_MEMBER_PASSWORD=... SMOKE_PENDING_EMAIL=... SMOKE_PENDING_PASSWORD=... \
//   [SMOKE_COORD_EMAIL=... SMOKE_COORD_PASSWORD=...]  [SKIP_FUNCTIONS=1]  node ops/post-deploy-smoke.mjs
// Never prints tokens or keys.
const { SUPABASE_URL: URL_, SUPABASE_ANON_KEY: ANON, SKIP_FUNCTIONS } = process.env;
if (!URL_ || !ANON) { console.error('SUPABASE_URL and SUPABASE_ANON_KEY required'); process.exit(2); }
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`); };
const call = async (path, { method = 'GET', token, body, headers = {} } = {}) => {
  const r = await fetch(`${URL_}${path}`, { method, headers: { apikey: ANON, Authorization: `Bearer ${token ?? ANON}`, 'Content-Type': 'application/json', ...headers }, body: body && JSON.stringify(body) });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { /* not json */ }
  return { status: r.status, json: j, text: t };
};
const login = async (email, password) => (await call('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password } })).json?.access_token;
const blocked = (r) => r.status === 401 || r.status === 403 || (r.status === 200 && Array.isArray(r.json) && r.json.length === 0);

// ── anonymous ──
for (const t of ['profiles', 'contacts', 'cells', 'meetings', 'testimonies', 'email_log', 'email_preferences', 'announcements', 'books_of_month', 'weekly_messages', 'scheduled_emails'])
  { const r = await call(`/rest/v1/${t}?select=*&limit=1`); check(`anon cannot read ${t}`, blocked(r), `http ${r.status}`); }
check('anon cannot write profiles', !(await call('/rest/v1/profiles', { method: 'POST', body: { id: '00000000-0000-0000-0000-000000000000' } })).status.toString().startsWith('2'));

// ── pending ──
if (process.env.SMOKE_PENDING_EMAIL) {
  const tk = await login(process.env.SMOKE_PENDING_EMAIL, process.env.SMOKE_PENDING_PASSWORD);
  check('pending test account can log in', !!tk);
  if (tk) {
    const me = (await call('/rest/v1/profiles?select=id,status,role', { token: tk })).json;
    check('pending sees only its own profile (status pending)', Array.isArray(me) && me.length === 1 && me[0].status === 'pending', `rows=${me?.length}`);
    for (const t of ['cells', 'events', 'announcements', 'meetings', 'contacts']) check(`pending cannot read ${t}`, blocked(await call(`/rest/v1/${t}?select=*&limit=1`, { token: tk })));
    const self = await call(`/rest/v1/profiles?id=eq.${me[0].id}`, { method: 'PATCH', token: tk, body: { status: 'active' }, headers: { Prefer: 'return=representation' } });
    check('pending cannot self-approve', blocked(self), `http ${self.status}`);
    check('pending still pending', (await call(`/rest/v1/profiles?id=eq.${me[0].id}&select=status`, { token: tk })).json?.[0]?.status === 'pending');
  }
}
// ── member ──
let memberTok;
if (process.env.SMOKE_MEMBER_EMAIL) {
  memberTok = await login(process.env.SMOKE_MEMBER_EMAIL, process.env.SMOKE_MEMBER_PASSWORD);
  check('member test account can log in', !!memberTok);
  if (memberTok) {
    const me = (await call('/rest/v1/profiles?select=id,role,status&email=eq.' + encodeURIComponent(process.env.SMOKE_MEMBER_EMAIL), { token: memberTok })).json?.[0];
    check('member test account is active member', me?.status === 'active' && me?.role === 'member');
    for (const patch of [{ role: 'coordinator' }, { role: 'admin' }, { status: 'pending' }, { cell_id: null }])
      { const r = await call(`/rest/v1/profiles?id=eq.${me.id}`, { method: 'PATCH', token: memberTok, body: patch }); check(`member cannot PATCH own profile ${JSON.stringify(patch)}`, r.status === 403, `http ${r.status}`); }
    check('member cannot create books/events/cells', (await Promise.all(['books_of_month', 'events', 'cells'].map((t) => call(`/rest/v1/${t}`, { method: 'POST', token: memberTok, body: {} })))).every((r) => !String(r.status).startsWith('2')));
    check('member cannot read scheduled_emails', blocked(await call('/rest/v1/scheduled_emails?select=*&limit=1', { token: memberTok })));
    check('member cannot read contacts', blocked(await call('/rest/v1/contacts?select=*&limit=1', { token: memberTok })));
  }
}
// ── coordinator (read-only checks) ──
if (process.env.SMOKE_COORD_EMAIL) {
  const tk = await login(process.env.SMOKE_COORD_EMAIL, process.env.SMOKE_COORD_PASSWORD);
  check('coordinator test account can log in', !!tk);
  if (tk) {
    check('coordinator can list profiles', (await call('/rest/v1/profiles?select=id&limit=2', { token: tk })).json?.length >= 1);
    check('coordinator can read contacts (admin scope)', (await call('/rest/v1/contacts?select=id&limit=1', { token: tk })).status === 200);
    check('coordinator can read admin_roles', (await call('/rest/v1/admin_roles?select=id&limit=1', { token: tk })).status === 200);
  }
}
// ── Edge Functions ──
if (!SKIP_FUNCTIONS) {
  const body = { action: 'send', to: 'nobody@invalid.test', subject: 'smoke', html: '<p>x</p>' };
  // These requests are all expected to be REJECTED before anything is sent.
  check('send-email: no credentials -> 401', (await call('/functions/v1/send-email', { method: 'POST', body, headers: { Authorization: '' } })).status === 401);
  check('send-email: garbage JWT -> 401', (await call('/functions/v1/send-email', { method: 'POST', token: 'not.a.jwt', body })).status === 401);
  check('send-email: anon key (no user) -> 401', (await call('/functions/v1/send-email', { method: 'POST', body })).status === 401);
  if (memberTok) check('send-email: ordinary member -> 403', (await call('/functions/v1/send-email', { method: 'POST', token: memberTok, body })).status === 403);
  check('process-scheduled-emails: no secret -> 401', (await call('/functions/v1/process-scheduled-emails', { method: 'POST' })).status === 401);
  check('process-scheduled-emails: wrong secret -> 401', (await call('/functions/v1/process-scheduled-emails', { method: 'POST', headers: { 'x-cron-secret': 'definitely-wrong-secret-value' } })).status === 401);
  check('unsubscribe: legacy base64 token -> 400', (await call(`/functions/v1/unsubscribe?token=${btoa(JSON.stringify({ memberId: '00000000-0000-4000-8000-000000000000', notifType: 'generic' }))}`)).status === 400);
  check('unsubscribe: tampered signed token -> 400', (await call('/functions/v1/unsubscribe?token=eyJtIjoieCIsInQiOiJnZW5lcmljIiwidiI6MX0.AAAA')).status === 400);
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
