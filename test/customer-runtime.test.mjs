import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [popularMenu, snackHydrate, snackBuilder] = await Promise.all([
  readFile(new URL('../js/popular-menu-hydrate.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/snack-hydrate.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/snack-builder.js', import.meta.url), 'utf8'),
]);

test('popular menu applies the complete catalog override shape', () => {
  for (const field of ['prices', 'mins', 'images', 'names', 'categories', 'deleted', 'newMenus']) {
    assert.match(popularMenu, new RegExp(field));
  }
  assert.match(popularMenu, /function applyCatalog/);
});

test('snack builder recalculates after hydration and uses delivery zones', () => {
  assert.match(snackHydrate, /snackCatalogHydrated/);
  assert.doesNotMatch(snackHydrate, /var rendered = false/);
  assert.match(snackBuilder, /function getShipping/);
  assert.match(snackBuilder, /shippingZoneFreeThresholds/);
  assert.match(snackBuilder, /sbDeliveryZone/);
});
