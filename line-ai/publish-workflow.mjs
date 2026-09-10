import { readFile } from 'node:fs/promises';
import { n8nApi } from './n8n-api.mjs';
import { updateConversation } from './conversation-update.mjs';
import { loadSystemData, getEffectiveMenus } from '../scripts/check-system.mjs';

const workflowId = process.env.N8N_LINE_WORKFLOW_ID;

if (!workflowId) throw new Error('N8N_LINE_WORKFLOW_ID is required.');

const current = await n8nApi(`/workflows/${encodeURIComponent(workflowId)}`);
const prompt = await readFile(new URL('./system-message-node.txt', import.meta.url), 'utf8');
const { legacy, catalog } = await loadSystemData();
const workflow = updateConversation(current, prompt, getEffectiveMenus(legacy.menus, catalog));

const published = await n8nApi(`/workflows/${encodeURIComponent(workflowId)}`, {
  method: 'PUT',
  body: JSON.stringify({ name: workflow.name, nodes: workflow.nodes, connections: workflow.connections, settings: workflow.settings }),
});

console.log(JSON.stringify({ workflowId: published.id || workflowId, name: published.name || workflow.name, draftUpdated: true, publishInN8n: true }));
