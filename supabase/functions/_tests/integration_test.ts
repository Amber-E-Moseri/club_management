// Real-stack tests for the email workflow: real GoTrue-issued JWTs, real Postgres/RLS, real tables.
// Handlers run in-process; only the outbound email provider (fetch) is stubbed.
// Run: SUPABASE_URL=… SUPABASE_ANON_KEY=… SUPABASE_SERVICE_ROLE_KEY=… deno test --allow-net --allow-env supabase/functions/_tests/integration_test.ts
// deno-lint-ignore-file no-explicit-any
import assert from 'node:assert/strict';
import { createClient } from 'npm:@supabase/supabase-js@^2.45.0';
import { createSendEmailHandler } from '../send-email/handler.ts';
import { createScheduledHandler } from '../process-scheduled-emails/handler.ts';
import { createUnsubscribeHandler } from '../unsubscribe/handler.ts';
import { signUnsubscribeToken } from '../_shared/unsubscribe-token.ts';
import { toBase64Url, hmacSha256 } from '../_shared/crypto.ts';

const URL_ = Deno.env.get('SUPABASE_URL');
const ANON = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const configured = !!URL_ && !!ANON && !!SERVICE;
if (!configured && Deno.env.get('REQUIRE_INTEGRATION') === '1') throw new Error('integration env not configured');

const UNSUB_SECRET = 'integration-unsubscribe-secret-0123456789';
const CRON_SECRET = 'integration-cron-secret-0123456789';
const env = { resendApiKey: 're_test', fromEmail: 'BLW <no-reply@example.com>', unsubscribeSecret: UNSUB_SECRET, supabaseUrl: URL_ ?? '', appUrl: 'https://app.example.com' };
const run = crypto.randomUUID().slice(0, 8);

