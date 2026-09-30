// EED HALAL — central menu database + publish pipeline (tracked, no secrets).
//
// Roles (verified from code, 2026-09-26):
//   data/planner-overrides.json = PUBLISHED public catalog override (tracked,
//     deployed to GitHub Pages, read by services/menus.mjs as the LINE price
//     authority and by js/*-hydrate.js on customer pages).
//   js/menu-data.js             = PUBLISHED generated compat data (tracked,
//     deployed, defines EED_MENUS for popular-menu.html / kitchen-order.html).
//   <dataDir>/menu-central.json = CENTRAL draft (LOCAL ONLY, gitignored via
//     demo/. Never committed, never deployed). Full menu records incl.
//     internal-only fields. "บันทึก" writes here; admin tools read the latest
//     immediately while customers keep the published files until "เผยแพร่".
//   owner-costs.json            = INTERNAL cost DB (local only). Costs live
//     ONLY there — never in menu-central, never in published files. A cost
//     AMOUNT-only edit (still orderable) never creates a pending web publish,
//     but a cost edit that flips quote-only status (served <-> orderable)
//     does, because ordering availability changes.
//
// Publish = regenerate the two published static files from the central draft
// with an explicit public-field allowlist, verify (no internal leak, images
// web-reachable), then atomic-write. Truthful three-version model:
//   draft = menu-central.json version (local edits)
//   file  = central version built into the working-tree files (+ build time)
//   live  = central version VERIFIED serving on GitHub Pages (or "ยังไม่ยืนยัน")
// "สร้างไฟล์ในเครื่อง" is reported as เตรียมไฟล์แล้ว — รอขึ้นเว็บไซต์, never
// as เผยแพร่แล้ว. Only a live-web content check may report เผยแพร่แล้ว.
// Deploy-to-web runs from the admin machine backend (scripts/menu-deploy.mjs)
// with the machine's own git credentials — never a token in the browser.

import { statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const CENTRAL_FILE = 'menu-central.json';
export const PUBLISH_STATE_FILE = 'menu-publish-state.json';

// Public-field allowlist for data/planner-overrides.json top-level keys.
// Central-managed keys are rebuilt on publish; carried-over keys are preserved
// verbatim from the currently published file (snacks/toppings/meats are out of
// the menu-publish scope and must survive a publish unchanged). `release`
// proves which central version a file was built from (used by live checks).
export const PUBLIC_OVERRIDE_KEYS = [
  'prices', 'mins', 'images', 'names', 'categories',
  'descs', 'badges', 'sortOrder', 'popular', 'deleted', 'quoteOnly',
  'newMenus', 'meats', 'toppings', 'noMeatMenus',
  'snackPrices', 'snackNames', 'snackCats', 'snackAddons',
  'exportedAt', 'release',
];

// Central-managed keys: rebuilt from the central draft on every publish
// (`release` included: the build stamp belongs to the pipeline, never carried).
// meats/toppings/noMeatMenus are rebuilt too — leaving them to the carry-over
// loop below would silently keep stale published values even though lines 502+
// just rebuilt them from the draft.
export const CENTRAL_MANAGED_KEYS = [
  'prices', 'mins', 'images', 'names', 'categories',
  'descs', 'badges', 'sortOrder', 'popular', 'deleted', 'quoteOnly', 'release',
  'meats', 'toppings', 'noMeatMenus',
];

// Tokens that must NEVER appear in published artifacts (case-insensitive).
// Covers costs, profit, internal notes/flags, secrets, machine-local paths.
const FORBIDDEN_TOKENS = [
  'foodcost', 'internalnote', 'includesbox', 'showonwebsite', 'coststatus',
  'profit', 'marginpct', 'secret', 'passwd', 'apikey', 'api_key',
  'localhost', '127.0.0.1', 'file://', 'owner-costs', 'owner-costs.json',
  'eed_internal_api_secret',
];
const FORBIDDEN_PATH_TOKENS = ['C:\\', 'C:/', '\\\\'];

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

// ---------------------------------------------------------------------------
// Central draft: build (migration) + validate + load/save
// ---------------------------------------------------------------------------

// Build the central draft from existing sources. Nothing is invented:
// public values come from the planner maps (= published authority), descriptive
// values (desc/badge/noMeat) from js/menu-data.js, display order from the
// menu-data.js line order, popular order from the hydrate POPULAR_IDS list.
// Costs are deliberately NOT copied here (they stay in owner-costs.json).
export function migrateCentral({ menuDataMenus = [], planner = {}, popularIds = [] } = {}) {
  const byId = new Map();
  for (const entry of menuDataMenus) {
    if (entry && (typeof entry.id === 'number' || typeof entry.id === 'string')) {
      byId.set(String(entry.id), entry);
    }
  }
  const priceIds = Object.keys(planner.prices || {});
  const deleted = new Set((planner.deleted || []).map(String));
  // Display order = the js/menu-data.js line order (the de-facto order
  // customers have always seen). Planner-only ids append after it.
  const fileOrder = new Map();
  menuDataMenus.forEach((entry, index) => {
    if (entry && (typeof entry.id === 'number' || typeof entry.id === 'string')) {
      if (!fileOrder.has(String(entry.id))) fileOrder.set(String(entry.id), index);
    }
  });
  const menus = priceIds.map((id) => {
    const legacy = byId.get(String(id)) || {};
    return {
      id: Number(id),
      name: planner.names?.[id] ?? legacy.name ?? '',
      price: planner.prices?.[id] ?? legacy.price ?? 0,
      category: planner.categories?.[id] ?? legacy.category ?? '',
      image: planner.images?.[id] ?? legacy.image ?? '',
      desc: typeof legacy.desc === 'string' ? legacy.desc : '',
      badge: typeof legacy.badge === 'string' ? legacy.badge : '',
      minPerMenu: planner.mins?.[id] ?? legacy.minPerMenu ?? 5,
      hidden: deleted.has(String(id)),
      sortOrder: fileOrder.has(String(id)) ? fileOrder.get(String(id)) : 10000 + Number(id),
      noMeat: legacy.noMeat === true || (planner.noMeatMenus || []).map(String).includes(String(id)),
      showPrice: true,
      noLock: true,
      internalNote: '',
    };
  });
  menus.sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  const existing = new Set(menus.map((menu) => String(menu.id)));
  return {
    _note: 'ฐานข้อมูลกลางเมนู EED HALAL (local only, gitignored) — แก้ผ่านหน้า "จัดการเมนู" ปุ่มบันทึกเท่านั้น ห้าม commit ไฟล์นี้',
    version: 1,
    updatedAt: new Date().toISOString(),
    menus,
    toppings: Array.isArray(planner.toppings) ? planner.toppings : [],
    meats: Array.isArray(planner.meats) ? planner.meats : [],
    popular: popularIds.map(String).filter((id) => existing.has(id)),
  };
}

export function validateCentral(central) {
  const errors = [];
  if (!isPlainObject(central)) return { ok: false, errors: ['ฐานกลางต้องเป็นอ็อบเจกต์ JSON'], data: null };
  if (!Array.isArray(central.menus) || central.menus.length === 0) {
    errors.push('menus ต้องเป็นอาร์เรย์และมีอย่างน้อย 1 เมนู (ห้ามลบจนหมด ใช้ซ่อนแทน)');
  }
  const seen = new Set();
  const orders = new Set();
  const data = { menus: [] };
  for (const [index, raw] of (central.menus || []).entries()) {
    const label = `menus[${index}]`;
    if (!isPlainObject(raw)) { errors.push(`${label}: ข้อมูลไม่ถูกต้อง`); continue; }
    const id = typeof raw.id === 'number' ? raw.id : Number(text(raw.id));
    if (!Number.isInteger(id) || id <= 0) { errors.push(`${label}: id ต้องเป็นเลขจำนวนเต็มบวก (ใช้ ID เดิมเป็นตัวอ้างอิงร่วม)`); continue; }
    if (seen.has(id)) errors.push(`${label}: id ซ้ำ (${id})`);
    seen.add(id);
    const name = text(raw.name);
    if (!name) errors.push(`${label}: ต้องมีชื่อเมนู`);
    const price = Number(raw.price);
    if (!Number.isFinite(price) || price <= 0) errors.push(`${label}: ราคาขายต้องมากกว่า 0`);
    const category = text(raw.category);
    if (!category) errors.push(`${label}: ต้องมีหมวดหมู่`);
    const image = text(raw.image);
    if (!image) errors.push(`${label}: ต้องมีรูป`);
    const minPerMenu = Number(raw.minPerMenu);
    if (!Number.isInteger(minPerMenu) || minPerMenu < 1) errors.push(`${label}: ขั้นต่ำต่อเมนูต้องเป็นจำนวนเต็ม ≥ 1`);
    const sortOrder = raw.sortOrder === undefined ? index : Number(raw.sortOrder);
    if (!Number.isFinite(sortOrder)) errors.push(`${label}: ลำดับแสดงผลต้องเป็นตัวเลข`);
    else if (orders.has(sortOrder)) errors.push(`${label}: ลำดับแสดงผลซ้ำ (${sortOrder})`);
    else orders.add(sortOrder);
    data.menus.push({
      id,
      name,
      price: Math.round(price * 100) / 100,
      category,
      image,
      desc: typeof raw.desc === 'string' ? raw.desc : '',
      badge: typeof raw.badge === 'string' ? raw.badge : '',
      minPerMenu,
      hidden: raw.hidden === true,
      sortOrder,
      noMeat: raw.noMeat === true,
      // Owner switches (business rule: data/business-rules.json -> menuPublishing).
      // showPrice:false publishes the menu in `quoteOnly` (name + ask-for-quote
      // marker, excluded from ordering) because there is no customer-facing
      // price. noLock is owner-tool only and is never published.
      showPrice: raw.showPrice === undefined ? true : raw.showPrice === true,
      noLock: raw.noLock === undefined ? true : raw.noLock === true,
      internalNote: typeof raw.internalNote === 'string' ? raw.internalNote : '',
    });
  }
  for (const key of ['toppings', 'meats']) {
    const list = central[key];
    if (list !== undefined && !Array.isArray(list)) errors.push(`${key} ต้องเป็นอาร์เรย์`);
  }
  const popular = central.popular === undefined ? [] : central.popular;
  if (!Array.isArray(popular)) errors.push('popular ต้องเป็นอาร์เรย์รหัสเมนูตามลำดับแสดง');
  else {
    for (const id of popular) {
      if (!seen.has(Number(id))) errors.push(`popular: ไม่พบเมนูรหัส ${id} ในฐานกลาง`);
    }
  }
  if (errors.length) return { ok: false, errors, data: null };
  data.toppings = Array.isArray(central.toppings) ? central.toppings : [];
  data.meats = Array.isArray(central.meats) ? central.meats : [];
  data.popular = popular.map((id) => Number(id));
  return { ok: true, errors: [], data };
}

export async function loadCentral(dataDir) {
  const raw = JSON.parse(await readFile(path.join(dataDir, CENTRAL_FILE), 'utf8'));
  const result = validateCentral(raw);
  if (!result.ok) {
    const error = new Error(`ฐานกลางเมนูไม่ผ่านการตรวจ: ${result.errors.join(' | ')}`);
    error.code = 'ECENTRALINVALID';
    throw error;
  }
  result.data.version = Number.isFinite(Number(raw.version)) ? Number(raw.version) : 0;
  result.data.updatedAt = text(raw.updatedAt) || null;
  return result.data;
}

// A single save that hides a large batch of menus is almost always a runaway
// click loop, never a real business decision. On 2026-09-29 a bad click target
// walked 14 saves from 25 to 39 hidden menus and publish v72 removed 32 live
// menus from the customer site. Refuse it unless the owner re-confirms.
export const BULK_HIDE_LIMIT = 5;

// Atomic save (temp + rename) + version bump. Local only — never pushed.
// Optimistic concurrency: when opts.expectedVersion is provided and the disk
// version differs, the write is refused ({ok:false, conflict:true}) instead of
// silently overwriting another editor's save.
export async function saveCentral(dataDir, raw, opts = {}) {
  const result = validateCentral(raw);
  if (!result.ok) return result;
  const current = await loadCentral(dataDir).catch(() => null);
  // Optimistic concurrency: reject a save based on a stale draft instead of
  // silently overwriting someone else's edit.
  const expected = opts?.expectedVersion;
  if (expected !== undefined && expected !== null && current) {
    const diskVersion = Number(current.version ?? 0);
    if (Number(expected) !== diskVersion) {
      return {
        ok: false,
        conflict: true,
        currentVersion: diskVersion,
        errors: [`ข้อมูลบนดิสก์เปลี่ยนไปแล้ว (รุ่น ${diskVersion}) — โหลดข้อมูลใหม่ก่อนบันทึก เพื่อไม่ให้เขียนทับกัน`],
        data: null,
      };
    }
  }
  // Only guards an EDIT of an existing draft: the first write (migration/seed)
  // legitimately carries whatever the published file already had hidden.
  const hiddenIds = (menus) => new Set((menus || []).filter((menu) => menu.hidden === true).map((menu) => menu.id));
  const hiddenBefore = current ? hiddenIds(current.menus) : hiddenIds(result.data.menus);
  const newlyHidden = [...hiddenIds(result.data.menus)].filter((id) => !hiddenBefore.has(id)).sort((a, b) => a - b);
  if (newlyHidden.length > BULK_HIDE_LIMIT && raw?.confirmBulkHide !== true) {
    return {
      ok: false,
      bulkHide: true,
      newlyHidden,
      errors: [
        `คำสั่งนี้ซ่อนเมนู ${newlyHidden.length} เมนูในครั้งเดียว (ID ${newlyHidden.join(', ')}) — เกิน ${BULK_HIDE_LIMIT} เมนู`,
        'ฐานกลางยังไม่ถูกเปลี่ยน — กดยืนยันอีกครั้งถ้าตั้งใจซ่อนจริง หรือกด “โหลดข้อมูลใหม่” เพื่อยกเลิก',
      ],
      data: null,
    };
  }
  const version = (current?.version ?? 0) + 1;
  const updatedAt = new Date().toISOString();
  const payload = { ...result.data, version, updatedAt };
  await mkdir(dataDir, { recursive: true });
  const file = path.join(dataDir, CENTRAL_FILE);
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  await rename(temp, file);
  return { ok: true, errors: [], data: payload };
}

// ---------------------------------------------------------------------------
// Published files: load + public projection + diff
// ---------------------------------------------------------------------------

export async function loadPublished(root) {
  const overrides = JSON.parse(
    await readFile(path.join(root, 'data', 'planner-overrides.json'), 'utf8'),
  );
  const menuDataJs = await readFile(path.join(root, 'js', 'menu-data.js'), 'utf8');
  return { overrides, menuDataJs };
}

// Cost rule (business rule: data/business-rules.json -> menuPublishing).
// Three tiers:
//   1. served (owner-visible, hidden=false) -> name shows in the menu lists
//      (cards + full name list), even without a confirmed cost, with a
//      "ask for quote" marker. Preserves SEO/AI discovery.
//   2. orderable (served + CONFIRMED food cost > 0) -> included in ordering,
//      price calculation and automatic recommendations.
//   3. owner-hidden (hidden=true) -> hidden everywhere.
// `costs` is the owner-costs.json shape ({dishes:[{menuId,foodCost,status}]}).
// When `costs` is null/undefined the cost split is disabled (backwards
// compatible for tests and deploy preflight without cost data): every
// served menu counts as orderable.
export function readyCostIds(costs) {
  const ready = new Set();
  for (const dish of costs?.dishes || []) {
    if (!dish) continue;
    if (dish.status !== 'confirmed') continue;
    const value = Number(dish.foodCost);
    if (!Number.isFinite(value) || value <= 0) continue;
    if (dish.menuId !== null && dish.menuId !== undefined && dish.menuId !== '') {
      ready.add(String(dish.menuId));
    }
    const match = String(dish.id || '').match(/^menu-(\d+)$/);
    if (match) ready.add(String(Number(match[1])));
  }
  return ready;
}

export function isMenuCostReady(costs, menuId) {
  if (!costs) return true;
  return readyCostIds(costs).has(String(menuId));
}

export function costGateSummary(central, costs) {
  if (!costs) return { enabled: false, ready: 0, waiting: 0, blocked: [] };
  const ready = readyCostIds(costs);
  const blocked = [];
  for (const menu of central?.menus || []) {
    if (menu.hidden === true) continue;
    if (!ready.has(String(menu.id))) blocked.push({ id: Number(menu.id), name: menu.name });
  }
  return {
    enabled: true,
    ready: (central?.menus || []).filter((menu) => menu.hidden !== true).length - blocked.length,
    waiting: blocked.length,
    blocked,
  };
}

function effectiveHiddenOf(menu) {
  return menu.hidden === true;
}

// Quote-only: served by the shop (owner-visible) but the customer cannot see a
// price — either the cost is not confirmed yet, or the owner turned the price
// off (business rule: menuPublishing.showPriceRuleTh). Name may show with an
// ask-for-quote marker, but the menu stays out of ordering/calculation/
// recommendation.
function isQuoteOnly(menu, costs) {
  if (menu.hidden === true) return false;
  if (menu.showPrice === false) return true;
  if (!costs) return false;
  return !isMenuCostReady(costs, menu.id);
}

// Public projection of the central draft: ONLY publishable fields.
// Cost/internal data cannot leak through the diff because it never enters it.
export function publicProjectionOfCentral(central, costs = null) {
  const menus = new Map();
  for (const menu of central.menus || []) {
    menus.set(String(menu.id), {
      name: menu.name,
      price: menu.price,
      category: menu.category,
      image: menu.image,
      desc: menu.desc || '',
      badge: menu.badge || '',
      minPerMenu: menu.minPerMenu,
      hidden: effectiveHiddenOf(menu),
      ownerHidden: menu.hidden === true,
      // Cost gate (needs owner-costs) OR owner hid the price. Kept separate so
      // the admin can tell "waiting for cost" from "price switched off".
      costBlocked: !costs ? false : isQuoteOnly(menu, costs),
      priceHidden: menu.showPrice === false,
      sortOrder: menu.sortOrder,
      noMeat: menu.noMeat === true,
    });
  }
  return {
    menus,
    toppings: central.toppings || [],
    meats: central.meats || [],
    popular: (central.popular || []).map(String),
  };
}

// Public projection of the published files. menu-data.js is parsed for
// desc/badge/sortOrder/noMeat (overrides maps carry the rest).
export function publicProjectionOfPublished({ overrides, menuDataMenus = [] }) {
  const legacyById = new Map(menuDataMenus.map((menu) => [String(menu.id), menu]));
  const menus = new Map();
  const deleted = new Set((overrides.deleted || []).map(String));
  for (const id of Object.keys(overrides.prices || {})) {
    const legacy = legacyById.get(String(id)) || {};
    menus.set(String(id), {
      name: overrides.names?.[id] ?? legacy.name,
      price: overrides.prices?.[id],
      category: overrides.categories?.[id] ?? legacy.category,
      image: overrides.images?.[id] ?? legacy.image,
      desc: overrides.descs?.[id] ?? legacy.desc ?? '',
      badge: overrides.badges?.[id] ?? legacy.badge ?? '',
      minPerMenu: overrides.mins?.[id] ?? legacy.minPerMenu,
      hidden: deleted.has(String(id)),
      sortOrder: overrides.sortOrder?.[id] ?? legacy.sortOrder ?? null,
      noMeat: legacy.noMeat === true || (overrides.noMeatMenus || []).map(String).includes(String(id)),
    });
  }
  return {
    menus,
    toppings: overrides.toppings || [],
    meats: overrides.meats || [],
    popular: (overrides.popular || []).map(String),
  };
}

const COMPARE_FIELDS = [
  'name', 'price', 'category', 'image', 'desc', 'badge',
  'minPerMenu', 'hidden', 'sortOrder', 'noMeat',
];

// Diff central draft vs last published release, public fields only.
// A cost-AMOUNT-only edit (still orderable) never appears here; a cost edit
// that flips quote-only status (no cost -> confirmed, or confirmed -> cleared)
// DOES create a pending web publish because ordering availability changes.
// Name/price/category edits always appear, so renames reach both the cards
// and the full name list in one publish.
export function diffPublicChanges(central, published, costs = null) {
  const left = publicProjectionOfCentral(central, costs);
  const right = publicProjectionOfPublished(published);
  const publishedQuoteOnly = new Set(
    ((published.overrides || published)?.quoteOnly || []).map(String),
  );
  const added = [];
  const changed = [];
  const shown = [];
  const hidden = [];
  const costBlocked = [];
  for (const [id, menu] of left.menus) {
    if (menu.costBlocked) {
      const reason = menu.priceHidden
        ? 'เจ้าของปิดแสดงราคา — แสดงแต่ชื่อพร้อมป้ายสอบถามราคา ไม่เข้าระบบคำนวณ'
        : 'รอทุนยืนยัน — แสดงชื่อได้ สอบถามราคา ไม่เข้าระบบคำนวณ';
      costBlocked.push({ id: Number(id), name: menu.name, reason });
    }
    const base = right.menus.get(id);
    if (!base) {
      added.push({ id: Number(id), name: menu.name, fields: ['new'] });
      continue;
    }
    const fields = COMPARE_FIELDS.filter((field) => !sameValue(menu[field], base[field]));
    if (fields.length) changed.push({ id: Number(id), name: menu.name, fields });
    if (menu.hidden === false && base.hidden === true) shown.push({ id: Number(id), name: menu.name });
    if (menu.hidden === true && base.hidden === false) hidden.push({ id: Number(id), name: menu.name });
  }
  const removed = [];
  for (const [id, base] of right.menus) {
    if (!left.menus.has(id)) removed.push({ id: Number(id), name: base.name });
  }
  // Quote-only flips (ordering availability) count as pending publish.
  const nextQuoteOnly = [...left.menus.entries()]
    .filter(([, menu]) => menu.costBlocked)
    .map(([id]) => String(id))
    .sort();
  const prevQuoteOnly = [...publishedQuoteOnly].sort();
  const quoteOnlyChanged = JSON.stringify(nextQuoteOnly) !== JSON.stringify(prevQuoteOnly);
  const toppingsChanged = JSON.stringify(left.toppings) !== JSON.stringify(right.toppings);
  const meatsChanged = JSON.stringify(left.meats) !== JSON.stringify(right.meats);
  const popularChanged = JSON.stringify(left.popular) !== JSON.stringify(right.popular);
  const hasChanges = added.length > 0 || changed.length > 0 || removed.length > 0
    || quoteOnlyChanged || toppingsChanged || meatsChanged || popularChanged;
  return {
    added, changed, shown, hidden, removed, costBlocked,
    quoteOnlyChanged,
    toppingsChanged, meatsChanged, popularChanged,
    hasChanges,
  };
}

function sameValue(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-9;
  return a === b;
}

// ---------------------------------------------------------------------------
// Build published artifacts (explicit allowlist) + safety verification
// ---------------------------------------------------------------------------

export function sha256Hex(content) {
  return createHash('sha256').update(String(content), 'utf8').digest('hex');
}

export function buildPlannerOverrides(central, current, now = new Date(), costs = null) {
  // Preserve the currently published key order (minimal diff, stable for
  // readers); brand-new ids append sorted by display order.
  const currentOrder = Object.keys(current?.prices || {});
  const known = new Set(currentOrder);
  const fresh = [...central.menus]
    .filter((menu) => !known.has(String(menu.id)))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)
    .map((menu) => String(menu.id));
  const byId = new Map(central.menus.map((menu) => [String(menu.id), menu]));
  const ordered = [...currentOrder.filter((id) => byId.has(id)), ...fresh];
  const sorted = ordered.map((id) => byId.get(id));
  const pick = (fn) => Object.fromEntries(sorted.map((menu) => [String(menu.id), fn(menu)]));
  const next = {};
  // Central-managed keys (rebuilt; public fields only).
  next.prices = pick((menu) => menu.price);
  next.mins = pick((menu) => menu.minPerMenu);
  next.images = pick((menu) => menu.image);
  next.names = pick((menu) => menu.name);
  next.categories = pick((menu) => menu.category);
  next.descs = pick((menu) => menu.desc || '');
  next.badges = pick((menu) => menu.badge || '');
  next.sortOrder = pick((menu) => menu.sortOrder);
  next.popular = (central.popular || []).map(Number);
  // Preserve the previously published hidden order (minimal diff); newly
  // hidden ids append numerically. Consumers treat it as a set.
  // Owner-hidden hides everywhere. Cost-unready (but served) menus stay
  // visible by name and are published in `quoteOnly` instead: name lists
  // show them with an ask-for-quote marker, while ordering/calculation
  // paths exclude them.
  const stillHidden = new Set(sorted.filter((menu) => effectiveHiddenOf(menu)).map((menu) => String(menu.id)));
  const keptOrder = (current?.deleted || []).map(String).filter((id) => stillHidden.has(id));
  const appended = [...stillHidden].filter((id) => !keptOrder.includes(id))
    .sort((a, b) => Number(a) - Number(b));
  next.deleted = [...keptOrder, ...appended].map(Number);
  // A menu with the price switched off lands here even when its cost is
  // confirmed: there is no customer-facing price to sell at.
  next.quoteOnly = sorted
    .filter((menu) => isQuoteOnly(menu, costs))
    .map((menu) => menu.id)
    .sort((a, b) => a - b);
  next.meats = central.meats || [];
  next.toppings = central.toppings || [];
  next.noMeatMenus = sorted.filter((menu) => menu.noMeat).map((menu) => menu.id);
  // Carried-over keys (preserved verbatim; out of menu-publish scope).
  for (const key of Object.keys(current || {})) {
    if (CENTRAL_MANAGED_KEYS.includes(key)) continue;
    if (!PUBLIC_OVERRIDE_KEYS.includes(key)) {
      throw new Error(`planner key ไม่ได้อยู่ใน allowlist: ${key}`);
    }
    next[key] = current[key];
  }
  next.exportedAt = now.toISOString();
  // Release marker: proves which central version a file was built from, so a
  // live-web check can confirm the Pages site serves exactly this release.
  // Public and safe (version + timestamp only, no internal data).
  next.release = { centralVersion: Number(central.version ?? 0), builtAt: now.toISOString() };
  return next;
}

