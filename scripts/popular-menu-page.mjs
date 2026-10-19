// EED HALAL - static menu block for popular-menu.html (SEO / GEO / AEO).
//
// WHY THIS EXISTS
// popular-menu.html used to render its catalogue with JavaScript only:
// #pm-grid and #pm-list shipped empty, so any crawler that does not execute JS
// (many AI answer engines and preview bots included) saw a page with zero
// menus. The menu names are the most searched content on the site, so this
// generator bakes them into the HTML as real markup.
//
// SINGLE SOURCE OF TRUTH
// Everything here is derived from the two published artifacts
// (data/planner-overrides.json + js/menu-data.js) through the same pipeline
// that produces them, so the static block cannot drift from the catalogue.
// js/popular-menu.js still renders the interactive version; this markup is the
// crawlable/no-JS layer underneath it.
//
// PRICES ARE SHOWN, AND THEY COME FROM THE CATALOGUE
// The owner asked for the menu page to show prices, so each card/row states the
// per-box figure the planner publishes. Two rules keep that honest:
//  - the figure is copied from data/planner-overrides.json, never typed here,
//    so a price change in the catalogue reaches this page on the next publish;
//  - a dish the shop cannot quote from its own data (quoteOnly[]) shows no
//    figure at all, because there is none to publish.
// Orders are still placed over LINE: the site has no ordering flow, it is a
// catalogue. Showing the price removes the "how much?" question, not the
// "place the order" step.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseMenuDataJs } from './menu-central.mjs';
import {
  computeTierFloors,
  resolveSideChoices,
  setsFromPlanner,
  sideItemsFromPlanner,
  tierDefinitions,
} from './mealbox-tiers.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const GRID_START = '<!-- MENU:GRID:START -->';
const GRID_END = '<!-- MENU:GRID:END -->';
const LIST_START = '<!-- MENU:LIST:START -->';
const LIST_END = '<!-- MENU:LIST:END -->';
const TOPPINGS_START = '<!-- MENU:TOPPINGS:START -->';
const TOPPINGS_END = '<!-- MENU:TOPPINGS:END -->';
const SECOND_DISH_START = '<!-- MENU:SECOND-DISH:START -->';
const SECOND_DISH_END = '<!-- MENU:SECOND-DISH:END -->';
const DESSERTS_START = '<!-- MENU:DESSERTS:START -->';
const DESSERTS_END = '<!-- MENU:DESSERTS:END -->';
const HEADCOUNT_START = '<!-- MENU:HEADCOUNT:START -->';
const HEADCOUNT_END = '<!-- MENU:HEADCOUNT:END -->';
const JSONLD_START = '<!-- MENU:JSONLD:START -->';
const JSONLD_END = '<!-- MENU:JSONLD:END -->';
const PAGE = 'popular-menu.html';
const LINE_URL = 'https://lin.ee/CfvqJTd';

/**
 * A LINE deep link with the message already typed in.
 *
 * WHY: the customer clicks "สั่งเมนูนี้" while looking at one specific dish. If
 * the link opens an empty chat, they have to remember the name, find the app and
 * type it by hand — and that is exactly where a catalogue order is lost. Naming
 * the dish they were looking at turns the click into a message they only have to
 * send.
 *
 * The fill is a convenience, not a dependency: a client that ignores the
 * parameter still opens the same chat, just without the text, so the link can
 * never break.
 */
function lineHref(text) {
  const message = String(text || '').trim();
  return message ? `${LINE_URL}?text=${encodeURIComponent(message)}` : LINE_URL;
}

// What the team actually needs back to quote: the dish, how many boxes, when it
// is needed and where it goes. The blanks stay in the message on purpose — the
// customer fills three short gaps instead of writing the order from scratch.
function orderMessage(item) {
  const price = item.price == null ? '' : ` ${item.price} บาท/กล่อง`;
  return `สนใจเมนู ${item.name}${price} จำนวน ___ กล่อง วันที่ ___ จุดส่ง ___`;
}

const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;');

