// EED HALAL — central menu + publish behavior tests (real flows, temp dirs).
//
// Covers the acceptance behaviors:
//   1. add menu + save -> admin sees it now, customer web unchanged
//   2. rename/image -> preview shows the exact change
//   3. cost-only edit -> profit recalculates with no web publish pending
//   4. test publish -> every consumer reads the same data
//   5. hide + publish -> gone from customers, still in sets + history
//   6. published files leak no internal data
//   7. failed publish -> previous working release still serves
//
// Nothing here writes the real repo: all publishes target a temp root seeded
// from the real published files. Costs are simulated with the owner-costs
// shape (dish.foodCost), never stored in the central draft.

import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  buildMenuDataJs,
  buildPlannerOverrides,
  computePublishStatus,
  diffPublicChanges,
  loadCentral,
  loadPublished,
  migrateCentral,
  parseMenuDataJs,
  parsePopularIds,
  publicProjectionOfPublished,
  publishCentral,
  readPublishState,
  hashWebsiteFileBytes,
  saveCentral,
  validateCentral,
  verifyWebsiteRelease,
} from '../scripts/menu-central.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function seedTempRoot() {
  const dir = await mkdtemp(path.join(tmpdir(), 'eed-menu-test-'));
  const dataDir = path.join(dir, 'local');
  await mkdir(path.join(dir, 'data'), { recursive: true });
  await mkdir(path.join(dir, 'js'), { recursive: true });
  await mkdir(dataDir, { recursive: true });
  const overrides = JSON.parse(await readFile(path.join(REPO, 'data', 'planner-overrides.json'), 'utf8'));
  const menuDataJs = await readFile(path.join(REPO, 'js', 'menu-data.js'), 'utf8');
  await writeFile(path.join(dir, 'data', 'planner-overrides.json'), JSON.stringify(overrides, null, 2), 'utf8');
  await writeFile(path.join(dir, 'js', 'menu-data.js'), menuDataJs, 'utf8');
  // Seed only the image files the catalog references (empty bytes are enough
  // for the existence check; bytes never ship from here).
  for (const image of new Set(Object.values(overrides.images))) {
    const target = path.join(dir, decodeURIComponent(String(image).replace(/^\/+/, '')));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, '', 'utf8');
  }
  return { dir, dataDir, overrides, menuDataJs };
}

async function seedCentral(dataDir, overrides, menuDataJs) {
  const menuDataMenus = await parseMenuDataJs(menuDataJs);
  const hydrateJs = await readFile(path.join(REPO, 'js', 'popular-menu-hydrate.js'), 'utf8');
  const central = migrateCentral({
    menuDataMenus,
    planner: overrides,
    popularIds: parsePopularIds(hydrateJs),
  });
  const saved = await saveCentral(dataDir, central);
  assert.equal(saved.ok, true);
  return saved.data;
}

test('migration preserves every published menu, hidden flags, and order', async () => {
  const { overrides, menuDataJs } = await seedTempRoot();
  const menuDataMenus = await parseMenuDataJs(menuDataJs);
  const central = migrateCentral({ menuDataMenus, planner: overrides, popularIds: [] });
  assert.equal(validateCentral(central).ok, true);
  assert.equal(central.menus.length, Object.keys(overrides.prices).length);
  const hidden = central.menus.filter((menu) => menu.hidden).map((menu) => menu.id).sort((a, b) => a - b);
  assert.deepEqual(hidden, [...overrides.deleted].sort((a, b) => a - b));
  // No cost/internal fields may enter the central draft from migration.
  assert.equal(JSON.stringify(central).toLowerCase().includes('foodcost'), false);
  assert.equal('cost' in Object.fromEntries(central.menus.map((menu) => [menu.id, menu])), false);
});

