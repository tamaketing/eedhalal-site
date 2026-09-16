import assert from 'node:assert/strict';
import { execFile as execFileCb } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { promisify } from 'node:util';
import vm from 'node:vm';
import {
  allowedTransitionsFrom,
  createDraft,
  createMemoryDraftStore,
  DRAFT_STATUSES,
  transitionDraft,
  validateDraft,
} from '../line-ai/draft-schema.mjs';
import { findCustomerSenders, findKitchenAutoPush } from '../line-ai/conversation-update.mjs';
import { getEffectiveMenus, loadSystemData } from '../scripts/check-system.mjs';

const execFileAsync = promisify(execFileCb);

const workflow = JSON.parse(await readFile(new URL('../line-ai/n8n-workflow.json', import.meta.url), 'utf8'));
const byId = new Map(workflow.nodes.map((node) => [node.id, node]));

function reachable(start, connections) {
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length) {
    const name = queue.shift();
    for (const branch of connections[name]?.main || []) {
      for (const edge of branch || []) {
        if (edge?.node && !seen.has(edge.node)) {
          seen.add(edge.node);
          queue.push(edge.node);
        }
      }
    }
  }
  return [...seen];
}

function runCode(jsCode, sandbox) {
  return vm.runInNewContext(`(function() { ${jsCode} })()`, sandbox);
}

function webhookEvent(text = '80 กล่อง ส่งวัฒนา ส่งฟรีไหม', type = 'user') {
  return {
    type: 'message',
    replyToken: 'test-reply-token',
    source: type === 'user' ? { type, userId: 'Utestcustomer01' } : { type: 'group', groupId: 'G1', userId: 'Utestcustomer01' },
    message: { id: 'm1', type: 'text', text },
  };
}

function runBuildDraft(aiItem, event) {
  const stored = {};
  const code = byId.get('build-draft').parameters.jsCode;
  const [result] = runCode(code, {
    $input: { first: () => ({ json: aiItem }) },
    $: () => ({ first: () => ({ json: { body: { events: [event] } } }) }),
    $getWorkflowStaticData: () => stored,
  });
  return { draft: result.json.draft, stored };
}

// A. AI output must never reach a LINE customer sender.
test('A: workflow has no customer auto-send path from AI output', () => {
  assert.deepEqual(findCustomerSenders(workflow), []);
  assert.ok(!workflow.nodes.some((node) => node.name === 'Reply to LINE'));
  assert.ok(!workflow.nodes.some((node) => node.name === 'Show Loading'));
  const stops = reachable('AI Agent', workflow.connections);
  assert.ok(stops.includes('Build Draft'), 'AI must flow into Build Draft');
  assert.equal(stops.length, 2, `AI must terminate at Build Draft, got: ${stops.join(', ')}`);
});

// B. Every customer message ends as a Draft waiting for the owner.
test('B: AI path produces a WAITING_FOR_HUMAN draft and stops', () => {
  const event = webhookEvent();
  const aiItem = {
    body: { events: [event] },
    hasSafeAnswer: false,
    budgetContext: '',
    responseSource: 'conversation-ai',
    output: 'สวัสดีค่ะ 80 กล่องส่งวัฒนาได้ค่ะ',
  };
  const { draft, stored } = runBuildDraft(aiItem, event);
  assert.equal(draft.status, 'WAITING_FOR_HUMAN');
  assert.equal(draft.customerId, 'Utestcustomer01');
  assert.equal(draft.channel, 'line');
  assert.equal(draft.incomingMessage, event.message.text);
  assert.equal(draft.draftResponse, aiItem.output);
  assert.equal(draft.source, 'conversation-ai');
  assert.deepEqual(validateDraft(draft), []);
  assert.ok(stored[`eedDraft:${draft.draftId}`], 'draft must be staged for owner review');
});

test('B: deterministic fallback also produces a WAITING_FOR_HUMAN draft', () => {
  const event = webhookEvent('', 'user');
  event.message = { id: 'm2', type: 'image' };
  const { draft } = runBuildDraft(
    { body: { events: [event] }, hasSafeAnswer: true, output: 'ตอนนี้ผมอ่านได้เฉพาะข้อความครับ' },
    event,
  );
  assert.equal(draft.status, 'WAITING_FOR_HUMAN');
  assert.equal(draft.source, 'deterministic-fallback');
  assert.equal(draft.incomingMessage, '[non-text message: image]');
  assert.deepEqual(validateDraft(draft), []);
});

// C. Kitchen auto-push stays disabled.
test('C: no automatic kitchen push exists in the workflow', () => {
  assert.deepEqual(findKitchenAutoPush(workflow), []);
  assert.ok(!workflow.nodes.some((node) => /kitchen/i.test(node.name || '')));
  assert.ok(!JSON.stringify(workflow).match(/C376276c7dc07168bfce17ada607e1200/));
});

