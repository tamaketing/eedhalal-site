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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const GRID_START = '<!-- MENU:GRID:START -->';
const GRID_END = '<!-- MENU:GRID:END -->';
const LIST_START = '<!-- MENU:LIST:START -->';
const LIST_END = '<!-- MENU:LIST:END -->';
const TOPPINGS_START = '<!-- MENU:TOPPINGS:START -->';
const TOPPINGS_END = '<!-- MENU:TOPPINGS:END -->';
const JSONLD_START = '<!-- MENU:JSONLD:START -->';
const JSONLD_END = '<!-- MENU:JSONLD:END -->';
const PAGE = 'popular-menu.html';
const LINE_URL = 'https://lin.ee/CfvqJTd';

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
    });
  }
  return items;
}

function cataloguePrice(raw) {
  const price = Number(raw);
  return Number.isFinite(price) && price > 0 ? price : null;
}

// Per-box price line. The unit is stated so a bare number is never ambiguous,
// and the note keeps the page honest about what moves the final figure.
function priceHtml(item, extraClass) {
  if (item.price == null) return '';
  return `<p class="${extraClass}">${item.price} บาท<span class="pm-price-unit">/ กล่อง</span></p>`;
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

function cardHtml(item) {
  const photo = hasDishPhoto(item)
    ? `<img class="pm-photo" src="${escapeHtml(item.image)}" alt="${escapeHtml(item.name)}" loading="lazy">`
    : `<div class="pm-photo-placeholder" aria-hidden="true"><span>${escapeHtml(item.name.trim().charAt(0) || '•')}</span></div>`;
  // Every dish is treated identically here. There is no online ordering on this
  // site at all: it is a catalogue, and every order is placed over LINE. The
  // cost gate decides whether the SHOP can quote a dish from its own data, not
  // whether the customer can buy it, so a quoteOnly dish is listed without a
  // figure rather than with one we cannot stand behind.
  return ''
    + `<article class="pm-card" id="menu-${escapeHtml(item.id)}" data-menu-id="${escapeHtml(item.id)}" data-tier="${escapeHtml(item.tier || 'classic')}">`
    + photo
    + '<div class="pm-card-body">'
    + `<p class="pm-card-tier">${escapeHtml(tierLabel(item.tier))}</p>`
    + `<h3 class="pm-card-name">${escapeHtml(item.name)}</h3>`
    + (item.desc ? `<p class="pm-card-desc">${escapeHtml(item.desc)}</p>` : '')
    + priceHtml(item, 'pm-card-price')
    + `<a class="pm-btn pm-btn-outline pm-card-cta" href="${LINE_URL}" target="_blank" rel="noopener noreferrer" data-track-event="lead_line_click" data-track-section="popular_menu" data-track-source="popular_menu_card">สั่งเมนูนี้ <span aria-hidden="true">↗</span></a>`
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
    + '</div>'
    + '<div class="pm-row-actions">'
    + `<a class="pm-btn pm-btn-outline pm-row-cta" href="${LINE_URL}" target="_blank" rel="noopener noreferrer" data-track-event="lead_line_click" data-track-section="popular_menu" data-track-source="popular_menu_row">สั่งเมนูนี้ <span aria-hidden="true">↗</span></a>`
    + '</div>'
    + '</div>';
}

function nameOnlyHtml(item) {
  return `<div class="pm-name-only" id="menu-${escapeHtml(item.id)}" data-menu-id="${escapeHtml(item.id)}" data-tier="${escapeHtml(item.tier || 'classic')}"><span class="pm-name-only-text">${escapeHtml(item.name)}</span></div>`;
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

/** Build the full page with the static block injected from published data. */
export function renderPopularMenuPage(html, { items, toppings }) {
  const { grid, list } = renderStaticMenu(items);
  const toppingsHtml = renderToppingsList(toppings);
  let out = replaceBlock(html, GRID_START, GRID_END, grid);
  out = replaceBlock(out, LIST_START, LIST_END, list);
  out = replaceBlock(out, TOPPINGS_START, TOPPINGS_END, toppingsHtml);
  out = replaceBlock(out, JSONLD_START, JSONLD_END, renderItemListJsonLd(items));
  return out;
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
  return {
    items: buildCatalogue(overrides, menus),
    toppings: Array.isArray(overrides.toppings) ? overrides.toppings : [],
  };
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
 * a dish missing that the Thai page sells.
 */
const PAGE_EN = 'en/popular-menu.html';
const EN_COPY_FILE = 'data/menu-copy-en.json';

const TIER_EN = { classic: 'Classic', signature: 'Signature', executive: 'Executive' };
const TIER_ORDER = ['classic', 'signature', 'executive'];
// The level names as business-rules.json declares them, so the English page
// calls the top level "Executive Premium" rather than dropping "Premium".
const TIER_EN_NAME = {
  classic: 'Classic Halal Meal Box',
  signature: 'Signature Halal Meal Box',
  executive: 'Executive Premium Halal Box',
};

export async function loadEnCopy(root = ROOT, items, toppings = []) {
  const copy = JSON.parse(await readFile(path.join(root, EN_COPY_FILE), 'utf8'));
  const usable = (value) => typeof value === 'string' && value.trim() !== '';
  const missing = items
    .filter((item) => {
      const entry = copy[item.id];
      return !entry || !usable(entry.name) || !usable(entry.desc);
    })
    .map((item) => `${item.id} ${item.name}`);
  if (missing.length) {
    throw new Error(
      `${EN_COPY_FILE} is missing English copy for ${missing.length} live menu(s): ${missing.join('; ')}`,
    );
  }
  // Same rule for the topping list: a Thai name on the English page reads as a
  // bug to the customer, so a missing translation fails the build.
  const toppingCopy = copy.toppings && typeof copy.toppings === 'object' ? copy.toppings : {};
  const noEnglish = toppings
    .map((t) => String(t?.name ?? '').trim())
    .filter((name) => name && !usable(toppingCopy[name]));
  if (noEnglish.length) {
    throw new Error(
      `${EN_COPY_FILE} is missing an English name for ${noEnglish.length} topping(s): ${noEnglish.join('; ')}`,
    );
  }
  return copy;
}

// The English page styles each dish inline rather than through css/popular-menu.css,
// because that page predates those classes. These strings keep that look, and the
// fields shown match the Thai card exactly (level, name, description, price) so
// a customer comparing the two pages finds the same dish at the same price.
function enCardHtml(item, copy) {
  const photo = hasDishPhoto(item)
    ? `<img src="../${escapeHtml(item.image)}" alt="${escapeHtml(copy[item.id].name)} EED HALAL" style="width:100%;height:100%;object-fit:cover;display:block" loading="lazy">`
    : '';
  const price = item.price == null ? '' : `<p style="font-size:1.05rem;font-weight:800;color:var(--primary);margin:0.15rem 0 0">${item.price} THB<span style="font-size:0.75rem;font-weight:600;color:var(--text-muted);margin-left:0.25rem">/ box</span></p>`;
  return `<div style="background:var(--white);border-radius:var(--radius-xl);box-shadow:var(--shadow-sm);overflow:hidden;display:flex;flex-direction:column">
<div style="aspect-ratio:4/3;overflow:hidden">
${photo}
</div>
<div style="padding:1.25rem 1.25rem 1.5rem;display:flex;flex-direction:column;gap:0.4rem;flex:1">
<h4 style="font-size:1.25rem;font-weight:900;color:var(--text);margin:0">${escapeHtml(copy[item.id].name)}</h4>
<p style="font-size:0.8rem;line-height:1.7;opacity:0.7;color:var(--text);margin:0">${escapeHtml(tierLabel(item.tier))} &middot; ${escapeHtml(copy[item.id].desc)}</p>
${price}
</div>
</div>`;
}

function enListRowHtml(item, copy, emoji) {
  const price = item.price == null ? '' : `<span class="pm-price-unit">${item.price} THB / box</span>`;
  return `<div class="menu-item"><span class="menu-item-name">${emoji} ${escapeHtml(copy[item.id].name)}${price}</span><span class="menu-item-dots"></span></div>`;
}

function enNameOnlyHtml(item, copy) {
  return `<div class="pm-name-only"><span class="pm-name-only-text">${escapeHtml(copy[item.id].name)}</span></div>`;
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

export function renderPopularMenuPageEn(html, { items, toppings }, copy) {
  const { grid, list } = renderStaticMenuEn(items, copy);
  const toppingsHtml = renderToppingsListEn(toppings, copy.toppings);
  let out = replaceBlock(html, GRID_START, GRID_END, grid);
  out = replaceBlock(out, LIST_START, LIST_END, list);
  out = replaceBlock(out, TOPPINGS_START, TOPPINGS_END, toppingsHtml);
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
  const { items, toppings } = await loadCatalogue(root);
  return renderPopularMenuPage(page, { items, toppings });
}

export async function buildPopularMenuPageEn(root = ROOT) {
  const page = await readFile(path.join(root, PAGE_EN), 'utf8');
  const { items, toppings } = await loadCatalogue(root);
  return renderPopularMenuPageEn(page, { items, toppings }, await loadEnCopy(root, items, toppings));
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
    const existing = await readFile(target, 'utf8');
    const built = await builder(ROOT);
    const crlf = existing.includes('\r\n');
    // Normalise to LF first. A blind replaceAll('\n', '\r\n') on text that
    // already carries CRLF turns \r\n into \r\r\n, so every write added one
    // more carriage return until the file was no longer valid.
    const lf = built.replace(/\r+\n/g, '\n');
    await writeFile(target, crlf ? lf.replaceAll('\n', '\r\n') : lf, 'utf8');
    console.log(`${file}: static menu block written`);
  }

  if (write) {
    await writePage(PAGE, buildPopularMenuPage);
    await writePage(PAGE_EN, buildPopularMenuPageEn);
  } else {
    for (const [file, checker] of [[PAGE, checkPopularMenuPage], [PAGE_EN, checkPopularMenuPageEn]]) {
      const result = await checker(ROOT);
      if (!result.ok) {
        console.error(`${file}: static menu block is stale; run with --write`);
        process.exit(1);
      }
      console.log(`${file}: static menu block is in sync`);
    }
  }
}