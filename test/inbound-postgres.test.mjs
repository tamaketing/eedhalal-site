import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import { migrateUp } from '../db/migrate.mjs';
import { createPostgresAdapter } from '../db/postgres.mjs';
import { inboundContract } from '../test-helpers/inbound-contract.mjs';
import { receiveInboundMessage, markProcessing } from '../services/inboundMessages.mjs';

// Run PG suites with --test-concurrency=1. BOTH URLs must address ONLY the
// existing loopback eedhalal_test database. Never infer from production env.
const adminUrl = process.env.EED_TEST_DATABASE_URL;
const runtimeUrl = process.env.EED_TEST_RUNTIME_DATABASE_URL;
function guard(url) {
  let target;
  try { target = new URL(url); } catch { throw new Error('invalid test database URL'); }
  assert.ok(['postgres:', 'postgresql:'].includes(target.protocol), 'PostgreSQL required');
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname), 'loopback required');
  assert.equal(decodeURIComponent(target.pathname), '/eedhalal_test', 'refusing non-test database');
}

test('inbound real PostgreSQL migration, contracts, races and least privilege', {
  skip: !adminUrl ? 'test-only EED_TEST_DATABASE_URL required; real PostgreSQL NOT VERIFIED' : false,
}, async (t) => {
  guard(adminUrl);
  assert.ok(runtimeUrl, 'test-only EED_TEST_RUNTIME_DATABASE_URL required for permission proof');
  guard(runtimeUrl);
  const admin = new pg.Client({ connectionString: adminUrl, connectionTimeoutMillis: 5000 });
  const runtime = new pg.Client({ connectionString: runtimeUrl, connectionTimeoutMillis: 5000 });
  let repos;
  let migrated = false;
  const cleanup = () => admin.query('TRUNCATE inbound_messages, audit_logs, drafts, leads, customers');
  t.after(async () => {
    try { if (migrated) await cleanup(); }
    finally { await repos?.close(); await runtime.end(); await admin.end(); }
  });
  await admin.connect();
  await runtime.connect();
  for (const client of [admin, runtime]) assert.equal((await client.query('SELECT current_database() AS db')).rows[0].db, 'eedhalal_test');
  assert.equal((await runtime.query('SELECT current_user AS role')).rows[0].role, 'eedhalal_app');
  assert.notEqual((await admin.query('SELECT current_user AS role')).rows[0].role, 'eedhalal_app');
  // One pinned connection for the migration's entire BEGIN/COMMIT sequence.
  await migrateUp({ DB_ADAPTER: 'postgres' }, (sql, params) => admin.query(sql, params));
  migrated = true;
  assert.equal((await admin.query("SELECT count(*)::int AS n FROM schema_migrations WHERE version='004_inbound_messages'")).rows[0].n, 1);
  assert.deepEqual((await migrateUp({ DB_ADAPTER: 'postgres' }, (sql, params) => admin.query(sql, params))).applied, []);
  repos = createPostgresAdapter({ connectionString: adminUrl });
  // Test database ONLY; explicit known tables, including the new FKs.
  await cleanup();
  await inboundContract(t, repos);

  await t.test('independent pools race on the unique event key and CAS revision', async () => {
    const other = createPostgresAdapter({ connectionString: adminUrl });
    try {
      const body = { sourceEventId: randomUUID(), incomingMessage: 'race test' };
      const results = await Promise.all(Array.from({ length: 16 }, (_, i) => receiveInboundMessage(i % 2 ? other : repos, body)));
      assert.equal(new Set(results.map((r) => r.inbound.id)).size, 1);
      assert.equal(results.filter((r) => !r.deduped).length, 1);
      const row = results[0].inbound;
      const writes = await Promise.allSettled([repos, other].map((r) => markProcessing(r, row.id, { expectedRevision: 0 })));
      assert.equal(writes.filter((r) => r.status === 'fulfilled').length, 1);
      assert.equal((await repos.auditLogs.listByEntity('inbound_message', row.id)).length, 1);
    } finally { await other.close(); }
  });

  await t.test('004 indexes, checks, foreign keys and runtime privileges', async () => {
    const indexes = (await admin.query("SELECT indexdef FROM pg_indexes WHERE tablename='inbound_messages'")).rows.map((r) => r.indexdef).join('\n');
    assert.match(indexes, /UNIQUE INDEX.*source_event_id/);
    assert.match(indexes, /WHERE \(source_event_id IS NOT NULL\)/);
    assert.match(indexes, /\(status\)/);
    assert.match(indexes, /\(customer_id\)/);
    const constraints = (await admin.query("SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid='inbound_messages'::regclass")).rows.map((r) => r.def).join('\n');
    for (const table of ['customers', 'leads', 'drafts']) assert.ok(constraints.includes(`REFERENCES ${table}(id)`));
    assert.match(constraints, /retry_count >= 0/);
    assert.match(constraints, /DRAFT_CREATED/);
    const perms = (await runtime.query(`SELECT
      has_table_privilege(current_user, 'inbound_messages', 'SELECT') AS read,
      has_table_privilege(current_user, 'inbound_messages', 'INSERT') AS insert,
      has_table_privilege(current_user, 'inbound_messages', 'UPDATE') AS update,
      has_table_privilege(current_user, 'inbound_messages', 'DELETE') AS delete,
      has_table_privilege(current_user, 'inbound_messages', 'TRUNCATE') AS truncate,
      has_schema_privilege(current_user, 'public', 'CREATE') AS schema_create,
      (SELECT tableowner = current_user FROM pg_tables WHERE tablename='inbound_messages') AS owner`)).rows[0];
    assert.deepEqual(perms, { read: true, insert: true, update: true, delete: false, truncate: false, schema_create: false, owner: false });
    const runtimeRepos = createPostgresAdapter({ connectionString: runtimeUrl });
    try {
      const row = (await receiveInboundMessage(runtimeRepos, { incomingMessage: 'runtime test', sourceEventId: randomUUID() })).inbound;
      assert.equal((await markProcessing(runtimeRepos, row.id, { expectedRevision: 0 })).status, 'PROCESSING');
      assert.equal((await runtimeRepos.inboundMessages.findById(row.id)).status, 'PROCESSING');
    } finally { await runtimeRepos.close(); }
    // Rollback even if a forbidden command unexpectedly succeeds.
    for (const sql of ['DELETE FROM inbound_messages WHERE false',
      'ALTER TABLE inbound_messages ADD COLUMN test_forbidden INTEGER',
      'ALTER SCHEMA public RENAME TO test_forbidden',
      'CREATE TABLE public.test_forbidden (id INTEGER)',
      'CREATE SCHEMA test_forbidden']) {
      await runtime.query('BEGIN');
      try { await assert.rejects(runtime.query(sql), { code: '42501' }); }
      finally { await runtime.query('ROLLBACK'); }
    }
  });
});
