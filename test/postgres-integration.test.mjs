import assert from 'node:assert/strict';
import test from 'node:test';
import { migrateStatus, migrateUp } from '../db/migrate.mjs';
import { createPostgresAdapter } from '../db/postgres.mjs';
import { approveDraft, editDraft, persistDraft, rejectDraft } from '../services/drafts.mjs';
import { resolveCustomer } from '../services/customers.mjs';
import { maybeCreateLead } from '../services/leads.mjs';

// REAL PostgreSQL integration (Phase 4B-1, cases A-O + restart proof).
// Runs ONLY with an explicit, guarded test database (password supplied via
// the environment, never written here):
//
//   $env:PGPASSWORD = '<from-setup>'; $env:EED_TEST_DATABASE_URL = 'postgres://eedhalal_tester@localhost:5432/eedhalal_test'
//   node --test test/postgres-integration.test.mjs
//
// Guardrails (fail loudly, never touch anything else):
// - missing URL or missing `pg` driver  -> SKIP with a clear message
// - database name must contain "test", or host must be loopback,
//   and must not be a known production name -> otherwise REFUSE
// - cleanup truncates ONLY the 4 known tables (never anything arbitrary)

const TEST_URL = process.env.EED_TEST_DATABASE_URL || '';
const BLOCKED_DATABASES = new Set(['postgres', 'production', 'prod', 'eedhalal', 'template1']);

function targetInfo() {
  let parsed;
  try {
    parsed = new URL(TEST_URL);
  } catch {
    return { ok: false, reason: 'EED_TEST_DATABASE_URL is not a valid URL' };
  }
  const name = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  const host = parsed.hostname;
  const loopback = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  if (BLOCKED_DATABASES.has(name.toLowerCase())) {
    return { ok: false, reason: `refusing blocked database name: ${name}` };
  }
  // Production-like names are refused everywhere, including loopback: a local
  // database literally named *prod* must never be truncated by a test run.
  // Matches prod as a token or suffix (eedhalal_prod, myprod) but not inside
  // words (test_product). Over-blocking (reproduction) fails closed: safe.
  if (/production|prod$|[^a-z]prod([^a-z]|$)/i.test(name)) {
    return { ok: false, reason: `refusing production-like database name: ${name}` };
  }
  if (!/test/i.test(name) && !loopback) {
    return { ok: false, reason: `refusing non-test database on non-loopback host: ${name}@${host}` };
  }
  return { ok: true, name, host };
}

async function loadPg() {
  try {
    const { default: pg } = await import('pg');
    return pg;
  } catch {
    return null;
  }
}

const gate = targetInfo();
let pgModule = null;
if (TEST_URL) pgModule = await loadPg();

