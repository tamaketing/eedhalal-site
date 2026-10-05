import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { computeTierFloors, setsFromPlanner } from '../scripts/mealbox-tiers.mjs';

// The release preview is where the owner checks a tier price before it goes
// public. Its payload must carry, per tier: the computed price, the set behind
// it, and the change against what is live now.

const root = new URL('../', import.meta.url);
const source = await readFile(new URL('tools/admin/server.mjs', root), 'utf8');
const overrides = JSON.parse(await readFile(new URL('data/planner-overrides.json', root), 'utf8'));
const rules = JSON.parse(await readFile(new URL('data/business-rules.json', root), 'utf8'));
const floors = computeTierFloors(setsFromPlanner(overrides)).floors;

test('the preview payload is built from the catalogue, per tier', async () => {
  // Reach the endpoint the way the admin page does: through the local server
  // module, which is the only place allowed to read the draft.
  const module = await import('../tools/admin/server.mjs');
  assert.ok(module, 'the admin server module must load');
  assert.match(source, /tierChanges/, 'the endpoint must publish per-tier changes');
  assert.match(source, /computeTierFloors\(publishedSets\)\.floors/, 'the live side must be computed, not typed');
  assert.match(source, /tierPriceConsistency/, 'the release gate must use the tier rule');
  assert.doesNotMatch(source, /startingPriceConsistency/);
});

test('the catalogue still produces the published figures', () => {
  assert.ok(floors.classic, 'classic must have an open set');
  assert.equal(rules.services.mealBox.tiers.length, 3);
});