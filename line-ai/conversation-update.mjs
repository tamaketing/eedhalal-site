import assert from 'node:assert/strict';
import {
  MENU_CATEGORIES,
  MENU_CONTEXT_LIMIT,
  MENU_FETCH_MODES,
  MENU_NAME_KEYWORDS,
  MENU_SCAFFOLDING,
  buildMenuContext,
  buildMenuQueryString,
  formatMenuLine,
  isValidMenuEntry,
  normalizeMenuText,
  parseMenuIntent,
  stripMenuScaffolding,
} from './menu-intent.mjs';

// Human-approval foundation: nodes that contact a customer directly.
// AI output must flow into the persistence chain (ending at Verify Draft),
// never into a sender.
export const CUSTOMER_SENDER_OPERATIONS = Object.freeze([
  'reply',
  'push',
  'broadcast',
  'multicast',
  'narrowcast',
  'displayLoading',
]);

// The n8n credential (header auth) that carries EED_INTERNAL_API_SECRET.
// The JSON holds this NAME only — the secret itself lives in n8n's store.
export const INTERNAL_API_CREDENTIAL_NAME = 'EED Internal API';
export const INTERNAL_API_URL_EXPRESSION =
  "={{ ($env.INTERNAL_API_BASE_URL || 'http://127.0.0.1:8788') + '/api/v1/___PATH___' }}";

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

// Static Draft staging must not exist on the success path: PostgreSQL (via
// the Internal API chain below) is the single durable Draft store.
export function findStaticDraftStores(workflow) {
  const hits = [];
  for (const node of workflow?.nodes || []) {
    const code = node.parameters?.jsCode || '';
    if (/\beedDraft:/.test(code) || /\$getWorkflowStaticData/.test(code)) hits.push(node.name);
  }
  return hits;
}

// Guards for the Internal API HTTP nodes: header-auth credential by NAME
// only (never a literal secret), env-based URL, timeout, no database access.
export function findPersistenceMisconfigurations(workflow) {
  const problems = [];
  for (const name of ['Resolve Customer', 'Evaluate Lead', 'Persist Draft']) {
    const node = (workflow?.nodes || []).find((n) => n.name === name);
    if (!node) {
      problems.push(`${name}: missing`);
      continue;
    }
    const params = node.parameters || {};
    if (node.type !== 'n8n-nodes-base.httpRequest') problems.push(`${name}: must be an HTTP Request node`);
    if (params.authentication !== 'genericCredentialType' || params.genericAuthType !== 'httpHeaderAuth') {
      problems.push(`${name}: must use HTTP Header Auth credential`);
    }
    const credentialName = node.credentials?.httpHeaderAuth?.name;
    if (credentialName !== INTERNAL_API_CREDENTIAL_NAME) {
      problems.push(`${name}: must reference the '${INTERNAL_API_CREDENTIAL_NAME}' credential by name`);
    }
    if (typeof params.url !== 'string' || !params.url.includes('$env.INTERNAL_API_BASE_URL')) {
      problems.push(`${name}: URL must derive from $env.INTERNAL_API_BASE_URL`);
    }
    if (JSON.stringify(params).match(/Bearer\s+[A-Za-z0-9\-_~+/=]{20,}/)) {
      problems.push(`${name}: must not embed a bearer secret`);
    }
    if (/DATABASE_URL|postgres:\/\//i.test(JSON.stringify(params))) {
      problems.push(`${name}: n8n must never touch the database directly`);
    }
    if (!params.options?.timeout) problems.push(`${name}: must set a request timeout`);
  }
  return problems;
}

