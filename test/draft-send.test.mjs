import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createMemoryAdapter } from '../db/memory.mjs';
import { sendDraft } from '../services/drafts.mjs';
import { persistDraft } from '../services/drafts.mjs';
import { resolveCustomer } from '../services/customers.mjs';
import { createInternalApi } from '../server/internal-api.mjs';

// Owner-send backend tests. The LINE provider is always stubbed here; no test
// contacts api.line.me. Concurrency, CAS fencing, and settle-failure paths run
// against the memory adapter (PostgreSQL fencing is proven by db-contract).

const TOKEN = 'test-server-side-token';
const SECRET = randomUUID();
const userId = () => `U${randomUUID().replace(/-/g, '').slice(0, 32)}`;

async function seed(repos, overrides = {}) {
  const customer = await resolveCustomer(repos, { lineUserId: userId() });
  const draft = await persistDraft(repos, {
    customerId: customer.id,
    incomingMessage: 'ขอใบเสนอราคา',
    draftResponse: 'รับทราบค่ะ',
    ruleRevision: '2026-09-16',
    ...overrides,
  }, { type: 'AI', id: '' });
  return { customer, draft };
}

function stubPush(outcome = { outcome: 'ACCEPTED', code: 'HTTP_200', httpStatus: 200 }) {
  const calls = [];
  const push = async (args) => {
    calls.push({ ...args });
    return { ...outcome };
  };
  return { calls, push };
}

test('WAITING freezes mirror text and marks SENT on provider accept', async () => {
  const repos = createMemoryAdapter();
  const { draft } = await seed(repos);
  const { calls, push } = stubPush();
  const out = await sendDraft(repos, draft.id, {}, { push, token: TOKEN });
  assert.equal(out.draft.status, 'SENT');
  assert.ok(out.draft.sentAt);
  assert.equal(out.draft.ownerFinalResponse, 'รับทราบค่ะ');
  assert.equal(out.draft.draftResponse, 'รับทราบค่ะ');
  assert.equal(out.send.outcome, 'ACCEPTED');
  assert.equal(calls.length, 1);
  assert.match(calls[0].retryKey, /^[0-9a-f-]{36}$/i);
  const events = await repos.auditLogs.listByEntity('draft', draft.id);
  const actions = events.map((e) => e.action);
  for (const want of ['DRAFT_APPROVED', 'DRAFT_SENT', 'DRAFT_STATUS_CHANGED']) {
    assert.ok(actions.includes(want), want);
  }
});

test('EDITED freezes edited text and preserves AI original', async () => {
  const repos = createMemoryAdapter();
  const { draft } = await seed(repos);
  const { editDraft } = await import('../services/drafts.mjs');
  await editDraft(repos, draft.id, { ownerId: 'owner', finalText: 'ข้อความเจ้าของ' });
  const { push } = stubPush();
  const out = await sendDraft(repos, draft.id, {}, { push, token: TOKEN });
  assert.equal(out.draft.status, 'SENT');
  assert.equal(out.draft.ownerFinalResponse, 'ข้อความเจ้าของ');
  assert.equal(out.draft.draftResponse, 'รับทราบค่ะ');
});

test('double click yields one provider call and one 409', async () => {
  const repos = createMemoryAdapter();
  const { draft } = await seed(repos);
  const { calls, push } = stubPush();
  const attempt = (extra) => sendDraft(repos, draft.id, { expectedUpdatedAt: draft.updatedAt, ...extra }, { push, token: TOKEN });
  const [first, second] = await Promise.allSettled([attempt(), attempt()]);
  const ok = [first, second].filter((r) => r.status === 'fulfilled');
  const failed = [first, second].filter((r) => r.status === 'rejected');
  assert.equal(ok.length, 1);
  assert.equal(failed.length, 1);
  assert.match(failed[0].reason.message, /stale|is SENT/);
  assert.equal(calls.length, 1);
  assert.equal((await repos.drafts.findById(draft.id)).status, 'SENT');
});

test('stale revision is 409 with zero provider calls', async () => {
  const repos = createMemoryAdapter();
  const { draft } = await seed(repos);
  const { calls, push } = stubPush();
  await sendDraft(repos, draft.id, {}, { push, token: TOKEN });
  await assert.rejects(
    sendDraft(repos, draft.id, { expectedUpdatedAt: draft.updatedAt }, { push, token: TOKEN }),
    /stale draft|is SENT/,
  );
  assert.equal(calls.length, 1);
});