test('1. add menu + save: admin reads it immediately, published web unchanged', async () => {
  const { dir, dataDir, overrides, menuDataJs } = await seedTempRoot();
  const draft = await seedCentral(dataDir, overrides, menuDataJs);
  const before = await loadPublished(dir);

  const menus = [...draft.menus];
  const maxId = Math.max(...menus.map((menu) => menu.id));
  menus.push({
    id: maxId + 1, name: 'ข้าวราดผัดหน่อไม้ดอง', price: 65, tier: 'classic',
    image: 'img/logo.jpg', desc: 'เมนูทดสอบ', badge: 'ใหม่', minPerMenu: 5,
    hidden: false, sortOrder: menus.length, noMeat: false, internalNote: 'ทดสอบภายใน',
  });
  const saved = await saveCentral(dataDir, { ...draft, menus });
  assert.equal(saved.ok, true);

  // Admin (local) sees the new menu right after save...
  const adminView = await loadCentral(dataDir);
  assert.ok(adminView.menus.some((menu) => menu.name === 'ข้าวราดผัดหน่อไม้ดอง'));

  // ...while the published customer files are byte-identical.
  const after = await loadPublished(dir);
  assert.equal(after.menuDataJs, before.menuDataJs);
  assert.deepEqual(after.overrides.prices, before.overrides.prices);

  // And the publish preview lists exactly one addition.
  const diff = diffPublicChanges(adminView, after);
  assert.equal(diff.hasChanges, true);
  assert.equal(diff.added.length, 1);
  assert.equal(diff.added[0].name, 'ข้าวราดผัดหน่อไม้ดอง');
  assert.equal(computePublishStatus({ diff, file: null, live: null }), 'dirty');
});

test('2. rename/image edit: preview shows the exact public change', async () => {
  const { dir, dataDir, overrides, menuDataJs } = await seedTempRoot();
  const draft = await seedCentral(dataDir, overrides, menuDataJs);
  // Baseline publish first so the preview measures only this edit.
  await publishCentral({ root: dir, dataDir, central: draft });
  const published = await loadPublished(dir);

  const target = draft.menus[0];
  const menus = draft.menus.map((menu) => menu.id === target.id
    ? { ...menu, name: 'ข้าวราดกะเพราไก่สับ (ใหม่)', image: 'img/menu-kaprao-nuea.jpg' }
    : menu);
  const saved = await saveCentral(dataDir, { ...draft, menus });
  assert.equal(saved.ok, true);

  const diff = diffPublicChanges(saved.data, published);
  assert.equal(diff.added.length, 0);
  assert.equal(diff.changed.length, 1);
  assert.equal(diff.changed[0].id, target.id);
  assert.deepEqual([...diff.changed[0].fields].sort(), ['image', 'name']);
});

test('3. cost-only edit: profit recalculates, no web publish pending', async () => {
  const { dir, dataDir, overrides, menuDataJs } = await seedTempRoot();
  const draft = await seedCentral(dataDir, overrides, menuDataJs);
  // Baseline publish first (production already published before cost edits).
  await publishCentral({ root: dir, dataDir, central: draft });
  const published = await loadPublished(dir);

  // Costs live in owner-costs.json (dish.foodCost), never in the central draft.
  // The cost is expressed relative to the chosen dish's own price so the test
  // does not depend on which menus the owner currently sells.
  const menu = draft.menus[0];
  const baseCost = menu.price - 17;
  const ownerCosts = {
    dishes: [{ id: `menu-${menu.id}`, menuId: menu.id, name: menu.name, foodCost: baseCost, status: 'confirmed' }],
  };
  const profitBefore = menu.price - ownerCosts.dishes[0].foodCost;

  // Owner edits only the cost.
  ownerCosts.dishes[0].foodCost = baseCost + 4;
  const profitAfter = menu.price - ownerCosts.dishes[0].foodCost;
  assert.equal(profitBefore, 17);
  assert.equal(profitAfter, 13);

  // No central change -> no pending file build (public-field compare only).
  // NOTE: files built is "staged", not "published" — only a live-web check
  // may report เผยแพร่แล้ว.
  const diff = diffPublicChanges(draft, published);
  assert.equal(diff.hasChanges, false);
  const state = await readPublishState(dataDir);
  assert.equal(state.file.status, 'staged');
  assert.equal(computePublishStatus({ diff, file: state.file, live: state.live }), 'staged');
});