// Mirrors hasDishPhoto() in js/popular-menu.js: a brand logo is not a dish
// photo, so those menus render as compact rows instead of image cards. The
// static split must match or the page would visibly reflow when JS runs.
function hasDishPhoto(menu) {
  const src = String(menu.image || '').replace(/^\.\.\//, '').replace(/^\//, '');
  return Boolean(src) && !/logo\.(png|jpg|jpeg|webp)$/i.test(src);
}

function imageSrc(menu) {
  return String(menu.image || '').replace(/^\.\.\//, '').replace(/^\//, '');
}

/**
 * Merge the published planner with EED_MENUS into one ordered catalogue.
 * Display order always comes from menu-data.js (the pipeline never reorders
 * it). Availability comes from the planner: deleted[] is gone entirely,
 * quoteOnly[] is served but not orderable.
 */
export function buildCatalogue(overrides, menus) {
  const hidden = new Set((overrides.deleted || []).map(String));
  const quoteOnly = new Set((overrides.quoteOnly || []).map(String));
  // The owner's own "ขายดี" list, edited in the admin menu central. It is a
  // business fact like any other: this script only reads it, never picks a dish.
  const popular = new Set((overrides.popular || []).map(String));
  const seen = new Set();
  const items = [];
  for (const menu of menus) {
    const id = String(menu.id);
    if (menu == null || menu.id == null || hidden.has(id) || seen.has(id)) continue;
    seen.add(id);
    items.push({
      id,
      name: String(overrides.names?.[id] ?? menu.name ?? ''),
      desc: String(menu.desc || ''),
      image: imageSrc(menu),
      tier: String(overrides.tiers?.[id] ?? menu.tier ?? 'classic'),
      orderable: !quoteOnly.has(id),
      // Per-box figure straight from the published catalogue. quoteOnly dishes
      // are served but not quotable from our own data, so they carry no price.
      price: quoteOnly.has(id) ? null : cataloguePrice(overrides.prices?.[id]),
      // Per-menu minimum, straight from the published catalogue: the planner's
      // mins[] wins and menu-data.js is the fallback. It is a published business
      // fact (the standard menu minimum), never a figure this script invents.
      minPerMenu: catalogueMin(overrides.mins?.[id] ?? menu.minPerMenu),
      popular: popular.has(id),
      // The owner's own words for the tag on the photo. Empty means "no tag",
      // and the best-seller list then speaks for itself.
      badge: String(overrides.badges?.[id] ?? menu.badge ?? ''),
    });
  }
  return items;
}

function cataloguePrice(raw) {
  const price = Number(raw);
  return Number.isFinite(price) && price > 0 ? price : null;
}

function catalogueMin(raw) {
  const min = Number(raw);
  return Number.isInteger(min) && min >= 1 ? min : null;
}

// Per-box price line. The unit is stated so a bare number is never ambiguous,
// and the note keeps the page honest about what moves the final figure.
function priceHtml(item, extraClass) {
  if (item.price == null) return '';
  return `<p class="${extraClass}">${item.price} บาท<span class="pm-price-unit">/ กล่อง</span></p>`;
}

// Per-menu minimum, in the words a customer asks it: how many boxes does one
// dish need before EED can cook it? The figure comes from the catalogue
// (standardMenuMinimum), so this line can only ever repeat a minimum the owner
// already published — it never rounds, guesses or invents one. A dish carrying
// no valid minimum simply adds no line.
function minHtml(item, extraClass) {
  if (item.minPerMenu == null) return '';
  return `<p class="${extraClass}">ขั้นต่ำ ${item.minPerMenu} กล่อง</p>`;
}

// The product level is the only label a card carries (data/business-rules.json ->
// services.mealBox.tiers). There is no category: the tier is what the customer
// filters by, what the calculator groups by and what the API sorts on.
const TIER_LABELS = {
  classic: 'Classic',
  signature: 'Signature',
  executive: 'Executive',
};

function tierLabel(tier) {
  return TIER_LABELS[String(tier)] || 'Classic';
}

// The tag pinned to the photo. The owner's own wording comes first — they type
// it per dish in the admin ("ใหม่", "พรีเมียม", "+ ผลไม้", "⭐ Best Seller") —
// and only when they leave it blank does the best-seller list say it instead.
export function tagText(item) {
  const own = String(item.badge || '').trim();
  if (own) return own;
  return item.popular ? 'ขายดี' : '';
}

// The same tag for the English page. A Thai word must never reach an English
// visitor, so a badge the owner wrote in Thai is skipped here — and because
// this page's grid IS the "Popular Menu" section, there is nothing useful to
// say in its place either. (An English badge is a translation job, not
// something this generator may invent.)
export function tagTextEn(item) {
  const own = String(item.badge || '').trim();
  return own && !/[\u0E00-\u0E7F]/.test(own) ? own : '';
}

/**
 * The tag pinned to the photo, and which claim it is allowed to make.
 *
 * Gold belongs to the published best-seller list and to nothing else: gold is a
 * signal the customer reads as "this is what offices order most", so it may only
 * sit on a dish the owner actually put on that list. A per-dish note the owner
 * typed ("ใหม่", "พรีเมียม", "+ ผลไม้") is useful but it is not a popularity
 * claim, so it gets the quiet tag instead of borrowing the gold one.
 */
function flagHtml(item) {
  const text = tagText(item);
  if (!text) return '';
  return `<span class="pm-flag pm-flag-${item.popular ? 'best' : 'own'}">${escapeHtml(text)}</span>`;
}

function cardHtml(item) {
  const photo = hasDishPhoto(item)
    ? `<img class="pm-photo" src="${escapeHtml(item.image)}" alt="${escapeHtml(item.name)}" loading="lazy">`
    : `<div class="pm-photo-placeholder" aria-hidden="true"><span>${escapeHtml(item.name.trim().charAt(0) || '•')}</span></div>`;
  // The tag rides on the photo so the eye finds the dish people actually order
  // before it reads anything else. The words are the owner's (see tagText) and
  // the colour only makes the popularity claim the owner actually backed.
  const bestSeller = flagHtml(item);
  // Every dish is treated identically here. There is no online ordering on this
  // site at all: it is a catalogue, and every order is placed over LINE. The
  // cost gate decides whether the SHOP can quote a dish from its own data, not
  // whether the customer can buy it, so a quoteOnly dish is listed without a
  // figure rather than with one we cannot stand behind.
  return ''
    + `<article class="pm-card" id="menu-${escapeHtml(item.id)}" data-menu-id="${escapeHtml(item.id)}" data-tier="${escapeHtml(item.tier || 'classic')}">`
    + bestSeller
    + photo
    + '<div class="pm-card-body">'
    + `<p class="pm-card-tier">${escapeHtml(tierLabel(item.tier))}</p>`
    + `<h3 class="pm-card-name">${escapeHtml(item.name)}</h3>`
    + (item.desc ? `<p class="pm-card-desc">${escapeHtml(item.desc)}</p>` : '')
    + priceHtml(item, 'pm-card-price')
    + minHtml(item, 'pm-card-min')
    + `<a class="pm-btn pm-btn-outline pm-card-cta" href="${lineHref(orderMessage(item))}" target="_blank" rel="noopener noreferrer" data-track-event="lead_line_click" data-track-section="popular_menu" data-track-source="popular_menu_card">สั่งเมนูนี้ <span aria-hidden="true">↗</span></a>`
    + '</div>'
    + '</article>';
}

function rowHtml(item) {
  return ''
    + `<div class="pm-row" id="menu-${escapeHtml(item.id)}" data-menu-id="${escapeHtml(item.id)}" data-tier="${escapeHtml(item.tier || 'classic')}">`
    + '<div class="pm-row-text">'
    + `<p class="pm-row-tier">${escapeHtml(tierLabel(item.tier))}</p>`
    + `<p class="pm-row-name">${escapeHtml(item.name)}</p>`
    + priceHtml(item, 'pm-row-price')
    + minHtml(item, 'pm-row-min')
    + '</div>'
    + '<div class="pm-row-actions">'
    + `<a class="pm-btn pm-btn-outline pm-row-cta" href="${lineHref(orderMessage(item))}" target="_blank" rel="noopener noreferrer" data-track-event="lead_line_click" data-track-section="popular_menu" data-track-source="popular_menu_row">สั่งเมนูนี้ <span aria-hidden="true">↗</span></a>`
    + '</div>'
    + '</div>';
}

// A dish with no photo is listed by name instead of getting an empty card —
// but it still carries its price, its minimum and the same LINE order button,
// because a customer who reads it must be able to act on it exactly like any
// other dish on the page.
function nameOnlyHtml(item) {
  return `<div class="pm-name-only" id="menu-${escapeHtml(item.id)}" data-menu-id="${escapeHtml(item.id)}" data-tier="${escapeHtml(item.tier || 'classic')}">`
    + `<span class="pm-name-only-text">${escapeHtml(item.name)}</span>`
    + priceHtml(item, 'pm-row-price')
    + minHtml(item, 'pm-row-min')
    + `<a class="pm-btn pm-btn-outline pm-card-cta" href="${lineHref(orderMessage(item))}" target="_blank" rel="noopener noreferrer" data-track-event="lead_line_click" data-track-section="popular_menu" data-track-source="popular_menu_card">สั่งเมนูนี้ <span aria-hidden="true">↗</span></a>`
    + '</div>';
}

export function renderStaticMenu(items) {
  const photos = items.filter(hasDishPhoto).map(cardHtml).join('\n      ');
  const rows = items.filter((item) => !hasDishPhoto(item) && item.image).map(rowHtml).join('\n      ');
  const nameOnly = items.filter((item) => !item.image).map(nameOnlyHtml).join('\n      ');
  return { grid: photos, list: rows + (rows && nameOnly ? '\n      ' : '') + nameOnly };
}

/**
 * A separate JSON-LD block for the catalogue, so the hand-maintained block
 * above is never reformatted. A JSON-LD script may contain JSON only, so this
 * is a whole extra <script type="application/ld+json"> element rather than a
 * marked-up node inside the existing @graph. Multiple ld+json blocks are
 * valid and Google merges them.
 *
 * Per-box price: each dish carries an `offers` block taken from the published
 * catalogue, so the figure a customer reads in the markup is the same figure
 * the structured data publishes. A dish with no quotable price (quoteOnly[])
 * simply has no offer, rather than a fabricated one.
 *
 * The product level travels as an explicit `additionalProperty` rather than
 * `category`. A category would be a dish type (ข้าวผัด / เส้น / อินเดีย), and the
 * catalogue no longer holds one, so asserting `category: "Classic"` would tell a
 * search engine something false about the dish. The dish type is already in the
 * dish name; the level is carried honestly as a named property.
 */
export function renderItemListJsonLd(items) {
  const itemList = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    '@id': 'https://eedhalal.com/popular-menu.html#itemlist',
    name: 'เมนูข้าวกล่องฮาลาล EED HALAL',
    numberOfItems: items.length,
    itemListOrder: 'https://schema.org/ItemListUnordered',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      item: {
        '@type': 'Menu',
        '@id': `https://eedhalal.com/popular-menu.html#menu-${item.id}`,
        name: item.name,
...(item.desc ? { description: item.desc } : {}),
...(item.image ? { image: `https://eedhalal.com/${item.image}` } : {}),
...(item.price != null
          ? {
            offers: {
              '@type': 'Offer',
              price: item.price.toFixed(2),
              priceCurrency: 'THB',
              availability: 'https://schema.org/InStock',
              url: `https://eedhalal.com/popular-menu.html#menu-${item.id}`,
            },
          }
          : {}),
        additionalProperty: {
          '@type': 'PropertyValue',
          name: 'ระดับสินค้า',
          value: tierLabel(item.tier),
        },
      },
    })),
  };
  return `<script type="application/ld+json">\n${JSON.stringify(itemList, null, 2)}\n</script>`;
}