// Code for the "Normalize Event" node. It NEVER calls LINE and NEVER writes
// static staging: it turns the AI (or deterministic fallback) text plus the
// LINE webhook event into a flat, safe payload for the Internal API chain.
// Stable LINE identifiers (message.id, webhookEventId) become sourceEventId
// so retried deliveries deduplicate instead of duplicating business records.
export function buildNormalizeNodeCode(ruleRevision = '') {
  const revision = JSON.stringify(String(ruleRevision || ''));
  return `// EED HALAL persistence chain — normalization only. No LINE calls,
// no static writes. PostgreSQL (via Internal API) is the Draft store.
const RULE_REVISION = ${revision};
function readNode(name) {
  try { return $(name).first().json; } catch (error) { return null; }
}
const webhook = readNode('LINE Webhook') || {};
const incoming = $input.first().json || {};
const event = webhook.body?.events?.[0] || incoming.body?.events?.[0] || {};
const source = event.source || {};
const message = event.message || {};
const delivery = event.deliveryContext || {};
const sourceEventId = message.id || event.webhookEventId || delivery.webhookEventId || null;
const channel = source.groupId ? 'line-group' : source.roomId ? 'line-room' : 'line';
const incomingMessage = message.type === 'text'
  ? String(message.text || '')
  : (message.type ? '[non-text message: ' + message.type + ']' : '');
const aiText = String(incoming.output ?? incoming.text ?? '');
const isFallback = incoming.responseSource !== 'conversation-ai';
return [{ json: {
  lineUserId: source.userId || '',
  displayName: '',
  channel,
  incomingMessage,
  draftResponse: aiText,
  source: isFallback ? 'deterministic-fallback' : 'conversation-ai',
  aiModel: 'models/gemini-2.5-flash',
  ruleRevision: RULE_REVISION,
  sourceEventId,
  replyToken: event.replyToken || null,
  menuContext: incoming.menuContext || null,
} }];`;
}

// Single source for the Persist Draft request body. The only workflow
// differences are which normalize node feeds it (main: Normalize Event,
// B2.5 candidate: Normalize Response) and whether the owner reply token is
// persisted (main: yes; B2.5 candidate: never, by design), so the generator
// owns both variants explicitly.
export function buildPersistDraftJsonBody(normalizeName = 'Normalize Event', options = {}) {
  const { includeReplyToken = true } = options;
  const metadata = includeReplyToken
    ? `metadata: { replyToken: $("${normalizeName}").item.json.replyToken, menuContext: $("${normalizeName}").item.json.menuContext }`
    : `metadata: { menuContext: $("${normalizeName}").item.json.menuContext }`;
  return `={{ JSON.stringify({ customerId: $("Resolve Customer").item.json.customer.id, leadId: $("Evaluate Lead").item.json.lead?.id || null, channel: $("${normalizeName}").item.json.channel, incomingMessage: $("${normalizeName}").item.json.incomingMessage, draftResponse: $("${normalizeName}").item.json.draftResponse, source: $("${normalizeName}").item.json.source, aiModel: $("${normalizeName}").item.json.aiModel, ruleRevision: $("${normalizeName}").item.json.ruleRevision, sourceEventId: $("${normalizeName}").item.json.sourceEventId, ${metadata} }) }}`;
}

// Declarative Internal API call. Auth comes from the n8n credential store
// (HTTP Header Auth named 'EED Internal API'); the secret never appears here.
export function buildApiHttpNode({ id, name, apiPath, jsonBody, position }) {
  return {
    parameters: {
      method: 'POST',
      url: INTERNAL_API_URL_EXPRESSION.replace('___PATH___', apiPath),
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendBody: true,
      specifyBody: 'json',
      jsonBody,
      options: { timeout: 10000 },
    },
    credentials: { httpHeaderAuth: { id: null, name: INTERNAL_API_CREDENTIAL_NAME } },
    id,
    name,
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    position,
  };
}

