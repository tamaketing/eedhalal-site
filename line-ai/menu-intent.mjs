// EED HALAL — deterministic menu-intent parser + MENU_CONTEXT builder.
//
// This module is dependency-free (no imports) so its functions can be
// embedded verbatim into n8n Code nodes via .toString() in addition to
// running in Node tests and services.
//
// Authority: numeric filters and name queries produced here are resolved
// ONLY by the live Internal API GET /api/v1/menus/mealbox (planner-backed).
// This module contains no menu catalog and no prices.
//
// Known limitation (by data, not by code): the planner has no structured
// protein field. A bare word such as "ไก่" is therefore treated ONLY as a
// menu-name keyword ("menu names containing ไก่"), never as "all chicken
// dishes". The tier is the only product level; a dish type such as "ข้าวผัด"
// is matched as a menu-name keyword instead.

// Tier ids published per menu (data/business-rules.json -> services.mealBox.tiers).
// A customer may also say the level by name, so both spellings are recognised.
const MENU_TIERS = {
  classic: 'classic',
  'คลาสสิก': 'classic',
  signature: 'signature',
  'ซิกเนเจอร์': 'signature',
  executive: 'executive',
  'พรีเมียม': 'executive',
};

const MENU_TIER_LABELS = {
  classic: 'Classic',
  signature: 'Signature',
  executive: 'Executive',
};

// A name + budget question is the old "category-price" shape ("ข้าวผัดงบ 70"):
// the dish word is now matched against menu names and composes with the price
// filter, so no phrasing a customer actually uses is lost.
const MENU_FETCH_MODES = [
  'exact-price', 'max-price', 'name-lookup',
  'name-price', 'name-max', 'tier-price', 'tier-max',
];

const MENU_CONTEXT_LIMIT = 100;

// Deterministic draft fallback: modes answered without Gemini. Fetchable
// modes need a live API result; clarify is answered from a static safe
// template. Display is capped so a 33-item budget result stays readable.
const DETERMINISTIC_DRAFT_MODES = [...MENU_FETCH_MODES, 'clarify'];

const MENU_DRAFT_DISPLAY_LIMIT = 8;

const DETERMINISTIC_DRAFT_SOURCE = 'deterministic-menu';

// Generic Thai food words used ONLY to decide whether a leftover text
// fragment looks like a menu-name query. This list classifies nothing:
// it never labels protein, dish type, or dish identity.
const MENU_NAME_KEYWORDS = [
  'ข้าว', 'ผัด', 'แกง', 'ทอด', 'ต้ม', 'ยำ', 'หมก', 'เส้น', 'มาม่า',
  'สปาเกตตี', 'ราด', 'คั่ว', 'กลิ้ง', 'เจียว', 'ดาว', 'เนื้อ', 'ไก่',
  'กุ้ง', 'ปลา', 'หมึก', 'ทะเล', 'แพะ', 'ผลไม้', 'เซ็ต', 'น่อง',
  'สะโพก', 'แหนม', 'ปลาทู', 'ต้มยำ', 'รถไฟ', 'หน่อไม้',
];

// Scaffolding stripped from the text remainder before name-query
// extraction. Order matters only for readability; every entry is removed
// globally. None of these substrings occur inside planner menu names.
const MENU_SCAFFOLDING = [
  'ค่าส่ง', 'ค่าจัดส่ง', 'กล่องละ', 'ต่อกล่อง', 'หัวละ', 'ต่อหัว',
  'ราคา', 'เท่าไหร่', 'เท่าไร', 'กี่บาท', 'เมนู', 'อาหาร', 'แนะนำ',
  'อยากได้', 'หน่อย', 'ครับ', 'คะ', 'ค่ะ', 'นะคะ', 'นะครับ', 'อันนี้',
  'ดังกล่าว', 'มี', 'ไหม', 'มั้ย', 'บ้าง', 'หรือ', 'ขอ', 'ให้', 'ด้วย',
  'และ', 'จาน', 'กล่อง', 'บาท', 'งบ', 'หัว', 'ที่', 'แถว',
  'ย่าน', 'เขต', 'นี้', 'นั้น', 'นี่', 'นั่น', 'thb', 'THB', '฿',
];

function normalizeMenuText(value) {
  return String(value ?? '').replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
}

