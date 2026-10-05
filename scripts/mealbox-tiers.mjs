// Meal-box tiers: one definition, one price calculation, three renderers.
//
// Names, selling points, "best for" copy, box format and the second-dish copy
// live in data/business-rules.json (services.mealBox.tiers). A set's tier and
// its sale price live in the central menu database and reach the web through
// data/planner-overrides.json. A tier starting price is therefore never typed
// anywhere: it is the cheapest set of that tier that is published and open for
// sale. A tier with no such set has no price (null) and every renderer says
// "ask us" instead of falling back to an older figure — or, when the tier is
// marked `launching`, says it is not open yet and invites the customer to ask
// to be told when it does.

// Cooking type of a second dish. Defined here, not in menu-central.mjs, because
// this module already owns the tier vocabulary and menu-central imports it —
// keeping the dependency one-way avoids a cycle.
//   side       = a savoury second dish for the Signature box
//   soup_curry = a soup or curry second dish for the Signature box
//   dessert    = sweet, needs a corrugated box, so it is not a Signature item
export const SIDE_ITEM_KINDS = ['side', 'soup_curry', 'dessert'];

export const TIER_CLASSIC = 'classic';
export const TIER_SIGNATURE = 'signature';
export const TIER_EXECUTIVE = 'executive';

// Display order = entry order in business-rules.json, so reordering there
// reorders the table, the cards and the knowledge pack together.
export const TIER_IDS = [TIER_CLASSIC, TIER_SIGNATURE, TIER_EXECUTIVE];

const FALLBACK_TIER = TIER_CLASSIC;

export function isTierId(value) {
  return TIER_IDS.includes(String(value || ''));
}

export function normalizeTier(value) {
  const key = String(value || '').trim();
  return isTierId(key) ? key : FALLBACK_TIER;
}

export function tierDefinitions(rules) {
  const declared = rules?.services?.mealBox?.tiers;
  const list = Array.isArray(declared) ? declared : [];
  return list
    .filter((tier) => tier && isTierId(tier.id))
    .map((tier) => ({
      id: tier.id,
      nameTh: String(tier.nameTh || ''),
      nameEn: String(tier.nameEn || ''),
      sellingPointTh: String(tier.sellingPointTh || ''),
      sellingPointEn: String(tier.sellingPointEn || ''),
      bestForTh: String(tier.bestForTh || ''),
      bestForEn: String(tier.bestForEn || ''),
      boxFormatTh: String(tier.boxFormatTh || ''),
      boxFormatEn: String(tier.boxFormatEn || ''),
      // Which side-item ids this tier may offer. The ids only exist here; the
      // name, the price and the confirmed/pending state come from the published
      // catalogue, so a side is described in exactly one place.
      sideChoices: Array.isArray(tier.sideChoices)
        ? tier.sideChoices.map((id) => String(id).trim()).filter(Boolean)
        : [],
      // The customer-facing name for that choice. The catalogue `kind` is never
      // shown: a guest picks the second dish, not a cooking category.
      sideChoiceLabelTh: String(tier.sideChoiceLabelTh || ''),
      sideChoiceLabelEn: String(tier.sideChoiceLabelEn || ''),
      sideChoiceNoteTh: String(tier.sideChoiceNoteTh || ''),
      sideChoiceNoteEn: String(tier.sideChoiceNoteEn || ''),
      // `launching` means the tier exists but is not orderable yet: the web
      // must invite interest, never imply the customer can order it now.
      launchStatus: tier.launchStatus === 'launching' ? 'launching' : 'open',
      launchNoteTh: String(tier.launchNoteTh || ''),
      launchNoteEn: String(tier.launchNoteEn || ''),
    }))
    .sort((a, b) => TIER_IDS.indexOf(a.id) - TIER_IDS.indexOf(b.id));
}