function jsString(value) {
  return JSON.stringify(value);
}

// Regenerate js/menu-data.js from the central draft. Same line format as the
// legacy exporter (id/name/price/category/image/desc/badge/minPerMenu +
// shared toppings + noMeat flag) plus sortOrder for display order.
export function buildMenuDataJs(central, exportedAt = new Date()) {
  const sorted = [...central.menus].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  const toppings = central.toppings || [];
  const meats = central.meats || [];
  const lines = [
    `/* EED HALAL — Menu database for budget calculator — auto-export ${exportedAt.toLocaleString('th-TH')} */`,
    `var EED_DEFAULT_MEATS = ${JSON.stringify(meats)};`,
    `var EED_DEFAULT_TOPPINGS = ${JSON.stringify(toppings)};`,
    'var EED_MENUS = [',
  ];
  sorted.forEach((menu, index) => {
    const topStr = toppings.length ? `, toppings: ${JSON.stringify(toppings)}` : '';
    const noMeatStr = menu.noMeat ? ', noMeat: true' : '';
    const imgSafe = String(menu.image || '').replace(/\\/g, '/');
    let line = `  { id: ${menu.id}, name: ${jsString(menu.name)}, price: ${menu.price}, category: ${jsString(menu.category)}, image: ${jsString(imgSafe)}, desc: ${jsString(menu.desc || '')}, badge: ${jsString(menu.badge || '')}, minPerMenu: ${menu.minPerMenu}, sortOrder: ${menu.sortOrder}${topStr}${noMeatStr} }`;
    if (index < sorted.length - 1) line += ',';
    lines.push(line);
  });
  lines.push('];');
  return `${lines.join('\n')}\n`;
}

