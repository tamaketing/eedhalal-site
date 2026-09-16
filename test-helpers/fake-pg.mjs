// Shared fake PostgreSQL client for contract tests. Understands the exact
// INSERT/SELECT/UPDATE shapes db/postgres.mjs emits (including conditional
// UPDATE ... WHERE id AND status/updated_at), enforces UNIQUE like
// PostgreSQL (code 23505), and returns JSONB columns as objects.
// Real pg returns NUMERIC as string and timestamptz as Date; this fake keeps
// JS values so contract tests stay deterministic (integration tests cover
// the real driver behavior).

const JSON_COLS = new Set(['metadata', 'history', 'before_data', 'after_data']);

export function createFakePg() {
  const tables = { customers: new Map(), leads: new Map(), drafts: new Map(), audit_logs: new Map() };
  const uniques = { customers: ['line_user_id'], drafts: ['draft_id'] };
  const duplicate = () => Object.assign(new Error('duplicate key value'), { code: '23505' });
  const decode = (col, value) => (JSON_COLS.has(col) && typeof value === 'string' ? JSON.parse(value) : value);

  async function query(text, params = []) {
    const clean = text.trim().replace(/\s+/g, ' ');
    let match;
    // Migration bookkeeping first (the generic INSERT branch has no such table).
    if (/^INSERT INTO schema_migrations/i.test(clean)) {
      if (!tables.schema_migrations) tables.schema_migrations = new Map();
      tables.schema_migrations.set(params[0], { version: params[0] });
      return { rows: [] };
    }
    if ((match = clean.match(/^INSERT INTO (\w+) \(([^)]+)\) VALUES/i))) {
      const table = match[1];
      const cols = match[2].split(',').map((s) => s.trim());
      const now = new Date().toISOString();
      const row = {};
      cols.forEach((col, i) => { row[col] = decode(col, params[i]); });
      if (!row.created_at) row.created_at = now;
      if (table !== 'audit_logs' && !row.updated_at) row.updated_at = now;
      if (table === 'drafts') {
        if (!('approved_at' in row)) row.approved_at = null;
        if (!('sent_at' in row)) row.sent_at = null;
        if (!('owner_final_response' in row)) row.owner_final_response = null;
        if (!('final_action' in row)) row.final_action = null;
      }
      const store = tables[table];
      if (!store) throw new Error(`fake pg: unknown table ${table}`);
      if (store.has(row.id)) throw duplicate();
      for (const key of uniques[table] || []) {
        if (row[key] != null && [...store.values()].some((r) => r[key] === row[key])) throw duplicate();
      }
      // Mirrors migration 003 partial unique indexes.
      if (table === 'drafts' && row.source_event_id != null &&
        [...store.values()].some((r) => r.source_event_id === row.source_event_id)) throw duplicate();
      if (table === 'leads' && row.source_event_id != null &&
        [...store.values()].some((r) => r.customer_id === row.customer_id && r.source_event_id === row.source_event_id)) {
        throw duplicate();
      }
      store.set(row.id, row);
      return { rows: [{ ...row }] };
    }
    if ((match = clean.match(/^SELECT \* FROM (\w+)(?: WHERE (.+?))?(?: ORDER BY created_at ASC)?$/i))) {
      const table = match[1];
      let rows = [...(tables[table] || new Map()).values()];
      rows = applyConditions(rows, match[2], params);
      rows = rows.slice().sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
      return { rows: rows.map((r) => ({ ...r })) };
    }
    if ((match = clean.match(/^UPDATE (\w+) SET (.+) WHERE (.+) RETURNING \*$/i))) {
      const table = match[1];
      const store = tables[table];
      const assignments = match[2].split(',').map((s) => s.trim());
      const candidates = applyConditions([...store.values()], match[3], params);
      if (!candidates.length) return { rows: [] };
      const row = candidates[0];
      for (const part of assignments) {
        if (part === 'updated_at = now()') {
          row.updated_at = new Date().toISOString();
          continue;
        }
        const parts = part.match(/^(\w+) = \$(\d+)$/);
        row[parts[1]] = decode(parts[1], params[Number(parts[2]) - 1]);
      }
      return { rows: [{ ...row }] };
    }
    if (/^SELECT 1 AS ok$/i.test(clean)) return { rows: [{ ok: 1 }] };
    if (/^SELECT pg_advisory_xact_lock/i.test(clean)) return { rows: [{ pg_advisory_xact_lock: '' }] };
    if (/^BEGIN$/i.test(clean) || /^COMMIT$/i.test(clean) || /^ROLLBACK$/i.test(clean)) return { rows: [] };
    if (/^CREATE TABLE IF NOT EXISTS schema_migrations/i.test(clean)) return { rows: [] };
    if (/^SELECT version FROM schema_migrations/i.test(clean)) {
      return { rows: [...(tables.schema_migrations || new Map()).values()] };
    }
    // Full migration files (multi-statement DDL): accept without simulating.
    if (/CREATE TABLE IF NOT EXISTS (customers|leads|drafts|audit_logs)/.test(clean)) return { rows: [] };
    if (/ALTER TABLE drafts ADD COLUMN IF NOT EXISTS/.test(clean)) return { rows: [] };
    if (/ALTER TABLE leads ADD COLUMN IF NOT EXISTS/.test(clean)) return { rows: [] };
    if (/CREATE UNIQUE INDEX IF NOT EXISTS/.test(clean)) return { rows: [] };
    throw new Error(`fake pg: unsupported query ${clean.slice(0, 80)}`);
  }

  function applyConditions(rows, where, params) {
    if (!where) return rows;
    let out = rows;
    for (const cond of where.split(/\s+AND\s+/i)) {
      const trimmed = cond.trim();
      // Millisecond-truncated timestamp guard (mirrors the real UPDATE).
      const trunc = trimmed.match(/^date_trunc\('milliseconds', (\w+)\) = date_trunc\('milliseconds', \$(\d+)::timestamptz\)$/);
      if (trunc) {
        const want = String(params[Number(trunc[2]) - 1]).slice(0, 23);
        out = out.filter((r) => String(r[trunc[1]]).slice(0, 23) === want);
        continue;
      }
      const parts = trimmed.match(/^(\w+) = \$(\d+)$/);
      if (!parts) throw new Error(`fake pg: unsupported condition ${cond}`);
      out = out.filter((r) => r[parts[1]] === params[Number(parts[2]) - 1]);
    }
    return out;
  }

  return { query, tables };
}
