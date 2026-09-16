// EED HALAL — lead service. A Lead is NEVER created per message.
// shouldCreateLead() applies deterministic criteria first; AI may extract
// structured fields, but AI alone must not decide business state.
// Status moves only through LEAD_TRANSITIONS (deterministic rule or OWNER
// action in a later phase). No Order/Job is created here.

import { randomUUID } from 'node:crypto';
import { isUniqueViolation } from '../db/index.mjs';
import { recordAudit } from './audit.mjs';
import { sanitizeMetadata } from './sanitize.mjs';

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
  order: [/สั่ง/, /จอง/, /order/i, /confirm/i, /ยืนยัน/, /เอาด้วย/],
  catering: [/จัดเลี้ยง/, /catering/i, /อีเวนต์/, /event/i, /งานเลี้ยง/, /งานบริษัท/, /สัมมนา/],
};

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
  const iso = input.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (iso) {
    const year = Number(iso[3]) < 100 ? 2000 + Number(iso[3]) : Number(iso[3]);
    signals.eventDate = `${year}-${String(iso[2]).padStart(2, '0')}-${String(iso[1]).padStart(2, '0')}`;
  }
  const budget = input.replace(/,/g, '').match(/(\d+(?:\.\d+)?)\s*(บาท|฿|thb)/i);
  if (budget) signals.budget = Number(budget[1]);
  const at = input.match(/(?:ส่ง|ที่|แถว|ย่าน)\s*([ก-๙a-zA-Z][ก-๙a-zA-Z .()-]{1,40})/);
  if (at) signals.location = at[1].trim();
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
