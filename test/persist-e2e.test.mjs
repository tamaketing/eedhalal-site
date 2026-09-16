import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { migrateUp } from '../db/migrate.mjs';
import { createPostgresAdapter } from '../db/postgres.mjs';
import { buildNormalizeNodeCode, buildVerifyDraftNodeCode } from '../line-ai/conversation-update.mjs';
import { createInternalApi } from '../server/internal-api.mjs';

// LOCAL END-TO-END (Phase 4B-2): simulated LINE event -> normalize logic ->
// Internal API -> REAL PostgreSQL test DB -> counts. No LINE API involved.
// Gate: EED_TEST_DATABASE_URL required, loopback host AND test database name
// required (stricter than the unit integration suite), pg driver required.
// Otherwise SKIP. Cleanup truncates only the 4 known tables.
// NOTE: run PostgreSQL-backed suites serialized
// (node --test --test-concurrency=1 ...) — parallel files share this
// database and their truncate hooks would otherwise overlap.

const TEST_URL = process.env.EED_TEST_DATABASE_URL || '';

function targetOk() {
  try {
    const parsed = new URL(TEST_URL);
    const name = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
    const host = parsed.hostname;
    const loopback = host === 'localhost' || host === '127.0.0.1' || host === '::1';
    if (!loopback || !/test/i.test(name)) return false;
    if (/production|prod$|[^a-z]prod([^a-z]|$)/i.test(name)) return false;
    if (['postgres', 'template1'].includes(name.toLowerCase())) return false;
    return true;
  } catch {
    return false;
  }
}

let pgAvailable = false;
try {
  await import('pg');
  pgAvailable = true;
} catch {
  pgAvailable = false;
}

