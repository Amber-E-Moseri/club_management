// Authorization tests against a real database via PostgREST. Every test exercises the API directly,
// i.e. what an attacker with a valid or missing JWT can do — not what the UI chooses to show.
import { test, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { anon, client, service, signUp, makeUser, makeCell, grantPermission, isBlocked, isDenied, tag, AUTH_URL, ANON_KEY } from './helpers.mjs';

let coord, admin, leaderA, leaderB, memberA, memberB, cellA, cellB;
let pending;

before(async () => {
  coord = await makeUser('coord', { role: 'coordinator' });
  admin = await makeUser('admin', { role: 'admin' });
  leaderA = await makeUser('leaderA', { role: 'cell_leader' });
  leaderB = await makeUser('leaderB', { role: 'cell_leader' });
  cellA = await makeCell('A', leaderA.id);
  cellB = await makeCell('B', leaderB.id);
  memberA = await makeUser('memberA', { cell_id: cellA.id });
  memberB = await makeUser('memberB', { cell_id: cellB.id });
  pending = await signUp('pending');
  pending.db = client(pending.token);
});

// ─── Anonymous ───────────────────────────────────────────────────────────────

describe('anonymous', () => {
  test('cannot read or write any application table', async () => {
    // seed something readable-by-members in the tables that used to leak to anon
    await service.post('announcements', { title: 'a', body: 'b', author_id: coord.id, author_name: 'c' });
    await service.post('books_of_month', { title: 't', author: 'a', drive_url: 'https://x', active_from: '2020-01-01', active_until: '2099-01-01' });
    await service.post('weekly_messages', { created_by: coord.id, author_name: 'c', scope: 'org', title: 't', body: 'b', week_start: '2020-01-01', week_end: '2020-01-07' });
    await service.post('testimonies', { author_id: coord.id, author_name: 'c', title: 't', body: 'public testimony body', visibility: 'public', status: 'approved' });
    const tables = (await service.get('')).data; // PostgREST OpenAPI root is under service role: list via definitions
    const names = Object.keys(tables.definitions ?? {});
    assert.ok(names.length >= 35, `expected the full schema to be exposed to service role, saw ${names.length}`);
    for (const t of names) {
      const r = await anon.get(`${t}?limit=1`);
      assert.ok(isBlocked(r), `anon SELECT ${t} -> ${r.status} ${JSON.stringify(r.data).slice(0, 80)}`);
      const w = await anon.post(t, {});
      assert.ok(!w.ok, `anon INSERT ${t} -> ${w.status}`);
    }
  });
});

// ─── Sign-up and approval ────────────────────────────────────────────────────

describe('sign-up and approval', () => {
  test('client-supplied role/status metadata is ignored: new accounts are member + pending', async () => {
    const evil = await signUp('evil', { full_name: 'Evil', role: 'coordinator', status: 'active', admin_role: 'x' });
    const row = (await service.get(`profiles?id=eq.${evil.id}`)).data[0];
    assert.equal(row.role, 'member');
    assert.equal(row.status, 'pending');
    assert.equal(row.admin_role, null);
  });

  test('sign-up without a full_name is pending too (no "active by omission" path)', async () => {
    const u = await signUp('noname', {});
    assert.equal((await service.get(`profiles?id=eq.${u.id}`)).data[0].status, 'pending');
  });

  test('pending user sees only their own profile and no organisational data', async () => {
    const profiles = await pending.db.get('profiles');
    assert.equal(profiles.status, 200);
    assert.deepEqual(profiles.data.map((p) => p.id), [pending.id]);
    for (const t of ['cells', 'announcements', 'events', 'meetings', 'books_of_month', 'contacts', 'testimonies', 'weekly_messages', 'habit_templates', 'confessions', 'monthly_devotionals', 'admin_roles']) {
      const r = await pending.db.get(`${t}?limit=5`);
      assert.ok(isBlocked(r), `pending SELECT ${t} -> ${r.status} ${JSON.stringify(r.data).slice(0, 60)}`);
    }
  });

  test('pending user cannot write data', async () => {
    assert.ok(!(await pending.db.post('announcements', { title: 'x', body: 'y', author_id: pending.id, author_name: 'p' })).ok);
    assert.ok(!(await pending.db.post('prayer_requests', { content: 'x', author_id: pending.id, author_name: 'p' })).ok);
    assert.ok(!(await pending.db.post('events', { title: 'x', date: '2030-01-01', created_by: pending.id })).ok);
  });

  test('pending user cannot approve themselves or escalate (direct PostgREST PATCH)', async () => {
    for (const patch of [{ status: 'active' }, { role: 'coordinator' }, { status: 'active', role: 'admin' }]) {
      const r = await pending.db.patch(`profiles?id=eq.${pending.id}`, patch);
      assert.ok(isBlocked(r), `patch ${JSON.stringify(patch)} -> ${r.status}`);
    }
    const row = (await service.get(`profiles?id=eq.${pending.id}`)).data[0];
    assert.equal(row.status, 'pending');
    assert.equal(row.role, 'member');
  });

  test('pending user cannot insert/delete profiles', async () => {
    assert.ok(!(await pending.db.post('profiles', { id: pending.id, email: 'x@y.z', role: 'coordinator', status: 'active' })).ok);
    const d = await pending.db.del(`profiles?id=eq.${memberA.id}`);
    assert.ok(isBlocked(d));
  });

  test('approval by coordinator grants member access immediately; rejection revokes it', async () => {
    const u = await signUp('toapprove');
    const db = client(u.token);
    assert.ok(isBlocked(await db.get('events')));
    const ok = await coord.db.patch(`profiles?id=eq.${u.id}`, { status: 'active' });
    assert.equal(ok.status, 200);
    assert.equal(ok.data[0].status, 'active');
    assert.equal((await db.get('events')).status, 200);
    assert.ok(isBlocked(await db.get('contacts')), 'approved member still has no staff data');
    await coord.db.patch(`profiles?id=eq.${u.id}`, { status: 'rejected' });
    assert.ok(isBlocked(await db.get('events')));
  });

  test('a cell leader can approve a member but not a coordinator/admin, nor themselves', async () => {
    const m = await signUp('leaderapproves');
    assert.equal((await leaderA.db.patch(`profiles?id=eq.${m.id}`, { status: 'active' })).status, 200);
    const adminTarget = await makeUser('adm2', { role: 'admin', status: 'pending' });
    const r = await leaderA.db.patch(`profiles?id=eq.${adminTarget.id}`, { status: 'active' });
    assert.equal(r.status, 403);
    const self = await makeUser('ldr3', { role: 'cell_leader' });
    await service.patch(`profiles?id=eq.${self.id}`, { status: 'pending' });
    assert.ok(isBlocked(await self.db.patch(`profiles?id=eq.${self.id}`, { status: 'active' })));
  });

  test('cell leader cannot change roles; admin cannot change roles; only coordinator can', async () => {
    for (const actor of [leaderA, admin]) {
      const r = await actor.db.patch(`profiles?id=eq.${memberA.id}`, { role: 'admin' });
      assert.equal(r.status, 403, `${actor.email} role change`);
    }
    const bump = await makeUser('bump');
    const ok = await coord.db.patch(`profiles?id=eq.${bump.id}`, { role: 'cell_leader' });
    assert.equal(ok.status, 200);
    assert.equal(ok.data[0].role, 'cell_leader');
  });
});

// ─── Active member: own profile ──────────────────────────────────────────────

describe('active member profile boundaries', () => {
  test('member can edit their own name but not role/status/cell/email/id', async () => {
    assert.equal((await memberA.db.patch(`profiles?id=eq.${memberA.id}`, { full_name: 'Renamed' })).status, 200);
    for (const patch of [{ role: 'coordinator' }, { role: 'admin' }, { admin_role: 'x' }, { cell_id: cellB.id }, { status: 'rejected' }, { email: 'new@x.y' }, { joined_at: '2000-01-01T00:00:00Z' }]) {
      const r = await memberA.db.patch(`profiles?id=eq.${memberA.id}`, patch);
      assert.ok(isDenied(r), `patch ${JSON.stringify(patch)} -> ${r.status}`);
    }
    const row = (await service.get(`profiles?id=eq.${memberA.id}`)).data[0];
    assert.equal(row.role, 'member');
    assert.equal(row.cell_id, cellA.id);
  });

  test("member cannot edit another member's profile", async () => {
    assert.ok(isBlocked(await memberA.db.patch(`profiles?id=eq.${memberB.id}`, { full_name: 'hacked' })));
    assert.notEqual((await service.get(`profiles?id=eq.${memberB.id}`)).data[0].full_name, 'hacked');
  });

  test('changing user_metadata.role in the JWT does not grant devotional/admin rights', async () => {
    const r = await fetch(`${AUTH_URL}/user`, {
      method: 'PUT',
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${memberA.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: { role: 'admin' } }),
    });
    assert.equal(r.status, 200);
    // fresh token carrying the forged user_metadata
    const login = await fetch(`${AUTH_URL}/token?grant_type=password`, {
      method: 'POST', headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: memberA.email, password: 'Password-123!' }),
    });
    const forged = client((await login.json()).access_token);
    const ins = await forged.post('monthly_devotionals', { month: 1, year: 2030, title: 't', book_title: 'b', total_days: 31, total_pages: 10, created_by: memberA.id });
    assert.ok(!ins.ok, `devotional insert with forged metadata -> ${ins.status}`);
    assert.ok(isBlocked(await forged.post('books_of_month', { title: 't', author: 'a', drive_url: 'u', active_from: '2020-01-01', active_until: '2021-01-01' })));
    assert.ok(isBlocked(await forged.get('admin_roles')));
  });
});

