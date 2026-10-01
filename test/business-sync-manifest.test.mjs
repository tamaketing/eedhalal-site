import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import test from 'node:test';
import {
  checkBusinessSync,
  FORBIDDEN_SCAN_SKIP_DIRS,
  plannerMinPriceWhereNameStartsWith,
  plannerPricesWhereNameStartsWith,
} from '../scripts/check-business-sync.mjs';

const root = new URL('../', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('data/sync-manifest.json', root), 'utf8'));
const planner = JSON.parse(await readFile(new URL('data/planner-overrides.json', root), 'utf8'));

test('every business fact is present in all registered files (edit ALL files on change)', async () => {
  await checkBusinessSync();
});

// The khao-mok landing pages once advertised four different numbers for the same
// three dishes: 85 in prose, 90 in JSON-LD prices, 90 in the offer range and 100
// in offer names. These tests pin the guard so that cannot happen again.
const khaoMokPrices = plannerPricesWhereNameStartsWith(planner, 'ข้าวหมก');

test('the khao-mok starting price resolves from the published catalogue', () => {
  const min = plannerMinPriceWhereNameStartsWith(planner, 'ข้าวหมก');
  assert.equal(min, 85);
  // It must be the cheapest, taken from real data rather than restated.
  const khaoMok = Object.entries(planner.names)
    .filter(([, name]) => name.startsWith('ข้าวหมก'))
    .map(([id]) => Number(planner.prices[id]));
  assert.equal(min, Math.min(...khaoMok));
  assert.ok(khaoMok.length >= 2, 'fixture must have more than one khao-mok dish');
});

test('the starting-price resolver refuses a prefix that matches nothing', () => {
  assert.throws(
    () => plannerMinPriceWhereNameStartsWith(planner, 'เมนูไม่มีจริง'),
    /no published dish name starts with/,
  );
});

test('the catalogue price set for a dish family is exactly what is sold', () => {
  assert.deepEqual(khaoMokPrices, [85, 110, 150, 180, 200]);
  assert.throws(
    () => plannerPricesWhereNameStartsWith(planner, 'เมนูไม่มีจริง'),
    /no published dish name starts with/,
  );
});

test('both khao-mok landing pages are guarded against invented prices', async () => {
  const rule = manifest.cataloguePrices?.find((entry) => entry.id === 'khao-mok');
  assert.ok(rule, 'the khao-mok landing pages must be guarded by cataloguePrices');
  assert.equal(rule.prefix, 'ข้าวหมก');
  for (const file of ['khao-mok.html', 'en/khao-mok.html']) {
    assert.ok(rule.files.includes(file), `${file} quotes prices and must be registered`);
  }
});

test('a wrong price in prose or JSON-LD is caught on either language page', async (t) => {
  const cases = [
    ['khao-mok.html', 'เริ่ม 85 บาท', 'เริ่ม 90 บาท', 'prose drifting back to the old figure'],
    ['khao-mok.html', '"price": "150.00"', '"price": "90.00"', 'a JSON-LD price that was never sold'],
    ['khao-mok.html', '"highPrice": "180"', '"highPrice": "90"', 'an offer range floor that was never sold'],
    ['en/khao-mok.html', 'starting at 85 THB per box', 'starting at 90 THB per box', 'English meta drifting back'],
    ['en/khao-mok.html', '150 THB / box', '99 THB / box', 'an English card price that was never sold'],
  ];

  for (const [file, from, to] of cases) {
    const url = new URL(file, root);
    const original = await readFile(url, 'utf8');
    t.after(async () => { await writeFile(url, original, 'utf8'); });
    assert.ok(original.includes(from), `fixture must contain "${from}" in ${file}`);
    await writeFile(url, original.replace(from, to), 'utf8');
    await assert.rejects(checkBusinessSync(), `${file}: ${from} -> ${to} must be caught`);
    await writeFile(url, original, 'utf8');
  }
});

test('the khao-mok starting price is a tracked fact on every page that states it', () => {
  const fact = manifest.facts.find((entry) => entry.id === 'khao-mok-starting-price');
  assert.ok(fact, 'the khao-mok starting price must be a tracked fact');
  assert.match(fact.source, /planner\.minPriceWhereNameStartsWith:/);
  for (const file of ['khao-mok.html', 'blog/khao-mok-halal-explained.html', 'faq.html']) {
    assert.ok(fact.files.includes(file), `${file} states the price and must be registered`);
  }
  // Plus a forbidden rule, because a page may repeat the figure many times and
  // the positive check only proves the right value appears somewhere.
  const rule = manifest.forbidden.find((entry) => entry.id === 'stale-khao-mok-starting-price');
  assert.ok(rule, 'a forbidden rule must block the stale figures');
  assert.match(rule.pattern, /\(?!85\\b\)/, 'the rule must reject any figure other than the real one');
});

test('generated snapshots and the owner\'s private draft are not scanned for drift', async () => {
  // artifacts/ keeps the numbers it captured on purpose, and demo/ is the
  // owner's private draft. Neither is content anyone edits to satisfy this
  // check, so a forbidden string in them must not be reported as drift.
  assert.ok(FORBIDDEN_SCAN_SKIP_DIRS.has('artifacts'));
  assert.ok(FORBIDDEN_SCAN_SKIP_DIRS.has('demo'));
  const summary = await checkBusinessSync();
  assert.ok(summary.scanned > 0);
  assert.ok(summary.cataloguePages >= 2);
});