function stripMenuScaffolding(text) {
  let out = ` ${text} `;
  for (const word of MENU_SCAFFOLDING) out = out.split(word).join(' ');
  out = out.replace(/ส่ง\S*/g, ' ');
  out = out.replace(/\d+(?:\.\d+)?/g, ' ');
  return out.replace(/\s+/g, ' ').trim();
}

// Returns { menuLookupNeeded, mode, price, maxPrice, tier, query }.
// price/maxPrice are numbers or null; tier/query are strings or null.
// Modes: exact-price | max-price | name-lookup | name-price | name-max |
// tier-price | tier-max | clarify | none. Only MENU_FETCH_MODES need an HTTP
// fetch; clarify carries no query (never guess a name); none carries nothing.
//
// Evidence rules keep non-menu messages out of the lookup:
// - bare "75 บาท" needs a menu word, a tier, or food-like remainder;
// - "ไม่เกิน N" needs a menu-domain cue (บาท/กล่อง/เมนู/งบ/tier/food);
// - "75 กล่อง" (quantity unit, no price cue) never becomes a price;
// - delivery-fee questions without menu cues stay with business rules.
function parseMenuIntent(text) {
  const empty = { menuLookupNeeded: false, mode: 'none', price: null, maxPrice: null, tier: null, query: null };
  const t = normalizeMenuText(text);
  if (!t) return empty;

  const maxMatch = t.match(/ไม่เกิน[^\d]{0,10}(\d+(?:\.\d+)?)/);
  const maxPrice = maxMatch ? Number(maxMatch[1]) : null;

  let price = null;
  let priceVia = null;
  if (maxPrice === null) {
    if (t.match(/งบ\s*(\d+(?:\.\d+)?)/)) {
      price = Number(t.match(/งบ\s*(\d+(?:\.\d+)?)/)[1]);
      priceVia = 'budget';
    } else if (t.match(/(กล่องละ|ต่อกล่อง|หัวละ|ต่อหัว|งบต่อหัว)\s*(\d+(?:\.\d+)?)/)) {
      price = Number(t.match(/(กล่องละ|ต่อกล่อง|หัวละ|ต่อหัว|งบต่อหัว)\s*(\d+(?:\.\d+)?)/)[2]);
      priceVia = 'unit';
    } else if (t.match(/ราคา\s*(\d+(?:\.\d+)?)/)) {
      price = Number(t.match(/ราคา\s*(\d+(?:\.\d+)?)/)[1]);
      priceVia = 'raka';
    } else if (t.match(/(\d+(?:\.\d+)?)\s*(บาท|฿|THB)/i)) {
      price = Number(t.match(/(\d+(?:\.\d+)?)\s*(บาท|฿|THB)/i)[1]);
      priceVia = 'baht';
    }
  }

  const hasPriceQuestion = /(เท่าไหร่|เท่าไร|กี่บาท|ราคา\?)/.test(t);
  const hasMenuWord = t.includes('เมนู') || t.includes('งบ');
  const tier = parseMenuTier(t);

  // Remainder-based name keyword. Budget paths strip the tier label so
  // "Signature" alone never becomes a redundant query; name questions keep
  // the full remainder so "ข้าวผัดปลาทู" stays intact.
  function remainderFor(stripTier) {
    let remainder = t;
    if (maxMatch) remainder = remainder.replace(maxMatch[0], ' ');
    else if (price !== null) {
      const spans = [
        t.match(/งบ\s*\d+(?:\.\d+)?(?:\s*(บาท|฿|THB))?/i),
        t.match(/\d+(?:\.\d+)?\s*(บาท|฿|THB)/i),
        t.match(/(กล่องละ|ต่อกล่อง|หัวละ|ต่อหัว|งบต่อหัว)\s*\d+(?:\.\d+)?/),
        t.match(/ราคา\s*\d+(?:\.\d+)?/),
      ];
      for (const span of spans) {
        if (span) { remainder = remainder.replace(span[0], ' '); break; }
      }
    }
    if (stripTier) remainder = stripMenuTierWords(remainder);
    return stripMenuScaffolding(remainder);
  }
  function queryFor(stripTier) {
    const remainder = remainderFor(stripTier);
    if (!remainder) return null;
    return MENU_NAME_KEYWORDS.some((word) => remainder.includes(word)) ? remainder : null;
  }

  if (maxPrice !== null) {
    const query = queryFor(true);
    const evidenced = /(บาท|฿|THB|กล่อง|เมนู|งบ)/i.test(t) || tier !== null || query !== null;
    if (!evidenced) return empty;
    const mode = tier ? 'tier-max' : query ? 'name-max' : 'max-price';
    return { menuLookupNeeded: true, mode, price: null, maxPrice, tier, query };
  }
  if (price !== null) {
    const query = queryFor(true);
    const evidenced = priceVia !== 'baht' || hasMenuWord || tier !== null || query !== null;
    if (!evidenced) return empty;
    const mode = tier ? 'tier-price' : query ? 'name-price' : 'exact-price';
    return { menuLookupNeeded: true, mode, price, maxPrice: null, tier, query };
  }
  if (hasPriceQuestion) {
    // Delivery-fee questions ("ค่าส่งเท่าไหร่") stay with business rules:
    // without a menu word, budget word, tier, or food-like remainder,
    // there is nothing deterministic to look up.
    const query = queryFor(false);
    const deliveryOnly = /(ค่าส่ง|ส่งฟรี|ค่าจัดส่ง)/.test(t) && !hasMenuWord && !tier && !query;
    if (deliveryOnly) return empty;
    if (query) return { menuLookupNeeded: true, mode: 'name-lookup', price: null, maxPrice: null, tier: null, query };
    if (tier) return { menuLookupNeeded: true, mode: 'name-lookup', price: null, maxPrice: null, tier, query: null };
    return { menuLookupNeeded: false, mode: 'clarify', price: null, maxPrice: null, tier: null, query: null };
  }
  return empty;
}