// A tier that is still being prepared: known, described, but not on sale. Once
// it has a published set the catalogue wins and the tier behaves like any other.
export function isLaunching(tier, floor) {
  return !floor && tier?.launchStatus === 'launching';
}

// Side items as published: id -> { name, priceAdjustment, priceStatus, ... }.
// Names are never typed by hand here; an unconfirmed price is always null, so
// no renderer can quote a number the kitchen has not confirmed.
function sideItemsFromList(list) {
  const out = new Map();
  for (const item of Array.isArray(list) ? list : []) {
    if (!item || !item.id) continue;
    out.set(String(item.id), {
      id: String(item.id),
      nameTh: String(item.nameTh || ''),
      nameEn: String(item.nameEn || item.nameTh || ''),
      // Cooking type, kept so a consumer can tell a Signature second dish from
      // a premium-box dessert. It is never printed on the page.
      kind: SIDE_ITEM_KINDS.includes(String(item.kind)) ? String(item.kind) : 'side',
      priceAdjustment: item.priceStatus === 'ready' && Number.isFinite(Number(item.priceAdjustment))
        ? Number(item.priceAdjustment)
        : null,
      priceStatus: item.priceStatus === 'ready' ? 'ready' : 'pending',
      active: item.active === true,
      public: item.public === true,
    });
  }
  return out;
}

export function sideItemsFromPlanner(overrides = {}) {
  return sideItemsFromList(overrides?.sideItems);
}

// The admin preview reads the draft projection, so the owner sees the side he
// just typed rather than the published release.
export function sideItemsFromProjection(projection) {
  return sideItemsFromList(projection?.sideItems);
}

// Join a tier's side ids against the published side items. Ids that no
// published side answers for are reported rather than silently dropped, so a
// typo in business-rules.json surfaces instead of shrinking the offer silently.
export function resolveSideChoices(tier, sideItems = new Map()) {
  const wanted = Array.isArray(tier?.sideChoices) ? tier.sideChoices : [];
  const items = [];
  const unresolved = [];
  for (const id of wanted) {
    const item = sideItems.get(id);
    if (item && item.active) items.push(item);
    else unresolved.push(id);
  }
  return { items, unresolved };
}

// Cross-file integrity for the tier/side wiring. Called by the business-sync
// gate: an id in business-rules.json that the published catalogue cannot answer
// for is a broken promise, not a cosmetic issue.
export function sideChoiceProblems(rules, overrides = {}) {
  const sideItems = sideItemsFromPlanner(overrides);
  const problems = [];
  for (const tier of tierDefinitions(rules)) {
    for (const id of resolveSideChoices(tier, sideItems).unresolved) {
      problems.push(`services.mealBox.tiers[${tier.id}].sideChoices อ้าง "${id}" ที่ไม่มีใน data/planner-overrides.json (sideItems) หรือถูกปิดใช้งาน`);
    }
  }
  return problems;
}

// One wording, three channels (web, llms.txt, LINE knowledge pack): which
// second dishes a tier may offer, named from the catalogue. No price appears
// here — a side whose price the kitchen has not confirmed has none to quote,
// and the customer's box price is the quotation's job, not this sentence's.
export function sideChoiceSummary(tier, sideItems = new Map(), en = false) {
  const names = resolveSideChoices(tier, sideItems)
    .items.filter((item) => item.public)
    .map((item) => (en ? item.nameEn : item.nameTh))
    .filter(Boolean);
  if (!names.length) return '';
  const label = en ? tier.sideChoiceLabelEn || tier.sideChoiceLabelTh : tier.sideChoiceLabelTh || tier.sideChoiceLabelEn;
  const head = label ? `${label}: ` : '';
  return en
    ? `${head}${names.join(', ')}.`
    : `${head}${names.join(' · ')}`;
}

