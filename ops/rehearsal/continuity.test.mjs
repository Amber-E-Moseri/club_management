// Upgrade-continuity checks, run AFTER migrations 009+010 were applied to a copy/rehearsal of the
// PRE-FIX production state (built by ops/rehearsal/build-legacy.sh).  Uses the pre-existing users' real passwords.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { client, service, AUTH_URL, ANON_KEY, isBlocked } from '../../tests/security/helpers.mjs';

const PW = 'Legacy-Pass-123!';
async function login(email, password = PW) {
  const r = await fetch(`${AUTH_URL}/token?grant_type=password`, { method: 'POST', headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  const b = await r.json();
  assert.ok(b.access_token, `login ${email}: ${JSON.stringify(b).slice(0, 80)}`);
  return { id: b.user.id, db: client(b.access_token) };
}
const L = (n) => `legacy.${n}@test.invalid`;

test('pre-existing users can still log in and keep their roles/status', async () => {
  const rows = (await service.get('profiles?select=email,role,status&email=like.legacy.*')).data;
  const by = Object.fromEntries(rows.map((r) => [r.email.split('@')[0].replace('legacy.', ''), `${r.role}/${r.status}`]));
  assert.deepEqual(by, { coord: 'coordinator/active', admin: 'admin/active', leader1: 'cell_leader/active', leader2: 'cell_leader/active',
    member1: 'member/active', member2: 'member/active', member3: 'member/active', member4: 'member/active', pending: 'member/pending' });
  for (const n of ['coord', 'admin', 'leader1', 'member1', 'pending']) await login(L(n));
});

test('existing organisational data is visible to the right people', async () => {
  const m1 = await login(L('member1')), l1 = await login(L('leader1')), l2 = await login(L('leader2')), coord = await login(L('coord'));
  assert.ok((await m1.db.get('events')).data.length >= 1);
  assert.ok((await m1.db.get('announcements')).data.length >= 1);
  assert.ok((await m1.db.get('meetings')).data.some((m) => m.title === 'Sunday Service'));
  assert.ok(!(await m1.db.get('meetings')).data.some((m) => m.title === 'Leaders Sync'), 'leaders-only meeting hidden from member');
  const c1 = (await l1.db.get('contacts')).data.map((c) => c.contact_name).sort();
  assert.deepEqual(c1, ['Visitor One', 'Visitor Two']);
  assert.deepEqual((await l2.db.get('contacts')).data.map((c) => c.contact_name), ['Visitor Three']);
  assert.equal((await coord.db.get('contacts')).data.length, 3);
  assert.ok(isBlocked(await m1.db.get('contacts')));
});

test('email preferences survive and stay private', async () => {
  const m1 = await login(L('member1')), m2 = await login(L('member2'));
  const mine = (await m1.db.get('email_preferences')).data;
  assert.equal(mine.length, 1);
  assert.equal(mine[0].weekly_digest, true);
  assert.equal((await m2.db.get('email_preferences')).data[0].opt_out_all, true);
  assert.equal((await service.get('email_preferences')).data.length, 3);
  assert.equal((await service.get('email_log')).data.length, 2);
  assert.equal((await service.get('scheduled_emails')).data.length, 1);
});

test('testimony visibility: private stays private, pending hidden, approved shared', async () => {
  const m1 = await login(L('member1')), m3 = await login(L('member3'));
  const seen = (await m1.db.get('testimonies')).data.map((t) => t.title).sort();
  assert.deepEqual(seen, ['Healed']);
  assert.deepEqual((await m3.db.get('testimonies')).data.map((t) => t.title).sort(), ['Healed', 'Private note']);
});

test('legacy permission delegate (notifications.send) and attendance data kept', async () => {
  const rows = (await service.get('admin_role_assignments?select=user_id,admin_roles(name)')).data;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].admin_roles.name, 'Mail sender');
  const l1 = await login(L('leader1'));
  assert.equal((await l1.db.get('meeting_attendances')).data.length, 2);
});

test('approval works: legacy coordinator approves the legacy pending user; a leader cannot escalate', async () => {
  const pend = await login(L('pending')), coord = await login(L('coord')), l1 = await login(L('leader1'));
  assert.ok(isBlocked(await pend.db.get('events')), 'pending user is blocked from org data');
  assert.ok(isBlocked(await pend.db.patch(`profiles?id=eq.${pend.id}`, { status: 'active' })));
  assert.equal((await service.get(`profiles?id=eq.${pend.id}`)).data[0].status, 'pending');
  assert.equal((await coord.db.patch(`profiles?id=eq.${pend.id}`, { status: 'active' })).status, 200);
  assert.ok((await pend.db.get('events')).data.length >= 1, 'approved user now sees events');
  assert.equal((await l1.db.patch(`profiles?id=eq.${pend.id}`, { role: 'coordinator' })).status, 403);
});

test('members cannot promote themselves or touch staff operations (previously possible)', async () => {
  const m1 = await login(L('member1'));
  for (const patch of [{ role: 'coordinator' }, { status: 'pending' }, { cell_id: null }]) {
    assert.ok(!(await m1.db.patch(`profiles?id=eq.${m1.id}`, patch)).ok || false, JSON.stringify(patch));
  }
  assert.ok(!(await m1.db.post('books_of_month', { title: 'x', author: 'y', drive_url: 'u', active_from: '2030-01-01', active_until: '2030-02-01' })).ok);
  assert.equal((await service.get(`profiles?id=eq.${m1.id}`)).data[0].role, 'member');
});

test('KNOWN RESIDUAL: seeder-style accounts keep their privileges until removed (cleanup step in the plan)', async () => {
  const bad = (await service.get('profiles?select=email,role,status&email=like.owner*testcoord*')).data;
  assert.equal(bad[0].role, 'coordinator', 'migration does NOT demote them; the deployment plan must');
  // and they can log in with the known password
  await login('owner+testcoord@test.invalid', 'Test1234!');
});