test('SENT and REJECTED can never send again', async () => {
  const repos = createMemoryAdapter();
  const { draft } = await seed(repos);
  const { calls, push } = stubPush();
  await sendDraft(repos, draft.id, {}, { push, token: TOKEN });
  await assert.rejects(sendDraft(repos, draft.id, {}, { push, token: TOKEN }), /is SENT/);
  const { rejectDraft } = await import('../services/drafts.mjs');
  const { draft: waiting } = await seed(repos);
  await rejectDraft(repos, waiting.id, { ownerId: 'owner' });
  await assert.rejects(sendDraft(repos, waiting.id, {}, { push, token: TOKEN }), /is REJECTED/);
  assert.equal(calls.length, 1);
});

test('missing LINE identity and missing token fail before provider', async () => {
  const repos = createMemoryAdapter();
  const { calls, push } = stubPush();
  const orphan = await persistDraft(repos, {
    customerId: (await resolveCustomer(repos, { lineUserId: null })).id,
    incomingMessage: 'hi', draftResponse: 'hello',
  }, { type: 'AI', id: '' });
  await assert.rejects(sendDraft(repos, orphan.id, {}, { push, token: TOKEN }), /LINE user identity/);
  const { draft } = await seed(repos);
  await assert.rejects(sendDraft(repos, draft.id, {}, { push }), /not configured/);
  assert.equal(calls.length, 0);
});

test('provider 4xx marks FAILED; timeout/5xx stay APPROVED for explicit retry', async () => {
  for (const [outcome, terminal] of [
    [{ outcome: 'NON_RETRYABLE_FAILURE', code: 'HTTP_400', httpStatus: 400 }, 'FAILED'],
    [{ outcome: 'RETRYABLE_FAILURE', code: 'TIMEOUT' }, 'APPROVED'],
    [{ outcome: 'RETRYABLE_FAILURE', code: 'HTTP_503', httpStatus: 503 }, 'APPROVED'],
  ]) {
    const repos = createMemoryAdapter();
    const { draft } = await seed(repos);
    const { push } = stubPush(outcome);
    const out = await sendDraft(repos, draft.id, {}, { push, token: TOKEN });
    assert.equal(out.draft.status, terminal, outcome.code);
    assert.equal(out.send.code, outcome.code);
  }
  const repos = createMemoryAdapter();
  const { draft } = await seed(repos);
  const { push } = stubPush({ outcome: 'NON_RETRYABLE_FAILURE', code: 'HTTP_400', httpStatus: 400 });
  await sendDraft(repos, draft.id, {}, { push, token: TOKEN });
  const events = await repos.auditLogs.listByEntity('draft', draft.id);
  assert.ok(events.map((e) => e.action).includes('LINE_SEND_FAILED'));
});

test('retry reuses the same key and payload, accepted-409 completes', async () => {
  const repos = createMemoryAdapter();
  const { draft } = await seed(repos);
  const calls = [];
  let mode = 'timeout';
  const push = async (args) => {
    calls.push({ ...args });
    return mode === 'timeout'
      ? { outcome: 'RETRYABLE_FAILURE', code: 'TIMEOUT' }
      : { outcome: 'ALREADY_ACCEPTED', code: 'HTTP_409_ACCEPTED', httpStatus: 409 };
  };
  const first = await sendDraft(repos, draft.id, {}, { push, token: TOKEN });
  assert.equal(first.draft.status, 'APPROVED');
  mode = 'accepted';
  const row = await repos.drafts.findById(draft.id);
  const second = await sendDraft(repos, draft.id, { expectedUpdatedAt: row.updatedAt }, { push, token: TOKEN });
  assert.equal(second.draft.status, 'SENT');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].retryKey, calls[1].retryKey);
  assert.deepEqual(
    { to: calls[0].userId, text: calls[0].text },
    { to: calls[1].userId, text: calls[1].text },
  );
});

