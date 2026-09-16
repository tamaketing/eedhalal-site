import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createFileAdapter } from '../db/file.mjs';
import { createMemoryAdapter } from '../db/memory.mjs';
import { createPostgresAdapter } from '../db/postgres.mjs';
import { migrateStatus, migrateUp } from '../db/migrate.mjs';
import { findCustomerSenders, findKitchenAutoPush } from '../line-ai/conversation-update.mjs';
import { checkSystem } from '../scripts/check-system.mjs';
import { recordAudit } from '../services/audit.mjs';
import { changeDraftStatus, persistDraft } from '../services/drafts.mjs';
import { extractLeadSignals, maybeCreateLead, setLeadStatus, shouldCreateLead } from '../services/leads.mjs';
import { resolveCustomer } from '../services/customers.mjs';
import { sanitizeMetadata } from '../services/sanitize.mjs';
import { readFile } from 'node:fs/promises';

// Minimal fake for the postgres adapter's query surface: understands the exact
// INSERT/SELECT/UPDATE shapes db/postgres.mjs emits, enforces UNIQUE like
// PostgreSQL (code 23505), and returns JSONB columns as objects.
function createFakePg() {
  const tables = { customers: new Map(), leads: new Map(), drafts: new Map(), audit_logs: new Map() };
  const uniques = { customers: ['line_user_id'], drafts: ['draft_id'] };
  const JSON_COLS = new Set(['metadata', 'history', 'before_data', 'after_data']);
  const duplicate = () => Object.assign(new Error('duplicate key value'), { code: '23505' });
  const decode = (col, value) => (JSON_COLS.has(col) && typeof value === 'string' ? JSON.parse(value) : value);

  async function query(text, params = []) {
    const clean = text.trim().replace(/\s+/g, ' ');
    let match;
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
      }
      const store = tables[table];
      if (!store) throw new Error(`fake pg: unknown table ${table}`);
      if (store.has(row.id)) throw duplicate();
      for (const key of uniques[table] || []) {
        if (row[key] != null && [...store.values()].some((r) => r[key] === row[key])) throw duplicate();
      }
      store.set(row.id, row);
      return { rows: [{ ...row }] };
    }
    if ((match = clean.match(/^SELECT \* FROM (\w+)(?: WHERE (.+?))?(?: ORDER BY created_at ASC)?$/i))) {
      const table = match[1];
      let rows = [...(tables[table] || new Map()).values()];
      const where = match[2];
      if (where) {
        for (const cond of where.split(/\s+AND\s+/i)) {
          const parts = cond.trim().match(/^(\w+) = \$(\d+)$/);
          if (!parts) throw new Error(`fake pg: unsupported condition ${cond}`);
          rows = rows.filter((r) => r[parts[1]] === params[Number(parts[2]) - 1]);
        }
      }
      rows = rows.slice().sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
      return { rows: rows.map((r) => ({ ...r })) };
    }
    if ((match = clean.match(/^UPDATE (\w+) SET (.+) WHERE id = \$(\d+) RETURNING \*$/i))) {
      const table = match[1];
      const store = tables[table];
      const id = params[Number(match[3]) - 1];
      const row = store.get(id);
      if (!row) return { rows: [] };
      for (const part of match[2].split(',').map((s) => s.trim())) {
        if (part === 'updated_at = now()') {
          row.updated_at = new Date().toISOString();
          continue;
        }
        const parts = part.match(/^(\w+) = \$(\d+)$/);
        row[parts[1]] = decode(parts[1], params[Number(parts[2]) - 1]);
      }
      return { rows: [{ ...row }] };
    }
    throw new Error(`fake pg: unsupported query ${clean.slice(0, 80)}`);
  }
  return { query, tables };
}

async function fileRepos() {
  const dir = await mkdtemp(path.join(tmpdir(), 'eed-db-'));
  return { repos: createFileAdapter(dir), cleanup: async () => rm(dir, { recursive: true, force: true }) };
}

async function eachAdapter(name, fn) {
  await fn(`${name}:memory`, createMemoryAdapter());
  const file = await fileRepos();
  try {
    await fn(`${name}:file`, file.repos);
  } finally {
    await file.cleanup();
  }
  await fn(`${name}:postgres-fake`, createPostgresAdapter({ query: createFakePg().query }));
}

// A. Same LINE user resolves to the same customer.
test('A: repeat LINE messages resolve to one customer', async () => {
  await eachAdapter('resolve', async (label, repos) => {
    const first = await resolveCustomer(repos, { lineUserId: 'Uaaa', displayName: 'A' });
    const second = await resolveCustomer(repos, { lineUserId: 'Uaaa', displayName: 'A-renamed' }, { type: 'AI', id: '' });
    assert.equal(first.id, second.id, label);
    assert.equal((await repos.customers.list()).length, 1, label);
  });
});

// B. Concurrent upserts never duplicate the customer.
test('B: concurrent resolves create exactly one customer', async () => {
  await eachAdapter('race', async (label, repos) => {
    const results = await Promise.all(
      Array.from({ length: 20 }, () => resolveCustomer(repos, { lineUserId: 'Urace' })),
    );
    assert.ok(results.every((r) => r.id === results[0].id), label);
    assert.equal((await repos.customers.list()).length, 1, label);
  });
});

