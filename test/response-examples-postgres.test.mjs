import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import { migrateUp } from '../db/migrate.mjs';
import { createPostgresAdapter } from '../db/postgres.mjs';
import { resolveCustomer } from '../services/customers.mjs';
import { approveDraft, persistDraft, sendDraft } from '../services/drafts.mjs';
import { createResponseExampleFromDraft } from '../services/responseExamples.mjs';

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

test('response examples real PostgreSQL migration, dedupe races and least privilege', {
  skip: !adminUrl ? 'test-only EED_TEST_DATABASE_URL required; real PostgreSQL NOT VERIFIED' : false,
}, async (t) => {
  guard(adminUrl);
  assert.ok(runtimeUrl, 'test-only EED_TEST_RUNTIME_DATABASE_URL required for permission proof');
  guard(runtimeUrl);
  const admin = new pg.Client({ connectionString: adminUrl, connectionTimeoutMillis: 5000 });
  const runtime = new pg.Client({ connectionString: runtimeUrl, connectionTimeoutMillis: 5000 });
  let repos;
  let migrated = false;
  const cleanup = () => admin.query('TRUNCATE response_examples, inbound_messages, audit_logs, drafts, leads, customers');
  t.after(async () => {
    try { if (migrated) await cleanup(); }
    finally { await repos?.close(); await runtime.end(); await admin.end(); }
  });
  await admin.connect();
  await runtime.connect();
  for (const client of [admin, runtime]) assert.equal((await client.query('SELECT current_database() AS db')).rows[0].db, 'eedhalal_test');
  assert.equal((await runtime.query('SELECT current_user AS role')).rows[0].role, 'eedhalal_app');
  assert.notEqual((await admin.query('SELECT current_user AS role')).rows[0].role, 'eedhalal_app');
  await migrateUp({ DB_ADAPTER: 'postgres' }, (sql, params) => admin.query(sql, params));
  migrated = true;
  assert.equal((await admin.query("SELECT count(*)::int AS n FROM schema_migrations WHERE version='005_response_examples'")).rows[0].n, 1);
  repos = createPostgresAdapter({ connectionString: adminUrl });
  await cleanup();

  async function seedSent() {
    const customer = await resolveCustomer(repos, { lineUserId: `U${randomUUID().replace(/-/g, '').slice(0, 32)}` });
    const draft = await persistDraft(repos, {
      customerId: customer.id, incomingMessage: 'ขอใบเสนอราคาข้าวกล่อง 5 กล่อง', draftResponse: 'รับทราบค่ะ',
    }, { type: 'AI', id: '' });
    await approveDraft(repos, draft.id, { ownerId: 'owner' });
    await sendDraft(repos, draft.id, {}, { push: async () => ({ outcome: 'ACCEPTED', code: 'HTTP_200', httpStatus: 200 }), token: 't' });
    return repos.drafts.findById(draft.id);
  }

  await t.test('concurrent opt-in converges across independent pools', async () => {
    const other = createPostgresAdapter({ connectionString: adminUrl });
    try {
      const sent = await seedSent();
      const results = await Promise.all(Array.from({ length: 16 }, (_, i) =>
        createResponseExampleFromDraft(i % 2 ? other : repos, sent.id, { ownerId: 'owner' })));
      assert.equal(new Set(results.map((r) => r.example.id)).size, 1);
      assert.equal(results.filter((r) => !r.deduped).length, 1);
    } finally { await other.close(); }
  });

  await t.test('005 uniques, checks, FK and runtime privileges', async () => {
    const indexes = (await admin.query("SELECT indexdef FROM pg_indexes WHERE tablename='response_examples'")).rows.map((r) => r.indexdef).join('\n');
    assert.match(indexes, /UNIQUE.*source_draft_id|source_draft_id.*UNIQUE/);
    assert.match(indexes, /fingerprint/);
    assert.match(indexes, /\(reusable, intent\)/);
    const constraints = (await admin.query("SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid='response_examples'::regclass")).rows.map((r) => r.def).join('\n');
    assert.ok(constraints.includes('REFERENCES drafts(id)'));
    assert.match(constraints, /incoming_example <> ''/);
    const perms = (await runtime.query(`SELECT
      has_table_privilege(current_user, 'response_examples', 'SELECT') AS read,
      has_table_privilege(current_user, 'response_examples', 'INSERT') AS insert,
      has_table_privilege(current_user, 'response_examples', 'UPDATE') AS update,
      has_table_privilege(current_user, 'response_examples', 'DELETE') AS delete`)).rows[0];
    assert.deepEqual(perms, { read: true, insert: true, update: true, delete: false });
    const runtimeRepos = createPostgresAdapter({ connectionString: runtimeUrl });
    try {
      const sent = await seedSent();
      const created = await createResponseExampleFromDraft(runtimeRepos, sent.id, { ownerId: 'o' }).catch((e) => ({ error: e.message }));
      assert.ok(created.example || created.error, 'runtime path exercised');
    } finally { await runtimeRepos.close(); }
    for (const sql of ['DELETE FROM response_examples WHERE false',
      'ALTER TABLE response_examples ADD COLUMN test_forbidden INTEGER',
      'DROP TABLE response_examples']) {
      await runtime.query('BEGIN');
      try { await assert.rejects(runtime.query(sql), { code: '42501' }); }
      finally { await runtime.query('ROLLBACK'); }
    }
  });
});