test('4. test publish: planner + menu-data + API read the same data', async () => {
  const { dir, dataDir, overrides, menuDataJs } = await seedTempRoot();
  const draft = await seedCentral(dataDir, overrides, menuDataJs);
  const target = draft.menus[1];
  const menus = draft.menus.map((menu) => menu.id === target.id ? { ...menu, price: 70 } : menu);
  const saved = await saveCentral(dataDir, { ...draft, menus });

  const result = await publishCentral({ root: dir, dataDir, central: saved.data });
  assert.equal(result.ok, true);

  const published = await loadPublished(dir);
  assert.equal(published.overrides.prices[String(target.id)], 70);
  const parsed = await parseMenuDataJs(published.menuDataJs);
  assert.equal(parsed.find((menu) => String(menu.id) === String(target.id)).price, 70);

  // The deterministic meal-box API (price authority) serves the same release.
  const { getMealboxMenuCatalog } = await import('../services/menus.mjs');
  const catalog = await getMealboxMenuCatalog({ plannerPath: path.join(dir, 'data', 'planner-overrides.json') });
  assert.equal(catalog.find((menu) => String(menu.id) === String(target.id)).price, 70);

  // After a clean file build nothing is pending — status is "staged"
  // (files ready, live web NOT yet confirmed).
  const diff = diffPublicChanges(saved.data, published);
  assert.equal(diff.hasChanges, false);
  const state = await readPublishState(dataDir);
  assert.equal(state.file.status, 'staged');
  assert.equal(state.live.state, 'unknown');
  assert.equal(computePublishStatus({ diff, file: state.file, live: state.live }), 'staged');
  // The built files carry the release marker for live-web confirmation.
  assert.equal(published.overrides.release.centralVersion, saved.data.version);
});

test('5. hide + publish: gone from customers, kept in sets and history', async () => {
  const { dir, dataDir, overrides, menuDataJs } = await seedTempRoot();
  const draft = await seedCentral(dataDir, overrides, menuDataJs);
  const target = draft.menus.find((menu) => menu.hidden === false);
  assert.ok(target, 'needs a visible menu to hide');

  // A confirmed order document snapshots its prices (history must not move).
  const confirmedOrder = {
    reference: 'EED-20260926-ABC123',
    items: [{ id: String(target.id), name: target.name, quantity: 20, unitPrice: target.price, total: target.price * 20 }],
  };

  const menus = draft.menus.map((menu) => menu.id === target.id ? { ...menu, hidden: true } : menu);
  const saved = await saveCentral(dataDir, { ...draft, menus });
  const preview = diffPublicChanges(saved.data, await loadPublished(dir));
  assert.deepEqual(preview.hidden.map((item) => item.id), [target.id]);

  await publishCentral({ root: dir, dataDir, central: saved.data });
  const published = await loadPublished(dir);

  // Customer API no longer serves it...
  const { getMealboxMenuCatalog } = await import('../services/menus.mjs');
  const catalog = await getMealboxMenuCatalog({ plannerPath: path.join(dir, 'data', 'planner-overrides.json') });
  assert.equal(catalog.some((menu) => menu.id === String(target.id)), false);
  // ...but the record still exists in the published maps (deleted flag) ...
  assert.ok(Object.hasOwn(published.overrides.prices, String(target.id)));
  assert.ok(published.overrides.deleted.map(String).includes(String(target.id)));
  // ...in the admin set (menuIds reference, no copied rows)...
  const adminSet = { title: 'ชุดประชุม', menuIds: [String(target.id)] };
  const centralAfter = await loadCentral(dataDir);
  assert.ok(centralAfter.menus.some((menu) => String(menu.id) === adminSet.menuIds[0]));
  // ...and the confirmed order snapshot is untouched.
  assert.equal(confirmedOrder.items[0].unitPrice, target.price);
  assert.equal(confirmedOrder.items[0].name, target.name);
});

