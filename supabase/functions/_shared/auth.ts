// Caller authentication + authorization for Edge Functions.
// Roles/permissions ALWAYS come from the database (profiles / admin_role_*), never from the
// request body or from user-editable JWT metadata.
import { timingSafeEqualStrings } from './crypto.ts';
import { HttpError } from './http.ts';

export interface Caller {
  kind: 'service' | 'user';
  userId?: string;
  role?: string;
  permissions: string[];
}

export interface AuthDeps {
  /** Exact value of SUPABASE_SERVICE_ROLE_KEY; presenting it identifies a trusted internal caller. */
  serviceRoleKey: string;
  /** Validate an access token with the auth server; null when invalid/expired/forged. */
  getUser(token: string): Promise<{ id: string } | null>;
  loadProfile(userId: string): Promise<{ role: string; status: string } | null>;
  loadPermissions(userId: string): Promise<string[]>;
}

export function bearerToken(req: Request): string | null {
  const header = req.headers.get('authorization') ?? '';
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  return match ? match[1] : null;
}

export async function authenticate(req: Request, deps: AuthDeps): Promise<Caller> {
  const token = bearerToken(req);
  if (!token) throw new HttpError(401, 'Missing bearer token');

  if (deps.serviceRoleKey && (await timingSafeEqualStrings(token, deps.serviceRoleKey))) {
    return { kind: 'service', permissions: ['*'] };
  }

  let user: { id: string } | null = null;
  try {
    user = await deps.getUser(token);
  } catch {
    user = null;
  }
  if (!user?.id) throw new HttpError(401, 'Invalid or expired token');

  const profile = await deps.loadProfile(user.id);
  // Unknown profile, pending or rejected account => no privileges at all.
  if (!profile || profile.status !== 'active') throw new HttpError(403, 'Account is not active');

  return {
    kind: 'user',
    userId: user.id,
    role: profile.role,
    permissions: await deps.loadPermissions(user.id),
  };
}

const STAFF_ROLES = ['admin', 'coordinator'];

/** Staff = service caller, admin/coordinator, or a user holding the named fine-grained permission. */
export function isStaff(caller: Caller, permission?: string): boolean {
  if (caller.kind === 'service') return true;
  if (caller.role && STAFF_ROLES.includes(caller.role)) return true;
  return !!permission && caller.permissions.includes(permission);
}

export function requireStaff(caller: Caller, permission?: string): void {
  if (!isStaff(caller, permission)) throw new HttpError(403, 'Insufficient privileges');
}

/** Build AuthDeps from a service-role supabase-js client (typed loosely: no URL imports here). */
// deno-lint-ignore no-explicit-any
export function authDepsFromClient(admin: any, serviceRoleKey: string): AuthDeps {
  return {
    serviceRoleKey,
    async getUser(token) {
      const { data, error } = await admin.auth.getUser(token);
      return error || !data?.user ? null : { id: data.user.id };
    },
    async loadProfile(userId) {
      const { data } = await admin.from('profiles').select('role,status').eq('id', userId).maybeSingle();
      return data ?? null;
    },
    async loadPermissions(userId) {
      const { data: assignments } = await admin
        .from('admin_role_assignments')
        .select('role_id')
        .eq('user_id', userId);
      const roleIds = (assignments ?? []).map((a: { role_id: string }) => a.role_id);
      if (roleIds.length === 0) return [];
      const { data: perms } = await admin
        .from('admin_role_permissions')
        .select('permission_key')
        .in('role_id', roleIds);
      return (perms ?? []).map((p: { permission_key: string }) => p.permission_key);
    },
  };
}
