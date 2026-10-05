import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { computeTierFloors, setsFromPlanner } from '../scripts/mealbox-tiers.mjs';

// The browser reads the tier floors from the published catalogue, not from a
// baked figure in js/business-data.js. This runs that loader against the real
// planner-overrides.json and requires it to agree with the build-time rule.

const root = new URL('../', import.meta.url);
const source = await readFile(new URL('js/business-data.js', root), 'utf8');
const planner = JSON.parse(await readFile(new URL('data/planner-overrides.json', root), 'utf8'));

function run({ failFetch = false } = {}) {
  const elements = new Map();
  const document = {
    readyState: 'complete',
    querySelectorAll: () => [],
    querySelector: () => null,
  };
  const context = {
    document,
    window: { location: {} },
    console,
    Promise,
    JSON,
    Date,
    Object,
    Array,
    String,
    Number,
    Boolean,
    Set,
    Map,
    fetch: failFetch
      ? async () => { throw new Error('offline'); }
      : async () => ({ ok: true, json: async () => planner }),
  };
  context.window.document = document;
  context.globalThis = context;
  vm.runInNewContext(source, context);
  return context.EED;
}

test('the runtime loader reproduces the catalogue floors', async () => {
  const eed = run();
  await eed.tiersReady;
  const floors = computeTierFloors(setsFromPlanner(planner)).floors;
  assert.deepEqual(Object.keys(eed.tiers).sort(), Object.keys(floors).filter((id) => floors[id]).sort());
  assert.equal(Number(eed.tiers.classic.priceFrom), floors.classic.priceFrom);
  assert.equal(eed.tiers.classic.sourceName, floors.classic.sourceName);
  assert.equal(Number(eed.tiers.executive.priceFrom), floors.executive.priceFrom);
  assert.equal(eed.startingPrice, String(floors.classic.priceFrom));
});

test('no price is baked into the generated business data', async () => {
  const eed = run();
  await eed.tiersReady;
  assert.equal(eed.premiumPriceFrom, undefined, 'the retired premium field must be gone');
  assert.equal(eed.startingPrice, String(computeTierFloors(setsFromPlanner(planner)).floors.classic.priceFrom));
  assert.doesNotMatch(source, /startingPrice:\s*'\d/, 'the generated file must not carry a typed price');
});

test('a failed fetch leaves no price rather than an old one', async () => {
  const eed = run({ failFetch: true });
  await eed.tiersReady;
  assert.equal(eed.startingPrice, null, 'no catalogue means no price, never a fallback');
});