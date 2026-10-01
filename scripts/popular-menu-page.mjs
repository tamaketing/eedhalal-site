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
// PRICES ARE NEVER EMITTED
// popular-menu.html deliberately shows no prices: sale prices stay in the
// central data and are never rendered into the DOM, alt text, or structured
// data. Price questions are routed to LINE. The cost gate is respected by
// marking ask-for-quote dishes as such, without revealing a figure.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseMenuDataJs } from './menu-central.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const GRID_START = '<!-- MENU:GRID:START -->';
const GRID_END = '<!-- MENU:GRID:END -->';
const LIST_START = '<!-- MENU:LIST:START -->';
const LIST_END = '<!-- MENU:LIST:END -->';
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
      category: String(overrides.categories?.[id] ?? menu.category ?? ''),
      desc: String(menu.desc || ''),
      image: imageSrc(menu),
      orderable: !quoteOnly.has(id),
    });
  }
  return items;
}

function cardHtml(item) {
  const photo = hasDishPhoto(item)
    ? `<img class="pm-photo" src="${escapeHtml(item.image)}" alt="${escapeHtml(item.name)}" loading="lazy">`
    : `<div class="pm-photo-placeholder" aria-hidden="true"><span>${escapeHtml(item.name.trim().charAt(0) || '•')}</span></div>`;
  const quote = item.orderable ? '' : '<p class="pm-quote-note">ราคาขอสอบถามทาง LINE</p>';
  const cta = item.orderable ? 'สอบถามเมนูนี้ทาง LINE' : 'สอบถามราคาเมนูนี้ทาง LINE';
  return ''
    + `<article class="pm-card${item.orderable ? '' : ' pm-card-quote'}" id="menu-${escapeHtml(item.id)}" data-menu-id="${escapeHtml(item.id)}">`
    + photo
    + '<div class="pm-card-body">'
    + `<p class="pm-card-cat">${escapeHtml(item.category)}</p>`
    + `<h3 class="pm-card-name">${escapeHtml(item.name)}</h3>`
    + (item.desc ? `<p class="pm-card-desc">${escapeHtml(item.desc)}</p>` : '')
    + quote
    + `<a class="pm-btn pm-btn-outline pm-card-cta" href="${LINE_URL}" target="_blank" rel="noopener noreferrer" data-track-event="lead_line_click" data-track-section="popular_menu" data-track-source="popular_menu_card">${cta} <span aria-hidden="true">↗</span></a>`
    + '</div>'
    + '</article>';
}

function rowHtml(item) {
  const quote = item.orderable ? '' : '<p class="pm-quote-note">ราคาขอสอบถามทาง LINE</p>';
  const cta = item.orderable ? 'สอบถามทาง LINE' : 'สอบถามราคาทาง LINE';
  return ''
    + `<div class="pm-row${item.orderable ? '' : ' pm-row-quote'}" id="menu-${escapeHtml(item.id)}" data-menu-id="${escapeHtml(item.id)}">`
    + '<div class="pm-row-text">'
    + `<p class="pm-row-cat">${escapeHtml(item.category)}</p>`
    + `<p class="pm-row-name">${escapeHtml(item.name)}</p>`
    + quote
    + '</div>'
    + '<div class="pm-row-actions">'
    + `<a class="pm-btn pm-btn-outline pm-row-cta" href="${LINE_URL}" target="_blank" rel="noopener noreferrer" data-track-event="lead_line_click" data-track-section="popular_menu" data-track-source="popular_menu_row">${cta} <span aria-hidden="true">↗</span></a>`
    + '</div>'
    + '</div>';
}

export function renderStaticMenu(items) {
  const photos = items.filter(hasDishPhoto).map(cardHtml).join('\n      ');
  const plain = items.filter((item) => !hasDishPhoto(item)).map(rowHtml).join('\n      ');
  return { grid: photos, list: plain };
}

/**
 * A separate JSON-LD block for the catalogue, so the hand-maintained block
 * above is never reformatted. A JSON-LD script may contain JSON only, so this
 * is a whole extra <script type="application/ld+json"> element rather than a
 * marked-up node inside the existing @graph. Multiple ld+json blocks are
 * valid and Google merges them.
 *
 * Names only: this page publishes no prices, so no offer/price is emitted.
 * Ask-for-quote dishes are still listed because they are genuinely served.
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
        ...(item.category ? { category: item.category } : {}),
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
export function renderPopularMenuPage(html, items) {
  const { grid, list } = renderStaticMenu(items);
  let out = replaceBlock(html, GRID_START, GRID_END, grid);
  out = replaceBlock(out, LIST_START, LIST_END, list);
  out = replaceBlock(out, JSONLD_START, JSONLD_END, renderItemListJsonLd(items));
  return out;
}

export async function loadCatalogue(root = ROOT) {
  const overrides = JSON.parse(await readFile(path.join(root, 'data', 'planner-overrides.json'), 'utf8'));
  const menus = await parseMenuDataJs(await readFile(path.join(root, 'js', 'menu-data.js'), 'utf8'));
  return buildCatalogue(overrides, menus);
}

export async function buildPopularMenuPage(root = ROOT) {
  const page = await readFile(path.join(root, PAGE), 'utf8');
  return renderPopularMenuPage(page, await loadCatalogue(root));
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

// Compare resolved file URLs: a manual "file://" + path string is wrong on
// Windows, where import.meta.url has three slashes after the scheme.
const invokedDirectly = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (invokedDirectly) {
  const write = process.argv.includes('--write');
  const { writeFile } = await import('node:fs/promises');
  if (write) {
    const target = path.join(ROOT, PAGE);
    // Keep the file's existing line-ending convention so writing on Windows
    // does not rewrite every line of the page.
    const existing = await readFile(target, 'utf8');
    const built = await buildPopularMenuPage(ROOT);
    const crlf = existing.includes('\r\n');
    await writeFile(target, crlf ? built.replaceAll('\n', '\r\n') : built, 'utf8');
    console.log(`${PAGE}: static menu block written`);
  } else {
    const result = await checkPopularMenuPage(ROOT);
    if (!result.ok) {
      console.error(`${PAGE}: static menu block is stale; run with --write`);
      process.exit(1);
    }
    console.log(`${PAGE}: static menu block is in sync`);
  }
}