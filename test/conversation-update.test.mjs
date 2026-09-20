import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { buildAiAgentText, buildConversationRouter, conversationRouter, updateConversation } from '../line-ai/conversation-update.mjs';
import { MENU_FETCH_MODES } from '../line-ai/menu-intent.mjs';
import { loadSystemData, renderKnowledge } from '../scripts/check-system.mjs';

function route(text, type = 'text') {
  const input = { body: { events: [{ type: 'message', source: { userId: 'test-user' }, message: { type, text } }] } };
  return vm.runInNewContext(`(function() { ${conversationRouter} })()`, { $input: { first: () => ({ json: input }) } });
}

function routeWith(code, text) {
  const input = { body: { events: [{ type: 'message', source: { userId: 'test-user' }, message: { type: 'text', text } }] } };
  return vm.runInNewContext(`(function() { ${code} })()`, { $input: { first: () => ({ json: input }) } });
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

test('router emits a deterministic menu plan and never a baked price list', () => {
  const code = buildConversationRouter();
  assert.ok(!code.includes('const menus ='), 'no embedded catalog');
  assert.ok(!code.includes('budgetContext'), 'no retired candidate list');
  assert.ok(!/"price"\s*:\s*\d+/.test(code), 'no embedded prices');
  const [result] = routeWith(code, 'งบกล่องละ 70 มีอะไรบ้าง');
  assert.equal(result.json.hasSafeAnswer, false);
  assert.deepEqual(JSON.parse(JSON.stringify(result.json.menuPlan)), {
    menuLookupNeeded: true, mode: 'exact-price', price: 70, maxPrice: null, category: null, query: null,
  });
  assert.equal(result.json.menuQueryString, 'price=70&limit=100');
  const [plain] = routeWith(code, 'ขอบคุณ');
  assert.equal(plain.json.menuPlan.mode, 'none');
  assert.equal(plain.json.menuQueryString, 'limit=100');
});

test('router output carries only fetch modes that the lookup branch understands', () => {
  const code = buildConversationRouter();
  for (const text of ['งบ 75 บาท', 'ไม่เกิน 100', 'ข้าวไก่เทอริยากิ ราคาเท่าไร', 'ข้าวผัด งบ 70', 'เมนูนี้ราคาเท่าไร', 'สวัสดี']) {
    const [result] = routeWith(code, text);
    const { mode, menuLookupNeeded } = result.json.menuPlan;
    assert.equal(menuLookupNeeded, MENU_FETCH_MODES.includes(mode), text);
  }
});

test('generated prompt carries no per-menu price catalog', async () => {
  const { rules, catalog, legacy } = await loadSystemData();
  const knowledge = renderKnowledge(rules, catalog, legacy.menus);
  assert.ok(!/^.+ \| \d+ บาท\/กล่อง/m.test(knowledge), 'no menu price lines in knowledge');
  assert.ok(knowledge.includes('MENU_CONTEXT'), 'menu-context rule present');
  assert.ok(knowledge.includes(`เริ่ม ${rules.services.mealBox.priceFrom} บาท/กล่อง`), 'starting-price policy retained');
  const changed = structuredClone(catalog);
  const victim = legacy.menus[0];
  changed.deleted = [...(changed.deleted || []), victim.id];
  assert.ok(!renderKnowledge(rules, changed, legacy.menus).includes(victim.name), 'deleted menus leave the knowledge pack');
});

test('AI agent input carries MENU_CONTEXT, never the retired candidate list', () => {
  assert.ok(buildAiAgentText().includes('$json.menuContext'));
  assert.ok(!buildAiAgentText().includes('budgetContext'));
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
  const updated = updateConversation(workflow, 'new prompt', '2026-09-16');
  assert.deepEqual(workflow, original);
  assert.deepEqual(updated.nodes[2], original.nodes[2]);
  assert.deepEqual(updated.connections, original.connections);
  assert.equal(updated.nodes[0].parameters.options.maxIterations, 4);
  assert.equal(updated.nodes[0].parameters.options.systemMessage, 'new prompt');
  assert.equal(updated.nodes[0].parameters.text, buildAiAgentText());
  const router = updated.nodes.find((node) => node.name === 'Deterministic FAQ');
  assert.ok(!router.parameters.jsCode.includes('budgetContext'));
  const persist = updated.nodes.find((node) => node.name === 'Persist Draft');
  assert.ok(persist.parameters.jsonBody.includes('menuContext'));
  assert.ok(!persist.parameters.jsonBody.includes('budgetContext'));
  const normalize = updated.nodes.find((node) => node.name === 'Normalize Event');
  assert.match(normalize.parameters.jsCode, /sourceEventId/);
  assert.match(normalize.parameters.jsCode, /2026-09-16/);
  const verify = updated.nodes.find((node) => node.name === 'Verify Draft');
  assert.match(verify.parameters.jsCode, /WAITING_FOR_HUMAN/);
});
