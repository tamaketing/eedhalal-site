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
const DELIVERY_FEE_WORDS = ['ค่าส่ง', 'ค่าจัดส่ง', 'ค่าขนส่ง', 'ส่งเท่าไหร่', 'ส่งเท่าไร', 'ส่งกี่บาท'];
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

/** Display name for a tier, taken from business-rules and trimmed before " — ". */
export function tierLabel(tierId, rules = {}) {
  const tiers = rules.services?.mealBox?.tiers;
  if (!Array.isArray(tiers)) return '';
  const tier = tiers.find((row) => String(row?.id) === String(tierId));
  const nameTh = String(tier?.nameTh || '');
  return nameTh.split(' — ')[0].trim();
}

/** Every sellable dish per tier, cheapest first, straight from the catalogue. */
export function menusByTier(planner = {}, rules = {}) {
  const prices = planner.prices || {};
  const tiers = planner.tiers || {};
  const names = planner.names || {};
  const deleted = new Set((planner.deleted || []).map(Number));
  const quoteOnly = new Set((planner.quoteOnly || []).map(Number));
  const grouped = new Map();
  for (const [id, raw] of Object.entries(prices)) {
    const menuId = Number(id);
    const price = Number(raw);
    if (!Number.isFinite(price) || price <= 0) continue;
    if (deleted.has(menuId) || quoteOnly.has(menuId)) continue;
    const tier = String(tiers[id] || 'classic');
    const name = String(names[id] || '').trim();
    if (!name) continue;
    if (!grouped.has(tier)) grouped.set(tier, []);
    grouped.get(tier).push({ id: menuId, name, price });
  }
  return [...grouped.entries()]
    .map(([tier, items]) => ({
      tier,
      label: tierLabel(tier, rules),
      items: items.sort((a, b) => a.price - b.price || a.id - b.id),
    }))
    .sort((a, b) => (a.items[0]?.price ?? 0) - (b.items[0]?.price ?? 0));
}

/** Which tier is the customer asking about, by the words they actually used. */
const TIER_WORDS = [
  ['executive', ['executive premium', 'premium', 'พรีเมียม', 'เอ็กซ์', 'ระดับ 3', 'ระดับสาม']],
  ['signature', ['signature', 'ซิกเนเจอร์', 'ระดับ 2', 'ระดับสอง']],
  ['classic', ['classic', 'คลาสสิก', 'ระดับ 1', 'ระดับหนึ่ง']],
];

export function detectTier(text) {
  const lower = String(text || '').toLowerCase();
  for (const [tier, words] of TIER_WORDS) {
    if (words.some((word) => lower.includes(word))) return tier;
  }
  return '';
}

const MAX_LISTED_PER_TIER = 8;
const MENU_SAMPLE_PER_TIER = 5;

/** The published menu page, from business-rules only. */
function menuPageUrl(rules = {}) {
  return rules.urls?.menu || '';
}

function renderTierMenus(tierId, { rules = {}, planner = {} } = {}) {
  const group = menusByTier(planner, rules).find((row) => row.tier === tierId);
  if (!group || !group.items.length) return '';
  const label = group.label || group.tier;
  const shown = group.items.slice(0, MAX_LISTED_PER_TIER);
  const rest = group.items.length - shown.length;
  const menuPage = menuPageUrl(rules);
  const lines = [
    `${label} มี ${group.items.length} เมนูครับ`,
    ...shown.map((item) => `- ${item.name} ${item.price} บาท`),
  ];
  if (rest > 0) {
    lines.push(rest > 0 && menuPage
      ? `อีก ${rest} เมนู ดูชื่อครบได้ที่ ${menuPage}`
      : `อีก ${rest} เมนู ถามชื่อที่อยากได้เพิ่มได้เลยครับ`);
  } else if (menuPage) {
    lines.push(`ดูหน้ารายชื่อเมนูได้ที่ ${menuPage}`);
  }
  lines.push('สนใจเมนูไหน หรือให้ช่วยเลือกตามงบก็บอกได้เลยครับ');
  return lines.join('\n');
}

/** No tier named: show what exists per tier so the customer can pick one. */
function renderTierOverview({ rules = {}, planner = {} } = {}) {
  const groups = menusByTier(planner, rules).filter((row) => row.items.length);
  if (!groups.length) return '';
  const lines = groups.map((row) => {
    const label = row.label || row.tier;
    const first = row.items[0];
    const samples = row.items.slice(0, 2).map((item) => item.name).join(' / ');
    return `${label} มี ${row.items.length} เมนู เริ่ม ${first.price} บาท (เช่น ${samples})`;
  });
  lines.push('อยากดูรายชื่อเต็มของระดับไหน บอกได้เลยครับ');
  const page = menuPageUrl(rules);
  if (page) lines.push(`ดูหน้ารายชื่อเมนูได้ที่ ${page}`);
  return lines.join('\n');
}

/** Every tier with real dish names and prices — the answer the owner asked for.
 *  A short sample per tier keeps the LINE message readable; naming a tier later
 *  returns the longer list. */
