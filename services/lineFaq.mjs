// Deterministic LINE message triage — no model, no network, no guessing.
//
// One message in, one routing decision out:
//   auto  — the answer is a fixed fact in the files, safe to send as-is
//   agent — needs reasoning over the catalogue, hand to our agent team later
//   human — money, promises or custom quotes are involved, the owner decides
//   ignore — no text to answer (stickers, images)
//
// Every auto answer quotes only data/business-rules.json and the published
// catalogue, and names the exact field it came from. Anything not in the files
// can never become an auto answer.
export const ROUTES = {
  AUTO: 'auto',
  AGENT: 'agent',
  HUMAN: 'human',
  IGNORE: 'ignore',
};

const has = (text, words) => words.some((word) => text.includes(word));

const ORDER_WORDS = ['สั่ง', 'จอง', 'มัดจำ', 'โอน', 'จ่าย', 'ชำระ', 'เอา', 'รับ'];
const CUSTOM_PRICE_WORDS = ['ลด', 'พิเศษ', 'เหมา', 'ผ่อน', 'ต่อรอง', 'ราคากันเอง'];
const BUDGET_WORDS = ['งบ', 'ไม่เกิน', 'เกินงบ', 'ต่อกล่อง'];
const MENU_BROWSE_WORDS = ['เมนูมีอะไร', 'มีเมนูอะไร', 'แนะนำเมนู', 'เมนูอะไรบ้าง', 'ขอดูเมนู'];
const GREETING_WORDS = ['สวัสดี', 'หวัดดี', 'hello', 'hi'];

/** Cheapest sellable set per tier, computed from the published catalogue. */
export function priceFloors(planner = {}) {
  const floors = new Map();
  const prices = planner.prices || {};
  const tiers = planner.tiers || {};
  const names = planner.names || {};
  const deleted = new Set((planner.deleted || []).map(Number));
  const quoteOnly = new Set((planner.quoteOnly || []).map(Number));
  for (const [id, raw] of Object.entries(prices)) {
    const menuId = Number(id);
    const price = Number(raw);
    if (!Number.isFinite(price) || price <= 0) continue;
    if (deleted.has(menuId) || quoteOnly.has(menuId)) continue;
    const tier = String(tiers[id] || 'classic');
    const current = floors.get(tier);
    if (current === undefined || price < current.price) {
      floors.set(tier, { tier, price, id: menuId, name: names[id] || '' });
    }
  }
  return [...floors.values()].sort((a, b) => a.price - b.price);
}

function buildAutoAnswer(intent, { rules = {}, planner = {} } = {}) {
  const mealBox = rules.services?.mealBox || {};
  const snackBox = rules.services?.snackBox || {};
  const business = rules.business || {};
  const delivery = rules.delivery || {};
  const documents = rules.documents || {};
  const S = (field) => `data/business-rules.json:${field}`;

  switch (intent) {
    case 'greeting':
      return { text: 'สวัสดีครับ สอบถามเรื่องข้าวกล่องฮาลาลหรือจัดเลี้ยงได้เลยครับ', sources: [] };
    case 'hours': {
      const days = business.operatingDays || '';
      const hours = business.operatingHours || '';
      return {
        text: `ร้านเปิด${days ? ` ${days}` : ''}${hours ? ` เวลา ${hours} ครับ` : 'ครับ'}`.trim(),
        sources: [S('business.operatingDays'), S('business.operatingHours')],
      };
    }
    case 'minimum':
      return {
        text: `ขั้นต่ำ ${mealBox.minimumOrder ?? '-'} กล่องครับ (ต่อเมนู ${mealBox.standardMenuMinimum ?? '-'} กล่องขึ้นไป)`,
        sources: [S('services.mealBox.minimumOrder'), S('services.mealBox.standardMenuMinimum')],
      };
    case 'price_from': {
      const floors = priceFloors(planner);
      if (!floors.length) return null;
      const short = { classic: 'Classic', signature: 'Signature', executive: 'Executive' };
      const parts = floors.map((row) => `${short[row.tier] || row.tier} เริ่ม ${row.price} บาท`);
      return { text: `ราคาเริ่มต้น ${parts.join(' · ')} ครับ (ต่อกล่อง)`, sources: ['data/planner-overrides.json:prices'] };
    }
    case 'location':
      return { text: `ร้านอยู่ที่ ${business.address || '-'} ครับ`, sources: [S('business.address')] };
    case 'delivery':
      return {
        text: `${delivery.messageTh || ''} ${delivery.coverageTh ? `พื้นที่${delivery.coverageTh}` : ''} ${delivery.outsideBangkok ? `นอกเขต${delivery.outsideBangkok}` : ''}`.replace(/\s+/g, ' ').trim(),
        sources: [S('delivery.messageTh'), S('delivery.coverageTh'), S('delivery.outsideBangkok')],
      };
    case 'halal':
      return {
        text: `ร้านมีใบรับรองฮาลาล เลขที่ ${business.halalCertificate || '-'} ครับ`,
        sources: [S('business.halalCertificate')],
      };
    case 'quote_time':
      return {
        text: `ทีมตอบใบเสนอราคาภายใน ${documents.quoteWithinMinutes ?? '-'} นาทีครับ แจ้งจำนวนคน วันงาน และสถานที่มาได้เลยครับ`,
        sources: [S('documents.quoteWithinMinutes')],
      };
    case 'contact': {
      const line = rules.urls?.line || '';
      return {
        text: `ติดต่อได้ที่ ${business.phone || '-'} ครับ${line ? ` หรือ LINE ${line}` : ''}`,
        sources: [S('business.phone'), S('urls.line')],
      };
    }
    default:
      return null;
  }
}

