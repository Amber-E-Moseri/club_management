import { getDashboardStats } from '../lib/queries';
import { supabase } from '../lib/supabase';

jest.mock('../lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
  },
}));

function countQuery(count: number) {
  const query: any = {
    select: jest.fn(() => query),
    gte: jest.fn(() => query),
    lte: jest.fn(() => query),
    eq: jest.fn(() => query),
    count,
  };
  return query;
}

test('aggregates dashboard counts', async () => {
  (supabase.from as jest.Mock)
    .mockReturnValueOnce(countQuery(10))
    .mockReturnValueOnce(countQuery(2))
    .mockReturnValueOnce(countQuery(3))
    .mockReturnValueOnce(countQuery(4))
    .mockReturnValueOnce(countQuery(5));

  const stats = await getDashboardStats();

  expect(stats.member_count).toBe(10);
  expect(stats.member_growth).toBe(2);
  expect(stats.upcoming_events).toBe(3);
  expect(stats.announcement_count).toBe(4);
  expect(stats.active_prayer_requests).toBe(5);
});