function replaceBlock(html, start, end, body) {
  const from = html.indexOf(start);
  const to = html.indexOf(end);
  if (from === -1 || to === -1 || to < from) {
    throw new Error(`popular-menu.html is missing the ${start} ... ${end} markers`);
  }
  return html.slice(0, from + start.length) + '\n' + body + '\n' + html.slice(to);
}

// ─── How much will it cost for my headcount? ───────────────────────────────
// A buying team does not think in dishes, it thinks in people and in one number
// it has to take to its boss. Thirty cards of per-box prices answer neither, so
// this block answers both at once: pick the headcount, read the total, and the
// link opens LINE with that headcount already typed.
//
// NOTHING HERE IS A NEW BUSINESS FACT. The per-box figure is the published
// Classic floor (the cheapest open Classic set), the totals are that figure
// multiplied by the headcount, and the smallest headcount is the published
// order minimum. A price change in the catalogue therefore reaches this block on
// the next publish, exactly like the tier table. The button opens LINE, because
// a budget is not an order yet: the shop still has to check the headcount, the
// date and the delivery point before anything is cooked.
const HEADCOUNT_STEPS = [20, 30, 50, 100, 200];

const HEADCOUNT_COPY = {
  th: {
    label: 'งบคร่าวๆ ตามจำนวนคน',
    head: 'มีกี่คน ลองดูงบคร่าวๆ ได้เลย',
    sub: 'กดจำนวนคนที่ใกล้กับงานของคุณ เราคิดให้จากราคาจริงของเมนูที่ขายอยู่ตอนนี้ แล้วพาไปที่ LINE พร้อมข้อความเตรียมไว้ให้ ส่งได้เลยครับ',
    unit: 'คน',
    from: 'เริ่ม',
    line: (n, total) => `สนใจสั่งข้าวกล่อง ${n} กล่อง (${n} คน) งบราว ๆ ${total} บาท ใช้วันที่ ___ ส่งที่ ___ ช่วยแนะนำเมนูให้หน่อยนะครับ`,
    note: (price) => `ตัวเลขคิดจากระดับ Classic ที่เริ่ม ${price} บาทต่อกล่อง นับเฉพาะค่าอาหารนะครับ ค่าส่งกับบริการเพิ่มเติมเราจะแจ้งไว้ในใบเสนอราคา`,
    bigger: 'งาน 30 คนขึ้นไปที่อยากให้มีทีมไปดูแลหน้างานด้วย ลองดู ',
    linkCatering: 'จัดเลี้ยงฮาลาล',
    linkBuffet: 'บุฟเฟต์ฮาลาล',
    tail: ' ได้เลยนะครับ',
  },
  en: {
    label: 'A quick estimate by headcount',
    head: "How many people? Here's a rough budget",
    sub: "Tap the headcount closest to your event. We work it out from the prices we're selling at right now, then open LINE with the message already written. Just hit send.",
    unit: 'pax',
    from: 'From',
    line: (n, total) => `Hi, I'd like ${n} boxes (${n} pax), roughly ${total} THB for food. Date: ___, delivery to: ___. Could you suggest some menus?`,
    note: (price) => `Based on Classic, starting at ${price} THB a box. That's food only; delivery and any extras come in your quote.`,
    bigger: 'Planning for 30 guests or more and want a team on site? Take a look at ',
    linkCatering: 'Halal Catering',
    linkBuffet: 'Halal Buffet',
    tail: '.',
  },
};

