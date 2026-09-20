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
  MenuCatalogError,
} from '../services/menus.mjs';
import { ValidationError } from '../services/errors.mjs';

const REPO_PLANNER = path.resolve('data', 'planner-overrides.json');
const KNOWN_DELETED_IDS = ['19', '29', '30', '32', '35', '38', '39'];
const DELETED_NAME = 'ข้าวราดกะเพราทะเล'; // id 19, in deleted[]

function writeFixture(mutator) {
  const dir = mkdtempSync(path.join(tmpdir(), 'eed-menus-'));
  const file = path.join(dir, 'planner-overrides.json');
  const base = JSON.parse(readFileSync(REPO_PLANNER, 'utf8'));
  writeFileSync(file, JSON.stringify(mutator(base)));
  clearMenuCache(file);
  return file;
}

test('full active catalog matches the audited planner counts', async () => {
  const menus = await getMealboxMenuCatalog();
  assert.equal(menus.length, 37);
  for (const menu of menus) {
    assert.deepEqual(Object.keys(menu).sort(), ['category', 'id', 'image', 'minPerMenu', 'name', 'price']);
    assert.match(menu.id, /^\d+$/);
    assert.ok(menu.name.trim());
    assert.ok(menu.price > 0);
    assert.ok(Number.isInteger(menu.minPerMenu) && menu.minPerMenu >= 1);
    assert.ok(menu.category.trim());
    assert.ok(!KNOWN_DELETED_IDS.includes(menu.id));
  }
});

test('exact price 75 returns only planner price-75 menus', async () => {
  const menus = await findMealboxMenusByExactPrice(75);
  assert.deepEqual(menus.map((menu) => menu.id).sort(), ['104', '14', '15', '20']);
  for (const menu of menus) assert.equal(menu.price, 75);
});

test('max price 100 never leaks 120/150/180/200 menus', async () => {
  const menus = await findMealboxMenusByMaxPrice(100, { limit: 100 });
  assert.equal(menus.length, 33);
  for (const menu of menus) assert.ok(menu.price <= 100, `${menu.name} leaks at ${menu.price}`);
});

test('exact Thai name lookup resolves id 14 at its planner price', async () => {
  const menus = await lookupMealboxMenuByName('ข้าวไก่เทอริยากิ');
  assert.ok(menus.length >= 1);
  assert.equal(menus[0].id, '14');
  assert.equal(menus[0].price, 75);
  const byId = await getMealboxMenuById(14);
  assert.equal(byId.price, 75);
  assert.equal(byId.name, 'ข้าวไก่เทอริยากิ');
});

test('name lookup tolerates surrounding whitespace; unknown names return []', async () => {
  const padded = await lookupMealboxMenuByName('  ข้าวไก่เทอริยากิ  ');
  assert.equal(padded[0]?.id, '14');
  assert.deepEqual(await lookupMealboxMenuByName('เมนูที่ไม่มีอยู่จริงในร้าน'), []);
  assert.deepEqual(await lookupMealboxMenuByName('   '), []);
  assert.deepEqual(await lookupMealboxMenuByName('Chicken Basil Rice'), []);
});

test('deleted menus never appear anywhere', async () => {
  assert.equal(await getMealboxMenuById(19), null);
  assert.equal(await getMealboxMenuById(29), null);
  assert.deepEqual(await lookupMealboxMenuByName(DELETED_NAME), []);
  const wide = await findMealboxMenusByMaxPrice(1000, { limit: 100 });
  assert.equal(wide.length, 37);
  for (const menu of wide) assert.ok(!KNOWN_DELETED_IDS.includes(menu.id));
  const exactDeletedPrice = await findMealboxMenusByExactPrice(120, { limit: 100 });
  assert.ok(!exactDeletedPrice.some((menu) => menu.id === '30'), 'deleted id 30 must stay hidden');
});

test('planner fixture price change is visible without touching menu-data', async () => {
  const fixture = writeFixture((base) => ({ ...base, prices: { ...base.prices, 14: 80 } }));
  const menus = await findMealboxMenusByExactPrice(80, { plannerPath: fixture });
  assert.ok(menus.some((menu) => menu.id === '14' && menu.price === 80));
  assert.ok(!(await findMealboxMenusByExactPrice(75, { plannerPath: fixture })).some((menu) => menu.id === '14'));
  // menu-data.js still carries the old price, proving the service did not read it.
  const menuSource = readFileSync(path.resolve('js', 'menu-data.js'), 'utf8');
  assert.match(menuSource, /\{ id: 14, name: "[^"]+", price: 75,/);
});

test('planner reload follows file edits with no restart (mtime freshness)', async () => {
  const fixture = writeFixture((base) => ({ ...base, prices: { ...base.prices, 14: 80 } }));
  assert.equal((await getMealboxMenuById(14, { plannerPath: fixture })).price, 80);
  const base = JSON.parse(readFileSync(fixture, 'utf8'));
  base.prices['14'] = 81;
  writeFileSync(fixture, JSON.stringify(base));
  const { utimesSync } = await import('node:fs');
  const later = new Date(Date.now() + 5000);
  utimesSync(fixture, later, later);
  assert.equal((await getMealboxMenuById(14, { plannerPath: fixture })).price, 81);
});

test('invalid planner content fails closed (never falls back)', async () => {
  const badPrice = writeFixture((base) => ({ ...base, prices: { ...base.prices, 14: 'แพง' } }));
  await assert.rejects(findMealboxMenusByMaxPrice(100, { plannerPath: badPrice }), MenuCatalogError);
  const negative = writeFixture((base) => ({ ...base, prices: { ...base.prices, 14: -5 } }));
  await assert.rejects(getMealboxMenuCatalog({ plannerPath: negative }), MenuCatalogError);
  const missingMap = writeFixture((base) => {
    const clone = { ...base };
    delete clone.names;
    return clone;
  });
  await assert.rejects(getMealboxMenuCatalog({ plannerPath: missingMap }), MenuCatalogError);
  const inconsistent = writeFixture((base) => {
    const prices = { ...base.prices };
    delete prices['14'];
    return { ...base, prices };
  });
  await assert.rejects(getMealboxMenuCatalog({ plannerPath: inconsistent }), MenuCatalogError);
  const badDeleted = writeFixture((base) => ({ ...base, deleted: [...base.deleted, 'not-an-id'] }));
  await assert.rejects(getMealboxMenuCatalog({ plannerPath: badDeleted }), MenuCatalogError);
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

test('category plus maxPrice composes deterministically', async () => {
  const menus = await findMealboxMenus({ category: 'ข้าวผัด', maxPrice: 70, limit: 100 });
  assert.ok(menus.length > 0);
  for (const menu of menus) {
    assert.equal(menu.category, 'ข้าวผัด');
    assert.ok(menu.price <= 70);
  }
  assert.deepEqual(await findMealboxMenus({ category: 'หมวดที่ไม่มีอยู่จริง', limit: 100 }), []);
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
  const capped = await findMealboxMenusByMaxPrice(1000, { limit: 1000 });
  assert.ok(capped.length <= 100);
  const def = await findMealboxMenusByMaxPrice(1000);
  assert.equal(def.length, 20);
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