Deno.test({ name: 'email workflow against a real database', ignore: !configured, sanitizeOps: false, sanitizeResources: false, fn: async (t) => {
  const admin: any = createClient(URL_!, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

  async function user(label: string, role: string, status = 'active') {
    const email = `${label}.${run}@test.invalid`;
    const anon = createClient(URL_!, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await anon.auth.signUp({ email, password: 'Password-123!', options: { data: { full_name: label, role: 'coordinator' } } });
    assert.ok(!error && data.session, `signup ${label}: ${error?.message}`);
    await admin.from('profiles').update({ role, status }).eq('id', data.user!.id);
    return { id: data.user!.id, email, token: data.session!.access_token };
  }
  const sent: any[] = [];
  const fetchImpl = (_u: string, init?: RequestInit) => { sent.push(JSON.parse(String(init?.body))); return Promise.resolve(new Response(JSON.stringify({ id: 'p-' + sent.length }), { status: 200 })); };
  const handler = createSendEmailHandler({ admin, env, serviceRoleKey: SERVICE, fetchImpl });
  const send = (body: unknown, token?: string) => handler(new Request('https://f.example/send-email', {
    method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) }));

  const member = await user('member', 'member');
  const staff = await user('staff', 'admin');
  const coord = await user('coord', 'coordinator');
  const pendingAdmin = await user('pendingadmin', 'admin', 'pending');
  const recipient = await user('recipient', 'member');
  const body = { action: 'send', to: recipient.email, subject: 'Hello', html: '<p>Hi <a href="{{unsubscribe_url}}">unsubscribe</a></p>', templateType: 'generic' };

  await t.step('unauthenticated, garbage and forged JWTs are rejected by the real auth server', async () => {
    assert.equal((await send(body)).status, 401);
    assert.equal((await send(body, 'not-a-jwt')).status, 401);
    // structurally valid, correctly-shaped JWT claiming service_role but signed with the WRONG secret
    const head = toBase64Url(new TextEncoder().encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
    const claims = toBase64Url(new TextEncoder().encode(JSON.stringify({ role: 'service_role', sub: staff.id, aud: 'authenticated', exp: 2000000000 })));
    const forged = `${head}.${claims}.${toBase64Url(await hmacSha256(`${head}.${claims}`, 'attacker-secret-attacker-secret-0000'))}`;
    assert.equal((await send(body, forged)).status, 401);
    assert.equal(sent.length, 0);
  });

  await t.step('member and pending-admin are rejected; the body cannot grant a role', async () => {
    assert.equal((await send(body, member.token)).status, 403);
    assert.equal((await send({ ...body, role: 'admin' }, member.token)).status, 403);
    assert.equal((await send(body, pendingAdmin.token)).status, 403);
    assert.equal(sent.length, 0);
  });

  await t.step('admin and coordinator are allowed; send is logged', async () => {
    for (const u of [staff, coord]) {
      const res = await send(body, u.token);
      assert.equal(res.status, 200, await res.clone().text());
    }
    assert.equal(sent.length, 2);
    const { data } = await admin.from('email_log').select('status,member_id').eq('recipient_email', recipient.email);
    assert.equal(data.length, 2);
    assert.ok(data.every((r: any) => r.status === 'sent' && r.member_id === recipient.id), 'log row resolved to the member');
    const link = /functions\/v1\/unsubscribe\?token=/.test(sent[0].html);
    assert.ok(link, 'signed unsubscribe link injected');
  });

  await t.step('notifications.send delegate (admin_role tables) is allowed, plain member is not', async () => {
    const delegate = await user('delegate', 'member');
    assert.equal((await send(body, delegate.token)).status, 403);
    const { data: role } = await admin.from('admin_roles').insert({ name: `mailers-${run}`, created_by: coord.id }).select('id').single();
    await admin.from('admin_role_permissions').insert({ role_id: role.id, permission_key: 'notifications.send' });
    await admin.from('admin_role_assignments').insert({ role_id: role.id, user_id: delegate.id, assigned_by: coord.id });
    assert.equal((await send(body, delegate.token)).status, 200);
  });

  await t.step('unsubscribe link -> preference stored -> future sends suppressed and logged', async () => {
    const before = sent.length;
    const token = await signUnsubscribeToken({ memberId: recipient.id, notifType: 'generic' }, UNSUB_SECRET);
    const unsub = createUnsubscribeHandler({ admin, secret: UNSUB_SECRET });
    const res = await unsub(new Request(`${URL_}/functions/v1/unsubscribe?token=${token}`));
    assert.equal(res.status, 200);
    const { data: pref } = await admin.from('email_preferences').select('admin_announcements,weekly_digest').eq('member_id', recipient.id).single();
    assert.equal(pref.admin_announcements, false);
    const out = await (await send(body, staff.token)).json();
    assert.equal(out.suppressed, true);
    assert.equal(sent.length, before, 'provider not called for an opted-out member');
    const { data: logs } = await admin.from('email_log').select('status').eq('recipient_email', recipient.email).eq('status', 'suppressed');
    assert.equal(logs.length, 1);
    // tampered token cannot unsubscribe somebody else
    const victim = await user('victim', 'member');
    const evil = (await signUnsubscribeToken({ memberId: victim.id, notifType: 'generic' }, 'another-secret-another-secret-xx'));
    assert.equal((await unsub(new Request(`${URL_}/functions/v1/unsubscribe?token=${evil}`))).status, 400);
    assert.equal((await admin.from('email_preferences').select('id').eq('member_id', victim.id)).data.length, 0);
  });

  await t.step('scheduled email: only the cron secret can run it; due mail is sent once, opted-out mail is suppressed', async () => {
    const other = await user('sched', 'member');
    const due = { subject: 'Scheduled', html_content: '<p>x</p>', scheduled_for: '2020-01-01T00:00:00Z' };
    await admin.from('scheduled_emails').insert([{ recipient_email: other.email, ...due }, { recipient_email: recipient.email, ...due }]);
    const cron = createScheduledHandler({ admin, env, cronSecret: CRON_SECRET, fetchImpl });
    const call = (headers: Record<string, string>) => cron(new Request('https://f.example/process', { method: 'POST', headers }));
    const before = sent.length;
    assert.equal((await call({})).status, 401);
    assert.equal((await call({ authorization: `Bearer ${staff.token}` })).status, 401);
    assert.equal((await call({ 'x-cron-secret': 'wrong-wrong-wrong-wrong' })).status, 401);
    assert.equal(sent.length, before);
    const res = await call({ 'x-cron-secret': CRON_SECRET });
    assert.equal(res.status, 200);
    const result = await res.json();
    assert.ok(result.processed >= 2 && result.failed === 0, JSON.stringify(result));
    assert.equal(sent.length, before + 1, 'only the non-opted-out recipient got mail');
    assert.equal((await (await call({ 'x-cron-secret': CRON_SECRET })).json()).processed, 0, 'second run is a no-op');
    const { data: left } = await admin.from('scheduled_emails').select('id').eq('sent', false).lte('scheduled_for', new Date().toISOString());
    assert.equal(left.length, 0);
  });

  await t.step('resend of a failed email: staff only, and it is marked sent', async () => {
    const failing = createSendEmailHandler({ admin, env, serviceRoleKey: SERVICE, fetchImpl: () => Promise.resolve(new Response(JSON.stringify({ message: 'boom' }), { status: 500 })) });
    const other = await user('retry', 'member');
    const r = await failing(new Request('https://f.example', { method: 'POST', headers: { authorization: `Bearer ${staff.token}` }, body: JSON.stringify({ ...body, to: other.email }) }));
    assert.equal(r.status, 502);
    const { data: fail } = await admin.from('email_log').select('id,status,failed_reason').eq('recipient_email', other.email).single();
    assert.equal(fail.status, 'failed');
    assert.equal((await send({ action: 'resend', messageId: fail.id }, member.token)).status, 403);
    assert.equal((await send({ action: 'resend', messageId: fail.id }, staff.token)).status, 200);
    assert.equal((await admin.from('email_log').select('status').eq('id', fail.id).single()).data.status, 'sent');
  });
} });
