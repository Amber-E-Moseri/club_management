import { renderSampleEmailTemplate } from '../lib/email/emailTemplates';
import { UNSUBSCRIBE_PLACEHOLDER } from '../lib/email/emailService';
import * as emailService from '../lib/email/emailService';
import type { EmailTemplateType } from '../types';

const TYPES: EmailTemplateType[] = [
  'meeting_reminder_8am', 'meeting_reminder_1hr', 'message_notification', 'habit_milestone',
  'devotional_reminder', 'testimony_approved', 'weekly_digest', 'generic',
];

describe('email templates and unsubscribe links', () => {
  it.each(TYPES)('%s embeds the server-side placeholder, never a client-built token', (type) => {
    const { html } = renderSampleEmailTemplate(type);
    expect(html).toContain(`href="${UNSUBSCRIBE_PLACEHOLDER}"`);
    expect(html).not.toMatch(/unsubscribe\?token=/);
  });

  it('the browser bundle no longer exports an unsigned unsubscribe-token builder', () => {
    expect((emailService as Record<string, unknown>).buildUnsubscribeUrl).toBeUndefined();
  });
});
