import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createMemoryAdapter } from '../db/memory.mjs';
import { createInternalApi } from '../server/internal-api.mjs';
import { resolveCustomer } from '../services/customers.mjs';
import { approveDraft, persistDraft } from '../services/drafts.mjs';

// HTTP contract for owner-managed response examples. Memory adapter only;
// real PostgreSQL runs in response-examples-postgres.test.mjs. The drafts
// become SENT through the service layer with a stubbed provider — this file
// never contacts LINE.
const SECRET = randomUUID();
const repos = createMemoryAdapter();
const { server } = createInternalApi({ repos, env: { EED_INTERNAL_API_SECRET: SECRET } });
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => new Promise((resolve) => server.close(resolve)));

async function call(pathname, { method = 'GET', body, secret = SECRET, query = '' } = {}) {
  const headers = {};
  if (secret !== null) headers.authorization = `Bearer ${secret}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`${base}${pathname}${query}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, json: await response.json() };
}

async function seedSent(message = 'ขอใบเสนอราคาข้าวกล่อง 5 กล่อง', response = 'รับทราบค่ะ') {
  const customer = await resolveCustomer(repos, { lineUserId: `U${randomUUID().replace(/-/g, '').slice(0, 32)}` });
  const draft = await persistDraft(repos, {
    customerId: customer.id, incomingMessage: message, draftResponse: response,
  }, { type: 'AI', id: '' });
  await approveDraft(repos, draft.id, { ownerId: 'owner' });
  const { sendDraft } = await import('../services/drafts.mjs');
  await sendDraft(repos, draft.id, {}, { push: async () => ({ outcome: 'ACCEPTED', code: 'HTTP_200', httpStatus: 200 }), token: 't' });
  return repos.drafts.findById(draft.id);
}

test('unauthenticated example writes are rejected', async () => {
  assert.equal((await call('/api/v1/response-examples/from-draft/x', { method: 'POST', secret: null, body: {} })).status, 401);
  assert.equal((await call('/api/v1/response-examples', { secret: null })).status, 401);
});

test('opt-in creates once, dedupes on re-opt-in, validates input', async () => {
  const sent = await seedSent();
  const first = await call(`/api/v1/response-examples/from-draft/${sent.id}`, { method: 'POST', body: { ownerId: 'owner' } });
  assert.equal(first.status, 201);
  assert.equal(first.json.deduped, false);
  assert.equal(first.json.example.intent, 'quotation');
  assert.ok(!('sourceDraftId' in first.json.example || 'fingerprint' in first.json.example));
  const second = await call(`/api/v1/response-examples/from-draft/${sent.id}`, { method: 'POST', body: {} });
  assert.equal(second.status, 200);
  assert.equal(second.json.deduped, true);
  assert.equal(second.json.example.id, first.json.example.id);
  assert.equal((await call('/api/v1/response-examples/from-draft/not-a-uuid', { method: 'POST', body: {} })).status, 400);
  assert.equal((await call(`/api/v1/response-examples/from-draft/${randomUUID()}`, { method: 'POST', body: {} })).status, 404);
  const waiting = await persistDraft(repos, { customerId: sent.customerId, incomingMessage: 'สวัสดี', draftResponse: 'hi' }, { type: 'AI', id: '' });
  assert.equal((await call(`/api/v1/response-examples/from-draft/${waiting.id}`, { method: 'POST', body: {} })).status, 409);
});

test('list/get/patch manage examples without touching source texts', async () => {
  const sent = await seedSent('ค่าส่งคิดอย่างไร', 'ค่าส่งตามระยะทางค่ะ');
  const created = await call(`/api/v1/response-examples/from-draft/${sent.id}`, { method: 'POST', body: { styleTags: ['concise'] } });
  const id = created.json.example.id;
  assert.deepEqual((await call(`/api/v1/response-examples/${id}`)).json.example.styleTags, ['concise']);
  assert.ok((await call('/api/v1/response-examples')).json.examples.some((e) => e.id === id));
  assert.equal((await call('/api/v1/response-examples', { query: '?intent=quotation' })).json.examples.length >= 1, true);
  assert.equal((await call('/api/v1/response-examples', { query: '?reusable=maybe' })).status, 400);
  const disabled = await call(`/api/v1/response-examples/${id}`, { method: 'PATCH', body: { reusable: false } });
  assert.equal(disabled.json.example.reusable, false);
  assert.equal((await call('/api/v1/response-examples', { query: '?reusable=true' })).json.examples.some((e) => e.id === id), false);
  assert.equal((await call(`/api/v1/response-examples/${id}`, { method: 'PATCH', body: { sourceDraftId: randomUUID() } })).status, 400);
  assert.equal((await call(`/api/v1/response-examples/${id}`, { method: 'PATCH', body: { intent: 'bogus' } })).status, 400);
  assert.equal((await call(`/api/v1/response-examples/${randomUUID()}`, { method: 'PATCH', body: { reusable: true } })).status, 404);
});
