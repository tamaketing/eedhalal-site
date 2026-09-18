import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { receiveInboundMessage, attachCustomer, markProcessing, markFailed, retryInbound, completeInbound } from '../services/inboundMessages.mjs';
import { resolveCustomer } from '../services/customers.mjs';
import { maybeCreateLead } from '../services/leads.mjs';
import { persistDraftOnce } from '../services/drafts.mjs';
import { presentInboundMessage } from '../server/present.mjs';

// Run the SAME behavioral contract against memory, file, fake PG and real PG.
export async function inboundContract(t, repos, { rollback = true } = {}) {
  const input = (extra = {}) => ({ sourceEventId: randomUUID(), lineUserId: `test-${randomUUID()}`,
    incomingMessage: 'ขอใบเสนอราคาข้าวกล่อง 50 กล่อง ส่งสาทร', ...extra });
  const receive = async (extra) => (await receiveInboundMessage(repos, input(extra))).inbound;
  const processing = async () => { const row = await receive(); return markProcessing(repos, row.id, { expectedRevision: row.revision }); };
  const events = (row) => repos.auditLogs.listByEntity('inbound_message', row.id);
  const options = (row, extra = {}) => ({ expectedRevision: row.revision, ...extra });

  await t.test('receive initializes immutable transport, status and timestamps', async () => {
    const row = await receive();
    assert.equal(row.status, 'RECEIVED');
    assert.equal(row.retryCount, 0);
    assert.equal(row.revision, 0);
    assert.equal(row.customerId, null);
    assert.ok(row.createdAt && row.updatedAt);
    assert.deepEqual((await events(row)).map((e) => e.action), ['INBOUND_RECEIVED']);
  });
  await t.test('duplicate receive creates one row and one receipt audit', async () => {
    const body = input();
    const a = await receiveInboundMessage(repos, body);
    const b = await receiveInboundMessage(repos, body);
    assert.equal(a.deduped, false);
    assert.equal(b.deduped, true);
    assert.deepEqual(b.inbound, a.inbound);
    assert.equal((await events(a.inbound)).length, 1);
  });
  await t.test('20 concurrent receives converge without duplicate audits', async () => {
    const body = input();
    const rows = await Promise.all(Array.from({ length: 20 }, () => receiveInboundMessage(repos, body)));
    assert.equal(new Set(rows.map((r) => r.inbound.id)).size, 1);
    assert.equal(rows.filter((r) => !r.deduped).length, 1);
    assert.equal((await events(rows[0].inbound)).length, 1);
  });
  await t.test('null event IDs create distinct receipts', async () => {
    const a = await receive({ sourceEventId: null });
    const b = await receive({ sourceEventId: null });
    assert.notEqual(a.id, b.id);
  });
  await t.test('multiline, CR, quotes, backslash, tab, Thai and emoji round-trip exactly', async () => {
    const message = 'บรรทัดแรก\n\nบรรทัดที่สอง\r\nลูกค้าบอกว่า "ขอใบเสนอราคา"\tA\\B\nข้าวกล่องฮาลาล 😊';
    const row = await receive({ incomingMessage: message });
    assert.equal((await repos.inboundMessages.findById(row.id)).incomingMessage, message);
  });
  await t.test('transport tokens, raw payload and arbitrary metadata never persist or present', async () => {
    const privateValue = randomUUID();
    const row = await receive({ replyToken: privateValue, rawBody: privateValue,
      metadata: { replyToken: privateValue, headers: { authorization: privateValue }, nested: { token: privateValue } } });
    const read = await repos.inboundMessages.findById(row.id);
    assert.deepEqual(read.metadata, {});
    assert.ok(!JSON.stringify(read).includes(privateValue));
    assert.ok(!JSON.stringify(presentInboundMessage({ ...read, replyToken: privateValue })).includes(privateValue));
    assert.ok(!JSON.stringify(await events(row)).includes(privateValue));
  });
  await t.test('invalid types, oversized IDs and NUL fail validation without persistence', async () => {
    for (const body of [null, [], input({ sourceEventId: 'x'.repeat(129) }), input({ incomingMessage: '\u0000' }),
      input({ channel: 'other' }), input({ messageType: 'other' }), input({ incomingMessage: 123 })]) {
      await assert.rejects(receiveInboundMessage(repos, body), { name: 'ValidationError' });
    }
  });
  await t.test('customer attachment validates identity, existence and conflicting linkage', async () => {
    const row = await receive();
    const customer = await resolveCustomer(repos, { lineUserId: row.lineUserId });
    const attached = await attachCustomer(repos, row.id, options(row, { customerId: customer.id }));
    assert.equal(attached.customerId, customer.id);
    const other = await resolveCustomer(repos, { lineUserId: `test-${randomUUID()}` });
    await assert.rejects(attachCustomer(repos, row.id, options(attached, { customerId: other.id })), { name: 'ConflictError' });
    await assert.rejects(attachCustomer(repos, row.id, options(attached, { customerId: randomUUID() })), { name: 'NotFoundError' });
  });
  await t.test('concurrent conflicting attachments have exactly one winner', async () => {
    const row = await receive({ lineUserId: null });
    const customers = await Promise.all([1, 2].map(() => resolveCustomer(repos, { lineUserId: `test-${randomUUID()}` })));
    const results = await Promise.allSettled(customers.map((c) => attachCustomer(repos, row.id, options(row, { customerId: c.id }))));
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(results.find((r) => r.status === 'rejected').reason.name, 'ConflictError');
  });
  await t.test('only one concurrent RECEIVED -> PROCESSING succeeds', async () => {
    const row = await receive();
    const results = await Promise.allSettled([1, 2].map(() => markProcessing(repos, row.id, options(row))));
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal((await repos.inboundMessages.findById(row.id)).status, 'PROCESSING');
  });
  for (const errorCode of ['AI_RATE_LIMIT', 'AI_TIMEOUT', 'AI_PROVIDER_ERROR', 'AI_INVALID_RESPONSE']) {
    await t.test(`${errorCode} is stored safely, original message preserved`, async () => {
      const row = await processing();
      const arbitrarySecret = randomUUID();
      const failed = await markFailed(repos, row.id, options(row, { errorCode, errorDetail: `password=${arbitrarySecret} ${'x'.repeat(800)}` }));
      assert.equal(failed.status, 'AI_FAILED');
      assert.equal(failed.aiErrorCode, errorCode);
      assert.ok(failed.aiErrorDetail.length <= 500);
      assert.ok(!JSON.stringify(failed).includes(arbitrarySecret));
      assert.equal(failed.incomingMessage, row.incomingMessage);
      assert.deepEqual((await events(row)).map((e) => e.action), ['INBOUND_RECEIVED', 'INBOUND_FAILED']);
    });
  }
  await t.test('retry increments once under concurrency and fences callbacks from old attempt', async () => {
    const row = await processing();
    const failed = await markFailed(repos, row.id, options(row, { errorCode: 'AI_TIMEOUT' }));
    const results = await Promise.allSettled([1, 2].map(() => retryInbound(repos, row.id, options(failed))));
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    const retried = await repos.inboundMessages.findById(row.id);
    assert.equal(retried.status, 'PROCESSING');
    assert.equal(retried.retryCount, 1);
    assert.equal(retried.aiErrorCode, null);
    await assert.rejects(markFailed(repos, row.id, options(row, { errorCode: 'AI_TIMEOUT' })), { name: 'ConflictError' });
    assert.equal((await events(row)).filter((e) => e.action === 'INBOUND_RETRIED').length, 1);
  });
  await t.test('invalid transitions and missing revision are rejected', async () => {
    const row = await receive();
    await assert.rejects(markProcessing(repos, row.id), { name: 'ValidationError' });
    await assert.rejects(markFailed(repos, row.id, options(row, { errorCode: 'AI_TIMEOUT' })), { name: 'ConflictError' });
    await assert.rejects(retryInbound(repos, row.id, options(row)), { name: 'ConflictError' });
    const p = await markProcessing(repos, row.id, options(row));
    await assert.rejects(markFailed(repos, row.id, options(p, { errorCode: 'unknown' })), { name: 'ValidationError' });
  });
  for (const greeting of [false, true]) {
    await t.test(`${greeting ? 'greeting without lead' : 'quotation after partial lead failure'} completes once with valid linkage`, async () => {
      let row = await receive(greeting ? { incomingMessage: 'สวัสดี' } : {});
      const original = { ...row };
      const customer = await resolveCustomer(repos, { lineUserId: row.lineUserId });
      row = await attachCustomer(repos, row.id, options(row, { customerId: customer.id }));
      row = await markProcessing(repos, row.id, options(row));
      const leadInput = { customerId: customer.id, message: row.incomingMessage, sourceEventId: row.sourceEventId };
      const { lead } = await maybeCreateLead(repos, leadInput);
      if (!greeting) {
        const failed = await markFailed(repos, row.id, options(row, { errorCode: 'AI_PROVIDER_ERROR' }));
        row = await retryInbound(repos, row.id, options(failed));
        assert.equal((await maybeCreateLead(repos, leadInput)).lead.id, lead.id);
      } else assert.equal(lead, null);
      const draft = await persistDraftOnce(repos, { customerId: customer.id, leadId: lead?.id || null,
        incomingMessage: row.incomingMessage, sourceEventId: row.sourceEventId, draftResponse: 'บรรทัดแรก\n\n"คำตอบ"\tA\\B 😊' });
      await assert.rejects(completeInbound(repos, row.id, options(row, { draftId: randomUUID() })), { name: 'NotFoundError' });
      const results = await Promise.allSettled([1, 2].map(() => completeInbound(repos, row.id,
        options(row, { draftId: draft.id, leadId: lead?.id || null }))));
      assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
      const done = await repos.inboundMessages.findById(row.id);
      assert.equal(done.status, 'DRAFT_CREATED');
      assert.equal(done.draftId, draft.id);
      assert.equal(done.leadId, lead?.id || null);
      assert.equal((await repos.drafts.findById(draft.id)).status, 'WAITING_FOR_HUMAN');
      const before = await repos.auditLogs.list();
      const dup = await receiveInboundMessage(repos, original);
      assert.equal(dup.deduped, true);
      assert.equal(dup.inbound.status, 'DRAFT_CREATED');
      assert.deepEqual(await repos.auditLogs.list(), before);
      assert.equal((await events(row)).filter((e) => e.action === 'INBOUND_COMPLETED').length, 1);
    });
  }
  await t.test('completion cannot link a different customer/event/message draft', async () => {
    let row = await receive();
    const customer = await resolveCustomer(repos, { lineUserId: row.lineUserId });
    row = await attachCustomer(repos, row.id, options(row, { customerId: customer.id }));
    row = await markProcessing(repos, row.id, options(row));
    const draft = await persistDraftOnce(repos, { customerId: customer.id, incomingMessage: 'different', draftResponse: 'test', sourceEventId: randomUUID() });
    await assert.rejects(completeInbound(repos, row.id, options(row, { draftId: draft.id })), { name: 'ConflictError' });
    assert.equal((await repos.inboundMessages.findById(row.id)).status, 'PROCESSING');
  });
  if (rollback) await t.test('audit failure rolls back both receipt and transition', async () => {
    const broken = { ...repos, transaction: (fn) => repos.transaction((tx) => fn({ ...tx,
      auditLogs: { ...tx.auditLogs, append: async () => { throw new Error('injected audit failure'); } } })) };
    const body = input();
    await assert.rejects(receiveInboundMessage(broken, body), /injected/);
    assert.equal(await repos.inboundMessages.findBySourceEventId(body.sourceEventId), null);
    const row = await processing();
    await assert.rejects(markFailed(broken, row.id, options(row, { errorCode: 'AI_TIMEOUT' })), /injected/);
    assert.deepEqual(await repos.inboundMessages.findById(row.id), row);
  });
  await t.test('repository CAS, nonnegative counters, status checks and FKs match SQL', async () => {
    const row = await receive();
    const expected = { status: row.status, revision: row.revision };
    assert.equal(await repos.inboundMessages.updateIfCurrent(row.id, { status: 'PROCESSING' }, { ...expected, revision: 999 }), null);
    for (const patch of [{ retryCount: -1 }, { revision: -1 }, { status: 'SENT' }]) {
      await assert.rejects(repos.inboundMessages.updateIfCurrent(row.id, patch, expected), { code: '23514' });
    }
    for (const field of ['customerId', 'leadId', 'draftId']) {
      await assert.rejects(repos.inboundMessages.updateIfCurrent(row.id, { [field]: randomUUID() }, expected), { code: '23503' });
    }
  });
}