// The tier a customer named, in either spelling. Longest label first so
// "ซิกเนเจอร์" is never shadowed by a shorter overlap.
function parseMenuTier(text) {
  const lower = text.toLowerCase();
  const entries = Object.entries(MENU_TIERS).sort((a, b) => b[0].length - a[0].length);
  for (const [label, id] of entries) {
    if (lower.includes(label.toLowerCase())) return id;
  }
  return null;
}

function stripMenuTierWords(text) {
  let out = ` ${text} `;
  for (const label of Object.keys(MENU_TIERS).sort((a, b) => b.length - a.length)) {
    out = out.split(label).join(' ');
    const lower = label.toLowerCase();
    out = out.split(lower).join(' ');
  }
  return out;
}

// Deterministic query string for GET /api/v1/menus/mealbox. Fixed key
// order; always carries the safe retrieval limit (backend max).
function buildMenuQueryString(plan) {
  const params = [];
  if (plan && typeof plan.price === 'number') params.push(`price=${encodeURIComponent(String(plan.price))}`);
  if (plan && typeof plan.maxPrice === 'number') params.push(`maxPrice=${encodeURIComponent(String(plan.maxPrice))}`);
  if (plan && typeof plan.tier === 'string' && plan.tier) params.push(`tier=${encodeURIComponent(plan.tier)}`);
  if (plan && typeof plan.query === 'string' && plan.query) params.push(`q=${encodeURIComponent(plan.query)}`);
  params.push(`limit=${MENU_CONTEXT_LIMIT}`);
  return params.join('&');
}

function isValidMenuEntry(entry) {
  if (!entry || typeof entry !== 'object') return false;
  if (typeof entry.id !== 'string' && typeof entry.id !== 'number') return false;
  if (typeof entry.name !== 'string' || !entry.name.trim()) return false;
  if (typeof entry.price !== 'number' || !Number.isFinite(entry.price) || entry.price <= 0) return false;
  return true;
}

function formatMenuLine(menu) {
  const min = Number(menu.minPerMenu) > 0 ? Number(menu.minPerMenu) : '?';
  const tier = MENU_TIER_LABELS[menu.tier] || menu.tier || '?';
  return `- ${menu.id} | ${menu.name} | ${menu.price} บาท/กล่อง | ขั้นต่ำ ${min} กล่อง/เมนู | ระดับ ${tier}`;
}

function formatDraftBullet(menu) {
  return `• ${menu.name} — ${menu.price} บาท/กล่อง`;
}