const toSet = (menu) => ({
  id: Number.isFinite(Number(menu.id)) ? Number(menu.id) : null,
  name: String(menu.name || ''),
  price: Number(menu.price),
  tier: normalizeTier(menu.tier),
  image: String(menu.image || ''),
  minPerMenu: Number(menu.minPerMenu) || 0,
  hidden: menu.hidden === true || menu.ownerHidden === true,
  quoteOnly: menu.costBlocked === true || menu.priceHidden === true,
});

const isSellable = (set) => !set.hidden && !set.quoteOnly && set.price > 0;

// Sets as published: planner-overrides.json is the only public price source.
export function setsFromPlanner(overrides = {}) {
  const deleted = new Set((overrides.deleted || []).map(String));
  const quoteOnly = new Set((overrides.quoteOnly || []).map(String));
  const tiers = overrides.tiers || {};
  return Object.keys(overrides.prices || {})
    .filter((id) => !deleted.has(String(id)) && !quoteOnly.has(String(id)))
    .map((id) => ({
      id: Number(id),
      name: String(overrides.names?.[id] ?? ''),
      price: Number(overrides.prices[id]),
      tier: normalizeTier(tiers[id]),
      image: String(overrides.images?.[id] ?? ''),
      minPerMenu: Number(overrides.mins?.[id]) || 0,
    }))
    .sort((a, b) => a.price - b.price || a.id - b.id);
}

// Sets from a menu-central projection (Map keyed by id), used by the admin
// preview so the owner sees the draft, not the published release.
export function setsFromProjection(projection) {
  const menus = projection?.menus instanceof Map ? projection.menus : new Map();
  return [...menus.entries()]
    // The projection's key is the id; the record itself may not repeat it.
    .map(([id, menu]) => toSet({ ...menu, id }))
    .sort((a, b) => a.price - b.price || a.id - b.id);
}

// The single price rule. `floors[tier]` is null when no set qualifies, which
// every renderer must treat as "no price published", never as zero.
export function computeTierFloors(sets = []) {
  const members = {};
  const floors = {};
  for (const tier of TIER_IDS) {
    const sellable = sets.filter((set) => set.tier === tier && isSellable(set));
    members[tier] = sellable;
    const cheapest = sellable.length ? sellable.reduce((a, b) => (b.price < a.price ? b : a)) : null;
    floors[tier] = cheapest
      ? { priceFrom: cheapest.price, sourceId: cheapest.id, sourceName: cheapest.name }
      : null;
  }
  return { floors, members };
}

export function tierPriceFrom(sets, tierId) {
  return computeTierFloors(sets).floors[normalizeTier(tierId)]?.priceFrom ?? null;
}

// Everything the renderers need, computed once per page generation.
// `sideItems` is a Map of published side items so a tier's side choices are
// resolved from the catalogue rather than from a second list of names.
export function tierContext(rules, sets, sideItems = new Map()) {
  const { floors, members } = computeTierFloors(sets);
  return { tiers: tierDefinitions(rules), floors, members, sideItems };
}

const escape = (value) => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;');

const money = (value) => Number(value).toLocaleString('en-US');

export function tierAnchorId(tierId) {
  return `tier-${normalizeTier(tierId)}`;
}

export function tierAnchorHref(en, tierId) {
  const base = en ? '/en/popular-menu.html' : '/popular-menu.html';
  return `${base}#${tierAnchorId(tierId)}`;
}

export function lineUrl(rules, { source, medium, content }) {
  const base = String(rules?.urls?.line || 'https://lin.ee/CfvqJTd');
  const params = new URLSearchParams({ utm_source: 'site', utm_medium: medium, utm_content: content });
  return `${base}?${params.toString()}` + (source ? `#${source}` : '');
}

const name = (tier, en) => escape(en ? tier.nameEn || tier.nameTh : tier.nameTh || tier.nameEn);
const sellingPoint = (tier, en) => escape(en ? tier.sellingPointEn || tier.sellingPointTh : tier.sellingPointTh || tier.sellingPointEn);
const bestFor = (tier, en) => escape(en ? tier.bestForEn || tier.bestForTh : tier.bestForTh || tier.bestForEn);

