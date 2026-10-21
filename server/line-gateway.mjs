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
import { askChatReplier, askMemoryWriter, HISTORY_LIMIT } from '../tools/agent/line-chat.mjs';
import { needsProfileRefresh } from '../services/lineProfile.mjs';
import { fetchLineProfile } from '../tools/line/profile.mjs';
import { classifyLineMessage } from '../services/lineFaq.mjs';
import { factsChanged, extractFacts, turnsFromThread } from '../services/customerMemory.mjs';
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
  const customer = await resolveCustomerRecord(lineUserId);
  return customer?.id || null;
}

/** Resolve lineUserId -> the whole customer row (for the bot-pause check). */
export async function resolveCustomerRecord(lineUserId) {
  const data = await api('POST', '/api/v1/customers/resolve', { lineUserId });
  return data.customer || null;
}

/** Persist the inbound message first (dedup by webhookEventId). */
export async function receiveInbound({ lineUserId, incomingMessage, sourceEventId, messageType = 'text' }) {
  const data = await api('POST', '/api/v1/inbound-messages', {
    lineUserId,
    channel: 'line',
    messageType,
    incomingMessage,
    sourceEventId,
  });
  return data.inbound || null;
}

/**
 * Move the inbound receipt through its lifecycle so the stored message is
 * finally connected to the customer and the draft it produced.
 *
 * Before this, every inbound row stayed at RECEIVED with a NULL customer and
 * a NULL draft, so the receipt ledger and the conversation were two
 * disconnected halves of the same customer.
 *
 * Every step is best effort: a bookkeeping problem must never cost the
 * customer their reply. The returned revision is what the next step expects.
 */
export async function advanceInbound(inbound, { customerId, draftId = null, leadId = null } = {}) {  if (!inbound?.id) return inbound || null;
  let revision = Number(inbound.revision || 0);
  let current = inbound;
  const step = async (method, route, body) => {
    const data = await api(method, route, { ...body, expectedRevision: revision });
    current = data.inbound || current;
    revision = Number(current.revision ?? revision + 1);
    return current;
  };
  try {
    if (customerId && !current.customerId) {
      await step('PATCH', `/api/v1/inbound-messages/${encodeURIComponent(current.id)}`, { customerId });
    }
    if (current.status === 'RECEIVED') {
      await step('POST', `/api/v1/inbound-messages/${encodeURIComponent(current.id)}/processing`, {});
    }
    if (draftId) {
      await step('POST', `/api/v1/inbound-messages/${encodeURIComponent(current.id)}/complete`, { draftId, leadId });
    }
  } catch {
    // The message and its draft are already stored; only the linkage is
    // missing, and the next message retries it.
  }
  return current;
}

/**
 * Recent conversation turns for a customer, oldest last, for the AI prompt.
 *
 * The thread comes from the RECEIPT ledger (every message the customer sent),
 * not from the drafts, so a message that never became a draft is still part
 * of the conversation the bot reasons over.
 */
export async function conversationHistory(customerId, { limit = HISTORY_LIMIT } = {}) {
  const data = await api('GET', `/api/v1/customers/${encodeURIComponent(customerId)}/thread`);
  const turns = turnsFromThread(data);
  // The API returns the thread oldest first; the model reads it in order.
  return turns.slice(-limit);
}

/** What the bot remembers about this customer right now (may be empty). */
export async function loadMemory(customerId) {
  const data = await api('GET', `/api/v1/customers/${encodeURIComponent(customerId)}/memory`);
  return data.memory || null;
}

/** Record what this message told us about the customer. */
export async function observeMemory(customerId, { message, summary = '', ruleRevision = '' }) {
  return api('POST', `/api/v1/customers/${encodeURIComponent(customerId)}/memory/observe`, {
    message,
    summary,
    source: summary ? 'ai' : 'rule',
    ruleRevision,
  });
}

/**
 * A lead is a job the customer is actually asking for: a quantity, a date or
 * a budget. The rules decide — a greeting never becomes a lead, and only the
 * owner may move a lead forward.
 */
export async function evaluateLead(customerId, { message, sourceEventId = null }) {
  try {
    const data = await api('POST', '/api/v1/leads/evaluate', { customerId, message, sourceEventId });
    return data.lead || null;
  } catch {
    // A lead is a bonus for the owner, never a reason to lose the message.
    return null;
  }
}

