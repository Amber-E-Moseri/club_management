// Regression tests for Edge Function authentication/authorization, scheduled-email auth
// and signed unsubscribe tokens.  Run: deno test supabase/functions/_tests
import assert from 'node:assert/strict';
import { createSendEmailHandler } from '../send-email/handler.ts';
import { createScheduledHandler } from '../process-scheduled-emails/handler.ts';
import { createUnsubscribeHandler } from '../unsubscribe/handler.ts';
import { signUnsubscribeToken, verifyUnsubscribeToken } from '../_shared/unsubscribe-token.ts';
import { checkCronSecret } from '../_shared/cron.ts';
import { toBase64Url } from '../_shared/crypto.ts';
import { FakeAdmin, fakeAuthDeps } from './fake_db.ts';

const SERVICE_KEY = 'service-role-key-for-tests';
const UNSUB_SECRET = 'unsubscribe-secret-for-tests-0123456789';
const CRON_SECRET = 'cron-secret-for-tests-0123456789';
const MEMBER = '11111111-1111-4111-8111-111111111111';
const STAFF = '22222222-2222-4222-8222-222222222222';
const COORD = '33333333-3333-4333-8333-333333333333';
const PENDING = '44444444-4444-4444-8444-444444444444';
const DELEGATE = '55555555-5555-4555-8555-555555555555';

const env = {
  resendApiKey: 're_test',
  fromEmail: 'BLW <no-reply@example.com>',
  unsubscribeSecret: UNSUB_SECRET,
  supabaseUrl: 'https://proj.supabase.co',
  appUrl: 'https://app.example.com',
};

function setup(seed: Record<string, Record<string, unknown>[]> = {}) {
  const admin = new FakeAdmin({ profiles: [], email_preferences: [], email_log: [], scheduled_emails: [], ...seed });
  const providerCalls: Array<{ url: string; body: any }> = [];
  const fetchImpl = (url: string, init?: RequestInit) => {
    providerCalls.push({ url, body: JSON.parse(String(init?.body)) });
    return Promise.resolve(new Response(JSON.stringify({ id: 'prov-1' }), { status: 200 }));
  };
  const authDeps = fakeAuthDeps({
    serviceRoleKey: SERVICE_KEY,
    tokens: { 'member-jwt': MEMBER, 'staff-jwt': STAFF, 'coord-jwt': COORD, 'pending-jwt': PENDING, 'delegate-jwt': DELEGATE },
    profiles: {
      [MEMBER]: { role: 'member', status: 'active' },
      [STAFF]: { role: 'admin', status: 'active' },
      [COORD]: { role: 'coordinator', status: 'active' },
      [PENDING]: { role: 'admin', status: 'pending' }, // even an "admin" role is useless while pending
      [DELEGATE]: { role: 'member', status: 'active' },
    },
    permissions: { [DELEGATE]: ['notifications.send'] },
  });
  const handler = createSendEmailHandler({ admin, env, serviceRoleKey: SERVICE_KEY, fetchImpl, authDeps });
  return { admin, handler, providerCalls };
}

function call(handler: (r: Request) => Promise<Response>, body: unknown, token?: string, rawBody?: string) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token !== undefined) headers.authorization = `Bearer ${token}`;
  return handler(new Request('https://f.example/send-email', { method: 'POST', headers, body: rawBody ?? JSON.stringify(body) }));
}

const SEND = { action: 'send', to: 'a@example.com', subject: 'Hi', html: '<p>Hello {{unsubscribe_url}}</p>' };

// ─── send-email: authentication / authorization ──────────────────────────────

Deno.test('send-email: unauthenticated caller is rejected (401) and nothing is sent or logged', async () => {
  const { handler, providerCalls, admin } = setup();
  const res = await handler(new Request('https://f.example', { method: 'POST', body: JSON.stringify(SEND) }));
  assert.equal(res.status, 401);
  assert.equal(providerCalls.length, 0);
  assert.equal(admin.rows('email_log').length, 0);
});

Deno.test('send-email: malformed / invalid / forged JWT is rejected (401)', async () => {
  const { handler, providerCalls } = setup();
  for (const token of ['garbage', 'a.b.c', 'eyJhbGciOiJub25lIn0.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.', '']) {
    const res = await call(handler, SEND, token);
    assert.equal(res.status, 401, `token ${JSON.stringify(token)}`);
  }
  // Non-bearer scheme
  const res = await handler(new Request('https://f.example', { method: 'POST', headers: { authorization: 'Basic abc' }, body: JSON.stringify(SEND) }));
  assert.equal(res.status, 401);
  assert.equal(providerCalls.length, 0);
});