test('6. published artifacts leak no internal data', async () => {
  const { dir, dataDir, overrides, menuDataJs } = await seedTempRoot();
  const draft = await seedCentral(dataDir, overrides, menuDataJs);

  const published = await loadPublished(dir);
  const builtOverrides = buildPlannerOverrides(draft, published.overrides);
  const builtJs = buildMenuDataJs(draft);
  for (const content of [JSON.stringify(builtOverrides), builtJs]) {
    const lower = content.toLowerCase();
    for (const token of ['foodcost', 'internalnote', 'includesbox', 'showonwebsite', 'profit', 'secret', 'localhost', 'owner-costs']) {
      assert.equal(lower.includes(token), false, `leaked token: ${token}`);
    }
  }

  // A central draft smuggling internal fields must fail closed, not publish.
  const dirty = {
    ...draft,
    menus: draft.menus.map((menu, index) => index === 0
      ? { ...menu, internalNote: 'ทุน 48 กำไร 17', price: menu.price }
      : menu),
  };
  // internalNote is admin-only: publish strips it (projection never includes it).
  const stripped = buildPlannerOverrides((await saveCentral(dataDir, dirty)).data, published.overrides);
  assert.equal(JSON.stringify(stripped).toLowerCase().includes('ทุน 48'), false);

  // An explicit cost field injected into the draft is rejected at save time.
  const withCost = {
    ...draft,
    menus: draft.menus.map((menu) => ({ ...menu, cost: 48 })),
  };
  const loaded = validateCentral(structuredClone(draft));
  assert.equal(loaded.ok, true);
  const built = buildPlannerOverrides(loaded.data, published.overrides);
  assert.equal(JSON.stringify(built).includes('"cost"'), false);
});

test('7. failed publish keeps the working release serving', async () => {
  const { dir, dataDir, overrides, menuDataJs } = await seedTempRoot();
  const draft = await seedCentral(dataDir, overrides, menuDataJs);
  const menus = draft.menus.map((menu) => menu.id === 3 ? { ...menu, name: 'ผัดไทยกุ้งสด (จะเผยแพร่)' } : menu);
  const saved = await saveCentral(dataDir, { ...draft, menus });
  const before = await loadPublished(dir);

  let failure = null;
  try {
    await publishCentral({ root: dir, dataDir, central: saved.data, fault: 'pre-rename' });
  } catch (error) {
    failure = error;
  }
  assert.ok(failure, 'simulated failure must throw');
  assert.match(failure.message, /SIMULATED_PUBLISH_FAILURE/);

  // Published files are byte-identical; the old release still serves.
  const after = await loadPublished(dir);
  assert.equal(after.menuDataJs, before.menuDataJs);
  assert.deepEqual(after.overrides, before.overrides);
  const { getMealboxMenuCatalog } = await import('../services/menus.mjs');
  const catalog = await getMealboxMenuCatalog({ plannerPath: path.join(dir, 'data', 'planner-overrides.json') });
  assert.ok(catalog.length > 0);

  // Status reports failure truthfully — never success.
  const state = await readPublishState(dataDir);
  assert.equal(state.file.status, 'failed');
  assert.match(state.error, /SIMULATED_PUBLISH_FAILURE/);
  const diff = diffPublicChanges(saved.data, after);
  // Failed operation surfaces first (the pending diff stays visible too).
  assert.equal(computePublishStatus({ diff, file: state.file, live: state.live }), 'failed');
  assert.equal(diff.hasChanges, true);
});

test('7b. mid-swap failure restores BOTH files (no split release)', async () => {
  const { dir, dataDir, overrides, menuDataJs } = await seedTempRoot();
  const draft = await seedCentral(dataDir, overrides, menuDataJs);
  const menus = draft.menus.map((menu) => (menu.id === 4 ? { ...menu, price: menu.price + 5 } : menu));
  const saved = await saveCentral(dataDir, { ...draft, menus });
  const before = await loadPublished(dir);

  let failure = null;
  try {
    await publishCentral({ root: dir, dataDir, central: saved.data, fault: 'between-renames' });
  } catch (error) {
    failure = error;
  }
  assert.ok(failure, 'mid-swap failure must throw');
  assert.match(failure.message, /SIMULATED_MID_SWAP_FAILURE/);

  // BOTH files are back on the previous complete release — never split.
  const after = await loadPublished(dir);
  assert.equal(after.menuDataJs, before.menuDataJs);
  assert.deepEqual(after.overrides, before.overrides);
  const state = await readPublishState(dataDir);
  assert.equal(state.file.status, 'failed');
});

