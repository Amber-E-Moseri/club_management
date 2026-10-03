import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { createUnsubscribeHandler } from './handler.ts';

const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Public endpoint (verify_jwt = false in config.toml): authorization is the HMAC-signed token.
Deno.serve(createUnsubscribeHandler({
  admin,
  secret: Deno.env.get('UNSUBSCRIBE_SECRET'),
  appUrl: Deno.env.get('PUBLIC_APP_URL'),
}));
