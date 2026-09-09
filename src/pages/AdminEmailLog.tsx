import React, { useMemo, useState } from 'react';
import { Card } from '../components/foundation/Card';
import { Button } from '../components/foundation/Button';
import { Input } from '../components/foundation/Input';
import { renderSampleEmailTemplate } from '../lib/email/emailTemplates';
import { useEmailLog, useResendFailedEmails, useSendTestEmail } from '../hooks/useEmailNotifications';
import type { AuthUser } from '../lib/auth';
import type { EmailStatus, EmailTemplateType } from '../types';

interface Props {
  user: AuthUser | null;
}

const TEMPLATE_TYPES: EmailTemplateType[] = [
  'meeting_reminder_8am',
  'meeting_reminder_1hr',
  'message_notification',
  'habit_milestone',
  'devotional_reminder',
  'testimony_approved',
  'weekly_digest',
  'generic',
];

export const AdminEmailLog: React.FC<Props> = ({ user }) => {
  const [status, setStatus] = useState<EmailStatus | ''>('');
  const [testEmail, setTestEmail] = useState(user?.email ?? '');
  const [templateType, setTemplateType] = useState<EmailTemplateType>('meeting_reminder_8am');
  const [notice, setNotice] = useState('');
  const { logs, loading } = useEmailLog(undefined, { status: status || undefined });
  const { sendTest, sending, error: sendError } = useSendTestEmail();
  const { resendFailed, sending: resending, error: resendError } = useResendFailedEmails();

  const preview = useMemo(() => renderSampleEmailTemplate(templateType), [templateType]);
  const stats = useMemo(() => {
    const total = logs.length || 1;
    const sent = logs.filter((log) => log.status === 'sent').length;
    const failed = logs.filter((log) => log.status === 'failed').length;
    const opened = logs.filter((log) => log.opened_at).length;
    const clicked = logs.filter((log) => log.clicked_at).length;
    return {
      sent,
      failed,
      openRate: Math.round((opened / total) * 100),
      clickRate: Math.round((clicked / total) * 100),
    };
  }, [logs]);

  if (user?.role !== 'admin' && user?.role !== 'coordinator') {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <p className="text-small text-gray-400">Access denied.</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        <div>
          <h1 className="text-h1">Email Log</h1>
          <p className="text-small text-gray-400 mt-1">Review delivery status, test sending, and preview templates.</p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card><Metric label="Sent" value={stats.sent} /></Card>
          <Card><Metric label="Failed" value={stats.failed} /></Card>
          <Card><Metric label="Open Rate" value={`${stats.openRate}%`} /></Card>
          <Card><Metric label="Click Rate" value={`${stats.clickRate}%`} /></Card>
        </div>

        <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
          <Card title="Admin Tools">
            <div className="space-y-4">
              <div className="flex gap-2">
                <Input
                  type="email"
                  label="Send test email"
                  value={testEmail}
                  onChange={setTestEmail}
                  placeholder="name@example.com"
                />
                <div className="pt-7">
                  <Button
                    onClick={async () => {
                      await sendTest(testEmail);
                      setNotice('Test email requested.');
                    }}
                    loading={sending}
                    disabled={!testEmail}
                  >
                    Send Test
                  </Button>
                </div>
              </div>
              {(sendError || resendError) && <p className="text-sm text-red-600">{sendError || resendError}</p>}
              {notice && <p className="text-sm text-green-600">{notice}</p>}
              <Button
                variant="secondary"
                onClick={async () => {
                  const count = await resendFailed();
                  setNotice(`Resend requested for ${count} failed email${count === 1 ? '' : 's'}.`);
                }}
                loading={resending}
              >
                Resend Failed Emails
              </Button>
            </div>
          </Card>

          <Card title="Preview Template">
            <div className="space-y-3">
              <select
                className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-york-600"
                value={templateType}
                onChange={(event) => setTemplateType(event.target.value as EmailTemplateType)}
              >
                {TEMPLATE_TYPES.map((type) => (
                  <option key={type} value={type}>{type.replace(/_/g, ' ')}</option>
                ))}
              </select>
              <p className="text-sm font-semibold text-gray-900">{preview.subject}</p>
              <iframe
                title="Email template preview"
                className="w-full h-80 rounded-md border border-gray-200 bg-white"
                srcDoc={preview.html}
              />
            </div>
          </Card>
        </div>

        <Card
          title="Delivery History"
          headerAction={
            <select
              className="px-3 py-2 text-sm border border-gray-200 rounded-md bg-white"
              value={status}
              onChange={(event) => setStatus(event.target.value as EmailStatus | '')}
            >
              <option value="">All statuses</option>
              <option value="queued">Queued</option>
              <option value="sent">Sent</option>
              <option value="failed">Failed</option>
              <option value="bounced">Bounced</option>
            </select>
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead>
                <tr className="border-b border-gray-100 text-xs uppercase text-gray-400">
                  <th className="py-2 pr-4">Recipient</th>
                  <th className="py-2 pr-4">Subject</th>
                  <th className="py-2 pr-4">Template</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2 pr-4">Created</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td className="py-4 text-gray-400" colSpan={5}>Loading...</td></tr>
                ) : logs.length === 0 ? (
                  <tr><td className="py-4 text-gray-400" colSpan={5}>No email logs found.</td></tr>
                ) : logs.map((log) => (
                  <tr key={log.id} className="border-b border-gray-50">
                    <td className="py-3 pr-4 text-gray-700">{log.recipient_email}</td>
                    <td className="py-3 pr-4 text-gray-900">{log.subject}</td>
                    <td className="py-3 pr-4 text-gray-500">{log.template_type}</td>
                    <td className="py-3 pr-4">
                      <span className="rounded-full bg-gray-100 px-2 py-1 text-xs font-semibold text-gray-700">{log.status}</span>
                    </td>
                    <td className="py-3 pr-4 text-gray-500">{new Date(log.created_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
};

const Metric: React.FC<{ label: string; value: number | string }> = ({ label, value }) => (
  <div>
    <p className="text-xs uppercase tracking-wide text-gray-400 font-semibold">{label}</p>
    <p className="text-2xl font-bold text-gray-900 mt-1">{value}</p>
  </div>
);
