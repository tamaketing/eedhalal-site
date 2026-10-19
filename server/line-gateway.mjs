// LINE reply gateway — the "dispatcher" between the webhook, the Internal
// API, and the chat-replier agent.
//
// One inbound text message becomes one draft. In shadow mode (AUTO_REPLY unset)
// every draft stays WAITING_FOR_HUMAN for the owner. When AUTO_REPLY=1, the
// safe lanes (auto facts + confident agent answers) are sent immediately via
// the LINE Reply API; money/order messages always stay for the owner.
//
//   node server/line-gateway.mjs        (runs the webhook + this worker)
//
// The replyToken is used in-memory once and never persisted. Nothing is sent
// unless AUTO_REPLY=1 AND LINE_CHANNEL_ACCESS_TOKEN is configured.
import { createLineWebhook } from './line-webhook.mjs';
import { askChatReplier } from '../tools/agent/line-chat.mjs';
import { classifyLineMessage } from '../services/lineFaq.mjs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const isCli = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

export const API_HOST = process.env.INTERNAL_API_HOST || '127.0.0.1';
export const API_PORT = Number(process.env.INTERNAL_API_PORT || 8788);
export const API_BASE = `http://${API_HOST}:${API_PORT}`;

/** Kill switch: auto-reply is OFF unless the owner sets AUTO_REPLY=1. */
export function autoReplyEnabled(env = process.env) {
  return String(env.AUTO_REPLY || '').trim() === '1';
}

function apiSecret(env = process.env) {
  const secret = env.EED_INTERNAL_API_SECRET;
  if (!secret) throw new Error('ยังไม่ได้ตั้ง EED_INTERNAL_API_SECRET — เปิด Internal API ก่อน (npm run api:start) แล้วตั้งค่า secret');
  return secret;
}

async function api(method, route, body) {
  const response = await fetch(`${API_BASE}${route}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiSecret()}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Internal API ${method} ${route} -> ${response.status} ${text.slice(0, 200)}`);
  }
  return response.json();
}

/** Resolve lineUserId -> customerId (idempotent). */
export async function resolveCustomer(lineUserId) {
  const data = await api('POST', '/api/v1/customers/resolve', { lineUserId });
  return data.customer?.id || null;
}

/** Persist the inbound message first (dedup by webhookEventId). */
export async function receiveInbound({ lineUserId, incomingMessage, sourceEventId }) {
  const data = await api('POST', '/api/v1/inbound-messages', {
    lineUserId,
    channel: 'line',
    messageType: 'text',
    incomingMessage,
    sourceEventId,
  });
  return data.inbound || null;
}

/** Recent conversation turns for a customer, oldest last, for the AI prompt. */
export async function conversationHistory(customerId, { limit = 8 } = {}) {
  const data = await api('GET', `/api/v1/drafts?customerId=${encodeURIComponent(customerId)}&limit=${limit}&order=desc`);
  const drafts = data.drafts || [];
  // desc returns newest first; reverse to oldest->newest so the AI reads in order.
  const ordered = [...drafts].reverse();
  const turns = [];
  for (const draft of ordered) {
    if (draft.incomingMessage) turns.push({ role: 'customer', text: draft.incomingMessage });
    const reply = draft.ownerFinalResponse || draft.draftResponse;
    if (reply) turns.push({ role: 'shop', text: reply });
  }
  return turns;
}

/** Create the WAITING_FOR_HUMAN draft with the AI-drafted reply. */
export async function createDraft({ customerId, incomingMessage, draftResponse, sourceEventId, aiModel, ruleRevision }) {
  const data = await api('POST', '/api/v1/drafts', {
    customerId,
    channel: 'line',
    incomingMessage,
    draftResponse,
    source: 'conversation-ai',
    aiModel,
    ruleRevision,
    sourceEventId,
  });
  return data.draft || null;
}

/** Send an already-created draft immediately via the LINE Reply API. */
export async function autoReplyDraft({ draftId, replyToken }) {
  const data = await api('POST', `/api/v1/drafts/${encodeURIComponent(draftId)}/auto-reply`, { replyToken });
  return data.send || null;
}

async function loadRuleRevision() {
  try {
    const rules = JSON.parse(await readFile(path.join(ROOT, 'data/business-rules.json'), 'utf8'));
    return typeof rules.revision === 'string' ? rules.revision : '';
  } catch {
    return '';
  }
}

async function loadRulesAndPlanner() {
  const [rules, planner] = await Promise.all([
    readFile(path.join(ROOT, 'data/business-rules.json'), 'utf8'),
    readFile(path.join(ROOT, 'data/planner-overrides.json'), 'utf8'),
  ]);
  return { rules: JSON.parse(rules), planner: JSON.parse(planner) };
}