function formatMinPerMenuLine(menu) {
  const min = Number(menu.minPerMenu);
  if (!Number.isInteger(min) || min < 1) return null;
  return `เมนูนี้ขั้นต่ำ ${min} กล่องต่อเมนูค่ะ`;
}

// Deterministic customer-safe draft for eligible menu modes. Inputs are
// ONLY the parser plan and the live API payload: every stated name+price
// pair comes from apiResult.menus, so a remembered price can never leak.
// apiResult: { ok: true, menus: [...] } | { ok: false } | null.
// Business policy (overall minimum, delivery, deposit, VAT) is NEVER
// stated here; only per-menu facts from the API plus safe fallbacks.
function buildDeterministicMenuDraft(plan, apiResult) {
  const mode = plan && typeof plan.mode === 'string' ? plan.mode : 'none';
  if (mode === 'clarify') return 'ขอชื่อเมนูที่ต้องการเช็กราคาหน่อยค่ะ';
  if (!DETERMINISTIC_DRAFT_MODES.includes(mode)) return '';
  if (!apiResult || apiResult.ok !== true || !Array.isArray(apiResult.menus)) {
    return 'ขออนุญาตตรวจสอบรายการเมนูและราคากับทางทีมก่อนนะคะ';
  }
  for (const entry of apiResult.menus) {
    if (!isValidMenuEntry(entry)) {
      return 'ขออนุญาตตรวจสอบรายการเมนูและราคากับทางทีมก่อนนะคะ';
    }
  }
  if (apiResult.menus.length === 0) {
    if (mode === 'name-lookup' && plan.query) return 'ขออนุญาตเช็กราคาเมนูนี้กับทางทีมก่อนนะคะ';
    return 'ตอนนี้ยังไม่พบเมนูในช่วงราคานี้จากรายการปัจจุบันค่ะ';
  }
  // A single named match answers the question outright; a single tier match
  // needs the level in the sentence so the customer knows what they asked for.
  if (mode === 'name-lookup' && apiResult.menus.length === 1) {
    const menu = apiResult.menus[0];
    const lead = plan.query
      ? `${menu.name} ราคา ${menu.price} บาท/กล่องค่ะ`
      : `เมนูระดับ ${MENU_TIER_LABELS[plan.tier] || plan.tier} ที่มีตอนนี้คือ ${menu.name} ราคา ${menu.price} บาท/กล่องค่ะ`;
    const lines = [lead];
    const minLine = formatMinPerMenuLine(menu);
    if (minLine) lines.push(minLine);
    return lines.join('\n');
  }
  const shown = apiResult.menus.slice(0, MENU_DRAFT_DISPLAY_LIMIT);
  const rest = apiResult.menus.length - shown.length;
  const lines = [draftListHeader(plan, apiResult), ...shown.map(formatDraftBullet)];
  if (rest > 0) lines.push(`ยังมีอีก ${rest} รายการค่ะ`);
  lines.push('สนใจเมนูไหนบอกได้เลยนะคะ');
  return lines.join('\n');
}

function draftListHeader(plan, apiResult) {
  const mode = plan.mode;
  const tierLabel = MENU_TIER_LABELS[plan.tier] || plan.tier || '';
  if (mode === 'exact-price') return `สำหรับงบ ${plan.price} บาท/กล่อง มีเมนูดังนี้ค่ะ`;
  if (mode === 'max-price') return `เมนูไม่เกิน ${plan.maxPrice} บาท/กล่อง มีดังนี้ค่ะ`;
  if (mode === 'tier-price') return `เมนูระดับ ${tierLabel} งบ ${plan.price} บาท/กล่อง มีเมนูดังนี้ค่ะ`;
  if (mode === 'tier-max') return `เมนูระดับ ${tierLabel} ไม่เกิน ${plan.maxPrice} บาท/กล่อง มีเมนูดังนี้ค่ะ`;
  if (mode === 'name-price') return `เมนู "${plan.query}" งบ ${plan.price} บาท/กล่อง มีดังนี้ค่ะ`;
  if (mode === 'name-max') return `เมนู "${plan.query}" ไม่เกิน ${plan.maxPrice} บาท/กล่อง มีดังนี้ค่ะ`;
  return `เมนูที่ตรงกับ "${plan.query || plan.tier}" มีดังนี้ค่ะ`;
}

