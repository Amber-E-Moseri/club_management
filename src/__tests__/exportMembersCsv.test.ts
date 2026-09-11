import { exportMembersCSV } from '../lib/queries/export';
import { supabase } from '../lib/supabase';

jest.mock('../lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
  },
}));

function memberQuery(data: any[] = []) {
  const query: any = {
    select: jest.fn(() => query),
    eq: jest.fn(() => query),
    neq: jest.fn(() => query),
    order: jest.fn(() => Promise.resolve({ data, error: null })),
  };
  return query;
}

test('exports member profile details as CSV', async () => {
  const query = memberQuery([
    {
      id: 'member-1',
      full_name: 'Ada "Countess" Lovelace',
      email: 'ada@example.com',
      student_number: '123456789',
      role: 'member',
      status: 'active',
      cell_id: 'cell-1',
      avatar_url: 'https://example.com/avatar.png',
      joined_at: '2026-09-01T00:00:00Z',
    },
  ]);
  (supabase.from as jest.Mock).mockReturnValueOnce(query);

  const csv = await exportMembersCSV();

  expect(csv.split('\n')[0]).toBe('ID,Name,Email,Student Number,Role,Status,Cell,Avatar URL,Joined At');
  expect(csv).toContain('"Ada ""Countess"" Lovelace"');
  expect(csv).toContain('"active"');
  expect(query.order).toHaveBeenCalledWith('full_name', { ascending: true });
});

test('filters active member profile exports', async () => {
  const query = memberQuery();
  (supabase.from as jest.Mock).mockReturnValueOnce(query);

  await exportMembersCSV('active');

  expect(query.eq).toHaveBeenCalledWith('status', 'active');
  expect(query.neq).not.toHaveBeenCalled();
});

test('filters archived member profile exports as non-active profiles', async () => {
  const query = memberQuery();
  (supabase.from as jest.Mock).mockReturnValueOnce(query);

  await exportMembersCSV('archived');

  expect(query.neq).toHaveBeenCalledWith('status', 'active');
  expect(query.eq).not.toHaveBeenCalled();
});