const money = (value) => Number(value).toLocaleString('en-US');

function headcountSteps(minimumOrder) {
  const min = Number.isFinite(Number(minimumOrder)) && Number(minimumOrder) >= 1
    ? Number(minimumOrder)
    : 10;
  return [...new Set([min, ...HEADCOUNT_STEPS])].filter((n) => n >= min);
}

function renderHeadcountPicker(floor, minimumOrder, en) {
  const copy = en ? HEADCOUNT_COPY.en : HEADCOUNT_COPY.th;
  // No published Classic set means no figure to multiply, so the block keeps its
  // buttons and drops the numbers rather than showing a total nobody can quote.
  const priceFrom = floor?.priceFrom ?? null;
  const unit = en ? 'THB' : 'บาท';
  const chips = headcountSteps(minimumOrder).map((n) => {
    const total = priceFrom == null ? null : money(priceFrom * n);
    const message = copy.line(n, total ?? '');
    const amount = total == null
      ? ''
      : `<span class="pm-quickpick-amount">${copy.from} ${total} ${unit}</span>`;
    return `          <a class="pm-quickpick-chip" href="${lineHref(message)}" target="_blank" rel="noopener noreferrer" data-track-event="lead_line_click" data-track-section="popular_menu" data-track-source="popular_menu_headcount">`
      + `<span class="pm-quickpick-people">${n} ${copy.unit}</span>${amount}`
      + '<span aria-hidden="true">💬</span></a>';
  }).join('\n');
  if (!chips) return '';
  const cateringHref = en ? '/en/catering.html' : '/catering.html';
  const buffetHref = en ? '/en/buffet.html' : '/buffet.html';
  return [
    '<section class="section pm-quickpick" aria-labelledby="pm-quickpick-heading">',
    '<div class="container">',
    `<div class="section-label">${copy.label}</div>`,
    `<h2 id="pm-quickpick-heading">${copy.head}</h2>`,
    `<p class="pm-quickpick-sub">${copy.sub}</p>`,
    '<div class="pm-quickpick-row">',
    chips,
    '</div>',
    priceFrom == null ? '' : `<p class="pm-quickpick-note">${copy.note(money(priceFrom))}</p>`,
    `<p class="pm-quickpick-bigger">${copy.bigger}<a href="${cateringHref}">${copy.linkCatering}</a> ${en ? 'and' : 'และ'} <a href="${buffetHref}">${copy.linkBuffet}</a>${copy.tail}</p>`,
    '</div>',
    '</section>',
  ].join('\n');
}

/** Build the full page with the static block injected from published data. */
export function renderPopularMenuPage(html, { items, toppings, secondDish, desserts, classicFloor, minimumOrder }) {
  const { grid, list } = renderStaticMenu(items);
  const toppingsHtml = renderToppingsList(toppings);
  let out = replaceBlock(html, GRID_START, GRID_END, grid);
  out = replaceBlock(out, LIST_START, LIST_END, list);
  out = replaceBlock(out, TOPPINGS_START, TOPPINGS_END, toppingsHtml);
  out = replaceBlock(out, SECOND_DISH_START, SECOND_DISH_END, renderSecondDishList(secondDish, false));
  out = replaceBlock(out, DESSERTS_START, DESSERTS_END, renderDessertsList(desserts, false));
  out = replaceBlock(out, HEADCOUNT_START, HEADCOUNT_END, renderHeadcountPicker(classicFloor, minimumOrder, false));
  out = replaceBlock(out, JSONLD_START, JSONLD_END, renderItemListJsonLd(items));
  return out;
}

// The names a guest can pick as their second dish. Empty output removes the
// section: a promise with no dishes behind it is worse than no section.
//
// The whole block is generated on purpose. A hand-written section would sit on
// the page with an empty list whenever the owner clears sideChoices, which is
// the one state where this promise must not be made. Copy lives here so the
// Thai and English versions can be read side by side; keep them equivalent in
// meaning and tone, not word for word.
const SECOND_DISH_COPY = {
  th: {
    head: 'ให้แขกเลือกอาหารเมนูที่ 2 เองได้',
    sub: 'กล่องเดียวได้สองอย่าง ไม่ต้องเดาว่าแขกชอบอะไร',
    body: 'Signature หนึ่งกล่องมีข้าว อาหารหลัก 1 อย่าง อาหารเมนูที่ 2 อีก 1 อย่าง และผัก ใส่ในกล่อง 4 ช่อง บอกมาเลยว่าอาหารหลักที่ชอบคืออะไร แล้วเลือกอาหารเมนูที่ 2 จากรายการนี้ เราจับคู่ให้เข้ากันเอง และส่งราคารวมทั้งกล่องให้ดูก่อนยืนยันออเดอร์ ไม่มีค่าเพิ่มโผล่มาทีหลังแน่นอนครับ',
    lead: 'อาหารเมนูที่ 2 ที่เลือกได้',
    cta: 'ให้ EED ช่วยจับคู่ให้',
  },
  en: {
    head: 'Let your guests pick the second dish',
    sub: "Two dishes in one box, so you don't have to guess what they'll like",
    body: "A Signature box holds rice, one main, a second dish and vegetables, all in four compartments. Tell us the main they'll enjoy, then pick the second dish from the list. We'll match the pair and send you the full box price before you confirm, with no surprise extras later.",
    lead: 'Second dishes you can choose',
    cta: 'Let EED match the dishes for me',
  },
};

function renderSecondDishList(secondDish, en) {
  const names = (Array.isArray(secondDish) ? secondDish : [])
    .map((item) => escapeHtml(String((en ? item?.nameEn : item?.nameTh) ?? '').trim()))
    .filter(Boolean);
  if (!names.length) return '';
  const copy = en ? SECOND_DISH_COPY.en : SECOND_DISH_COPY.th;
  const picks = names.map((name) => `              <li class="pm-pick">${name}</li>`).join('\n');
  return `        <div class="pm-second-dish" id="pm-second-dish">
          <h2 class="pm-subhead">${copy.head} <span>${copy.sub}</span></h2>
          <p class="pm-note">${copy.body}</p>
          <p class="pm-pick-lead">${copy.lead}</p>
          <ul class="pm-pick-list">
${picks}
          </ul>
          <a class="pm-btn pm-btn-green" href="${LINE_URL}" target="_blank" rel="noopener noreferrer" data-track-event="lead_line_click" data-track-section="popular_menu" data-track-source="popular_menu_second_dish">${copy.cta}</a>
        </div>`;
}

