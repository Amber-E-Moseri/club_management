import { exportDevotionalReportCsv } from '../lib/queries/reports';

test('exports devotional report rows as CSV', async () => {
  const csv = await exportDevotionalReportCsv([
    {
      member_id: '1',
      member_name: 'Ada Lovelace',
      email: 'ada@example.com',
      viewed: true,
      viewed_at: '2026-09-08T09:15:00Z',
    },
  ]);

  expect(csv).toContain('"Ada Lovelace"');
  expect(csv).toContain('Yes');
});