// C. Draft persists and reads back identically on every adapter.
test('C: draft round-trips through every adapter', async () => {
  await eachAdapter('draft', async (label, repos) => {
    const customer = await resolveCustomer(repos, { lineUserId: 'Udraft' });
    const saved = await persistDraft(repos, {
      customerId: customer.id, incomingMessage: 'สวัสดี', draftResponse: 'สวัสดีค่ะ',
      aiModel: 'models/gemini-2.5-flash', ruleRevision: '2026-09-16',
      metadata: { replyToken: 'tok', budgetContext: null },
    }, { type: 'AI', id: '' });
    const read = await repos.drafts.findById(saved.id);
    assert.equal(read.draftId, saved.draftId, label);
    assert.equal(read.status, 'WAITING_FOR_HUMAN', label);
    assert.equal(read.incomingMessage, 'สวัสดี', label);
    assert.equal((await repos.drafts.listByStatus('WAITING_FOR_HUMAN')).length, 1, label);
  });
});

// D. Full pipeline ends WAITING_FOR_HUMAN.
test('D: message -> customer -> draft ends WAITING_FOR_HUMAN', async () => {
  const repos = createMemoryAdapter();
  const customer = await resolveCustomer(repos, { lineUserId: 'Uflow' });
  const { lead } = await maybeCreateLead(repos, { customerId: customer.id, message: 'สวัสดีครับ' });
  assert.equal(lead, null);
  const draft = await persistDraft(repos, {
    customerId: customer.id, leadId: null, incomingMessage: 'สวัสดีครับ',
    draftResponse: 'สวัสดีค่ะ สนใจสอบถามได้นะคะ', ruleRevision: '2026-09-16',
  }, { type: 'AI', id: '' });
  assert.equal(draft.status, 'WAITING_FOR_HUMAN');
  assert.equal(draft.leadId, null);
});

// E. Illegal draft transitions are rejected.
test('E: illegal draft transitions throw', async () => {
  const repos = createMemoryAdapter();
  const customer = await resolveCustomer(repos, { lineUserId: 'Ue' });
  const draft = await persistDraft(repos, { customerId: customer.id, incomingMessage: 'x', draftResponse: 'y' });
  await assert.rejects(() => changeDraftStatus(repos, draft.id, 'SENT'), /illegal draft transition/);
  await assert.rejects(() => changeDraftStatus(repos, draft.id, 'WON'), /unknown status/);
  await assert.rejects(() => changeDraftStatus(repos, 'missing', 'APPROVED'), /draft not found/);
  const approved = await changeDraftStatus(repos, draft.id, 'APPROVED');
  assert.equal(approved.status, 'APPROVED');
  assert.ok(approved.approvedAt);
  const sent = await changeDraftStatus(repos, approved.id, 'SENT');
  assert.ok(sent.sentAt);
  await assert.rejects(() => changeDraftStatus(repos, sent.id, 'APPROVED'), /illegal draft transition/);
});

// F. Status changes emit audit events.
test('F: draft lifecycle writes audit events', async () => {
  const repos = createMemoryAdapter();
  const customer = await resolveCustomer(repos, { lineUserId: 'Uf' });
  const draft = await persistDraft(repos, { customerId: customer.id, incomingMessage: 'x', draftResponse: 'y' });
  await changeDraftStatus(repos, draft.id, 'EDITED', { type: 'OWNER', id: 'owner-1' }, { draftResponse: 'edited' });
  const events = await repos.auditLogs.listByEntity('draft', draft.id);
  const actions = events.map((e) => e.action);
  assert.ok(actions.includes('DRAFT_CREATED'), actions.join(','));
  assert.ok(actions.includes('DRAFT_STATUS_CHANGED'), actions.join(','));
  assert.ok(actions.includes('DRAFT_EDITED'), actions.join(','));
  const changed = events.find((e) => e.action === 'DRAFT_STATUS_CHANGED');
  assert.equal(changed.actorType, 'OWNER');
  assert.deepEqual(changed.beforeData, { status: 'WAITING_FOR_HUMAN' });
});

// G. Audit log is append-only.
test('G: audit repository exposes no update or delete', async () => {
  const repos = createMemoryAdapter();
  assert.deepEqual(Object.keys(repos.auditLogs).sort(), ['append', 'kind', 'list', 'listByEntity']);
  await recordAudit(repos, { entityType: 'lead', entityId: 'l1', action: 'LEAD_CREATED', actorType: 'SYSTEM', actorId: '' });
  await assert.rejects(
    recordAudit(repos, { entityType: 'lead', entityId: 'l1', action: 'PAYMENT', actorType: 'SYSTEM', actorId: '' }),
    /unknown audit action/,
  );
  await assert.rejects(
    recordAudit(repos, { entityType: 'lead', entityId: 'l1', action: 'LEAD_CREATED', actorType: 'HUMAN', actorId: '' }),
    /unknown actor type/,
  );
});

