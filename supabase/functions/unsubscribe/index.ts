import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
);

const preferenceByType: Record<string, string> = {
  meeting_reminder_8am: 'meeting_reminders_8am',
  meeting_reminder_1hr: 'meeting_reminders_1hr',
  message_notification: 'message_notifications',
  habit_milestone: 'habit_milestones',
  devotional_reminder: 'devotional_reminders',
  testimony_approved: 'testimony_approved',
  weekly_digest: 'weekly_digest',
  generic: 'admin_announcements',
};

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    const token = url.searchParams.get('token') ?? '';
    const type = url.searchParams.get('type') ?? '';
    const payload = JSON.parse(atob(token)) as { memberId?: string; notifType?: string };
    const memberId = payload.memberId;
    const preference = preferenceByType[type || payload.notifType || ''];
    if (!memberId || !preference) throw new Error('Invalid unsubscribe token');

    await supabase
      .from('email_preferences')
      .upsert({ member_id: memberId, [preference]: false }, { onConflict: 'member_id' });

    return new Response(successHtml(preference), {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  } catch (error) {
    return new Response(errorHtml(error instanceof Error ? error.message : 'Invalid unsubscribe link'), {
      status: 400,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }
});

function successHtml(preference: string) {
  return `<!doctype html><html><body style="font-family:Arial,sans-serif;padding:32px;"><h1>Unsubscribed</h1><p>${preference.replace(/_/g, ' ')} emails have been disabled.</p><p><a href="/email-preferences">Manage email preferences</a></p></body></html>`;
}

function errorHtml(message: string) {
  return `<!doctype html><html><body style="font-family:Arial,sans-serif;padding:32px;"><h1>Unsubscribe failed</h1><p>${message}</p></body></html>`;
}