// Desserts are add-ons priced like toppings: the figure shown is the ADDITION
// to the box price, and an unconfirmed price says so instead of guessing.
const DESSERT_COPY = {
  th: {
    head: 'ขนมหวานปิดท้ายมื้อ',
    sub: 'ใส่กล่องแยกต่างหาก ไม่นับเป็นอาหารเมนูที่ 2 ของชุด Signature',
    note: 'เพิ่มได้กับทุกกล่องเลยครับ ราคาบวกเพิ่มจากราคากล่อง บอกทีมงานตอนสั่งได้เลย',
  },
  en: {
    head: 'Something sweet to finish',
    sub: 'Packed in its own box, not counted as the Signature second dish',
    note: 'Add it to any box. The price goes on top of the box price, so just tell us when you order.',
  },
};

function renderDessertsList(desserts, en) {
  const unit = en ? 'THB' : 'บาท';
  const rows = (Array.isArray(desserts) ? desserts : []).map((item) => {
    const name = escapeHtml(String((en ? item?.nameEn : item?.nameTh) ?? '').trim());
    if (!name) return '';
    const price = toppingPrice(item?.priceAdjustment);
    const amount = price == null
      ? `<span class="pm-topping-price pm-topping-price-none">${en ? 'Ask for the price' : 'สอบถามราคา'}</span>`
      : `<span class="pm-topping-price">+${price} ${unit}</span>`;
    const attr = price == null ? '' : ` data-price="${price}"`;
    return `            <li class="pm-topping"${attr}><span class="pm-topping-name">${name}</span>${amount}</li>`;
  }).filter(Boolean);
  if (!rows.length) return '';
  const copy = en ? DESSERT_COPY.en : DESSERT_COPY.th;
  return `        <div class="pm-toppings-section" id="pm-desserts">
          <h2 class="pm-subhead">${copy.head} <span>${copy.sub}</span></h2>
          <p class="pm-toppings-note">${copy.note}</p>
          <ul class="pm-toppings-list">
${rows.join('\n')}
          </ul>
        </div>`;
}

// Toppings are add-ons, so the figure shown is the ADDITION to the box price,
// never the box price itself. `data-price` lets the client-side renderer read
// the same figure back out of this markup when it cannot reach the planner, so
// a failed fetch never drops the amounts.
function toppingPrice(raw) {
  const price = Number(raw);
  return Number.isFinite(price) && price > 0 ? Math.round(price * 100) / 100 : null;
}

function renderToppingsList(toppings, en = false) {
  if (!Array.isArray(toppings) || !toppings.length) return '';
  const unit = en ? 'THB' : 'บาท';
  return toppings.map((t) => {
    const name = escapeHtml(String(t?.name ?? '').trim());
    if (!name) return '';
    const price = toppingPrice(t?.price);
    const amount = price == null
      ? '<span class="pm-topping-price pm-topping-price-none">สอบถามราคา</span>'
      : `<span class="pm-topping-price">+${price} ${unit}</span>`;
    const attr = price == null ? '' : ` data-price="${price}"`;
    return `            <li class="pm-topping"${attr}><span class="pm-topping-name">${name}</span>${amount}</li>`;
  }).filter(Boolean).join('\n');
}

export async function loadCatalogue(root = ROOT) {
  const overrides = JSON.parse(await readFile(path.join(root, 'data', 'planner-overrides.json'), 'utf8'));
  const menus = await parseMenuDataJs(await readFile(path.join(root, 'js', 'menu-data.js'), 'utf8'));
  const sideItems = sideItemsFromPlanner(overrides);
  // The Signature second dish is the one list the tier copy promises, so it is
  // read through the same resolver the pricing and the tier table use: an id in
  // business-rules.json can never name a dish the catalogue cannot answer for.
  const rules = await readRules(root);
  const signature = tierDefinitions(rules).find((tier) => tier.id === 'signature');
  const secondDish = signature
    ? resolveSideChoices(signature, sideItems).items
        .filter((item) => item.public)
        .map((item) => ({ nameTh: item.nameTh, nameEn: item.nameEn }))
    : [];
  // The headcount block multiplies the published Classic floor by the headcount,
  // so it reads the floor through the same price rule the tier table uses rather
  // than picking a number of its own.
  const classicFloor = computeTierFloors(setsFromPlanner(overrides)).floors.classic;
  return {
    items: buildCatalogue(overrides, menus),
    toppings: Array.isArray(overrides.toppings) ? overrides.toppings : [],
    secondDish,
    classicFloor,
    minimumOrder: Number(rules?.services?.mealBox?.minimumOrder) || 10,
    // Desserts live in the same sideItems array, tagged `kind: "dessert"`. They
    // are split out because they are a corned-box add-on, not a Signature dish.
    desserts: Array.isArray(overrides.sideItems)
      ? overrides.sideItems.filter((item) => item?.kind === 'dessert' && item.public !== false)
      : [],
  };
}

// business-rules.json is the source of truth for which dishes may sit in the
// Signature box. A missing or unreadable file must not empty the page: the
// section is simply left out, and the sync gate reports the real problem.
async function readRules(root) {
  try {
    return JSON.parse(await readFile(path.join(root, 'data', 'business-rules.json'), 'utf8'));
  } catch {
    return {};
  }
}

/* ───────────────────────── English menu page ─────────────────────────
 * en/popular-menu.html used to be maintained by hand, so it drifted away from
 * the Thai page without anything noticing: it listed the old 46-dish catalogue
 * under the dish categories we retired, and it carried its own prices. Both
 * language pages are now generated from the same catalogue, so they cannot
 * disagree about which dishes exist or what they cost.
 *
 * The catalogue stores Thai names only, so the English wording lives in
 * data/menu-copy-en.json (id -> { name, desc }). A live menu with no English
 * copy is a build error, not a silent gap: an English visitor must never find
 * a dish missing that the Thai page sells — and never find one under a Thai
 * name either, which is why a field that still holds Thai script counts as no
 * copy at all.
 *
 * That file feeds two outputs: this page's static markup, and
 * js/menu-data-en.js, the same English words in the shape the browser runtime
 * needs. See buildMenuDataEnJs for why the page cannot ship without the second.
 */
const PAGE_EN = 'en/popular-menu.html';
const EN_COPY_FILE = 'data/menu-copy-en.json';
const EN_RUNTIME_FILE = 'js/menu-data-en.js';