test('DB failure after provider accept retains the recoverable frozen attempt', async () => {
  const repos = createMemoryAdapter();
  const { draft } = await seed(repos);
  const keys = [];
  const push = async (args) => { keys.push(args.retryKey); return { outcome: 'ACCEPTED', code: 'HTTP_200', httpStatus: 200 }; };
  let settles = 0;
  const broken = {
    ...repos,
    transaction: (fn) => repos.transaction((tx) => fn({
      ...tx,
      drafts: {
        ...tx.drafts,
        updateIfCurrent: async (...args) => {
          settles += 1;
          if (settles === 2) throw new Error('injected settle failure');
          return tx.drafts.updateIfCurrent(...args);
        },
      },
    })),
  };
  await assert.rejects(sendDraft(broken, draft.id, {}, { push, token: TOKEN }), /injected settle failure/);
  const kept = await repos.drafts.findById(draft.id);
  assert.equal(kept.status, 'APPROVED');
  assert.equal(kept.metadata.sendAttempt.key, keys[0]);
  // Recovery retries the SAME key and completes.
  const recovered = await sendDraft(repos, draft.id, {}, { push, token: TOKEN });
  assert.equal(recovered.draft.status, 'SENT');
  assert.equal(keys.length, 2);
  assert.equal(keys[0], keys[1]);
});

test('APPROVED without attempt freezes safely; FAILED never auto-sends', async () => {
  const repos = createMemoryAdapter();
  const { approveDraft } = await import('../services/drafts.mjs');
  const { draft } = await seed(repos);
  await approveDraft(repos, draft.id, { ownerId: 'owner' });
  const { push } = stubPush();
  const out = await sendDraft(repos, draft.id, {}, { push, token: TOKEN });
  assert.equal(out.draft.status, 'SENT');
  const { draft: bad } = await seed(repos);
  const { push: failing } = stubPush({ outcome: 'NON_RETRYABLE_FAILURE', code: 'HTTP_400', httpStatus: 400 });
  await sendDraft(repos, bad.id, {}, { push: failing, token: TOKEN });
  assert.equal((await repos.drafts.findById(bad.id)).status, 'FAILED');
  await assert.rejects(sendDraft(repos, bad.id, {}, { push, token: TOKEN }), /recover through WAITING/);
});

test('no auto-send machinery exists in services or server', async () => {
  const { readFile } = await import('node:fs/promises');
  const sources = await Promise.all(
    ['services/drafts.mjs', 'services/linePush.mjs', 'server/internal-api.mjs'].map((f) => readFile(new URL(`../${f}`, import.meta.url), 'utf8')),
  );
  const joined = sources.join('\n');
  assert.ok(!/setInterval/.test(joined));
  assert.ok(!/autoSend|scheduleSend|startSendLoop|sendAll|sendPending/i.test(joined));
});