/**
 * Keep the customer's memory up to date.
 *
 * The facts come from the rules; the one-line summary is written by the
 * model. When the message says nothing new, no model call is made at all —
 * the stored summary stays as it is.
 */
export async function rememberCustomer(customerId, { text, memory = null, history = [], ruleRevision = '' }) {
  try {
    const facts = extractFacts(text);
    const known = memory?.facts || {};
    if (!factsChanged(known, facts)) return { memory, changed: false, summary: '' };
    const written = await askMemoryWriter({
      message: text,
      history,
      facts: { ...known, ...facts },
      currentSummary: memory?.summary || '',
    });
    const data = await observeMemory(customerId, {
      message: text,
      summary: written.ok ? written.summary : '',
      ruleRevision,
    });
    return { memory: data.memory, changed: true, summary: written.summary || '' };
  } catch {
    // Remembering is a convenience: it must never cost the customer a reply.
    return { memory, changed: false, summary: '' };
  }
}

/** The model could not answer: record the failure so the receipt is honest. */
export async function markInboundFailed(inbound, error) {
  if (!inbound?.id) return;
  try {
    await api('POST', `/api/v1/inbound-messages/${encodeURIComponent(inbound.id)}/fail`, {
      expectedRevision: Number(inbound.revision || 0),
      errorCode: 'AI_PROVIDER_ERROR',
    });
  } catch {
    // The message and its draft are already stored; the status is bookkeeping.
  }
}