if (!TEST_URL || !pgAvailable || !targetOk()) {
  test('local persistence E2E (SKIPPED — needs loopback EED_TEST_DATABASE_URL + pg driver)', (t) => {
    t.skip('real-PG E2E runs only against a guarded local test database');
  });
} else {
  const SECRET = randomUUID();
  const repos = createPostgresAdapter({ connectionString: TEST_URL });
  const { server } = createInternalApi({ repos, env: { EED_INTERNAL_API_SECRET: SECRET, DB_ADAPTER: 'postgres' } });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  test.after(async () => {
    server.close();
    await repos.close();
  });

  const normalizeCode = buildNormalizeNodeCode('2026-09-16');
  const verifyCode = buildVerifyDraftNodeCode();

  function lineEvent(userId, messageId, text) {
    return {
      type: 'message',
      replyToken: 'test-e2e-token',
      source: { type: 'user', userId },
      timestamp: Date.now(),
      message: { id: messageId, type: 'text', text },
    };
  }

  function normalize(event, aiText) {
    const webhook = { body: { events: [event] } };
    const [result] = vm.runInNewContext(`(function() { ${normalizeCode} })()`, {
      $input: { first: () => ({ json: { output: aiText, responseSource: 'conversation-ai', budgetContext: '' } }) },
      $: () => ({ first: () => ({ json: webhook }) }),
    });
    return result.json;
  }

  async function post(apiPath, body) {
    const response = await fetch(`${base}/api/v1/${apiPath}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${SECRET}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: response.status, json: await response.json() };
  }

  // Mirrors the workflow field mapping (Resolve -> Evaluate -> Persist).
  async function runChain(event, aiText) {
    const n = normalize(event, aiText);
    const resolved = await post('customers/resolve', { lineUserId: n.lineUserId, displayName: n.displayName });
    assert.equal(resolved.status, 200);
    const customerId = resolved.json.customer.id;
    const evaluated = await post('leads/evaluate', { customerId, message: n.incomingMessage, sourceEventId: n.sourceEventId });
    assert.equal(evaluated.status, 200);
    const persisted = await post('drafts', {
      customerId,
      leadId: evaluated.json.lead ? evaluated.json.lead.id : null,
      channel: n.channel,
      incomingMessage: n.incomingMessage,
      draftResponse: n.draftResponse,
      source: n.source,
      aiModel: n.aiModel,
      ruleRevision: n.ruleRevision,
      sourceEventId: n.sourceEventId,
      metadata: { replyToken: n.replyToken, budgetContext: n.budgetContext },
    });
    assert.ok([200, 201].includes(persisted.status));
    const [verified] = vm.runInNewContext(`(function() { ${verifyCode} })()`, {
      $input: { first: () => ({ json: persisted.json }) },
    });
    return { normalized: n, customerId, evaluated: evaluated.json, persisted: persisted.json, verified: verified.json };
  }

  async function counts() {
    const [customers, waiting, audits] = await Promise.all([
      repos.customers.list(),
      repos.drafts.listByStatus('WAITING_FOR_HUMAN'),
      repos.auditLogs.list(),
    ]);
    return { customers: customers.length, waiting: waiting.length, audits: audits.length };
  }

  async function truncateKnownTables() {
    const { default: pg } = await import('pg');
    const pool = new pg.Pool({ connectionString: TEST_URL });
    try {
      for (const table of ['audit_logs', 'drafts', 'leads', 'customers']) {
        await pool.query(`TRUNCATE ${table} RESTART IDENTITY CASCADE`);
      }
    } finally {
      await pool.end();
    }
  }

  test.before(async () => {
    await migrateUp({ DB_ADAPTER: 'postgres', DATABASE_URL: TEST_URL });
    await truncateKnownTables();
  });

  test.after(async () => {
    await truncateKnownTables();
  });

  // A. Greeting: customer, no lead, waiting draft.
  test('A: greeting persists customer + waiting draft, no lead', async () => {
    const before = await counts();
    const run = await runChain(lineEvent('Ue2eA', 'e2e-msg-a', 'สวัสดีครับ'), 'สวัสดีค่ะ สนใจสอบถามได้นะคะ');
    assert.equal(run.evaluated.shouldCreate, false);
    assert.equal(run.evaluated.lead, null);
    assert.equal(run.persisted.draft.status, 'WAITING_FOR_HUMAN');
    assert.equal(run.verified.status, 'WAITING_FOR_HUMAN');
    const after = await counts();
    assert.equal(after.customers, before.customers + 1);
    assert.equal(after.waiting, before.waiting + 1);
  });

  // B. Quote intent with facts: lead per deterministic rules + linked draft.
  test('B: quote request persists lead and linked waiting draft', async () => {
    const run = await runChain(
      lineEvent('Ue2eB', 'e2e-msg-b', 'ขอใบเสนอราคาข้าวกล่อง 50 กล่อง วันที่ 20/12/2026 ส่งสาทร'),
      'รับทราบค่ะ ขอสรุปให้นะคะ',
    );
    assert.equal(run.evaluated.shouldCreate, true);
    assert.equal(run.evaluated.lead.status, 'NEW');
    assert.equal(run.persisted.draft.leadId, run.evaluated.lead.id);
    assert.equal(run.persisted.draft.status, 'WAITING_FOR_HUMAN');
  });

  // C. Same source event retried: no duplicates anywhere.
  test('C: retried event reuses customer, lead, and draft', async () => {
    const event = lineEvent('Ue2eC', 'e2e-msg-c', 'ขอใบเสนอราคาบุฟเฟต์ 30 คน วันที่ 21/12/2026');
    const first = await runChain(event, 'รับทราบค่ะ');
    const draftsBefore = (await repos.drafts.listByStatus('WAITING_FOR_HUMAN')).length;
    const second = await runChain(structuredClone(event), 'รับทราบค่ะ (retry)');
    assert.equal(second.customerId, first.customerId);
    assert.equal(second.evaluated.lead.id, first.evaluated.lead.id);
    assert.equal(second.evaluated.deduped, true);
    assert.equal(second.persisted.draft.id, first.persisted.draft.id);
    assert.equal(second.persisted.deduped, true);
    assert.equal((await repos.drafts.listByStatus('WAITING_FOR_HUMAN')).length, draftsBefore);
  });

  // D. New event from the same customer: same customer, new draft.
  test('D: new event creates a new draft for the same customer', async () => {
    const first = await runChain(lineEvent('Ue2eD', 'e2e-msg-d1', 'สวัสดีครับ'), 'สวัสดีค่ะ');
    const second = await runChain(lineEvent('Ue2eD', 'e2e-msg-d2', 'ขอใบเสนอราคา งบ 70 บาท'), 'รับทราบค่ะ');
    assert.equal(second.customerId, first.customerId);
    assert.notEqual(second.persisted.draft.id, first.persisted.draft.id);
  });

  // E. API unavailable: loud failure, nothing persisted, nothing sent.
  test('E: persistence failure is loud and writes nothing', async () => {
    const n = normalize(lineEvent('Ue2eE', 'e2e-msg-e', 'สวัสดีครับ'), 'สวัสดีค่ะ');
    await assert.rejects(
      fetch('http://127.0.0.1:1/api/v1/customers/resolve', {
        method: 'POST',
        headers: { authorization: `Bearer ${SECRET}`, 'content-type': 'application/json' },
        body: JSON.stringify({ lineUserId: n.lineUserId }),
      }),
      /fetch failed|ECONNREFUSED/,
    );
    assert.equal(await repos.drafts.findBySourceEventId('e2e-msg-e'), null);
  });
}