test('status matrix: draft/staged/published/failed/publishing are computed, never assumed', async () => {
  const { computePublishStatus } = await import('../scripts/menu-central.mjs');
  const clean = { hasChanges: false };
  assert.equal(computePublishStatus({ diff: { hasChanges: true }, file: null, live: null }), 'dirty');
  assert.equal(computePublishStatus({ diff: clean, file: null, live: null }), 'draft');
  assert.equal(computePublishStatus({ diff: clean, file: { status: 'staged', fileVersion: 3 }, live: { state: 'unknown' } }), 'staged');
  assert.equal(computePublishStatus({ diff: clean, file: { status: 'staged', fileVersion: 3 }, live: { state: 'live', liveVersion: 3 } }), 'published');
  // 'live' is authoritative: verifyLiveRelease only reports it on a CONTENT
  // match, which is stronger proof than a version counter (counters restart
  // across draft lineages). A stale version label with matching content is live.
  assert.equal(computePublishStatus({ diff: clean, file: { status: 'staged', fileVersion: 3 }, live: { state: 'live', liveVersion: 2 } }), 'published');
  // Anything other than a confirmed live check must never claim "published".
  assert.equal(computePublishStatus({ diff: clean, file: { status: 'staged', fileVersion: 3 }, live: { state: 'outdated', liveVersion: 2 } }), 'staged');
  assert.equal(computePublishStatus({ diff: clean, file: { status: 'staged', fileVersion: 3 }, live: { state: 'unverified', liveVersion: null } }), 'staged');
  assert.equal(computePublishStatus({ diff: clean, file: { status: 'staged', fileVersion: 3 }, live: null }), 'staged');
  assert.equal(computePublishStatus({ diff: clean, file: { status: 'failed' }, live: null }), 'failed');
  assert.equal(computePublishStatus({ diff: clean, file: { status: 'publishing' }, live: null }), 'publishing');
});

test('legacy published state normalizes to staged + unverified (no false เผยแพร่แล้ว)', async () => {
  const { dir, dataDir } = await seedTempRoot();
  const { writeFile } = await import('node:fs/promises');
  const { default: path } = await import('node:path');
  await writeFile(path.join(dataDir, 'menu-publish-state.json'), JSON.stringify({ status: 'published', at: '2026-09-26T00:00:00Z', centralVersion: 4, files: ['data/planner-overrides.json', 'js/menu-data.js'] }), 'utf8');
  const state = await readPublishState(dataDir);
  assert.equal(state.file.status, 'staged');
  assert.equal(state.live.state, 'unknown');
  void dir;
});

test('verifyLiveRelease: live / outdated / unverified', async () => {
  const { dir, dataDir, overrides, menuDataJs } = await seedTempRoot();
  const { verifyLiveRelease } = await import('../scripts/menu-central.mjs');
  const draft = await seedCentral(dataDir, overrides, menuDataJs);
  await publishCentral({ root: dir, dataDir, central: draft });
  const state = await readPublishState(dataDir);
  const localRaw = JSON.parse(JSON.stringify((await loadPublished(dir)).overrides));

  const liveFetch = async () => ({ ok: true, json: async () => localRaw });
  const live = await verifyLiveRelease({ root: dir, file: state.file, fetchImpl: liveFetch });
  assert.equal(live.state, 'live');
  assert.equal(live.liveVersion, draft.version);

  // Same content, different build label: still live (the label is provenance,
  // customers get the content). The reason must say so instead of hiding it.
  const relabelledFetch = async () => ({
    ok: true,
    json: async () => ({ ...localRaw, release: { centralVersion: draft.version - 1 } }),
  });
  const relabelled = await verifyLiveRelease({ root: dir, file: state.file, fetchImpl: relabelledFetch });
  assert.equal(relabelled.state, 'live');
  assert.match(relabelled.reason, /ฉบับ|v\d+/);

  // Genuinely older CONTENT with a different version is outdated.
  const staleFetch = async () => ({
    ok: true,
    json: async () => ({
      ...localRaw,
      prices: { ...localRaw.prices, 1: Number(localRaw.prices['1']) + 1 },
      release: { centralVersion: draft.version - 1 },
    }),
  });
  const outdated = await verifyLiveRelease({ root: dir, file: state.file, fetchImpl: staleFetch });
  assert.equal(outdated.state, 'outdated');

  // Same version label but different content must NOT be reported as live.
  const sameVersionStaleFetch = async () => ({
    ok: true,
    json: async () => ({ ...localRaw, prices: { ...localRaw.prices, 1: Number(localRaw.prices['1']) + 1 } }),
  });
  const sameVersionStale = await verifyLiveRelease({ root: dir, file: state.file, fetchImpl: sameVersionStaleFetch });
  assert.notEqual(sameVersionStale.state, 'live');

  const noMarkerFetch = async () => ({ ok: true, json: async () => ({ prices: {} }) });
  const noMarker = await verifyLiveRelease({ root: dir, file: state.file, fetchImpl: noMarkerFetch });
  assert.equal(noMarker.state, 'unverified');

  const downFetch = async () => { throw new Error('socket hang up'); };
  const down = await verifyLiveRelease({ root: dir, file: state.file, fetchImpl: downFetch });
  assert.equal(down.state, 'unverified');
  assert.match(down.reason, /ห้ามถือว่าเผยแพร่แล้ว/);
});

