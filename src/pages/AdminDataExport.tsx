import React, { useEffect, useState } from 'react';
import { Button } from '../components/foundation/Button';
import { Card } from '../components/foundation/Card';
import { Input } from '../components/foundation/Input';
import type { AuthUser } from '../lib/auth';
import type { Meeting } from '../types';
import { downloadCSV, exportContactsCSV, exportMeetingAttendanceCSV, exportMembersCSV } from '../lib/queries/export';
import { fetchMeetings } from '../lib/queries/meetings';

interface Props {
  user: AuthUser | null;
}

export const AdminDataExport: React.FC<Props> = ({ user }) => {
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [meetingId, setMeetingId] = useState('');
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [lastExported, setLastExported] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const isAdmin = user?.role === 'admin' || user?.role === 'coordinator';

  useEffect(() => {
    fetchMeetings(false).then(setMeetings).catch(console.error);
  }, []);

  async function runExport(kind: 'members' | 'contacts' | 'attendance') {
    setLoading(true);
    try {
      const csv =
        kind === 'members'
          ? await exportMembersCSV()
          : kind === 'contacts'
            ? await exportContactsCSV({ date_from: dateFrom || undefined, date_to: dateTo || undefined })
            : await exportMeetingAttendanceCSV(meetingId);
      downloadCSV(`${kind}-${new Date().toISOString().split('T')[0]}.csv`, csv);
      setLastExported(new Date().toLocaleString());
    } finally {
      setLoading(false);
    }
  }

  if (!isAdmin) {
    return (
      <div className="flex min-h-[360px] items-center justify-center">
        <p className="text-small text-gray-400">Access denied.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 printable-area">
      <div>
        <p className="text-small font-bold uppercase text-york-600">Admin</p>
        <h1 className="text-h1">Data Export & Backup</h1>
        {lastExported && <p className="text-small text-gray-400">Last exported {lastExported}</p>}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card title="Members" hasRedBorder>
          <p className="mb-4 text-small text-gray-500">Export member directory details.</p>
          <Button onClick={() => runExport('members')} loading={loading} fullWidth>Export Members CSV</Button>
        </Card>

        <Card title="Contacts">
          <div className="space-y-3">
            <Input label="From" type="date" value={dateFrom} onChange={setDateFrom} />
            <Input label="To" type="date" value={dateTo} onChange={setDateTo} />
            <Button onClick={() => runExport('contacts')} loading={loading} fullWidth>Export Contacts CSV</Button>
          </div>
        </Card>

        <Card title="Meeting Attendance">
          <div className="space-y-3">
            <label className="block">
              <span className="input-label">Meeting</span>
              <select className="input-field" value={meetingId} onChange={(event) => setMeetingId(event.target.value)}>
                <option value="">Select meeting</option>
                {meetings.map((meeting) => (
                  <option key={meeting.id} value={meeting.id}>{meeting.title} - {meeting.date}</option>
                ))}
              </select>
            </label>
            <Button onClick={() => runExport('attendance')} disabled={!meetingId} loading={loading} fullWidth>
              Export Attendance CSV
            </Button>
          </div>
        </Card>
      </div>

      <Card title="Print-Friendly Snapshot">
        <p className="text-small text-gray-500">Use your browser print dialog to save this export dashboard as a PDF.</p>
        <Button variant="secondary" onClick={() => window.print()} className="mt-4">Print / Save PDF</Button>
      </Card>
    </div>
  );
};
