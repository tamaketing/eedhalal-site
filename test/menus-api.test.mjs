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

function writePlannerFixture(price14) {
  const dir = mkdtempSync(path.join(tmpdir(), 'eed-menu-api-'));
  const file = path.join(dir, 'planner-overrides.json');
  const planner = JSON.parse(readFileSync(path.resolve('data', 'planner-overrides.json'), 'utf8'));
  planner.prices['14'] = price14;
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

test('exact price 75 returns only planner price-75 menus', async () => {
  const response = await call('/api/v1/menus/mealbox?price=75');
  assert.equal(response.status, 200);
  assert.equal(response.json.serviceType, 'mealbox');
  assert.equal(response.json.source, 'planner-overrides');
  assert.deepEqual(response.json.filters, { price: 75, maxPrice: null, category: null, q: null, limit: 20 });
  assert.deepEqual(response.json.menus.map((menu) => menu.id).sort(), ['104', '14', '15', '20']);
  for (const menu of response.json.menus) assert.equal(menu.price, 75);
});

test('max price 100 caps every candidate at 100', async () => {
  const response = await call('/api/v1/menus/mealbox?maxPrice=100&limit=100');
  assert.equal(response.status, 200);
  assert.equal(response.json.menus.length, 33);
  for (const menu of response.json.menus) assert.ok(menu.price <= 100);
});

test('Thai name lookup returns the live planner price', async () => {
  const response = await call('/api/v1/menus/mealbox?q=%E0%B8%82%E0%B9%89%E0%B8%B2%E0%B8%A7%E0%B9%84%E0%B8%81%E0%B9%88%E0%B9%80%E0%B8%97%E0%B8%AD%E0%B8%A3%E0%B8%B4%E0%B8%A2%E0%B8%B2%E0%B8%81%E0%B8%B4');
  assert.equal(response.status, 200);
  assert.ok(response.json.menus.length >= 1);
  assert.equal(response.json.menus[0].id, '14');
  assert.equal(response.json.menus[0].price, 75);
});

test('unknown and deleted names return an empty factual result', async () => {
  const unknown = await call('/api/v1/menus/mealbox?q=menu-that-does-not-exist-zzz');
  assert.equal(unknown.status, 200);
  assert.deepEqual(unknown.json.menus, []);
  const deleted = await call('/api/v1/menus/mealbox?q=%E0%B8%82%E0%B9%89%E0%B8%B2%E0%B8%A7%E0%B8%A3%E0%B8%B2%E0%B8%94%E0%B8%81%E0%B8%B0%E0%B9%80%E0%B8%9E%E0%B8%A3%E0%B8%B2%E0%B8%97%E0%B8%B0%E0%B9%80%E0%B8%A5');
  assert.equal(deleted.status, 200);
  assert.deepEqual(deleted.json.menus, []);
});

test('category plus maxPrice filters compose', async () => {
  const response = await call('/api/v1/menus/mealbox?category=%E0%B8%82%E0%B9%89%E0%B8%B2%E0%B8%A7%E0%B8%9C%E0%B8%B1%E0%B8%94&maxPrice=70&limit=100');
  assert.equal(response.status, 200);
  assert.ok(response.json.menus.length > 0);
  for (const menu of response.json.menus) {
    assert.equal(menu.category, 'ข้าวผัด');
    assert.ok(menu.price <= 70);
  }
});

test('invalid query prices are rejected as 400', async () => {
  for (const bad of ['price=abc', 'price=-10', 'price=0', 'maxPrice=xyz', 'maxPrice=-5']) {
    const response = await call(`/api/v1/menus/mealbox?${bad}`);
    assert.equal(response.status, 400, bad);
  }
});

test('limits clamp: default 20, maximum 100', async () => {
  const def = await call('/api/v1/menus/mealbox?maxPrice=1000');
  assert.equal(def.status, 200);
  assert.equal(def.json.menus.length, 20);
  const capped = await call('/api/v1/menus/mealbox?maxPrice=1000&limit=1000');
  assert.equal(capped.status, 200);
  assert.ok(capped.json.menus.length <= 100);
  assert.equal(capped.json.menus.length, 37);
});

test('menu entries expose only public catalog fields', async () => {
  const response = await call('/api/v1/menus/mealbox?price=75');
  for (const menu of response.json.menus) {
    assert.deepEqual(Object.keys(menu).sort(), ['category', 'id', 'image', 'minPerMenu', 'name', 'price']);
  }
  const serialized = JSON.stringify(response.json);
  for (const leaked of ['.json', 'data/', 'C:', 'cost', 'margin', 'supplier']) {
    assert.ok(!serialized.toLowerCase().includes(leaked), `response must not disclose ${leaked}`);
  }
});

test('fixture planner path proves runtime planner authority (planner wins)', async () => {
  const fixture = writePlannerFixture(80);
  const response = await callWithPlanner('/api/v1/menus/mealbox?price=80', fixture);
  assert.equal(response.status, 200);
  assert.ok(response.json.menus.some((menu) => menu.id === '14' && menu.price === 80));
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

test('public LINE gateway exposes no menu route', () => {
  const gateway = readFileSync(path.resolve('line-ai', 'webhook-gateway.mjs'), 'utf8');
  assert.ok(!gateway.includes('menus/mealbox'));
  assert.ok(!gateway.includes('/api/v1/'));
  assert.ok(gateway.includes('/line-webhook'));
});

test('AI and n8n wiring is untouched by this step', () => {
  for (const file of [
    path.resolve('line-ai', 'conversation-update.mjs'),
    path.resolve('line-ai', 'system-prompt.md'),
    path.resolve('line-ai', 'knowledge-pack.md'),
    path.resolve('line-ai', 'system-message-node.txt'),
    path.resolve('line-ai', 'n8n-workflow.json'),
  ]) {
    const source = readFileSync(file, 'utf8');
    assert.ok(!source.includes('menus/mealbox'), `${path.basename(file)} must not reference the new endpoint yet`);
  }
});
