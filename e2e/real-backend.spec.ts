// Critical-path certification against a REAL Supabase stack (no mocks):
// sign-up -> pending -> (blocked from self-approval via direct API) -> approval -> login -> dashboard.
// Opt-in:  E2E_REAL_BACKEND=1 REACT_APP_SUPABASE_URL=… REACT_APP_SUPABASE_ANON_KEY=… SUPABASE_SERVICE_ROLE_KEY=… npx playwright test real-backend
import { expect, test } from '@playwright/test';

const enabled = process.env.E2E_REAL_BACKEND === '1';
const url = process.env.REACT_APP_SUPABASE_URL ?? '';
const anon = process.env.REACT_APP_SUPABASE_ANON_KEY ?? '';
const service = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

test.skip(!enabled, 'set E2E_REAL_BACKEND=1 with a running Supabase stack');
test.describe.configure({ mode: 'serial' });

const stamp = Date.now();
const email = `e2e.${stamp}@test.invalid`;
const password = 'Password-123!';

async function rest(path: string, init: RequestInit & { token?: string } = {}) {
  const { token, ...rest } = init;
  return fetch(`${url}/rest/v1/${path}`, {
    ...rest,
    headers: { apikey: anon, Authorization: `Bearer ${token ?? service}`, 'Content-Type': 'application/json', Prefer: 'return=representation', ...(rest.headers ?? {}) },
  });
}

test('sign-up → pending → cannot self-approve → approved → dashboard', async ({ page }) => {
  // 1. register through the UI
  await page.goto('/');
  await page.getByRole('button', { name: 'Request access' }).click();
  await page.getByLabel('Full Name').fill('E2E Member');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Confirm Password').fill(password);
  await page.getByRole('button', { name: 'Submit Request' }).click();
  // With email auto-confirm the session starts at once and the app shows the pending screen;
  // with confirmation required it shows "Application submitted!". Both are correct.
  const pendingHeading = page.getByRole('heading', { name: 'Account pending approval' });
  await expect(page.getByRole('heading', { name: /Application submitted!|Account pending approval/ })).toBeVisible();

  // 2. server-side state: member + pending (never active)
  const created = await (await rest(`profiles?email=eq.${encodeURIComponent(email)}`)).json();
  expect(created).toHaveLength(1);
  expect(created[0].role).toBe('member');
  expect(created[0].status).toBe('pending');

  // 3. login shows the pending screen, not the app
  if (await page.getByRole('button', { name: 'Back to Sign In' }).isVisible()) {
    await page.getByRole('button', { name: 'Back to Sign In' }).click();
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Sign In' }).click();
  }
  await expect(pendingHeading).toBeVisible();
  await expect(page.getByRole('heading', { name: /Welcome back/i })).toHaveCount(0);

  // 4. the pending user tries to bypass the UI and approve/promote themselves directly
  const login = await (await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: anon, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }),
  })).json();
  for (const patch of [{ status: 'active' }, { role: 'coordinator' }]) {
    await rest(`profiles?id=eq.${created[0].id}`, { method: 'PATCH', token: login.access_token, body: JSON.stringify(patch) });
  }
  const events = await rest('events?select=id', { token: login.access_token });
  expect(await events.json()).toEqual([]); // organisational data is invisible while pending
  const after = await (await rest(`profiles?id=eq.${created[0].id}`)).json();
  expect(after[0]).toMatchObject({ status: 'pending', role: 'member' });
  await page.reload();
  await expect(pendingHeading).toBeVisible();

  // 5. an authorised approver (operator/coordinator) approves
  await rest(`profiles?id=eq.${created[0].id}`, { method: 'PATCH', body: JSON.stringify({ status: 'active' }) });

  // 6. the member now reaches the app, with member-level permissions only
  await page.reload();
  await expect(page.getByRole('heading', { name: /Welcome back/i })).toBeVisible();
  const priv = await rest(`profiles?id=eq.${created[0].id}`, { method: 'PATCH', token: login.access_token, body: JSON.stringify({ role: 'admin' }) });
  expect(priv.status).toBe(403);
});
