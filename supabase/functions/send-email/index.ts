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
const resendApiKey = Deno.env.get('RESEND_API_KEY') ?? '';
const sendgridApiKey = Deno.env.get('SENDGRID_API_KEY') ?? '';
const fromEmail = Deno.env.get('EMAIL_FROM') ?? 'BLW York Hub <no-reply@blwyork.org>';

const supabase = createClient(supabaseUrl, serviceRoleKey);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const body = await req.json() as SendBody;
    if (body.action === 'track_open') {
      await supabase.from('email_log').update({ opened_at: new Date().toISOString() }).eq('id', body.messageId);
      return json({ ok: true });
    }
    if (body.action === 'schedule') {
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
    return json({ error: error instanceof Error ? error.message : 'Unknown email error' }, 500);
  }
});

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
  if (resendApiKey) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: fromEmail, to, subject, html, text }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.message ?? 'Resend request failed');
    return { id: data.id };
  }
  if (sendgridApiKey) {
    const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${sendgridApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: parseFromEmail(fromEmail),
        subject,
        content: [
          { type: 'text/plain', value: text ?? stripHtml(html) },
          { type: 'text/html', value: html },
        ],
      }),
    });
    if (!res.ok) throw new Error(await res.text());
    return { id: crypto.randomUUID() };
  }
  throw new Error('No email provider configured. Set RESEND_API_KEY or SENDGRID_API_KEY.');
}

function parseFromEmail(value: string) {
  const match = value.match(/^(.*)<(.+)>$/);
  if (!match) return { email: value };
  return { name: match[1].trim(), email: match[2].trim() };
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
