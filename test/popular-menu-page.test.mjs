import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  buildCatalogue,
  checkPopularMenuPage,
  loadCatalogue,
  renderItemListJsonLd,
  renderPopularMenuPage,
  renderStaticMenu,
} from '../scripts/popular-menu-page.mjs';

// popular-menu.html used to ship an empty #pm-grid / #pm-list and let
// JavaScript fill it, so any crawler that does not run JS saw a page with no
// menu at all. These tests pin the crawlable layer to the published planner so
// it can never drift back, and they pin the deliberate no-prices rule.

const root = new URL('../', import.meta.url);
const ROOT_PATH = fileURLToPath(root);
const page = await readFile(new URL('popular-menu.html', root), 'utf8');
const overrides = JSON.parse(await readFile(new URL('data/planner-overrides.json', root), 'utf8'));
const catalogue = await loadCatalogue(ROOT_PATH);

/** The ItemList node, parsed back out of the generated ld+json block. */
const buildItemListJsonLd = (items) => JSON.parse(
  renderItemListJsonLd(items).replace(/^<script[^>]*>/, '').replace(/<\/script>$/, ''),
);

const between = (html, start, end) => {
  const from = html.indexOf(start);
  const to = html.indexOf(end);
  assert.ok(from !== -1 && to > from, `markers ${start} ... ${end} must exist`);
  return html.slice(from + start.length, to);
};

const gridHtml = between(page, '<!-- MENU:GRID:START -->', '<!-- MENU:GRID:END -->');
const listHtml = between(page, '<!-- MENU:LIST:START -->', '<!-- MENU:LIST:END -->');
const markup = `${gridHtml}\n${listHtml}`;

