import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createMemoryAdapter } from '../db/memory.mjs';
import { createInternalApi } from '../server/internal-api.mjs';

// B2.5 Step 3: drives the candidate's EXACT node sequence (Persist Inbound ->
// Inspect -> Resolve -> Attach -> Mark PROCESSING -> [AI] -> Evaluate ->
// Persist Draft -> Complete, plus the Fail branch) against the committed
// Step 2 service/API using synthetic b25step3-* identifiers on an isolated
// in-memory adapter. No n8n, no LINE, no production database, no Gemini.

const SECRET = randomUUID();
const { server } = createInternalApi({ repos: createMemoryAdapter(), env: { EED_INTERNAL_API_SECRET: SECRET } });
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => new Promise((resolve) => server.close(resolve)));

async function call(method, path, body) {
  const res = await fetch(`${base}/api/v1/${path}`, {
    method,
    headers: { authorization: `Bearer ${SECRET}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

const tag = (s) => `b25step3-${s}`;
const MSG = 'ขอใบเสนอราคาข้าวกล่อง 50 กล่อง วันที่ 20 ส่งสาทร\n"รอบสอง"\tA\\B 😊';

test('candidate success path: RECEIVED -> PROCESSING -> DRAFT_CREATED, draft WAITING', async () => {
  const event = tag(`ok-${randomUUID()}`);
  // Persist Inbound
  const p = await call('POST', 'inbound-messages', { lineUserId: tag('user'), sourceEventId: event, incomingMessage: MSG });
  assert.equal(p.status, 201);
  assert.equal(p.json.inbound.status, 'RECEIVED');
  assert.equal(p.json.deduped, false);
  // Inspect: RECEIVED continues
  assert.equal(p.json.inbound.status, 'RECEIVED');
  // Resolve + Attach
  const c = await call('POST', 'customers/resolve', { lineUserId: tag('user') });
  const a = await call('PATCH', `inbound-messages/${p.json.inbound.id}`, { customerId: c.json.customer.id, expectedRevision: p.json.inbound.revision });
  assert.equal(a.json.inbound.customerId, c.json.customer.id);
  // Mark Processing
  const m = await call('POST', `inbound-messages/${a.json.inbound.id}/processing`, { expectedRevision: a.json.inbound.revision });
  assert.equal(m.json.inbound.status, 'PROCESSING');
  // Evaluate + Persist Draft (synthetic AI text stands in for the AI node)
  const e = await call('POST', 'leads/evaluate', { customerId: c.json.customer.id, message: MSG, sourceEventId: event });
  assert.ok(e.json.lead && e.json.lead.status === 'NEW');
  const d = await call('POST', 'drafts', {
    customerId: c.json.customer.id, leadId: e.json.lead.id, incomingMessage: MSG,
    draftResponse: 'รับทราบค่ะ\nรายละเอียด "50 กล่อง"\t😊', sourceEventId: event,
  });
  assert.equal(d.json.draft.status, 'WAITING_FOR_HUMAN');
  assert.equal(d.json.draft.draftResponse, 'รับทราบค่ะ\nรายละเอียด "50 กล่อง"\t😊');
  // Complete Inbound
  const done = await call('POST', `inbound-messages/${m.json.inbound.id}/complete`, {
    expectedRevision: m.json.inbound.revision, leadId: e.json.lead.id, draftId: d.json.draft.id,
  });
  assert.equal(done.json.inbound.status, 'DRAFT_CREATED');
  assert.equal(done.json.inbound.draftId, d.json.draft.id);
  assert.equal(done.json.inbound.leadId, e.json.lead.id);
});

test('candidate AI-failure path: AI_FAILED persists, redelivery stops quietly', async () => {
  const event = tag(`fail-${randomUUID()}`);
  const user = tag('failuser');
  const p = await call('POST', 'inbound-messages', { lineUserId: user, sourceEventId: event, incomingMessage: MSG });
  const c = await call('POST', 'customers/resolve', { lineUserId: user });
  const a = await call('PATCH', `inbound-messages/${p.json.inbound.id}`, { customerId: c.json.customer.id, expectedRevision: p.json.inbound.revision });
  const m = await call('POST', `inbound-messages/${a.json.inbound.id}/processing`, { expectedRevision: a.json.inbound.revision });
  // AI fails -> Classify -> Fail Inbound (no Gemini involved in this harness)
  const f = await call('POST', `inbound-messages/${m.json.inbound.id}/fail`, {
    expectedRevision: m.json.inbound.revision, errorCode: 'AI_RATE_LIMIT', errorDetail: 'HTTP 429 quota exceeded',
  });
  assert.equal(f.json.inbound.status, 'AI_FAILED');
  assert.equal(f.json.inbound.aiErrorCode, 'AI_RATE_LIMIT');
  // Redeliver the SAME event: existing AI_FAILED row, deduped, no new audit.
  const r = await call('POST', 'inbound-messages', { lineUserId: user, sourceEventId: event, incomingMessage: MSG });
  assert.equal(r.json.deduped, true);
  assert.equal(r.json.inbound.id, p.json.inbound.id);
  assert.equal(r.json.inbound.status, 'AI_FAILED');
});

test('candidate stale revision stops safely with 409', async () => {
  const event = tag(`cas-${randomUUID()}`);
  const p = await call('POST', 'inbound-messages', { lineUserId: tag('casuser'), sourceEventId: event, incomingMessage: 'hi' });
  const m = await call('POST', `inbound-messages/${p.json.inbound.id}/processing`, { expectedRevision: p.json.inbound.revision });
  assert.equal(m.status, 200);
  const stale = await call('POST', `inbound-messages/${p.json.inbound.id}/processing`, { expectedRevision: p.json.inbound.revision });
  assert.equal(stale.status, 409);
});