// What is actually in the box. Written as customer words in business data, not
// assembled from a parts list, so the page never reads like a database dump.
function boxFormatLine(tier, en) {
  const format = en ? tier.boxFormatEn || tier.boxFormatTh : tier.boxFormatTh || tier.boxFormatEn;
  return format ? `<p class="tier-box-format">${escape(format)}</p>` : '';
}

// The side dishes a tier may offer, named from the catalogue. An unconfirmed
// price is never rendered: a customer reads the dish, the quote carries the
// number. `public:false` sides stay out of the customer page entirely.
export function sideChoiceLine(tier, sideItems = new Map(), en = false) {
  const names = resolveSideChoices(tier, sideItems)
    .items.filter((item) => item.public)
    .map((item) => escape(en ? item.nameEn : item.nameTh))
    .filter(Boolean);
  if (!names.length) return '';
  const label = escape(en ? tier.sideChoiceLabelEn || tier.sideChoiceLabelTh : tier.sideChoiceLabelTh || tier.sideChoiceLabelEn);
  return `<p class="tier-side-choices">${label ? `${label}: ` : ''}<span>${names.join(' · ')}</span></p>`;
}

// The sales sentence about how the pairing works. Shown even when no side has
// been prepared yet, because the mechanic is the product.
function sideChoiceNote(tier, en) {
  const note = en ? tier.sideChoiceNoteEn || tier.sideChoiceNoteTh : tier.sideChoiceNoteTh || tier.sideChoiceNoteEn;
  return note ? `<p class="tier-side-note">${escape(note)}</p>` : '';
}

function launchNote(tier, en) {
  const note = en ? tier.launchNoteEn || tier.launchNoteTh : tier.launchNoteTh || tier.launchNoteEn;
  return note ? `<p class="tier-launch-note">${escape(note)}</p>` : '';
}

// The price cell never shows a number that no published set backs.
function priceCell(context, tier, en) {
  const floor = context.floors[tier.id];
  if (!floor) {
    // A tier that is still being prepared must not read as orderable. Say what
    // is happening and invite the customer to be told when it opens.
    if (isLaunching(tier, floor)) {
      return `<p class="tier-price tier-price-soon">${en ? 'Launching soon' : 'กำลังเตรียมเปิดตัว'}</p>`
        + launchNote(tier, en);
    }
    // No published set backs this tier yet. We still take the order, so the
    // customer is told what happens next instead of being told what the
    // database is missing.
    return `<p class="tier-price tier-price-ask">${en ? 'Ask us about this set' : 'สอบถามรายละเอียดชุดอาหาร'}</p>`
      + `<p class="tier-price-note">${en
        ? 'No set is listed here yet, but we can build this tier to your order.'
        : 'ระดับนี้ยังไม่มีชุดที่แสดงอยู่ในหน้านี้ แต่เรารับจัดชุดตามออเดอร์ได้ครับ'}</p>`;
  }
  return `<p class="tier-price">${en ? `From ${money(floor.priceFrom)} THB` : `เริ่ม ${money(floor.priceFrom)} บาท`}</p>`
    + `<p class="tier-price-note">${en
      ? 'Food only, per box.'
      : `ค่าอาหารต่อกล่อง เช่น ${escape(floor.sourceName)}`}</p>`;
}

function membersNote(context, tier, en) {
  const count = context.members[tier.id].length;
  if (!count) return en ? '—' : '—';
  return en
    ? `${count} option${count === 1 ? '' : 's'} in this tier`
    : `เลือกได้ ${count} แบบในระดับนี้`;
}

