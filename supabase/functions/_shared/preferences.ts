// Maps an email template/notification type to its column in public.email_preferences.
export const PREFERENCE_BY_TYPE: Record<string, string> = {
  meeting_reminder_8am: 'meeting_reminders_8am',
  meeting_reminder_1hr: 'meeting_reminders_1hr',
  message_notification: 'message_notifications',
  habit_milestone: 'habit_milestones',
  devotional_reminder: 'devotional_reminders',
  testimony_approved: 'testimony_approved',
  weekly_digest: 'weekly_digest',
  generic: 'admin_announcements',
};

/** Column defaults of public.email_preferences (used when a member has no row yet). */
export const PREFERENCE_DEFAULTS: Record<string, boolean> = {
  meeting_reminders_8am: true,
  meeting_reminders_1hr: true,
  message_notifications: true,
  habit_milestones: true,
  devotional_reminders: true,
  testimony_approved: true,
  weekly_digest: false,
  admin_announcements: true,
};

export function isSuppressed(prefs: Record<string, unknown> | null, templateType: string): boolean {
  const column = PREFERENCE_BY_TYPE[templateType];
  if (!column) return false;
  if (prefs?.opt_out_all === true) return true;
  const value = prefs ? prefs[column] : undefined;
  if (typeof value === 'boolean') return value === false;
  return PREFERENCE_DEFAULTS[column] === false;
}