// --- HTTP API surface: auth, routing, override immunity, ordering, context.
// The global fetch is stubbed ONLY for api.line.me; all other requests pass
// through to the real local API server. SECRET values here are synthetic.
test('send endpoint auth, routing, override immunity, and ordering', async (t) => {
  const realFetch = globalThis.fetch;
  const providerCalls = [];
  globalThis.fetch = async (url, options) => {
    if (typeof url === 'string' && url.includes('api.line.me')) {
      providerCalls.push({ url, options });
      return { status: 200, text: async () => '{}' };
    }
    return realFetch(url, options);
  };
  t.after(() => { globalThis.fetch = realFetch; });

  const { server } = createInternalApi({
    repos: createMemoryAdapter(),
    env: { EED_INTERNAL_API_SECRET: SECRET, LINE_CHANNEL_ACCESS_TOKEN: 'test-push-token' },
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function call(pathname, { method = 'GET', body, secret = SECRET } = {}) {
    const headers = {};
    if (secret !== null) headers.authorization = `Bearer ${secret}`;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const response = await fetch(`${base}${pathname}`, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, json: await response.json() };
  }
  async function seedApi() {
    const lineUserId = userId();
    const resolved = await call('/api/v1/customers/resolve', { method: 'POST', body: { lineUserId } });
    const created = await call('/api/v1/drafts', { method: 'POST', body: {
      customerId: resolved.json.customer.id, incomingMessage: 'hi', draftResponse: 'hello',
    } });
    return { customer: resolved.json.customer, draft: created.json.draft };
  }

  await t.test('unauthenticated send is 401', async () => {
    const { draft } = await seedApi();
    assert.equal((await call(`/api/v1/drafts/${draft.id}/send`, { method: 'POST', secret: null, body: {} })).status, 401);
  });
  await t.test('unknown draft is 404, malformed body is 400', async () => {
    assert.equal((await call(`/api/v1/drafts/${randomUUID()}/send`, { method: 'POST', body: {} })).status, 404);
    assert.equal((await call('/api/v1/drafts?order=bogus')).status, 400);
  });
  await t.test('HTTP double click sends exactly once', async () => {
    const { draft } = await seedApi();
    const before = providerCalls.length;
    const [a, b] = await Promise.allSettled([
      call(`/api/v1/drafts/${draft.id}/send`, { method: 'POST', body: { expectedUpdatedAt: draft.updatedAt } }),
      call(`/api/v1/drafts/${draft.id}/send`, { method: 'POST', body: { expectedUpdatedAt: draft.updatedAt } }),
    ]);
    const statuses = [a, b].map((r) => (r.status === 'fulfilled' ? r.value.status : 'threw')).sort();
    assert.deepEqual(statuses, [200, 409]);
    assert.equal(providerCalls.length, before + 1);
  });
  await t.test('browser-supplied recipient/message cannot override frozen values', async () => {
    const { customer, draft } = await seedApi();
    const evil = await call(`/api/v1/drafts/${draft.id}/send`, { method: 'POST', body: {
      customerId: randomUUID(), message: 'evil', retryKey: randomUUID(), token: 'evil',
    } });
    assert.equal(evil.status, 200);
    assert.equal(evil.json.draft.status, 'SENT');
    const sent = JSON.parse(providerCalls[providerCalls.length - 1].options.body);
    assert.equal(sent.to, customer.lineUserId);
    assert.equal(sent.messages[0].text, 'hello');
  });
  await t.test('order=desc returns newest first; default stays asc', async () => {
    const first = (await seedApi()).draft;
    const second = (await seedApi()).draft;
    const desc = await call('/api/v1/drafts?status=WAITING_FOR_HUMAN&limit=100&order=desc');
    const ids = desc.json.drafts.map((d) => d.id);
    assert.ok(ids.indexOf(second.id) < ids.indexOf(first.id));
    const asc = await call('/api/v1/drafts?status=WAITING_FOR_HUMAN&limit=100');
    assert.deepEqual(asc.json.order, 'asc');
  });
  await t.test('detail embeds customer and lead; list embeds customer', async () => {
    const { customer, draft } = await seedApi();
    const detail = await call(`/api/v1/drafts/${draft.id}`);
    assert.equal(detail.json.draft.customer.id, customer.id);
    assert.equal(detail.json.draft.lead, null);
    const list = await call('/api/v1/drafts?status=WAITING_FOR_HUMAN&limit=100');
    assert.equal(list.json.drafts.find((d) => d.id === draft.id).customer.id, customer.id);
    assert.ok(!JSON.stringify(list.json).includes('replyToken'));
  });
  await t.test('edit-after-approve and reject-after-sent stay rejected', async () => {
    const { draft } = await seedApi();
    await call(`/api/v1/drafts/${draft.id}/approve`, { method: 'POST', body: {} });
    assert.equal((await call(`/api/v1/drafts/${draft.id}/edit`, { method: 'POST', body: { finalText: 'late' } })).status, 409);
    await call(`/api/v1/drafts/${draft.id}/send`, { method: 'POST', body: {} });
    assert.equal((await call(`/api/v1/drafts/${draft.id}/reject`, { method: 'POST', body: {} })).status, 409);
    assert.equal((await call(`/api/v1/drafts/${draft.id}/send`, { method: 'POST', body: {} })).status, 409);
  });
});

test('send without server token fails closed and preserves WAITING', async () => {
  const { server } = createInternalApi({ repos: createMemoryAdapter(), env: { EED_INTERNAL_API_SECRET: SECRET } });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const post = async (path, body) => {
      const res = await fetch(`${base}${path}`, { method: 'POST',
        headers: { authorization: `Bearer ${SECRET}`, 'content-type': 'application/json' },
        body: JSON.stringify(body) });
      return { status: res.status, json: await res.json() };
    };
    const resolved = await post('/api/v1/customers/resolve', { lineUserId: userId() });
    const created = await post('/api/v1/drafts', { customerId: resolved.json.customer.id, incomingMessage: 'hi', draftResponse: 'hello' });
    const sent = await post(`/api/v1/drafts/${created.json.draft.id}/send`, {});
    assert.equal(sent.status, 503);
    assert.equal(sent.json.error, 'send_not_configured');
    const read = await (await fetch(`${base}/api/v1/drafts/${created.json.draft.id}`, { headers: { authorization: `Bearer ${SECRET}` } })).json();
    assert.equal(read.draft.status, 'WAITING_FOR_HUMAN');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
