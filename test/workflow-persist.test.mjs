import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import {
  findCustomerSenders,
  findKitchenAutoPush,
  findPersistenceMisconfigurations,
  findStaticDraftStores,
} from '../line-ai/conversation-update.mjs';
import { presentDraft } from '../server/present.mjs';
import { persistDraftOnce } from '../services/drafts.mjs';
import { createMemoryAdapter } from '../db/memory.mjs';
import { resolveCustomer } from '../services/customers.mjs';

const workflow = JSON.parse(await readFile(new URL('../line-ai/n8n-workflow.json', import.meta.url), 'utf8'));
const byName = new Map(workflow.nodes.map((node) => [node.name, node]));
const raw = JSON.stringify(workflow);

// A. Internal API persistence path exists in the declared order.
test('A: workflow persists through the Internal API chain', () => {
  for (const name of ['Normalize Event', 'Resolve Customer', 'Evaluate Lead', 'Persist Draft', 'Verify Draft']) {
    assert.ok(byName.has(name), `missing node ${name}`);
  }
  const chain = workflow.connections;
  const link = (from, to) => assert.equal(chain[from]?.main?.[0]?.[0]?.node, to, `${from} -> ${to}`);
  link('Normalize Event', 'Resolve Customer');
  link('Resolve Customer', 'Evaluate Lead');
  link('Evaluate Lead', 'Persist Draft');
  link('Persist Draft', 'Verify Draft');
});

// B–E. No sender of any kind.
test('B: no LINE sender node exists', () => {
  assert.deepEqual(findCustomerSenders(workflow), []);
});
test('C: no customer Reply API exists', () => {
  assert.ok(!workflow.nodes.some((node) => node.parameters?.operation === 'reply'));
  assert.ok(!workflow.nodes.some((node) => String(node.type || '').includes('lineMessaging')));
});
test('D: no customer Push API exists', () => {
  assert.ok(!workflow.nodes.some((node) => node.parameters?.operation === 'push'));
  assert.ok(!/api(-data)?\.line\.me/i.test(raw));
});
test('E: no kitchen push exists', () => {
  assert.deepEqual(findKitchenAutoPush(workflow), []);
});

