import fs from 'fs';
import path from 'path';

const root = path.resolve(__dirname, '..', '..');
const migrationsDir = path.join(root, 'supabase', 'migrations');

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function migrationFiles(): string[] {
  return fs.readdirSync(migrationsDir).filter((file) => file.endsWith('.sql')).sort();
}

describe('Supabase migration architecture', () => {
  test('canonical migrations have unique numeric prefixes', () => {
    const prefixes = migrationFiles().map((file) => file.match(/^\d+/)?.[0] ?? file);
    expect(new Set(prefixes).size).toBe(prefixes.length);
  });

  test('canonical migrations do not destructively drop tables or schemas', () => {
    const destructive = migrationFiles()
      .map((file) => [file, fs.readFileSync(path.join(migrationsDir, file), 'utf8')] as const)
      .filter(([, sql]) => /\b(drop\s+table|drop\s+schema|truncate)\b/i.test(sql));

    expect(destructive).toEqual([]);
  });

  test('verification scripts are kept outside executable migration history', () => {
    expect(migrationFiles()).not.toContain('014_verify_reconciliation.sql');
    expect(fs.existsSync(path.join(root, 'supabase', 'verification', '014_verify_reconciliation.sql'))).toBe(true);
  });

  test('legacy src/db app tables are represented by canonical migrations', () => {
    const appTables = read('supabase/migrations/017_app_phase_tables.sql');

    [
      'weekly_messages',
      'habit_templates',
      'habit_entries',
      'events',
      'event_rsvps',
      'announcements',
      'confessions',
      'confession_declarations',
    ].forEach((table) => {
      expect(appTables).toContain(`public.${table}`);
    });

    expect(appTables).toContain('ADD COLUMN IF NOT EXISTS category');
    expect(appTables).toContain('ADD COLUMN IF NOT EXISTS allow_join_requests');
  });

  test('phase 6 notification migration reconciles without clean-slate drops', () => {
    const phase6 = read('supabase/migrations/009_phase6_integrations.sql');

    expect(phase6).not.toMatch(/\bdrop\s+table\b/i);
    expect(phase6).toContain('ADD COLUMN IF NOT EXISTS member_id');
    expect(phase6).toContain('UPDATE public.email_preferences');
    expect(phase6).toContain('UPDATE public.push_subscriptions');
    expect(phase6).toContain('UPDATE public.push_notification_log');
  });
});
