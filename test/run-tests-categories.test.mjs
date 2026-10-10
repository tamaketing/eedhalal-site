import assert from 'node:assert/strict';
import test from 'node:test';
import { categoryCoverage, discoverTestFiles, filesForCategory, TEST_CATEGORIES } from '../scripts/run-tests.mjs';

test('the supplemental runner discovers every current test file exactly once', () => {
  const files = discoverTestFiles();
  assert.ok(files.length > 0);
  assert.deepEqual([...new Set(files)], files);
  assert.ok(files.every((file) => file.endsWith('.test.mjs')));
});

test('every test file belongs to at least one runner category', () => {
  const coverage = categoryCoverage();
  assert.deepEqual(coverage.uncovered, [], `uncategorized test file(s): ${coverage.uncovered.join(', ')}`);
  assert.deepEqual(coverage.actual.slice().sort(), coverage.actual);
});

test('runner categories reject unknown and missing files instead of skipping them', () => {
  for (const category of Object.keys(TEST_CATEGORIES)) {
    const files = filesForCategory(category);
    assert.deepEqual([...new Set(files)], files, `${category} must not duplicate files`);
  }
  assert.throws(() => filesForCategory('no-such-category'), /Unknown category/);
});
