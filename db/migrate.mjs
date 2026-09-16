// EED HALAL — database migration runner (versioned, PostgreSQL).
// Usage:
//   DB_ADAPTER=postgres DATABASE_URL=... node db/migrate.mjs up
//   DB_ADAPTER=postgres DATABASE_URL=... node db/migrate.mjs status
// Schemaless adapters (memory/file) follow the entity validators instead and
// report status without applying SQL. Never edit production schema by hand;
// add a new db/migrations/NNN_*.sql file and run `up`.

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAdapter } from './index.mjs';

const MIGRATIONS_DIR = path.dirname(fileURLToPath(import.meta.url));

async function listMigrations(dir = path.join(MIGRATIONS_DIR, 'migrations')) {
  const files = (await readdir(dir)).filter((f) => /^\d+_.*\.sql$/.test(f)).sort();
  return files.map((file) => ({ version: file.replace(/\.sql$/, ''), file: path.join(dir, file) }));
}

async function appliedVersions(query) {
  await query('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
  const result = await query('SELECT version FROM schema_migrations ORDER BY version ASC');
  return new Set(result.rows.map((row) => row.version));
}

export async function migrateUp(env = process.env, query) {
  if ((env.DB_ADAPTER || 'memory').toLowerCase() !== 'postgres') {
    return { adapter: env.DB_ADAPTER || 'memory', applied: [], note: 'schemaless adapter: no SQL migrations required' };
  }
  const adapter = query ? { query } : null;
  let run = query;
  let close = async () => {};
  if (!run) {
    const { default: pg } = await import('pg');
    const pool = new pg.Pool({ connectionString: env.DATABASE_URL });
    run = (text, params) => pool.query(text, params);
    close = async () => pool.end();
  }
  try {
    const applied = await appliedVersions(run);
    const done = [];
    for (const migration of await listMigrations()) {
      if (applied.has(migration.version)) continue;
      const sql = await readFile(migration.file, 'utf8');
      await run('BEGIN');
      try {
        // Serializes concurrent migrate runs (multi-process safe).
        await run('SELECT pg_advisory_xact_lock(hashtext($1))', ['eedhalal-migrate']);
        if ((await appliedVersions(run)).has(migration.version)) {
          await run('COMMIT');
          continue;
        }
        await run(sql);
        await run('INSERT INTO schema_migrations (version) VALUES ($1)', [migration.version]);
        await run('COMMIT');
      } catch (error) {
        await run('ROLLBACK');
        throw error;
      }
      done.push(migration.version);
    }
    return { adapter: 'postgres', applied: done };
  } finally {
    await close();
  }
}

export async function migrateStatus(env = process.env, query) {
  const kind = (env.DB_ADAPTER || 'memory').toLowerCase();
  if (kind !== 'postgres') {
    return { adapter: kind, pending: [], note: 'schemaless adapter: no SQL migrations required' };
  }
  if (!query && !env.DATABASE_URL) throw new Error('DATABASE_URL is required for migration status.');
  let pool = null;
  const run = query || (async (text, params) => {
    if (!pool) {
      const { default: pg } = await import('pg');
      pool = new pg.Pool({ connectionString: env.DATABASE_URL });
    }
    return pool.query(text, params);
  });
  try {
    const applied = await appliedVersions(run);
    const pending = (await listMigrations()).map((m) => m.version).filter((v) => !applied.has(v));
    return { adapter: 'postgres', applied: [...applied], pending };
  } finally {
    if (pool) await pool.end();
  }
}

async function main() {
  const command = process.argv[2] || 'status';
  createAdapter(); // validates DB_ADAPTER env early (memory default needs nothing)
  if (command === 'up') {
    console.log(JSON.stringify(await migrateUp()));
  } else if (command === 'status') {
    console.log(JSON.stringify(await migrateStatus()));
  } else {
    throw new Error('usage: node db/migrate.mjs [status|up]');
  }
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  await main();
}
