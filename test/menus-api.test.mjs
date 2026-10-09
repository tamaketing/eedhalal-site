import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { createMemoryAdapter } from '../db/memory.mjs';
import { createInternalApi } from '../server/internal-api.mjs';
import { clearMenuCache } from '../services/menus.mjs';

const SECRET = randomUUID();

const { server } = createInternalApi({ repos: createMemoryAdapter(), env: { EED_INTERNAL_API_SECRET: SECRET } });
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => new Promise((resolve) => server.close(resolve)));

async function call(pathname, { secret = SECRET } = {}) {
  const headers = {};
  if (secret !== null) headers.authorization = `Bearer ${secret}`;
  const response = await fetch(`${base}${pathname}`, { headers });
  return { status: response.status, json: await response.json() };
}

// The owner publishes the menu in batches, so expected results are derived from
// the currently published planner file instead of frozen ids/prices.
const published = () => JSON.parse(readFileSync(path.resolve('data', 'planner-overrides.json'), 'utf8'));
// Orderable = published, minus owner-hidden, minus ask-for-quote.
const activeEntries = (planner = published()) => {
  const hidden = new Set((planner.deleted || []).map(String));
  const quoteOnly = new Set((planner.quoteOnly || []).map(String));
  return Object.entries(planner.prices).filter(
    ([id]) => !hidden.has(String(id)) && !quoteOnly.has(String(id)),
  );
};
const firstActive = (planner = published()) => activeEntries(planner)[0];
const nameOf = (id, planner = published()) => planner.names[String(id)];

function writePlannerFixture(newPrice) {
  const dir = mkdtempSync(path.join(tmpdir(), 'eed-menu-api-'));
  const file = path.join(dir, 'planner-overrides.json');
  const planner = JSON.parse(readFileSync(path.resolve('data', 'planner-overrides.json'), 'utf8'));
  // Patch the first PUBLISHED menu so the fixture works whatever batch is live.
  planner.prices[(firstActive()[0])] = newPrice;
  writeFileSync(file, JSON.stringify(planner));
  clearMenuCache(file);
  return file;
}