export function renderTierTable({ rules, sets, overrides = {}, en = false }) {
  const context = tierContext(rules, sets, sideItemsFromPlanner(overrides));
  const line = lineUrl(rules, { medium: 'organic', content: `mealbox_tiers_${en ? 'en' : 'th'}` });
  const rows = context.tiers.map((tier) => {
    const floor = context.floors[tier.id];
    const launching = isLaunching(tier, floor);
    // A launching tier invites interest; it must not offer an order path that
    // cannot be honoured yet.
    const cta = floor
      ? `<a class="tier-link" href="${tierAnchorHref(en, tier.id)}">${en ? 'See the sets in this tier' : 'ดูชุดของระดับนี้'}</a>`
      : `<a class="tier-link tier-link-line" href="${line}" target="_blank" rel="noopener noreferrer">${launching
        ? (en ? 'Tell me when it opens' : 'แจ้งให้ผมทราบเมื่อเปิด')
        : (en ? 'Let EED build this tier' : 'ให้ EED ช่วยจัดชุดระดับนี้')}</a>`;
    return [
      `<tr id="${tierAnchorId(tier.id)}">`,
      // nameTh already opens with the English name on Thai pages, so a second
      // English line would read like a database dump — keep the hook, drop dup.
      `<th scope="row"><span class="tier-name">${name(tier, en)}</span>`,
      `<span class="tier-name-en"></span>`,
      `<span class="tier-meta">${escape(membersNote(context, tier, en))}</span></th>`,
      `<td>${priceCell(context, tier, en)}</td>`,
      `<td>${sellingPoint(tier, en)}${boxFormatLine(tier, en)}${sideChoiceNote(tier, en)}${sideChoiceLine(tier, context.sideItems, en)}</td>`,
      `<td>${bestFor(tier, en)}</td>`,
      `<td>${cta}</td>`,
      '</tr>',
    ].join('');
  }).join('\n');
  const start = en ? 'MEALBOX-TIERS:EN' : 'MEALBOX-TIERS:TH';
  return [
    `<!-- BUSINESS-RULES:${start} -->`,
    '<section class="section mealbox-tiers" aria-labelledby="mealbox-tiers-heading">',
    '<div class="container">',
    `<div class="section-label">${en ? 'Meal-box tiers' : 'ระดับข้าวกล่อง'}</div>`,
    `<h2 id="mealbox-tiers-heading">${en ? 'Pick the tier that fits your event' : 'เลือกระดับข้าวกล่องให้เหมาะกับงานของคุณ'}</h2>`,
    `<p class="tier-intro">${en
      ? 'For meetings, training days or a full staff meal, Classic is the easiest budget to control. For client events choose Signature, and for VIP executives or a board choose Executive Premium. All three tiers carry the same halal standard.'
      : 'ถ้าเป็นประชุม อบรม หรือสั่งพนักงานจำนวนมาก Classic คุมงบง่ายที่สุด ถ้าเป็นงานรับรองลูกค้าเลือก Signature และถ้าเป็นผู้บริหาร VIP หรือคณะกรรมการ Executive Premium จะเหมาะกว่า ทั้งสามระดับใช้มาตรฐานฮาลาลเดียวกัน'}</p>`,
    '<div class="tier-table-wrap">',
    '<table class="tier-table">',
    '<thead><tr>',
    `<th scope="col">${en ? 'Tier' : 'ระดับ'}</th>`,
    `<th scope="col">${en ? 'Starting price per box' : 'ราคาเริ่มต้นต่อกล่อง'}</th>`,
    `<th scope="col">${en ? 'What you get' : 'ช่วยคุณได้อะไร'}</th>`,
    `<th scope="col">${en ? 'Which event it suits' : 'เหมาะงานแบบไหน'}</th>`,
    `<th scope="col">${en ? 'What to do next' : 'สนใจระดับนี้ทำอย่างไร'}</th>`,
    '</tr></thead>',
    `<tbody>\n${rows}\n</tbody>`,
    '</table>',
    '</div>',
    `<p class="tier-note">${en
      ? 'Starting prices are food only, per box. Delivery and any extra service are quoted with your order. Every order is placed over LINE.'
      : 'ราคาเริ่มต้นเป็นค่าอาหารต่อกล่อง ค่าจัดส่งและบริการเพิ่มเติมแจ้งในใบเสนอราคา ทุกออเดอร์สั่งผ่าน LINE'}</p>`,
    '</div>',
    '</section>',
    `<!-- /BUSINESS-RULES:${start} -->`,
  ].join('\n');
}

