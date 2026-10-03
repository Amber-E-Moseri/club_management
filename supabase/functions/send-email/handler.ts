import { authDepsFromClient, authenticate, requireStaff, type AuthDeps, type Caller } from '../_shared/auth.ts';
import { corsHeaders, HttpError, json } from '../_shared/http.ts';
import { createEmailService, ProviderError, type EmailEnv } from '../_shared/email.ts';
import { PREFERENCE_BY_TYPE } from '../_shared/preferences.ts';

export const SEND_PERMISSION = 'notifications.send';
const MAX_BATCH = 200;
const MAX_HTML = 500_000;
const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// deno-lint-ignore no-explicit-any
type Db = any;

export interface SendEmailDeps {
  admin: Db;
  env: EmailEnv;
  serviceRoleKey: string;
  allowedOrigins?: string;
  fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>;
  /** Override only in tests. */
  authDeps?: AuthDeps;
}

export function createSendEmailHandler(deps: SendEmailDeps) {
  const authDeps = deps.authDeps ?? authDepsFromClient(deps.admin, deps.serviceRoleKey);
  const email = createEmailService(deps.admin, deps.env, deps.fetchImpl);

  return async (req: Request): Promise<Response> => {
    const cors = corsHeaders(req, deps.allowedOrigins);
    if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405, cors);

    try {
      const caller = await authenticate(req, authDeps);
      const body = await readBody(req);
      return json(await dispatch(caller, body), 200, cors);
    } catch (error) {
      if (error instanceof HttpError) return json({ error: error.message }, error.status, cors);
      if (error instanceof ProviderError) return json({ error: error.message }, 502, cors);
      console.error('send-email failure', error);
      return json({ error: 'Internal error' }, 500, cors);
    }
  };

  async function dispatch(caller: Caller, body: Record<string, unknown>) {
    const action = body.action;
    switch (action) {
      case 'track_open': {
        // Any active, authenticated member may record an open; it only ever sets opened_at once.
        const id = uuid(body.messageId, 'messageId');
        await deps.admin.from('email_log').update({ opened_at: new Date().toISOString() }).eq('id', id).is('opened_at', null);
        return { ok: true };
      }
      case 'schedule': {
        requireStaff(caller, SEND_PERMISSION);
        const { data, error } = await deps.admin
          .from('scheduled_emails')
          .insert({
            recipient_email: address(body.to),
            subject: subject(body.subject),
            html_content: html(body.html),
            scheduled_for: isoDate(body.scheduledFor),
          })
          .select('id')
          .single();
        if (error) throw error;
        return { id: data.id };
      }
      case 'resend': {
        requireStaff(caller, SEND_PERMISSION);
        return await email.resend(uuid(body.messageId, 'messageId'));
      }
      case 'batch': {
        requireStaff(caller, SEND_PERMISSION);
        if (!Array.isArray(body.recipients) || body.recipients.length === 0) throw new HttpError(400, 'recipients required');
        if (body.recipients.length > MAX_BATCH) throw new HttpError(400, `At most ${MAX_BATCH} recipients per batch`);
        const subj = subject(body.subject);
        const htmlBody = body.html === undefined ? '<p>You have a new notification from BLW York Hub.</p>' : html(body.html);
        const templateType = templateTypeOf(body.templateType);
        const results = [];
        for (const r of body.recipients as Array<Record<string, unknown>>) {
          results.push(await email.sendAndLog({
            to: address(r?.email),
            subject: subj,
            html: htmlBody,
            text: optionalText(body.text),
            memberId: r?.memberId === undefined ? undefined : uuid(r.memberId, 'memberId'),
            templateType,
          }));
        }
        return { count: results.length, results };
      }
      case 'send': {
        requireStaff(caller, SEND_PERMISSION);
        return await email.sendAndLog({
          to: address(body.to),
          subject: subject(body.subject),
          html: html(body.html),
          text: optionalText(body.text),
          memberId: body.memberId === undefined ? undefined : uuid(body.memberId, 'memberId'),
          templateType: templateTypeOf(body.templateType),
        });
      }
      default:
        throw new HttpError(400, 'Unknown action');
    }
  }
}

async function readBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('not an object');
    return body as Record<string, unknown>;
  } catch {
    throw new HttpError(400, 'Invalid JSON body');
  }
}

function address(v: unknown): string {
  if (typeof v !== 'string' || v.length > 320 || !EMAIL_RE.test(v.trim())) throw new HttpError(400, 'Invalid recipient address');
  return v.trim();
}
function subject(v: unknown): string {
  if (typeof v !== 'string' || v.trim() === '' || v.length > 998 || /[\r\n]/.test(v)) throw new HttpError(400, 'Invalid subject');
  return v;
}
function html(v: unknown): string {
  if (typeof v !== 'string' || v === '' || v.length > MAX_HTML) throw new HttpError(400, 'Invalid html');
  return v;
}
function optionalText(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'string' || v.length > MAX_HTML) throw new HttpError(400, 'Invalid text');
  return v;
}
function uuid(v: unknown, name: string): string {
  if (typeof v !== 'string' || !UUID_RE.test(v)) throw new HttpError(400, `Invalid ${name}`);
  return v;
}
function isoDate(v: unknown): string {
  const d = typeof v === 'string' ? new Date(v) : new Date(NaN);
  if (Number.isNaN(d.getTime())) throw new HttpError(400, 'Invalid scheduledFor');
  return d.toISOString();
}
function templateTypeOf(v: unknown): string {
  const t = v === undefined ? 'generic' : v;
  if (typeof t !== 'string' || !(t in PREFERENCE_BY_TYPE)) throw new HttpError(400, 'Invalid templateType');
  return t;
}
