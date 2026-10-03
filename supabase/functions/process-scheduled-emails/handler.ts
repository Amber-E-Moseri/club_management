import { checkCronSecret } from '../_shared/cron.ts';
import { createEmailService, type EmailEnv } from '../_shared/email.ts';
import { json } from '../_shared/http.ts';

// deno-lint-ignore no-explicit-any
type Db = any;

export interface ScheduledDeps {
  admin: Db;
  env: EmailEnv;
  cronSecret?: string;
  fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>;
}

export function createScheduledHandler(deps: ScheduledDeps) {
  const email = createEmailService(deps.admin, deps.env, deps.fetchImpl);

  return async (req: Request): Promise<Response> => {
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

    const auth = await checkCronSecret(req, deps.cronSecret);
    if (auth === 'not_configured') return json({ error: 'CRON_SECRET is not configured' }, 503);
    if (auth !== 'ok') return json({ error: 'Unauthorized' }, 401);

    const { data: emails, error } = await deps.admin
      .from('scheduled_emails')
      .select('*')
      .eq('sent', false)
      .lte('scheduled_for', new Date().toISOString())
      .order('scheduled_for', { ascending: true })
      .limit(100);
    if (error) return json({ error: 'Failed to load scheduled emails' }, 500);

    let sent = 0;
    let failed = 0;
    for (const row of emails ?? []) {
      // Claim the row first so two overlapping cron runs cannot both send it.
      const { data: claimed } = await deps.admin
        .from('scheduled_emails')
        .update({ sent: true, sent_at: new Date().toISOString() })
        .eq('id', row.id)
        .eq('sent', false)
        .select('id');
      if (!claimed || claimed.length === 0) continue;

      try {
        await email.sendAndLog({
          to: row.recipient_email,
          subject: row.subject,
          html: row.html_content,
          templateType: 'generic',
        });
        sent++;
      } catch (err) {
        failed++;
        console.error('scheduled email failed', row.id, err instanceof Error ? err.message : err);
        // Release the claim so the next run retries it.
        await deps.admin.from('scheduled_emails').update({ sent: false, sent_at: null }).eq('id', row.id);
      }
    }
    return json({ processed: emails?.length ?? 0, sent, failed });
  };
}