if (!TEST_URL || !pgModule) {
  test('real postgres integration (SKIPPED — REAL PG NOT YET VERIFIED)', (t) => {
    t.skip(!TEST_URL ? 'set EED_TEST_DATABASE_URL to run' : 'npm install pg on this host to run');
  });
} else if (!gate.ok) {
  test('real postgres integration target guardrail', () => {
    throw new Error(gate.reason);
  });
} else {
  const KNOWN_TABLES = ['audit_logs', 'drafts', 'leads', 'customers'];
  let pool;
  let repos;

  test.before(async () => {
    pool = new pgModule.Pool({ connectionString: TEST_URL });
    repos = createPostgresAdapter({ connectionString: TEST_URL });
    // A+B: migrations apply in order and rerun safely. Reruns against an
    // already-migrated database must pass (applied list may be empty).
    const statusOf = () => migrateStatus({ DB_ADAPTER: 'postgres', DATABASE_URL: TEST_URL });
    const first = await migrateUp({ DB_ADAPTER: 'postgres', DATABASE_URL: TEST_URL });
    const appliedAfterFirst = new Set([...first.applied, ...(await statusOf()).applied]);
    assert.ok(appliedAfterFirst.has('001_core'), 'A: 001 applied');
    assert.ok(appliedAfterFirst.has('002_owner_final'), 'A: 002 applied');
    const rerun = await migrateUp({ DB_ADAPTER: 'postgres', DATABASE_URL: TEST_URL });
    assert.deepEqual(rerun.applied, [], 'B: rerun is a no-op');
    for (const table of KNOWN_TABLES) {
      await pool.query(`TRUNCATE ${table} RESTART IDENTITY CASCADE`);
    }
  });

  test.after(async () => {
    if (pool) {
      for (const table of KNOWN_TABLES) {
        await pool.query(`TRUNCATE ${table} RESTART IDENTITY CASCADE`);
      }
      await pool.end();
    }
    await repos?.close().catch(() => {});
  });

  // C: concurrent resolves converge on one customer row.
  test('C: 20 concurrent resolves create exactly one customer', async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, () => resolveCustomer(repos, { lineUserId: 'Upgintegration' })),
    );
    assert.ok(results.every((r) => r.id === results[0].id));
    const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM customers WHERE line_user_id = $1', ['Upgintegration']);
    assert.equal(rows[0].n, 1);
  });

  async function seedFlow(message = 'ขอใบเสนอราคาบุฟเฟต์ 100 คน วันที่ 20/12/2026 งบ 250 บาท') {
    const customer = await resolveCustomer(repos, { lineUserId: `Upg${Date.now()}${Math.floor(Math.random() * 1e6)}` });
    const { lead } = await maybeCreateLead(repos, { customerId: customer.id, message });
    const draft = await persistDraft(repos, {
      customerId: customer.id, leadId: lead ? lead.id : null,
      incomingMessage: message, draftResponse: 'รับทราบค่ะ', ruleRevision: '2026-09-16',
      metadata: { replyToken: 'tok', tags: ['a', 'b'] },
    }, { type: 'AI', id: '' });
    return { customer, lead, draft };
  }

  // D–F: persistent draft round-trip.
  test('D–F: create, read back, and list WAITING_FOR_HUMAN drafts', async () => {
    const { draft } = await seedFlow();
    assert.equal(draft.status, 'WAITING_FOR_HUMAN', 'D');
    const read = await repos.drafts.findById(draft.id);
    assert.equal(read.draftResponse, 'รับทราบค่ะ', 'E');
    assert.ok((await repos.drafts.listByStatus('WAITING_FOR_HUMAN')).some((r) => r.id === draft.id), 'F');
  });

  // G–I: approve / edit / reject persistence incl. Phase 4A rules.
  test('G: approve persists ownerFinalResponse mirror', async () => {
    const { draft } = await seedFlow();
    const approved = await approveDraft(repos, draft.id, { ownerId: 'owner-1' });
    assert.equal(approved.status, 'APPROVED');
    assert.equal(approved.ownerFinalResponse, approved.draftResponse);
  });

  test('H: edit preserves the original AI draft', async () => {
    const { draft } = await seedFlow();
    const edited = await editDraft(repos, draft.id, { ownerId: 'owner-1', finalText: 'ข้อความเจ้าของ' });
    assert.equal(edited.draftResponse, 'รับทราบค่ะ');
    assert.equal(edited.ownerFinalResponse, 'ข้อความเจ้าของ');
    assert.equal(edited.finalAction, 'EDITED');
  });

  test('I: reject persists a non-sendable state', async () => {
    const { draft } = await seedFlow();
    const rejected = await rejectDraft(repos, draft.id, { ownerId: 'owner-1' });
    assert.equal(rejected.status, 'REJECTED');
    assert.equal(rejected.sentAt, null);
    assert.equal(rejected.ownerFinalResponse, null);
  });

  // J–K: cross-connection owner-action race + stale write.
  test('J: simultaneous owner actions let only one succeed', async () => {
    const { draft } = await seedFlow();
    const second = createPostgresAdapter({ connectionString: TEST_URL });
    try {
      const [first, other] = await Promise.allSettled([
        approveDraft(repos, draft.id, { ownerId: 'a' }),
        approveDraft(second, draft.id, { ownerId: 'b' }),
      ]);
      const ok = [first, other].filter((r) => r.status === 'fulfilled');
      const failed = [first, other].filter((r) => r.status === 'rejected');
      assert.equal(ok.length, 1);
      assert.equal(failed.length, 1);
      assert.match(failed[0].reason.message, /stale draft|illegal draft transition/);
    } finally {
      await second.close();
    }
  });

  test('K: stale expectedUpdatedAt is a conflict', async () => {
    const { draft } = await seedFlow();
    await approveDraft(repos, draft.id, { ownerId: 'owner-1' });
    await assert.rejects(
      editDraft(repos, draft.id, { finalText: 'late', expectedUpdatedAt: draft.updatedAt }),
      /stale draft/,
    );
  });

  // L–N: mutation + audit atomicity and honest failure records.
  test('L–N: atomic approve+audit, no false success on conflict', async () => {
    const { draft } = await seedFlow();
    await approveDraft(repos, draft.id, { ownerId: 'owner-1' });
    const events = await repos.auditLogs.listByEntity('draft', draft.id);
    const actions = events.map((e) => e.action);
    assert.ok(actions.includes('DRAFT_CREATED'), 'M');
    assert.ok(actions.includes('DRAFT_APPROVED'), 'M');
    const before = events.length;
    await assert.rejects(approveDraft(repos, draft.id, { ownerId: 'owner-2' }), /stale draft|illegal/);
    const after = await repos.auditLogs.listByEntity('draft', draft.id);
    assert.equal(after.length, before, 'N: conflict writes no success audit');
    assert.equal(after.filter((e) => e.action === 'DRAFT_APPROVED').length, 1, 'L');
  });

  // O: JSON + types round-trip; restart persistence.
  test('O: metadata/history round-trip and data survives reconnect', async () => {
    const { draft } = await seedFlow();
    const read = await repos.drafts.findById(draft.id);
    assert.deepEqual(read.metadata.tags, ['a', 'b']);
    assert.ok(Array.isArray(read.history) && read.history.length >= 1);
    assert.ok(!('replyToken' in read.metadata) || read.metadata.replyToken === 'tok');
    const { lead } = await seedFlow('ขอใบเสนอราคา งบ 250 บาท 100 คน');
    assert.equal(Number(lead.budgetPerPerson), 250);
    const fresh = createPostgresAdapter({ connectionString: TEST_URL });
    try {
      const again = await fresh.drafts.findById(draft.id);
      assert.equal(again.draftResponse, 'รับทราบค่ะ', 'restart persistence');
    } finally {
      await fresh.close();
    }
  });
}