async function callWithPlanner(pathname, plannerPath) {
  const secret = randomUUID();
  const api = createInternalApi({
    repos: createMemoryAdapter(),
    env: { EED_INTERNAL_API_SECRET: secret, EED_PLANNER_PATH: plannerPath },
  });
  await new Promise((resolve) => api.server.listen(0, '127.0.0.1', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${api.server.address().port}${pathname}`, {
      headers: { authorization: `Bearer ${secret}` },
    });
    return { status: response.status, json: await response.json() };
  } finally {
    await new Promise((resolve) => api.server.close(resolve));
  }
}

test('exact price returns exactly the published planner menus at that price', async () => {
  const planner = published();
  const [id, price] = firstActive(planner);
  const response = await call(`/api/v1/menus/mealbox?price=${price}&limit=100`);
  assert.equal(response.status, 200);
  assert.equal(response.json.serviceType, 'mealbox');
  assert.equal(response.json.source, 'planner-overrides');
  assert.deepEqual(response.json.filters, { price, maxPrice: null, tier: null, q: null, limit: 100 });
  const expected = activeEntries(planner)
    .filter(([, value]) => value === price)
    .map(([menuId]) => String(menuId))
    .sort();
  assert.deepEqual(response.json.menus.map((menu) => menu.id).sort(), expected);
  assert.ok(response.json.menus.some((menu) => menu.id === String(id)));
  for (const menu of response.json.menus) assert.equal(menu.price, price);
});

test('max price caps every candidate and matches the published planner', async () => {
  const planner = published();
  const cap = 100;
  const response = await call(`/api/v1/menus/mealbox?maxPrice=${cap}&limit=100`);
  assert.equal(response.status, 200);
  const expected = activeEntries(planner).filter(([, price]) => price <= cap).length;
  assert.equal(response.json.menus.length, Math.min(expected, 100));
  for (const menu of response.json.menus) assert.ok(menu.price <= cap);
});

test('Thai name lookup returns the live planner price', async () => {
  const planner = published();
  const [id] = firstActive(planner);
  const name = nameOf(id, planner);
  const response = await call(`/api/v1/menus/mealbox?q=${encodeURIComponent(name)}`);
  assert.equal(response.status, 200);
  assert.ok(response.json.menus.length >= 1, `no result for active menu ${id}`);
  assert.equal(response.json.menus[0].id, String(id));
  assert.equal(response.json.menus[0].price, planner.prices[String(id)]);
});

test('unknown, hidden and ask-for-quote menus never resolve, by id or by name', async () => {
  const unknown = await call('/api/v1/menus/mealbox?q=menu-that-does-not-exist-zzz');
  assert.equal(unknown.status, 200);
  assert.deepEqual(unknown.json.menus, []);

  // The live planner has no price-switched dish, so build a fixture that has
  // one and serve it through a second API instance. A quote-only dish must stay
  // invisible to ordering no matter how the customer asks for it.
  const base = published();
  const blockedId = activeEntries(base)[0][0];
  assert.ok(blockedId, 'fixture must expose at least one orderable menu');
  const dir = mkdtempSync(path.join(tmpdir(), 'eed-menu-quote-only-'));
  const fixture = path.join(dir, 'planner-overrides.json');
  writeFileSync(fixture, JSON.stringify({ ...base, quoteOnly: [blockedId] }));

  const { server: quoted } = createInternalApi({
    repos: createMemoryAdapter(),
    env: { EED_INTERNAL_API_SECRET: SECRET, EED_PLANNER_PATH: fixture },
  });
  await new Promise((resolve) => quoted.listen(0, '127.0.0.1', resolve));
  try {
    const quotedBase = `http://127.0.0.1:${quoted.address().port}`;
    const ask = async (query) => {
      const response = await fetch(`${quotedBase}/api/v1/menus/mealbox?${query}&limit=100`, {
        headers: { authorization: `Bearer ${SECRET}` },
      });
      assert.equal(response.status, 200);
      return response.json();
    };
    const name = base.names[blockedId];
    assert.ok(name, 'the blocked dish must have a name to look up');
    const byName = await ask(`q=${encodeURIComponent(name)}`);
    assert.ok(
      !byName.menus.some((menu) => menu.id === String(blockedId)),
      `quote-only menu ${blockedId} must not resolve by name`,
    );
    const byPrice = await ask(`price=${base.prices[blockedId]}`);
    assert.ok(
      !byPrice.menus.some((menu) => menu.id === String(blockedId)),
      `quote-only menu ${blockedId} must not resolve by its own price`,
    );
    const wide = await ask('maxPrice=100000');
    assert.ok(
      !wide.menus.some((menu) => menu.id === String(blockedId)),
      `quote-only menu ${blockedId} must not leak into the full list`,
    );
  } finally {
    await new Promise((resolve) => quoted.close(resolve));
  }
});

test('level plus maxPrice filters compose', async () => {
  const planner = published();
  const active = activeEntries(planner);
  const [tier] = [...new Set(active.map(([id]) => planner.tiers[id]))];
  const cap = Math.max(...active.map(([id]) => planner.prices[id]));
  const response = await call(`/api/v1/menus/mealbox?tier=${encodeURIComponent(tier)}&maxPrice=${cap}&limit=100`);
  assert.equal(response.status, 200);
  assert.equal(response.json.filters.tier, tier);
  const expected = active
    .filter(([id]) => planner.tiers[id] === tier && planner.prices[id] <= cap)
    .map(([id]) => String(id)).sort();
  assert.deepEqual(response.json.menus.map((menu) => menu.id).sort(), expected);
  for (const menu of response.json.menus) {
    assert.equal(menu.tier, tier);
    assert.ok(menu.price <= cap);
  }
});

