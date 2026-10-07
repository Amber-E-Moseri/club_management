import { createHmac } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const functionsUrl = process.env.SUPABASE_FUNCTIONS_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !functionsUrl || !anonKey || !serviceRoleKey) {
  throw new Error('SUPABASE_URL, SUPABASE_FUNCTIONS_URL, SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY are required');
}

const anon = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
const users = [];
const results = [];

function pass(check, evidence) {
  results.push({ check, result: 'PASS', evidence });
}

function fail(check, evidence) {
  results.push({ check, result: 'FAIL', evidence });
}

async function createUser(label, role = 'member') {
  const email = `cert.edge.${label}.${Date.now()}@example.test`;
  const password = 'CertPassword123!';
  const signUp = await anon.auth.signUp({ email, password, options: { data: { full_name: `Cert ${label}` } } });
  const login = await anon.auth.signInWithPassword({ email, password });
  const userId = login.data.user?.id ?? signUp.data.user?.id;
  if (!userId || !login.data.session) throw new Error(`Could not create/login ${label}: ${signUp.error?.message ?? login.error?.message}`);
  users.push(userId);
  await admin.from('profiles').update({ role, status: 'active' }).eq('id', userId);
  return { id: userId, token: login.data.session.access_token };
}

async function grantNotificationPermission(userId) {
  const roleName = `Cert Edge Role ${Date.now()}`;
  const { data: role, error: roleError } = await admin
    .from('admin_roles')
    .insert({ name: roleName, description: 'local edge certification', created_by: userId })
    .select('id')
    .single();
  if (roleError) throw roleError;
  await admin.from('admin_role_permissions').insert({ role_id: role.id, permission_key: 'notifications.send' });
  await admin.from('admin_role_assignments').insert({ role_id: role.id, user_id: userId, assigned_by: userId });
}