/** Create the WAITING_FOR_HUMAN draft with the AI-drafted reply. */
export async function createDraft({ customerId, incomingMessage, draftResponse, sourceEventId, aiModel, ruleRevision, leadId = null }) {
  const data = await api('POST', '/api/v1/drafts', {
    customerId,
    channel: 'line',
    incomingMessage,
    draftResponse,
    source: 'conversation-ai',
    aiModel,
    ruleRevision,
    sourceEventId,
    leadId,
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

/** Every price the published catalogue actually sells at (prices/toppings/sideItems). */
export function publishedPrices(planner = {}) {
  const values = new Set();
  const deleted = new Set((planner.deleted || []).map(Number));
  const quoteOnly = new Set((planner.quoteOnly || []).map(Number));
  const add = (raw) => {
    const price = Number(raw);
    if (Number.isFinite(price) && price > 0) values.add(price);
  };
  for (const [id, price] of Object.entries(planner.prices || {})) {
    const menuId = Number(id);
    if (deleted.has(menuId) || quoteOnly.has(menuId)) continue;
    add(price);
  }
  for (const topping of planner.toppings || []) add(topping?.price);
  for (const side of planner.sideItems || []) add(side?.priceAdjustment);
  return values;
}

const PLACEHOLDER_MARKERS = ['เรื่องสั่งซื้อ', 'ระบบไม่ร่างให้'];
const BINDING_WORDS = ['ยอดรวม', 'ราคารวม', 'รวมทั้งสิ้น', 'รวมทั้งหมด', 'ทั้งหมด', 'เหมา', 'ค่าส่ง', 'ค่าจัดส่ง', 'ค่าขนส่ง', 'โอน', 'มัดจำ', 'จองแล้ว', 'รับออเดอร์'];
const PLUS_WORDS = ['รวม', 'ทั้งสิ้น', 'ทั้งหมด', 'เหมา'];
const PLUS_PATTERN = new RegExp(`(?:${PLUS_WORDS.join('|')})\\s*\\d|\\d\\s*(?:${PLUS_WORDS.join('|')})`);
const MULTIPLY_PATTERN = /\d\s*[xX×*]\s*\d/;

const THAI_DIGIT_MAP = { '๐': '0', '๑': '1', '๒': '2', '๓': '3', '๔': '4', '๕': '5', '๖': '6', '๗': '7', '๘': '8', '๙': '9' };

/** Thai digits ๐-๙ -> Arabic, so the gate sees "๘๙" as "89". */
export function toArabicDigits(text) {
  return String(text ?? '').replace(/[๐-๙]/g, (digit) => THAI_DIGIT_MAP[digit]);
}

// Numbers that mean a count or a code, never a price. Dropped before scanning:
// units that follow their number, dates, times, phone numbers, zip/long codes,
// years, URLs, order codes and address numbers.
const COUNT_UNITS = ['กล่อง', 'คน', 'ชุด', 'เมนู', 'วัน', 'อย่าง', 'ชิ้น', 'ชั่วโมง', 'เดือน', 'ปี', 'นาที', 'วินาที', 'ครั้ง', 'ที่', 'ท่าน', 'จาน', 'แก้ว'];
const NON_PRICE_PATTERNS = [
  /https?:\/\/\S+/gi,
  /www\.\S+/gi,
  /#\s*[A-Za-z0-9]+/g,
  /[A-Za-z]+[-\/]?\d{2,}/g,
  /\d{1,4}\s*\/\s*\d{1,4}(?:\s*\/\s*\d{1,4})?/g,
  /\d{1,2}\s*:\s*\d{2}(?:\s*[-\u2013]\s*\d{1,2}\s*:\s*\d{2})?/g,
  /0\d(?:[-\s]?\d){8}/g,
  /(?:ปี|พ\.ศ\.|ค\.ศ\.)\s*\d{2,4}/g,
  /(?:วันที่|ว\/|น\.)\s*\d+/g,
  /\d+\s*(?:ม\.ค\.|ก\.พ\.|มี\.ค\.|เม\.ย\.|พ\.ค\.|มิ\.ย\.|ก\.ค\.|ส\.ค\.|ต\.ค\.|พ\.ย\.|ธ\.ค\.|เดือน)/g,
  /(?:ซอย|ถนน|หมู่ที่|หมู่|ซ\.|ถ\.)\S*\s*\d+[\/\d]*/g,
];
const COUNT_PATTERN = new RegExp(`\\d[\\d,]*\\s*(?:${COUNT_UNITS.join('|')})`, 'g');
const NUMBER_PATTERN = /\d[\d,]*(?:\.\d+)?/g;

/**
 * Last gate before any automatic LINE send. A reply passes only when:
 *  - after dropping counts/codes/dates/times, every remaining number is a
 *    published catalogue price (never deleted, never quote-only),
 *  - it makes no promise (totals, any delivery-fee wording, transfer, deposit,
 *    multiplication), and is not one of our internal placeholder strings.
 * A number we cannot classify (e.g. a "เช็กให้หน่อย" request) stops the send.
 * Failure never gets sent; the caller keeps it as a human draft instead.
 */
export function checkOutboundMessage(text, planner = {}, rules = {}) {
  const reply = String(text ?? '').trim();
  const normalized = toArabicDigits(reply);
  const reasons = [];
  if (!reply) reasons.push('empty');
  if (PLACEHOLDER_MARKERS.some((marker) => normalized.includes(marker))) reasons.push('placeholder');
  for (const word of BINDING_WORDS) {
    if (normalized.includes(word)) reasons.push(`promise:${word}`);
  }
  if (MULTIPLY_PATTERN.test(normalized)) reasons.push('promise:ตัวคูณ');
  if (/\d/.test(normalized) && /เช็[กค]/.test(normalized)) reasons.push('undecided:ขอเช็กก่อน');

  let scan = normalized;
  for (const pattern of NON_PRICE_PATTERNS) scan = scan.replace(pattern, ' ');
  scan = scan.replace(COUNT_PATTERN, ' ');
  // A number joined to a sum word is a promise, even if it is not in the price list.
  if (PLUS_PATTERN.test(scan)) reasons.push('promise:ยอดรวมคำนวณ');

  const allowed = publishedPrices(planner);
  // The shop's own identity numbers (business-rules.json) are valid by definition:
  // house/ssoi numbers and postcode in the address, the phone, the halal certificate.
  const business = rules.business || {};
  for (const field of [business.address, business.phone, business.halalCertificate]) {
    for (const run of String(field ?? '').match(/\d+/g) || []) allowed.add(Number(run));
  }
  const amounts = new Set();
  for (const match of scan.matchAll(NUMBER_PATTERN)) amounts.add(Number(match[0].replace(/,/g, '')));
  for (const amount of amounts) {
    if (!allowed.has(amount)) reasons.push(`price:${amount}`);
  }
  return { ok: reasons.length === 0, reasons };
}

/**
 * The full pipeline for one LINE text message.
 * Shadow mode: always creates a draft, never sends.
 * Auto mode: safe lanes are replied to immediately; money/order waits.
 */
export async function handleLineMessage({ userId, text, webhookEventId, replyToken, messageType = 'text', env = process.env }) {
  const result = { userId, route: 'error', draftId: null, sent: false, error: null };

  if (!userId || !String(text ?? '').trim()) {
    result.error = 'missing userId or text';
    return result;
  }

  const { rules, planner } = await loadRulesAndPlanner();
  const triage = classifyLineMessage(text, { rules, planner });

  const customer = await resolveCustomerRecord(userId);
  const customerId = customer?.id || null;
  if (!customerId) {
    result.error = 'customer resolve failed';
    return result;
  }
  result.customerId = customerId;

  // Dedup is keyed on webhookEventId (LINE's stable per-delivery id), which
  // stays distinct from replyToken (the single-use reply credential).
  let inbound = await receiveInbound({ lineUserId: userId, incomingMessage: text, sourceEventId: webhookEventId || replyToken, messageType });
  // Connect the receipt to the customer right away, so a message that never
  // reaches a draft is still attributable to a person.
  inbound = (await advanceInbound(inbound, { customerId })) || inbound;

  // A job the customer is really asking for (a quantity, a date, a budget)
  // becomes a lead, so the owner can follow it up instead of only answering.
  const lead = await evaluateLead(customerId, { message: text, sourceEventId: webhookEventId || replyToken });
  const leadId = lead?.id || null;
  if (leadId) result.leadId = leadId;

  // A draft and its inbound receipt are created together, so the stored
  // message, the customer and the answer always form one thread.
  const createLinkedDraft = async (payload) => {
    const draft = await createDraft({ ...payload, leadId });
    await advanceInbound(inbound, { customerId, draftId: draft?.id || null, leadId });
    return draft;
  };

  // Bring the customer's LINE display name into the owner console. Fail-open:
  // a missing token, a blocked bot, or a timeout never blocks message handling.
  if (needsProfileRefresh(customer) && env.LINE_CHANNEL_ACCESS_TOKEN) {
    const profile = await fetchLineProfile(userId, { token: env.LINE_CHANNEL_ACCESS_TOKEN });
    if (profile.ok) {
      try {
        await api('POST', `/api/v1/customers/${encodeURIComponent(customerId)}/profile`, {
          displayName: profile.displayName,
          syncedAt: new Date().toISOString(),
        });
      } catch {
        // The name is cosmetic; the message and its draft still go through.
      }
    }
  }

  // The owner paused the bot for this one customer: the message is still
  // recorded and a draft is left for the owner, but the model is never called
  // and nothing is sent. The outbound gate is not consulted here (no send).
  if (customer.botPausedAt) {
    const draft = await createLinkedDraft({
      customerId,
      incomingMessage: text,
      draftResponse: 'ลูกค้ารายนี้อยู่ในรายชื่อที่หยุดตอบอัตโนมัติอยู่ครับ — รอเจ้าของตอบเอง',
      sourceEventId: webhookEventId || replyToken,
      aiModel: 'none',
      ruleRevision: await loadRuleRevision(),
    });
    result.route = 'paused';
    result.draftId = draft?.draftId || null;
    return result;
  }

  const isMedia = messageType !== 'text' || /^\[ลูกค้าส่ง/.test(String(text || '').trim());
  if (isMedia) {
    const draft = await createLinkedDraft({
      customerId,
      incomingMessage: text,
      draftResponse: 'ลูกค้าส่งรูปหรือไฟล์มาครับ — เจ้าของต้องตอบเอง (ระบบไม่ร่างให้)',
      sourceEventId: webhookEventId || replyToken,
      aiModel: 'none',
      ruleRevision: await loadRuleRevision(),
    });
    result.route = 'human';
    result.draftId = draft?.draftId || null;
    return result;
  }

  const history = await conversationHistory(customerId);
  const ruleRevision = await loadRuleRevision();
  // What the bot already knows about this customer (their own words from
  // earlier messages). It goes into the prompt so the bot never asks again
  // for a phone number or a date the customer already gave.
  const memory = await loadMemory(customerId).catch(() => null);
  // Auto-send is disabled: every reply is drafted by the model and waits for
  // the owner's approval. (AUTO_REPLY env is intentionally ignored here.)
  const auto = false;

  // Money/order/custom-price: never auto-answer, never auto-send.
  if (triage.route === 'human') {
    const draft = await createLinkedDraft({
      customerId,
      incomingMessage: text,
      draftResponse: triage.draft || 'เรื่องสั่งซื้อ/ราคาเฉพาะงาน — เจ้าของต้องตอบเอง (ระบบไม่ร่างให้)',
      sourceEventId: webhookEventId || replyToken,
      aiModel: 'none',
      ruleRevision,
    });
    result.route = 'human';
    result.draftId = draft?.draftId || null;
    await rememberCustomer(customerId, { text, memory, history, ruleRevision });
    return result;
  }

  // A deterministic answer already computed from the files wins over the model:
  // sending it costs nothing and can never drift from data/business-rules.json.
  // classifyLineMessage returns a string; accept a {text} object too so the
  // contract cannot silently break.
  const ruleAnswer = triage.route === 'auto'
    ? (typeof triage.answer === 'string' ? triage.answer : triage.answer?.text || '')
    : '';

  let reply = '';
  let aiModel = '';
  // The model writes the reply and the customer's one-line situation at the
  // same time: two calls in parallel, so the extra work costs no extra wait.
  const memoryTask = rememberCustomer(customerId, { text, memory, history, ruleRevision });
  if (ruleAnswer) {
    // Model drafts the reply (natural copy) using the deterministic answer as
    // a reference. The outbound gate still verifies every number.
    const answer = await askChatReplier({
      message: text,
      history,
      intent: triage.intent,
      rules,
      planner,
      referenceAnswer: ruleAnswer,
      memory,
    });
    if (!answer.ok) {
      // Fall back to the deterministic answer so the owner still gets a draft.
      reply = ruleAnswer;
      aiModel = 'rules';
      result.route = 'auto';
    } else {
      reply = answer.reply;
      aiModel = answer.model || 'opencode-go/glm-5.3-flash';
      result.route = 'auto';
    }
  } else {
    // No fixed answer (or an agent lane): let the model reason over the facts.
    const answer = await askChatReplier({
      message: text,
      history,
      intent: triage.intent,
      rules,
      planner,
      memory,
    });
    if (!answer.ok) {
      // The model could not answer. The message is already stored, but the
      // owner must still SEE it: leave a draft that says so, instead of a
      // customer message that silently disappears from the queue.
      result.error = answer.error;
      result.route = 'agent_failed';
      const fallback = await createLinkedDraft({
        customerId,
        incomingMessage: text,
        draftResponse: 'ระบบร่างคำตอบให้ไม่สำเร็จครับ — รอเจ้าของตอบเอง',
        sourceEventId: webhookEventId || replyToken,
        aiModel: 'none',
        ruleRevision,
      });
      result.draftId = fallback?.draftId || null;
      await markInboundFailed(inbound, answer.error);
      await memoryTask;
      return result;
    }
    reply = answer.reply;
    aiModel = answer.model || 'opencode-go/glm-5.3-flash';
    result.route = triage.route === 'auto' ? 'auto' : 'agent';
  }

  const draft = await createLinkedDraft({
    customerId,
    incomingMessage: text,
    draftResponse: reply,
    sourceEventId: webhookEventId || replyToken,
    aiModel,
    ruleRevision,
  });
  result.draftId = draft?.draftId || null;
  if (!result.draftId) {
    result.error = 'draft create failed';
    await memoryTask;
    return result;
  }
  // The memory write started in parallel with the reply: by now it is done.
  await memoryTask;

  // Code-level gate: an unsafe auto reply is demoted to the owner's queue and
  // is never sent, regardless of what the prompt or the model said.
  const gate = checkOutboundMessage(reply, planner, rules);
  if (!gate.ok) {
    result.route = 'human';
    result.gate = gate.reasons;
  }

  // Auto-send only when: switch on, a reply token exists, the reply is a real
  // (non-placeholder) answer, and the outbound gate passed.
  if (auto && replyToken && reply && !reply.startsWith('เรื่องสั่งซื้อ') && gate.ok) {
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
        messageType: message.messageType,
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