// Each card/row runs from its own data-menu-id up to the next one, so an
// assertion about one dish can never read a neighbour's markup.
const blockFor = (id) => {
  const marker = `data-menu-id="${id}"`;
  const from = markup.indexOf(marker);
  assert.ok(from !== -1, `menu ${id} must be rendered`);
  const rest = markup.slice(from + marker.length);
  const next = rest.search(/data-menu-id="/);
  return next === -1 ? rest : rest.slice(0, next);
};

test('the static block is in sync with the published planner', async () => {
  const result = await checkPopularMenuPage(ROOT_PATH);
  assert.ok(result.ok, `${result.file} static menu block is stale; run scripts/popular-menu-page.mjs --write`);
});

test('every served menu name is present in the crawlable HTML', () => {
  assert.ok(catalogue.length > 0, 'fixture must have menus');
  for (const item of catalogue) {
    assert.ok(markup.includes(item.name), `menu ${item.id} (${item.name}) is missing from the static HTML`);
  }
});

test('every served menu appears exactly once, and no hidden menu appears', () => {
  const ids = [...markup.matchAll(/data-menu-id="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(ids.length, catalogue.length, 'static markup must mirror the catalogue size');
  assert.equal(new Set(ids).size, ids.length, 'no menu may be rendered twice');
  const hidden = new Set((overrides.deleted || []).map(String));
  for (const id of ids) assert.ok(!hidden.has(id), `hidden menu ${id} must never be rendered`);
  assert.deepEqual([...ids].sort(), catalogue.map((m) => m.id).sort());
});

test('ask-for-quote dishes are labelled and orderable ones are not', () => {
  const quoteOnly = new Set((overrides.quoteOnly || []).map(String));
  assert.ok(quoteOnly.size > 0, 'fixture must exercise the cost gate');
  for (const item of catalogue) {
    const block = blockFor(item.id);
    const shouldQuote = quoteOnly.has(item.id);
    assert.equal(block.includes('pm-quote-note'), shouldQuote, `menu ${item.id} ask-for-quote label must be ${shouldQuote}`);
    assert.equal(block.includes('สอบถามราคา'), shouldQuote, `menu ${item.id} price-asking CTA must be ${shouldQuote}`);
    assert.ok(
      block.includes('สอบถาม') && block.includes('https://lin.ee/CfvqJTd'),
      `menu ${item.id} must always route to LINE`,
    );
  }
});

test('the page publishes no price: not in markup, not in alt text, not in JSON-LD', () => {
  // js/popular-menu.js is explicit that sale prices never reach this page.
  const forbidden = [/\d+\s*บาท/, /฿\s*\d/, /\d{2,3}\s*THB/, /"price"/, /"lowPrice"/, /"offers"/, /"priceCurrency"/];
  const itemList = JSON.stringify(buildItemListJsonLd(catalogue));
  for (const [label, text] of [['grid', gridHtml], ['list', listHtml], ['itemlist', itemList]]) {
    for (const re of forbidden) {
      assert.ok(!re.test(text), `${label} must not contain ${re}`);
    }
  }
  for (const alt of [...gridHtml.matchAll(/alt="([^"]*)"/g)].map((m) => m[1])) {
    assert.ok(!/\d/.test(alt), `alt text must not contain digits: ${alt}`);
  }
});

test('ItemList structured data matches the rendered catalogue exactly', () => {
  const list = buildItemListJsonLd(catalogue);
  assert.equal(list['@type'], 'ItemList');
  assert.equal(list.numberOfItems, catalogue.length);
  assert.equal(list.itemListElement.length, catalogue.length);
  list.itemListElement.forEach((entry, index) => {
    assert.equal(entry.position, index + 1);
    assert.equal(entry.item['@type'], 'Menu');
    assert.equal(entry.item.name, catalogue[index].name);
  });
});

test('every JSON-LD block on the page parses and contains no HTML comments', () => {
  const blocks = [...page.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  assert.ok(blocks.length >= 2, 'expected the hand-written block plus the generated ItemList');
  const types = [];
  for (const [, raw] of blocks) {
    // A JSON-LD script may contain JSON only: any HTML comment breaks parsing.
    assert.ok(!/<!--/.test(raw), 'JSON-LD must not contain HTML comments');
    const parsed = JSON.parse(raw);
    types.push(...(parsed['@graph'] || [parsed]).map((n) => n['@type']));
  }
  assert.ok(types.includes('ItemList'), `ItemList missing, got: ${types.join(', ')}`);
  assert.ok(types.includes('Organization'));
  assert.ok(types.includes('FAQPage'));
});

test('the photo/row split matches the production renderer', async () => {
  const renderer = await readFile(new URL('js/popular-menu.js', root), 'utf8');
  const { grid, list } = renderStaticMenu(catalogue);
  const isLogo = (src) => Boolean(src) && /logo\.(png|jpg|jpeg|webp)$/i.test(src);
  assert.ok(renderer.includes('logo\\.(png|jpg|jpeg|webp)'), 'renderer logo rule must stay in sync');
  const cardIds = [...grid.matchAll(/data-menu-id="([^"]+)"/g)].map((m) => m[1]);
  const rowIds = [...list.matchAll(/data-menu-id="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(cardIds.length + rowIds.length, catalogue.length);
  for (const id of cardIds) {
    const item = catalogue.find((m) => m.id === id);
    assert.ok(!isLogo(item.image), `menu ${id} has no dish photo so it must render as a row`);
  }
  for (const id of rowIds) {
    const item = catalogue.find((m) => m.id === id);
    assert.ok(isLogo(item.image), `menu ${id} must render as an image card`);
  }
});

test('rendering is idempotent: re-running the generator changes nothing', () => {
  const once = renderPopularMenuPage(page, catalogue);
  const twice = renderPopularMenuPage(once, catalogue);
  assert.equal(twice, once, 'generator must be idempotent or CI would flap');
});

test('buildCatalogue drops hidden menus and marks quote-only ones', () => {
  const fake = [
    { id: 1, name: 'a', category: 'c', image: 'img/a.jpg', desc: '' },
    { id: 2, name: 'b', category: 'c', image: 'img/b.jpg', desc: '' },
    { id: 3, name: 'c', category: 'c', image: 'img/c.jpg', desc: '' },
  ];
  const items = buildCatalogue({
    deleted: [3],
    quoteOnly: [2],
    names: { 1: 'A', 2: 'B', 3: 'C' },
    categories: { 1: 'x', 2: 'y', 3: 'z' },
  }, fake);
  assert.deepEqual(items.map((m) => m.id), ['1', '2']);
  assert.equal(items.find((m) => m.id === '1').orderable, true);
  assert.equal(items.find((m) => m.id === '2').orderable, false);
});