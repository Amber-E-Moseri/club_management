// Email delivery shared by `send-email` and `process-scheduled-emails`:
// preference suppression, server-side signed unsubscribe links, provider call, email_log.
import { signUnsubscribeToken } from './unsubscribe-token.ts';
import { isSuppressed } from './preferences.ts';

export interface EmailEnv {
  resendApiKey?: string;
  sendgridApiKey?: string;
  fromEmail: string;
  unsubscribeSecret?: string;
  /** e.g. https://<ref>.supabase.co  (SUPABASE_URL) */
  supabaseUrl: string;
  /** Public app origin used for the "manage preferences" link. */
  appUrl: string;
}

export interface SendInput {
  to: string;
  subject: string;
  html: string;
  text?: string;
  memberId?: string;
  templateType: string;
}

export class ProviderError extends Error {}

export const UNSUBSCRIBE_PLACEHOLDER = '{{unsubscribe_url}}';

// deno-lint-ignore no-explicit-any
type Db = any;
type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export function createEmailService(admin: Db, env: EmailEnv, fetchImpl: FetchLike = fetch) {
  async function resolveMemberId(input: SendInput): Promise<string | null> {
    if (input.memberId) return input.memberId;
    const { data } = await admin.from('profiles').select('id').eq('email', input.to.trim().toLowerCase()).maybeSingle();
    return data?.id ?? null;
  }

  async function unsubscribeUrl(memberId: string | null, templateType: string): Promise<string | null> {
    if (!memberId || !env.unsubscribeSecret) return null;
    const token = await signUnsubscribeToken({ memberId, notifType: templateType }, env.unsubscribeSecret);
    return `${env.supabaseUrl.replace(/\/$/, '')}/functions/v1/unsubscribe?token=${encodeURIComponent(token)}`;
  }

  async function sendAndLog(input: SendInput): Promise<{ id?: string; logId?: string; suppressed?: boolean }> {
    const memberId = await resolveMemberId(input);

    if (memberId) {
      const { data: prefs } = await admin.from('email_preferences').select('*').eq('member_id', memberId).maybeSingle();
      if (isSuppressed(prefs ?? null, input.templateType)) {
        const { data: log } = await admin
          .from('email_log')
          .insert({
            member_id: memberId,
            recipient_email: input.to,
            subject: input.subject,
            template_type: input.templateType,
            status: 'suppressed',
            failed_reason: 'recipient opted out',
            html_content: input.html,
          })
          .select('id')
          .single();
        return { suppressed: true, logId: log?.id };
      }
    }

    const { data: log } = await admin
      .from('email_log')
      .insert({
        member_id: memberId,
        recipient_email: input.to,
        subject: input.subject,
        template_type: input.templateType,
        status: 'queued',
        // The placeholder (not the signed link) is persisted so tokens never sit in the log.
        html_content: input.html,
        text_content: input.text ?? stripHtml(input.html),
      })
      .select('id')
      .single();

    try {
      const sent = await deliver(input, memberId);
      if (log?.id) {
        await admin
          .from('email_log')
          .update({ status: 'sent', sent_at: new Date().toISOString(), provider_message_id: sent.id })
          .eq('id', log.id);
      }
      return { id: sent.id, logId: log?.id };
    } catch (error) {
      if (log?.id) {
        await admin
          .from('email_log')
          .update({ status: 'failed', failed_reason: errorMessage(error).slice(0, 500) })
          .eq('id', log.id);
      }
      throw error;
    }
  }

  async function resend(messageId: string) {
    const { data: log, error } = await admin.from('email_log').select('*').eq('id', messageId).single();
    if (error || !log) throw new ProviderError('Email log entry not found');
    const result = await sendAndLog({
      to: log.recipient_email,
      subject: log.subject,
      html: log.html_content ?? `<p>${escapeHtml(log.subject)}</p>`,
      text: log.text_content ?? undefined,
      memberId: log.member_id ?? undefined,
      templateType: log.template_type ?? 'generic',
    });
    // Mark the original failed row as superseded so "resend failed" does not repeat forever.
    await admin
      .from('email_log')
      .update({ status: result.suppressed ? 'suppressed' : 'sent', sent_at: new Date().toISOString(), retry_count: (log.retry_count ?? 0) + 1 })
      .eq('id', messageId);
    return result;
  }

  async function deliver(input: SendInput, memberId: string | null): Promise<{ id: string }> {
    const link = (await unsubscribeUrl(memberId, input.templateType)) ?? `${env.appUrl.replace(/\/$/, '')}/email-preferences`;
    const html = input.html.split(UNSUBSCRIBE_PLACEHOLDER).join(link);
    const text = (input.text ?? stripHtml(input.html)).split(UNSUBSCRIBE_PLACEHOLDER).join(link);
    const headers: Record<string, string> = {};
    if (memberId && link.includes('/unsubscribe?')) {
      headers['List-Unsubscribe'] = `<${link}>`;
      headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click';
    }
    return sendProviderEmail(input.to, input.subject, html, text, headers);
  }

  async function sendProviderEmail(to: string, subject: string, html: string, text: string, headers: Record<string, string>) {
    if (env.resendApiKey) {
      const res = await fetchImpl('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.resendApiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: env.fromEmail, to, subject, html, text, headers }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new ProviderError(data?.message ?? 'Resend request failed');
      return { id: data.id as string };
    }
    if (env.sendgridApiKey) {
      const res = await fetchImpl('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.sendgridApiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: to }] }],
          from: parseFromEmail(env.fromEmail),
          subject,
          headers,
          content: [
            { type: 'text/plain', value: text },
            { type: 'text/html', value: html },
          ],
        }),
      });
      if (!res.ok) throw new ProviderError(await res.text());
      return { id: crypto.randomUUID() };
    }
    throw new ProviderError('No email provider configured. Set RESEND_API_KEY or SENDGRID_API_KEY.');
  }

  return { sendAndLog, resend };
}

export function parseFromEmail(value: string) {
  const match = value.match(/^(.*)<(.+)>$/);
  if (!match) return { email: value };
  return { name: match[1].trim(), email: match[2].trim() };
}

export function stripHtml(html: string) {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

export function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c));
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Provider error';
}

export function readEmailEnv(env: { get(k: string): string | undefined }): EmailEnv {
  return {
    resendApiKey: env.get('RESEND_API_KEY') || undefined,
    sendgridApiKey: env.get('SENDGRID_API_KEY') || undefined,
    fromEmail: env.get('EMAIL_FROM') ?? 'BLW York Hub <no-reply@blwyork.org>',
    unsubscribeSecret: env.get('UNSUBSCRIBE_SECRET') || undefined,
    supabaseUrl: env.get('SUPABASE_URL') ?? '',
    appUrl: env.get('PUBLIC_APP_URL') ?? 'https://blw-york.vercel.app',
  };
}