const SAFE_INTENT_KEYWORDS = [
  ['hours', ['กี่โมง', 'เปิด', 'ปิดกี่โมง', 'เวลาทำการ', 'เปิดวันไหน']],
  ['minimum', ['ขั้นต่ำ', 'สั่งขั้นต่ำ', 'ต้องสั่งกี่']],
  ['price_from', ['ราคาเริ่มต้น', 'เริ่มกี่บาท', 'กล่องละเท่าไหร่', 'กล่องละเท่าไร', 'ราคาเท่าไหร่', 'ราคาเท่าไร']],
  ['location', ['อยู่ไหน', 'อยู่ที่ไหน', 'ที่ตั้ง', 'ที่อยู่ร้าน', 'แผนที่']],
  ['delivery', ['ส่งไหม', 'จัดส่ง', 'ค่าส่ง', 'ส่งต่างจังหวัด', 'ส่งนอก', 'พื้นที่ส่ง']],
  ['halal', ['ฮาลาล', 'halal', 'ใบรับรอง', 'อิสลามทานได้']],
  ['quote_time', ['ใบเสนอราคา', 'quotation', 'เสนอนราคา']],
  ['contact', ['ติดต่อ', 'เบอร์', 'โทร', 'ไลน์ร้าน', 'line']],
];

/**
 * @param {string} text customer message
 * @param {{rules?: object, planner?: object}} data
 * @returns {{route: string, intent: string|null, confidence: string, answer: string|null, sources: string[], reason: string}}
 */
export function classifyLineMessage(text, { rules = {}, planner = {} } = {}) {
  const raw = String(text ?? '').trim();
  if (!raw) {
    return { route: ROUTES.IGNORE, intent: null, confidence: 'high', answer: null, sources: [], reason: 'ไม่มีข้อความ (สติกเกอร์/รูป)' };
  }
  const lower = raw.toLowerCase();

  // Money and promises always go to the owner, no matter what else matches.
  if (has(raw, CUSTOM_PRICE_WORDS)) {
    return { route: ROUTES.HUMAN, intent: 'custom_price', confidence: 'high', answer: null, sources: [], reason: 'ขอราคาพิเศษ ต้องให้เจ้าของตัดสินใจ' };
  }
  if (has(raw, ORDER_WORDS) && /\d/.test(raw)) {
    return { route: ROUTES.HUMAN, intent: 'order', confidence: 'high', answer: null, sources: [], reason: 'มีการสั่งพร้อมจำนวน ต้องให้เจ้าของยืนยัน' };
  }

  // Needs catalogue reasoning — our agent team handles this later.
  if (has(raw, BUDGET_WORDS) && /\d/.test(raw)) {
    return { route: ROUTES.AGENT, intent: 'budget_match', confidence: 'high', answer: null, sources: [], reason: 'จับคู่ตามงบ ต้องอ่านแคตตาล็อก' };
  }
  if (has(raw, MENU_BROWSE_WORDS)) {
    return { route: ROUTES.AGENT, intent: 'menu_browse', confidence: 'high', answer: null, sources: [], reason: 'เลือกเมนู ต้องอ่านแคตตาล็อก' };
  }

  // Fixed facts straight from the files.
  for (const [intent, words] of SAFE_INTENT_KEYWORDS) {
    if (has(raw, words)) {
      const answer = buildAutoAnswer(intent, { rules, planner });
      if (!answer) break;
      return { route: ROUTES.AUTO, intent, confidence: 'high', answer: answer.text, sources: answer.sources, reason: 'คำตอบตายตัวจากไฟล์' };
    }
  }
  if (has(raw, GREETING_WORDS) && raw.length <= 20) {
    const answer = buildAutoAnswer('greeting', { rules, planner });
    return { route: ROUTES.AUTO, intent: 'greeting', confidence: 'medium', answer: answer.text, sources: [], reason: 'ทักทายสั้นๆ' };
  }

  // Unknown: let the agent team read the files and decide, never guess here.
  return { route: ROUTES.AGENT, intent: 'unknown', confidence: 'low', answer: null, sources: [], reason: 'ไม่เข้ากติกาใด ให้เอเจนต์อ่านไฟล์แล้วตัดสิน' };
}