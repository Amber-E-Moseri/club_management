// Minimal in-memory stand-in for the supabase-js query builder (enough for the Edge Function handlers).
// deno-lint-ignore-file no-explicit-any
type Row = Record<string, any>;

export class FakeAdmin {
  tables: Record<string, Row[]>;
  constructor(seed: Record<string, Row[]> = {}) {
    this.tables = {};
    for (const [k, v] of Object.entries(seed)) this.tables[k] = v.map((r) => ({ ...r }));
  }
  from(name: string) {
    this.tables[name] ??= [];
    return new Query(this.tables[name]);
  }
  rows(name: string) {
    return this.tables[name] ?? [];
  }
}

class Query {
  private filters: Array<(r: Row) => boolean> = [];
  private op: 'select' | 'insert' | 'update' | 'upsert' = 'select';
  private payload: any;
  private conflict?: string;
  private max = Infinity;
  private wantSingle: 'single' | 'maybe' | null = null;
  constructor(private rows: Row[]) {}
  select(_cols?: string) { return this; }
  insert(p: Row) { this.op = 'insert'; this.payload = p; return this; }
  update(p: Row) { this.op = 'update'; this.payload = p; return this; }
  upsert(p: Row, opts?: { onConflict?: string }) { this.op = 'upsert'; this.payload = p; this.conflict = opts?.onConflict; return this; }
  eq(c: string, v: any) { this.filters.push((r) => r[c] === v); return this; }
  is(c: string, v: any) { this.filters.push((r) => (r[c] ?? null) === v); return this; }
  in(c: string, vs: any[]) { this.filters.push((r) => vs.includes(r[c])); return this; }
  lte(c: string, v: any) { this.filters.push((r) => r[c] <= v); return this; }
  order() { return this; }
  limit(n: number) { this.max = n; return this; }
  single() { this.wantSingle = 'single'; return this; }
  maybeSingle() { this.wantSingle = 'maybe'; return this; }

  private run(): { data: any; error: any } {
    const match = () => this.rows.filter((r) => this.filters.every((f) => f(r)));
    let out: Row[] = [];
    if (this.op === 'insert') {
      const row = { id: crypto.randomUUID(), ...this.payload };
      this.rows.push(row);
      out = [row];
    } else if (this.op === 'upsert') {
      const existing = this.conflict ? this.rows.find((r) => r[this.conflict!] === this.payload[this.conflict!]) : undefined;
      if (existing) { Object.assign(existing, this.payload); out = [existing]; }
      else { const row = { id: crypto.randomUUID(), ...this.payload }; this.rows.push(row); out = [row]; }
    } else if (this.op === 'update') {
      out = match();
      for (const r of out) Object.assign(r, this.payload);
    } else {
      out = match().slice(0, this.max);
    }
    if (this.wantSingle === 'single') {
      return out.length === 1 ? { data: out[0], error: null } : { data: null, error: { message: 'single row expected' } };
    }
    if (this.wantSingle === 'maybe') return { data: out[0] ?? null, error: null };
    return { data: out, error: null };
  }
  then(res: (v: any) => any, rej?: (e: any) => any) { return Promise.resolve(this.run()).then(res, rej); }
}

/** AuthDeps double that behaves like GoTrue: only tokens registered via `tokens` are valid. */
export function fakeAuthDeps(opts: {
  tokens: Record<string, string>; // token -> user id
  profiles: Record<string, { role: string; status: string }>;
  permissions?: Record<string, string[]>;
  serviceRoleKey?: string;
}) {
  return {
    serviceRoleKey: opts.serviceRoleKey ?? 'service-role-key-for-tests',
    getUser: (t: string) => Promise.resolve(opts.tokens[t] ? { id: opts.tokens[t] } : null),
    loadProfile: (id: string) => Promise.resolve(opts.profiles[id] ?? null),
    loadPermissions: (id: string) => Promise.resolve(opts.permissions?.[id] ?? []),
  };
}
