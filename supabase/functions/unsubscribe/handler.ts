import { verifyUnsubscribeToken } from '../_shared/unsubscribe-token.ts';
import { PREFERENCE_BY_TYPE } from '../_shared/preferences.ts';
import { escapeHtml } from '../_shared/email.ts';

// deno-lint-ignore no-explicit-any
type Db = any;

export interface UnsubscribeDeps {
  admin: Db;
  secret?: string;
  /** If set, browsers are redirected to `${appUrl}/email-preferences?...` (Supabase serves function HTML as text/plain). */
  appUrl?: string;
}

export function createUnsubscribeHandler(deps: UnsubscribeDeps) {
  return async (req: Request): Promise<Response> => {
    if (req.method !== 'GET' && req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

    // Only the signed payload is trusted; query parameters other than `token` are ignored.
    const token = new URL(req.url).searchParams.get('token') ?? '';
    const payload = await verifyUnsubscribeToken(token, deps.secret ?? '');
    if (!payload) return failure(req, deps, 400, 'This unsubscribe link is invalid or has been tampered with.');

    const preference = PREFERENCE_BY_TYPE[payload.notifType];
    const { error } = await deps.admin
      .from('email_preferences')
      .upsert({ member_id: payload.memberId, [preference]: false }, { onConflict: 'member_id' });
    if (error) return failure(req, deps, 500, 'We could not update your preferences. Please try again later.');

    // RFC 8058 one-click clients POST and expect a 2xx; browsers GET.
    if (req.method === 'POST') return new Response('Unsubscribed', { status: 200 });
    if (deps.appUrl) {
      return Response.redirect(`${deps.appUrl.replace(/\/$/, '')}/email-preferences?unsubscribed=${encodeURIComponent(preference)}`, 303);
    }
    return html(200, `<h1>Unsubscribed</h1><p>${escapeHtml(preference.replace(/_/g, ' '))} emails have been disabled.</p>`);
  };
}

function failure(req: Request, deps: UnsubscribeDeps, status: number, message: string) {
  if (req.method === 'POST') return new Response(message, { status });
  return html(status, `<h1>Unsubscribe failed</h1><p>${escapeHtml(message)}</p>` +
    (deps.appUrl ? `<p><a href="${escapeHtml(deps.appUrl.replace(/\/$/, ''))}/email-preferences">Manage email preferences</a></p>` : ''));
}

function html(status: number, body: string) {
  return new Response(`<!doctype html><html><body style="font-family:Arial,sans-serif;padding:32px;">${body}</body></html>`, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
