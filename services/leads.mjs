// EED HALAL — lead service. A Lead is NEVER created per message.
// shouldCreateLead() applies deterministic criteria first; AI may extract
// structured fields, but AI alone must not decide business state.
// Status moves only through LEAD_TRANSITIONS (deterministic rule or OWNER
// action in a later phase). No Order/Job is created here.

import { randomUUID } from 'node:crypto';
import { isUniqueViolation } from '../db/index.mjs';
import { recordAudit } from './audit.mjs';
import { sanitizeMetadata } from './sanitize.mjs';
import { ValidationError } from './errors.mjs';

export const LEAD_STATUSES = Object.freeze([
  'NEW',
  'QUALIFYING',
  'QUALIFIED',
  'QUOTATION_PENDING',
  'WON',
  'LOST',
]);

const LEAD_TRANSITIONS = Object.freeze({
  NEW: ['QUALIFYING', 'LOST'],
  QUALIFYING: ['QUALIFIED', 'LOST'],
  QUALIFIED: ['QUOTATION_PENDING', 'LOST'],
  QUOTATION_PENDING: ['WON', 'LOST'],
  WON: [],
  LOST: [],
});

export function allowedLeadTransitionsFrom(status) {
  return [...(LEAD_TRANSITIONS[status] || [])];
}

/**
 * How many jobs sit in each lead status. The funnel is what the owner reads
 * to know which jobs are waiting for a decision, so it counts by status rather
 * than listing every row.
 */
export async function leadFunnel(repos) {
  const counts = {};
  for (const status of LEAD_STATUSES) {
    const rows = await repos.leads.listByStatus(status);
    counts[status] = rows.length;
  }
  return counts;
}

/** The jobs in one status, newest last. */
export async function listLeadsByStatus(repos, status, { limit = 50 } = {}) {
  if (!LEAD_STATUSES.includes(status)) throw new ValidationError(`unknown lead status: ${status}`);
  const rows = await repos.leads.listByStatus(status);
  return rows.slice(0, Math.max(Number(limit) || 50, 1));
}

const SERVICE_KEYWORDS = [
  { type: 'buffet', patterns: [/บุฟเฟต์/, /buffet/i] },
  { type: 'cocktail', patterns: [/ค็อกเทล/, /คอกเทล/, /finger/i, /cocktail/i] },
  { type: 'table', patterns: [/โต๊ะจีน/, /โต๊ะไทย/, /โต๊ะ/] },
  { type: 'setmenu', patterns: [/set ?menu/i, /sit-?down/i, /อาหารชุด/] },
  { type: 'live', patterns: [/live/i, /ซุ้ม/, /ปรุงสด/] },
  { type: 'snack', patterns: [/snack/i, /สแน็ค/, /สแนค/, /ของว่าง/, /เบรก/, /break/i] },
  { type: 'mealbox', patterns: [/ข้าวกล่อง/, /meal ?box/i, /กล่อง/] },
];

const INTENT_PATTERNS = {
  quote: [/ใบเสนอราคา/, /quotation/i, /quote/i, /ราคา/, /กี่บาท/, /คิดยังไง/, /เท่าไหร่/],
  // "ขอ 25 กล่อง" is an order, not a question: the customer states what
  // they want. A request for information ("ขอดูเมนู", "ขอราคา") is NOT an
  // order, so the number or the thing itself has to follow "ขอ".
  order: [/สั่ง/, /จอง/, /order/i, /confirm/i, /ยืนยัน/, /เอาด้วย/, /ขอ\s*(?:\d|[ก-๙]{0,3}?(?:กล่อง|ชุด|คน|อาหาร|ข้าว))/],
  catering: [/จัดเลี้ยง/, /catering/i, /อีเวนต์/, /event/i, /งานเลี้ยง/, /งานบริษัท/, /สัมมนา/],
};

// A Thai short year is Buddhist minus 543 (69 -> 2026). Two-digit years below
// 40 are treated as 20xx so a real 20xx date is not pushed 60 years out.
export function normalizeThaiYear(year) {
  const value = Number(year);
  if (!Number.isInteger(value)) return null;
  if (value >= 100) return value;
  return value >= 40 ? 1957 + value : 2000 + value;
}

