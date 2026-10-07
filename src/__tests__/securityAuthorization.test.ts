import fs from 'fs';
import path from 'path';

const root = path.resolve(__dirname, '..', '..');

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

describe('security hardening regression checks', () => {
  const migration = read('supabase/migrations/016_security_authorization_hardening.sql');

  test('profiles self-update and cell-leader broad profile management are removed', () => {
    expect(migration).toContain('drop policy if exists profiles_update_own on public.profiles');
    expect(migration).toContain('drop policy if exists "leaders_manage_profiles" on public.profiles');
    expect(migration).toContain('create policy profiles_select_scoped');
    expect(migration).toContain('create policy profiles_coordinator_administer');
    expect(migration).not.toContain("role in ('admin', 'coordinator', 'cell_leader')");
  });

  test('member approval is only exposed through authorized database RPCs', () => {
    expect(migration).toContain('create or replace function public.approve_pending_member');
    expect(migration).toContain('create or replace function public.reject_pending_member');
    expect(migration).toContain('if not public.is_admin_or_coordinator() then');
    expect(migration).toContain("raise exception 'Not authorised to approve members.'");
    expect(migration).toContain("raise exception 'Not authorised to reject members.'");
  });

  test('private directory/export data is served through safe database surfaces', () => {
    expect(migration).toContain('create or replace view public.member_directory');
    expect(migration).toContain('with (security_invoker = true)');
    expect(migration).toContain('case when p.id = auth.uid() or public.is_admin_or_coordinator() then p.email else null end as email');
    expect(migration).toContain('create or replace function public.export_members_authorized');
    expect(migration).toContain("public.has_admin_permission('reports.generate')");
  });

  test('contact, meeting, Zoom, and audit policies are narrowed', () => {
    expect(migration).toContain('create policy contacts_update_scoped');
    expect(migration).toContain('create policy contacts_delete_admin_only');
    expect(migration).toContain('create policy contact_audit_log_insert_admin');
    expect(migration).toContain('create policy meetings_manage_scoped');
    expect(migration).toContain('create policy zoom_attendance_read_scoped');
  });

  test('send-email authenticates and authorizes privileged actions before service-role work', () => {
    const fn = read('supabase/functions/send-email/index.ts');
    expect(fn).toContain('async function requireAuthorizedCaller');
    expect(fn).toContain("await requireAuthorizedCaller(req, 'notifications.send')");
    expect(fn).toContain("throw new HttpError('Authentication required', 401)");
    expect(fn).toContain("throw new HttpError('Not authorised to send email', 403)");
    expect(fn.indexOf("body.action === 'schedule'")).toBeLessThan(fn.indexOf(".from('scheduled_emails')"));
  });

  test('scheduled email processor and unsubscribe function reject unauthenticated privileged use', () => {
    const scheduled = read('supabase/functions/process-scheduled-emails/index.ts');
    const unsubscribe = read('supabase/functions/unsubscribe/index.ts');

    expect(scheduled).toContain('EMAIL_CRON_SECRET');
    expect(scheduled).toContain("req.headers.get('x-cron-secret') !== cronSecret");
    expect(unsubscribe).toContain('UNSUBSCRIBE_SECRET');
    expect(unsubscribe).toContain('verifyToken');
    expect(unsubscribe).not.toContain('JSON.parse(atob(token))');
  });
});
