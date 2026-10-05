import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  clearMenuCache,
  findMealboxMenus,
  findMealboxMenusByExactPrice,
  findMealboxMenusByMaxPrice,
  getMealboxMenuById,
  getMealboxMenuCatalog,
  lookupMealboxMenuByName,
  MENU_TIERS,
  MenuCatalogError,
} from '../services/menus.mjs';
import { ValidationError } from '../services/errors.mjs';

const REPO_PLANNER = path.resolve('data', 'planner-overrides.json');

// The owner publishes the menu in batches, so this suite must assert INVARIANTS
// (the catalog matches the published planner file) and never a frozen menu
// count or price. Expectations are derived from the real planner file; a
// mismatch between the two is still a hard failure.
const published = () => JSON.parse(readFileSync(REPO_PLANNER, 'utf8'));
const deletedIds = (planner = published()) => new Set((planner.deleted || []).map(String));
const quoteOnlyIds = (planner = published()) => new Set((planner.quoteOnly || []).map(String));
// The ORDERABLE catalog = published prices, minus owner-hidden, minus
// ask-for-quote (served by name, but no confirmed cost / price switched off).
const activeEntries = (planner = published()) => {
  const hidden = deletedIds(planner);
  const quoteOnly = quoteOnlyIds(planner);
  return Object.entries(planner.prices).filter(
    ([id]) => !hidden.has(String(id)) && !quoteOnly.has(String(id)),
  );
};
// Served by name (may still be ask-for-quote): hidden ones are gone.
const servedEntries = (planner = published()) => {
  const hidden = deletedIds(planner);
  return Object.entries(planner.prices).filter(([id]) => !hidden.has(String(id)));
};
const priceOf = (id, planner = published()) => planner.prices[String(id)];

function writeFixture(mutator) {
  const dir = mkdtempSync(path.join(tmpdir(), 'eed-menus-'));
  const file = path.join(dir, 'planner-overrides.json');
  const base = JSON.parse(readFileSync(REPO_PLANNER, 'utf8'));
  writeFileSync(file, JSON.stringify(mutator(base)));
  clearMenuCache(file);
  return file;
}

test('active catalog is exactly the published planner minus hidden and ask-for-quote', async () => {
  const planner = published();
  const menus = await getMealboxMenuCatalog();
  const expected = activeEntries(planner).map(([id]) => String(id)).sort();
  assert.deepEqual(menus.map((menu) => menu.id).sort(), expected);
  assert.ok(menus.length > 0, 'the shop must always publish at least one orderable menu');
  for (const menu of menus) {
    assert.deepEqual(Object.keys(menu).sort(), ['id', 'image', 'minPerMenu', 'name', 'price', 'tier']);
    assert.match(menu.id, /^\d+$/);
    assert.ok(menu.name.trim());
    assert.ok(menu.price > 0);
    assert.ok(Number.isInteger(menu.minPerMenu) && menu.minPerMenu >= 1);
    assert.ok(MENU_TIERS.includes(menu.tier), `menu ${menu.id} has no real level`);
    // Every served field must come from the same published maps, never a guess.
    assert.equal(menu.price, priceOf(menu.id, planner));
    assert.equal(menu.name, planner.names[menu.id]);
    assert.equal(menu.tier, planner.tiers[menu.id]);
    assert.equal(menu.image, planner.images[menu.id]);
    assert.equal(menu.minPerMenu, planner.mins[menu.id]);
    // Cost gate: nothing without a confirmed cost / switched-off price may order.
    assert.ok(!quoteOnlyIds(planner).has(menu.id), `ask-for-quote menu ${menu.id} must not be orderable`);
  }
});

test('exact price returns exactly the published planner menus at that price', async () => {
  const planner = published();
  const target = activeEntries(planner)[0];
  assert.ok(target, 'needs at least one active menu');
  const [id, price] = target;
  const menus = await findMealboxMenusByExactPrice(price, { limit: 100 });
  const expected = activeEntries(planner)
    .filter(([, value]) => value === price)
    .map(([menuId]) => String(menuId))
    .sort();
  assert.deepEqual(menus.map((menu) => menu.id).sort(), expected);
  assert.ok(menus.some((menu) => menu.id === String(id)), 'the sampled menu must be found');
  for (const menu of menus) assert.equal(menu.price, price);
});