Deno.test('send-email: ordinary member is rejected (403) for every privileged action', async () => {
  const { handler, providerCalls } = setup();
  const m = '66666666-6666-4666-8666-666666666666';
  for (const body of [
    SEND,
    { action: 'batch', recipients: [{ email: 'a@example.com' }], subject: 's' },
    { action: 'schedule', to: 'a@example.com', subject: 's', html: 'h', scheduledFor: '2030-01-01T00:00:00Z' },
    { action: 'resend', messageId: m },
  ]) {
    const res = await call(handler, body, 'member-jwt');
    assert.equal(res.status, 403, JSON.stringify(body));
  }
  assert.equal(providerCalls.length, 0);
});

Deno.test('send-email: a pending account is rejected even if its role says admin', async () => {
  const { handler, providerCalls } = setup();
  assert.equal((await call(handler, SEND, 'pending-jwt')).status, 403);
  assert.equal(providerCalls.length, 0);
});

Deno.test('send-email: role claimed in the request body is ignored', async () => {
  const { handler, providerCalls } = setup();
  const res = await call(handler, { ...SEND, role: 'coordinator', user: { role: 'admin' }, app_metadata: { role: 'admin' } }, 'member-jwt');
  assert.equal(res.status, 403);
  assert.equal(providerCalls.length, 0);
});

Deno.test('send-email: admin, coordinator, permission-delegate and service caller are allowed', async () => {
  for (const token of ['staff-jwt', 'coord-jwt', 'delegate-jwt', SERVICE_KEY]) {
    const { handler, providerCalls, admin } = setup();
    const res = await call(handler, SEND, token);
    assert.equal(res.status, 200, token);
    assert.equal(providerCalls.length, 1);
    assert.equal(admin.rows('email_log')[0].status, 'sent');
  }
});

Deno.test('send-email: service key is compared exactly (prefix/suffix do not match)', async () => {
  const { handler } = setup();
  assert.equal((await call(handler, SEND, SERVICE_KEY + 'x')).status, 401);
  assert.equal((await call(handler, SEND, SERVICE_KEY.slice(0, -1))).status, 401);
});

Deno.test('send-email: bad input is a 400, not a 500, and nothing is sent', async () => {
  const { handler, providerCalls } = setup();
  assert.equal((await call(handler, null, 'staff-jwt', '{not json')).status, 400);
  assert.equal((await call(handler, { action: 'send', to: 'not-an-email', subject: 's', html: 'h' }, 'staff-jwt')).status, 400);
  assert.equal((await call(handler, { ...SEND, subject: 'a\r\nBcc: x@y.z' }, 'staff-jwt')).status, 400);
  assert.equal((await call(handler, { action: 'nope' }, 'staff-jwt')).status, 400);
  assert.equal(providerCalls.length, 0);
});

Deno.test('send-email: ordinary member may only record an open', async () => {
  const id = '77777777-7777-4777-8777-777777777777';
  const { handler, admin } = setup({ email_log: [{ id, opened_at: null }] });
  const res = await call(handler, { action: 'track_open', messageId: id }, 'member-jwt');
  assert.equal(res.status, 200);
  assert.ok(admin.rows('email_log')[0].opened_at);
  assert.equal((await call(handler, { action: 'track_open', messageId: id })).status, 401);
});

// ─── send-email: preference suppression + signed unsubscribe link ────────────

