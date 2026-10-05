import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { publicProjectionOfCentral, tierPriceConsistency } from '../scripts/menu-central.mjs';
import { computeTierFloors, setsFromPlanner, setsFromProjection, TIER_CLASSIC, TIER_EXECUTIVE, TIER_SIGNATURE } from '../scripts/mealbox-tiers.mjs';
import { loadCatalogue } from '../scripts/popular-menu-page.mjs';

// The website, the LINE bot, llms.txt and the JSON-LD all publish a per-tier
// "starting from" price. None of them is typed anywhere: each is the cheapest
// set of that tier that is published, open for sale and shown on the web. These
// tests pin the rule (including the cases that must NOT produce a price) and
// the committed state being consistent.

const root = new URL('../', import.meta.url);
const ROOT_PATH = fileURLToPath(root);
const rules = JSON.parse(await readFile(new URL('data/business-rules.json', root), 'utf8'));
const overrides = JSON.parse(await readFile(new URL('data/planner-overrides.json', root), 'utf8'));
const menuDataJs = await readFile(new URL('js/menu-data.js', root), 'utf8');

/** Build a projection the way the admin check does: published data only. */
function projectionFrom({ quoteOnly = [], prices = {}, hidden = [], tiers = {} } = {}) {
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
      tier: 'classic',
      tier: tiers[id] ?? overrides.tiers?.[id],
      image: 'img/x.jpg',
      sortOrder: 0,
      hidden: false,
      showPrice: !qo.has(id),
    });
  }
  return publicProjectionOfCentral({ menus }, null);
}

const floorsOf = (options) => computeTierFloors(setsFromProjection(projectionFrom(options))).floors;
const publishedFloors = computeTierFloors(setsFromPlanner(overrides)).floors;

test('the committed state is consistent: every published tier price comes from the catalogue', async () => {
  const catalogue = await loadCatalogue(ROOT_PATH);
  const qo = catalogue.filter((m) => !m.orderable).map((m) => m.id);
  const result = tierPriceConsistency(rules, projectionFrom({ quoteOnly: qo }));
  assert.deepEqual(result.warnings, [], `published state must be consistent: ${result.warnings.join(' | ')}`);
  for (const tier of result.tiers) {
    assert.equal(tier.priceFrom, publishedFloors[tier.id]?.priceFrom ?? null, `${tier.id} price must match the catalogue`);
    assert.ok(tier.priceFrom === null || tier.priceFrom > 0, 'a published price must be a real figure');
  }
});

test('no starting price is hardcoded in the business rules any more', () => {
  const meal = rules.services.mealBox;
  assert.equal('priceFrom' in meal, false, 'the classic floor is computed from the catalogue');
  assert.equal('premiumPriceFrom' in meal, false, 'the executive floor is computed from the catalogue');
  assert.ok(meal.tiers.length >= 2, 'the levels are declared as business data');
});

test('an ask-for-quote set cannot define a tier price', () => {
  const premiumIds = Object.keys(overrides.prices).filter((id) => overrides.tiers?.[id] === TIER_EXECUTIVE);
  assert.ok(premiumIds.length > 0, 'fixture needs an executive set');
  const cheapestId = premiumIds.sort((a, b) => overrides.prices[a] - overrides.prices[b])[0];
  const others = premiumIds.filter((id) => id !== cheapestId);
  if (others.length) {
    const result = floorsOf({ quoteOnly: others });
    assert.equal(result[TIER_EXECUTIVE]?.priceFrom, Math.min(...others.map((id) => overrides.prices[id])));
  }
  // Everything switched off: no price at all, never the old figure.
  const empty = floorsOf({ quoteOnly: Object.keys(overrides.prices) });
  assert.equal(empty[TIER_EXECUTIVE], null, 'a tier with no open set must report no price');
});

test('a hidden set cannot define a tier price', () => {
  const premiumIds = Object.keys(overrides.prices).filter((id) => overrides.tiers?.[id] === TIER_EXECUTIVE);
  const prices = premiumIds.map((id) => overrides.prices[id]);
  const lowest = Math.min(...prices);
  const atLowest = premiumIds.filter((id) => overrides.prices[id] === lowest);
  const rest = premiumIds.filter((id) => overrides.prices[id] !== lowest);
  const result = floorsOf({ hidden: atLowest });
  if (rest.length) {
    assert.ok(result[TIER_EXECUTIVE].priceFrom > lowest, 'hidden sets must not define the price');
  } else {
    assert.equal(result[TIER_EXECUTIVE], null);
  }
});

test('a tier with no open set reports no price instead of a fallback', () => {
  const empty = floorsOf({ quoteOnly: Object.keys(overrides.prices) });
  assert.equal(empty[TIER_CLASSIC], null);
  assert.equal(empty[TIER_SIGNATURE], null);
  assert.equal(empty[TIER_EXECUTIVE], null);
});

test('a switched-off price is quote-only even without a cost store', () => {
  const projection = projectionFrom({ quoteOnly: [], prices: { 3: 10 } });
  const menu3 = projection.menus.get('3');
  assert.equal(menu3.priceHidden, false, 'fixture: dish 3 starts with its price on');
  const off = publicProjectionOfCentral({
    menus: [{ id: 3, name: 'x', price: 10, tier: 'classic', image: 'img/x.jpg', minPerMenu: 10, hidden: false, showPrice: false }],
  }, null);
  assert.equal(off.menus.get('3').costBlocked, true, 'showPrice=false must gate the set with no cost store');
});

test('missing tier declarations are reported instead of passing silently', () => {
  const noRules = tierPriceConsistency({}, projectionFrom({ quoteOnly: [] }));
  assert.equal(noRules.ok, false);
  assert.match(noRules.warnings.join(' '), /services\.mealBox\.tiers/);
});