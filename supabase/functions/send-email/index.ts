import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type SendBody =
  | { action: 'send'; to: string; subject: string; html: string; text?: string; memberId?: string; templateType?: string }
  | { action: 'batch'; recipients: Array<{ email: string; memberId?: string; data?: Record<string, unknown> }>; subject: string; html?: string; text?: string; templateType?: string }
  | { action: 'schedule'; to: string; subject: string; html: string; scheduledFor: string }
  | { action: 'resend'; messageId: string }
  | { action: 'track_open'; messageId: string };

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const emailRelayUrl = Deno.env.get('EMAIL_RELAY_URL') ?? '';
const emailRelaySecret = Deno.env.get('EMAIL_RELAY_SECRET') ?? '';

const supabase = createClient(supabaseUrl, serviceRoleKey);

class HttpError extends Error {
  constructor(message: string, public status = 500) {
    super(message);
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const body = await req.json() as SendBody;
    if (body.action === 'track_open') {
      await supabase.from('email_log').update({ opened_at: new Date().toISOString() }).eq('id', body.messageId);
      return json({ ok: true });
    }
    if (body.action === 'schedule') {
      await requireAuthorizedCaller(req, 'notifications.send');
      const { data, error } = await supabase
        .from('scheduled_emails')
        .insert({
          recipient_email: body.to,
          subject: body.subject,
          html_content: body.html,
          scheduled_for: body.scheduledFor,
        })
        .select('id')
        .single();
      if (error) throw error;
      return json({ id: data.id });
    }
    if (body.action === 'resend') {
      await requireAuthorizedCaller(req, 'notifications.send');
      const { data: log, error } = await supabase.from('email_log').select('*').eq('id', body.messageId).single();
      if (error) throw error;
      const sent = await sendProviderEmail(log.recipient_email, log.subject, log.html_content ?? `<p>${escapeHtml(log.subject)}</p>`, log.text_content ?? undefined);
      await supabase.from('email_log').update({
        status: 'sent',
        sent_at: new Date().toISOString(),
        failed_reason: null,
        provider_message_id: sent.id,
        retry_count: (log.retry_count ?? 0) + 1,
      }).eq('id', body.messageId);
      return json({ id: sent.id });
    }
    if (body.action === 'batch') {
      await requireAuthorizedCaller(req, 'notifications.send');
      const results = [];
      for (const recipient of body.recipients) {
        results.push(await sendAndLog({
          to: recipient.email,
          subject: body.subject,
          html: body.html ?? '<p>You have a new notification from BLW York Hub.</p>',
          text: body.text,
          memberId: recipient.memberId,
          templateType: body.templateType ?? 'generic',
        }));
      }
      return json({ count: results.length, results });
    }
    await requireAuthorizedCaller(req, 'notifications.send');
    const result = await sendAndLog({
      to: body.to,
      subject: body.subject,
      html: body.html,
      text: body.text,
      memberId: body.memberId,
      templateType: body.templateType ?? 'generic',
    });
    return json(result);
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    return json({ error: error instanceof Error ? error.message : 'Unknown email error' }, status);
  }
});

async function requireAuthorizedCaller(req: Request, permission: string): Promise<string> {
  const authHeader = req.headers.get('Authorization') ?? '';
  const jwt = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!jwt) throw new HttpError('Authentication required', 401);

  const { data: userData, error: userError } = await supabase.auth.getUser(jwt);
  const user = userData?.user;
  if (userError || !user) throw new HttpError('Invalid authentication token', 401);

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();
  if (profileError || !profile) throw new HttpError('Profile not found', 403);
  if (['admin', 'coordinator'].includes(profile.role)) return user.id;

  const { data: assignments, error: assignmentError } = await supabase
    .from('admin_role_assignments')
    .select('role_id')
    .eq('user_id', user.id);
  if (assignmentError) throw new HttpError('Could not verify permissions', 403);
  const roleIds = (assignments ?? []).map((row: { role_id: string }) => row.role_id);
  if (roleIds.length > 0) {
    const { data: permissions, error: permissionError } = await supabase
      .from('admin_role_permissions')
      .select('role_id')
      .in('role_id', roleIds)
      .eq('permission_key', permission);
    if (permissionError) throw new HttpError('Could not verify permissions', 403);
    if ((permissions ?? []).length > 0) return user.id;
  }

  throw new HttpError('Not authorised to send email', 403);
}

async function sendAndLog(input: {
  to: string;
  subject: string;
  html: string;
  text?: string;
  memberId?: string;
  templateType: string;
}) {
  const { data: log } = await supabase
    .from('email_log')
    .insert({
      member_id: input.memberId ?? null,
      recipient_email: input.to,
      subject: input.subject,
      template_type: input.templateType,
      status: 'queued',
      html_content: input.html,
      text_content: input.text ?? stripHtml(input.html),
    })
    .select('id')
    .single();

  try {
    const sent = await sendProviderEmail(input.to, input.subject, input.html, input.text);
    if (log?.id) {
      await supabase.from('email_log').update({
        status: 'sent',
        sent_at: new Date().toISOString(),
        provider_message_id: sent.id,
      }).eq('id', log.id);
    }
    return { id: sent.id, logId: log?.id };
  } catch (error) {
    if (log?.id) {
      await supabase
        .from('email_log')
        .update({ status: 'failed', failed_reason: error instanceof Error ? error.message : 'Provider error' })
        .eq('id', log.id);
    }
    throw error;
  }
}

async function sendProviderEmail(to: string, subject: string, html: string, text?: string): Promise<{ id: string }> {
  if (emailRelayUrl && emailRelaySecret) {
    const res = await fetch(emailRelayUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${emailRelaySecret}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ to, subject, html, text }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.message ?? `Gmail relay error ${res.status}`);
    return { id: data.messageId ?? crypto.randomUUID() };
  }
  throw new Error('EMAIL_PROVIDER_NOT_CONFIGURED. Set EMAIL_RELAY_URL + EMAIL_RELAY_SECRET in Supabase project secrets.');
}

function stripHtml(html: string) {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] ?? char));
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
