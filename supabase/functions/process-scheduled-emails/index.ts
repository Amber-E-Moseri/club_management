import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
);

Deno.serve(async () => {
  const { data: emails, error } = await supabase
    .from('scheduled_emails')
    .select('*')
    .eq('sent', false)
    .lte('scheduled_for', new Date().toISOString())
    .order('scheduled_for', { ascending: true })
    .limit(100);

  if (error) return json({ error: error.message }, 500);

  let sent = 0;
  for (const email of emails ?? []) {
    const { error: invokeError } = await supabase.functions.invoke('send-email', {
      body: {
        action: 'send',
        to: email.recipient_email,
        subject: email.subject,
        html: email.html_content,
        templateType: 'generic',
      },
    });
    if (!invokeError) {
      sent++;
      await supabase.from('scheduled_emails').update({ sent: true, sent_at: new Date().toISOString() }).eq('id', email.id);
    }
  }

  return json({ processed: emails?.length ?? 0, sent });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
