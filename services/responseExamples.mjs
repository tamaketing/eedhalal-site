// EED HALAL — owner-approved reusable response examples (Phase 4B-4A).
// Retrieval/business-memory foundation only: NO automatic learning, NO model
// training, NO prompt injection in this phase. An example exists ONLY after an
// explicit owner opt-in on a SENT draft. Business facts always stay sourced
// from business-rules.json; examples teach communication patterns only.

import { createHash, randomUUID } from 'node:crypto';
import { isUniqueViolation } from '../db/index.mjs';
import { extractLeadSignals } from './leads.mjs';
import { recordAudit } from './audit.mjs';
import { ConflictError, NotFoundError, ValidationError } from './errors.mjs';

export const EXAMPLE_INTENTS = Object.freeze([
  'greeting', 'quotation', 'menu_request', 'delivery', 'payment',
  'minimum_order', 'availability', 'follow_up', 'complaint', 'general',
]);

export const EXAMPLE_SERVICE_TYPES = Object.freeze([
  'buffet', 'cocktail', 'table', 'setmenu', 'live', 'snack', 'mealbox',
]);

export const EXAMPLE_MAX_RETRIEVAL = 3;

const INTENT_RULES = [
  ['menu_request', [/เมนู/, /menu/i, /รายการอาหาร/]],
  ['delivery', [/delivery/i, /จัดส่ง/, /ค่าส่ง/, /zone/i, /เขต/, /ส่งฟรี/]],
  ['payment', [/payment/i, /มัดจำ/, /deposit/i, /โอน/, /ชำระ/, /receipt/i, /ใบเสร็จ/, /vat/i, /บิล/]],
  ['minimum_order', [/minimum/i, /ขั้นต่ำ/, /กล่องละ/, /ต่อหัว/, /หัวละ/]],
  ['availability', [/available/i, /confirm/i, /ยืนยัน/, /ยกเลิก/, /cancel/i, /ว่าง/]],
  ['follow_up', [/follow/i, /ขอบคุณ/, /ติดต่อกลับ/, /นัด/]],
  ['complaint', [/complaint/i, /complain/i, /ไม่พอใจ/, /แย่/, /ผิด/, /ช้าเกิน/]],
  ['greeting', [/^(สวัสดี|หวัดดี|hello|hi|hey)\W*$/i]],
];

export function classifyIntent(text, signals = null) {
  const input = String(text || '');
  const intents = (signals || extractLeadSignals(input)).intent || [];
  if (intents.includes('quote') || intents.includes('order')) return 'quotation';
  for (const [intent, patterns] of INTENT_RULES) {
    if (patterns.some((re) => re.test(input))) return intent;
  }
  return 'general';
}

export function classifyExample(message) {
  const signals = extractLeadSignals(message);
  return { intent: classifyIntent(message), serviceType: signals.serviceType || null };
}

// PII/secret patterns redacted (never stored raw). Anything matching
// EXCEPTION_RE is a one-off/exception case: reject instead of guessing.
const LINE_ID_RE = /\bU[0-9a-f]{32}\b/gi;
const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const PHONE_RE = /\b0[689]\d[-\s]?\d{3,4}[-\s]?\d{3,4}\b/g;
const DATE_RE = /\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/g;
const THAI_DATE_RE = /(มกราคม|กุมภาพันธ์|มีนาคม|เมษายน|พฤษภาคม|มิถุนายน|กรกฎาคม|สิงหาคม|กันยายน|ตุลาคม|พฤศจิกายน|ธันวาคม)\s*\d{2,4}/g;
const TIME_RE = /\b\d{1,2}:\d{2}(\s*น\.)?/g;
const LONG_HEX_RE = /\b[0-9a-f]{20,}\b/gi;
const URL_QUERY_RE = /(\bhttps?:\/\/[^\s?]+)\?[^\s]*/g;
const EVENT_ID_RE = /\b\d{15,}\b/g;
const EXCEPTION_RE = /ส่วนลดพิเศษ|ราคาพิเศษ|ข้อยกเว้น|เฉพาะคุณ|เฉพาะลูกค้า|one-off|special deal|exception|under the table/i;

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function sanitizeExampleText(text, names = []) {
  if (typeof text !== 'string' || !text.trim()) {
    throw new ValidationError('example_requires_review: empty text');
  }
  if (EXCEPTION_RE.test(text)) {
    throw new ValidationError('example_requires_review: exception pricing or one-off terms');
  }
  const redacted = [];
  let out = text;
  const apply = (re, label, replacement) => {
    const next = out.replace(re, replacement);
    if (next !== out) redacted.push(label);
    out = next;
  };
  apply(LINE_ID_RE, 'line_user_id', '[LINE_USER]');
  apply(EMAIL_RE, 'email', '[EMAIL]');
  apply(PHONE_RE, 'phone', '[PHONE]');
  apply(DATE_RE, 'date', '[DATE]');
  apply(THAI_DATE_RE, 'date', '[DATE]');
  apply(TIME_RE, 'time', '[TIME]');
  apply(LONG_HEX_RE, 'identifier', '[ID]');
  apply(URL_QUERY_RE, 'url_params', '$1');
  apply(EVENT_ID_RE, 'event_id', '[EVENT_ID]');
  for (const name of names) {
    const clean = String(name || '').trim();
    if (clean.length < 2) continue;
    const next = out.replace(new RegExp(escapeRegExp(clean), 'gi'), '[CUSTOMER]');
    if (next !== out) redacted.push('customer_name');
    out = next;
  }
  if (!out.trim()) throw new ValidationError('example_requires_review: nothing reusable after sanitization');
  return { text: out, redacted };
}

