// EED HALAL — customer memory service.
//
// WHY: the bot used to read only the last few turns of a conversation, so a
// customer who had already given their phone number, tax id, delivery date or
// dietary note was asked again on every new message. One memory per customer
// holds the current situation, so every reply starts from what is already
// known.
//
// TWO LAYERS, ON PURPOSE
// 1. The facts are extracted by RULES, never by a model: a number, a phone
//    number or a tax id must never be guessed. `extractFacts()` only returns
//    what it can read literally in the customer's own words.
// 2. The summary is written BY THE MODEL (see tools/agent/line-chat.mjs
//    askMemoryWriter), because only a model can say "สั่ง 50 กล่อง แบ่ง 3 วัน
//    ไปส่งที่สาทร" in one natural line. The model's summary never replaces a
//    fact: the facts stay the authority.
//
// The owner always wins. A summary the owner typed is stored with
// source='owner' and the bot must never overwrite it until a new job starts.

import { randomUUID } from 'node:crypto';
import { MEMORY_HISTORY_MAX, MEMORY_SUMMARY_MAX, memoryDefaults, validateMemoryRow } from '../db/customer-memory-contract.mjs';
import { recordAudit } from './audit.mjs';
import { extractLeadSignals, normalizeThaiYear } from './leads.mjs';

export { MEMORY_SUMMARY_MAX, MEMORY_HISTORY_MAX };

/** Facts the rules are allowed to extract. Anything else stays in the text. */
export const FACT_KEYS = Object.freeze([
  'quantity', 'serviceType', 'menus', 'eventDate', 'eventTime', 'location',
  'budgetPerPerson', 'phone', 'taxId', 'needsInvoice', 'dietaryNotes', 'contactName',
]);

const THAI_MONTHS = {
  'ม.ค.': 1, 'ก.พ.': 2, 'มี.ค.': 3, 'เม.ย.': 4, 'พ.ค.': 5, 'มิ.ย.': 6,
  'ก.ค.': 7, 'ส.ค.': 8, 'ก.ย.': 9, 'ต.ค.': 10, 'พ.ย.': 11, 'ธ.ค.': 12,
};

const MONTH_NAMES = Object.entries(THAI_MONTHS);

export { normalizeThaiYear };

function cleanText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function uniq(list) {
  return [...new Set(list.filter(Boolean))];
}

/**
 * Read the facts a customer's own message states. Nothing is inferred: a
 * number that is not literally there is never returned.
 */
