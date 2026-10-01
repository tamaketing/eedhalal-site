import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { publicProjectionOfCentral, startingPriceConsistency } from '../scripts/menu-central.mjs';
import { loadCatalogue } from '../scripts/popular-menu-page.mjs';

// llms.txt / llms-full.md / faq.html / JSON-LD all advertise the meal-box
// starting price from business-rules.json -> services.mealBox.priceFrom.
// Nothing tied that claim to the catalogue, so raising every menu price left
// the site advertising a price nobody could order. These tests pin both halves:
// the rule that finds drift, and the committed state being consistent.

const root = new URL('../', import.meta.url);
const ROOT_PATH = fileURLToPath(root);
const rules = JSON.parse(await readFile(new URL('data/business-rules.json', root), 'utf8'));
const overrides = JSON.parse(await readFile(new URL('data/planner-overrides.json', root), 'utf8'));
const menuDataJs = await readFile(new URL('js/menu-data.js', root), 'utf8');

/** Build a projection the way the check does: published data only. */
function projectionFrom({ quoteOnly = [], prices = {}, hidden = [] } = {}) {
  const qo = new Set(quoteOnly.map(String));
  const hid = new Set(hidden.map(String));
  const menus = [];
  for (const line of menuDataJs.matchAll(/id:\s*'?(\d+)'?/g)) {
    const id = line[1];
    if (hid.has(id)) continue;
    menus.push({
      id: Number(id),
      name: overrides.names?.[id] ?? `menu ${id}`,
      price: prices[id] ?? overrides.prices?.[id] ?? 100,
      category: 'cat',
      image: 'img/x.jpg',
      sortOrder: 0,
      hidden: false,
      showPrice: !qo.has(id),
    });
  }
  return publicProjectionOfCentral({ menus }, null);
}

test('the committed state is consistent: starting price == cheapest orderable dish', async () => {
  const catalogue = await loadCatalogue(ROOT_PATH);
  const qo = catalogue.filter((m) => !m.orderable).map((m) => m.id);
  const result = startingPriceConsistency(rules, projectionFrom({ quoteOnly: qo }));
  assert.deepEqual(result.warnings, [], `published state must be consistent: ${result.warnings.join(' | ')}`);
  assert.equal(result.declared, result.minOrderable);
  assert.equal(result.minOrderable, 65);
  assert.equal(result.orderableCount, catalogue.filter((m) => m.orderable).length);
});

test('raising every orderable price is reported as drift', () => {
  const ids = Object.keys(overrides.prices);
  const bumped = projectionFrom({
    quoteOnly: ids.slice(1),
    prices: { [ids[0]]: overrides.prices[ids[0]] + 20 },
  });
  const result = startingPriceConsistency(rules, bumped);
  assert.equal(result.orderableCount, 1, 'only one dish is orderable in this fixture');
  assert.equal(result.minOrderable, overrides.prices[ids[0]] + 20);
  assert.equal(result.ok, false);
  assert.match(result.warnings.join(' '), /ราคาเริ่มต้นใน business-rules\.json คือ 65 บาท/);
  assert.match(result.warnings.join(' '), /llms\.txt/);
});

test('an ask-for-quote dish cannot be the reference price', () => {
  // The cheapest served dish is quote-only, so the claim must follow the
  // cheapest dish a customer can actually buy.
  const all = Object.keys(overrides.prices);
  const result = startingPriceConsistency(rules, projectionFrom({
    quoteOnly: all.filter((id) => id !== '3'),
  }));
  assert.equal(result.minOrderable, overrides.prices['3']);
  assert.equal(result.minServed, Math.min(...all.map((id) => overrides.prices[id])));
  assert.equal(result.ok, result.declared === result.minOrderable);
});

test('a hidden dish cannot be the reference price', () => {
  const ids = Object.keys(overrides.prices);
  const lowest = Math.min(...ids.map((id) => overrides.prices[id]));
  // Hide EVERY dish at the lowest price: hiding one is not enough when several
  // share it.
  const cheapest = ids.filter((id) => overrides.prices[id] === lowest);
  const remaining = ids.filter((id) => overrides.prices[id] !== lowest);
  assert.ok(cheapest.length > 0 && remaining.length > 0, 'fixture needs both groups');
  const result = startingPriceConsistency(rules, projectionFrom({ quoteOnly: [], hidden: cheapest }));
  assert.ok(result.minOrderable > lowest, 'the hidden dishes must not define the starting price');
  assert.equal(result.minServed, Math.min(...remaining.map((id) => overrides.prices[id])));
  assert.equal(result.ok, false);
});

test('no orderable dish is reported instead of a false pass', () => {
  const all = Object.keys(overrides.prices);
  const result = startingPriceConsistency(rules, projectionFrom({ quoteOnly: all }));
  assert.equal(result.orderableCount, 0);
  assert.equal(result.minOrderable, null);
  assert.equal(result.ok, false);
  assert.match(result.warnings.join(' '), /ยังไม่มีเมนูที่สั่งซื้อได้เลย/);
});

test('a switched-off price is quote-only even without a cost store', () => {
  // publicProjectionOfCentral used to force costBlocked=false whenever no cost
  // file was present, so a dish whose price the owner switched off still looked
  // orderable and could become the reference price.
  const projection = projectionFrom({ quoteOnly: [], prices: { 3: 10 } });
  const menu3 = projection.menus.get('3');
  assert.equal(menu3.priceHidden, false, 'fixture: dish 3 starts with its price on');
  const off = publicProjectionOfCentral({
    menus: [{ id: 3, name: 'x', price: 10, category: 'c', image: 'img/x.jpg', minPerMenu: 10, hidden: false, showPrice: false }],
  }, null);
  assert.equal(off.menus.get('3').costBlocked, true, 'showPrice=false must gate the dish with no cost store');
});

test('a mismatched or missing declared price never passes silently', () => {
  const noRules = startingPriceConsistency({}, projectionFrom({ quoteOnly: [] }));
  assert.equal(noRules.ok, false);
  assert.match(noRules.warnings.join(' '), /ไม่พบราคาเริ่มต้น/);
});