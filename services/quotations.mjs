// EED HALAL — quotation view over the data that already exists.
//
// A quotation is NOT a new table. It is the pair the shop already keeps:
//   - a lead   → the structured job (people, date, location, budget) that the
//                 deterministic rules extracted from the customer's message
//   - a draft  → the price text the owner reviews and sends
// This service only presents that pair and checks what is still missing. It
// never computes a price (that is the menu catalogue's job), never moves a
// lead, and never sends anything.
//
// The rules come from data/business-rules.json — the single source of truth.
// The file is re-read when it changes on disk, so a rule edit is visible
// without restarting the API.

import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_RULES_PATH = path.resolve(HERE, '..', 'data', 'business-rules.json');

// The draft source that marks a quotation draft. Kept here so the API, the
// agent tool and the skill all agree on one marker.
export const QUOTATION_DRAFT_SOURCE = 'agent:A04';
export const QUOTATION_METADATA_KEY = 'quotation';

let cachedRules = null;
let cachedMtime = 0;

export async function loadBusinessRules(filePath = DEFAULT_RULES_PATH) {
  try {
    const info = await stat(filePath);
    const mtime = Math.floor(info.mtimeMs);
    if (cachedRules && cachedMtime === mtime) return cachedRules;
    const raw = await readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    cachedRules = parsed && typeof parsed === 'object' ? parsed : null;
    cachedMtime = mtime;
    return cachedRules;
  } catch {
    return null;
  }
}

/** True when a draft row belongs to the quotation flow. */
export function isQuotationDraft(draft) {
  if (!draft) return false;
  if (draft.source === QUOTATION_DRAFT_SOURCE) return true;
  const meta = draft.metadata || {};
  return Boolean(meta[QUOTATION_METADATA_KEY]);
}

/**
 * What is still missing before a quote can be sent, straight from the rules.
 * Returns { blocking: [...], advisory: [...] } so the caller can tell the
 * owner what stops the quote from what merely needs a decision.
 */
export function quotationGaps(lead, rules = null) {
  const blocking = [];
  const advisory = [];
  const mealBox = rules?.services?.mealBox || {};
  const minimumOrder = Number(mealBox.minimumOrder);

  // No lead means the rules found no job in the message (no quantity, date or
  // budget). The agent may have extracted fields on its own, but those are not
  // confirmed, so the quotation still counts as incomplete.
  if (!lead) {
    blocking.push({ field: 'quantity', label: 'จำนวนคนหรือจำนวนกล่อง', why: 'ยังไม่ได้บันทึกเป็น lead ตามกฎของระบบ' });
    blocking.push({ field: 'eventDate', label: 'วันที่ต้องการ', why: 'ยังไม่ได้บันทึกเป็น lead ตามกฎของระบบ' });
    blocking.push({ field: 'location', label: 'สถานที่จัดส่ง', why: 'ยังไม่ได้บันทึกเป็น lead ตามกฎของระบบ' });
    advisory.push({ field: 'confirmation', label: 'การยืนยันของเจ้าของ', why: 'ต้องให้เจ้าของยืนยันจำนวน วันที่ และสถานที่ก่อนส่ง' });
    return { blocking, advisory };
  }

  const quantity = lead.quantity == null ? null : Number(lead.quantity);
  const eventDate = lead.eventDate ? String(lead.eventDate) : null;
  const location = lead.location ? String(lead.location) : null;
  const budget = lead.budgetPerPerson == null ? null : Number(lead.budgetPerPerson);

  if (quantity == null || !Number.isFinite(quantity)) {
    blocking.push({ field: 'quantity', label: 'จำนวนคนหรือจำนวนกล่อง', why: 'ลูกค้ายังไม่ได้บอก' });
  } else if (Number.isFinite(minimumOrder) && quantity < minimumOrder) {
    blocking.push({ field: 'quantity', label: 'จำนวนกล่อง', why: `ต่ำกว่าขั้นต่ำ ${minimumOrder} กล่อง` });
  }

  if (!eventDate) {
    blocking.push({ field: 'eventDate', label: 'วันที่ต้องการ', why: 'ยังไม่มีวันที่' });
  } else if (leadDateTooLate(eventDate, quantity, rules)) {
    blocking.push({ field: 'eventDate', label: 'วันที่ต้องการ', why: 'เวลาไม่ทันขั้นต่ำการผลิต' });
  }

  if (!location) {
    blocking.push({ field: 'location', label: 'สถานที่จัดส่ง', why: 'ยังไม่ระบุสถานที่' });
  }

  if (budget == null) {
    advisory.push({ field: 'budgetPerPerson', label: 'งบต่อกล่อง', why: 'ลูกค้ายังไม่ได้บอกงบ ต้องเลือกเมนูให้เจ้าของตัดสินใจ' });
  }

  if (rules?.delivery?.policy === 'adminQuote') {
    advisory.push({ field: 'delivery', label: 'ค่าจัดส่ง', why: 'นโยบายคิดตามระยะทางและจำนวน ให้เจ้าของใส่ตัวเลข' });
  }
  if (rules?.documents?.vatRegistered === false) {
    advisory.push({ field: 'vat', label: 'ภาษีมูลค่าเพิ่ม', why: 'ร้านยังไม่ได้จดทะเบียน VAT ห้ามเขียนว่ารวม VAT' });
  }

  return { blocking, advisory };
}

function leadDateTooLate(eventDate, quantity, rules) {
  const leadTimes = Array.isArray(rules?.leadTimes) ? rules.leadTimes : [];
  if (!leadTimes.length) return false;
  const qty = Number.isFinite(quantity) ? quantity : null;
  const rule = leadTimes.find((item) => {
    const min = Number(item.minQuantity);
    const max = item.maxQuantity == null ? Infinity : Number(item.maxQuantity);
    if (qty == null) return true;
    return qty >= min && qty <= max;
  }) || leadTimes[leadTimes.length - 1];
  const days = Number(rule?.minimumBusinessDays);
  if (!Number.isFinite(days)) return false;
  const target = new Date(`${eventDate}T00:00:00`);
  if (Number.isNaN(target.getTime())) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const available = Math.floor((target.getTime() - today.getTime()) / 86400000);
  return available < days;
}

/**
 * One quotation, ready to show: the structured job, the price text waiting for
 * the owner, and what is still missing.
 */
export function quotationView({ draft = null, lead = null, customer = null, rules = null } = {}) {
  const gaps = quotationGaps(lead, rules);
  const meta = draft?.metadata || {};
  const structured = meta[QUOTATION_METADATA_KEY] || {};
  return {
    quotationId: draft?.draftId || draft?.id || null,
    draftId: draft?.id || null,
    leadId: lead?.id || null,
    customerId: customer?.id || draft?.customerId || null,
    customerName: customer?.displayName || '',
    companyName: customer?.companyName || '',
    status: draft?.status || null,
    leadStatus: lead?.status || null,
    serviceType: lead?.serviceType || structured.serviceType || null,
    quantity: lead?.quantity ?? structured.quantity ?? null,
    eventDate: lead?.eventDate || structured.eventDate || null,
    location: lead?.location || structured.location || null,
    budgetPerPerson: lead?.budgetPerPerson ?? structured.budgetPerPerson ?? null,
    quoteText: draft?.draftResponse || '',
    incomingMessage: draft?.incomingMessage || '',
    blocking: gaps.blocking,
    advisory: gaps.advisory,
    readyForOwner: gaps.blocking.length === 0,
    createdAt: draft?.createdAt || null,
  };
}