// ─── Member vs privileged tables ─────────────────────────────────────────────

describe('member cannot perform staff operations', () => {
  const stamp = tag;
  test('books, events, cells, habit templates, confessions, tags, roles, devotionals', async () => {
    const m = memberA.db;
    const attempts = [
      ['books_of_month', { title: 't', author: 'a', drive_url: 'u', active_from: '2020-01-01', active_until: '2021-01-01' }],
      ['events', { title: 'e', date: '2030-01-01', created_by: memberA.id }],
      ['cells', { name: `x-${stamp}` }],
      ['habit_templates', { name: 'h', created_by: memberA.id }],
      ['confessions', { title: 'c', body: 'b', scheduled_date: '2030-01-01', created_by: memberA.id }],
      ['tags_settings', { tag_name: 'x' }],
      ['status_settings', { status_name: 'x' }],
      ['admin_roles', { name: `r-${stamp}`, created_by: memberA.id }],
      ['announcements', { title: 'a', body: 'b', author_id: memberA.id, author_name: 'm' }],
      ['meetings', { title: 'm', date: '2030-01-01', time: '10:00', created_by: memberA.id }],
      ['zoom_settings', { zoom_account_id: 'x' }],
      ['email_log', { recipient_email: 'a@b.c', subject: 's', template_type: 'generic' }],
      ['scheduled_emails', { recipient_email: 'a@b.c', subject: 's', html_content: 'h', scheduled_for: '2030-01-01T00:00:00Z' }],
    ];
    for (const [table, body] of attempts) {
      const r = await m.post(table, body);
      assert.ok(!r.ok, `member INSERT ${table} -> ${r.status}`);
    }
  });

  test('admins and coordinators can use the same operations', async () => {
    assert.ok((await admin.db.post('events', { title: 'e', date: '2030-01-01', created_by: admin.id })).ok);
    assert.ok((await admin.db.post('books_of_month', { title: 't', author: 'a', drive_url: 'u', active_from: '2020-01-01', active_until: '2021-01-01' })).ok);
    assert.ok((await coord.db.post('habit_templates', { name: 'h', created_by: coord.id })).ok);
    assert.equal((await memberA.db.get('events')).status, 200);
    assert.ok((await memberA.db.get('events')).data.length >= 1);
  });

  test('members cannot see scheduled emails or other members’ email data; even admins cannot via the API', async () => {
    await service.post('scheduled_emails', { recipient_email: 'x@y.z', subject: 's', html_content: 'h', scheduled_for: '2030-01-01T00:00:00Z' });
    for (const u of [memberA, leaderA, admin, coord]) assert.ok(isBlocked(await u.db.get('scheduled_emails')), `${u.email}`);
    await service.post('email_log', { member_id: memberB.id, recipient_email: memberB.email, subject: 'secret', template_type: 'generic', status: 'sent' });
    await service.post('email_preferences', { member_id: memberB.id });
    assert.ok(isBlocked(await memberA.db.get(`email_log?member_id=eq.${memberB.id}`)));
    assert.ok(isBlocked(await memberA.db.get(`email_preferences?member_id=eq.${memberB.id}`)));
    assert.ok((await memberB.db.get('email_log')).data.length >= 1);
    assert.ok((await admin.db.get(`email_log?member_id=eq.${memberB.id}`)).data.length >= 1);
    // admins cannot forge or edit logs through the API either (writes are service-role only)
    assert.ok(!(await admin.db.post('email_log', { recipient_email: 'a@b.c', subject: 's', template_type: 'generic' })).ok);
  });

  test('members manage only their own preferences / habit entries / RSVPs / views', async () => {
    assert.ok((await memberA.db.post('email_preferences', { member_id: memberA.id, weekly_digest: true })).ok);
    assert.ok(!(await memberA.db.post('email_preferences', { member_id: memberB.id })).ok);
    const tpl = (await coord.db.post('habit_templates', { name: 'pray', created_by: coord.id })).data[0];
    assert.ok((await memberA.db.post('habit_entries', { template_id: tpl.id, user_id: memberA.id, entry_date: '2030-01-01', status: 'done' })).ok);
    assert.ok(!(await memberA.db.post('habit_entries', { template_id: tpl.id, user_id: memberB.id, entry_date: '2030-01-01', status: 'done' })).ok);
    assert.ok(isBlocked(await memberB.db.get(`habit_entries?user_id=eq.${memberA.id}`)));
    const ev = (await admin.db.post('events', { title: 'rsvp', date: '2030-02-01', created_by: admin.id })).data[0];
    assert.ok((await memberA.db.post('event_rsvps', { event_id: ev.id, user_id: memberA.id })).ok);
    assert.ok(!(await memberA.db.post('event_rsvps', { event_id: ev.id, user_id: memberB.id })).ok);
  });
});