export function renderTierCards({ rules, sets, overrides = {}, en = false }) {
  const context = tierContext(rules, sets, sideItemsFromPlanner(overrides));
  const line = lineUrl(rules, { medium: 'organic', content: `mealbox_tier_cards_${en ? 'en' : 'th'}` });
  const cards = context.tiers.map((tier) => {
    const floor = context.floors[tier.id];
    const launching = isLaunching(tier, floor);
    const source = floor
      ? context.members[tier.id].find((set) => set.id === floor.sourceId)
      : null;
    const image = source?.image
      // English pages live one folder down, so their assets need the parent path.
      ? `<img class="tier-card-img" src="${escape((en ? '../' : '') + source.image)}" alt="${escape(`${name(tier, en)} — EED HALAL`)}" width="320" height="200" loading="lazy">`
      : '';
    const price = floor
      ? `<p class="tier-card-price">${en ? `From ${money(floor.priceFrom)} THB` : `เริ่ม ${money(floor.priceFrom)} บาท`}</p>`
      : launching
        ? `<p class="tier-card-price tier-card-price-soon">${en ? 'Launching soon' : 'กำลังเตรียมเปิดตัว'}</p>`
        : `<p class="tier-card-price tier-card-price-ask">${en ? 'Ask us about this set' : 'สอบถามรายละเอียดชุดอาหาร'}</p>`;
    const cta = floor
      ? `<a class="btn btn-outline tier-card-btn" href="${tierAnchorHref(en, tier.id)}">${en ? 'See the sets in this tier' : 'ดูชุดของระดับนี้'}</a>`
      : `<a class="btn btn-primary tier-card-btn" href="${line}" target="_blank" rel="noopener noreferrer">${launching
        ? (en ? 'Tell me when it opens' : 'แจ้งให้ผมทราบเมื่อเปิด')
        : (en ? 'Let EED build this tier' : 'ให้ EED ช่วยจัดชุดระดับนี้')}</a>`;
    return [
      `<article class="tier-card" id="${tierAnchorId(tier.id)}-card">`,
      image,
      `<h3 class="tier-card-name">${name(tier, en)}</h3>`,
      price,
      // What it is and why it matters comes before the availability note, so the
      // reader learns what they would be buying before they read "not yet".
      `<p class="tier-card-point">${sellingPoint(tier, en)}</p>`,
      boxFormatLine(tier, en),
      sideChoiceNote(tier, en),
      sideChoiceLine(tier, context.sideItems, en),
      `<p class="tier-card-for">${en ? 'Best for' : 'เหมาะกับ'} ${bestFor(tier, en)}</p>`,
      launching ? launchNote(tier, en) : '',
      cta,
      '</article>',
    ].join('');
  }).join('\n');
  const start = en ? 'MEALBOX-TIER-CARDS:EN' : 'MEALBOX-TIER-CARDS:TH';
  return [
    `<!-- BUSINESS-RULES:${start} -->`,
    '<section class="section mealbox-tier-cards" aria-labelledby="mealbox-tier-cards-heading">',
    '<div class="container">',
    `<div class="section-label">${en ? 'Meal-box tiers' : 'ระดับข้าวกล่อง'}</div>`,
    `<h2 id="mealbox-tier-cards-heading">${en ? 'Three halal tiers, from meeting boxes to executive sets' : 'ข้าวกล่องฮาลาล 3 ระดับ ตั้งแต่งานประชุมถึงงานผู้บริหาร'}</h2>`,
    '<div class="tier-cards">',
    cards,
    '</div>',
    `<p class="tier-note">${en
      ? 'Starting prices are food only, per box. Delivery and any extra service are quoted with your order.'
      : 'ราคาเริ่มต้นเป็นค่าอาหารต่อกล่อง ค่าจัดส่งและบริการเพิ่มเติมแจ้งในใบเสนอราคา'}</p>`,
    '</div>',
    '</section>',
    `<!-- /BUSINESS-RULES:${start} -->`,
  ].join('\n');
}