// A field that still holds Thai script is not English copy. Romanised dish
// names ("Pad Thai", "Khao Mok") pass; a pasted Thai string does not, because it
// is exactly the failure this file exists to prevent.
const THAI_SCRIPT = /[\u0E00-\u0E7F]/;

const TIER_EN = { classic: 'Classic', signature: 'Signature', executive: 'Executive' };
const TIER_ORDER = ['classic', 'signature', 'executive'];
// The level names as business-rules.json declares them, so the English page
// calls the top level "Executive Premium" rather than dropping "Premium".
const TIER_EN_NAME = {
  classic: 'Classic Halal Meal Box',
  signature: 'Signature Halal Meal Box',
  executive: 'Executive Premium Halal Box',
};

export async function loadEnCopy(root = ROOT, items, toppings = [], desserts = []) {
  const copy = JSON.parse(await readFile(path.join(root, EN_COPY_FILE), 'utf8'));
  // A name is required, and it must not be Thai: an English visitor must never
  // be handed a Thai dish name, whether the copy is missing or was copied from
  // the catalogue. A description is not required — the owner may publish the
  // dish before writing one, and the card simply omits the paragraph in both
  // languages.
  const usable = (value) => typeof value === 'string' && value.trim() !== '' && !THAI_SCRIPT.test(value);
  const missing = items
    .filter((item) => {
      const entry = copy[item.id];
      return !entry || !usable(entry.name);
    })
    .map((item) => `${item.id} ${item.name}`);
  if (missing.length) {
    throw new Error(
      `${EN_COPY_FILE} is missing English copy for ${missing.length} live menu(s): ${missing.join('; ')}`,
    );
  }
  // Same rule for the topping list: a Thai name on the English page reads as a
  // bug to the customer, so a missing or untranslated name fails the build.
  const toppingCopy = copy.toppings && typeof copy.toppings === 'object' ? copy.toppings : {};
  const noEnglish = toppings
    .map((t) => String(t?.name ?? '').trim())
    .filter((name) => name && !usable(toppingCopy[name]));
  if (noEnglish.length) {
    throw new Error(
      `${EN_COPY_FILE} is missing an English name for ${noEnglish.length} topping(s): ${noEnglish.join('; ')}`,
    );
  }
  // Desserts carry their own English name in the published catalogue, for the
  // same reason as the topping list: a Thai dessert name on an English menu
  // reads as a bug to the customer.
  const noEnglishDessert = (Array.isArray(desserts) ? desserts : [])
    .filter((item) => item?.public !== false)
    .filter((item) => !usable(item?.nameEn))
    .map((item) => `${item?.id} ${String(item?.nameTh ?? '').trim()}`.trim());
  if (noEnglishDessert.length) {
    throw new Error(
      `sideItems is missing an English name for ${noEnglishDessert.length} dessert(s): ${noEnglishDessert.join('; ')}`,
    );
  }
  return copy;
}

// The English page styles each dish inline rather than through css/popular-menu.css,
// because that page predates those classes. These strings keep that look, and the
// fields shown match the Thai card exactly (level, name, description, price) so
// a customer comparing the two pages finds the same dish at the same price.
// The per-menu minimum in English, the same catalogue fact minHtml() prints on
// the Thai page (standardMenuMinimum) — worded the way this page words every
// other figure, singular only when the minimum really is one box.
function minEnText(item) {
  if (item.minPerMenu == null) return '';
  return `Min ${item.minPerMenu} ${item.minPerMenu === 1 ? 'box' : 'boxes'}`;
}

// The English card gets the same order path the Thai card has. Without it the
// English page is a read-only catalogue: a visitor has to find the contact page
// on their own, and the dish they just chose is the one thing we want them to
// send us.
function orderMessageEn(item) {
  const price = item.price == null ? '' : ` ${item.price} THB/box`;
  return `Interested in ${item.name}${price}, ___ boxes, on ___ , delivered to ___`;
}

const EN_CTA_STYLE = 'display:block;margin-top:auto;padding:12px 20px;border:1px solid #1d6b3e;border-radius:3px;background:transparent;color:#1d6b3e;font-weight:700;font-size:14px;text-align:center;text-decoration:none;white-space:nowrap';
const EN_CTA_HOVER = 'onmouseover="this.style.background=\'#1d6b3e\';this.style.color=\'#fff\'" onmouseout="this.style.background=\'transparent\';this.style.color=\'#1d6b3e\'"';

function enOrderCta(item, source) {
  return `<a style="${EN_CTA_STYLE}" ${EN_CTA_HOVER} href="${lineHref(orderMessageEn(item))}" target="_blank" rel="noopener noreferrer" data-track-event="lead_line_click" data-track-section="popular_menu" data-track-source="${source}">Order this menu</a>`;
}

function enCardHtml(item, copy) {
  const photo = hasDishPhoto(item)
    ? `<img src="../${escapeHtml(item.image)}" alt="${escapeHtml(copy[item.id].name)} EED HALAL" style="width:100%;height:100%;object-fit:cover;display:block" loading="lazy">`
    : '';
  const price = item.price == null ? '' : `<p style="font-size:1.05rem;font-weight:800;color:var(--primary);margin:0.15rem 0 0">${item.price} THB<span style="font-size:0.75rem;font-weight:600;color:var(--text-muted);margin-left:0.25rem">/ box</span></p>`;
  const min = minEnText(item) ? `<p style="font-size:0.8rem;font-weight:600;color:var(--text-muted);margin:0.2rem 0 0">${minEnText(item)}</p>` : '';
  // Same tag as the Thai page, in this page's own inline style. Thai owner
  // wording is skipped (see tagTextEn) so no Thai reaches an English visitor,
  // and gold stays reserved for the published best-seller list.
  const tag = tagTextEn(item);
  const bestSeller = tag
    ? `<span style="position:absolute;top:0.6rem;left:0.6rem;background:${item.popular ? '#a87e1f' : '#3f4a41'};color:#fff;font-size:0.72rem;font-weight:800;letter-spacing:.02em;padding:0.2rem 0.55rem;border-radius:999px;box-shadow:0 1px 4px rgba(0,0,0,.25)">${escapeHtml(tag)}</span>`
    : '';
  return `<div style="position:relative;background:var(--white);border-radius:var(--radius-xl);box-shadow:var(--shadow-sm);overflow:hidden;display:flex;flex-direction:column">
<div style="aspect-ratio:4/3;overflow:hidden">
${photo}
</div>
${bestSeller}
<div style="padding:1.25rem 1.25rem 1.5rem;display:flex;flex-direction:column;gap:0.4rem;flex:1">
<h4 style="font-size:1.25rem;font-weight:900;color:var(--text);margin:0">${escapeHtml(copy[item.id].name)}</h4>
<p style="font-size:0.8rem;line-height:1.7;opacity:0.7;color:var(--text);margin:0">${escapeHtml(tierLabel(item.tier))} &middot; ${escapeHtml(copy[item.id].desc)}</p>
${price}
${min}
${enOrderCta(item, 'popular_menu_card_en')}
</div>
</div>`;
}