export function buildPersistenceNodes() {
  return [
    buildApiHttpNode({
      id: 'resolve-customer',
      name: 'Resolve Customer',
      apiPath: 'customers/resolve',
      jsonBody: '={\n  "lineUserId": "{{ $json.lineUserId }}",\n  "displayName": "{{ $json.displayName }}"\n}',
      position: [1260, 300],
    }),
    buildApiHttpNode({
      id: 'evaluate-lead',
      name: 'Evaluate Lead',
      apiPath: 'leads/evaluate',
      jsonBody: '={\n  "customerId": "{{ $("Resolve Customer").item.json.customer.id }}",\n  "message": "{{ $("Normalize Event").item.json.incomingMessage }}",\n  "sourceEventId": "{{ $("Normalize Event").item.json.sourceEventId }}"\n}',
      position: [1460, 300],
    }),
    buildApiHttpNode({
      id: 'persist-draft',
      name: 'Persist Draft',
      apiPath: 'drafts',
      jsonBody: '={\n  "customerId": "{{ $("Resolve Customer").item.json.customer.id }}",\n  "leadId": "{{ $("Evaluate Lead").item.json.lead?.id || null }}",\n  "channel": "{{ $("Normalize Event").item.json.channel }}",\n  "incomingMessage": "{{ $("Normalize Event").item.json.incomingMessage }}",\n  "draftResponse": "{{ $("Normalize Event").item.json.draftResponse }}",\n  "source": "{{ $("Normalize Event").item.json.source }}",\n  "aiModel": "{{ $("Normalize Event").item.json.aiModel }}",\n  "ruleRevision": "{{ $("Normalize Event").item.json.ruleRevision }}",\n  "sourceEventId": "{{ $("Normalize Event").item.json.sourceEventId }}",\n  "metadata": {{ JSON.stringify({ replyToken: $("Normalize Event").item.json.replyToken, menuContext: $("Normalize Event").item.json.menuContext }) }}\n}',
      position: [1660, 300],
    }),
  ];
}

// Code for the terminal "Verify Draft" node: asserts the persisted Draft came
// back WAITING_FOR_HUMAN and STOPS. No LINE calls, no static writes, no
// fallback. Any failure surfaces as a failed execution for the owner.
export function buildVerifyDraftNodeCode() {
  return `// EED HALAL persistence chain — terminal guard. Asserts PostgreSQL holds
// a WAITING_FOR_HUMAN draft, then STOPS. Never sends, never stores.
const out = $input.first().json || {};
const draft = out.draft || {};
if (draft.status !== 'WAITING_FOR_HUMAN') {
  throw new Error('Draft persistence did not return WAITING_FOR_HUMAN; stopping without LINE send.');
}
return [{ json: { draftId: draft.draftId || null, status: draft.status, deduped: !!out.deduped } }];`;
}
// Deterministic router: menu-intent parsing only. This node embeds NO
// menu catalog and NO prices: numeric/name filters become a menuPlan for
// the live Internal Menu API lookup downstream. n8n Code nodes cannot
// import modules, so the dependency-free parser source is embedded here
// (generated from line-ai/menu-intent.mjs — never hand-edited).
const MENU_INTENT_PRELUDE = [
  `const MENU_CATEGORIES = ${JSON.stringify(MENU_CATEGORIES)};`,
  `const MENU_FETCH_MODES = ${JSON.stringify(MENU_FETCH_MODES)};`,
  `const MENU_CONTEXT_LIMIT = ${MENU_CONTEXT_LIMIT};`,
  `const MENU_NAME_KEYWORDS = ${JSON.stringify(MENU_NAME_KEYWORDS)};`,
  `const MENU_SCAFFOLDING = ${JSON.stringify(MENU_SCAFFOLDING)};`,
  normalizeMenuText.toString(),
  stripMenuScaffolding.toString(),
  parseMenuIntent.toString(),
  buildMenuQueryString.toString(),
  isValidMenuEntry.toString(),
  formatMenuLine.toString(),
  buildMenuContext.toString(),
].join('\n');

