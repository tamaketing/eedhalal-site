import assert from 'node:assert/strict';

// This node keeps the existing branch layout and lets text reach the AI/memory.
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

export function updateConversation(workflow, systemMessage, menus = []) {
  const updated = structuredClone(workflow);
  const agent = updated.nodes.find((node) => node.name === 'AI Agent');
  const router = updated.nodes.find((node) => node.name === 'Deterministic FAQ');
  const model = updated.nodes.find((node) => node.name === 'Gemini Chat Model');
  const memory = updated.nodes.find((node) => node.name === 'Simple Memory');
  assert.ok(agent && router && model && memory, 'Expected existing conversation nodes are missing.');
  assert.ok(model.credentials && Object.keys(model.credentials).length, 'The existing model needs a configured credential.');
  assert.equal(updated.connections['Has Safe Answer?']?.main?.[1]?.[0]?.node, agent.name, 'AI fallback branch is missing.');
  agent.parameters.options = { ...agent.parameters.options, systemMessage };
  agent.parameters.text = "={{ 'เวลาปัจจุบันประเทศไทย: ' + $now.setZone('Asia/Bangkok').toISO() + '\\nข้อความลูกค้า: ' + $json.body.events[0].message.text + ($json.budgetContext || '') }}";
  router.parameters.jsCode = buildConversationRouter(menus);
  // Do not mix different customers' conversation history in a shared group.
  memory.parameters.sessionKey = "={{ ($json.body.events[0].source.groupId || $json.body.events[0].source.roomId || 'direct') + ':' + $json.body.events[0].source.userId }}";
  // Remove only orphan connection entries left by deleted nodes.
  const names = new Set(updated.nodes.map((node) => node.name));
  for (const name of Object.keys(updated.connections)) {
    if (!names.has(name)) delete updated.connections[name];
  }
  return updated;
}