// Builds the factual MENU_CONTEXT string. Inputs are ONLY the parser plan
// and the live API payload: an "old" price can never leak in because this
// function accepts no prompt/catalog/history input at all.
// apiResult: { ok: true, menus: [...] } | { ok: false } | null (not fetched).
// Returns '' when no menu context applies (mode none).
function buildMenuContext(plan, apiResult) {
  const mode = plan && typeof plan.mode === 'string' ? plan.mode : 'none';
  if (mode === 'none') return '';
  const header = ['MENU_CONTEXT', 'source: planner-overrides', `mode: ${mode}`];
  if (mode === 'clarify') {
    return [
      ...header,
      'result: need_menu_name',
      'คำแนะนำ: ห้ามเดาชื่อเมนู ห้ามระบุราคา ให้ถามชื่อเมนูที่ต้องการเช็กราคา',
    ].join('\n');
  }
  if (!apiResult || apiResult.ok !== true || !Array.isArray(apiResult.menus)) {
    return [
      ...header,
      'result: lookup_failed',
      'คำแนะนำ: การค้นหาราคาล้มเหลว ห้ามใช้ราคาที่จำได้ ห้ามเดาราคา ให้แจ้งว่าขอเช็กราคากับทางทีมก่อน',
    ].join('\n');
  }
  for (const entry of apiResult.menus) {
    if (!isValidMenuEntry(entry)) {
      return [
        ...header,
        'result: lookup_failed',
        'คำแนะนำ: ข้อมูลราคาผิดรูปแบบ ห้ามใช้ราคาที่จำได้ ห้ามเดาราคา ให้แจ้งว่าขอเช็กราคากับทางทีมก่อน',
      ].join('\n');
    }
  }
  if (apiResult.menus.length === 0) {
    if (mode === 'name-lookup' && plan.query) {
      return [
        ...header,
        `query: ${plan.query}`,
        'result: empty (no matching menu)',
        'คำแนะนำ: ไม่พบเมนูที่ค้นหา ห้ามแต่งราคาหรือชื่อเมนูอื่น ให้แจ้งว่าขอเช็กราคากับทางทีมก่อน',
      ].join('\n');
    }
    return [
      ...header,
      'result: empty (no menus in this price range)',
      'คำแนะนำ: ไม่มีเมนูในช่วงราคานี้ ห้ามแต่งราคาเพื่อให้พอดีงบ ให้แจ้งตามจริง',
    ].join('\n');
  }
  const lines = [...header];
  if (typeof plan.price === 'number') lines.push(`price: ${plan.price}`);
  if (typeof plan.maxPrice === 'number') lines.push(`maxPrice: ${plan.maxPrice}`);
  if (typeof plan.tier === 'string' && plan.tier) {
    lines.push(`tier: ${plan.tier} (${MENU_TIER_LABELS[plan.tier] || plan.tier}; product level, not a dish type)`);
  }
  if (typeof plan.query === 'string' && plan.query) {
    lines.push(`query: ${plan.query} (menu names containing this text; not a dish classification)`);
  }
  lines.push('menus:');
  for (const entry of apiResult.menus) lines.push(formatMenuLine(entry));
  lines.push('ใช้เฉพาะชื่อและราคานี้เท่านั้น ห้ามเปลี่ยนราคา ห้ามเพิ่มเมนูอื่น ห้ามใช้ราคาที่จำได้');
  return lines.join('\n');
}

export {
  MENU_TIERS,
  MENU_TIER_LABELS,
  MENU_FETCH_MODES,
  MENU_CONTEXT_LIMIT,
  MENU_NAME_KEYWORDS,
  MENU_SCAFFOLDING,
  DETERMINISTIC_DRAFT_MODES,
  MENU_DRAFT_DISPLAY_LIMIT,
  DETERMINISTIC_DRAFT_SOURCE,
  normalizeMenuText,
  stripMenuScaffolding,
parseMenuIntent,
  parseMenuTier,
  stripMenuTierWords,
  buildMenuQueryString,
  isValidMenuEntry,
  formatMenuLine,
  formatDraftBullet,
  formatMinPerMenuLine,
  draftListHeader,
  buildMenuContext,
  buildDeterministicMenuDraft,
};