const ROUTER_RUNNER = [
  'const input = $input.first().json;',
  'const event = (input && input.body && input.body.events && input.body.events[0]) || null;',
  "if (!event || event.type !== 'message') return [];",
  "if (!event.message || event.message.type !== 'text' || !String(event.message.text || '').trim()) {",
  "  return [{ json: { ...input, hasSafeAnswer: true, output: 'ตอนนี้ผมอ่านได้เฉพาะข้อความครับ รบกวนพิมพ์รายละเอียดที่ต้องการให้ช่วยในแชทนี้ครับ' } }];",
  '}',
  'const menuPlan = parseMenuIntent(String(event.message.text));',
  'const menuQueryString = buildMenuQueryString(menuPlan);',
  "return [{ json: { ...input, hasSafeAnswer: false, menuPlan, menuQueryString, responseSource: 'conversation-ai' } }];",
].join('\n');

export function buildConversationRouter() {
  return `${MENU_INTENT_PRELUDE}\n${ROUTER_RUNNER}`;
}
export const conversationRouter = buildConversationRouter();

export function buildAiAgentText() {
  return "={{ 'เวลาปัจจุบันประเทศไทย: ' + $now.setZone('Asia/Bangkok').toISO() + '\\nข้อความลูกค้า: ' + $json.body.events[0].message.text + ($json.menuContext || '') }}";
}

const MENU_CONTEXT_RUNNER = [
  "const faqOut = (($('Deterministic FAQ').first().json) || {});",
  'const incoming = $input.first().json || {};',
  'const plan = faqOut.menuPlan || null;',
  'let apiResult = null;',
  'if (incoming && Array.isArray(incoming.menus)) apiResult = { ok: true, menus: incoming.menus };',
  'else if (incoming && incoming.error) apiResult = { ok: false };',
  'else if (plan && plan.menuLookupNeeded) apiResult = { ok: false };',
  'const menuContext = buildMenuContext(plan, apiResult);',
  'return [{ json: { ...faqOut, menuContext } }];',
].join('\n');

export function buildMenuContextNodeCode() {
  return `${MENU_INTENT_PRELUDE}\n${MENU_CONTEXT_RUNNER}`;
}

export function buildMenuLookupIfNode(position = [2060, 140]) {
  return {
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [{
          id: 'eed-menu-lookup-needed',
          leftValue: `={{ [${MENU_FETCH_MODES.map((mode) => `'${mode}'`).join(',')}].includes((($json.menuPlan || {}).mode || '')) ? 'fetch' : 'skip' }}`,
          operator: { type: 'string', operation: 'equals' },
          rightValue: 'fetch',
        }],
        combinator: 'and',
      },
      options: {},
    },
    id: 'menu-lookup-needed',
    name: 'Menu Lookup Needed?',
    type: 'n8n-nodes-base.if',
    typeVersion: 2,
    position,
  };
}

export function buildFetchMenuCatalogNode(position = [2260, 140]) {
  return {
    parameters: {
      method: 'GET',
      url: `={{ ($env.INTERNAL_API_BASE_URL || 'http://127.0.0.1:8788') + '/api/v1/menus/mealbox?' + ($json.menuQueryString || 'limit=${MENU_CONTEXT_LIMIT}') }}`,
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendBody: false,
      options: { timeout: 10000 },
    },
    credentials: { httpHeaderAuth: { id: null, name: INTERNAL_API_CREDENTIAL_NAME } },
    id: 'fetch-menu-catalog',
    name: 'Fetch Menu Catalog',
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    position,
    onError: 'continueRegularOutput',
  };
}

export function buildMenuContextNode(position = [2460, 140]) {
  return {
    parameters: { jsCode: buildMenuContextNodeCode() },
    id: 'build-menu-context',
    name: 'Build Menu Context',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position,
    onError: 'continueRegularOutput',
  };
}