function renderPriceFromWithMenus({ rules = {}, planner = {} } = {}) {
  const groups = menusByTier(planner, rules).filter((row) => row.items.length);
  if (!groups.length) return '';
  const lines = [];
  for (const row of groups) {
    const label = row.label || row.tier;
    const first = row.items[0];
    lines.push(`${label} เริ่ม ${first.price} บาท มี ${row.items.length} เมนูครับ`);
    for (const item of row.items.slice(0, MENU_SAMPLE_PER_TIER)) {
      lines.push(`- ${item.name} ${item.price} บาท`);
    }
    const rest = row.items.length - MENU_SAMPLE_PER_TIER;
    if (rest > 0) lines.push(`  อีก ${rest} เมนูในระดับนี้`);
  }
  lines.push('อยากดูรายชื่อครบของระดับไหน หรือให้ช่วยเลือกตามงบ บอกได้เลยครับ');
  const page = menuPageUrl(rules);
  if (page) lines.push(`ดูหน้ารายชื่อเมนูได้ที่ ${page}`);
  return lines.join('\n');
}

function buildAutoAnswer(intent, { rules = {}, planner = {}, text = '' } = {}) {
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
      const parts = floors
        .map((row) => {
          const label = tierLabel(row.tier, rules);
          return label ? `${label} เริ่ม ${row.price} บาท` : '';
        })
        .filter(Boolean);
      if (!parts.length) return null;
      // "ราคาเริ่มต้นเท่าไหร่" is really "ชื่อเมนูอะไรบ้าง ราคาเท่าไร" to a customer,
      // so give the dishes with their real prices, not only the three floors.
      const withMenus = renderPriceFromWithMenus({ rules, planner });
      if (withMenus) {
        return { text: withMenus, sources: ['data/planner-overrides.json:prices', S('services.mealBox.tiers')] };
      }
      return { text: `ราคาเริ่มต้น ${parts.join(' · ')} ครับ (ต่อกล่อง)`, sources: ['data/planner-overrides.json:prices', S('services.mealBox.tiers')] };
    }
    case 'location':
      return { text: `ร้านอยู่ที่ ${business.address || '-'} ครับ`, sources: [S('business.address')] };
    case 'delivery': {
      const coverage = delivery.coverageTh || '';
      const outside = delivery.outsideBangkok || '';
      if (!coverage && !outside) return null;
      const parts = [];
      if (coverage) parts.push(`${coverage} ครับ`);
      if (outside) parts.push(`ส่วนนอกเขต${outside}ได้ครับ`);
      return {
        text: parts.join(' ').replace(/\s+/g, ' ').trim(),
        sources: [S('delivery.coverageTh'), S('delivery.outsideBangkok')],
      };
    }
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
    case 'menu_by_tier': {
      const tierId = detectTier(text);
      const body = renderTierMenus(tierId, { rules, planner });
      if (!body) return null;
      return { text: body, sources: ['data/planner-overrides.json:prices', 'data/planner-overrides.json:tiers'] };
    }
    case 'menu_overview': {
      const body = renderTierOverview({ rules, planner });
      if (!body) return null;
      return { text: body, sources: ['data/planner-overrides.json:prices', 'data/planner-overrides.json:tiers'] };
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
  // Delivery fees are the owner's call (admin quote), never a bot answer.
  if (has(raw, DELIVERY_FEE_WORDS)) {
    return {
      route: ROUTES.HUMAN,
      intent: 'delivery_fee',
      confidence: 'high',
      answer: null,
      sources: ['data/business-rules.json:delivery.messageTh'],
      draft: 'เรื่องค่าจัดส่ง — เจ้าของต้องตอบเอง (ระบบไม่ร่างให้)',
      reason: 'ค่าจัดส่งให้แอดมินตอบตามสถานที่และจำนวน',
    };
  }

  // Needs catalogue reasoning — our agent team handles this later.
  if (has(raw, BUDGET_WORDS) && /\d/.test(raw)) {
    return { route: ROUTES.AGENT, intent: 'budget_match', confidence: 'high', answer: null, sources: [], reason: 'จับคู่ตามงบ ต้องอ่านแคตตาล็อก' };
  }
  const normaliseThai = (text) => String(text || '').replace(/เมนุ/g, 'เมนู').replace(/\s+/g, ' ').trim();

// Customers ask this many ways and they typo ("เมนุ"), so a named tier plus any
// of these words is treated as a request for that tier's actual dishes.
const MENU_BROWSE_EXTRA = ['มีอะไร', 'อะไรบ้าง', 'ชื่อเมนู', 'ราคาเท่า', 'รายการเมนู', 'เมนู'];

function isMenuBrowseRequest(raw) {
  const text = normaliseThai(raw);
  if (has(text, MENU_BROWSE_WORDS)) return true;
  return Boolean(detectTier(text)) && has(text, MENU_BROWSE_EXTRA);
}

if (isMenuBrowseRequest(raw)) {
    const text = normaliseThai(raw);
    // A named tier is a fixed list in the catalogue: answer it exactly, without
    // a model, so every dish and price is the published one.
    const tierId = detectTier(text);
    if (tierId) {
      const answer = buildAutoAnswer('menu_by_tier', { rules, planner, text });
      if (answer) {
        return { route: ROUTES.AUTO, intent: 'menu_by_tier', confidence: 'high', answer: answer.text, sources: answer.sources, reason: 'รายชื่อเมนูตามระดับจากแคตตาล็อก' };
      }
    }
    // No tier named: one short line per tier, then ask which one to list.
    const overview = buildAutoAnswer('menu_overview', { rules, planner, text });
    if (overview) {
      return { route: ROUTES.AUTO, intent: 'menu_overview', confidence: 'medium', answer: overview.text, sources: overview.sources, reason: 'สรุปเมนูรายระดับจากแคตตาล็อก' };
    }
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