// ─── Testimonies ─────────────────────────────────────────────────────────────

describe('testimonies', () => {
  test('author cannot self-approve (insert status is forced; update is rejected)', async () => {
    const created = await memberA.db.post('testimonies', { author_id: memberA.id, author_name: 'A', title: 'My story', body: 'a long enough testimony body', visibility: 'members', status: 'approved' });
    assert.equal(created.status, 201);
    assert.equal(created.data[0].status, 'pending', 'client-chosen status must be ignored');
    const id = created.data[0].id;
    assert.equal((await memberA.db.patch(`testimonies?id=eq.${id}`, { status: 'approved' })).status, 403);
    assert.equal((await service.get(`testimonies?id=eq.${id}`)).data[0].status, 'pending');
  });

  test('pending/private/draft testimonies are invisible to other members; approval makes shared ones visible', async () => {
    const shared = (await memberA.db.post('testimonies', { author_id: memberA.id, author_name: 'A', title: 'Shared', body: 'shared testimony body text', visibility: 'members' })).data[0];
    const priv = (await memberA.db.post('testimonies', { author_id: memberA.id, author_name: 'A', title: 'Priv', body: 'private testimony body text', visibility: 'private' })).data[0];
    assert.equal(priv.status, 'approved');
    assert.ok(isBlocked(await memberB.db.get(`testimonies?id=eq.${shared.id}`)), 'pending hidden');
    assert.ok(isBlocked(await memberB.db.get(`testimonies?id=eq.${priv.id}`)), 'private hidden');
    assert.ok((await admin.db.get(`testimonies?id=eq.${shared.id}`)).data.length === 1, 'admin moderator sees pending');
    assert.equal((await admin.db.patch(`testimonies?id=eq.${shared.id}`, { status: 'approved' })).status, 200);
    assert.equal((await memberB.db.get(`testimonies?id=eq.${shared.id}`)).data.length, 1);
    assert.ok(isBlocked(await memberB.db.get(`testimonies?id=eq.${priv.id}`)), 'private stays hidden even for admins-of-others? (member B)');
  });

  test('editing an approved shared testimony, or publishing a private one, re-enters moderation', async () => {
    const t = (await memberA.db.post('testimonies', { author_id: memberA.id, author_name: 'A', title: 'T', body: 'initial testimony body', visibility: 'members' })).data[0];
    await admin.db.patch(`testimonies?id=eq.${t.id}`, { status: 'approved' });
    const edited = await memberA.db.patch(`testimonies?id=eq.${t.id}`, { body: 'changed after approval!!' });
    assert.equal(edited.data[0].status, 'pending');
    const p = (await memberA.db.post('testimonies', { author_id: memberA.id, author_name: 'A', title: 'P', body: 'private then public body', visibility: 'private' })).data[0];
    const pub = await memberA.db.patch(`testimonies?id=eq.${p.id}`, { visibility: 'public' });
    assert.equal(pub.data[0].status, 'pending');
  });

  test('cell-visibility testimonies are only visible inside that cell', async () => {
    const t = (await memberA.db.post('testimonies', { author_id: memberA.id, author_name: 'A', title: 'Cell', body: 'cell only testimony body', visibility: 'cell', cell_id: cellA.id })).data[0];
    await admin.db.patch(`testimonies?id=eq.${t.id}`, { status: 'approved' });
    const inCell = await makeUser('inCell', { cell_id: cellA.id });
    assert.equal((await inCell.db.get(`testimonies?id=eq.${t.id}`)).data.length, 1);
    assert.ok(isBlocked(await memberB.db.get(`testimonies?id=eq.${t.id}`)));
  });

  test('reactions and comments cannot be placed on or read from testimonies the caller cannot see', async () => {
    const t = (await memberA.db.post('testimonies', { author_id: memberA.id, author_name: 'A', title: 'Hid', body: 'hidden pending testimony', visibility: 'members' })).data[0];
    assert.ok(!(await memberB.db.post('testimony_comments', { testimony_id: t.id, author_id: memberB.id, author_name: 'B', body: 'hi' })).ok);
    assert.ok(!(await memberB.db.post('testimony_reactions', { testimony_id: t.id, user_id: memberB.id, reaction_type: 'fire' })).ok);
    await service.post('testimony_comments', { testimony_id: t.id, author_id: memberA.id, author_name: 'A', body: 'own' });
    assert.ok(isBlocked(await memberB.db.get(`testimony_comments?testimony_id=eq.${t.id}`)));
  });

  test("another member cannot update or delete someone else's testimony", async () => {
    const t = (await memberA.db.post('testimonies', { author_id: memberA.id, author_name: 'A', title: 'Mine', body: 'my own testimony body' , visibility: 'private' })).data[0];
    assert.ok(isBlocked(await memberB.db.patch(`testimonies?id=eq.${t.id}`, { title: 'pwn' })));
    assert.ok(isBlocked(await memberB.db.del(`testimonies?id=eq.${t.id}`)));
    assert.equal((await service.get(`testimonies?id=eq.${t.id}`)).data[0].title, 'Mine');
  });
});

