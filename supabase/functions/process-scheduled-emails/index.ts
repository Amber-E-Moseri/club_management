import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { readEmailEnv } from '../_shared/email.ts';
import { createScheduledHandler } from './handler.ts';

const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Not callable by browsers/users: requires the CRON_SECRET header (see ../_shared/cron.ts).
Deno.serve(createScheduledHandler({
  admin,
  env: readEmailEnv(Deno.env),
  cronSecret: Deno.env.get('CRON_SECRET'),
}));