export function extractFacts(message) {
  const text = String(message ?? '');
  const facts = {};

  // Quantity: "50 กล่อง", "18 กล่อง", "20 คน", "3 วัน"
  const quantity = text.match(/(\d[\d,]*)\s*(กล่อง|คน|ท่าน|ชุด|โต๊ะ|จาน|ชุดละ)/);
  if (quantity) facts.quantity = { value: Number(quantity[1].replace(/,/g, '')), unit: quantity[2] };

  // Budget: "70 บาท/กล่อง", "ไม่เกิน 100 บาท", "งบ 80 ต่อกล่อง"
  const budget = text.match(/(?:งบ(?:ต่อกล่อง|ต่อหัว|ต่อคน)?|ไม่เกิน|ประมาณ|กล่องละ|ต่อกล่อง|ต่อหัว)[^\d]{0,12}([\d,]{2,7})/);
  if (budget) facts.budgetPerPerson = Number(budget[1].replace(/,/g, ''));

  // Phone: a Thai mobile (06/08/09 + 8 digits) or a landline
  // (02/03x + 7-8 digits). Separators are allowed, then counted: a long
  // digit run that is not 9-10 digits is a company or tax number.
  const phoneCandidate = text.match(/(?:\+?66[- ]?)?0[23689][\d\s-]{6,14}/);
  if (phoneCandidate) {
    const digits = phoneCandidate[0].replace(/\D/g, '');
    if ((digits.length === 10 && /^(06|08|09)/.test(digits)) || (digits.length === 9 && /^0[23]/.test(digits))) {
      facts.phone = digits;
    }
  }

  // Tax id: only when the customer actually says so. A bare run of digits is
  // never a tax id (a registration number looks exactly the same).
  const taxId = text.match(/(?:tax\s*id|เลขประจำตัวผู้เสียภาษี|เลขภาษี|เลขทะเบียน)\D{0,12}(\d{10,13})/i);
  if (taxId) facts.taxId = taxId[1];

  // Invoice request.
  if (/ใบกำกับภาษี|ใบเสร็จ|tax\s*invoice|invoice/i.test(text)) facts.needsInvoice = true;

  // Date: keep the customer's own words plus a normalized ISO when the format
  // is unambiguous. Thai relative days stay as written.
  const numericDate = text.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);
  const namedDate = MONTH_NAMES.find(([name]) => text.includes(name));
  if (numericDate) {
    const [, d, m, y] = numericDate;
    const month = Number(m);
    const year = y ? normalizeThaiYear(y) : null;
    if (month >= 1 && month <= 12) {
      facts.eventDate = cleanText(numericDate[0]);
      if (year) facts.eventDateISO = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  } else if (namedDate) {
    facts.eventDate = cleanText(text.match(new RegExp(`\\d{1,2}\\s*${namedDate[0].replace('.', '\\.')}`))?.[0] || namedDate[0]);
  } else if (/พรุ่งนี้|วันนี้|วันจันทร์|วันอังคาร|วันพุธ|วันพฤหัส|วันศุกร์|วันเสาร์|วันอาทิตย์/.test(text)) {
    facts.eventDate = cleanText(text.match(/(?:วันที่\s*)?(?:พรุ่งนี้|วันนี้|วันจันทร์|วันอังคาร|วันพุธ|วันพฤหัส|วันศุกร์|วันเสาร์|วันอาทิตย์)/)?.[0] || '');
  }

  // Time: "07.00", "12:00", "15 น."
  const time = text.match(/(\d{1,2})[.:](\d{2})/) || text.match(/(\d{1,2})\s*(?:น\.?|โมง)/);
  if (time) {
    const hour = Number(time[1]);
    if (hour >= 0 && hour <= 23) facts.eventTime = `${String(hour).padStart(2, '0')}:${time[2] ? time[2] : '00'}`;
  }

  // Location: only after an explicit place word AND when the captured text
  // really looks like a place. A wrong place is worse than no place, so
  // dates, times and requests are rejected.
  const place = text.match(/(?:ส่งที่|ส่งไปที่|จัดส่งที่|ไปที่|ประสบการณ์|สถานที่|ที่อยู่|ส่ง\s+)([^\n]{2,60})/);
  if (place) {
    const raw = cleanText(place[1]).split(/\s+(?:และ|กับ|ให้|โดย|เพื่อ|ค่ะ|ครับ|นะคะ|นะ\b|เบอร์|โทร|ติดต่อ|ชื่อ|บริษัท|เลข|วันที่|เวลา|งบ)/)[0];
    const candidate = cleanText(raw).replace(/[.,;:!?]+$/, '');
    const looksLikePlace = candidate.length >= 3
      && !/^\d/.test(candidate)
      && !/\d{1,2}\/\d{1,2}/.test(candidate)
      && !/\d{4,}/.test(candidate)
      && !/วันที่|วันนี้|พรุ่งนี้|วันจันทร์|วันอังคาร|วันพุธ|วันพฤหัส|วันศุกร์|วันเสาร์|วันอาทิตย์|โมง|ค่ะ|ครับ|หน่อย|รบกวน|ขอ\b|โอเค|ได้|รอบ|สั่ง|มั้ย|ไหม|หรือ|ยังไง|อะไร/.test(candidate);
    if (looksLikePlace) facts.location = candidate;
  }

  // Menus: "22 กย: ผัดไทยกุ้งสด" and "วันที่ 3 พ.ย. ข้าวไก่เทอริยากิ".
  const menus = [];
  for (const line of String(message ?? '').split(/\r?\n/)) {
    const dated = line.match(/^\s*(?:\d{1,2}\s*[\/\-]?\s*[\d ก-๙A-Za-z.]{0,12}|วันที่\s*\d{1,2}[^\s:]*)\s*[:：]\s*(.+)$/);
    if (dated) {
      const value = cleanText(dated[1]);
      if (value && value.length <= 60) menus.push(value);
      continue;
    }
    // "วันที่ 3 พ.ย. ข้าวหมกน่องไก่ 10 กล่อง" — the menu sits between the
    // date and the next number.
    const inline = line.match(/วันที่\s*\d{1,2}(?:\s*[ก-๙A-Za-z]{1,4}\.){0,2}\s+(.+?)(?=\s+\d|\s*$)/);
    if (inline) {
      const value = cleanText(inline[1]);
      const notAMenu = /^(ค่ะ|ครับ|นะคะ|ส่ง|ที่|ติดต่อ|จัดส่ง|โอน|เช็ค|ขอ|รบกวน|รอบ|โมง|ตอน)/;
      if (value && value.length >= 2 && value.length <= 60 && !/^\d/.test(value) && !notAMenu.test(value)) menus.push(value);
    }
  }
  if (menus.length) facts.menus = uniq(menus).slice(0, 10);

  // Dietary notes: what the shop must not forget about the food.
  const dietary = [];
  if (/ทานเผ็ดไม่ได้|ไม่กินเผ็ด|ไม่ทานเผ็ด|เผ็ดน้อย|ไม่เผ็ด/.test(text)) dietary.push('ไม่ทานเผ็ด');
  if (/ทะเล|กุ้ง|หมู|เนื้อวัว|ไก่/.test(text) && /ไม่(กิน|ทาน)|เลี่ยง/.test(text)) dietary.push('มีข้อกำหนดเรื่องเนื้อสัตว์');
  if (/แพ้|อาหารเสีย/.test(text)) dietary.push('ต้องระวังอาหารเสีย/ผู้แพ้');
  if (dietary.length) facts.dietaryNotes = uniq(dietary);

  // Contact person: "คุณปิ่น", "คุณสมชาย" — a politeness word is not a name.
  const POLITE = /^(ค่ะ|ครับ|นะคะ|นะ|ขอ|ขอบคุณ|ผม|ฉัน|อี|เธอ|ท่าน|พี่|คุณ|คะ|จ้า|เลย|หน่อย|ด้วย|ต่อ|เปิด|ของ|ตอน|เช้า|เย็น|เที่ยง|คืน|โทร|ที่|รับ|ส่ง|มา|ไป|กับ|และ|ให้|โอเค|โอเคค่ะ|ดี|รับทราบ|มาก|นิด|นิดนึง|จริง|ด้วยครับ)$/;
  const contact = text.match(/คุณ([ก-๙A-Za-z]{1,20})/);
  if (contact) {
    const name = cleanText(contact[1]).replace(/(ค่ะ|ครับ|นะคะ|นะ|จ้า|เลย|หน่อย|ด้วย|ต่อ|มาก|นิด|นิดนึง)$/u, '').trim();
    if (name && !POLITE.test(name)) facts.contactName = `คุณ${name}`;
  }

  // Service type from the shared lead rules (same vocabulary, one source).
  const signals = extractLeadSignals(text);
  if (signals.serviceType) facts.serviceType = signals.serviceType;

  return facts;
}