function enListRowHtml(item, copy, emoji) {
  const price = item.price == null ? '' : `<span class="pm-price-unit">${item.price} THB / box</span>`;
  const min = minEnText(item) ? `<span class="pm-price-unit"> &middot; ${minEnText(item)}</span>` : '';
  return `<div class="menu-item"><span class="menu-item-name">${emoji} ${escapeHtml(copy[item.id].name)}${price}${min}</span><span class="menu-item-dots"></span>${enOrderCta(item, 'popular_menu_row_en')}</div>`;
}

function enNameOnlyHtml(item, copy) {
  const price = item.price == null ? '' : `<span class="pm-price-unit">${item.price} THB / box</span>`;
  const min = minEnText(item) ? `<span class="pm-price-unit"> &middot; ${minEnText(item)}</span>` : '';
  return `<div class="pm-name-only"><span class="pm-name-only-text">${escapeHtml(copy[item.id].name)}${price}${min}</span>${enOrderCta(item, 'popular_menu_card_en')}</div>`;
}

export function renderStaticMenuEn(items, copy) {
  const photos = items.filter((item) => item.image && !/logo\.(png|jpg|jpeg|webp)$/i.test(item.image)).map((item) => enCardHtml(item, copy)).join('\n');
  const rows = items.filter((item) => item.image && /logo\.(png|jpg|jpeg|webp)$/i.test(item.image)).map((item) => enListRowHtml(item, copy, { classic: '🍚', signature: '✨', executive: '👑' }[item.tier] || '🍽')).join('\n');
  const nameOnly = items.filter((item) => !item.image).map((item) => enNameOnlyHtml(item, copy)).join('\n');
  const grid = photos;
  const list = rows + (rows && nameOnly ? '\n' : '') + nameOnly;
  return { grid, list };
}

/**
 * The English menu ItemList, as a plain object so JSON.stringify can emit it.
 * It carries the same facts as the Thai page's ItemList: every live dish, its
 * catalogue price, and its product level as a named property rather than a
 * `category` (the catalogue no longer holds a dish category).
 */
export function buildEnItemList(items, copy) {
  return {
    '@type': 'ItemList',
    '@id': 'https://eedhalal.com/en/popular-menu.html#itemlist',
    name: 'EED HALAL Halal Meal Boxes',
    numberOfItems: items.length,
    itemListOrder: 'https://schema.org/ItemListUnordered',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      item: {
        '@type': 'MenuItem',
        '@id': `https://eedhalal.com/en/popular-menu.html#menu-${item.id}`,
        name: copy[item.id].name,
        ...(item.price != null
          ? {
            offers: {
              '@type': 'Offer',
              price: item.price.toFixed(2),
              priceCurrency: 'THB',
              availability: 'https://schema.org/InStock',
              url: `https://eedhalal.com/en/popular-menu.html#menu-${item.id}`,
            },
          }
          : {}),
        additionalProperty: {
          '@type': 'PropertyValue',
          name: 'Product level',
          value: TIER_EN_NAME[item.tier] || TIER_EN[item.tier],
        },
      },
    })),
  };
}

/**
 * The English ItemList lives inside the page's hand-maintained @graph, and a
 * JSON-LD script may contain JSON only, so HTML markers cannot delimit it and
 * hand-splicing array text into JSON is fragile: one missing bracket invalidates
 * the whole block, which costs the page every rich result it has.
 *
 * So the generator owns the entire `mainEntity` node instead. The node is found
 * by bracket matching that skips string contents, then rebuilt with
 * JSON.stringify, so the result is valid JSON by construction and every other
 * node in the @graph is left byte-for-byte alone.
 */
function replaceMainEntity(html, node) {
  const key = '"mainEntity"';
  const anchor = html.indexOf(key);
  if (anchor === -1) throw new Error(`${PAGE_EN} has no "mainEntity" node`);
  const brace = html.indexOf('{', anchor);
  if (brace === -1) throw new Error(`${PAGE_EN} "mainEntity" has no opening brace`);

  let depth = 0;
  let end = -1;
  let inString = false;
  let escaped = false;
  for (let i = brace; i < html.length; i += 1) {
    const ch = html[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) { end = i + 1; break; }
    }
  }
  if (end === -1) throw new Error(`${PAGE_EN} "mainEntity" node is not closed`);

  // Match the indentation the surrounding graph already uses. The indent is the
  // whitespace in front of the "mainEntity" key itself, not the text between the
  // key and its brace, which would otherwise be stamped onto every line.
  const lineStart = html.lastIndexOf('\n', anchor) + 1;
  const indent = html.slice(lineStart, anchor);
  // JSON.stringify's own lines already carry their relative indent (0, 2, 4...),
  // so prefixing the block indent is enough. Slicing a fixed number of columns
  // would eat the closing brace, which sits at column 0.
  const rendered = JSON.stringify(node, null, 2)
    .split('\n')
    .map((line, i) => (i === 0 ? line : indent + line))
    .join('\n');
  return `${html.slice(0, anchor)}${key}: ${rendered}${html.slice(end)}`;
}

export function renderPopularMenuPageEn(html, { items, toppings, secondDish, desserts, classicFloor, minimumOrder }, copy) {
  const { grid, list } = renderStaticMenuEn(items, copy);
  const toppingsHtml = renderToppingsListEn(toppings, copy.toppings);
  let out = replaceBlock(html, GRID_START, GRID_END, grid);
  out = replaceBlock(out, LIST_START, LIST_END, list);
  out = replaceBlock(out, TOPPINGS_START, TOPPINGS_END, toppingsHtml);
  out = replaceBlock(out, SECOND_DISH_START, SECOND_DISH_END, renderSecondDishList(secondDish, true));
  out = replaceBlock(out, DESSERTS_START, DESSERTS_END, renderDessertsList(desserts, true));
  out = replaceBlock(out, HEADCOUNT_START, HEADCOUNT_END, renderHeadcountPicker(classicFloor, minimumOrder, true));
  out = replaceMainEntity(out, buildEnItemList(items, copy));
  return out;
}

