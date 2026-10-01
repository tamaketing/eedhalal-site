// Verify the advertised meal-box starting price against the real catalogue.
//
// llms.txt, llms-full.md, faq.html and the JSON-LD all publish the meal-box
// "starting from" price, and that number comes from
// data/business-rules.json -> services.mealBox.priceFrom. Nothing connected it
// to the catalogue, so raising every menu price left the site advertising a
// price no customer could order. This fails when the claim drifts.
//
// The cheapest ORDERABLE dish is the reference: a hidden dish, or one that is
// ask-for-quote (cost not confirmed / owner switched its price off), is not
// something a customer can buy.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseMenuDataJs, publicProjectionOfCentral, startingPriceConsistency } from './menu-central.mjs';
import { loadCatalogue } from './popular-menu-page.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const rules = JSON.parse(await readFile(path.join(ROOT, 'data', 'business-rules.json'), 'utf8'));
const overrides = JSON.parse(await readFile(path.join(ROOT, 'data', 'planner-overrides.json'), 'utf8'));
const menus = await parseMenuDataJs(await readFile(path.join(ROOT, 'js', 'menu-data.js'), 'utf8'));

// Rebuild the projection from published data only, so the check reads the same
// quoteOnly the website is actually serving. showPrice=false is how a
// quote-only dish is expressed in the draft, so no cost store is needed here.
const quoteOnly = new Set((overrides.quoteOnly || []).map(String));
const central = {
  menus: menus.map((menu) => ({
    id: menu.id,
    name: overrides.names?.[String(menu.id)] ?? menu.name,
    price: overrides.prices?.[String(menu.id)] ?? menu.price,
    category: overrides.categories?.[String(menu.id)] ?? menu.category,
    image: overrides.images?.[String(menu.id)] ?? menu.image,
    minPerMenu: overrides.mins?.[String(menu.id)] ?? menu.minPerMenu,
    sortOrder: menu.sortOrder ?? 0,
    hidden: false,
    showPrice: !quoteOnly.has(String(menu.id)),
  })),
};

const projection = publicProjectionOfCentral(central, null);
const result = startingPriceConsistency(rules, projection);

console.log(`declared starting price : ${result.declared} THB`);
console.log(`cheapest orderable dish : ${result.minOrderable} THB`);
console.log(`cheapest served dish    : ${result.minServed} THB`);
console.log(`orderable / served      : ${result.orderableCount} / ${result.servedCount}`);

const catalogue = await loadCatalogue(ROOT);
console.log(`catalogue sanity        : ${catalogue.length} menus served, ${catalogue.filter((m) => !m.orderable).length} ask-for-quote`);

// Cross-check against the crawlable page so the two views cannot disagree.
const page = await readFile(path.join(ROOT, 'popular-menu.html'), 'utf8');
const ids = [...page.matchAll(/data-menu-id="([^"]+)"/g)].map((m) => m[1]);
if (ids.length !== catalogue.length) {
  console.error(`popular-menu.html lists ${ids.length} dishes but the catalogue has ${catalogue.length}`);
  process.exit(1);
}

if (!result.ok) {
  console.error('');
  console.error('Starting-price claim is out of sync with the catalogue:');
  for (const warning of result.warnings) console.error(`  - ${warning}`);
  console.error('');
  console.error('Fix services.mealBox.priceFrom in data/business-rules.json, then update the');
  console.error('same figure in llms.txt, llms-full.md, faq.html and the JSON-LD, and run');
  console.error('node scripts/check-business-sync.mjs --check plus this script.');
  process.exit(1);
}

console.log('Starting-price claim matches the cheapest orderable dish.');