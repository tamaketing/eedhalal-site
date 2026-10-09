import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function readJson(root, relativePath) {
  return JSON.parse(await readFile(path.join(root, relativePath), 'utf8'));
}

async function loadLegacyData(root = ROOT) {
  const context = {
    document: { readyState: 'complete', querySelectorAll: () => [] },
    window: {},
  };
  vm.createContext(context);
  vm.runInContext(await readFile(path.join(root, 'js/business-data.js'), 'utf8'), context);
  vm.runInContext(await readFile(path.join(root, 'js/menu-data.js'), 'utf8'), context);
  vm.runInContext(await readFile(path.join(root, 'js/snack-data.js'), 'utf8'), context);
  return {
    business: JSON.parse(JSON.stringify(context.EED)),
    menus: JSON.parse(JSON.stringify(context.EED_MENUS)),
    toppings: JSON.parse(JSON.stringify(context.EED_DEFAULT_TOPPINGS || [])),
    snackMinimumOrder: context.EED_SNACK_MIN_ORDER,
  };
}

export async function loadSystemData(root = ROOT) {
  const [rules, catalog, legacy] = await Promise.all([
    readJson(root, 'data/business-rules.json'),
    readJson(root, 'data/planner-overrides.json'),
    loadLegacyData(root),
  ]);
  return { rules, catalog, legacy };
}

export function getEffectiveMenus(menus, catalog) {
  const deleted = new Set(catalog.deleted || []);
  return menus
    .filter((menu) => !deleted.has(menu.id))
    .map((menu) => ({
      ...menu,
      name: catalog.names?.[menu.id] ?? menu.name,
      price: catalog.prices?.[menu.id] ?? menu.price,
      tier: catalog.tiers?.[menu.id] ?? menu.tier,
      image: catalog.images?.[menu.id] ?? menu.image,
      minPerMenu: catalog.mins?.[menu.id] ?? menu.minPerMenu,
    }));
}

// The ORDERABLE subset: served by name, minus owner-hidden, minus quote-only.
// Customer-facing copy that implies "you can order this now" must come from
// here. The ordering API strips quoteOnly[] too (services/menus.mjs), so
// advertising the wider served list as orderable would promise dishes the
// shop cannot accept.
export function getOrderableMenus(menus, catalog) {
  const quoteOnly = new Set(catalog.quoteOnly || []);
  return getEffectiveMenus(menus, catalog).filter((menu) => !quoteOnly.has(menu.id));
}

// Delivery is admin-quoted since 2026-09-24: no zone rates, no vehicle rule,
// no free-delivery thresholds. Every district gets the same answer — ask the
// admin with the delivery location and order quantity. There is intentionally
// no calculateShipping function anymore; automatic shipping calculation is
// retired (local tools show "รอแอดมินยืนยัน" instead of a computed fee).
export function deliveryPolicy(rules) {
  const delivery = rules.delivery || {};
  return {
    policy: delivery.policy,
    messageTh: delivery.messageTh,
    messageEn: delivery.messageEn,
    coverageTh: delivery.coverageTh,
    coverageEn: delivery.coverageEn,
    outsideBangkok: delivery.outsideBangkok,
    pendingTh: delivery.pendingTh,
    pendingEn: delivery.pendingEn,
  };
}

export function getLeadTime(rules, quantity) {
  return rules.leadTimes.find((range) =>
    quantity >= range.minQuantity && (range.maxQuantity === null || quantity <= range.maxQuantity),
  ) || null;
}



function replaceToppingsSegment(line, toppings) {
  const marker = ', toppings: ';
  const start = line.indexOf(marker);
  if (start === -1) return line;
  let depth = 0;
  let end = -1;
  for (let i = start + marker.length; i < line.length; i += 1) {
    if (line[i] === '[') depth += 1;
    else if (line[i] === ']') {
      depth -= 1;
      if (depth === 0) { end = i + 1; break; }
    }
  }
  if (end === -1) return line;
  return `${line.slice(0, start)}${marker}${JSON.stringify(toppings)}${line.slice(end)}`;
}

