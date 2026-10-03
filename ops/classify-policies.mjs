#!/usr/bin/env node
// Classifies every policy found in PRODUCTION against what migration 010 will do.
//   node ops/classify-policies.mjs prod-policies.json [--json]
// EXPECTED               identical to the canonical post-010 policy (no change) - or canonical policy that will be newly created
// STALE POLICY           a policy this repo has always known about, same definition as the repo's legacy SQL; 010 drops it and replaces it
// PRODUCTION-ONLY POLICY name unknown to the repo: 010 would DESTROY it. STOP and review each one before migrating
// UNKNOWN                known name but the definition drifted from every repo version (manual edit in production?), or a table 010 does not manage
import fs from 'node:fs';
const dir = new URL('.', import.meta.url).pathname;
const raw = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const prod = Array.isArray(raw) ? raw : raw.policies; // accepts export-policies.sql or export-state.sql output
const canon = JSON.parse(fs.readFileSync(dir + 'canonical-policies.json', 'utf8'));
const hist = JSON.parse(fs.readFileSync(dir + 'historical-policies.json', 'utf8'));
// pg_policies prints `auth.uid()` or `uid()` depending on the connecting role's search_path -> strip schema prefixes, whitespace, parens
const n = (s) => (s || '').replace(/\b(auth|public|storage|extensions)\./g, '').replace(/\s+/g, '').replace(/[()]/g, '');
const key = (p) => `${p.schema}.${p.table}.${p.name}`;
const sig = (p) => [n(p.using), n(p.check), p.cmd, p.permissive, p.roles].join('|');
const canonByKey = new Map(canon.map((p) => [key(p), p]));
const managed = new Set(canon.filter((p) => p.schema === 'public').map((p) => p.table));
// 010 only manages these storage policies (by name)
const storageManaged = new Set(canon.filter((p) => p.schema === 'storage').map((p) => p.name));
const histByKey = new Map(hist.map((h) => [`${h.schema}.${h.table}.${h.name}`, h]));

const rows = [];
for (const p of prod) {
  const k = key(p);
  let cls, why;
  if (p.schema === 'storage' && !storageManaged.has(p.name) && !histByKey.has(k)) {
    cls = 'OUT OF SCOPE'; why = 'storage policy not touched by 010 (other bucket / Supabase default)';
  } else if (p.schema === 'public' && !managed.has(p.table)) {
    cls = 'UNKNOWN'; why = `table "${p.table}" is not managed by migration 010 (no RLS reset, no active-member gate)`;
  } else if (canonByKey.has(k) && sig(canonByKey.get(k)) === sig(p)) {
    cls = 'EXPECTED'; why = 'identical to canonical policy';
  } else if (histByKey.has(k)) {
    const h = histByKey.get(k);
    const same = h.definitions.some(([u, c, cmd, perm, roles]) => u === n(p.using) && c === n(p.check) && cmd === p.cmd);
    cls = same ? 'STALE POLICY' : 'UNKNOWN';
    why = same ? 'repo-known legacy policy; will be dropped and replaced by 010' : 'repo-known name but definition differs from the repo (edited in production?)';
  } else {
    cls = p.schema === 'storage' ? 'PRODUCTION-ONLY POLICY' : 'PRODUCTION-ONLY POLICY';
    why = 'name not defined anywhere in the repo; 010 would drop it';
  }
  rows.push({ class: cls, key: k, cmd: p.cmd, permissive: p.permissive, why, using: p.using, check: p.check });
}
const prodKeys = new Set(prod.map(key));
const added = canon.filter((c) => !prodKeys.has(key(c)));

if (process.argv.includes('--json')) { console.log(JSON.stringify({ rows, newCanonical: added.map(key) }, null, 1)); process.exit(0); }
const order = ['PRODUCTION-ONLY POLICY', 'UNKNOWN', 'STALE POLICY', 'EXPECTED', 'OUT OF SCOPE'];
const counts = {};
for (const r of rows) counts[r.class] = (counts[r.class] || 0) + 1;
console.log('Policy classification (production -> migration 010)');
for (const c of order) console.log(`  ${c.padEnd(24)} ${counts[c] || 0}`);
console.log(`  ${'NEW canonical policies'.padEnd(24)} ${added.length}  (created by 010; EXPECTED)`);
const LIMIT = process.argv.includes('--all') ? Infinity : 30;
for (const c of ['PRODUCTION-ONLY POLICY', 'UNKNOWN']) {
  const list = rows.filter((r) => r.class === c);
  if (!list.length) continue;
  console.log(`\n== ${c} (${list.length}) -- REVIEW BEFORE MIGRATING ==`);
  if (list.length > LIMIT) console.log(`  (showing ${LIMIT}; use --all)`);
  for (const r of list.slice(0, LIMIT)) console.log(`  ${r.key} [${r.permissive} ${r.cmd}]\n     ${r.why}\n     USING: ${r.using || '-'}\n     CHECK: ${r.check || '-'}`);
}
const blocking = (counts['PRODUCTION-ONLY POLICY'] || 0) + (counts['UNKNOWN'] || 0);
console.log(blocking ? `\nRESULT: STOP - ${blocking} policy(ies) need a human decision before 010 runs.` : '\nRESULT: OK - every production policy is either repo-known (and will be replaced) or already canonical.');
process.exit(blocking ? 2 : 0);