/**
 * The full pipeline for one LINE text message.
 * Shadow mode: always creates a draft, never sends.
 * Auto mode: safe lanes are replied to immediately; money/order waits.
 */
export async function handleLineMessage({ userId, text, webhookEventId, replyToken, env = process.env }) {
  const result = { userId, route: 'error', draftId: null, sent: false, error: null };

  if (!userId || !String(text ?? '').trim()) {
    result.error = 'missing userId or text';
    return result;
  }

  const { rules, planner } = await loadRulesAndPlanner();
  const triage = classifyLineMessage(text, { rules, planner });

  const customerId = await resolveCustomer(userId);
  if (!customerId) {
    result.error = 'customer resolve failed';
    return result;
  }
  result.customerId = customerId;

  // Dedup is keyed on webhookEventId (LINE's stable per-delivery id), which
  // stays distinct from replyToken (the single-use reply credential).
  await receiveInbound({ lineUserId: userId, incomingMessage: text, sourceEventId: webhookEventId || replyToken });

  const history = await conversationHistory(customerId);
  const ruleRevision = await loadRuleRevision();
  const auto = autoReplyEnabled(env);

  // Money/order/custom-price: never auto-answer, never auto-send.
  if (triage.route === 'human') {
    const draft = await createDraft({
      customerId,
      incomingMessage: text,
      draftResponse: 'เรื่องสั่งซื้อ/ราคาเฉพาะงาน — เจ้าของต้องตอบเอง (ระบบไม่ร่างให้)',
      sourceEventId: webhookEventId || replyToken,
      aiModel: 'none',
      ruleRevision,
    });
    result.route = 'human';
    result.draftId = draft?.draftId || null;
    return result;
  }

  const answer = await askChatReplier({ message: text, history });
  if (!answer.ok) {
    result.error = answer.error;
    result.route = 'agent_failed';
    return result;
  }

  const draft = await createDraft({
    customerId,
    incomingMessage: text,
    draftResponse: answer.reply,
    sourceEventId: webhookEventId || replyToken,
    aiModel: answer.model || 'opencode-go/glm-5.3-flash',
    ruleRevision,
  });
  result.route = triage.route === 'auto' ? 'auto' : 'agent';
  result.draftId = draft?.draftId || null;
  if (!result.draftId) {
    result.error = 'draft create failed';
    return result;
  }

  // Auto-send only when: switch on, a reply token exists, and the AI produced
  // a real (non-placeholder) answer.
  if (auto && replyToken && answer.reply && !answer.reply.startsWith('เรื่องสั่งซื้อ')) {
    try {
      const sent = await autoReplyDraft({ draftId: result.draftId, replyToken });
      result.sent = sent?.outcome === 'ACCEPTED';
      if (!result.sent) result.error = `auto-send ${sent?.code || 'failed'}`;
    } catch (error) {
      result.error = error.message;
    }
  }
  return result;
}

async function main() {
  const secret = process.env.LINE_CHANNEL_SECRET;
  if (!secret) {
    process.stderr.write('ต้องตั้ง LINE_CHANNEL_SECRET ก่อน (webhook ตรวจลายเซ็น)\n');
    process.exitCode = 1;
    return;
  }
  const port = Number(process.env.LINE_WEBHOOK_PORT || 5678);
  const auto = autoReplyEnabled();
  const mode = auto ? 'AUTO-REPLY ON' : 'SHADOW (ไม่ส่ง)';

  const server = createLineWebhook({
    channelSecret: secret,
    onEvent: async (message) => {
      const started = Date.now();
      const outcome = await handleLineMessage({
        userId: message.userId,
        text: message.text,
        webhookEventId: message.webhookEventId,
        replyToken: message.replyToken,
      });
      const ms = Date.now() - started;
      process.stdout.write(
        `[line-gateway] route=${outcome.route} draft=${outcome.draftId || '-'} sent=${outcome.sent ? 'yes' : 'no'} ${ms}ms${outcome.error ? ` err=${outcome.error}` : ''}\n`,
      );
    },
  });

  server.listen(port, '127.0.0.1', () => {
    process.stdout.write(`LINE gateway (${mode}) ฟังที่ http://127.0.0.1:${port}/\n`);
  });
}

if (isCli) {
  main().catch((error) => {
    process.stderr.write(`gateway ไม่สำเร็จ: ${error.message}\n`);
    process.exitCode = 1;
  });
}