// Shared with the menu publish pipeline (scripts/menu-central.mjs builds the
// same content from the central draft): catalog MAY carry descs/badges/
// sortOrder/popular/toppings. When present they are synced into
// js/menu-data.js; when absent the legacy behavior is unchanged.
function syncMenuSource(source, catalog) {
  const seen = new Set();
  let synced = source;
  // Shared header list (global for every menu). Publish writes it from the
  // central draft, so --write must reproduce it from the catalog.
  if (catalog.toppings !== undefined) {
    assert.match(synced, /var EED_DEFAULT_TOPPINGS = .*?;/, 'cannot find EED_DEFAULT_TOPPINGS in js/menu-data.js');
    synced = synced.replace(/var EED_DEFAULT_TOPPINGS = .*?;/, `var EED_DEFAULT_TOPPINGS = ${JSON.stringify(catalog.toppings)};`);
  }
  synced = synced.split(/\r?\n/).map((line) => {
    const idMatch = line.match(/^\s*\{ id: (\d+),/);
    if (!idMatch) return line;
    const id = idMatch[1];
    seen.add(id);
    let next = line;
    const values = {
      name: catalog.names?.[id],
      price: catalog.prices?.[id],
      tier: catalog.tiers?.[id],
      image: catalog.images?.[id],
      minPerMenu: catalog.mins?.[id],
      desc: catalog.descs?.[id],
      badge: catalog.badges?.[id],
      sortOrder: catalog.sortOrder?.[id],
    };
    if (values.name !== undefined) next = next.replace(/name: "(?:[^"\\]|\\.)*"/, `name: ${JSON.stringify(values.name)}`);
    if (values.price !== undefined) next = next.replace(/price: \d+(?:\.\d+)?/, `price: ${values.price}`);
    if (values.tier !== undefined) next = next.replace(/tier: "(?:[^"\\]|\\.)*"/, `tier: ${JSON.stringify(values.tier)}`);
    if (values.image !== undefined) next = next.replace(/image: "(?:[^"\\]|\\.)*"/, `image: ${JSON.stringify(values.image)}`);
    if (values.minPerMenu !== undefined) next = next.replace(/minPerMenu: \d+/, `minPerMenu: ${values.minPerMenu}`);
    if (values.desc !== undefined) next = next.replace(/desc: "(?:[^"\\]|\\.)*"/, `desc: ${JSON.stringify(values.desc)}`);
    if (values.badge !== undefined) next = next.replace(/badge: "(?:[^"\\]|\\.)*"/, `badge: ${JSON.stringify(values.badge)}`);
    if (values.sortOrder !== undefined) {
      if (/sortOrder: -?\d+/.test(next)) next = next.replace(/sortOrder: -?\d+/, `sortOrder: ${values.sortOrder}`);
      else next = next.replace(/minPerMenu: \d+/, (m) => `${m}, sortOrder: ${values.sortOrder}`);
    }
    if (catalog.toppings !== undefined) next = replaceToppingsSegment(next, catalog.toppings);
    return next;
  }).join('\n');
  for (const id of Object.keys(catalog.prices)) assert.ok(seen.has(String(id)), `menu ${id} is missing from js/menu-data.js`);
  return `${synced.replace(/\n*$/, '')}\n`;
}

function replaceValue(source, pattern, replacement, field) {
  assert.match(source, pattern, `cannot find ${field} in js/business-data.js`);
  return source.replace(pattern, replacement);
}

function syncBusinessSource(source, rules, catalog) {
  const meal = rules.services.mealBox;
  const values = {
    phoneDisplay: rules.business.phone,
    halalCertificate: rules.business.halalCertificate,
    operatingHoursTh: rules.business.operatingDays,
    minOrder: String(meal.minimumOrder),
    thaiMinPerMenu: String(meal.standardMenuMinimum),
    indianMinPerMenu: String(meal.specialMenuMinimum),
    snackMinOrder: String(rules.services.snackBox.minimumOrder),
    menuCount: String(meal.menuCountFrom),
    shippingPolicyTh: rules.delivery.messageTh,
    shippingPolicyEn: rules.delivery.messageEn,
    shippingPendingTh: rules.delivery.pendingTh,
  };
  let synced = source;
  for (const [field, value] of Object.entries(values)) {
    const pattern = new RegExp(`(${field}:\\s*)'[^']*'`);
    synced = replaceValue(synced, pattern, `$1'${value}'`, field);
  }
  const leadText = `อย่างน้อย ${rules.services.mealBox.leadTimeDays} วัน`;
  const textValues = {
    quoteTimeTh: `ภายใน ${rules.documents.quoteWithinMinutes} นาทีหลังทัก LINE`,
    confirmDeadlineTh: `${rules.cutoff.time} น. ของ${rules.cutoff.description}`,
    leadSmallTh: leadText,
    leadMediumTh: leadText,
    leadLargeTh: leadText,
  };
  for (const [field, value] of Object.entries(textValues)) {
    const pattern = new RegExp(`(${field}:\\s*)'[^']*'`);
    synced = replaceValue(synced, pattern, `$1'${value}'`, field);
  }

  return `${synced.replace(/\r\n/g, '\n').replace(/\n*$/, '')}\n`;
}

function syncSnackSource(source, rules) {
  return replaceValue(
    source,
    /(var EED_SNACK_MIN_ORDER = )\d+/,
    `$1${rules.services.snackBox.minimumOrder}`,
    'EED_SNACK_MIN_ORDER',
  );
}

function assertUnique(values, message) {
  assert.equal(new Set(values).size, values.length, message);
}