// Admin release preview: price plus the set and ID that produced it, so the
// owner can check the number before it goes public, and see เดิม -> ใหม่ when it
// moves.
export function renderAdminTierTable({ rules, sets, sideItems = new Map(), previous = null }) {
  const context = tierContext(rules, sets, sideItems);
  const before = previous ? computeTierFloors(previous).floors : null;
  const rows = context.tiers.map((tier) => {
    const floor = context.floors[tier.id];
    const old = before ? before[tier.id] : null;
    const launching = isLaunching(tier, floor);
    const price = floor
      ? `${money(floor.priceFrom)} บาท`
      : launching ? 'กำลังเตรียมเปิดตัว (ยังไม่ประกาศราคา)' : 'ยังไม่มีชุดเปิดขาย';
    const source = floor ? `${floor.sourceName} (ID ${floor.sourceId})` : '—';
    const change = !before
      ? ''
      : old && floor && old.priceFrom !== floor.priceFrom
        ? `${money(old.priceFrom)} → ${money(floor.priceFrom)} บาท`
        : old && !floor
          ? `${money(old.priceFrom)} → ยังไม่มีชุดเปิดขาย`
          : floor && !old
            ? `ยังไม่มีราคา → ${money(floor.priceFrom)} บาท`
            : 'ไม่เปลี่ยน';
    const format = tier.boxFormatTh ? `<br><span class="tier-admin-format">${escape(tier.boxFormatTh)}</span>` : '';
    // Show the owner exactly which side items will be named on the web, and
    // which of them still have no confirmed price.
    const { items, unresolved } = resolveSideChoices(tier, sideItems);
    const sides = items.length
      ? `<br><span class="tier-admin-format">อาหารรอง: ${items.map((item) => escape(item.nameTh)).join(' · ')}</span>`
      : '';
    const pending = items.filter((item) => item.priceAdjustment === null).map((item) => item.id);
    const sideNote = unresolved.length || pending.length
      ? `<br><span class="tier-admin-format">${[
        unresolved.length ? `อ้าง id ที่ยังไม่มี: ${unresolved.join(', ')}` : '',
        pending.length ? `ยังไม่ยืนยันราคาเพิ่ม: ${pending.join(', ')}` : '',
      ].filter(Boolean).join(' · ')}</span>`
      : '';
    return `<tr><th scope="row">${escape(tier.nameTh)}<br><span class="tier-admin-en">${escape(tier.nameEn)}</span>${format}${sides}${sideNote}</th>`
      + `<td>${escape(price)}</td><td>${escape(source)}</td>`
      + `<td>${context.members[tier.id].length}</td><td>${escape(change)}</td></tr>`;
  }).join('');
  return [
    '<div class="tier-admin">',
    '<p><strong>ระดับข้าวกล่องที่จะขึ้นเว็บ</strong> <span class="cp-sub">· ราคาเริ่มต้นคำนวณจากชุดที่เปิดขายและแสดงบนเว็บเท่านั้น</span></p>',
    '<table class="tier-admin-table"><thead><tr>',
    '<th scope="col">ระดับ</th><th scope="col">ราคาเริ่มต้น</th><th scope="col">ชุดที่เป็นที่มาของราคา</th>',
    `<th scope="col">ชุดที่เปิดขาย</th><th scope="col">เทียบกับที่เผยแพร่อยู่</th>`,
    '</tr></thead>',
    `<tbody>${rows}</tbody></table>`,
    '</div>',
  ].join('');
}