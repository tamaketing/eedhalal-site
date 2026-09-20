import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createFileAdapter } from '../db/file.mjs';
import { createMemoryAdapter } from '../db/memory.mjs';
import { createPostgresAdapter } from '../db/postgres.mjs';
import { createFakePg } from '../test-helpers/fake-pg.mjs';
import { persistDraft } from '../services/drafts.mjs';
import { resolveCustomer } from '../services/customers.mjs';
import {
  EXAMPLE_INTENTS,
  classifyExample,
  classifyIntent,
  createResponseExampleFromDraft,
  fingerprintExample,
  getResponseExample,
  listResponseExamples,
  presentResponseExample,
  retrieveRelevantExamples,
  sanitizeExampleText,
  setResponseExampleReusable,
} from '../services/responseExamples.mjs';

// B2.5/4B-4 Step 1: owner opt-in only. No auto-ingestion exists: examples are
// created solely by explicit createResponseExampleFromDraft calls on SENT
// drafts. Memory + file adapters run the full contract; fake PG covers SQL
// shapes; real PG runs in response-examples-postgres.test.mjs.

function adapters(label, fn) {
  return async (t) => {
    await t.test(`${label}:memory`, async () => fn(createMemoryAdapter()));
    const dir = await mkdtemp(path.join(tmpdir(), 'eed-rex-'));
    try {
      await t.test(`${label}:file`, async () => fn(createFileAdapter(dir)));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
    await t.test(`${label}:fake-pg`, async () => fn(createPostgresAdapter({ query: createFakePg().query })));
  };
}

async function seedSentDraft(repos, { message = 'ขอใบเสนอราคาข้าวกล่อง 50 กล่อง', response = 'รับทราบค่ะ มี 50 กล่องพร้อมส่งค่ะ', edited = false } = {}) {
  const customer = await resolveCustomer(repos, { lineUserId: `U${randomUUID().replace(/-/g, '').slice(0, 32)}`, displayName: 'Test Customer' });
  const draft = await persistDraft(repos, {
    customerId: customer.id, incomingMessage: message, draftResponse: response, ruleRevision: '2026-09-16',
  }, { type: 'AI', id: '' });
  const { approveDraft, editDraft } = await import('../services/drafts.mjs');
  if (edited) await editDraft(repos, draft.id, { ownerId: 'owner', finalText: `${response} (edited)` });
  else await approveDraft(repos, draft.id, { ownerId: 'owner' });
  const { sendDraft } = await import('../services/drafts.mjs');
  const calls = [];
  await sendDraft(repos, draft.id, {}, { push: async (args) => { calls.push(args); return { outcome: 'ACCEPTED', code: 'HTTP_200', httpStatus: 200 }; }, token: 'test-token' });
  assert.equal(calls.length, 1);
  return repos.drafts.findById(draft.id);
}

test('no automatic ingestion entry point exists', () => {
  return import('../services/responseExamples.mjs').then(async (mod) => {
    assert.equal(typeof mod.createResponseExampleFromDraft, 'function');
    for (const name of Object.keys(mod)) {
      assert.ok(!/ingest|syncAll|auto|batch|scan/i.test(name), `no auto-ingest export: ${name}`);
    }
  });
});

test('classifier covers the approved vocabulary deterministically', () => {
  assert.deepEqual(classifyExample('ขอใบเสนอราคาข้าวกล่อง 50 กล่อง'), { intent: 'quotation', serviceType: 'mealbox' });
  assert.equal(classifyIntent('สวัสดี'), 'greeting');
  assert.equal(classifyIntent('สวัสดี ขอใบเสนอราคา'), 'quotation');
  assert.equal(classifyIntent('ขอดูเมนู'), 'menu_request');
  assert.equal(classifyIntent('จัดส่งวันไหน'), 'delivery');
  assert.equal(classifyIntent('มัดจำยังไง'), 'payment');
  assert.equal(classifyIntent('ขั้นต่ำกี่กล่อง'), 'minimum_order');
  assert.equal(classifyIntent('ว่างวันไหน'), 'availability');
  assert.equal(classifyIntent('ขอบคุณมาก'), 'follow_up');
  assert.equal(classifyIntent('ไม่พอใจเลย'), 'complaint');
  assert.equal(classifyIntent('อะไรก็ได้'), 'general');
  for (const intent of ['greeting', 'quotation', 'general']) assert.ok(EXAMPLE_INTENTS.includes(intent));
});

test('sanitization redacts identity while preserving reusable text', () => {
  const fakeLineId = `U${'a'.repeat(32)}`;
  const out = sanitizeExampleText(
    `สวัสดีสมชาย โทร 081-234-5678 อีเมล a@b.co ส่ง 20/12/2026 10:30 น. ดู https://eedhalal.com/menu.html?ref=9äus\nข้าวกล่อง 😊 ${fakeLineId}`,
    ['สมชาย'],
  );
  assert.ok(!out.text.includes('081-234-5678'));
  assert.ok(!out.text.includes('a@b.co'));
  assert.ok(!out.text.includes('20/12/2026'));
  assert.ok(!out.text.includes('10:30'));
  assert.ok(!out.text.includes(fakeLineId));
  assert.ok(!out.text.includes('ref=9äus'));
  assert.ok(out.text.includes('https://eedhalal.com/menu.html'));
  assert.ok(out.text.includes('ข้าวกล่อง 😊'));
  assert.ok(out.text.includes('[CUSTOMER]'));
  for (const blocked of ['ให้ส่วนลดพิเศษ 5%', 'ราคาพิเศษสำหรับคุณ', 'one-off deal', 'ข้อยกเว้น']) {
    assert.throws(() => sanitizeExampleText(`รับทราบค่ะ ${blocked}`), /example_requires_review/);
  }
  assert.throws(() => sanitizeExampleText('   '), /example_requires_review/);
  assert.equal(fingerprintExample({ intent: 'a', serviceType: null, incomingExample: ' X  ', approvedResponse: 'Y' }),
    fingerprintExample({ intent: 'a', serviceType: null, incomingExample: 'x', approvedResponse: 'y' }));
});

test('eligibility matrix', adapters('eligibility', async (repos) => {
  const sent = await seedSentDraft(repos);
  const { example, deduped } = await createResponseExampleFromDraft(repos, sent.id, { ownerId: 'owner' });
  assert.equal(deduped, false);
  assert.equal(example.intent, 'quotation');
  assert.equal(example.serviceType, 'mealbox');
  const again = await createResponseExampleFromDraft(repos, sent.id, { ownerId: 'owner' });
  assert.equal(again.deduped, true);
  assert.equal(again.example.id, example.id);
  // Ineligible states.
  const waiting = await persistDraft(repos, { customerId: sent.customerId, incomingMessage: 'สวัสดี', draftResponse: 'hi' }, { type: 'AI', id: '' });
  await assert.rejects(createResponseExampleFromDraft(repos, waiting.id), { name: 'ConflictError' });
  const { editDraft, rejectDraft } = await import('../services/drafts.mjs');
  await editDraft(repos, waiting.id, { ownerId: 'owner', finalText: 'edit' });
  await assert.rejects(createResponseExampleFromDraft(repos, waiting.id), { name: 'ConflictError' });
  await rejectDraft(repos, waiting.id, { ownerId: 'owner' });
  await assert.rejects(createResponseExampleFromDraft(repos, waiting.id), { name: 'ConflictError' });
  await assert.rejects(createResponseExampleFromDraft(repos, randomUUID()), { name: 'NotFoundError' });
}));

test('concurrent opt-in converges to one example', adapters('concurrency', async (repos) => {
  const sent = await seedSentDraft(repos);
  const results = await Promise.all(Array.from({ length: 20 }, () => createResponseExampleFromDraft(repos, sent.id, { ownerId: 'owner' })));
  assert.equal(new Set(results.map((r) => r.example.id)).size, 1);
  assert.equal(results.filter((r) => !r.deduped).length, 1);
  const audits = await repos.auditLogs.listByEntity('response_example', results[0].example.id);
  assert.equal(audits.filter((a) => a.action === 'RESPONSE_EXAMPLE_CREATED').length, 1);
}));

test('retrieval ranks, limits, excludes disabled, and flags stale rules', adapters('retrieval', async (repos) => {
  async function seed(message, response, revision = '2026-09-16') {
    const customer = await resolveCustomer(repos, { lineUserId: `U${randomUUID().replace(/-/g, '').slice(0, 32)}` });
    const draft = await persistDraft(repos, { customerId: customer.id, incomingMessage: message, draftResponse: response, ruleRevision: revision }, { type: 'AI', id: '' });
    const { approveDraft } = await import('../services/drafts.mjs');
    await approveDraft(repos, draft.id, { ownerId: 'owner' });
    const { sendDraft } = await import('../services/drafts.mjs');
    await sendDraft(repos, draft.id, {}, { push: async () => ({ outcome: 'ACCEPTED', code: 'HTTP_200', httpStatus: 200 }), token: 't' });
    const { example } = await createResponseExampleFromDraft(repos, draft.id, { ownerId: 'owner' });
    return example;
  }
  const meal = await seed('ขอใบเสนอราคาข้าวกล่อง 50 กล่อง', 'รับทราบค่ะ ข้าวกล่อง 50 กล่องค่ะ');
  await seed('สวัสดี', 'สวัสดีค่ะ', '2020-01-01');
  const off = await seed('จัดส่งวันไหน', 'จัดส่งตามรอบทุกวันค่ะ');
  await setResponseExampleReusable(repos, off.id, { reusable: false, ownerId: 'owner' });
  const hits = await retrieveRelevantExamples(repos, { message: 'ขอใบเสนอราคาข้าวกล่อง 100 กล่อง', currentRevision: '2026-09-16', limit: 10 });
  assert.ok(hits.length <= 3);
  assert.equal(hits[0].intent, 'quotation');
  assert.ok(!hits.some((h) => h.intent === 'delivery'), 'disabled example excluded');
  assert.ok(!('sourceDraftId' in hits[0] || 'fingerprint' in hits[0]), 'no internals leaked');
  const old = await retrieveRelevantExamples(repos, { message: 'สวัสดี', currentRevision: '2026-09-16' });
  assert.equal(old[0].staleRules, true);
  const current = await retrieveRelevantExamples(repos, { message: 'ขอใบเสนอราคาข้าวกล่อง 5 กล่อง', currentRevision: meal.businessRulesRevision });
  assert.equal(current[0].staleRules, false);
  assert.equal((await retrieveRelevantExamples(repos, { message: 'สวัสดี' }))[0].staleRules, null);
}));

test('management reads and updates stay owner-controlled', adapters('manage', async (repos) => {
  const sent = await seedSentDraft(repos, { edited: true });
  const { example } = await createResponseExampleFromDraft(repos, sent.id, { ownerId: 'owner', styleTags: ['concise'] });
  assert.deepEqual((await getResponseExample(repos, example.id)).styleTags, ['concise']);
  assert.ok((await listResponseExamples(repos, {})).some((r) => r.id === example.id));
  assert.equal((await listResponseExamples(repos, { reusable: false })).length, 0);
  const disabled = await setResponseExampleReusable(repos, example.id, { reusable: false, ownerId: 'owner' });
  assert.equal(disabled.reusable, false);
  assert.equal((await listResponseExamples(repos, { reusable: true })).filter((r) => r.id === example.id).length, 0);
  await assert.rejects(setResponseExampleReusable(repos, example.id, { reusable: 'yes' }), { name: 'ValidationError' });
  await assert.rejects(setResponseExampleReusable(repos, example.id, { intent: 'bogus' }), { name: 'ValidationError' });
  await assert.rejects(setResponseExampleReusable(repos, example.id, {}), { name: 'ValidationError' });
  await assert.rejects(getResponseExample(repos, randomUUID()), { name: 'NotFoundError' });
  const presented = presentResponseExample(await repos.responseExamples.findById(example.id));
  assert.ok(!('sourceDraftId' in presented || 'fingerprint' in presented));
}));
