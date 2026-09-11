/* eslint-disable */
// Temporary seeder — delete after use
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://hecropqaidcveeoagsgy.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhlY3JvcHFhaWRjdmVlb2Fnc2d5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg4MzUzOTAsImV4cCI6MjEwNDQxMTM5MH0.Exrh1TywC87FIMr3c9VZUpYpPWdP8NOF2xUsD3CEk_g';

const TEST_USERS = [
  { email: 'blwcan.elvanto+testcoord@gmail.com',  password: 'Test1234!', fullName: 'Test Coordinator', role: 'coordinator' },
  { email: 'blwcan.elvanto+testleader@gmail.com', password: 'Test1234!', fullName: 'Test Cell Leader', role: 'cell_leader' },
  { email: 'blwcan.elvanto+testmember@gmail.com', password: 'Test1234!', fullName: 'Test Member',      role: 'member' },
];

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function createUser(user) {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  console.log('\n── ' + user.role + ': ' + user.email);

  const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
    email: user.email,
    password: user.password,
    options: { data: { full_name: user.fullName } },
  });

  if (signUpError) {
    if (signUpError.message.includes('already registered') || signUpError.message.includes('already been registered')) {
      console.log('  Already registered — signing in');
    } else {
      console.error('  Sign-up ERROR:', signUpError.message);
      return false;
    }
  } else {
    console.log('  Signed up, id:', signUpData && signUpData.user && signUpData.user.id);
  }

  await sleep(1000);

  const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: user.password,
  });

  if (signInError) {
    console.error('  Sign-in ERROR:', signInError.message);
    return false;
  }
  console.log('  Signed in, id:', signInData.user.id);

  const { error: updateError } = await supabase
    .from('profiles')
    .update({ status: 'active', role: user.role, full_name: user.fullName })
    .eq('id', signInData.user.id);

  if (updateError) {
    console.error('  Profile update ERROR:', updateError.message);
  } else {
    console.log('  Profile updated to status=active, role=' + user.role);
  }

  const { data: profile, error: readErr } = await supabase
    .from('profiles')
    .select('id, email, full_name, role, status')
    .eq('id', signInData.user.id)
    .single();

  if (readErr) {
    console.error('  Read ERROR:', readErr.message);
  } else {
    console.log('  Confirmed:', JSON.stringify(profile));
  }

  await supabase.auth.signOut();
  return true;
}

(async () => {
  for (const user of TEST_USERS) {
    await createUser(user);
    await sleep(2000); // avoid rate limits
  }

  console.log('\n\n✅ Test credentials:');
  TEST_USERS.forEach(u =>
    console.log('  ' + u.role.padEnd(14) + u.email + '  /  ' + u.password)
  );
  console.log('\nDelete this file when done: create-test-users.js');
})().catch(err => { console.error('Fatal:', err); process.exit(1); });