// Deterministic signal extraction from a Thai/English customer message.
// Returns plain data only (safe to persist after sanitizeMetadata).
export function extractLeadSignals(text) {
  const input = String(text || '');
  const signals = { intent: [], serviceType: null, quantity: null, eventDate: null, location: null, budget: null };
  for (const [intent, patterns] of Object.entries(INTENT_PATTERNS)) {
    if (patterns.some((re) => re.test(input))) signals.intent.push(intent);
  }
  for (const service of SERVICE_KEYWORDS) {
    if (service.patterns.some((re) => re.test(input))) {
      signals.serviceType = service.type;
      break;
    }
  }
  const qty = input.replace(/,/g, '').match(/(\d+(?:\.\d+)?)\s*(กล่อง|คน|ท่าน|หัว|ที่|โต๊ะ|ชุด|ท่าน)/);
  if (qty) signals.quantity = Number(qty[1]);
  // Date first: an ISO date (2026-12-01) must not be read as day 26 of month
  // 12 of year 01. Then the Thai day/month/year form (20/12/2026), where a
  // first number above 12 can only be the day.
  const isoFull = input.match(/(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
  let eventDate = null;
  if (isoFull) {
    eventDate = { year: Number(isoFull[1]), month: Number(isoFull[2]), day: Number(isoFull[3]) };
  } else {
    const parts = input.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
    if (parts) {
      const first = Number(parts[1]);
      const second = Number(parts[2]);
      // Default is day/month. A second number above 12 can only be the day,
      // so that order is month/day.
      const day = second > 12 && first <= 12 ? second : first;
      const month = second > 12 && first <= 12 ? first : second;
      const year = Number(parts[3]) < 100 ? normalizeThaiYear(parts[3]) : Number(parts[3]);
      eventDate = { year, month, day };
    }
  }
  if (eventDate && eventDate.month >= 1 && eventDate.month <= 12 && eventDate.day >= 1 && eventDate.day <= 31) {
    signals.eventDate = `${eventDate.year}-${String(eventDate.month).padStart(2, '0')}-${String(eventDate.day).padStart(2, '0')}`;
  }
  const budget = input.replace(/,/g, '').match(/(\d+(?:\.\d+)?)\s*(บาท|฿|thb)/i);
  if (budget) signals.budget = Number(budget[1]);
  const at = input.match(/(?:ส่งที่|ส่ง|ไปที่|ที่|แถว|ย่าน)\s*([ก-๙a-zA-Z][ก-๙a-zA-Z .()-]{1,40})/);
  if (at) {
    // The place ends at the next topic: "BITEC BANGNA วันที่ 28/10" is a
    // place plus a date, not a place called "BITEC BANGNA วันที่".
    signals.location = at[1]
      .split(/\s+(?:วันที่|เวลา|งบ|ครับ|ค่ะ|และ|กับ|ให้)\s*/)[0]
      .replace(/^ที่\s*/, '')
      .trim();
  }
  return signals;
}

// A lead needs buying intent PLUS at least one concrete fact. A greeting
// ("สวัสดี") has neither and must never create a lead.
export function shouldCreateLead(signals) {
  if (!signals || typeof signals !== 'object') return false;
  const hasIntent = Array.isArray(signals.intent) && signals.intent.length > 0;
  if (!hasIntent) return false;
  return signals.quantity != null || signals.eventDate != null || signals.budget != null;
}

export function buildLeadRow(input = {}) {
  if (!input.customerId) throw new Error('lead needs customerId');
  return {
    id: input.id || randomUUID(),
    customerId: String(input.customerId),
    source: String(input.source || 'line'),
    serviceType: input.serviceType ? String(input.serviceType) : null,
    eventDate: input.eventDate ? String(input.eventDate) : null,
    quantity: input.quantity == null ? null : Number(input.quantity),
    location: input.location ? String(input.location) : null,
    budgetPerPerson: input.budgetPerPerson == null ? null : Number(input.budgetPerPerson),
    status: 'NEW',
    summary: String(input.summary || ''),
    sourceEventId: input.sourceEventId ? String(input.sourceEventId) : null,
  };
}

function cleanEventId(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().slice(0, 128);
  return trimmed || null;
}

export async function maybeCreateLead(repos, { customerId, message, actor, sourceEventId } = {}) {
  const signals = extractLeadSignals(message);
  if (!shouldCreateLead(signals)) return { lead: null, signals, deduped: false };
  const eventId = cleanEventId(sourceEventId);
  // Retry of the same LINE event reuses the persisted lead — never a duplicate.
  if (eventId) {
    const existing = await repos.transaction((tx) => tx.leads.findByCustomerAndEvent(customerId, eventId));
    if (existing) return { lead: existing, signals, deduped: true };
  }
  try {
    const created = await repos.transaction(async (tx) => {
      // Re-check inside the transaction: a concurrent retry may have won.
      if (eventId) {
        const winner = await tx.leads.findByCustomerAndEvent(customerId, eventId);
        if (winner) return { lead: winner, deduped: true };
      }
      const lead = await tx.leads.create(buildLeadRow({
        customerId,
        serviceType: signals.serviceType,
        eventDate: signals.eventDate,
        quantity: signals.quantity,
        location: signals.location,
        budgetPerPerson: signals.budget ?? null,
        summary: JSON.stringify(sanitizeMetadata({ signals }).signals || {}).slice(0, 500),
        sourceEventId: eventId,
      }));
      await recordAudit(tx, {
        entityType: 'lead', entityId: lead.id, action: 'LEAD_CREATED',
        actorType: actor?.type || 'SYSTEM', actorId: actor?.id || '',
        beforeData: null, afterData: { id: lead.id, customerId, status: lead.status },
      });
      return { lead, deduped: false };
    });
    return { lead: created.lead, signals, deduped: created.deduped };
  } catch (error) {
    // Lost a unique race on (customer_id, source_event_id): reuse the winner.
    if (eventId && isUniqueViolation(error)) {
      const winner = await repos.leads.findByCustomerAndEvent(customerId, eventId);
      if (winner) return { lead: winner, signals, deduped: true };
    }
    throw error;
  }
}

export async function setLeadStatus(repos, leadId, to, actor = { type: 'OWNER', id: '' }) {
  if (!LEAD_STATUSES.includes(to)) throw new Error(`unknown lead status: ${to}`);
  return repos.transaction(async (tx) => {
    const current = await tx.leads.findById(leadId);
    if (!current) throw new Error(`lead not found: ${leadId}`);
    if (!allowedLeadTransitionsFrom(current.status).includes(to)) {
      throw new Error(`illegal lead transition: ${current.status} -> ${to}`);
    }
    const next = await tx.leads.update(leadId, { status: to });
    await recordAudit(tx, {
      entityType: 'lead', entityId: leadId, action: 'LEAD_STATUS_CHANGED',
      actorType: actor.type || 'OWNER', actorId: actor.id || '',
      beforeData: { status: current.status }, afterData: { status: to },
    });
    return next;
  });
}
