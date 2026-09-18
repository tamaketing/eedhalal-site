import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createInternalApi } from '../server/internal-api.mjs';
import { createMemoryAdapter } from '../db/memory.mjs';

test('inbound Internal API auth, validation, transitions and safe responses', async (t) => {
  const secret = randomUUID();
  const { server } = createInternalApi({ repos: createMemoryAdapter(), env: { EED_INTERNAL_API_SECRET: secret } });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  async function call(pathname = '', method = 'POST', body = {}, auth = secret) {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/${pathname}`, {
      method, headers: { 'content-type': 'application/json', ...(auth ? { authorization: `Bearer ${auth}` } : {}) },
      body: method === 'GET' ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  }
  const path = 'inbound-messages';
  const body = { lineUserId: `test-${randomUUID()}`, sourceEventId: randomUUID(), incomingMessage: 'สวัสดี\n"A\\B"\t😊' };
  assert.equal((await call(path, 'POST', body, null)).status, 401);
  assert.equal((await call(path, 'POST', body, 'wrong')).status, 401);
  for (const invalid of [null, [], { incomingMessage: 1 }, { incomingMessage: '' }]) {
    assert.equal((await call(path, 'POST', invalid)).status, 400);
  }
  const result = await call(path, 'POST', { ...body, replyToken: 'test-only-opaque', metadata: { replyToken: 'test-only-opaque' }, status: 'SENT' });
  assert.equal(result.status, 201);
  let row = result.body.inbound;
  assert.equal(row.status, 'RECEIVED');
  assert.ok(!JSON.stringify(row).includes('test-only-opaque'));
  assert.equal((await call(path, 'POST', body)).body.deduped, true);
  const uri = `${path}/${row.id}`;
  assert.equal((await call(uri, 'GET', {}, null)).status, 401);
  assert.equal((await call(`${path}/not-a-uuid`, 'GET')).status, 400);
  assert.equal((await call(`${path}/${randomUUID()}`, 'GET')).status, 404);
  assert.equal((await call(path, 'GET')).status, 404); // No console list endpoint.
  assert.equal((await call(uri, 'PATCH', {})).status, 400);
  const customer = (await call('customers/resolve', 'POST', { lineUserId: body.lineUserId })).body.customer;
  row = (await call(uri, 'PATCH', { customerId: customer.id, expectedRevision: row.revision })).body.inbound;
  assert.equal(row.customerId, customer.id);
  row = (await call(`${uri}/processing`, 'POST', { expectedRevision: row.revision })).body.inbound;
  assert.equal(row.status, 'PROCESSING');
  assert.equal((await call(`${uri}/processing`, 'POST', { expectedRevision: row.revision })).status, 409);
  assert.equal((await call(`${uri}/fail`, 'POST', { expectedRevision: row.revision, errorCode: 'bad' })).status, 400);
  row = (await call(`${uri}/fail`, 'POST', { expectedRevision: row.revision, errorCode: 'AI_RATE_LIMIT', errorDetail: secret })).body.inbound;
  assert.equal(row.status, 'AI_FAILED');
  assert.ok(!JSON.stringify(row).includes(secret));
  row = (await call(`${uri}/retry`, 'POST', { expectedRevision: row.revision })).body.inbound;
  assert.equal(row.retryCount, 1);
  const draft = (await call('drafts', 'POST', { customerId: customer.id, incomingMessage: body.incomingMessage,
    sourceEventId: body.sourceEventId, draftResponse: 'คำตอบ\n\n😊' })).body.draft;
  row = (await call(`${uri}/complete`, 'POST', { expectedRevision: row.revision, draftId: draft.id })).body.inbound;
  assert.equal(row.status, 'DRAFT_CREATED');
  assert.equal(row.draftId, draft.id);
  assert.deepEqual((await call(uri, 'GET')).body.inbound, row);
  assert.equal((await call(path, 'POST', body)).body.inbound.status, 'DRAFT_CREATED');
});