// Guards for the menu-lookup HTTP node: same credential-by-name,
// env-based URL, and timeout rules as the persistence chain, plus a fixed
// internal menu path and no request body (GET) and no literal secrets.
export function findMenuLookupMisconfigurations(workflow) {
  const problems = [];
  for (const name of ['Menu Lookup Needed?', 'Fetch Menu Catalog', 'Build Menu Context']) {
    if (!(workflow?.nodes || []).some((node) => node.name === name)) problems.push(`${name}: missing`);
  }
  const node = (workflow?.nodes || []).find((n) => n.name === 'Fetch Menu Catalog');
  if (!node) return problems;
  const params = node.parameters || {};
  if (node.type !== 'n8n-nodes-base.httpRequest') problems.push('Fetch Menu Catalog: must be an HTTP Request node');
  if (params.method !== 'GET') problems.push('Fetch Menu Catalog: must use GET');
  if (typeof params.url !== 'string' || !params.url.includes('$env.INTERNAL_API_BASE_URL')) {
    problems.push('Fetch Menu Catalog: URL must derive from $env.INTERNAL_API_BASE_URL');
  }
  if (typeof params.url !== 'string' || !params.url.includes('/api/v1/menus/mealbox')) {
    problems.push('Fetch Menu Catalog: URL must target the internal menu catalog path');
  }
  if (params.sendBody) problems.push('Fetch Menu Catalog: must not send a body');
  if (params.authentication !== 'genericCredentialType' || params.genericAuthType !== 'httpHeaderAuth') {
    problems.push('Fetch Menu Catalog: must use HTTP Header Auth credential');
  }
  if (node.credentials?.httpHeaderAuth?.name !== INTERNAL_API_CREDENTIAL_NAME) {
    problems.push(`Fetch Menu Catalog: must reference the '${INTERNAL_API_CREDENTIAL_NAME}' credential by name`);
  }
  if (!params.options?.timeout) problems.push('Fetch Menu Catalog: must set a request timeout');
  if (JSON.stringify(params).match(/Bearer\s+[A-Za-z0-9\-_~+/=]{20,}/)) {
    problems.push('Fetch Menu Catalog: must not embed a bearer secret');
  }
  if (/DATABASE_URL|postgres:\/\//i.test(JSON.stringify(params))) {
    problems.push('Fetch Menu Catalog: n8n must never touch the database directly');
  }
  return problems;
}

// Idempotent candidate-only topology patch: inserts the deterministic menu
// branch (Menu Lookup Needed? -> Fetch Menu Catalog -> Build Menu Context)
// between "Has Safe Answer?" (AI branch) and "AI Agent", refreshes the
// generated FAQ/AI strings, and leaves every other node/edge untouched.
export function ensureCandidateMenuLookup(candidate) {
  const updated = structuredClone(candidate);
  const byName = (name) => updated.nodes.find((node) => node.name === name);
  for (const build of [buildMenuLookupIfNode, buildFetchMenuCatalogNode, buildMenuContextNode]) {
    const fresh = build();
    const existing = byName(fresh.name);
    if (existing) {
      existing.parameters = fresh.parameters;
      existing.type = fresh.type;
      existing.typeVersion = fresh.typeVersion;
      if (fresh.onError) existing.onError = fresh.onError;
      if (fresh.credentials) existing.credentials = fresh.credentials;
    } else {
      updated.nodes.push(fresh);
    }
  }
  const edge = (name) => ({ node: name, type: 'main', index: 0 });
  updated.connections['Has Safe Answer?'].main[1] = [edge('Menu Lookup Needed?')];
  updated.connections['Menu Lookup Needed?'] = { main: [[edge('Fetch Menu Catalog')], [edge('Build Menu Context')]] };
  updated.connections['Fetch Menu Catalog'] = { main: [[edge('Build Menu Context')]] };
  updated.connections['Build Menu Context'] = { main: [[edge('AI Agent')]] };
  byName('Deterministic FAQ').parameters.jsCode = buildConversationRouter();
  byName('AI Agent').parameters.text = buildAiAgentText();
  byName('Persist Draft').parameters.jsonBody = buildPersistDraftJsonBody('Normalize Response', { includeReplyToken: false });
  return updated;
}