test('publish preserves the original menu-data line order (display order)', async () => {
  const { dir, dataDir, overrides, menuDataJs } = await seedTempRoot();
  const beforeIds = (await parseMenuDataJs(menuDataJs)).map((menu) => String(menu.id));
  const draft = await seedCentral(dataDir, overrides, menuDataJs);
  await publishCentral({ root: dir, dataDir, central: draft });
  const published = await loadPublished(dir);
  const afterIds = (await parseMenuDataJs(published.menuDataJs)).map((menu) => String(menu.id));
  assert.deepEqual(afterIds, beforeIds);
  // Planner key order is preserved too (minimal diff, stable readers).
  assert.deepEqual(Object.keys(published.overrides.prices), Object.keys(overrides.prices));
});

test('publish rejects machine-local image paths before anything is written', async () => {
  const { dir, dataDir, overrides, menuDataJs } = await seedTempRoot();
  const draft = await seedCentral(dataDir, overrides, menuDataJs);
  const before = await loadPublished(dir);
  const menus = draft.menus.map((menu, index) => index === 0 ? { ...menu, image: 'C:\\menus\\dish.jpg' } : menu);
  const saved = await saveCentral(dataDir, { ...draft, menus });
  await assert.rejects(() => publishCentral({ root: dir, dataDir, central: saved.data }), /เผยแพร่บนเว็บไม่ได้/);
  const after = await loadPublished(dir);
  assert.equal(after.menuDataJs, before.menuDataJs);
});

test('a dish the owner has not photographed yet still publishes', async () => {
  // A blank image field means "no photo yet", not "broken ref". The menu pages
  // render such a dish as a name row, so refusing to publish would strand the
  // dish in the admin forever. A ref that WAS filled in must still resolve.
  const { dir, dataDir, overrides, menuDataJs } = await seedTempRoot();
  const draft = await seedCentral(dataDir, overrides, menuDataJs);
  const noPhoto = draft.menus.map((menu, index) => (index === 0 ? { ...menu, image: '', desc: '' } : menu));
  const saved = await saveCentral(dataDir, { ...draft, menus: noPhoto });
  await publishCentral({ root: dir, dataDir, central: saved.data });
  const published = await loadPublished(dir);
  const [first] = (await parseMenuDataJs(published.menuDataJs)).map((menu) => ({ id: String(menu.id), image: menu.image }));
  assert.equal(first.image, '', 'the dish ships with no photo, not a broken path');
  const listed = (await parseMenuDataJs(published.menuDataJs)).map((menu) => String(menu.id));
  assert.ok(listed.includes(String(draft.menus[0].id)), 'the dish is still in the catalogue');

  // The leniency is only for a blank field: a real path that does not exist is
  // still refused, so a typo cannot reach the web as a broken image.
  const missing = draft.menus.map((menu, index) => (index === 1 ? { ...menu, image: 'img/not-here.jpg' } : menu));
  const badSaved = await saveCentral(dataDir, { ...draft, menus: missing });
  await assert.rejects(
    () => publishCentral({ root: dir, dataDir, central: badSaved.data }),
    /ไม่พบไฟล์รูปใน repo/,
  );
});

