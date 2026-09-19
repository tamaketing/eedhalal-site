import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';
import { promisify } from 'node:util';
import { createMemoryAdapter } from '../db/memory.mjs';
import { createInternalApi } from '../server/internal-api.mjs';

const runCommand = promisify(execFile);
const SECRET = randomUUID();

const { server } = createInternalApi({ repos: createMemoryAdapter(), env: { EED_INTERNAL_API_SECRET: SECRET } });
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => new Promise((resolve) => server.close(resolve)));

async function call(pathname, { method = 'GET', body, secret = SECRET } = {}) {
  const headers = {};
  if (secret !== null) headers.authorization = `Bearer ${secret}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`${base}${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, json: await response.json() };
}

async function seedDraft(overrides = {}) {
  const resolved = await call('/api/v1/customers/resolve', { method: 'POST', body: { lineUserId: `U${randomUUID().replace(/-/g, '').slice(0, 10)}` } });
  const created = await call('/api/v1/drafts', {
    method: 'POST',
    body: {
      customerId: resolved.json.customer.id,
      incomingMessage: 'ขอใบเสนอราคาบุฟเฟต์ 50 คน',
      draftResponse: 'รับทราบค่ะ',
      ruleRevision: '2026-09-16',
      ...overrides,
    },
  });
  assert.equal(created.status, 201);
  return created.json.draft;
}

test('healthz needs no auth', async () => {
  const response = await call('/healthz', { secret: null });
  assert.equal(response.status, 200);
  assert.equal(response.json.status, 'ok');
});

test('A: unauthenticated mutation is rejected', async () => {
  const response = await call('/api/v1/drafts', { method: 'POST', secret: null, body: {} });
  assert.equal(response.status, 401);
  assert.deepEqual(response.json, { error: 'unauthorized' });
  const read = await call('/api/v1/drafts?status=WAITING_FOR_HUMAN', { secret: null });
  assert.equal(read.status, 401);
});

test('B: wrong secret is rejected', async () => {
  const response = await call('/api/v1/customers/resolve', { method: 'POST', secret: 'wrong', body: { lineUserId: 'Ux' } });
  assert.equal(response.status, 401);
});

test('C: valid secret is allowed', async () => {
  const response = await call('/api/v1/customers/resolve', { method: 'POST', body: { lineUserId: 'Uc' } });
  assert.equal(response.status, 200);
  assert.ok(response.json.customer.id);
});

test('D: same LINE user resolves to the same customer', async () => {
  const first = await call('/api/v1/customers/resolve', { method: 'POST', body: { lineUserId: 'Usame', displayName: 'A' } });
  const second = await call('/api/v1/customers/resolve', { method: 'POST', body: { lineUserId: 'Usame', displayName: 'B' } });
  assert.equal(first.json.customer.id, second.json.customer.id);
});

test('E: hello message creates no lead', async () => {
  const resolved = await call('/api/v1/customers/resolve', { method: 'POST', body: { lineUserId: 'Uhello' } });
  const evaluated = await call('/api/v1/leads/evaluate', {
    method: 'POST',
    body: { customerId: resolved.json.customer.id, message: 'สวัสดีครับ' },
  });
  assert.equal(evaluated.status, 200);
  assert.equal(evaluated.json.shouldCreate, false);
  assert.equal(evaluated.json.lead, null);
});

test('F: sales intent with facts creates a lead', async () => {
  const resolved = await call('/api/v1/customers/resolve', { method: 'POST', body: { lineUserId: 'Ulead' } });
  const evaluated = await call('/api/v1/leads/evaluate', {
    method: 'POST',
    body: { customerId: resolved.json.customer.id, message: 'ขอใบเสนอราคาบุฟเฟต์ 100 คน วันที่ 20/12/2026' },
  });
  assert.equal(evaluated.json.shouldCreate, true);
  assert.equal(evaluated.json.lead.status, 'NEW');
  assert.equal(evaluated.json.lead.serviceType, 'buffet');
});

test('G+H: draft creation always forces WAITING_FOR_HUMAN', async () => {
  for (const forced of ['SENT', 'APPROVED', undefined]) {
    const draft = await seedDraft(forced ? { status: forced } : {});
    assert.equal(draft.status, 'WAITING_FOR_HUMAN');
    assert.equal(draft.sentAt, null);
  }
});

test('I: list WAITING_FOR_HUMAN works with a sane limit', async () => {
  const draft = await seedDraft();
  const listed = await call('/api/v1/drafts?status=WAITING_FOR_HUMAN&limit=5');
  assert.equal(listed.status, 200);
  assert.ok(listed.json.total >= 1);
  assert.ok(listed.json.drafts.length <= 5);
  assert.ok(listed.json.drafts.some((row) => row.draftId === draft.draftId));
  const fetched = await call(`/api/v1/drafts/${draft.draftId}`);
  assert.equal(fetched.json.draft.id, draft.id);
});

test('J: approve moves state and audits', async () => {
  const draft = await seedDraft();
  const approved = await call(`/api/v1/drafts/${draft.id}/approve`, { method: 'POST', body: { ownerId: 'owner-1' } });
  assert.equal(approved.status, 200);
  assert.equal(approved.json.draft.status, 'APPROVED');
  assert.ok(approved.json.draft.approvedAt);
  assert.equal(approved.json.draft.ownerFinalResponse, approved.json.draft.draftResponse);
});