// H. Sanitizer keeps secrets out of persisted data.
test('H: metadata sanitizer drops secrets, headers, and token-like values', () => {
  const bearer = `${'Bear'}er ${'x'.repeat(40)}`;
  const cleaned = sanitizeMetadata({
    replyToken: 'tok',
    budgetContext: 'งบ 70',
    headers: { authorization: bearer },
    rawBody: '...',
    lineSecret: 'shhh',
    nested: { apiKey: 'k', ok: 1, deep: { token: 't' } },
    reference: 'z'.repeat(60),
    tags: ['ok', 'y'.repeat(50)],
    note: 'สวัสดีครับ สนใจสั่งข้าวกล่อง '.repeat(200),
  });
  assert.equal(cleaned.replyToken, 'tok');
  assert.equal(cleaned.budgetContext, 'งบ 70');
  assert.ok(!('headers' in cleaned));
  assert.ok(!('rawBody' in cleaned));
  assert.ok(!('lineSecret' in cleaned));
  assert.ok(!('apiKey' in cleaned.nested));
  assert.equal(cleaned.nested.ok, 1);
  assert.ok(!('token' in cleaned.nested.deep));
  assert.ok(!('longToken' in cleaned));
  assert.equal(cleaned.reference, '[redacted]');
  assert.deepEqual(cleaned.tags, ['ok', '[redacted]']);
  assert.ok(cleaned.note.endsWith('[truncated]'));
});

// I. A greeting creates no lead.
test('I: greeting message creates no lead', async () => {
  const repos = createMemoryAdapter();
  const customer = await resolveCustomer(repos, { lineUserId: 'Ugreet' });
  for (const text of ['สวัสดี', 'สวัสดีครับ', 'hello', 'ขอบคุณ']) {
    assert.equal(shouldCreateLead(extractLeadSignals(text)), false, text);
    const { lead } = await maybeCreateLead(repos, { customerId: customer.id, message: text });
    assert.equal(lead, null, text);
  }
  assert.equal((await repos.leads.listByCustomer(customer.id)).length, 0);
});

// J. A qualified catering request creates a lead with extracted fields.
test('J: quote intent with facts creates a NEW lead', async () => {
  const repos = createMemoryAdapter();
  const customer = await resolveCustomer(repos, { lineUserId: 'Uquote' });
  const message = 'ขอใบเสนอราคาบุฟเฟต์ 100 คน วันที่ 20/12/2026 งบ 250 บาท ส่งสาทร';
  const signals = extractLeadSignals(message);
  assert.ok(signals.intent.includes('quote'));
  assert.equal(signals.serviceType, 'buffet');
  assert.equal(signals.quantity, 100);
  assert.equal(signals.eventDate, '2026-12-20');
  assert.equal(signals.budget, 250);
  assert.equal(shouldCreateLead(signals), true);
  const { lead } = await maybeCreateLead(repos, { customerId: customer.id, message });
  assert.equal(lead.status, 'NEW');
  assert.equal(lead.serviceType, 'buffet');
  assert.equal(lead.quantity, 100);
  const draft = await persistDraft(repos, {
    customerId: customer.id, leadId: lead.id, incomingMessage: message,
    draftResponse: 'รับทราบค่ะ', ruleRevision: '2026-09-16',
  });
  assert.equal(draft.leadId, lead.id);
  await assert.rejects(() => setLeadStatus(repos, lead.id, 'QUALIFIED'), /illegal lead transition/);
  const qualifying = await setLeadStatus(repos, lead.id, 'QUALIFYING');
  assert.equal(qualifying.status, 'QUALIFYING');
});

// K. Drafts exist without leads.
test('K: draft persists with null lead', async () => {
  const repos = createMemoryAdapter();
  const customer = await resolveCustomer(repos, { lineUserId: 'Uk' });
  const draft = await persistDraft(repos, { customerId: customer.id, incomingMessage: 'สวัสดี', draftResponse: 'สวัสดีค่ะ' });
  assert.equal(draft.leadId, null);
  assert.equal((await repos.drafts.findById(draft.id)).leadId, null);
});

// L+M. Human approval still holds: no auto-send, no kitchen push.
test('L: workflow still has no customer auto-send path', async () => {
  const workflow = JSON.parse(await readFile(new URL('../line-ai/n8n-workflow.json', import.meta.url), 'utf8'));
  assert.deepEqual(findCustomerSenders(workflow), []);
});

test('M: workflow still has no kitchen auto-push', async () => {
  const workflow = JSON.parse(await readFile(new URL('../line-ai/n8n-workflow.json', import.meta.url), 'utf8'));
  assert.deepEqual(findKitchenAutoPush(workflow), []);
});

// N. Business-rules sync still green.
test('N: business rules source of truth still synchronized', async () => {
  await checkSystem();
});

test('migrations: schemaless adapters report no SQL work', async () => {
  assert.deepEqual((await migrateStatus({ DB_ADAPTER: 'memory' })).pending, []);
  assert.deepEqual((await migrateUp({ DB_ADAPTER: 'memory' })).applied, []);
});
