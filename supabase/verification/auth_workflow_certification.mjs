import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !anonKey || !serviceRoleKey) {
  throw new Error('SUPABASE_URL, SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY are required');
}

const anon = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

const email = `cert.signup.${Date.now()}@example.test`;
const password = 'CertPassword123!';
const results = [];
let userId;

function pass(check, evidence) {
  results.push({ check, result: 'PASS', evidence });
}

function fail(check, evidence) {
  results.push({ check, result: 'FAIL', evidence });
}

try {
  const signUp = await anon.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name: 'Cert Pending User',
        student_number: 'CERT-LOCAL',
        role: 'coordinator',
        status: 'active',
        admin_role: 'superuser',
      },
    },
  });
  if (signUp.error) fail('signup', signUp.error.message);
  else {
    userId = signUp.data.user?.id;
    pass('signup', `created fake local auth user ${userId}`);
  }

  const login = await anon.auth.signInWithPassword({ email, password });
  if (login.error || !login.data.session) fail('login', login.error?.message ?? 'missing session');
  else {
    userId = userId ?? login.data.user?.id;
    pass('login', 'local Auth returned a session');
  }

  const authed = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${login.data.session?.access_token}` } },
  });

  const { data: profileBefore, error: profileBeforeError } = await authed
    .from('profiles')
    .select('id,status,role')
    .eq('id', userId)
    .single();
  if (profileBeforeError) fail('pending user profile read', profileBeforeError.message);
  else if (profileBefore?.status === 'pending' && profileBefore?.role === 'member') {
    pass('pending user', 'trigger created pending member profile');
  } else {
    fail('pending user', `unexpected profile ${JSON.stringify(profileBefore)}`);
  }

  const directUpdate = await authed
    .from('profiles')
    .update({ status: 'active', role: 'coordinator' })
    .eq('id', userId)
    .select('status,role');
  if (directUpdate.error) {
    pass('pending bypass denied', directUpdate.error.message);
  } else {
    const { data: verified } = await admin
      .from('profiles')
      .select('status,role')
      .eq('id', userId)
      .single();
    if (verified?.status === 'pending' && verified?.role === 'member') {
      pass('pending bypass denied', 'direct privileged update affected no persisted privileged fields');
    } else {
      fail('pending bypass denied', `profile changed to ${JSON.stringify(verified)}`);
    }
  }

  const reset = await anon.auth.resetPasswordForEmail(email, { redirectTo: 'http://127.0.0.1:3000/reset' });
  if (reset.error) fail('password reset', reset.error.message);
  else pass('password reset', 'local reset request accepted');

  const logout = await authed.auth.signOut();
  if (logout.error) fail('logout', logout.error.message);
  else pass('logout', 'session sign-out accepted');
} finally {
  if (userId) {
    await admin.auth.admin.deleteUser(userId);
  }
}

for (const row of results) {
  console.log(`${row.result}\t${row.check}\t${row.evidence}`);
}

const failures = results.filter((row) => row.result !== 'PASS');
if (failures.length > 0) {
  process.exitCode = 1;
}