export function updateConversation(workflow, systemMessage, ruleRevision = '') {
  const updated = structuredClone(workflow);
  const byName = (name) => updated.nodes.find((node) => node.name === name);
  const agent = byName('AI Agent');
  const router = byName('Deterministic FAQ');
  const model = byName('Gemini Chat Model');
  const memory = byName('Simple Memory');
  const normalize = byName('Normalize Event');
  const resolve = byName('Resolve Customer');
  const evaluate = byName('Evaluate Lead');
  const persist = byName('Persist Draft');
  const verify = byName('Verify Draft');
  const routerBranch = updated.connections['Has Safe Answer?'];
  assert.ok(agent && router && model && memory && normalize && resolve && evaluate && persist && verify && routerBranch,
    'Expected persistence-chain nodes are missing (AI Agent, Deterministic FAQ, Has Safe Answer?, Normalize Event, Resolve Customer, Evaluate Lead, Persist Draft, Verify Draft, Gemini Chat Model, Simple Memory).');
  assert.ok(!byName('Build Draft'), 'Legacy Build Draft node must be removed (PostgreSQL is the Draft store).');
  assert.ok(model.credentials && Object.keys(model.credentials).length, 'The existing model needs a configured credential.');
  const chain = updated.connections;
  assert.equal(routerBranch?.main?.[1]?.[0]?.node, agent.name, 'AI fallback branch is missing.');
  assert.equal(routerBranch?.main?.[0]?.[0]?.node, normalize.name, 'Deterministic branch must enter normalization.');
  assert.equal(chain['AI Agent']?.main?.[0]?.[0]?.node, normalize.name, 'AI output must enter normalization (no auto-send).');
  assert.equal(chain['Normalize Event']?.main?.[0]?.[0]?.node, resolve.name, 'Normalization must resolve the customer first.');
  assert.equal(chain['Resolve Customer']?.main?.[0]?.[0]?.node, evaluate.name, 'Customer must precede lead evaluation.');
  assert.equal(chain['Evaluate Lead']?.main?.[0]?.[0]?.node, persist.name, 'Lead evaluation must precede draft persistence.');
  assert.equal(chain['Persist Draft']?.main?.[0]?.[0]?.node, verify.name, 'Persistence must end at the Verify Draft guard.');
  const terminalEdges = (chain['Verify Draft']?.main || []).flat().filter((edge) => edge?.node);
  assert.deepEqual(terminalEdges, [], 'Verify Draft is terminal (STOP, never a sender).');
  const senders = findCustomerSenders(updated);
  assert.deepEqual(senders, [], `Customer auto-send nodes must not exist: ${senders.join(', ')}`);
  const kitchenPush = findKitchenAutoPush(updated);
  assert.deepEqual(kitchenPush, [], `Kitchen auto-push nodes must stay disabled: ${kitchenPush.join(', ')}`);
  const staticStores = findStaticDraftStores(updated);
  assert.deepEqual(staticStores, [], `Static Draft staging must not exist: ${staticStores.join(', ')}`);
  const misconfigurations = findPersistenceMisconfigurations(updated);
  assert.deepEqual(misconfigurations, [], `Persistence nodes misconfigured:\n${misconfigurations.join('\n')}`);
  agent.parameters.options = { ...agent.parameters.options, systemMessage };
  agent.parameters.text = buildAiAgentText();
  router.parameters.jsCode = buildConversationRouter();
  persist.parameters.jsonBody = buildPersistDraftJsonBody('Normalize Event');
  normalize.parameters.jsCode = buildNormalizeNodeCode(ruleRevision);
  verify.parameters.jsCode = buildVerifyDraftNodeCode();
  // Do not mix different customers' conversation history in a shared group.
  memory.parameters.sessionKey = "={{ ($json.body.events[0].source.groupId || $json.body.events[0].source.roomId || 'direct') + ':' + $json.body.events[0].source.userId }}";
  // Remove only orphan connection entries left by deleted nodes.
  const names = new Set(updated.nodes.map((node) => node.name));
  for (const name of Object.keys(updated.connections)) {
    if (!names.has(name)) delete updated.connections[name];
  }
  return updated;
}