test('an unknown level is rejected as 400, not treated as no match', async () => {
  for (const bad of ['platinum', encodeURIComponent('ข้าวราดแกง')]) {
    const response = await call(`/api/v1/menus/mealbox?tier=${bad}`);
    assert.equal(response.status, 400, bad);
  }
});

test('invalid query prices are rejected as 400', async () => {
  for (const bad of ['price=abc', 'price=-10', 'price=0', 'maxPrice=xyz', 'maxPrice=-5']) {
    const response = await call(`/api/v1/menus/mealbox?${bad}`);
    assert.equal(response.status, 400, bad);
  }
});

test('limits clamp: default 20, maximum 100', async () => {
  // Clamp values are code contracts; how many rows come back depends on how many
  // menus the owner currently publishes.
  const activeCount = activeEntries().length;
  const def = await call('/api/v1/menus/mealbox?maxPrice=1000000');
  assert.equal(def.status, 200);
  assert.equal(def.json.menus.length, Math.min(20, activeCount));
  const capped = await call('/api/v1/menus/mealbox?maxPrice=1000000&limit=1000');
  assert.equal(capped.status, 200);
  assert.ok(capped.json.menus.length <= 100);
  assert.equal(capped.json.menus.length, Math.min(100, activeCount));
});

test('menu entries expose only public catalog fields', async () => {
  const response = await call('/api/v1/menus/mealbox?price=75');
  for (const menu of response.json.menus) {
    assert.deepEqual(Object.keys(menu).sort(), ['id', 'image', 'minPerMenu', 'name', 'price', 'tier']);
  }
  const serialized = JSON.stringify(response.json);
  for (const leaked of ['.json', 'data/', 'C:', 'cost', 'margin', 'supplier']) {
    assert.ok(!serialized.toLowerCase().includes(leaked), `response must not disclose ${leaked}`);
  }
});

test('fixture planner path proves runtime planner authority (planner wins)', async () => {
  const planner = published();
  const id = String(firstActive(planner)[0]);
  const fixture = writePlannerFixture(80);
  const response = await callWithPlanner(`/api/v1/menus/mealbox?price=80`, fixture);
  assert.equal(response.status, 200);
  assert.ok(
    response.json.menus.some((menu) => menu.id === id && menu.price === 80),
    `the patched menu ${id} must be served from the fixture planner`,
  );
  // The real published file is untouched by the fixture.
  const after = published();
  assert.notEqual(after.prices[id], 80, 'the fixture must not write to the real planner file');
});

test('corrupt planner fails closed with no stale menu data', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'eed-menu-api-'));
  const broken = path.join(dir, 'planner-overrides.json');
  writeFileSync(broken, '{ broken');
  const response = await callWithPlanner('/api/v1/menus/mealbox?price=75', broken);
  assert.equal(response.status, 500);
  assert.deepEqual(response.json, { error: 'internal_error' });
  const missing = await callWithPlanner(
    '/api/v1/menus/mealbox?price=75',
    path.join(dir, 'does-not-exist.json'),
  );
  assert.equal(missing.status, 500);
  assert.deepEqual(missing.json, { error: 'internal_error' });
});

test('unauthenticated menu queries are rejected', async () => {
  const response = await call('/api/v1/menus/mealbox?price=75', { secret: null });
  assert.equal(response.status, 401);
  const wrong = await call('/api/v1/menus/mealbox?price=75', { secret: 'wrong' });
  assert.equal(wrong.status, 401);
});

test('the menu catalogue stays a local file read, never a baked copy', () => {
  const service = readFileSync(path.resolve('services', 'menus.mjs'), 'utf8');
  assert.ok(service.includes('planner-overrides.json'), 'the catalogue is read from the central planner file');
  assert.ok(!service.includes('menus/mealbox'), 'the service is not self-referential');
});