/** The questions the shop still has to ask this customer. */
export function missingQuestions(facts = {}) {
  const questions = [];
  if (!facts.quantity) questions.push('จำนวนกล่อง/คน');
  if (!facts.menus?.length && facts.serviceType !== 'table') questions.push('เมนูที่ต้องการ');
  if (!facts.eventDate) questions.push('วันที่ต้องการ');
  if (!facts.location) questions.push('ที่อยู่จัดส่ง');
  return questions;
}

/**
 * Merge new facts into the stored ones.
 * - A new value replaces an old one (the customer corrected themselves).
 * - A value the owner confirmed (locked) is never replaced.
 * - Lists (menus, dietary notes) are unioned, never dropped.
 */
export function mergeFacts(current = {}, incoming = {}, { locked = [] } = {}) {
  const merged = { ...current };
  const lockedSet = new Set(locked);
  for (const [key, value] of Object.entries(incoming)) {
    if (value === undefined || value === null || value === '') continue;
    if (lockedSet.has(key)) continue;
    if (Array.isArray(value)) {
      merged[key] = uniq([...(current[key] || []), ...value]);
      continue;
    }
    if (typeof value === 'object') {
      merged[key] = { ...(current[key] || {}), ...value };
      continue;
    }
    merged[key] = value;
  }
  return merged;
}

/** True when the new message actually says something we did not know. */
export function factsChanged(current = {}, incoming = {}) {
  for (const [key, value] of Object.entries(incoming)) {
    if (value === undefined || value === null || value === '') continue;
    const before = current[key];
    if (Array.isArray(value)) {
      const known = new Set(before || []);
      if (value.some((item) => !known.has(item))) return true;
      continue;
    }
    if (typeof value === 'object') {
      if (JSON.stringify(before || {}) !== JSON.stringify(value)) return true;
      continue;
    }
    if (before !== value) return true;
  }
  return false;
}