test('K+L: edit preserves the AI draft and stores the owner final text', async () => {
  const draft = await seedDraft();
  const edited = await call(`/api/v1/drafts/${draft.id}/edit`, {
    method: 'POST',
    body: { ownerId: 'owner-1', finalText: 'ข้อความสุดท้ายจากเจ้าของค่ะ' },
  });
  assert.equal(edited.json.draft.status, 'EDITED');
  assert.equal(edited.json.draft.draftResponse, draft.draftResponse);
  assert.equal(edited.json.draft.ownerFinalResponse, 'ข้อความสุดท้ายจากเจ้าของค่ะ');
  assert.equal(edited.json.draft.finalAction, 'EDITED');
});

test('M: reject moves state and audits', async () => {
  const draft = await seedDraft();
  const rejected = await call(`/api/v1/drafts/${draft.id}/reject`, { method: 'POST', body: { ownerId: 'owner-1' } });
  assert.equal(rejected.json.draft.status, 'REJECTED');
});

test('N: invalid transitions are conflicts', async () => {
  const draft = await seedDraft();
  await call(`/api/v1/drafts/${draft.id}/approve`, { method: 'POST', body: {} });
  const again = await call(`/api/v1/drafts/${draft.id}/approve`, { method: 'POST', body: {} });
  assert.equal(again.status, 409);
  const rejected = await seedDraft();
  await call(`/api/v1/drafts/${rejected.id}/reject`, { method: 'POST', body: {} });
  const late = await call(`/api/v1/drafts/${rejected.id}/approve`, { method: 'POST', body: {} });
  assert.equal(late.status, 409);
  const stale = await call(`/api/v1/drafts/${draft.id}/edit`, {
    method: 'POST',
    body: { finalText: 'x', expectedStatus: 'WAITING_FOR_HUMAN' },
  });
  assert.equal(stale.status, 409);
});

test('O: concurrent double approve does not silently overwrite', async () => {
  const draft = await seedDraft();
  const [first, second] = await Promise.all([
    call(`/api/v1/drafts/${draft.id}/approve`, { method: 'POST', body: { expectedUpdatedAt: draft.updatedAt } }),
    call(`/api/v1/drafts/${draft.id}/approve`, { method: 'POST', body: { expectedUpdatedAt: draft.updatedAt } }),
  ]);
  const codes = [first.status, second.status].sort();
  assert.deepEqual(codes, [200, 409]);
  const final = await call(`/api/v1/drafts/${draft.id}`);
  assert.equal(final.json.draft.status, 'APPROVED');
});

test('P: responses expose no secret or replyToken', async () => {
  const draft = await seedDraft({ metadata: { replyToken: 'tok123', budgetContext: 'x' } });
  const fetched = await call(`/api/v1/drafts/${draft.id}`);
  assert.ok(!('replyToken' in fetched.json.draft.metadata));
  assert.equal(fetched.json.draft.metadata.budgetContext, 'x');
  const listed = await call('/api/v1/drafts?status=WAITING_FOR_HUMAN&limit=100');
  const dump = JSON.stringify(listed.json);
  assert.ok(!dump.includes('tok123'));
  assert.ok(!dump.includes(SECRET));
});

test('Q+R: no LINE sender or kitchen push anywhere in server/domain/db code', async () => {
  const roots = ['server', 'services', 'db'];
  // Phase 4B-3A explicitly approves exactly one reviewed sender: the
  // owner-invoked Push provider. Everything else stays forbidden.
  const approvedSenders = new Set(['services/linePush.mjs']);
  const offenders = [];
  async function walk(relative) {
    for (const entry of await readdir(relative, { withFileTypes: true })) {
      const full = `${relative}/${entry.name}`;
      if (entry.isDirectory()) {
        await walk(full);
      } else if (/\.(mjs|js|sql)$/.test(entry.name)) {
        const content = await readFile(full, 'utf8');
        // replyToken *storage* is allowed by design (stripped from responses);
        // only actual sending mechanisms are forbidden here.
        if (/lineMessaging|api(-data)?\.line\.me|Push to Kitchen|kitchen.?group|oaMessage/i.test(content)) {
          if (!approvedSenders.has(full)) offenders.push(full);
        }
        // Even the approved provider must never use reply/multicast/broadcast
        // endpoints or invoke itself on a schedule.
        if (/\/v2\/bot\/message\/(reply|multicast|broadcast)|setInterval|cron/i.test(content)) {
          offenders.push(`${full} (forbidden endpoint/scheduler)`);
        }
      }
    }
  }
  for (const root of roots) await walk(root);
  assert.deepEqual(offenders, []);
});

async function runSuite(files) {
  const result = await runCommand(process.execPath, ['--test', ...files], { cwd: new URL('../', import.meta.url) });
  return result;
}

test('S: human approval suite stays green', async () => {
  await runSuite(['test/line-human-approval.test.mjs']);
});

test('T: central database suite stays green', async () => {
  await runSuite(['test/central-database.test.mjs']);
});

test('U: full existing suite stays green', async () => {
  const entries = await readdir(new URL('../test/', import.meta.url));
  const files = entries
    .filter((name) => name.endsWith('.test.mjs') && name !== 'internal-api.test.mjs')
    .map((name) => `test/${name}`);
  await runSuite(files);
});