// D. Bot business data derives from business-rules.json.
test('D: router menus and draft revision match the source of truth', async () => {
  const { rules, catalog, legacy } = await loadSystemData();
  const routerCode = byId.get('deterministic-faq').parameters.jsCode;
  const embedded = JSON.parse(routerCode.match(/const menus = (\[.*?\]);/s)[1]);
  assert.deepEqual(
    embedded,
    getEffectiveMenus(legacy.menus, catalog).map(({ name, price, minPerMenu }) => ({ name, price, minPerMenu })),
  );
  assert.ok(byId.get('build-draft').parameters.jsCode.includes(JSON.stringify(rules.revision)));
  const agentMessage = byId.get('ai-agent').parameters.options.systemMessage;
  const knowledge = await readFile(new URL('../line-ai/knowledge-pack.md', import.meta.url), 'utf8');
  assert.ok(agentMessage.startsWith(knowledge.trim().split('\n')[0]));
  assert.ok(agentMessage.includes(rules.business.halalCertificate));
  assert.ok(agentMessage.includes(`เริ่ม ${rules.services.mealBox.priceFrom} บาท/กล่อง`));
});

// E. No hardcoded LINE token in tracked source.
test('E: tracked source contains no hardcoded LINE token or direct LINE API calls', async () => {
  const { stdout } = await execFileAsync('git', ['ls-files', '-z']);
  const tokenLiteral = new RegExp(`${'Bear'}er\\s+[A-Za-z0-9\\-_~+/=]{20,}`);
  const lineApi = new RegExp(`api(-data)?\\.line\\.me`);
  const offenders = [];
  const snapshotTokenLeaks = [];
  for (const file of stdout.split('\0').filter(Boolean)) {
    if (!/\.(mjs|js|json|ts|yml|yaml|ps1|cmd|bat|html|md)$/.test(file)) continue;
    const content = await readFile(new URL(`../${file}`, import.meta.url), 'utf8').catch(() => null);
    if (content === null) continue;
    // Frozen snapshots under artifacts/ must never carry a live secret
    // (endpoint URLs alone are public and allowed there).
    if (file.startsWith('artifacts/')) {
      if (tokenLiteral.test(content)) snapshotTokenLeaks.push(file);
      continue;
    }
    if (tokenLiteral.test(content) || lineApi.test(content)) offenders.push(file);
  }
  assert.deepEqual(snapshotTokenLeaks, []);
  assert.deepEqual(offenders, []);
});

// F. Gateway verification chain still works.
test('F: webhook verify node accepts the shared secret and rejects bypass', () => {
  const code = byId.get('verify-webhook-gateway').parameters.jsCode;
  const ok = runCode(code, {
    $env: { EED_WEBHOOK_FORWARD_SECRET: 's3cret' },
    $json: { headers: { 'x-eed-webhook-secret': 's3cret' } },
    $input: { all: () => [{ json: { ok: true } }] },
  });
  assert.equal(ok[0].json.ok, true);
  assert.throws(() =>
    runCode(code, {
      $env: { EED_WEBHOOK_FORWARD_SECRET: 's3cret' },
      $json: { headers: {} },
      $input: { all: () => [] },
    }),
  );
  assert.throws(() =>
    runCode(code, {
      $env: {},
      $json: { headers: { 'x-eed-webhook-secret': 's3cret' } },
      $input: { all: () => [] },
    }),
  );
});

// Draft schema unit coverage.
test('draft schema supports the full human-approval lifecycle', () => {
  assert.ok(DRAFT_STATUSES.includes('WAITING_FOR_HUMAN'));
  for (const status of ['APPROVED', 'EDITED', 'REGENERATED', 'REJECTED', 'SENT', 'FAILED']) {
    assert.ok(DRAFT_STATUSES.includes(status), status);
  }
  const store = createMemoryDraftStore();
  const draft = store.save(createDraft({ customerId: 'U1', incomingMessage: 'hi', draftResponse: 'hello' }));
  assert.equal(draft.status, 'WAITING_FOR_HUMAN');
  assert.deepEqual(allowedTransitionsFrom('WAITING_FOR_HUMAN').sort(), ['APPROVED', 'EDITED', 'FAILED', 'REGENERATED', 'REJECTED'].sort());
  const approved = transitionDraft(draft, 'APPROVED');
  assert.ok(approved.approvedAt);
  const sent = transitionDraft(approved, 'SENT');
  assert.ok(sent.sentAt);
  assert.throws(() => transitionDraft(sent, 'APPROVED'), /illegal draft transition/);
  assert.throws(() => transitionDraft(draft, 'SENT'), /illegal draft transition/);
  const edited = transitionDraft(transitionDraft(createDraft({ customerId: 'U2', incomingMessage: 'x', draftResponse: 'y' }), 'EDITED'), 'REJECTED');
  assert.equal(edited.status, 'REJECTED');
  assert.ok(validateDraft({}).length > 0);
});