async function callFunction(path, { token, body, headers = {}, method = 'POST' } = {}) {
  const response = await fetch(`${functionsUrl}/${path}`, {
    method,
    headers: {
      apikey: anonKey,
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try {
    json = await response.json();
  } catch {
    // Some denial paths return an empty or HTML body.
  }
  return { status: response.status, json };
}

try {
  const member = await createUser('member', 'member');
  const leader = await createUser('leader', 'cell_leader');
  const adminUser = await createUser('admin', 'admin');
  const custom = await createUser('custom', 'member');
  await grantNotificationPermission(custom.id);

  const sendBody = { action: 'send', to: 'nobody@example.test', subject: 'Cert', html: '<p>Cert</p>' };

  const anonymous = await callFunction('send-email', { body: sendBody });
  if (anonymous.status === 401) pass('send-email anonymous denied', `HTTP ${anonymous.status}`);
  else fail('send-email anonymous denied', `HTTP ${anonymous.status}`);

  const memberSend = await callFunction('send-email', { token: member.token, body: sendBody });
  if (memberSend.status === 403) pass('send-email ordinary member denied', `HTTP ${memberSend.status}`);
  else fail('send-email ordinary member denied', `HTTP ${memberSend.status}`);

  const leaderSend = await callFunction('send-email', { token: leader.token, body: sendBody });
  if (leaderSend.status === 403) pass('send-email cell leader without permission denied', `HTTP ${leaderSend.status}`);
  else fail('send-email cell leader without permission denied', `HTTP ${leaderSend.status}`);

  const adminSend = await callFunction('send-email', { token: adminUser.token, body: sendBody });
  if (adminSend.status === 500 && /EMAIL_PROVIDER_NOT_CONFIGURED/.test(adminSend.json?.error ?? '')) {
    pass('send-email admin authorization allowed before provider failure', 'authorization passed; provider intentionally unconfigured');
  } else {
    fail('send-email admin authorization allowed before provider failure', `HTTP ${adminSend.status} ${JSON.stringify(adminSend.json)}`);
  }

  const customSend = await callFunction('send-email', { token: custom.token, body: sendBody });
  if (customSend.status === 500 && /EMAIL_PROVIDER_NOT_CONFIGURED/.test(customSend.json?.error ?? '')) {
    pass('send-email custom notifications permission allowed', 'authorization passed; provider intentionally unconfigured');
  } else {
    fail('send-email custom notifications permission allowed', `HTTP ${customSend.status} ${JSON.stringify(customSend.json)}`);
  }

  const noCron = await callFunction('process-scheduled-emails', { body: {}, headers: { Authorization: `Bearer ${anonKey}` } });
  if (noCron.status === 401) pass('process-scheduled-emails no secret denied', `HTTP ${noCron.status}`);
  else fail('process-scheduled-emails no secret denied', `HTTP ${noCron.status}`);

  const wrongCron = await callFunction('process-scheduled-emails', { body: {}, headers: { Authorization: `Bearer ${anonKey}`, 'x-cron-secret': 'wrong-local-secret' } });
  if (wrongCron.status === 401) pass('process-scheduled-emails wrong secret denied', `HTTP ${wrongCron.status}`);
  else fail('process-scheduled-emails wrong secret denied', `HTTP ${wrongCron.status}`);

  const badUnsubscribe = await fetch(`${functionsUrl}/unsubscribe?token=malformed`, { headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` } });
  if (badUnsubscribe.status === 400) pass('unsubscribe malformed token denied', `HTTP ${badUnsubscribe.status}`);
  else fail('unsubscribe malformed token denied', `HTTP ${badUnsubscribe.status}`);

  // Positive paths need the same throwaway secrets the local edge runtime was started with.
  const cronSecret = process.env.CERT_CRON_SECRET;
  const unsubscribeSecret = process.env.CERT_UNSUBSCRIBE_SECRET;
  if (!cronSecret || !unsubscribeSecret) {
    fail('positive-path secrets provided', 'CERT_CRON_SECRET and CERT_UNSUBSCRIBE_SECRET are required');
  } else {
    const rightCron = await callFunction('process-scheduled-emails', { body: {}, headers: { Authorization: `Bearer ${anonKey}`, 'x-cron-secret': cronSecret } });
    if (rightCron.status === 200 && typeof rightCron.json?.processed === 'number') {
      pass('process-scheduled-emails correct secret reaches execution', `HTTP 200 processed=${rightCron.json.processed}`);
    } else {
      fail('process-scheduled-emails correct secret reaches execution', `HTTP ${rightCron.status} ${JSON.stringify(rightCron.json)}`);
    }

    const signToken = (payload, secret) => {
      const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
      const signature = createHmac('sha256', secret).update(encoded).digest('hex');
      return `${encoded}.${signature}`;
    };
    const unsubscribe = async (token) => fetch(`${functionsUrl}/unsubscribe?token=${encodeURIComponent(token)}`, { headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` } });
    const exp = Math.floor(Date.now() / 1000) + 600;

    const forged = await unsubscribe(signToken({ memberId: member.id, notifType: 'weekly_digest', exp }, 'not-the-real-secret'));
    if (forged.status === 400) pass('unsubscribe forged signature denied', `HTTP ${forged.status}`);
    else fail('unsubscribe forged signature denied', `HTTP ${forged.status}`);

    const expired = await unsubscribe(signToken({ memberId: member.id, notifType: 'weekly_digest', exp: Math.floor(Date.now() / 1000) - 60 }, unsubscribeSecret));
    if (expired.status === 400) pass('unsubscribe expired signed token denied', `HTTP ${expired.status}`);
    else fail('unsubscribe expired signed token denied', `HTTP ${expired.status}`);

    const valid = await unsubscribe(signToken({ memberId: member.id, notifType: 'weekly_digest', exp }, unsubscribeSecret));
    const { data: pref } = await admin.from('email_preferences').select('weekly_digest').eq('member_id', member.id).maybeSingle();
    if (valid.status === 200 && pref?.weekly_digest === false) pass('unsubscribe valid signed token allowed', 'HTTP 200; preference persisted as false');
    else fail('unsubscribe valid signed token allowed', `HTTP ${valid.status}; weekly_digest=${pref?.weekly_digest}`);
  }
} finally {
  for (const id of users) {
    await admin.auth.admin.deleteUser(id);
  }
}

for (const row of results) {
  console.log(`${row.result}\t${row.check}\t${row.evidence}`);
}

const failures = results.filter((row) => row.result !== 'PASS');
if (failures.length > 0) {
  process.exitCode = 1;
}
