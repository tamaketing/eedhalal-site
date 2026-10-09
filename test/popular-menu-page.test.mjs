import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { computeTierFloors, isLaunching, setsFromPlanner, tierDefinitions } from '../scripts/mealbox-tiers.mjs';
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
// it can never drift back, and pin every displayed price to the catalogue.

const root = new URL('../', import.meta.url);
const ROOT_PATH = fileURLToPath(root);
const page = await readFile(new URL('popular-menu.html', root), 'utf8');
const overrides = JSON.parse(await readFile(new URL('data/planner-overrides.json', root), 'utf8'));
const loaded = await loadCatalogue(ROOT_PATH);
const catalogue = loaded.items;
const toppings = loaded.toppings;
const rules = JSON.parse(await readFile(new URL('data/business-rules.json', root), 'utf8'));

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

test('every dish is deep-linkable, before and after JavaScript runs', async () => {
  // The owner shares a dish over LINE; the link has to land on that dish both
  // in the crawlable markup and after the renderer replaces the container.
  const ids = catalogue.map((item) => item.id);
  const anchors = [...markup.matchAll(/id="(menu-\d+)"/g)].map((m) => m[1]);
  assert.deepEqual(anchors.sort(), ids.map((id) => `menu-${id}`).sort());
  assert.equal(new Set(anchors).size, anchors.length, 'anchor ids must be unique');
  const renderer = await readFile(new URL('js/popular-menu.js', root), 'utf8');
  // The renderer builds the attribute by concatenation, so match the literal
  // prefix it actually emits rather than a finished attribute.
  assert.ok(renderer.includes('id="menu-'), 'the renderer must emit the same anchor');
  assert.equal((renderer.match(/id="menu-/g) || []).length, 3, 'cards, rows, and name-only all need the anchor');
  const css = await readFile(new URL('css/popular-menu.css', root), 'utf8');
  assert.match(css, /scroll-margin-top/, 'anchors must clear the sticky header');
});

test('the FAQ states plainly that this site has no online ordering', () => {
  const block = [...page.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
    .map(([, raw]) => JSON.parse(raw))
    .flatMap((j) => j['@graph'] || [j])
    .find((n) => n['@type'] === 'FAQPage');
  assert.ok(block, 'FAQPage must exist');
  const how = block.mainEntity.find((q) => /อย่างไร/.test(q.name) && /สั่ง/.test(q.name));
  assert.ok(how, 'the page must explain how ordering actually works');
  assert.match(how.acceptedAnswer.text, /ยังไม่มีระบบสั่งซื้อออนไลน์/);
  assert.match(how.acceptedAnswer.text, /LINE/);
  // Nothing on the page may imply an online purchase path for some dishes.
  const whole = JSON.stringify(block);
  assert.ok(!/ทำไมบางเมนู/.test(whole), 'the cost gate must not be framed as an ordering restriction');
  assert.ok(!/สั่งออนไลน์ไม่ได้/.test(whole), 'no dish may be described as unorderable online');
  // A price answer must still be offered, sourced from the business rules.
  const price = block.mainEntity.find((q) => /ราคาเท่าไหร่/.test(q.name));
  assert.ok(price, 'a price question must be answered');
  assert.match(price.acceptedAnswer.text, /65 บาท/);
  assert.match(price.acceptedAnswer.text, /LINE/);
});

test('every served menu appears exactly once, and no hidden menu appears', () => {
  const ids = [...markup.matchAll(/data-menu-id="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(ids.length, catalogue.length, 'static markup must mirror the catalogue size');
  assert.equal(new Set(ids).size, ids.length, 'no menu may be rendered twice');
  const hidden = new Set((overrides.deleted || []).map(String));
  for (const id of ids) assert.ok(!hidden.has(id), `hidden menu ${id} must never be rendered`);
  assert.deepEqual([...ids].sort(), catalogue.map((m) => m.id).sort());
});

test('the price switch is not surfaced on the catalogue page', () => {
  // The site has no ordering flow at all: it is a catalogue and every order is
  // placed over LINE. Labelling dishes by price state would invent a purchase
  // path that does not exist, so the page must treat every dish identically.
  for (const item of catalogue) {
    const block = blockFor(item.id);
    assert.ok(!/pm-quote-note/.test(block), `menu ${item.id} must carry no price-state label`);
    assert.ok(!/สอบถามราคา/.test(block), `menu ${item.id} must use the same CTA as every other dish`);
    assert.ok(block.includes('สั่งเมนูนี้'), `menu ${item.id} must still route to LINE`);
    assert.ok(block.includes('https://lin.ee/CfvqJTd'), `menu ${item.id} must link LINE`);
  }
  assert.ok(!markup.includes('pm-quote-note'), 'no ask-for-quote label anywhere on the page');
  assert.ok(!markup.includes('ราคาขอสอบถามทาง LINE'), 'no ask-for-quote wording anywhere on the page');
});

test('the page publishes the catalogue price for every dish, and no other figure', () => {
  // The owner asked for prices on the menu page. The figure shown must be the
  // one the catalogue publishes for that dish - never a typed approximation -
  // and a dish with no quotable price must show no figure rather than a zero.
  const quoteOnly = new Set((overrides.quoteOnly || []).map(String));
  const sellable = catalogue.filter((item) => quoteOnly.has(item.id) === false);

  for (const item of catalogue) {
    const block = blockFor(item.id);
    assert.ok(block, `dish ${item.id} must render a card or row`);
    const expected = quoteOnly.has(item.id) ? null : Number(overrides.prices[item.id]);
    if (expected == null || !Number.isFinite(expected) || expected <= 0) {
      assert.ok(!/pm-(?:card|row)-price/.test(block), `dish ${item.id} has no quotable price, so none may be shown`);
      continue;
    }
    assert.match(block, new RegExp(`pm-(?:card|row)-price[^>]*>${expected} บาท`), `dish ${item.id} must show its catalogue price ${expected}`);
  }

  // No invented figures: every บาท amount in the menu markup is a catalogue price.
  const cataloguePrices = new Set(Object.values(overrides.prices).map(Number));
  for (const [, figure] of markup.matchAll(/(\d[\d,]*) บาท/g)) {
    assert.ok(cataloguePrices.has(Number(figure.replace(/,/g, ''))), `${figure} THB is not a catalogue price`);
  }
  assert.ok(sellable.length > 0, 'the page must actually show prices, not just skip them');

  // The structured data publishes the same figure as the markup, so a crawler
  // and a reader never disagree.
  const itemList = buildItemListJsonLd(catalogue);
  itemList.itemListElement.forEach((entry) => {
    const id = entry.item['@id'].split('#menu-')[1];
    const quoted = entry.item.offers?.price;
    if (quoteOnly.has(id) || !Number(overrides.prices[id])) assert.equal(quoted, undefined, `dish ${id} must publish no offer`);
    else assert.equal(Number(quoted), Number(overrides.prices[id]), `dish ${id} offer must equal the catalogue price`);
  });
});

test('the tier table sits before the menu list and prices only level starts', () => {
  const table = /<!-- BUSINESS-RULES:MEALBOX-TIERS:TH -->[\s\S]*?<!-- \/BUSINESS-RULES:MEALBOX-TIERS:TH -->/.exec(page);
  assert.ok(table, 'the generated tier table must exist on the menu page');
  assert.ok(page.indexOf(table[0]) < page.indexOf('MENU:GRID:START'), 'the table must come before the menu list');
  const floors = computeTierFloors(setsFromPlanner(overrides)).floors;
  for (const tier of tierDefinitions(rules)) {
    assert.ok(table[0].includes(`id="tier-${tier.id}"`), `${tier.id} row`);
    const floor = floors[tier.id];
    if (floor) assert.ok(table[0].includes(String(floor.priceFrom)), `${tier.id} must show its computed price`);
    else if (isLaunching(tier, floor)) {
      // Preparing to launch: say so, and do not offer an order path.
      assert.ok(table[0].includes('กำลังเตรียมเปิดตัว'), `${tier.id} must say it is launching`);
      assert.ok(table[0].includes('แจ้งให้ผมทราบเมื่อเปิด'), `${tier.id} must invite interest, not an order`);
    } else assert.ok(table[0].includes('สอบถามรายละเอียดชุดอาหาร'), `${tier.id} must ask instead of quoting a price`);
  }
  // No dish is priced inside the tier table: it only states where each level
  // starts, and where that figure came from.
  const dishPrices = [...table[0].matchAll(/(\d[\d,]*)\s*บาท/g)].map((m) => Number(m[1].replace(/,/g, '')));
  const sellable = new Set(setsFromPlanner(overrides).filter((set) => set.price > 0).map((set) => set.price));
  for (const figure of dishPrices) {
    assert.ok(sellable.has(figure), `${figure} THB is not a catalogue price`);
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
  const once = renderPopularMenuPage(page, { items: catalogue, toppings });
  const twice = renderPopularMenuPage(once, { items: catalogue, toppings });
  assert.equal(twice, once, 'generator must be idempotent or CI would flap');
});

test('buildCatalogue drops hidden menus, marks quote-only ones and keeps the level', () => {
  const fake = [
    { id: 1, name: 'a', tier: 'classic', image: 'img/a.jpg', desc: '' },
    { id: 2, name: 'b', tier: 'signature', image: 'img/b.jpg', desc: '' },
    { id: 3, name: 'c', tier: 'classic', image: 'img/c.jpg', desc: '' },
  ];
  const items = buildCatalogue({
    deleted: [3],
    quoteOnly: [2],
    names: { 1: 'A', 2: 'B', 3: 'C' },
    tiers: { 1: 'executive', 2: 'signature', 3: 'classic' },
  }, fake);
  assert.deepEqual(items.map((m) => m.id), ['1', '2']);
  assert.equal(items.find((m) => m.id === '1').orderable, true);
  assert.equal(items.find((m) => m.id === '2').orderable, false);
  assert.equal(items.find((m) => m.id === '1').tier, 'executive', 'the published level wins');
  assert.ok(!('category' in items[0]), 'a catalogue item has no category field');
});

test('cards state the level and the JSON-LD carries it honestly', () => {
  const items = buildCatalogue({}, [
    { id: 1, name: 'ข้าวผัดกะเพรา', tier: 'classic', image: 'img/a.jpg', desc: 'หอมกระทะ' },
    { id: 2, name: 'ข้าวไก่ทอด', tier: 'signature', image: 'img/b.jpg', desc: '' },
  ]);
  const { grid, list } = renderStaticMenu(items);
  assert.match(grid, /pm-card-tier">Classic</);
  assert.doesNotMatch(grid, /pm-card-cat|category/);
  assert.doesNotMatch(list, /pm-row-cat|category/);

  const ld = JSON.parse(renderItemListJsonLd(items).replace(/^<script[^>]*>\n?/, '').replace(/<\/script>$/, ''));
  for (const entry of ld.itemListElement) {
    assert.ok(!('category' in entry.item), 'a level is not a dish-type category');
    assert.equal(entry.item.additionalProperty.name, 'ระดับสินค้า');
  }
  assert.deepEqual(ld.itemListElement.map((e) => e.item.additionalProperty.value), ['Classic', 'Signature']);
});