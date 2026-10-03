#!/usr/bin/env node
// FAST-PATH rollback of migrations 009/010 policy+function changes, generated from the PRE-deploy state export.
//   node ops/gen-rollback.mjs prod-state.json > rollback-010.sql      then review and: psql "$PROD_DB_URL" -1 -v ON_ERROR_STOP=1 -f rollback-010.sql
// Restores: policies, the 4 replaced functions, anon/authenticated table grants, profiles.status default; removes the guards/triggers/helpers
// that 010 added. It does NOT un-create tables/columns added by 009 (additive, harmless) and does NOT restore DATA - for data use the verified backup.
import fs from 'node:fs';
const st = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const q = (s) => `"${String(s).replace(/"/g, '""')}"`;
const out = ['-- GENERATED rollback for migration 010 (review before running)', 'begin;'];
out.push('drop trigger if exists profiles_guard on public.profiles;', 'drop trigger if exists testimonies_guard on public.testimonies;', 'drop trigger if exists attendance_guard on public.meeting_attendances;');
// remove every policy 010 created (and anything else) on managed tables, then recreate the pre-deploy set
out.push(`do $$ declare r record; begin
  for r in select schemaname, tablename, policyname from pg_policies where schemaname = 'public' loop
    execute format('drop policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
  null;
end $$;`);
// storage.objects: drop by name (010's own + any name we are about to recreate) - other storage policies are never touched
const stNames = new Set(['devotional_images_admin_write','devotional_images_admin_update','devotional_images_admin_delete','testimony_images_insert','testimony_images_update','testimony_images_delete','user_media_read','user_media_insert','user_media_update','user_media_delete']);
for (const p of st.policies) if (p.schema === 'storage') stNames.add(p.name);
for (const nme of stNames) out.push(`drop policy if exists ${q(nme)} on storage.objects;`);
// functions first (policies reference them)
for (const f of st.functions) out.push(f.def.trim().replace(/;?\s*$/, ';'));
for (const p of st.policies) {
  const roles = p.roles && p.roles !== 'public' ? ` to ${p.roles.split(',').map((r) => r.trim()).join(', ')}` : '';
  out.push(`create policy ${q(p.name)} on ${p.schema}.${q(p.table)} as ${p.permissive.toLowerCase()} for ${p.cmd.toLowerCase()}${roles}` +
    (p.using ? ` using (${p.using})` : '') + (p.check ? ` with check (${p.check})` : '') + ';');
}
const byTable = {};
for (const g of st.grants) (byTable[`${g.grantee}|${g.table}`] ||= []).push(g.privilege);
out.push('revoke all on all tables in schema public from anon;', 'revoke all on all tables in schema public from authenticated;');
for (const [k, privs] of Object.entries(byTable)) { const [role, table] = k.split('|'); out.push(`grant ${privs.join(', ')} on public.${q(table)} to ${role};`); }
if (st.profiles_status_default) out.push(`alter table public.profiles alter column status set default ${st.profiles_status_default};`);
out.push(`drop function if exists public.profiles_guard(), public.testimonies_guard(), public.attendance_guard();`);
out.push(`drop function if exists public.is_active_member(), public.is_coordinator(), public.is_staff_role(), public.has_admin_permission(text);`);
out.push('commit;');
console.log(out.join('\n'));