// The English page lists the topping by its English name from data/menu-copy-en.json
// (buildEnCopy refuses to run without it), so a Thai name can never reach it.
function renderToppingsListEn(toppings, copy = {}) {
  const names = copy && typeof copy === 'object' ? copy : {};
  const translated = (Array.isArray(toppings) ? toppings : []).map((t) => ({
    name: names[String(t?.name ?? '').trim()] || String(t?.name ?? ''),
    price: t?.price,
  }));
  return renderToppingsList(translated, true);
}

export async function buildPopularMenuPage(root = ROOT) {
  const page = await readFile(path.join(root, PAGE), 'utf8');
  return renderPopularMenuPage(page, await loadCatalogue(root));
}

/**
 * The English half of the catalogue, for the visitor's browser.
 *
 * en/popular-menu.html ships English markup, but js/popular-menu-hydrate.js
 * redraws the grid and the full list from EED_MENUS the moment the page loads,
 * and the catalogue stores Thai names only. Rendering it unchanged therefore
 * replaced every English dish name with a Thai one — a bug a crawler never sees,
 * because crawlers read the static HTML, and every human visitor does.
 *
 * So the English words are published as their own file, keyed by exactly the
 * same ids as js/menu-data.js and generated from the same data/menu-copy-en.json
 * the static markup is built from. One source of English wording, two
 * consumers: the markup a crawler reads and the runtime a visitor sees.
 */
export function buildMenuDataEnJs(copy) {
  const menus = {};
  Object.keys(copy)
    .filter((id) => /^\d+$/.test(id))
    .sort((a, b) => Number(a) - Number(b))
    .forEach((id) => {
      menus[id] = { name: copy[id].name, desc: copy[id].desc || '' };
    });
  // Keyed by the Thai name in data/planner-overrides.json, exactly like the
  // static page resolves a topping: the Thai string is the join key, never text
  // the customer is shown.
  const toppings = {};
  Object.keys(copy.toppings || {})
    .filter((name) => name !== '_comment')
    .sort()
    .forEach((name) => {
      toppings[name] = copy.toppings[name];
    });
  return [
    '/* EED HALAL - English menu copy for the page runtime. Generated from data/menu-copy-en.json by scripts/popular-menu-page.mjs --write. Do not edit by hand. */',
    `var EED_MENU_COPY_EN = ${JSON.stringify(menus)};`,
    `var EED_TOPPINGS_EN = ${JSON.stringify(toppings)};`,
    '',
  ].join('\n');
}

export async function buildMenuDataEn(root = ROOT) {
  const catalogue = await loadCatalogue(root);
  const copy = await loadEnCopy(root, catalogue.items, catalogue.toppings, catalogue.desserts);
  return buildMenuDataEnJs(copy);
}

export async function checkMenuDataEn(root = ROOT) {
  const onDisk = await readFile(path.join(root, EN_RUNTIME_FILE), 'utf8');
  const norm = (text) => text.replaceAll('\r\n', '\n');
  return { ok: norm(onDisk) === norm(await buildMenuDataEn(root)), file: EN_RUNTIME_FILE };
}

export async function buildPopularMenuPageEn(root = ROOT) {
  const page = await readFile(path.join(root, PAGE_EN), 'utf8');
  const catalogue = await loadCatalogue(root);
  return renderPopularMenuPageEn(page, catalogue, await loadEnCopy(root, catalogue.items, catalogue.toppings, catalogue.desserts));
}

export async function checkPopularMenuPage(root = ROOT) {
  const onDisk = await readFile(path.join(root, PAGE), 'utf8');
  const expected = await buildPopularMenuPage(root);
  // Compare line-ending agnostically. This repository is checked out with
  // CRLF on Windows and LF on CI, so a byte comparison would fail on one
  // platform and pass on the other even when the content is identical.
  const norm = (text) => text.replaceAll('\r\n', '\n');
  return { ok: norm(onDisk) === norm(expected), file: PAGE };
}

export async function checkPopularMenuPageEn(root = ROOT) {
  const onDisk = await readFile(path.join(root, PAGE_EN), 'utf8');
  const expected = await buildPopularMenuPageEn(root);
  const norm = (text) => text.replaceAll('\r\n', '\n');
  return { ok: norm(onDisk) === norm(expected), file: PAGE_EN };
}

// Compare resolved file URLs: a manual "file://" + path string is wrong on
// Windows, where import.meta.url has three slashes after the scheme.
const invokedDirectly = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (invokedDirectly) {
  const write = process.argv.includes('--write');
  const { writeFile } = await import('node:fs/promises');

  // Both language pages come from the same catalogue, so they are written and
  // checked together: a green run means the Thai and English menus list the
  // same dishes at the same prices.
  async function writePage(file, builder) {
    const target = path.join(ROOT, file);
    // A file this generator has never written has no established line endings.
    // LF is the safe default: it is what the index must hold, so a CRLF working
    // copy can never commit CRLF by accident.
    let crlf = false;
    try {
      crlf = (await readFile(target, 'utf8')).includes('\r\n');
    } catch { /* first run: the file does not exist yet */ }
    const built = await builder(ROOT);
    // Normalise to LF first. A blind replaceAll('\n', '\r\n') on text that
    // already carries CRLF turns \r\n into \r\r\n, so every write added one
    // more carriage return until the file was no longer valid.
    const lf = built.replace(/\r+\n/g, '\n');
    await writeFile(target, crlf ? lf.replaceAll('\n', '\r\n') : lf, 'utf8');
    console.log(`${file}: written`);
  }

  if (write) {
    await writePage(PAGE, buildPopularMenuPage);
    await writePage(PAGE_EN, buildPopularMenuPageEn);
    await writePage(EN_RUNTIME_FILE, buildMenuDataEn);
  } else {
    const checks = [
      [PAGE, checkPopularMenuPage, 'static menu block'],
      [PAGE_EN, checkPopularMenuPageEn, 'static menu block'],
      [EN_RUNTIME_FILE, checkMenuDataEn, 'English runtime copy'],
    ];
    for (const [file, checker, label] of checks) {
      const result = await checker(ROOT);
      if (!result.ok) {
        console.error(`${file}: ${label} is stale; run with --write`);
        process.exit(1);
      }
      console.log(`${file}: ${label} is in sync`);
    }
  }
}