Deno.test('send-email: embeds a server-signed unsubscribe link and List-Unsubscribe header', async () => {
  const { handler, providerCalls } = setup();
  const res = await call(handler, { ...SEND, memberId: MEMBER, templateType: 'weekly_digest' }, 'staff-jwt');
  // weekly_digest defaults to opted-out when no preference row exists -> suppressed, nothing sent
  assert.equal((await res.json()).suppressed, true);
  assert.equal(providerCalls.length, 0);

  const ok = setup({ email_preferences: [{ member_id: MEMBER, weekly_digest: true }] });
  await call(ok.handler, { ...SEND, memberId: MEMBER, templateType: 'weekly_digest' }, 'staff-jwt');
  assert.equal(ok.providerCalls.length, 1);
  const sent = ok.providerCalls[0].body;
  const url = /https:\/\/proj\.supabase\.co\/functions\/v1\/unsubscribe\?token=([^"<\s]+)/.exec(sent.html);
  assert.ok(url, 'signed unsubscribe URL present');
  const payload = await verifyUnsubscribeToken(decodeURIComponent(url![1]), UNSUB_SECRET);
  assert.deepEqual(payload, { memberId: MEMBER, notifType: 'weekly_digest' });
  assert.ok(sent.headers['List-Unsubscribe'].includes('/unsubscribe?token='));
  assert.ok(!sent.html.includes('{{unsubscribe_url}}'));
});

Deno.test('send-email: unsubscribe → future sends are suppressed and logged', async () => {
  const { handler, providerCalls, admin } = setup({ profiles: [{ id: MEMBER, email: 'a@example.com' }] });
  // 1. sends normally
  assert.equal((await (await call(handler, SEND, 'staff-jwt')).json()).suppressed, undefined);
  assert.equal(providerCalls.length, 1);
  // 2. member clicks the signed link
  const token = await signUnsubscribeToken({ memberId: MEMBER, notifType: 'generic' }, UNSUB_SECRET);
  const unsub = createUnsubscribeHandler({ admin, secret: UNSUB_SECRET });
  assert.equal((await unsub(new Request(`https://f.example/unsubscribe?token=${token}`))).status, 200);
  // 3. later sends (resolved by recipient email, as scheduled mail is) are suppressed
  const res = await call(handler, SEND, 'staff-jwt');
  assert.equal((await res.json()).suppressed, true);
  assert.equal(providerCalls.length, 1);
  assert.equal(admin.rows('email_log').at(-1)!.status, 'suppressed');
  // opt_out_all also suppresses
  admin.rows('email_preferences')[0].admin_announcements = true;
  admin.rows('email_preferences')[0].opt_out_all = true;
  assert.equal((await (await call(handler, SEND, 'staff-jwt')).json()).suppressed, true);
});

// ─── process-scheduled-emails: machine-to-machine secret ─────────────────────

function scheduled(seedRows = [{ id: 's1', recipient_email: 'a@example.com', subject: 'S', html_content: '<p>x</p>', scheduled_for: '2020-01-01T00:00:00Z', sent: false }], cronSecret: string | null = CRON_SECRET) {
  const admin = new FakeAdmin({ scheduled_emails: seedRows, email_log: [], profiles: [], email_preferences: [] });
  const calls: unknown[] = [];
  const fetchImpl = (_u: string, i?: RequestInit) => { calls.push(i?.body); return Promise.resolve(new Response(JSON.stringify({ id: 'p' }), { status: 200 })); };
  return { admin, calls, handler: createScheduledHandler({ admin, env, cronSecret: cronSecret ?? undefined, fetchImpl }) };
}
const cronReq = (headers: Record<string, string> = {}, method = 'POST') => new Request('https://f.example/process', { method, headers });

Deno.test('cron: missing secret header → 401, nothing processed', async () => {
  const { handler, calls, admin } = scheduled();
  assert.equal((await handler(cronReq())).status, 401);
  assert.equal(calls.length, 0);
  assert.equal(admin.rows('scheduled_emails')[0].sent, false);
});

Deno.test('cron: incorrect secret → 401; a user JWT / service key is not a substitute', async () => {
  const { handler, calls } = scheduled();
  assert.equal((await handler(cronReq({ 'x-cron-secret': 'wrong-secret-wrong-secret' }))).status, 401);
  assert.equal((await handler(cronReq({ authorization: `Bearer ${SERVICE_KEY}` }))).status, 401);
  assert.equal((await handler(cronReq({ authorization: 'Bearer member-jwt' }))).status, 401);
  assert.equal(calls.length, 0);
});

Deno.test('cron: correct secret → processes and sends due emails exactly once', async () => {
  const { handler, calls, admin } = scheduled();
  const res = await handler(cronReq({ 'x-cron-secret': CRON_SECRET }));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { processed: 1, sent: 1, failed: 0 });
  assert.equal(calls.length, 1);
  assert.equal(admin.rows('scheduled_emails')[0].sent, true);
  // second run: nothing left
  assert.deepEqual(await (await handler(cronReq({ 'x-cron-secret': CRON_SECRET }))).json(), { processed: 0, sent: 0, failed: 0 });
  assert.equal(calls.length, 1);
});

Deno.test('cron: future emails are not sent; failures release the claim for retry', async () => {
  const future = scheduled([{ id: 's2', recipient_email: 'a@example.com', subject: 'S', html_content: 'x', scheduled_for: '2999-01-01T00:00:00Z', sent: false }]);
  assert.equal((await (await future.handler(cronReq({ 'x-cron-secret': CRON_SECRET }))).json()).processed, 0);

  const admin = new FakeAdmin({ scheduled_emails: [{ id: 's3', recipient_email: 'a@example.com', subject: 'S', html_content: 'x', scheduled_for: '2020-01-01T00:00:00Z', sent: false }], email_log: [], profiles: [], email_preferences: [] });
  const failing = createScheduledHandler({ admin, env, cronSecret: CRON_SECRET, fetchImpl: () => Promise.resolve(new Response(JSON.stringify({ message: 'boom' }), { status: 500 })) });
  const out = await (await failing(cronReq({ 'x-cron-secret': CRON_SECRET }))).json();
  assert.equal(out.failed, 1);
  assert.equal(admin.rows('scheduled_emails')[0].sent, false);
});

Deno.test('cron: fails closed when CRON_SECRET is unset or weak; GET is refused', async () => {
  for (const secret of [null, '', 'short']) {
    const { handler, calls } = scheduled(undefined, secret);
    assert.equal((await handler(cronReq({ 'x-cron-secret': secret ?? '' }))).status, 503);
    assert.equal(calls.length, 0);
  }
  const { handler } = scheduled();
  assert.equal((await handler(cronReq({ 'x-cron-secret': CRON_SECRET }, 'GET'))).status, 405);
  assert.equal(await checkCronSecret(cronReq({ 'x-cron-secret': CRON_SECRET }), CRON_SECRET), 'ok');
});

// ─── unsubscribe tokens ──────────────────────────────────────────────────────

Deno.test('unsubscribe token: round-trips and is bound to member + type', async () => {
  const t = await signUnsubscribeToken({ memberId: MEMBER, notifType: 'meeting_reminder_1hr' }, UNSUB_SECRET);
  assert.match(t, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.deepEqual(await verifyUnsubscribeToken(t, UNSUB_SECRET), { memberId: MEMBER, notifType: 'meeting_reminder_1hr' });
  assert.equal(await verifyUnsubscribeToken(t, 'another-secret-another-secret-xx'), null);
  assert.equal(await verifyUnsubscribeToken(t, ''), null);
});

Deno.test('unsubscribe token: legacy unsigned base64 JSON, malformed, tampered payload and tampered signature are rejected', async () => {
  const legacy = btoa(JSON.stringify({ memberId: MEMBER, notifType: 'generic', ts: Date.now() }));
  const valid = await signUnsubscribeToken({ memberId: MEMBER, notifType: 'generic' }, UNSUB_SECRET);
  const [body, sig] = valid.split('.');
  const otherBody = toBase64Url(new TextEncoder().encode(JSON.stringify({ m: '99999999-9999-4999-8999-999999999999', t: 'generic', v: 1 })));
  const flipped = sig.slice(0, -1) + (sig.endsWith('A') ? 'B' : 'A');
  for (const bad of [legacy, '', '.', 'a.b', 'a.b.c', `${body}.`, `.${sig}`, `${otherBody}.${sig}`, `${body}.${flipped}`, `${body}.${sig}extra`, 'x'.repeat(5000)]) {
    assert.equal(await verifyUnsubscribeToken(bad, UNSUB_SECRET), null, bad.slice(0, 40));
  }
});

Deno.test('unsubscribe endpoint: tampered token changes nothing; valid token updates only the signed member/type', async () => {
  const admin = new FakeAdmin({ email_preferences: [] });
  const h = createUnsubscribeHandler({ admin, secret: UNSUB_SECRET });
  const valid = await signUnsubscribeToken({ memberId: MEMBER, notifType: 'habit_milestone' }, UNSUB_SECRET);
  const legacy = btoa(JSON.stringify({ memberId: STAFF, notifType: 'generic' }));
  const [body, sig] = valid.split('.');

  for (const t of [legacy, `${body}.AAAA`, `${body.slice(0, -2)}xx.${sig}`, '']) {
    const res = await h(new Request(`https://f.example/unsubscribe?token=${encodeURIComponent(t)}`));
    assert.equal(res.status, 400);
  }
  assert.equal(admin.rows('email_preferences').length, 0);

  // `type` query parameter must not override the signed notification type
  const res = await h(new Request(`https://f.example/unsubscribe?token=${valid}&type=generic`));
  assert.equal(res.status, 200);
  assert.deepEqual(admin.rows('email_preferences').map((r) => ({ ...r, id: undefined })), [{ id: undefined, member_id: MEMBER, habit_milestones: false }]);
  assert.match(await res.text(), /habit milestones/);

  // one-click POST (RFC 8058)
  const post = await h(new Request(`https://f.example/unsubscribe?token=${valid}`, { method: 'POST' }));
  assert.equal(post.status, 200);
});

Deno.test('unsubscribe endpoint: redirects to the app when PUBLIC_APP_URL is set; escapes output', async () => {
  const admin = new FakeAdmin({ email_preferences: [] });
  const h = createUnsubscribeHandler({ admin, secret: UNSUB_SECRET, appUrl: 'https://app.example.com/' });
  const t = await signUnsubscribeToken({ memberId: MEMBER, notifType: 'generic' }, UNSUB_SECRET);
  const res = await h(new Request(`https://f.example/unsubscribe?token=${t}`));
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), 'https://app.example.com/email-preferences?unsubscribed=admin_announcements');
  const bad = await createUnsubscribeHandler({ admin, secret: UNSUB_SECRET })(new Request('https://f.example/unsubscribe?token=%3Cscript%3E'));
  assert.ok(!(await bad.text()).includes('<script>'));
});