// ─── Contacts / cells ────────────────────────────────────────────────────────

describe('contacts and cells', () => {
  let contactA;
  test('leader logs a contact in their own cell; others cannot read/modify it', async () => {
    const r = await leaderA.db.post('contacts', { cell_id: cellA.id, contact_name: 'Visitor One', contact_phone: '555-0100', logged_by: leaderA.id });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    contactA = r.data[0];
    assert.equal((await leaderA.db.get(`contacts?id=eq.${contactA.id}`)).data.length, 1);
    assert.equal((await admin.db.get(`contacts?id=eq.${contactA.id}`)).data.length, 1);
    for (const u of [leaderB, memberA, memberB, pending]) {
      assert.ok(isBlocked(await u.db.get(`contacts?id=eq.${contactA.id}`)), `${u.email} read`);
      assert.ok(isBlocked(await u.db.patch(`contacts?id=eq.${contactA.id}`, { notes: 'pwn' })), `${u.email} patch`);
      assert.ok(isBlocked(await u.db.del(`contacts?id=eq.${contactA.id}`)), `${u.email} delete`);
    }
  });

  test('leader cannot log into another cell, cannot forge logged_by; member cannot log at all', async () => {
    assert.ok(!(await leaderB.db.post('contacts', { cell_id: cellA.id, contact_name: 'Intruder', logged_by: leaderB.id })).ok);
    assert.ok(!(await leaderA.db.post('contacts', { cell_id: cellA.id, contact_name: 'Forged', logged_by: leaderB.id })).ok);
    assert.ok(!(await memberA.db.post('contacts', { cell_id: cellA.id, contact_name: 'Member Logged', logged_by: memberA.id })).ok);
  });

  test('contact tags / follow-ups / audit log follow the contact boundary; audit log is append-only', async () => {
    assert.ok((await leaderA.db.post('contact_tags', { contact_id: contactA.id, tag_name: 'x', tagged_by: leaderA.id })).ok);
    assert.ok(!(await leaderB.db.post('contact_tags', { contact_id: contactA.id, tag_name: 'x', tagged_by: leaderB.id })).ok);
    assert.ok(isBlocked(await leaderB.db.get(`contact_tags?contact_id=eq.${contactA.id}`)));
    // like the app: insert without RETURNING (the audit log is not readable by the writer)
    const audit = await leaderA.db.post('contact_audit_log', { contact_id: contactA.id, action: 'viewed', changed_by: leaderA.id }, { Prefer: 'return=minimal' });
    assert.ok(audit.ok, JSON.stringify(audit));
    assert.ok(!(await memberA.db.post('contact_audit_log', { contact_id: contactA.id, action: 'x', changed_by: memberA.id })).ok);
    assert.ok(isBlocked(await leaderA.db.get('contact_audit_log')), 'leaders cannot read the audit log');
    assert.equal((await admin.db.get('contact_audit_log')).data.length >= 1, true);
    const rowId = (await admin.db.get(`contact_audit_log?contact_id=eq.${contactA.id}`)).data[0].id;
    assert.ok(isBlocked(await admin.db.patch(`contact_audit_log?id=eq.${rowId}`, { action: 'tampered' })));
    assert.ok(isBlocked(await admin.db.del(`contact_audit_log?id=eq.${rowId}`)));
    assert.equal((await service.get(`contact_audit_log?id=eq.${rowId}`)).data[0].action, 'viewed');
  });

  test('only core admins manage cells; leaders/members cannot reassign cell leadership', async () => {
    assert.ok(isBlocked(await leaderA.db.patch(`cells?id=eq.${cellB.id}`, { leader_id: leaderA.id })));
    assert.ok(isBlocked(await memberA.db.patch(`cells?id=eq.${cellA.id}`, { name: 'pwn' })));
    assert.equal((await admin.db.patch(`cells?id=eq.${cellA.id}`, { name: `A2-${tag}` })).status, 200);
  });

  test('fine-grained permissions are enforced in the database (contacts.view_all)', async () => {
    const delegate = await makeUser('delegate');
    assert.ok(isBlocked(await delegate.db.get(`contacts?id=eq.${contactA.id}`)));
    await grantPermission(delegate.id, 'contacts.view_all', coord.id);
    assert.equal((await delegate.db.get(`contacts?id=eq.${contactA.id}`)).data.length, 1);
    assert.ok(!(await delegate.db.post('contacts', { cell_id: cellA.id, contact_name: 'No write', logged_by: delegate.id })).ok, 'view_all does not imply write');
  });
});