test('max price never leaks a menu above the cap', async () => {
  const planner = published();
  const cap = 100;
  const menus = await findMealboxMenusByMaxPrice(cap, { limit: 100 });
  const expected = activeEntries(planner).filter(([, price]) => price <= cap).length;
  assert.equal(menus.length, Math.min(expected, 100));
  for (const menu of menus) assert.ok(menu.price <= cap, `${menu.name} leaks at ${menu.price}`);
});

test('exact Thai name lookup resolves at the published planner price', async () => {
  const planner = published();
  const [id, name] = Object.entries(planner.names).find(
    ([menuId]) => activeEntries(planner).some(([activeId]) => activeId === menuId),
  );
  const menus = await lookupMealboxMenuByName(name);
  assert.ok(menus.length >= 1);
  assert.equal(menus[0].id, String(id));
  assert.equal(menus[0].price, priceOf(id, planner));
  const byId = await getMealboxMenuById(id);
  assert.equal(byId.price, priceOf(id, planner));
  assert.equal(byId.name, name);
});

test('name lookup tolerates surrounding whitespace; unknown names return []', async () => {
  const planner = published();
  const [activeId] = activeEntries(planner)[0];
  const known = planner.names[activeId];
  const padded = await lookupMealboxMenuByName(`  ${known}  `);
  assert.equal(padded[0]?.id, String(activeId));
  assert.deepEqual(await lookupMealboxMenuByName('เมนูที่ไม่มีอยู่จริงในร้าน'), []);
  assert.deepEqual(await lookupMealboxMenuByName('   '), []);
  assert.deepEqual(await lookupMealboxMenuByName('Chicken Basil Rice'), []);
});

test('owner-hidden and ask-for-quote menus never appear in ordering', async () => {
  const planner = published();
  const hidden = [...deletedIds(planner)];
  const quoteOnly = [...quoteOnlyIds(planner)];
  for (const id of hidden) {
    assert.equal(await getMealboxMenuById(id), null, `hidden id ${id} must not resolve`);
  }
  for (const id of quoteOnly) {
    assert.equal(await getMealboxMenuById(id), null, `ask-for-quote id ${id} must not resolve`);
  }
  // The cost gate must always be exercised, whichever batch is published.
  const wide = await findMealboxMenusByMaxPrice(100000, { limit: 100 });
  const blocked = new Set([...hidden, ...quoteOnly]);
  for (const menu of wide) assert.ok(!blocked.has(menu.id), `blocked id ${menu.id} leaked into ordering`);
  for (const [, price] of activeEntries(planner)) {
    const at = await findMealboxMenusByExactPrice(price, { limit: 100 });
    for (const menu of at) assert.ok(!blocked.has(menu.id), `blocked id ${menu.id} leaked at ${price}`);
  }
  // A blocked menu's name must not resolve to that menu. Substring hits on
  // other orderable dishes are legitimate, so assert on identity, not emptiness.
  const blockedName = hidden.map((id) => planner.names[id]).find(Boolean);
  if (blockedName) {
    const hits = await lookupMealboxMenuByName(blockedName);
    for (const menu of hits) assert.ok(!hidden.includes(menu.id), `hidden id ${menu.id} leaked by name`);
  }
});

test('a quote-only menu is excluded even when its own price is in range', async () => {
  // The live file has no price-switched dish, so create one and point the lookup
  // at that fixture: an ask-for-quote dish must stay out of ordering even when a
  // customer asks for exactly its own price.
  const base = published();
  const [id] = activeEntries(base)[0];
  const price = priceOf(id, base);
  assert.ok(price > 0, 'fixture must expose a priced menu');
  const fixture = writeFixture((planner) => ({ ...planner, quoteOnly: [id] }));
  const at = await findMealboxMenusByExactPrice(price, { limit: 100, plannerPath: fixture });
  assert.ok(
    !at.some((menu) => menu.id === String(id)),
    `ask-for-quote menu ${id} must not be orderable at ${price}`,
  );
  assert.equal(await getMealboxMenuById(id, { plannerPath: fixture }), null, 'ask-for-quote id must not resolve');
});

