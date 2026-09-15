import { approvePendingMember } from '../lib/queries/members';
import { supabase } from '../lib/supabase';
import * as emailService from '../lib/email/emailService';
import { accountApprovedTemplate } from '../lib/email/emailTemplates';

jest.mock('../lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
  },
}));

jest.mock('../lib/email/emailService', () => ({
  sendEmail: jest.fn(),
  getAppOrigin: jest.fn(() => 'https://blwyork.example'),
  buildUnsubscribeUrl: jest.fn(() => 'https://blwyork.example/unsubscribe?token=mock'),
}));

const COORDINATOR_ID = 'actor-coordinator';
const PENDING_MEMBER_ID = 'member-pending';
const ACTIVE_MEMBER_ID = 'member-active';

function makeQuery(rows: Record<string, unknown> | null, updateErr: null | Error = null) {
  const q: Record<string, jest.Mock> = {};
  q.select = jest.fn(() => q);
  q.eq = jest.fn(() => q);
  q.update = jest.fn(() => q);
  q.single = jest.fn(() => Promise.resolve({ data: rows, error: null }));
  // update returns a plain promise for the update path
  const updateResult = Promise.resolve({ error: updateErr ? { message: updateErr.message } : null });
  q.update = jest.fn(() => ({ eq: jest.fn(() => updateResult) }));
  return q;
}

function setupFromSequence(calls: Array<Record<string, unknown> | null>) {
  let callIndex = 0;
  (supabase.from as jest.Mock).mockImplementation(() => {
    const row = calls[callIndex++] ?? null;
    const q: Record<string, unknown> = {};
    const qTyped = q as Record<string, jest.Mock>;
    qTyped.select = jest.fn(() => qTyped);
    qTyped.eq = jest.fn(() => qTyped);
    qTyped.in = jest.fn(() => qTyped);
    qTyped.single = jest.fn(() => Promise.resolve({ data: row, error: null }));
    qTyped.update = jest.fn(() => ({ eq: jest.fn(() => Promise.resolve({ error: null })) }));
    return q;
  });
}

afterEach(() => {
  jest.clearAllMocks();
});

// ─── Authorization ────────────────────────────────────────────────────────────

test('unauthorized member cannot approve', async () => {
  setupFromSequence([{ role: 'member' }]);

  await expect(approvePendingMember(PENDING_MEMBER_ID, 'member-user')).rejects.toThrow(
    'Not authorised',
  );
  expect(emailService.sendEmail).not.toHaveBeenCalled();
});

test('unauthenticated (null actor) cannot approve', async () => {
  setupFromSequence([null]);

  await expect(approvePendingMember(PENDING_MEMBER_ID, 'ghost-id')).rejects.toThrow(
    'Not authorised',
  );
  expect(emailService.sendEmail).not.toHaveBeenCalled();
});

// ─── Happy path ───────────────────────────────────────────────────────────────

test('pending → active: approval succeeds and email is sent', async () => {
  (supabase.from as jest.Mock)
    .mockImplementationOnce(() => {
      // Actor lookup
      const q = makeQuery({ role: 'coordinator' });
      return q;
    })
    .mockImplementationOnce(() => {
      // Target lookup
      const q = makeQuery({ id: PENDING_MEMBER_ID, email: 'jane@example.com', full_name: 'Jane Doe', status: 'pending' });
      return q;
    })
    .mockImplementationOnce(() => {
      // Profile update
      return { update: jest.fn(() => ({ eq: jest.fn(() => Promise.resolve({ error: null })) })) };
    });

  (emailService.sendEmail as jest.Mock).mockResolvedValueOnce({ id: 'msg-1' });

  const result = await approvePendingMember(PENDING_MEMBER_ID, COORDINATOR_ID);

  expect(result.approval).toBe('success');
  expect(result.email).toBe('sent');
  expect(emailService.sendEmail).toHaveBeenCalledTimes(1);

  const call = (emailService.sendEmail as jest.Mock).mock.calls[0][0];
  expect(call.to).toBe('jane@example.com');
  expect(call.templateType).toBe('account_approved');
  expect(call.memberId).toBe(PENDING_MEMBER_ID);
  expect(call.html).toContain('approved');
  expect(call.text).toContain('approved');
});

// ─── Email failure must not roll back approval ────────────────────────────────

test('pending → active: email failure leaves member active', async () => {
  (supabase.from as jest.Mock)
    .mockImplementationOnce(() => makeQuery({ role: 'admin' }))
    .mockImplementationOnce(() => makeQuery({ id: PENDING_MEMBER_ID, email: 'bob@example.com', full_name: 'Bob', status: 'pending' }))
    .mockImplementationOnce(() => ({
      update: jest.fn(() => ({ eq: jest.fn(() => Promise.resolve({ error: null })) })),
    }));

  (emailService.sendEmail as jest.Mock).mockRejectedValueOnce(new Error('SMTP unavailable'));

  const result = await approvePendingMember(PENDING_MEMBER_ID, 'admin-id');

  expect(result.approval).toBe('success');
  expect(result.email).toBe('failed');
  expect(result.emailError).toContain('SMTP unavailable');
});

// ─── Idempotency: already-active member ──────────────────────────────────────

test('already active member: approval skipped, no email sent', async () => {
  (supabase.from as jest.Mock)
    .mockImplementationOnce(() => makeQuery({ role: 'coordinator' }))
    .mockImplementationOnce(() => makeQuery({ id: ACTIVE_MEMBER_ID, email: 'alice@example.com', full_name: 'Alice', status: 'active' }));

  const result = await approvePendingMember(ACTIVE_MEMBER_ID, COORDINATOR_ID);

  expect(result.approval).toBe('not_pending');
  expect(result.email).toBe('skipped');
  expect(emailService.sendEmail).not.toHaveBeenCalled();
});

// ─── Template output ──────────────────────────────────────────────────────────

test('account_approved template: HTML contains approval text', () => {
  const { html, text, subject } = accountApprovedTemplate({
    memberId: 'member-1',
    memberName: 'Alex',
    loginUrl: 'https://blwyork.example/',
  });

  expect(subject).toBe('Your BLW York Hub account is ready');
  expect(html).toContain('Alex');
  expect(html).toContain('approved');
  expect(html).toContain('https://blwyork.example/');
  expect(html).toContain('Sign in to BLW York Hub');
  // Must not mention creating a new account
  expect(html).not.toContain('create');
  // Must include plain text
  expect(text).toContain('Alex');
  expect(text).toContain('approved');
  expect(text).toContain('https://blwyork.example/');
});

test('account_approved template: correct login URL propagation', () => {
  const loginUrl = 'https://blwyork.example/';
  const { html, text } = accountApprovedTemplate({
    memberId: 'member-2',
    memberName: 'Sam',
    loginUrl,
  });

  expect(html).toContain(loginUrl);
  expect(text).toContain(loginUrl);
});