// ─── Meetings / attendance ───────────────────────────────────────────────────

describe('meetings and attendance', () => {
  let meeting, leadersOnly;
  test('leaders create meetings; members cannot; other leaders cannot edit them', async () => {
    const r = await leaderA.db.post('meetings', { title: 'Cell A', date: '2030-03-01', time: '18:00', visibility: 'public', created_by: leaderA.id });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    meeting = r.data[0];
    assert.ok(!(await memberA.db.post('meetings', { title: 'x', date: '2030-03-01', time: '18:00', created_by: memberA.id })).ok);
    assert.ok(!(await leaderA.db.post('meetings', { title: 'forged', date: '2030-03-01', time: '18:00', created_by: leaderB.id })).ok);
    assert.ok(isBlocked(await leaderB.db.patch(`meetings?id=eq.${meeting.id}`, { title: 'pwn' })));
    assert.ok(isBlocked(await memberA.db.del(`meetings?id=eq.${meeting.id}`)));
    assert.equal((await leaderA.db.patch(`meetings?id=eq.${meeting.id}`, { title: 'Cell A (edited)' })).status, 200);
    assert.equal((await admin.db.patch(`meetings?id=eq.${meeting.id}`, { title: 'Cell A (admin)' })).status, 200);
  });

  test('visibility rules: leaders-only meetings are hidden from members; public ones are visible', async () => {
    leadersOnly = (await admin.db.post('meetings', { title: 'Leaders', date: '2030-03-02', time: '18:00', visibility: 'leaders', created_by: admin.id })).data[0];
    assert.ok(isBlocked(await memberA.db.get(`meetings?id=eq.${leadersOnly.id}`)));
    assert.equal((await leaderB.db.get(`meetings?id=eq.${leadersOnly.id}`)).data.length, 1);
    assert.equal((await memberA.db.get(`meetings?id=eq.${meeting.id}`)).data.length, 1);
  });

  test('member RSVPs (upsert) but cannot mark attendance; staff can; members cannot read others’ RSVPs', async () => {
    const rsvp = await memberA.db.post('meeting_attendances?on_conflict=meeting_id,user_id', { meeting_id: meeting.id, user_id: memberA.id, user_name: 'A' }, { Prefer: 'resolution=merge-duplicates,return=representation' });
    assert.equal(rsvp.status, 201, JSON.stringify(rsvp.data));
    const again = await memberA.db.post('meeting_attendances?on_conflict=meeting_id,user_id', { meeting_id: meeting.id, user_id: memberA.id, user_name: 'A2' }, { Prefer: 'resolution=merge-duplicates,return=representation' });
    assert.ok(again.ok, 'idempotent RSVP (upsert) works');
    assert.ok(!(await memberA.db.post('meeting_attendances', { meeting_id: meeting.id, user_id: memberB.id, user_name: 'B' })).ok, 'RSVP for someone else');
    assert.equal((await memberB.db.post('meeting_attendances', { meeting_id: meeting.id, user_id: memberB.id, user_name: 'B', attended: true })).ok, false, 'self-marked attended on insert');
    assert.equal((await memberA.db.patch(`meeting_attendances?meeting_id=eq.${meeting.id}&user_id=eq.${memberA.id}`, { attended: true })).status, 403);
    const marked = await leaderA.db.patch(`meeting_attendances?meeting_id=eq.${meeting.id}&user_id=eq.${memberA.id}`, { attended: true });
    assert.equal(marked.status, 200);
    assert.equal(marked.data[0].attended, true);
    assert.ok(isBlocked(await memberB.db.get(`meeting_attendances?meeting_id=eq.${meeting.id}&user_id=eq.${memberA.id}`)));
    assert.equal((await memberA.db.del(`meeting_attendances?meeting_id=eq.${meeting.id}&user_id=eq.${memberA.id}`)).status, 200);
  });
});

