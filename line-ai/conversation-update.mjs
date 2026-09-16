import assert from 'node:assert/strict';

// Human-approval foundation: nodes that contact a customer directly.
// AI output must end at the Build Draft node (WAITING_FOR_HUMAN) instead.
export const CUSTOMER_SENDER_OPERATIONS = Object.freeze([
  'reply',
  'push',
  'broadcast',
  'multicast',
  'narrowcast',
  'displayLoading',
]);

export function findCustomerSenders(workflow) {
  const hits = [];
  for (const node of workflow?.nodes || []) {
    const params = node.parameters || {};
    if (String(node.type || '').includes('lineMessaging')) {
      if (CUSTOMER_SENDER_OPERATIONS.includes(String(params.operation || ''))) {
        hits.push(node.name);
      }
    }
    if (node.type === 'n8n-nodes-base.httpRequest') {
      const haystack = JSON.stringify(params);
      if (/api(-data)?\.line\.me/i.test(haystack)) hits.push(node.name);
    }
  }
  return hits;
}

export function findKitchenAutoPush(workflow) {
  const hits = [];
  for (const node of workflow?.nodes || []) {
    const haystack = `${node.name || ''} ${node.parameters?.jsCode || ''} ${node.parameters?.jsonBody || ''}`;
    if (/push.*kitchen|kitchen.*push|kitchen.?group/i.test(haystack)) hits.push(node.name);
  }
  return hits;
}

// Code for the terminal "Build Draft" node. It NEVER calls LINE: it turns
// the AI (or deterministic fallback) text into a Draft with status
// WAITING_FOR_HUMAN, stashes it in workflow static data (temporary store
// until PostgreSQL exists), and ends the workflow for owner review.
export function buildDraftNodeCode(ruleRevision = '') {
  const revision = JSON.stringify(String(ruleRevision || ''));
  return `// EED HALAL human-approval foundation — this node NEVER sends to LINE.
// It converts AI/deterministic output into a Draft (WAITING_FOR_HUMAN).
const RULE_REVISION = ${revision};
function readNode(name) {
  try { return $(name).first().json; } catch (error) { return null; }
}
const webhook = readNode('LINE Webhook') || {};
const incoming = $input.first().json || {};
const event = webhook.body?.events?.[0] || incoming.body?.events?.[0] || {};
const source = event.source || {};
const message = event.message || {};
const customerId = source.userId || '';
const channel = source.groupId ? 'line-group' : source.roomId ? 'line-room' : 'line';
const incomingMessage = message.type === 'text'
  ? String(message.text || '')
  : (message.type ? '[non-text message: ' + message.type + ']' : '');
const aiText = String(incoming.output ?? incoming.text ?? '');
const isFallback = incoming.responseSource !== 'conversation-ai';
const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
const now = new Date().toISOString();
const draft = {
  draftId: 'LD-' + stamp + '-' + rand,
  customerId,
  channel,
  incomingMessage,
  draftResponse: aiText,
  status: 'WAITING_FOR_HUMAN',
  createdAt: now,
  updatedAt: now,
  approvedAt: null,
  sentAt: null,
  source: isFallback ? 'deterministic-fallback' : 'conversation-ai',
  aiModel: 'models/gemini-2.5-flash',
  ruleRevision: RULE_REVISION,
  metadata: { replyToken: event.replyToken || null, budgetContext: incoming.budgetContext || null },
  history: [{ at: now, from: null, to: 'WAITING_FOR_HUMAN', actor: 'system' }],
};
try {
  const store = $getWorkflowStaticData('global');
  store['eedDraft:' + draft.draftId] = draft;
} catch (error) {}
return [{ json: { draft } }];`;
}
export function buildConversationRouter(menus = []) {
return `const menus = ${JSON.stringify(menus.map(({ name, price, minPerMenu }) => ({ name, price, minPerMenu })))};
const input = $input.first().json;
const event = input?.body?.events?.[0];
if (!event || event.type !== 'message') return [];
if (event.message?.type !== 'text' || !String(event.message.text || '').trim()) {
  return [{ json: { ...input, hasSafeAnswer: true, output: 'ตอนนี้ผมอ่านได้เฉพาะข้อความครับ รบกวนพิมพ์รายละเอียดที่ต้องการให้ช่วยในแชทนี้ครับ' } }];
}
const text = String(event.message.text).replace(/,/g, '');
const budgetMatch = text.match(/(?:งบ\\s*)?(?:กล่องละ|ต่อกล่อง|งบต่อหัว|ต่อหัว|หัวละ)\\s*(\\d+(?:\\.\\d+)?)/);
const budget = budgetMatch ? Number(budgetMatch[1]) : null;
const candidates = budget === null ? [] : menus.filter(menu => menu.price <= budget);
const budgetContext = budget === null ? '' : '\\nระบบกรองเมนูตามเพดานงบ ' + budget + ' บาท/กล่องแล้ว เลือกได้เฉพาะรายการนี้ ห้ามเสนอรายการเกินงบ: ' + JSON.stringify(candidates);
return [{ json: { ...input, hasSafeAnswer: false, budgetContext, responseSource: 'conversation-ai' } }];`;
}
export const conversationRouter = buildConversationRouter();