// ขั้นต่ำต่อเมนูเป็นกฎเดียวทั้งแคตตาล็อก: ทุกเมนูใช้ standardMenuMinimum
// (specialMenuMinimum คงไว้ใน data/business-rules.json เผื่อกฎเปลี่ยนอีก)
export function validateData(rules, catalog, legacy) {
  assert.equal(rules.schemaVersion, 1, 'unsupported business rules schema');
  assert.match(rules.revision, /^\d{4}-\d{2}-\d{2}$/, 'revision must use YYYY-MM-DD');
  assert.equal(rules.services.mealBox.minimumOrder, 10);
  assert.equal(rules.services.snackBox.minimumOrder, 30, 'Snack Box minimum must be 30');
  // Per-menu minimum is a business fact. The owner menu tool can edit it freely,
  // so every published menu is checked against the rule — a set-level "only
  // these values exist" check let all 44 menus drift to one value unnoticed.
  const standardMinimum = rules.services.mealBox.standardMenuMinimum;
  for (const [id, minimum] of Object.entries(catalog.mins)) {
    assert.equal(minimum, standardMinimum, `menu ${id} per-menu minimum must be ${standardMinimum}`);
  }
  // Every published menu declares a level, and it must be a real one: the tier
  // is the only grouping the customer pages, the calculator and the API use.
  const TIER_IDS = new Set(['classic', 'signature', 'executive']);
  for (const [id, tier] of Object.entries(catalog.tiers || {})) {
    assert.ok(TIER_IDS.has(tier), `menu ${id} has an unknown tier “${tier}”`);
  }
  // The site advertises "more than 30 menus" everywhere, so a publish that
  // silently hides most of the catalog must fail here rather than on the site.
  const hiddenIds = new Set((catalog.deleted || []).map(String));
  const activeMenus = Object.keys(catalog.prices || {}).filter((id) => !hiddenIds.has(String(id)));
  assert.ok(
    activeMenus.length >= rules.services.mealBox.menuCountFrom,
    `active menus (${activeMenus.length}) must cover the advertised ${rules.services.mealBox.menuCountFrom}+ menus`,
  );

  assertUnique(legacy.menus.map((menu) => menu.id), 'menu IDs must be unique');
  // Delivery is admin-quoted: no zones, rates, vehicle rules, or free thresholds.
  assert.equal(rules.delivery.policy, 'adminQuote', 'delivery must use the admin-quote policy');
  for (const field of ['messageTh', 'messageEn', 'coverageTh', 'coverageEn', 'outsideBangkok', 'pendingTh', 'pendingEn']) {
    assert.ok(typeof rules.delivery[field] === 'string' && rules.delivery[field].trim(), `delivery.${field} is required`);
  }
  for (const retired of ['zones', 'carWhenQuantityAbove', 'freeThresholdDefault']) {
    assert.equal(rules.delivery[retired], undefined, `retired delivery field must stay removed: ${retired}`);
  }
  for (const field of ['shipZones', 'shipCarMinQty', 'shipFree', 'shipZoneFreeThresholds']) {
    assert.equal(catalog[field], undefined, `planner catalog must not define business delivery policy: ${field}`);
  }

  for (const menu of legacy.menus) {
    const id = String(menu.id);
    assert.equal(menu.name, catalog.names[id], `menu ${id} name drift`);
    assert.equal(menu.price, catalog.prices[id], `menu ${id} price drift`);
    assert.equal(menu.tier, catalog.tiers?.[id], `menu ${id} tier drift`);
    assert.equal(menu.image, catalog.images[id], `menu ${id} image drift`);
    assert.equal(menu.minPerMenu, catalog.mins[id], `menu ${id} minimum drift`);
    // Publish-managed maps (written by the menu publish pipeline from the
    // central draft). Asserted only when present so legacy files still pass.
    if (catalog.descs !== undefined) assert.equal(menu.desc ?? '', catalog.descs[id] ?? '', `menu ${id} description drift`);
    if (catalog.badges !== undefined) assert.equal(menu.badge ?? '', catalog.badges[id] ?? '', `menu ${id} badge drift`);
    if (catalog.sortOrder !== undefined) assert.equal(menu.sortOrder ?? null, catalog.sortOrder[id] ?? null, `menu ${id} display-order drift`);
  }
  // The shared topping list must match the published compat header.
  if (catalog.toppings !== undefined && legacy.toppings !== undefined) {
    assert.deepEqual(legacy.toppings, catalog.toppings, 'toppings list drift between js/menu-data.js and planner catalog');
  }
  // Every published menu carries a tier, and it is the only grouping axis:
  // the customer pages, the calculator and the internal API all filter by it,
  // so a menu without one would be unreachable from every entry path.
  for (const id of Object.keys(catalog.prices || {})) {
    assert.ok(
      TIER_IDS.has(String(catalog.tiers?.[id])),
      `menu ${id} has no published tier, so no customer page can group or filter it`,
    );
  }
  if (catalog.popular !== undefined) {
    assert.ok(Array.isArray(catalog.popular), 'popular must be an id list');
    for (const id of catalog.popular) {
      assert.ok(Object.hasOwn(catalog.prices, String(id)), `popular references unknown menu ${id}`);
    }
  }

  const eed = legacy.business;
  // Starting prices are no longer published in business-rules.json: the runtime
  // reads them from the catalogue. js/business-data.js must therefore not bake
  // a figure either - it loads them at runtime instead.
  assert.equal(eed.startingPrice, null, 'starting price must be computed at runtime, not baked');
  assert.equal(eed.tiers, null, 'tier prices must be computed at runtime, not baked');
  assert.equal(Number(eed.minOrder), rules.services.mealBox.minimumOrder, 'minimum order drift');
  assert.equal(Number(eed.thaiMinPerMenu), rules.services.mealBox.standardMenuMinimum, 'standard menu minimum drift');
  assert.equal(Number(eed.indianMinPerMenu), rules.services.mealBox.specialMenuMinimum, 'special menu minimum drift');
  assert.equal(Number(eed.snackMinOrder), rules.services.snackBox.minimumOrder, 'Snack Box minimum drift');
  assert.equal(legacy.snackMinimumOrder, rules.services.snackBox.minimumOrder, 'Snack Box runtime minimum drift');
  assert.equal(eed.shippingPolicyTh, rules.delivery.messageTh, 'delivery policy TH drift');
  assert.equal(eed.shippingPolicyEn, rules.delivery.messageEn, 'delivery policy EN drift');
  assert.equal(eed.shippingPendingTh, rules.delivery.pendingTh, 'delivery pending TH drift');
  assert.equal(eed.halalCertificate, rules.business.halalCertificate, 'halal certificate drift');
  assert.equal(eed.confirmDeadlineTh, `${rules.cutoff.time} น. ของ${rules.cutoff.description}`, 'cutoff drift');
  const expectedLead = `อย่างน้อย ${rules.services.mealBox.leadTimeDays} วัน`;
  assert.equal(eed.leadSmallTh, expectedLead, 'small lead time drift');
  assert.equal(eed.leadMediumTh, expectedLead, 'medium lead time drift');
  assert.equal(eed.leadLargeTh, expectedLead, 'large lead time drift');

  assert.equal(eed.shippingZones, undefined, 'retired shippingZones must stay removed');
  assert.equal(eed.shippingZoneFreeThresholds, undefined, 'retired free thresholds must stay removed');
  assert.equal(eed.freeDeliveryFrom, undefined, 'retired freeDeliveryFrom must stay removed');
  assert.equal(eed.shippingCarMinQty, undefined, 'retired shippingCarMinQty must stay removed');
  assert.equal(eed.shippingAutoNote, undefined, 'retired shippingAutoNote must stay removed');
}