// F–G. Secrets and database never appear in the workflow definition.
test('F: no Internal API secret in workflow JSON', () => {
  assert.ok(!/Bearer\s+[A-Za-z0-9\-_~+/=]{20,}/.test(raw));
  const header = byName.get('Resolve Customer').credentials?.httpHeaderAuth || {};
  assert.equal(header.name, 'EED Internal API');
  assert.ok(!header.id);
});
test('G: no DATABASE_URL in workflow JSON', () => {
  assert.ok(!/DATABASE_URL|postgres:\/\//i.test(raw));
});

// H–J. Decisions and state come from the API/server, never n8n.
test('H: customer identity comes from the resolve API', () => {
  const resolveBody = byName.get('Resolve Customer').parameters.jsonBody;
  assert.match(resolveBody, /\$json\.lineUserId/);
  const evaluateBody = byName.get('Evaluate Lead').parameters.jsonBody;
  assert.match(evaluateBody, /Resolve Customer.*customer\.id/);
  const persistBody = byName.get('Persist Draft').parameters.jsonBody;
  assert.match(persistBody, /Resolve Customer.*customer\.id/);
  assert.match(persistBody, /Evaluate Lead.*lead/);
});
test('I: lead decision comes from the API, not n8n rules', () => {
  const normalizeCode = byName.get('Normalize Event').parameters.jsCode;
  assert.ok(!/QUALIFIED|QUOTATION_PENDING|\bWON\b|\bLOST\b/.test(normalizeCode));
  assert.match(byName.get('Evaluate Lead').parameters.url, /leads\/evaluate/);
});
test('J: draft state is forced server-side and verified terminal', () => {
  const persistBody = byName.get('Persist Draft').parameters.jsonBody;
  assert.ok(!/"status"\s*:/.test(persistBody), 'n8n must not choose a draft status');
  const code = byName.get('Verify Draft').parameters.jsCode;
  assert.match(code, /WAITING_FOR_HUMAN/);
  const [result] = vm.runInNewContext(`(function() { ${code} })()`, {
    $input: { first: () => ({ json: { draft: { draftId: 'LD-1', status: 'WAITING_FOR_HUMAN' } } }) },
  });
  assert.equal(result.json.status, 'WAITING_FOR_HUMAN');
  assert.throws(() => vm.runInNewContext(`(function() { ${code} })()`, {
    $input: { first: () => ({ json: { draft: { draftId: 'LD-1', status: 'SENT' } } }) },
  }), /WAITING_FOR_HUMAN/);
});

// K–L. No static store; failures stop loudly.
test('K: static workflow Draft store is not a source of truth', () => {
  assert.deepEqual(findStaticDraftStores(workflow), []);
  assert.ok(!raw.includes('eedDraft:'));
});
test('L: persistence nodes fail closed (timeout, no silent continue)', () => {
  for (const name of ['Resolve Customer', 'Evaluate Lead', 'Persist Draft']) {
    const node = byName.get(name);
    assert.ok((node.parameters.options?.timeout || 0) > 0, `${name} needs a timeout`);
    assert.ok(!String(node.onError || '').match(/continue/i), `${name} must not swallow errors`);
  }
  assert.deepEqual(findPersistenceMisconfigurations(workflow), []);
});

// M–N. Idempotency at the service boundary (memory adapter; PG in E2E).
test('M: duplicate source event reuses one draft', async () => {
  const repos = createMemoryAdapter();
  const customer = await resolveCustomer(repos, { lineUserId: 'Um' });
  const input = {
    customerId: customer.id, incomingMessage: 'สวัสดี', draftResponse: 'สวัสดีค่ะ',
    sourceEventId: 'evt-m-1',
  };
  const first = await persistDraftOnce(repos, input);
  const second = await persistDraftOnce(repos, input);
  assert.equal(first.deduped, false);
  assert.equal(second.deduped, true);
  assert.equal(first.draftId || first.id, second.draftId || second.id);
  assert.equal((await repos.drafts.listByStatus('WAITING_FOR_HUMAN')).length, 1);
});
test('N: new event creates a new draft', async () => {
  const repos = createMemoryAdapter();
  const customer = await resolveCustomer(repos, { lineUserId: 'Un' });
  const a = await persistDraftOnce(repos, { customerId: customer.id, incomingMessage: 'a', draftResponse: 'a', sourceEventId: 'evt-n-1' });
  const b = await persistDraftOnce(repos, { customerId: customer.id, incomingMessage: 'b', draftResponse: 'b', sourceEventId: 'evt-n-2' });
  assert.notEqual(a.id, b.id);
});

// O. Owner console never sees replyToken.
test('O: presented drafts never expose replyToken', () => {
  const shown = presentDraft({
    id: 'd', draftId: 'LD-1', customerId: 'c', leadId: null, channel: 'line',
    incomingMessage: 'hi', draftResponse: 'hello', status: 'WAITING_FOR_HUMAN',
    metadata: { replyToken: 'tok', budgetContext: 'x' }, history: [],
  });
  assert.ok(!('replyToken' in shown.metadata));
});

// P–Q. Config/docs hygiene.
test('P: production database is never eedhalal_test in config examples', async () => {
  for (const file of ['../.env.example', '../docs/database.md', '../docs/internal-api.md', '../line-ai/OPERATIONS.md']) {
    const content = await readFile(new URL(file, import.meta.url), 'utf8');
    assert.ok(!/production.*eedhalal_test|eedhalal_test.*production/i.test(content), file);
  }
  assert.ok(!raw.includes('eedhalal_test'));
});
test('Q: n8n never connects directly to PostgreSQL', () => {
  // Notes may document the architecture; nodes and parameters must not.
  const types = workflow.nodes.map((node) => String(node.type || ''));
  assert.ok(!types.some((type) => /postgres/i.test(type)));
  const params = JSON.stringify(workflow.nodes.map((node) => node.parameters || {}));
  assert.ok(!/DATABASE_URL|5432|pg8000/i.test(params));
  assert.ok(!workflow.nodes.some((node) => (node.credentials || {}).postgres));
});