/** Deterministic summary — the fallback whenever the model cannot write one. */
export function buildSummary(facts = {}) {
  const parts = [];
  if (facts.quantity?.value) parts.push(`ต้องการ ${facts.quantity.value} ${facts.quantity.unit || 'กล่อง'}`);
  if (facts.menus?.length) parts.push(`เมนู: ${facts.menus.join(' / ')}`);
  if (facts.eventDate) parts.push(`วันที่ ${facts.eventDate}${facts.eventTime ? ` เวลา ${facts.eventTime}` : ''}`);
  if (facts.location) parts.push(`ส่งที่ ${facts.location}`);
  if (facts.budgetPerPerson) parts.push(`งบ ${facts.budgetPerPerson} บาท/กล่อง`);
  if (facts.phone) parts.push(`เบอร์ ${facts.phone}`);
  if (facts.taxId) parts.push(`เลขภาษี ${facts.taxId}`);
  if (facts.needsInvoice) parts.push('ต้องการใบกำกับภาษี');
  if (facts.dietaryNotes?.length) parts.push(facts.dietaryNotes.join(' '));
  if (facts.contactName) parts.push(`ผู้ติดต่อ ${facts.contactName}`);
  const summary = parts.join(' · ');
  return summary.slice(0, MEMORY_SUMMARY_MAX);
}

/** The block the chat agent sees about this customer. */
export function memoryPromptBlock(memory) {
  if (!memory) return '';
  const facts = memory.facts || {};
  const lines = [];
  if (memory.summary) lines.push(`สถานะของลูกค้าคนนี้: ${memory.summary}`);
  const questions = missingQuestions(facts);
  if (questions.length) lines.push(`ยังต้องถามลูกค้าเรื่อง: ${questions.join(', ')}`);
  if (memory.status === 'CLOSED') lines.push('งานก่อนหน้าของลูกค้าคนนี้ปิดแล้ว (ถ้าลูกค้าทักมาเรื่องใหม่ ให้เริ่มใหม่)');
  return lines.join('\n');
}

/**
 * The whole conversation of one customer, oldest first, ready for the owner
 * console and for the bot's context.
 *
 * It reads the RECEIPT ledger (inbound_messages) rather than the drafts, so
 * a message that never became a draft — a picture, a paused customer, a
 * message the model could not answer — is still part of the thread.
 */
export async function customerThread(repos, customerId) {
  if (!customerId) return { messages: [], drafts: [] };
  const drafts = await repos.drafts.listByCustomer(customerId);
  const inbound = repos.inboundMessages?.listByCustomer
    ? await repos.inboundMessages.listByCustomer(customerId)
    : [];
  const draftByEvent = new Map();
  for (const draft of drafts) {
    if (draft.sourceEventId) draftByEvent.set(draft.sourceEventId, draft);
  }
  const messages = [];
  for (const row of inbound) {
    const draft = row.draftId ? drafts.find((d) => d.id === row.draftId) : draftByEvent.get(row.sourceEventId);
    messages.push({
      id: row.id,
      at: row.createdAt,
      role: 'customer',
      text: row.incomingMessage,
      messageType: row.messageType,
      draftId: draft?.id || null,
      status: draft?.status || null,
    });
    if (draft) {
      const reply = draft.ownerFinalResponse || draft.draftResponse;
      if (reply) {
        messages.push({
          id: `${draft.id}-reply`,
          at: draft.approvedAt || draft.sentAt || draft.updatedAt || draft.createdAt,
          role: 'shop',
          text: reply,
          draftId: draft.id,
          status: draft.status,
        });
      }
    }
  }
  messages.sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')));
  return { messages, drafts };
}

/** Keys the owner confirmed; the bot may never replace them. */
export function lockedFactKeys(customer = {}) {
  const locked = [];
  if (customer.phone) locked.push('phone');
  if (customer.taxId) locked.push('taxId');
  if (customer.companyName) locked.push('contactName');
  if (customer.address) locked.push('location');
  return locked;
}

/** The bot's own view of the conversation: the turns it may reason over. */
export function turnsFromThread(thread = {}) {
  const turns = [];
  for (const message of thread.messages || []) {
    if (message.role === 'customer') turns.push({ role: 'customer', text: message.text });
    else turns.push({ role: 'shop', text: message.text });
  }
  return turns;
}


async function findMemory(repos, customerId) {
  if (!customerId) return null;
  if (repos.customerMemories?.findByCustomerId) return repos.customerMemories.findByCustomerId(customerId);
  return null;
}

/**
 * Store what this message tells us about the customer.
 * @returns {{memory: object|null, changed: boolean, facts: object}}
 */