// An image ref is web-publishable when it is either an https URL (no local
// hosts) or a repo-relative path that exists on disk. Machine-local paths
// (C:\, file://, localhost) and directory traversal are rejected.
export function validateImageRef(image, root) {
  const ref = text(image);
  if (!ref) return 'ต้องระบุรูป';
  if (ref.includes('\\') || /^[a-zA-Z]:/.test(ref) || ref.startsWith('file:')) {
    return `พาธในเครื่องเผยแพร่บนเว็บไม่ได้: ${ref}`;
  }
  if (/localhost|127\.0\.0\.1|192\.168\.|10\.\d+\.|172\.(1[6-9]|2\d|3[01])\./.test(ref)) {
    return `ห้ามอ้าง localhost/เครื่องในไฟล์สาธารณะ: ${ref}`;
  }
  if (/^https?:\/\//i.test(ref)) {
    if (!/^https:\/\//i.test(ref)) return `URL ภายนอกต้องเป็น https: ${ref}`;
    return null;
  }
  const clean = ref.replace(/^\/+/, '');
  if (clean.includes('..')) return `ห้าม path traversal: ${ref}`;
  try {
    statSync(path.join(root, decodeURIComponent(clean)));
    return null;
  } catch {
    return `ไม่พบไฟล์รูปใน repo: ${ref}`;
  }
}

function scanForbidden(label, content) {
  const lower = String(content).toLowerCase();
  const hits = FORBIDDEN_TOKENS.filter((token) => lower.includes(token));
  const raw = String(content);
  const pathHits = FORBIDDEN_PATH_TOKENS.filter((token) => raw.includes(token));
  if (hits.length || pathHits.length) {
    throw new Error(`${label} มีข้อมูลภายใน/ข้อมูลลับหลุด: ${[...hits, ...pathHits].join(', ')}`);
  }
}

// Verify freshly built artifacts BEFORE they replace the working release:
// allowlisted keys only, no internal leak, every image web-reachable, and the
// strict 5-map id consistency the menu API relies on (fail closed).
export function assertPublishSafe({ overrides, menuDataJs, root }) {
  for (const key of Object.keys(overrides)) {
    if (!PUBLIC_OVERRIDE_KEYS.includes(key)) {
      throw new Error(`คีย์สาธารณะไม่อยู่ใน allowlist: ${key}`);
    }
  }
  const { prices, mins, names, categories, images } = overrides;
  for (const map of [prices, mins, names, categories, images]) {
    if (!isPlainObject(map)) throw new Error('catalog maps ต้องเป็นอ็อบเจกต์');
  }
  const priceIds = Object.keys(prices || {});
  if (priceIds.length === 0) throw new Error('catalog ว่างเปล่า — ห้ามเผยแพร่');
  for (const map of [mins, names, categories, images]) {
    const keys = Object.keys(map || {});
    if (keys.length !== priceIds.length || !priceIds.every((id) => Object.hasOwn(map, id))) {
      throw new Error('catalog maps คลุม id ไม่ตรงกัน — ห้ามเผยแพร่ครึ่งๆ กลางๆ');
    }
  }
  for (const entry of overrides.deleted || []) {
    if (!Object.hasOwn(prices, String(entry))) throw new Error(`deleted อ้าง id ที่ไม่มีใน catalog: ${entry}`);
  }
  for (const entry of overrides.quoteOnly || []) {
    if (!Object.hasOwn(prices, String(entry))) throw new Error(`quoteOnly อ้าง id ที่ไม่มีใน catalog: ${entry}`);
    if ((overrides.deleted || []).map(String).includes(String(entry))) {
      throw new Error(`quoteOnly ห้ามซ้อนกับ deleted (id ${entry}): ซ่อนโดยเจ้าของต้องซ่อนทุกที่`);
    }
  }
  for (const id of overrides.popular || []) {
    if (!Object.hasOwn(prices, String(id))) throw new Error(`popular อ้าง id ที่ไม่มีใน catalog: ${id}`);
  }
  for (const id of overrides.noMeatMenus || []) {
    if (!Object.hasOwn(prices, String(id))) throw new Error(`noMeatMenus อ้าง id ที่ไม่มีใน catalog: ${id}`);
  }
  // Actionable image errors first (which menu, what path), generic leak scan
  // second as a backstop.
  const imageErrors = [];
  for (const id of priceIds) {
    const problem = validateImageRef(images[id], root);
    if (problem) imageErrors.push(`id ${id}: ${problem}`);
  }
  if (imageErrors.length) throw new Error(`รูปเผยแพร่บนเว็บไม่ได้:\n${imageErrors.join('\n')}`);
  const overridesText = JSON.stringify(overrides);
  scanForbidden('planner-overrides.json', overridesText);
  scanForbidden('js/menu-data.js', menuDataJs);
}

// ---------------------------------------------------------------------------
// Publish: build -> verify -> atomic swap -> staged (files ready, NOT live).
// A separate live-web check may later confirm the release on GitHub Pages.
// ---------------------------------------------------------------------------

export const PUBLISH_FILES = ['data/planner-overrides.json', 'js/menu-data.js'];

// State shape (local only):
//   { file: {status:'staged', fileVersion, builtAt, files, hashes} | {status:'publishing'|'failed', ...} | null,
//     live: {state:'unknown'|'live'|'outdated'|'unverified', liveVersion, checkedAt, reason} | null,
//     deploy: {phase, detail, at, commit?} | null,
//     error: string | null }
export async function readPublishState(dataDir) {
  try {
    const raw = JSON.parse(await readFile(path.join(dataDir, PUBLISH_STATE_FILE), 'utf8'));
    if (raw && (raw.status === 'published' || raw.status === 'failed' || raw.status === 'publishing') && !raw.file) {
      // Legacy shape (file-built was called "published"): honest correction —
      // building files never proved the live web serves them.
      if (raw.status === 'published') {
        return {
          file: { status: 'staged', fileVersion: raw.centralVersion ?? 0, builtAt: raw.at ?? null, files: raw.files || PUBLISH_FILES, hashes: null },
          live: { state: 'unknown', liveVersion: null, checkedAt: null, reason: 'ยังไม่เคยตรวจเว็บจริง — การสร้างไฟล์ในเครื่องไม่ถือว่าเผยแพร่แล้ว' },
          deploy: null,
          error: null,
        };
      }
      return {
        file: raw.status === 'failed'
          ? { status: 'failed', fileVersion: raw.centralVersion ?? 0, builtAt: raw.at ?? null, error: raw.error || null }
          : null,
        live: null, deploy: null, error: raw.error || null,
      };
    }
    return raw;
  } catch {
    return null;
  }
}

export async function writePublishState(dataDir, record) {
  await mkdir(dataDir, { recursive: true });
  await writeFile(path.join(dataDir, PUBLISH_STATE_FILE), `${JSON.stringify(record, null, 2)}\n`, 'utf8');
}

// Real status, computed from three versions — never a simulated success:
//   ร่าง = no files built yet · มีการเปลี่ยนแปลง = draft ahead of files
//   เตรียมไฟล์แล้ว = files built, live not (yet) confirmed
//   เผยแพร่แล้ว = ONLY when the live web provably serves this file version
//   เผยแพร่ไม่สำเร็จ = last operation failed (previous release keeps serving)
export function computePublishStatus({ diff, file, live }) {
  if (file?.status === 'publishing') return 'publishing';
  if (file?.status === 'failed') return 'failed';
  if (diff?.hasChanges) return 'dirty';
  if (!file || file.status !== 'staged') return 'draft';
  // 'live' is authoritative on its own: verifyLiveRelease reports it only on
  // content match (version labels may differ across draft lineages).
  if (live?.state === 'live') return 'published';
  return 'staged';
}

export const PUBLISH_STATUS_TH = {
  draft: 'ร่าง',
  dirty: 'มีการเปลี่ยนแปลง — ยังไม่สร้างไฟล์',
  publishing: 'กำลังสร้างไฟล์',
  staged: 'เตรียมไฟล์แล้ว — รอขึ้นเว็บไซต์',
  published: 'เผยแพร่แล้ว (เว็บจริงตรงกัน)',
  failed: 'เผยแพร่ไม่สำเร็จ',
};

export const LIVE_STATE_TH = {
  unknown: 'ยังไม่ยืนยัน',
  live: 'เว็บจริงตรงกับฉบับไฟล์แล้ว',
  outdated: 'เว็บจริงยังเป็นฉบับเก่ากว่า',
  unverified: 'ยังไม่ยืนยัน (ตรวจไม่สำเร็จ)',
};

// fault: test-only hooks — 'pre-rename' throws after temps are verified but
// before any published file is replaced; 'between-renames' throws after the
// first rename. Both must leave the previous COMPLETE release in place.
export async function publishCentral({ root, dataDir, central, costs = null, now = new Date(), fault = null }) {
  const validated = validateCentral(central);
  if (!validated.ok) {
    const error = new Error(`ฐานกลางไม่ผ่านการตรวจ: ${validated.errors.join(' | ')}`);
    error.code = 'ECENTRALINVALID';
    throw error;
  }
  const clean = { ...validated.data, version: central.version ?? 0, updatedAt: central.updatedAt ?? null };
  const current = await loadPublished(root);
  const overrides = buildPlannerOverrides(clean, current.overrides, now, costs);
  const menuDataJs = buildMenuDataJs(clean, now);
  assertPublishSafe({ overrides, menuDataJs, root });

  const overridesPath = path.join(root, 'data', 'planner-overrides.json');
  const menuDataPath = path.join(root, 'js', 'menu-data.js');
  const overridesTemp = `${overridesPath}.${process.pid}.tmp`;
  const menuDataTemp = `${menuDataPath}.${process.pid}.tmp`;
  // Snapshot the working release FIRST so any mid-swap failure can restore
  // both files to the previous complete version (never a split release).
  const previous = {
    overrides: await readFile(overridesPath, 'utf8').catch(() => null),
    menuDataJs: await readFile(menuDataPath, 'utf8').catch(() => null),
  };
  const previousState = await readPublishState(dataDir);
  await writePublishState(dataDir, {
    file: { status: 'publishing', fileVersion: clean.version, builtAt: now.toISOString() },
    live: previousState?.live || null,
    deploy: previousState?.deploy || null,
    error: null,
  });
  const restorePrevious = async () => {
    if (previous.overrides !== null) await writeFile(overridesPath, previous.overrides, 'utf8');
    if (previous.menuDataJs !== null) await writeFile(menuDataPath, previous.menuDataJs, 'utf8');
  };
  try {
    await writeFile(overridesTemp, `${JSON.stringify(overrides, null, 2)}\n`, 'utf8');
    await writeFile(menuDataTemp, menuDataJs, 'utf8');
    // Re-verify exactly what will go live (temp bytes, not memory).
    const verifyOverrides = JSON.parse(await readFile(overridesTemp, 'utf8'));
    const verifyJs = await readFile(menuDataTemp, 'utf8');
    assertPublishSafe({ overrides: verifyOverrides, menuDataJs: verifyJs, root });
    if (fault === 'pre-rename') throw new Error('SIMULATED_PUBLISH_FAILURE');
    await rename(overridesTemp, overridesPath);
    if (fault === 'between-renames') throw new Error('SIMULATED_MID_SWAP_FAILURE');
    await rename(menuDataTemp, menuDataPath);
    // Post-swap check: both live bytes must equal the verified build, else
    // restore the previous complete release instead of a split one.
    const liveOverrides = await readFile(overridesPath, 'utf8');
    const liveJs = await readFile(menuDataPath, 'utf8');
    if (liveOverrides !== `${JSON.stringify(overrides, null, 2)}\n` || liveJs !== menuDataJs) {
      throw new Error('ไฟล์หลังสลับไม่ตรงฉบับที่ตรวจแล้ว — กู้ฉบับเดิมกลับ');
    }
  } catch (error) {
    await Promise.allSettled([unlink(overridesTemp), unlink(menuDataTemp)]);
    await restorePrevious().catch(() => {});
    const record = {
      file: { status: 'failed', fileVersion: clean.version, builtAt: new Date().toISOString(), error: error.message },
      live: previousState?.live || null,
      deploy: previousState?.deploy || null,
      error: error.message,
    };
    await writePublishState(dataDir, record);
    throw error;
  }
  const record = {
    file: {
      status: 'staged',
      fileVersion: clean.version,
      builtAt: now.toISOString(),
      files: PUBLISH_FILES,
      hashes: { overrides: sha256Hex(JSON.stringify(overrides, null, 2)), menuDataJs: sha256Hex(menuDataJs) },
    },
    // A new file build invalidates any older live confirmation.
    live: { state: 'unknown', liveVersion: null, checkedAt: null, reason: 'สร้างไฟล์ใหม่แล้ว — ยังไม่ตรวจเว็บจริง' },
    deploy: previousState?.deploy || null,
    error: null,
  };
  await writePublishState(dataDir, record);
  return { ok: true, record, overrides, menuDataJs };
}

// Confirm what GitHub Pages actually serves (public read, no token).
// Returns {state:'live'|'outdated'|'unverified', liveVersion, checkedAt, reason}.
export async function verifyLiveRelease({ root, file, liveBaseUrl = 'https://eedhalal.com', fetchImpl = fetch, timeoutMs = 15000 }) {
  const checkedAt = new Date().toISOString();
  if (!file || file.status !== 'staged') {
    return { state: 'unverified', liveVersion: null, checkedAt, reason: 'ยังไม่มีฉบับไฟล์ให้เทียบ (สร้างไฟล์ก่อน)' };
  }
  const localRaw = await readFile(path.join(root, 'data', 'planner-overrides.json'), 'utf8').catch(() => null);
  if (!localRaw) return { state: 'unverified', liveVersion: null, checkedAt, reason: 'อ่านไฟล์ในเครื่องไม่สำเร็จ' };
  let live;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetchImpl(`${liveBaseUrl}/data/planner-overrides.json?t=${Date.now()}`, { cache: 'no-store', signal: controller.signal });
    clearTimeout(timer);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    live = await response.json();
  } catch (error) {
    return { state: 'unverified', liveVersion: null, checkedAt, reason: `ติดต่อเว็บจริงไม่ได้ (${error.message}) — ห้ามถือว่าเผยแพร่แล้ว` };
  }
  const liveVersion = Number(live?.release?.centralVersion ?? NaN);
  if (!Number.isFinite(liveVersion)) {
    return { state: 'unverified', liveVersion: null, checkedAt, reason: 'เว็บจริงยังไม่มี release marker — ยืนยันฉบับไม่ได้' };
  }
  // Content first: version counters are per-draft-lineage (fresh installs and
  // re-migrations restart them), so equal MENU content means live even when
  // the build labels differ. Provenance metadata (release) and volatile
  // build timestamps are excluded from the comparison — customers get content.
  const canonical = (obj) => {
    const copy = JSON.parse(JSON.stringify(obj));
    delete copy.exportedAt;
    delete copy.release;
    return sha256Hex(JSON.stringify(copy));
  };
  let localParsed = null;
  try {
    localParsed = JSON.parse(localRaw);
  } catch {
    return { state: 'unverified', liveVersion: null, checkedAt, reason: 'ไฟล์ในเครื่องไม่ใช่ JSON ที่ถูกต้อง' };
  }
  if (canonical(live) === canonical(localParsed)) {
    const extra = liveVersion === Number(file.fileVersion)
      ? ''
      : ` (เลขรุ่นต่างสาย: เว็บ v${liveVersion} ≡ ไฟล์ v${file.fileVersion} เนื้อหาตรงกัน)`;
    return { state: 'live', liveVersion, checkedAt, reason: `เว็บจริงให้บริการตรงกับไฟล์ที่สร้างแล้ว${extra}` };
  }
  if (liveVersion !== Number(file.fileVersion)) {
    return { state: 'outdated', liveVersion, checkedAt, reason: `เว็บจริงเป็นฉบับ v${liveVersion} ส่วนฉบับไฟล์คือ v${file.fileVersion} และเนื้อหาไม่ตรงกัน` };
  }
  return { state: 'outdated', liveVersion, checkedAt, reason: `ฉบับตรงกัน (v${liveVersion}) แต่เนื้อหาไม่ตรงทั้งหมด — ตรวจเพิ่มก่อนถือว่าสำเร็จ` };
}

// Parse js/menu-data.js EED_MENUS without executing page scripts. The result
// is re-serialized so callers get main-realm plain data (vm-realm arrays
// carry a foreign Array prototype and break strict structural equality).
export async function parseMenuDataJs(menuDataJs) {
  const vm = await import('node:vm');
  const context = {};
  vm.createContext(context);
  vm.runInContext(menuDataJs, context, { timeout: 2000 });
  if (!Array.isArray(context.EED_MENUS)) return [];
  return JSON.parse(JSON.stringify(context.EED_MENUS));
}

// Extract POPULAR_IDS from js/popular-menu-hydrate.js (best effort).
export function parsePopularIds(hydrateJs) {
  const match = String(hydrateJs || '').match(/var POPULAR_IDS\s*=\s*\[([^\]]*)\]/);
  if (!match) return [];
  return match[1].split(',').map((part) => Number(part.trim())).filter((id) => Number.isInteger(id));
}