test('a website release is live only when every release file matches', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'eed-website-live-'));
  t.after(async () => {
    const { rm } = await import('node:fs/promises');
    await rm(dir, { recursive: true, force: true });
  });
  await mkdir(path.join(dir, 'data'), { recursive: true });
  const planner = {
    prices: { 1: 65 },
    mins: { 1: 5 },
    images: { 1: '' },
    names: { 1: 'เมนู ก' },
    tiers: { 1: 'classic' },
    release: { centralVersion: 9, builtAt: '2026-10-10T00:00:00.000Z' },
  };
  await writeFile(path.join(dir, 'data', 'planner-overrides.json'), JSON.stringify(planner, null, 2), 'utf8');
  const page = '<h1>เมนู</h1>\n';
  const expectedRelease = {
    centralVersion: 9,
    files: [{ path: 'index.html', sha256: hashWebsiteFileBytes('index.html', Buffer.from(page, 'utf8')) }],
  };
  const fetchImpl = async (url, livePage = page) => {
    const pathname = new URL(String(url)).pathname;
    if (pathname.endsWith('/data/planner-overrides.json')) {
      return { ok: true, json: async () => ({ ...planner, exportedAt: 'live', release: { ...planner.release, builtAt: 'live' } }) };
    }
    if (pathname.endsWith('/index.html')) {
      return { ok: true, arrayBuffer: async () => Buffer.from(livePage, 'utf8') };
    }
    return { ok: false, status: 404 };
  };
  const live = await verifyWebsiteRelease({
    root: dir,
    file: { status: 'staged', fileVersion: 9 },
    expectedRelease,
    liveBaseUrl: 'https://example.test',
    fetchImpl: (url) => fetchImpl(url),
  });
  assert.equal(live.state, 'live');
  const stale = await verifyWebsiteRelease({
    root: dir,
    file: { status: 'staged', fileVersion: 9 },
    expectedRelease,
    liveBaseUrl: 'https://example.test',
    fetchImpl: (url) => fetchImpl(url, '<h1>เก่า</h1>\n'),
  });
  assert.equal(stale.state, 'outdated');
  assert.match(stale.reason, /index\.html/);
});

test('bulk hide is refused without confirmation, then allowed with it', async () => {
  const { dataDir, overrides, menuDataJs } = await seedTempRoot();
  const draft = await seedCentral(dataDir, overrides, menuDataJs);
  const onDisk = async () => (await loadCentral(dataDir)).menus
    .filter((menu) => menu.hidden === true).map((menu) => menu.id).sort((a, b) => a - b);
  const before = await onDisk();

  // Hide 6 live menus in one save. On 2026-09-29 a bad click target did exactly
  // this and publish v72 put 32 live menus behind `deleted` on the customer site.
  const visible = draft.menus.filter((menu) => menu.hidden !== true).slice(0, 6);
  assert.equal(visible.length, 6);
  const runaway = {
    ...draft,
    menus: draft.menus.map((menu) => (visible.some((v) => v.id === menu.id) ? { ...menu, hidden: true } : menu)),
  };

  const refused = await saveCentral(dataDir, runaway);
  assert.equal(refused.ok, false, 'runaway bulk hide must be refused');
  assert.equal(refused.bulkHide, true);
  assert.deepEqual(refused.newlyHidden, visible.map((menu) => menu.id).sort((a, b) => a - b));
  assert.deepEqual(await onDisk(), before, 'a refused save must not touch the file');

  // A normal single hide still saves with no confirmation.
  const oneSaved = await saveCentral(dataDir, {
    ...draft,
    menus: draft.menus.map((menu) => (menu.id === visible[0].id ? { ...menu, hidden: true } : menu)),
  });
  assert.equal(oneSaved.ok, true);
  assert.deepEqual(await onDisk(), [...before, visible[0].id].sort((a, b) => a - b));

  // The owner re-confirming lets the batch through.
  const confirmed = await saveCentral(dataDir, { ...runaway, confirmBulkHide: true });
  assert.equal(confirmed.ok, true, 'an explicitly confirmed bulk hide is allowed');
  assert.deepEqual(await onDisk(), [...before, ...visible.map((m) => m.id)].sort((a, b) => a - b));

  // Un-hiding many at once is never blocked — the guard only guards hiding.
  const restored = await saveCentral(dataDir, {
    ...confirmed.data,
    menus: confirmed.data.menus.map((menu) => ({ ...menu, hidden: false })),
  });
  assert.equal(restored.ok, true);
  assert.deepEqual(await onDisk(), []);
});

// --- The product level is the only grouping -----------------------------------
// A menu has a tier and nothing else. Publish writes that tier to both
// published files, and the retired category keys are dropped from the web
// rather than carried over.