// js/main.js renders on every page, so a price or minimum typed straight into
// its copy becomes a customer-facing claim that no business rule can correct.
// It must read EED.startingPrice / EED.minOrder instead.
function assertNoBakedBusinessNumbersInMainJs(mainJs) {
  // The file mixes \uXXXX escapes with raw Thai, so decode before matching.
  const code = String(mainJs || '').replace(/\\u([0-9a-f]{4})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  const found = code.match(/\d+\s*บาท|ขั้นต่ำ\s*\d+\s*กล่อง/g);
  assert.ok(!found, `js/main.js must read prices from EED (business-rules.json), not hardcode: ${found?.join(' / ')}`);
}

export async function checkSystem(root = ROOT) {
  const data = await loadSystemData(root);
  validateData(data.rules, data.catalog, data.legacy);
  assertNoBakedBusinessNumbersInMainJs(await readFile(path.join(root, 'js/main.js'), 'utf8'));
  return data;
}

async function writeGeneratedFiles(root = ROOT) {
  const { rules, catalog } = await loadSystemData(root);
  const businessPath = path.join(root, 'js/business-data.js');
  const syncedBusinessSource = syncBusinessSource(await readFile(businessPath, 'utf8'), rules, catalog);
  await writeFile(businessPath, syncedBusinessSource, 'utf8');
  const menuPath = path.join(root, 'js/menu-data.js');
  const syncedMenuSource = syncMenuSource(await readFile(menuPath, 'utf8'), catalog);
  await writeFile(menuPath, syncedMenuSource, 'utf8');
  const snackPath = path.join(root, 'js/snack-data.js');
  await writeFile(snackPath, syncSnackSource(await readFile(snackPath, 'utf8'), rules), 'utf8');
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  if (process.argv.includes('--write')) await writeGeneratedFiles();
  await checkSystem();
  console.log('System data and calculator catalog are consistent.');
}
