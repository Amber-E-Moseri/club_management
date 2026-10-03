// Shared helpers for the database/API security suite.
// Talks to a REAL Supabase stack (GoTrue + PostgREST + Postgres): either `supabase start`
// (CI) or any compatible stack. Required env:
//   SUPABASE_URL (gateway, e.g. http://127.0.0.1:54321)  -or-  AUTH_URL + REST_URL
//   SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
import { randomUUID } from 'node:crypto';

const base = process.env.SUPABASE_URL;
export const AUTH_URL = process.env.AUTH_URL ?? `${base}/auth/v1`;
export const REST_URL = process.env.REST_URL ?? `${base}/rest/v1`;
export const ANON_KEY = process.env.SUPABASE_ANON_KEY;
export const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!ANON_KEY || !SERVICE_KEY || !(base || (process.env.AUTH_URL && process.env.REST_URL))) {
  throw new Error('Set SUPABASE_URL (or AUTH_URL+REST_URL), SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY');
}

/** Minimal PostgREST client bound to a bearer token (undefined => anon key only). */
export function client(token) {
  const headers = (extra = {}) => ({
    apikey: ANON_KEY,
    Authorization: `Bearer ${token ?? ANON_KEY}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
    ...extra,
  });
  const call = async (method, path, body, extra) => {
    const res = await fetch(`${REST_URL}/${path}`, { method, headers: headers(extra), body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { status: res.status, data, ok: res.ok };
  };
  return {
    get: (path) => call('GET', path),
    post: (path, body, extra) => call('POST', path, body, extra),
    patch: (path, body) => call('PATCH', path, body),
    del: (path) => call('DELETE', path),
    rpc: (fn, body) => call('POST', `rpc/${fn}`, body ?? {}),
  };
}

export const service = client(SERVICE_KEY);
export const anon = client(undefined);

const run = randomUUID().slice(0, 8);
let counter = 0;

/** Sign up through the real auth API (like the browser) and return { id, token, email }. */
export async function signUp(label, metadata = { full_name: `User ${label}` }) {
  const email = `${label}.${run}.${++counter}@test.invalid`;
  const res = await fetch(`${AUTH_URL}/signup`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Password-123!', data: metadata }),
  });
  const body = await res.json();
  if (!res.ok || !body.access_token) throw new Error(`signup failed (${res.status}): ${JSON.stringify(body)}`);
  return { id: body.user.id, token: body.access_token, email };
}

/** Create a user, then set role/status/cell via the service role (what an operator would do). */
export async function makeUser(label, { role = 'member', status = 'active', cell_id = null } = {}) {
  const u = await signUp(label);
  const r = await service.patch(`profiles?id=eq.${u.id}`, { role, status, cell_id });
  if (!r.ok) throw new Error(`promote failed: ${JSON.stringify(r)}`);
  return { ...u, db: client(u.token) };
}

export async function makeCell(name, leaderId = null) {
  const r = await service.post('cells', { name: `${name}-${run}`, leader_id: leaderId });
  if (!r.ok) throw new Error(`cell failed: ${JSON.stringify(r)}`);
  return r.data[0];
}

/** Grant a fine-grained permission through the real role tables (service role = operator). */
export async function grantPermission(userId, permissionKey, coordinatorId) {
  const role = await service.post('admin_roles', { name: `role-${run}-${++counter}`, created_by: coordinatorId });
  if (!role.ok) throw new Error(`role failed: ${JSON.stringify(role)}`);
  const roleId = role.data[0].id;
  await service.post('admin_role_permissions', { role_id: roleId, permission_key: permissionKey });
  await service.post('admin_role_assignments', { role_id: roleId, user_id: userId, assigned_by: coordinatorId });
}

export const tag = run;
export const isDenied = (res) => res.status === 401 || res.status === 403;
/** "Blocked" = permission error OR RLS filtered everything out (empty result / 0 rows changed). */
export const isBlocked = (res) => isDenied(res) || (res.ok && Array.isArray(res.data) && res.data.length === 0);