export async function upsertMemory(repos, { customerId, message, customer = null, source = 'rule', summary = '', actor = { type: 'SYSTEM', id: '' }, ruleRevision = '' } = {}) {
  if (!customerId) return { memory: null, changed: false, facts: {} };
  const incoming = extractFacts(message);
  const current = (await findMemory(repos, customerId)) || null;
  const locked = lockedFactKeys(customer || {});
  const facts = mergeFacts(current?.facts || {}, incoming, { locked });
  const changed = factsChanged(current?.facts || {}, incoming);
  const questions = missingQuestions(facts);

  // The owner wrote this summary: never replace it with a generated one.
  const ownerOwned = current?.source === 'owner' && current?.status === 'OPEN';
  const written = String(summary || '').trim().slice(0, MEMORY_SUMMARY_MAX);
  const generated = written || buildSummary(facts);

  const row = {
    id: current?.id || randomUUID(),
    customerId,
    summary: ownerOwned ? current.summary : generated,
    facts: { ...facts, openQuestions: questions },
    history: current?.history || [],
    status: current?.status === 'CLOSED' ? 'OPEN' : (current?.status || 'OPEN'),
    source: ownerOwned ? 'owner' : (written ? 'ai' : source),
    ruleRevision: ruleRevision || current?.ruleRevision || '',
  };
  const errors = validateMemoryRow(memoryDefaults(row));
  if (errors.length) throw new Error(`invalid customer memory: ${errors.join('; ')}`);

  const saved = await repos.transaction(async (tx) => {
    const memory = current
      ? await tx.customerMemories.update(row.id, row)
      : await tx.customerMemories.create(row);
    await recordAudit(tx, {
      entityType: 'customer_memory', entityId: memory.id, action: 'CUSTOMER_MEMORY_UPDATED',
      actorType: actor.type || 'SYSTEM', actorId: actor.id || '',
      beforeData: current ? { summary: current.summary, status: current.status } : null,
      afterData: { summary: memory.summary, status: memory.status, source: memory.source },
    });
    return memory;
  });
  return { memory: saved, changed, facts: saved.facts };
}

/** The owner typed the summary: it becomes the authority until a new job. */
export async function saveOwnerMemory(repos, { customerId, summary, facts, actor = { type: 'OWNER', id: '' } } = {}) {
  const current = await findMemory(repos, customerId);
  if (!current) throw new Error('customer memory not found');
  const next = {
    id: current.id,
    summary: String(summary ?? current.summary).slice(0, MEMORY_SUMMARY_MAX),
    facts: facts ? { ...current.facts, ...facts, openQuestions: missingQuestions({ ...current.facts, ...facts }) } : current.facts,
    status: 'OPEN',
    source: 'owner',
  };
  const errors = validateMemoryRow(memoryDefaults(next));
  if (errors.length) throw new Error(`invalid customer memory: ${errors.join('; ')}`);
  const saved = await repos.transaction(async (tx) => {
    const memory = await tx.customerMemories.update(current.id, next);
    await recordAudit(tx, {
      entityType: 'customer_memory', entityId: memory.id, action: 'CUSTOMER_MEMORY_OWNER_EDITED',
      actorType: 'OWNER', actorId: actor.id || '',
      beforeData: { summary: current.summary, source: current.source },
      afterData: { summary: memory.summary, source: memory.source },
    });
    return memory;
  });
  return saved;
}

/**
 * Close the running job: the current situation moves into the history and the
 * next message starts a fresh one.
 */
export async function closeJob(repos, { customerId, actor = { type: 'OWNER', id: '' }, note = '' } = {}) {
  const current = await findMemory(repos, customerId);
  if (!current) throw new Error('customer memory not found');
  const history = [...(current.history || []), {
    summary: current.summary,
    facts: current.facts,
    closedAt: new Date().toISOString(),
    note: String(note || '').slice(0, 200),
  }].slice(-MEMORY_HISTORY_MAX);
  const saved = await repos.transaction(async (tx) => {
    const memory = await tx.customerMemories.update(current.id, {
      summary: '',
      facts: {},
      history,
      status: 'CLOSED',
    });
    await recordAudit(tx, {
      entityType: 'customer_memory', entityId: memory.id, action: 'CUSTOMER_MEMORY_CLOSED',
      actorType: 'OWNER', actorId: actor.id || '',
      beforeData: { summary: current.summary, status: current.status },
      afterData: { status: memory.status, historyItems: history.length },
    });
    return memory;
  });
  return saved;
}
