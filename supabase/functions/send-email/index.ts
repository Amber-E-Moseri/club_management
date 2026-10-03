import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { readEmailEnv } from '../_shared/email.ts';
import { createSendEmailHandler } from './handler.ts';

const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Authentication/authorization is enforced inside the handler (see ../_shared/auth.ts).
Deno.serve(createSendEmailHandler({
  admin,
  env: readEmailEnv(Deno.env),
  serviceRoleKey,
  allowedOrigins: Deno.env.get('ALLOWED_ORIGINS'),
}));