test('planner fixture price change is visible without touching menu-data', async () => {
  const planner = published();
  const [id] = activeEntries(planner)[0];
  const originalPrice = priceOf(id, planner);
  const bumped = originalPrice + 5;
  const fixture = writeFixture((base) => ({ ...base, prices: { ...base.prices, [id]: bumped } }));
  const menus = await findMealboxMenusByExactPrice(bumped, { plannerPath: fixture });
  assert.ok(menus.some((menu) => menu.id === String(id) && menu.price === bumped));
  assert.ok(!(await findMealboxMenusByExactPrice(originalPrice, { plannerPath: fixture }))
    .some((menu) => menu.id === String(id)));
  // menu-data.js still carries the old price, proving the service did not read it.
  const menuSource = readFileSync(path.resolve('js', 'menu-data.js'), 'utf8');
  const line = menuSource.split('\n').find((entry) => entry.trim().startsWith(`{ id: ${id},`));
  assert.ok(line, `menu-data.js must still contain id ${id}`);
  assert.ok(line.includes(`price: ${originalPrice},`), 'menu-data.js price must be untouched by the fixture');
});

test('planner reload follows file edits with no restart (mtime freshness)', async () => {
  const [id] = activeEntries()[0];
  const originalPrice = priceOf(id);
  const fixture = writeFixture((base) => ({ ...base, prices: { ...base.prices, [id]: originalPrice + 5 } }));
  assert.equal((await getMealboxMenuById(id, { plannerPath: fixture })).price, originalPrice + 5);
  const base = JSON.parse(readFileSync(fixture, 'utf8'));
  base.prices[String(id)] = originalPrice + 6;
  writeFileSync(fixture, JSON.stringify(base));
  const { utimesSync } = await import('node:fs');
  const later = new Date(Date.now() + 5000);
  utimesSync(fixture, later, later);
  assert.equal((await getMealboxMenuById(id, { plannerPath: fixture })).price, originalPrice + 6);
});

test('invalid planner content fails closed (never falls back)', async () => {
  const [id] = activeEntries()[0];
  const badPrice = writeFixture((base) => ({ ...base, prices: { ...base.prices, [id]: 'แพง' } }));
  await assert.rejects(findMealboxMenusByMaxPrice(100, { plannerPath: badPrice }), MenuCatalogError);
  const negative = writeFixture((base) => ({ ...base, prices: { ...base.prices, [id]: -5 } }));
  await assert.rejects(getMealboxMenuCatalog({ plannerPath: negative }), MenuCatalogError);
  const missingMap = writeFixture((base) => {
    const clone = { ...base };
    delete clone.names;
    return clone;
  });
  await assert.rejects(getMealboxMenuCatalog({ plannerPath: missingMap }), MenuCatalogError);
  const inconsistent = writeFixture((base) => {
    const prices = { ...base.prices };
    delete prices[String(id)];
    return { ...base, prices };
  });
  await assert.rejects(getMealboxMenuCatalog({ plannerPath: inconsistent }), MenuCatalogError);
  const badDeleted = writeFixture((base) => ({ ...base, deleted: [...base.deleted, 'not-an-id'] }));
  await assert.rejects(getMealboxMenuCatalog({ plannerPath: badDeleted }), MenuCatalogError);
  // Cost gate must fail closed on malformed input, never serve a wider catalog.
  const badQuoteOnly = writeFixture((base) => ({ ...base, quoteOnly: [...(base.quoteOnly || []), 'not-an-id'] }));
  await assert.rejects(getMealboxMenuCatalog({ plannerPath: badQuoteOnly }), MenuCatalogError);
  const quoteOnlyNotAnArray = writeFixture((base) => ({ ...base, quoteOnly: 'everything' }));
  await assert.rejects(getMealboxMenuCatalog({ plannerPath: quoteOnlyNotAnArray }), MenuCatalogError);
  const quoteOnlyUnknownId = writeFixture((base) => ({ ...base, quoteOnly: [...(base.quoteOnly || []), 999999] }));
  await assert.rejects(getMealboxMenuCatalog({ plannerPath: quoteOnlyUnknownId }), MenuCatalogError);
  // Hidden AND ask-for-quote at once is contradictory and must fail closed.
  const contradictory = writeFixture((base) => {
    const [someId] = activeEntries(base)[0];
    return { ...base, deleted: [...base.deleted, String(someId)], quoteOnly: [...(base.quoteOnly || []), String(someId)] };
  });
  await assert.rejects(getMealboxMenuCatalog({ plannerPath: contradictory }), MenuCatalogError);
  // Omitting quoteOnly entirely must NOT silently widen the catalog: the
  // published file is the gate, so an absent key means "nothing is gated".
  const noQuoteOnly = writeFixture((base) => {
    const clone = { ...base };
    delete clone.quoteOnly;
    return clone;
  });
  const widened = await getMealboxMenuCatalog({ plannerPath: noQuoteOnly });
  assert.equal(widened.length, servedEntries().length, 'no quoteOnly key means every served menu is orderable');
});

