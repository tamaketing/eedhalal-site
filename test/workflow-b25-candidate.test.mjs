import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

// B2.5 Step 3: static validation of the SEPARATE persist-first candidate.
// The Gate B2 production artifact (line-ai/n8n-workflow.json) must stay the
// 12-node flow until cutover is approved; this file never touches it except
// to assert it is unchanged.

const candidate = JSON.parse(await readFile(new URL('../line-ai/n8n-workflow-b25-persist-first.json', import.meta.url), 'utf8'));
const production = JSON.parse(await readFile(new URL('../line-ai/n8n-workflow.json', import.meta.url), 'utf8'));

const nodes = new Map(candidate.nodes.map((n) => [n.name, n]));

// Reachability over main-output edges only (ai_* sub-inputs excluded).
function reachableMain(from) {
  const seen = new Set();
  const queue = [from];
  while (queue.length) {
    const name = queue.shift();
    if (seen.has(name)) continue;
    seen.add(name);
    const edges = candidate.connections[name]?.main || [];
    for (const group of edges) for (const e of group || []) queue.push(e.node);
  }
  return seen;
}

function orderBefore(a, b, label) {
  assert.ok(reachableMain(a).has(b), `${label}: ${a} must precede ${b}`);
}

test('candidate is a distinct inactive-by-design artifact, not the production path', () => {
  const webhook = nodes.get('LINE Webhook');
  assert.equal(webhook.parameters.path, 'line-webhook-b25-candidate');
  assert.notEqual(webhook.parameters.path, 'line-webhook');
  assert.equal(webhook.parameters.responseMode, 'onReceived');
  assert.match(candidate.name, /B2\.5 Persist First Candidate/);
  assert.equal(candidate.nodes.length, 21);
});

test('Gate B2 production artifact is still the 12-node flow', () => {
  assert.equal(production.nodes.length, 12);
  assert.ok(production.nodes.some((n) => n.name === 'Normalize Event'));
  assert.ok(!production.nodes.some((n) => n.name === 'Persist Inbound'));
  assert.equal(production.nodes.find((n) => n.type === 'n8n-nodes-base.webhook').parameters.path, 'line-webhook');
});

test('Persist Inbound precedes all AI/lead/draft work', () => {
  // NOTE: Gemini Chat Model / Simple Memory attach via ai_* sub-outputs, not the
  // main chain; their execution is gated by AI Agent, which IS ordered below.
  for (const later of ['Deterministic FAQ', 'Has Safe Answer?', 'AI Agent', 'Evaluate Lead', 'Persist Draft', 'Complete Inbound']) {
    orderBefore('Persist Inbound', later, 'persist-first');
  }
  orderBefore('Mark Processing', 'AI Agent', 'processing-gate');
  orderBefore('Mark Processing', 'Deterministic FAQ', 'processing-gate');
  orderBefore('Persist Draft', 'Complete Inbound', 'completion-last');
});

test('AI error path reaches Fail Inbound and stops with no outbound', () => {
  orderBefore('Route AI Result', 'Classify AI Error', 'error-route');
  orderBefore('Classify AI Error', 'Fail Inbound', 'fail-route');
  assert.deepEqual(candidate.connections['Fail Inbound'].main, [[]]);
  assert.deepEqual(candidate.connections['Verify Draft'].main, [[]]);
  const ai = nodes.get('AI Agent');
  const faq = nodes.get('Deterministic FAQ');
  assert.equal(ai.onError, 'continueRegularOutput');
  assert.equal(faq.onError, 'continueRegularOutput');
});

test('Route AI Result sends genuine errors AND missing/invalid output to the classifier', () => {
  const cond = nodes.get('Route AI Result').parameters.conditions.conditions[0];
  assert.equal(cond.rightValue, 'error');
  const expr = cond.leftValue.replace(/^\s*=\{\{\s*/, '').replace(/\s*\}\}\s*$/, '');
  const route = (json) => vm.runInNewContext(expr, { $json: json });
  // Genuine errors route to the classifier regardless of accompanying fields.
  assert.equal(route({ error: { message: 'HTTP 429' }, output: 'stale' }), 'error');
  assert.equal(route({ error: { message: 'boom' } }), 'error');
  // Missing/invalid AI output also reaches the classifier (never Persist Draft).
  assert.equal(route({}), 'error');
  assert.equal(route({ output: '', text: '', responseSource: 'conversation-ai' }), 'error');
  assert.equal(route({ output: '   ' }), 'error');
  // Every legitimate success shape proceeds.
  assert.equal(route({ output: 'ตอนนี้ผมอ่านได้เฉพาะข้อความครับ' }), 'ok');
  assert.equal(route({ text: 'UND policy text' }), 'ok');
  assert.equal(route({ draftResponse: 'x' }), 'ok');
  assert.equal(route({ error: null, output: 'x' }), 'ok');
});

test('non-RECEIVED inbound stops before customer resolution', () => {
  const inspect = nodes.get('Inspect Inbound State');
  assert.equal(inspect.type, 'n8n-nodes-base.if');
  const cond = inspect.parameters.conditions.conditions[0];
  assert.match(cond.leftValue, /inbound\.status/);
  assert.equal(cond.rightValue, 'RECEIVED');
  // False branch is unconnected: execution terminates successfully.
  assert.deepEqual(candidate.connections['Inspect Inbound State'].main[1], []);
});

