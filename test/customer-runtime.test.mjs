import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import test from 'node:test';

const [popularMenu, snackHydrate] = await Promise.all([
  readFile(new URL('../js/popular-menu-hydrate.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/snack-hydrate.js', import.meta.url), 'utf8'),
]);

async function missing(url) {
  try {
    await stat(new URL(url, import.meta.url));
    return false;
  } catch {
    return true;
  }
}

test('popular menu applies the complete catalog override shape', () => {
  for (const field of ['prices', 'mins', 'images', 'names', 'categories', 'deleted', 'newMenus']) {
    assert.match(popularMenu, new RegExp(field));
  }
  assert.match(popularMenu, /function applyCatalog/);
});

test('snack hydrate renders the product listing and uses delivery zones', () => {
  assert.match(snackHydrate, /snackCatalogHydrated/);
  assert.doesNotMatch(snackHydrate, /var rendered = false/);
});

// Retired 2026-09-24: calculators are product pages now — no calculator DOM,
// pricing engine, or builder script may remain in the repo.
test('retired calculator pages and scripts are gone', async () => {
  for (const file of ['../budget-calculator.html', '../js/budget-calculator.js', '../js/snack-builder.js']) {
    assert.equal(await missing(file), true, `${file} must stay deleted`);
  }
});