export function updateConversation(workflow, systemMessage, menus = [], ruleRevision = '') {
  const updated = structuredClone(workflow);
  const agent = updated.nodes.find((node) => node.name === 'AI Agent');
  const router = updated.nodes.find((node) => node.name === 'Deterministic FAQ');
  const model = updated.nodes.find((node) => node.name === 'Gemini Chat Model');
  const memory = updated.nodes.find((node) => node.name === 'Simple Memory');
  const draft = updated.nodes.find((node) => node.name === 'Build Draft');
  const routerBranch = updated.connections['Has Safe Answer?'];
  assert.ok(agent && router && model && memory && draft && routerBranch, 'Expected human-approval nodes are missing (AI Agent, Deterministic FAQ, Has Safe Answer?, Build Draft, Gemini Chat Model, Simple Memory).');
  assert.ok(model.credentials && Object.keys(model.credentials).length, 'The existing model needs a configured credential.');
  assert.equal(routerBranch?.main?.[1]?.[0]?.node, agent.name, 'AI fallback branch is missing.');
  assert.equal(routerBranch?.main?.[0]?.[0]?.node, draft.name, 'Deterministic branch must end at Build Draft.');
  assert.equal(updated.connections['AI Agent']?.main?.[0]?.[0]?.node, draft.name, 'AI output must end at Build Draft (no auto-send).');
  const senders = findCustomerSenders(updated);
  assert.deepEqual(senders, [], `Customer auto-send nodes must not exist: ${senders.join(', ')}`);
  const kitchenPush = findKitchenAutoPush(updated);
  assert.deepEqual(kitchenPush, [], `Kitchen auto-push nodes must stay disabled: ${kitchenPush.join(', ')}`);
  agent.parameters.options = { ...agent.parameters.options, systemMessage };
  agent.parameters.text = "={{ 'เวลาปัจจุบันประเทศไทย: ' + $now.setZone('Asia/Bangkok').toISO() + '\\nข้อความลูกค้า: ' + $json.body.events[0].message.text + ($json.budgetContext || '') }}";
  router.parameters.jsCode = buildConversationRouter(menus);
  draft.parameters.jsCode = buildDraftNodeCode(ruleRevision);
  // Do not mix different customers' conversation history in a shared group.
  memory.parameters.sessionKey = "={{ ($json.body.events[0].source.groupId || $json.body.events[0].source.roomId || 'direct') + ':' + $json.body.events[0].source.userId }}";
  // Remove only orphan connection entries left by deleted nodes.
  const names = new Set(updated.nodes.map((node) => node.name));
  for (const name of Object.keys(updated.connections)) {
    if (!names.has(name)) delete updated.connections[name];
  }
  return updated;
}