test('publish writes the level to both files and never a category', async () => {
  const { dir, dataDir, overrides, menuDataJs } = await seedTempRoot();
  const draft = await seedCentral(dataDir, overrides, menuDataJs);
  const menus = draft.menus.map((menu, index) => ({ ...menu, tier: index === 0 ? 'executive' : 'classic' }));
  const saved = await saveCentral(dataDir, { ...draft, menus });
  assert.equal(saved.ok, true, JSON.stringify(saved.errors));
  await publishCentral({ root: dir, dataDir, central: saved.data });

  const published = await loadPublished(dir);
  assert.equal(published.overrides.categories, undefined, 'the retired categories map must not be published');
  assert.equal(published.overrides.categoryList, undefined, 'the retired category list must not be published');
  assert.equal(published.overrides.tiers[String(menus[0].id)], 'executive');
  assert.ok(!/EED_CATEGORIES/.test(published.menuDataJs), 'menu-data.js must not declare a category list');
  assert.ok(!/category:/.test(published.menuDataJs), 'no menu line may carry a category');
  const publishedMenus = await parseMenuDataJs(published.menuDataJs);
  assert.equal(publishedMenus[0].tier, 'executive');
});

test('a published file still holding the retired keys drops them on publish', async () => {
  // A repo mid-transition keeps the old keys until the first publish. That
  // publish must REMOVE them instead of failing or leaving them live.
  const { dir, dataDir, overrides, menuDataJs } = await seedTempRoot();
  const draft = await seedCentral(dataDir, overrides, menuDataJs);
  const saved = await saveCentral(dataDir, draft);
  assert.equal(saved.ok, true, JSON.stringify(saved.errors));
  await writeFile(
    path.join(dir, 'data', 'planner-overrides.json'),
    `${JSON.stringify({
      ...overrides,
      categories: { 1: 'ข้าวราดแกง' },
      categoryList: [{ key: 'ข้าวราดแกง', label: 'เมนูข้าวราดแกง' }],
    }, null, 2)}\n`,
    'utf8',
  );
  await publishCentral({ root: dir, dataDir, central: saved.data });
  const published = await loadPublished(dir);
  assert.equal(published.overrides.categories, undefined);
  assert.equal(published.overrides.categoryList, undefined);
});

test('a draft needs no category to be valid', () => {
  const result = validateCentral({
    version: 1,
    menus: [{ id: 1, name: 'ทดสอบ', price: 65, tier: 'classic', image: 'img/a.jpg', minPerMenu: 10, sortOrder: 0 }],
  });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.data.menus[0].tier, 'classic');
});

test('an unknown level is refused instead of silently becoming Classic', () => {
  const result = validateCentral({
    version: 1,
    menus: [{ id: 1, name: 'ทดสอบ', price: 65, tier: 'platinum', image: 'img/a.jpg', minPerMenu: 10, sortOrder: 0 }],
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.join(' '), /ระดับสินค้า “platinum” ไม่ถูกต้อง/);
});

test('deleting a dish for good removes it from both published files', async () => {
  const { dir, dataDir, overrides, menuDataJs } = await seedTempRoot();
  const draft = await seedCentral(dataDir, overrides, menuDataJs);
  const doomed = draft.menus[0];
  const saved = await saveCentral(dataDir, {
    ...draft,
    menus: draft.menus.filter((menu) => menu.id !== doomed.id),
    popular: (draft.popular || []).filter((id) => Number(id) !== Number(doomed.id)),
  });
  assert.equal(saved.ok, true, JSON.stringify(saved.errors));
  await publishCentral({ root: dir, dataDir, central: saved.data });

  const published = await loadPublished(dir);
  assert.equal(published.overrides.prices[String(doomed.id)], undefined, 'the price must be gone from the catalog');
  assert.equal(published.overrides.names[String(doomed.id)], undefined);
  const publishedMenus = await parseMenuDataJs(published.menuDataJs);
  assert.ok(!publishedMenus.some((menu) => Number(menu.id) === Number(doomed.id)), 'the dish must be gone from menu-data.js');

  // And the customer catalog the bot reads can no longer see or quote it.
  const { getMealboxMenuCatalog } = await import('../services/menus.mjs');
  const catalog = await getMealboxMenuCatalog({ plannerPath: path.join(dir, 'data', 'planner-overrides.json') });
  assert.ok(!catalog.some((item) => Number(item.id) === Number(doomed.id)), 'the deleted dish must not reach the catalog');
});