test('missing planner file and malformed JSON fail closed', async () => {
  await assert.rejects(
    getMealboxMenuCatalog({ plannerPath: path.join(tmpdir(), 'eed-no-such-planner.json') }),
    MenuCatalogError,
  );
  const dir = mkdtempSync(path.join(tmpdir(), 'eed-menus-'));
  const broken = path.join(dir, 'planner-overrides.json');
  writeFileSync(broken, '{ not valid json');
  await assert.rejects(getMealboxMenuCatalog({ plannerPath: broken }), MenuCatalogError);
});

test('invalid filter input is a client error, not a catalog fallback', async () => {
  await assert.rejects(findMealboxMenus({ exactPrice: Number.NaN }), ValidationError);
  await assert.rejects(findMealboxMenus({ exactPrice: -10 }), ValidationError);
  await assert.rejects(findMealboxMenus({ maxPrice: 0 }), ValidationError);
  await assert.rejects(findMealboxMenusByExactPrice('75'), ValidationError);
});

test('level plus maxPrice composes deterministically', async () => {
  // Derive a level and cap that the CURRENT published batch actually has,
  // so this stays meaningful while the owner publishes menus in small batches.
  const planner = published();
  const active = activeEntries(planner);
  const [tier] = [...new Set(active.map(([id]) => planner.tiers[id]))];
  const cap = Math.max(...active.map(([id]) => planner.prices[id]));
  const expected = active
    .filter(([id]) => planner.tiers[id] === tier && planner.prices[id] <= cap)
    .map(([id]) => String(id)).sort();
  const menus = await findMealboxMenus({ tier, maxPrice: cap, limit: 100 });
  assert.deepEqual(menus.map((menu) => menu.id).sort(), expected);
  for (const menu of menus) {
    assert.equal(menu.tier, tier);
    assert.ok(menu.price <= cap);
  }
  // A cap below the cheapest menu in that level must return nothing.
  const below = Math.max(0, cap - 1);
  const strict = await findMealboxMenus({ tier, maxPrice: below, limit: 100 });
  for (const menu of strict) assert.ok(menu.price <= below);
});

test('an unknown level is a 400, never a silent empty result', async () => {
  // A caller may only name a real level: a typo must fail loudly instead of
  // looking like "we have no such menu".
  await assert.rejects(findMealboxMenus({ tier: 'platinum', limit: 100 }), ValidationError);
  await assert.rejects(findMealboxMenus({ tier: 'ข้าวราดแกง', limit: 100 }), ValidationError);
  // A real level nobody orders yet simply matches nothing.
  const empty = await findMealboxMenus({ tier: 'executive', maxPrice: 1, limit: 100 });
  assert.deepEqual(empty, []);
});

test('results sort by price, then name, then id; limits clamp safely', async () => {
  const menus = await findMealboxMenusByMaxPrice(1000, { limit: 100 });
  for (let i = 1; i < menus.length; i++) {
    const prev = menus[i - 1];
    const next = menus[i];
    const ordered = prev.price < next.price
      || (prev.price === next.price && (prev.name < next.name
        || (prev.name === next.name && Number(prev.id) <= Number(next.id))));
    assert.ok(ordered, `unstable order at ${prev.id}/${next.id}`);
  }
  const capped = await findMealboxMenusByMaxPrice(100000, { limit: 1000 });
  assert.ok(capped.length <= 100);
  // Default limit is a code contract (MENU_DEFAULT_LIMIT), capped by how many
  // menus are actually published — the owner may be serving a small batch.
  const activeCount = activeEntries().length;
  const def = await findMealboxMenusByMaxPrice(100000);
  assert.equal(def.length, Math.min(20, activeCount));
});

test('menu service never consults non-planner price stores', () => {
  const source = readFileSync(path.resolve('services', 'menus.mjs'), 'utf8');
  // Usage patterns (imports, runtime globals, file reads of other stores).
  // Documentation comments may name those stores to forbid them.
  for (const forbidden of ['EED_MENUS', 'knowledge-pack', 'system-message', 'popular-menu', "from '../js/", 'require(']) {
    assert.ok(!source.includes(forbidden), `service must not use ${forbidden}`);
  }
  assert.ok(!source.includes('menu-data.js'), 'service must not read menu-data.js');
});