test('all node cross-references resolve to real nodes', () => {
  const names = new Set(candidate.nodes.map((n) => n.name));
  const refs = new Set();
  const re = /\$\('([^']+)'\)/g;
  const text = JSON.stringify(candidate);
  let m;
  while ((m = re.exec(text))) refs.add(m[1]);
  for (const ref of refs) assert.ok(names.has(ref), `dangling reference: ${ref}`);
  for (const [src, outs] of Object.entries(candidate.connections)) {
    assert.ok(names.has(src), `dangling connection source: ${src}`);
    for (const [type, groups] of Object.entries(outs)) {
      for (const group of groups) {
        for (const e of group || []) {
          assert.ok(names.has(e.node), `dangling connection target: ${e.node}`);
          if (type === 'main') assert.equal(e.type, 'main');
        }
      }
    }
  }
});

test('every Internal API body is JSON.stringify serialized with no secrets', () => {
  const http = candidate.nodes.filter((n) => n.type === 'n8n-nodes-base.httpRequest');
  assert.equal(http.length, 8);
  for (const n of http) {
    assert.match(n.parameters.url, /INTERNAL_API_BASE_URL/, `${n.name} uses env base URL`);
    assert.ok(n.parameters.jsonBody.includes('JSON.stringify'), `${n.name} serializes safely`);
    assert.ok(!n.parameters.jsonBody.includes('replyToken'), `${n.name} persists no replyToken`);
  }
  const text = JSON.stringify(candidate);
  const codeOnly = text.replace(/\/\/[^\n]*/g, '');
  assert.ok(!/replyToken/i.test(codeOnly), 'no replyToken anywhere in candidate');
  assert.ok(!/DATABASE_URL/.test(text), 'no DATABASE_URL in candidate');
  assert.ok(!/Bearer\s+[A-Za-z0-9_\-.]{20,}/.test(text), 'no bearer token in candidate');
  assert.ok(!/"id":\s*"[a-zA-Z0-9]{20,}"/.test(text), 'no production credential IDs in candidate');
});

test('candidate has zero outbound capability', () => {
  const hay = candidate.nodes.map((n) => n.name + ' ' + n.type).join('\n').toLowerCase();
  for (const word of ['sender', 'line-reply', 'line-push', 'kitchen', 'messagingapi', 'line-bot']) {
    assert.ok(!hay.includes(word), `no ${word} node`);
  }
  assert.ok(!JSON.stringify(candidate.connections).match(/api\.line\.me/), 'no LINE API calls');
});

test('AI error classifier maps only to the approved catalog', () => {
  const code = nodes.get('Classify AI Error').parameters.jsCode;
  for (const c of ['AI_RATE_LIMIT', 'AI_TIMEOUT', 'AI_PROVIDER_ERROR', 'AI_INVALID_RESPONSE']) {
    assert.ok(code.includes(`'${c}'`), `classifier covers ${c}`);
  }
  assert.ok(!/Gemini|google|429.*body|errorDetail:\s*\w+\.message/i.test(code), 'no provider bodies persisted');
  const run = (error) => vm.runInNewContext(`(function () { ${code} })()`, {
    $input: { first: () => ({ json: error }) },
    $: () => ({ first: () => ({ json: { inbound: { id: 'i1', revision: 7 } } }) }),
  })[0].json;
  assert.equal(run({ error: { message: 'HTTP 429 quota exceeded' } }).errorCode, 'AI_RATE_LIMIT');
  assert.equal(run({ error: { message: 'request timed out after 10s' } }).errorCode, 'AI_TIMEOUT');
  assert.equal(run({ error: { message: 'socket hang up' } }).errorCode, 'AI_PROVIDER_ERROR');
  assert.equal(run({ error: { message: 'empty response, no text field' } }).errorCode, 'AI_INVALID_RESPONSE');
  assert.equal(run({ error: { message: 'socket hang up' } }).expectedRevision, 7);
});

test('Normalize Inbound extracts transport only and preserves exact text', () => {
  const code = nodes.get('Normalize Inbound').parameters.jsCode;
  assert.ok(!/event\.replyToken|rawBody|headers\s*\[|[^a-zA-Z]secret/i.test(code.replace(/\/\/[^\n]*/g, '')), 'no sensitive extraction');
  const run = (event) => vm.runInNewContext(`(function () { ${code} })()`, {
    $: () => ({ first: () => ({ json: { body: { events: [event] } } }) }),
  })[0].json;
  const text = 'บรรทัดแรก\n\n"quoted"\tA\\B 😊';
  const out = run({ source: { userId: 'U9' }, message: { id: 'm9', type: 'text', text } });
  assert.equal(out.lineUserId, 'U9');
  assert.equal(out.incomingMessage, text);
  assert.equal(out.sourceEventId, 'm9');
  assert.equal(out.channel, 'line');
  assert.equal(out.messageType, 'text');
  assert.ok(!('replyToken' in out), 'no replyToken in normalized output');
  const group = run({ source: { groupId: 'G1', userId: 'U9' }, message: { id: 'm10', type: 'image' } });
  assert.equal(group.channel, 'line-group');
  assert.equal(group.messageType, 'image');
  assert.equal(group.incomingMessage, '[non-text message: image]');
});

test('copied AI/FAQ/gateway/verify logic is byte-identical to production', () => {
  const prodByName = new Map(production.nodes.map((n) => [n.name, n]));
  for (const name of ['Verify Webhook Gateway', 'Deterministic FAQ', 'AI Agent', 'Gemini Chat Model', 'Simple Memory', 'Verify Draft', 'Has Safe Answer?']) {
    const p = prodByName.get(name);
    const c = nodes.get(name);
    assert.equal(JSON.stringify(c.parameters), JSON.stringify(p.parameters), `${name} parameters identical`);
  }
});