// ─── Roles / admin tables ────────────────────────────────────────────────────

describe('role management tables', () => {
  test('only the coordinator can create roles/assignments; admins can read; members and leaders cannot', async () => {
    const mk = (u) => u.db.post('admin_roles', { name: `r-${Math.random()}`, created_by: u.id });
    assert.ok((await mk(coord)).ok);
    for (const u of [admin, leaderA, memberA]) assert.ok(!(await mk(u)).ok, u.email);
    assert.ok(isBlocked(await memberA.db.get('admin_roles')));
    assert.ok((await admin.db.get('admin_roles')).data.length >= 1);
    // a user cannot assign themselves a permission role
    const role = (await service.post('admin_roles', { name: `self-${Math.random()}`, created_by: coord.id })).data[0];
    assert.ok(!(await memberA.db.post('admin_role_assignments', { role_id: role.id, user_id: memberA.id, assigned_by: memberA.id })).ok);
  });

  test('push subscriptions and zoom attendance are bounded', async () => {
    assert.ok((await memberA.db.post('push_subscriptions', { member_id: memberA.id, endpoint: `https://push.example/${tag}`, auth: 'a', p256dh: 'p' })).ok);
    assert.ok(!(await memberA.db.post('push_subscriptions', { member_id: memberB.id, endpoint: `https://push.example/${tag}-2`, auth: 'a', p256dh: 'p' })).ok);
    assert.ok(isBlocked(await memberB.db.get(`push_subscriptions?member_id=eq.${memberA.id}`)));
    assert.ok(isBlocked(await memberA.db.get('zoom_attendance')));
    assert.ok(isBlocked(await memberA.db.get('zoom_settings')));
  });
});
