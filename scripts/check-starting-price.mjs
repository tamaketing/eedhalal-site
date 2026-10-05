// Verify the meal-box tier prices against the real catalogue.
//
// llms.txt, llms-full.md, faq.html, the generated tier table/cards and the
// JSON-LD all publish a per-tier "starting from" price. No price is stored in
// data/business-rules.json: every one of them is the cheapest set of that tier
// that is published, open for sale and shown on the web
// (scripts/mealbox-tiers.mjs). This script proves the published catalogue
// really produces those numbers and that the generated pages carry exactly
// them - nothing can drift the way a typed figure did.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseMenuDataJs, publicProjectionOfCentral, tierPriceConsistency } from './menu-central.mjs';
import { computeTierFloors, renderTierCards, renderTierTable, setsFromPlanner } from './mealbox-tiers.mjs';
import { loadCatalogue } from './popular-menu-page.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const rules = JSON.parse(await readFile(path.join(ROOT, 'data', 'business-rules.json'), 'utf8'));
const overrides = JSON.parse(await readFile(path.join(ROOT, 'data', 'planner-overrides.json'), 'utf8'));
const menus = await parseMenuDataJs(await readFile(path.join(ROOT, 'js', 'menu-data.js'), 'utf8'));

// Rebuild the projection from published data only, so the check reads the same
// quoteOnly the website is actually serving. showPrice=false is the only way a
// menu becomes quote-only.
const quoteOnly = new Set((overrides.quoteOnly || []).map(String));
const central = {
  menus: menus.map((menu) => ({
    id: menu.id,
    name: overrides.names?.[String(menu.id)] ?? menu.name,
    price: overrides.prices?.[String(menu.id)] ?? menu.price,
    tier: overrides.tiers?.[String(menu.id)] ?? menu.tier,
    image: overrides.images?.[String(menu.id)] ?? menu.image,
    minPerMenu: overrides.mins?.[String(menu.id)] ?? menu.minPerMenu,
    sortOrder: menu.sortOrder ?? 0,
    hidden: false,
    showPrice: !quoteOnly.has(String(menu.id)),
  })),
};

const projection = publicProjectionOfCentral(central);
const result = tierPriceConsistency(rules, projection);

console.log('tier starting prices    :');
for (const tier of result.tiers) {
  const price = tier.priceFrom === null ? 'no set open for sale' : `${tier.priceFrom} THB (from ${tier.sourceName}, ID ${tier.sourceId})`;
  console.log(`  ${tier.nameEn.padEnd(30)} ${price} · ${tier.memberCount} set(s)`);
}
if (result.unassigned.length) {
  console.log(`unassigned tiers        : ${result.unassigned.length} menu(s) (counted as classic)`);
}

// The published files must produce the same numbers the pages show.
const sets = setsFromPlanner(overrides);
const published = computeTierFloors(sets).floors;
const drift = result.tiers.filter((tier) => (tier.priceFrom ?? null) !== (published[tier.id]?.priceFrom ?? null));
if (drift.length) {
  console.error(`tier prices disagree between js/menu-data.js and data/planner-overrides.json: ${drift.map((t) => t.id).join(', ')}`);
  process.exit(1);
}

const catalogue = await loadCatalogue(ROOT);
console.log(`catalogue sanity        : ${catalogue.length} menus served, ${catalogue.filter((m) => !m.orderable).length} ask-for-quote`);

// Cross-check against the crawlable page so the two views cannot disagree.
const page = await readFile(path.join(ROOT, 'popular-menu.html'), 'utf8');
const ids = [...page.matchAll(/data-menu-id="([^"]+)"/g)].map((m) => m[1]);
if (ids.length !== catalogue.length) {
  console.error(`popular-menu.html lists ${ids.length} dishes but the catalogue has ${catalogue.length}`);
  process.exit(1);
}

// The generated tier blocks must still be exactly what this catalogue produces.
// `overrides` is required, not optional: the second-dish list is read from the
// published catalogue, so rendering without it would drop every side name and
// report a false drift.
for (const [file, render, marker] of [
  ['popular-menu.html', (en) => renderTierTable({ rules, sets, overrides, en }), 'MEALBOX-TIERS:TH'],
  ['index.html', (en) => renderTierCards({ rules, sets, overrides, en }), 'MEALBOX-TIER-CARDS:TH'],
  ['en/popular-menu.html', (en) => renderTierTable({ rules, sets, overrides, en }), 'MEALBOX-TIERS:EN'],
  ['en/index.html', (en) => renderTierCards({ rules, sets, overrides, en }), 'MEALBOX-TIER-CARDS:EN'],
]) {
  const html = await readFile(path.join(ROOT, file), 'utf8');
  const block = render(file.startsWith('en/'));
  if (!html.includes(block.replace(/\n/g, '\r\n')) && !html.includes(block)) {
    console.error(`${file}: tier block is out of sync — run node scripts/sync-catering-content.mjs --write`);
    process.exit(1);
  }
  if (!html.includes(`<!-- BUSINESS-RULES:${marker} -->`)) {
    console.error(`${file}: missing the ${marker} marker`);
    process.exit(1);
  }
}

if (!result.ok) {
  console.error('');
  console.error('Tier prices are out of sync with the catalogue:');
  for (const warning of result.warnings) console.error(`  - ${warning}`);
  console.error('');
  console.error('Open the admin page, set the tier on each set in ฐานเมนูกลาง, publish, then run');
  console.error('node scripts/sync-catering-content.mjs --write and node scripts/check-business-sync.mjs --check.');
  process.exit(1);
}

console.log('Tier starting prices match the cheapest published set of each tier.');