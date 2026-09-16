import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { buildConversationRouter, conversationRouter, updateConversation } from '../line-ai/conversation-update.mjs';
import { loadSystemData, renderKnowledge } from '../scripts/check-system.mjs';

function route(text, type = 'text') {
  const input = { body: { events: [{ type: 'message', source: { userId: 'test-user' }, message: { type, text } }] } };
  return vm.runInNewContext(`(function() { ${conversationRouter} })()`, { $input: { first: () => ({ json: input }) } });
}

test('menu requests, follow-ups, and corrections reach AI instead of canned answers', () => {
  for (const text of ['งบกล่องละ 70 มีอะไรบ้าง', '80 กล่อง ส่งวัฒนา', 'เอาแบบแรก', 'เปลี่ยนเป็น 40 กล่อง', 'ส่งฟรีไหม', 'ขอบคุณ']) {
    const result = route(text);
    assert.equal(result[0].json.hasSafeAnswer, false, text);
    assert.equal(result[0].json.output, undefined, 'a stale canned reply must not override AI output in CRM');
    assert.equal(result[0].json.body.events[0].message.text, text);
  }
});

test('non-text messages receive a clear fallback and verification events are ignored', () => {
  assert.equal(route('', 'image')[0].json.hasSafeAnswer, true);
  const result = vm.runInNewContext(`(function() { ${conversationRouter} })()`, { $input: { first: () => ({ json: { body: { events: [] } } }) } });
  assert.equal(result.length, 0);
});

test('explicit per-box budgets filter out over-budget menus before the model call', () => {
  const code = buildConversationRouter([{ name: 'ไก่ A', price: 60, minPerMenu: 5 }, { name: 'ไก่ B', price: 75, minPerMenu: 5 }]);
  const input = { body: { events: [{ type: 'message', message: { type: 'text', text: 'งบกล่องละ 70 มีอะไรบ้าง' } }] } };
  const [result] = vm.runInNewContext(`(function() { ${code} })()`, { $input: { first: () => ({ json: input }) } });
  assert.ok(result.json.budgetContext.includes('ไก่ A'));
  assert.ok(!result.json.budgetContext.includes('ไก่ B'));
  assert.equal(result.json.hasSafeAnswer, false);
});

test('catalog knowledge uses overrides and excludes deleted menus', async () => {
  const { rules, catalog, legacy } = await loadSystemData();
  const menu = legacy.menus[0];
  const changed = structuredClone(catalog);
  changed.prices[menu.id] = 71;
  changed.names[menu.id] = 'เมนูทดสอบราคาใหม่';
  const knowledge = renderKnowledge(rules, changed, legacy.menus);
  assert.ok(knowledge.includes('เมนูทดสอบราคาใหม่ | 71 บาท/กล่อง'));
  changed.deleted = [...(changed.deleted || []), menu.id];
  assert.ok(!renderKnowledge(rules, changed, legacy.menus).includes('เมนูทดสอบราคาใหม่'));
});

test('conversation update preserves model credentials and business integrations', () => {
  const httpNode = (name) => ({
    name,
    type: 'n8n-nodes-base.httpRequest',
    parameters: {
      method: 'POST',
      url: "={{ ($env.INTERNAL_API_BASE_URL || 'http://127.0.0.1:8788') + '/api/v1/x' }}",
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      options: { timeout: 10000 },
    },
    credentials: { httpHeaderAuth: { id: null, name: 'EED Internal API' } },
  });
  const workflow = { nodes: [
    { name: 'AI Agent', parameters: { options: { maxIterations: 4 } } },
    { name: 'Deterministic FAQ', parameters: {} },
    { name: 'Gemini Chat Model', parameters: { modelName: 'existing-model' }, credentials: { gemini: { id: 'existing' } } },
    { name: 'Simple Memory', parameters: { contextWindowLength: 10 } },
    { name: 'Normalize Event', parameters: {} },
    httpNode('Resolve Customer'),
    httpNode('Evaluate Lead'),
    httpNode('Persist Draft'),
    { name: 'Verify Draft', parameters: {} },
    { name: 'Has Safe Answer?', parameters: {} },
  ], connections: {
    'Has Safe Answer?': { main: [[{ node: 'Normalize Event' }], [{ node: 'AI Agent' }]] },
    'AI Agent': { main: [[{ node: 'Normalize Event' }]] },
    'Normalize Event': { main: [[{ node: 'Resolve Customer' }]] },
    'Resolve Customer': { main: [[{ node: 'Evaluate Lead' }]] },
    'Evaluate Lead': { main: [[{ node: 'Persist Draft' }]] },
    'Persist Draft': { main: [[{ node: 'Verify Draft' }]] },
    'Verify Draft': { main: [[]] },
  } };
  const original = structuredClone(workflow);
  const updated = updateConversation(workflow, 'new prompt', [], '2026-09-16');
  assert.deepEqual(workflow, original);
  assert.deepEqual(updated.nodes[2], original.nodes[2]);
  assert.deepEqual(updated.connections, original.connections);
  assert.equal(updated.nodes[0].parameters.options.maxIterations, 4);
  assert.equal(updated.nodes[0].parameters.options.systemMessage, 'new prompt');
  const normalize = updated.nodes.find((node) => node.name === 'Normalize Event');
  assert.match(normalize.parameters.jsCode, /sourceEventId/);
  assert.match(normalize.parameters.jsCode, /2026-09-16/);
  const verify = updated.nodes.find((node) => node.name === 'Verify Draft');
  assert.match(verify.parameters.jsCode, /WAITING_FOR_HUMAN/);
});
