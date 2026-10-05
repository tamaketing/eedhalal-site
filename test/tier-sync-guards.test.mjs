import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import test from 'node:test';
import { checkBusinessSync } from '../scripts/check-business-sync.mjs';

// The registry has to fail when a channel drifts. These mutations prove the new
// tier facts are real guards, not decoration: a wrong level name on the FAQ, a
// wrong level price in a blog, and a retired 150 THB Executive claim.

const root = new URL('../', import.meta.url);

async function mutate(t, file, from, to) {
  const url = new URL(file, root);
  const original = await readFile(url, 'utf8');
  t.after(async () => { await writeFile(url, original, 'utf8'); });
  const occurrences = original.split(from).length - 1;
  assert.ok(occurrences > 0, `fixture must contain "${from}" in ${file}`);
  // Rename every mention: that is what a level rename actually looks like.
  await writeFile(url, original.split(from).join(to), 'utf8');
  await assert.rejects(checkBusinessSync(), `${file}: "${from}" -> "${to}" (${occurrences} mention(s)) must be caught`);
  await writeFile(url, original, 'utf8');
}

test('a renamed level on the FAQ is caught', async (t) => {
  await mutate(t, 'faq.html', 'Executive Premium Halal Box', 'Premium Halal Box');
});

test('a wrong level price in a blog post is caught', async (t) => {
  await mutate(t, 'blog/halal-box-50-people-price.html', 'Executive Premium Halal Box เริ่ม 230 บาท/กล่อง', 'Executive Premium Halal Box เริ่ม 190 บาท/กล่อง');
});

test('a retired 150 THB Executive claim is rejected outright', async (t) => {
  await mutate(t, 'blog/halal-box-budget-70-baht.html', 'Executive Premium Halal Box เริ่ม 230 บาท/กล่อง', 'Executive Premium Halal Box เริ่ม 150 บาท/กล่อง');
});

test('claiming a Signature starting price that no set backs is rejected', async (t) => {
  await mutate(t, 'blog/halal-box-50-people-price.html', 'Classic เริ่ม 65 บาท', 'Signature Halal Meal Box เริ่ม 90 บาท');
});