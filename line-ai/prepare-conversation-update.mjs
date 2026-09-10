import { readFile, writeFile } from 'node:fs/promises';
import { updateConversation } from './conversation-update.mjs';
import { loadSystemData, getEffectiveMenus } from '../scripts/check-system.mjs';

const workflowId = process.env.N8N_LINE_WORKFLOW_ID;
if (!workflowId) throw new Error('N8N_LINE_WORKFLOW_ID is required.');
const workflows = JSON.parse(await readFile(new URL('./live-workflow-export-before.json', import.meta.url), 'utf8'));
const current = workflows.find((workflow) => workflow.id === workflowId);
if (!current) throw new Error('Requested workflow is not in the backup.');
const prompt = await readFile(new URL('./system-message-node.txt', import.meta.url), 'utf8');
const { legacy, catalog } = await loadSystemData();
const menus = getEffectiveMenus(legacy.menus, catalog);
const updated = updateConversation(current, prompt, menus);
await writeFile(new URL('./live-workflow-export-updated.json', import.meta.url), JSON.stringify([updated], null, 2));

// A manual-only evaluation with synthetic customer messages and no LINE/CRM nodes.
const model = structuredClone(updated.nodes.find((node) => node.name === 'Gemini Chat Model'));
const memory = structuredClone(updated.nodes.find((node) => node.name === 'Simple Memory'));
memory.parameters.sessionKey = 'eed-conversation-evaluation-20260910';
const questions = ['งบกล่องละ 70 บาท อยากได้เมนูไก่ แนะนำหน่อย', 'เอาเมนูแรก 80 กล่อง ส่งเขตวัฒนา ค่าส่งเท่าไหร่ รวมค่าอาหารให้ด้วย', 'เปลี่ยนเป็น 40 กล่องแทน ที่เดิม รวมเท่าไหร่'];
const agents = questions.map((text, index) => {
  const agent = structuredClone(updated.nodes.find((node) => node.name === 'AI Agent'));
  agent.id = `eval-agent-${index}`;
  agent.name = `Conversation ${index + 1}`;
  const budgetHint = index === 0 ? '\nระบบกรองเมนูตามเพดานงบ 70 บาท/กล่องแล้ว เลือกได้เฉพาะรายการนี้ ห้ามเสนอรายการเกินงบ: ' + JSON.stringify(menus.filter((menu) => menu.price <= 70).map(({ name, price, minPerMenu }) => ({ name, price, minPerMenu }))) : '';
  agent.parameters.text = text + budgetHint;
  return agent;
});
const edge = (name, type = 'main') => ({ node: name, type, index: 0 });
const evaluation = {
  id: 'eedconversationeval20260910', name: 'EED - Conversation evaluation (manual only)', active: false,
  nodes: [{ id: 'eval-start', name: 'Manual Start', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: [0, 0], parameters: {} }, ...agents, model, memory],
  connections: {
    'Manual Start': { main: [[edge(agents[0].name)]] },
    [agents[0].name]: { main: [[edge(agents[1].name)]] },
    [agents[1].name]: { main: [[edge(agents[2].name)]] },
    [model.name]: { ai_languageModel: [agents.map((agent) => edge(agent.name, 'ai_languageModel'))] },
    [memory.name]: { ai_memory: [agents.map((agent) => edge(agent.name, 'ai_memory'))] },
  }, settings: { executionOrder: 'v1' },
};
await writeFile(new URL('./evaluation-workflow-export.json', import.meta.url), JSON.stringify([evaluation], null, 2));
console.log(JSON.stringify({ workflowId, candidateReady: true, evaluationId: evaluation.id, changedNodes: ['AI Agent', 'Deterministic FAQ', 'Simple Memory'] }));