function normalizeFragment(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

export function fingerprintExample({ intent, serviceType, incomingExample, approvedResponse }) {
  return createHash('sha256')
    .update([intent || '', serviceType || '', normalizeFragment(incomingExample), normalizeFragment(approvedResponse)].join('\n'))
    .digest('hex');
}

function cleanId(value, field) {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new ValidationError(`invalid ${field}`);
  }
  return value;
}

function cleanStyleTags(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 10 || value.some((t) => typeof t !== 'string' || !t.trim() || t.length > 40)) {
    throw new ValidationError('invalid styleTags');
  }
  return value.map((t) => t.trim());
}

function toExample(row) {
  if (!row) return null;
  return {
    id: row.id,
    sourceDraftId: row.sourceDraftId,
    intent: row.intent,
    serviceType: row.serviceType,
    incomingExample: row.incomingExample,
    approvedResponse: row.approvedResponse,
    styleTags: row.styleTags || [],
    reusable: row.reusable,
    businessRulesRevision: row.businessRulesRevision,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function presentResponseExample(row) {
  const full = toExample(row);
  if (!full) return null;
  const { sourceDraftId, fingerprint, ...safe } = full;
  return safe;
}

async function auditExample(tx, id, action, actorId, before, after) {
  await recordAudit(tx, {
    entityType: 'response_example', entityId: id, action,
    actorType: 'OWNER', actorId: actorId || '',
    beforeData: before || null, afterData: after || null,
  });
}

export async function createResponseExampleFromDraft(repos, draftId, { ownerId = '', styleTags } = {}) {
  const draft = await repos.drafts.findById(cleanId(draftId, 'draftId'));
  if (!draft) throw new NotFoundError('draft not found');
  if (draft.status !== 'SENT' || !['EDITED', 'APPROVED'].includes(draft.finalAction) || !draft.sentAt) {
    throw new ConflictError('only sent owner-approved responses can become examples');
  }
  const approvedResponse = draft.finalAction === 'EDITED'
    ? draft.ownerFinalResponse
    : (draft.ownerFinalResponse || draft.draftResponse);
  if (!approvedResponse || !approvedResponse.trim()) {
    throw new ValidationError('example_requires_review: no approved response text');
  }
  const customer = draft.customerId ? await repos.customers.findById(draft.customerId) : null;
  const names = customer ? [customer.displayName, customer.companyName] : [];
  const { intent, serviceType } = classifyExample(draft.incomingMessage);
  const incoming = sanitizeExampleText(draft.incomingMessage, names);
  const approved = sanitizeExampleText(approvedResponse, names);
  const fingerprint = fingerprintExample({ intent, serviceType,
    incomingExample: incoming.text, approvedResponse: approved.text });
  const tags = cleanStyleTags(styleTags);
  const revision = draft.ruleRevision || 'unknown';
  const existing = () => repos.responseExamples.findBySourceDraftId(draft.id);
  const found = await existing();
  if (found) return { example: toExample(found), deduped: true };
  try {
    const saved = await repos.transaction(async (tx) => {
      const created = await tx.responseExamples.create({
        id: randomUUID(), sourceDraftId: draft.id, intent, serviceType,
        incomingExample: incoming.text, approvedResponse: approved.text,
        styleTags: tags, reusable: true, businessRulesRevision: revision, fingerprint,
      });
      await auditExample(tx, created.id, 'RESPONSE_EXAMPLE_CREATED', ownerId,
        null, { intent, serviceType, sourceDraftId: draft.id });
      return created;
    });
    return { example: toExample(saved), deduped: false };
  } catch (error) {
    if (isUniqueViolation(error)) {
      const winner = await existing().catch(() => null)
        || await repos.responseExamples.findByFingerprint(fingerprint);
      if (winner) return { example: toExample(winner), deduped: true };
    }
    throw error;
  }
}

export async function getResponseExample(repos, id) {
  const row = await repos.responseExamples.findById(cleanId(id, 'id'));
  if (!row) throw new NotFoundError('response example not found');
  return toExample(row);
}

export async function listResponseExamples(repos, { reusable, intent, serviceType, limit } = {}) {
  if (reusable !== undefined && typeof reusable !== 'boolean') throw new ValidationError('invalid reusable');
  if (intent !== undefined && !EXAMPLE_INTENTS.includes(intent)) throw new ValidationError('invalid intent');
  if (serviceType !== undefined && serviceType !== null && !EXAMPLE_SERVICE_TYPES.includes(serviceType)) {
    throw new ValidationError('invalid serviceType');
  }
  const rows = await repos.responseExamples.list({ reusable, intent, serviceType, limit });
  return rows.map(toExample);
}

export async function setResponseExampleReusable(repos, id, { reusable, styleTags, intent, serviceType, ownerId = '' } = {}) {
  const current = await repos.responseExamples.findById(cleanId(id, 'id'));
  if (!current) throw new NotFoundError('response example not found');
  const patch = {};
  let event = null;
  if (reusable !== undefined) {
    if (typeof reusable !== 'boolean') throw new ValidationError('invalid reusable');
    if (reusable !== current.reusable) {
      patch.reusable = reusable;
      event = reusable ? 'RESPONSE_EXAMPLE_ENABLED' : 'RESPONSE_EXAMPLE_DISABLED';
    }
  }
  if (styleTags !== undefined) patch.styleTags = cleanStyleTags(styleTags);
  if (intent !== undefined) {
    if (!EXAMPLE_INTENTS.includes(intent)) throw new ValidationError('invalid intent');
    patch.intent = intent;
  }
  if (serviceType !== undefined) {
    if (serviceType !== null && !EXAMPLE_SERVICE_TYPES.includes(serviceType)) throw new ValidationError('invalid serviceType');
    patch.serviceType = serviceType;
  }
  if (!Object.keys(patch).length) throw new ValidationError('nothing to update');
  const saved = await repos.transaction(async (tx) => {
    const next = await tx.responseExamples.update(current.id, patch);
    if (!next) throw new NotFoundError('response example not found');
    if (event) await auditExample(tx, current.id, event, ownerId, { reusable: current.reusable }, { reusable: next.reusable });
    if (patch.styleTags !== undefined || patch.intent !== undefined || patch.serviceType !== undefined) {
      await auditExample(tx, current.id, 'RESPONSE_EXAMPLE_UPDATED', ownerId,
        { styleTags: current.styleTags, intent: current.intent, serviceType: current.serviceType },
        { styleTags: next.styleTags, intent: next.intent, serviceType: next.serviceType });
    }
    return next;
  });
  return toExample(saved);
}

function tokenize(text) {
  return String(text || '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((t) => t.length >= 2);
}

export async function retrieveRelevantExamples(repos, { message, intent, serviceType, limit, currentRevision } = {}) {
  if (typeof message !== 'string' || !message.trim()) throw new ValidationError('message is required');
  const wanted = {
    intent: intent !== undefined ? intent : classifyExample(message).intent,
    serviceType: serviceType !== undefined ? serviceType : classifyExample(message).serviceType,
  };
  if (!EXAMPLE_INTENTS.includes(wanted.intent)) throw new ValidationError('invalid intent');
  if (wanted.serviceType !== null && !EXAMPLE_SERVICE_TYPES.includes(wanted.serviceType)) {
    throw new ValidationError('invalid serviceType');
  }
  const capped = Math.min(Math.max(Number(limit) || EXAMPLE_MAX_RETRIEVAL, 1), EXAMPLE_MAX_RETRIEVAL);
  const rows = await repos.responseExamples.list({ reusable: true, limit: 50 });
  const words = new Set(tokenize(message));
  const scored = rows.map((row) => {
    let score = 0;
    if (row.intent === wanted.intent) score += 2;
    if (wanted.serviceType && row.serviceType === wanted.serviceType) score += 1;
    if (score > 0 && words.size) {
      const hay = new Set([...tokenize(row.incomingExample), ...tokenize(row.approvedResponse)]);
      let overlap = 0;
      for (const word of words) if (hay.has(word)) overlap += 1;
      score += Math.min(1, overlap * 0.2);
    }
    return { row, score };
  }).filter((entry) => entry.score > 0);
  scored.sort((a, b) => b.score - a.score || (a.row.createdAt < b.row.createdAt ? 1 : -1));
  return scored.slice(0, capped).map(({ row }) => ({
    intent: row.intent,
    serviceType: row.serviceType,
    incomingExample: row.incomingExample,
    approvedResponse: row.approvedResponse,
    styleTags: row.styleTags || [],
    businessRulesRevision: row.businessRulesRevision,
    staleRules: currentRevision != null ? row.businessRulesRevision !== currentRevision : null,
  }));
}
