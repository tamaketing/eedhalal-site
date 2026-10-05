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
//   (the retired internal cost DB is gone; prices are the only gate)
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
import {
  SIDE_ITEM_KINDS,
  TIER_CLASSIC,
  computeTierFloors,
  isTierId,
  normalizeTier,
  setsFromProjection,
  tierDefinitions,
} from './mealbox-tiers.mjs';

export const CENTRAL_FILE = 'menu-central.json';
export const PUBLISH_STATE_FILE = 'menu-publish-state.json';

// Public-field allowlist for data/planner-overrides.json top-level keys.
// Central-managed keys are rebuilt on publish; carried-over keys are preserved
// verbatim from the currently published file (snacks/toppings are out of
// the menu-publish scope and must survive a publish unchanged). `release`
// proves which central version a file was built from (used by live checks).
// A menu has exactly one level and no category: the tier list in
// data/business-rules.json (services.mealBox.tiers) is the single grouping the
// whole system uses — admin filters, the customer menu pages, the calculator,
// the internal API and the LINE bot all read that tier, never a second axis.
// ---------------------------------------------------------------------------
// Side items = the Signature component database
// ---------------------------------------------------------------------------
// A side item is the SECOND dish that sits in the Signature box beside the main
// dish: rice, main, second dish, vegetables. It is a product component, never a
// menu: it is not browsable, not orderable on its own and carries no rice.
//
// `kind` says what kind of second dish it is. It is not shown to the customer
// (the page says "อาหารเมนูที่ 2" and lists the dishes); it exists because
// cooking type changes cost, portion and packing, and because it decides what
// may go in which tier:
//   side      = a savoury second dish for the Signature box
//   soup_curry = a soup or curry second dish for the Signature box
//   dessert   = sweet, needs a corrugated box, so it is NOT a Signature box
//               item; it belongs to the premium Executive set
//
// Two invariants the rest of the pipeline relies on:
//   1. `cost` NEVER leaves this draft. It is kitchen data, so the published
//      projection is built field-by-field below and simply has no cost key.
//   2. A price is published only when the owner has confirmed it. An item whose
//      `priceAdjustment` is missing is forced to `pending`, so
//      `priceStatus === 'ready'` always implies a real number exists.
// SIDE_ITEM_KINDS itself lives in mealbox-tiers.mjs (this module already imports
// it) so the dependency stays one-way.
export const SIDE_ITEM_PRICE_STATUS = ['pending', 'ready'];
const SIDE_ITEM_ID = /^[a-z0-9][a-z0-9-]*$/;

function sideItemErrors(raw, label) {
  const errors = [];
  if (!isPlainObject(raw)) return [`${label}: ข้อมูลไม่ถูกต้อง`];
  const id = text(raw.id).toLowerCase();
  if (!SIDE_ITEM_ID.test(id)) {
    errors.push(`${label}: id ต้องเป็นตัวอักษรอังกฤษและตัวเลขคั่นด้วยขีด เช่น side-001`);
  }
  if (!text(raw.nameTh)) errors.push(`${label}: ต้องมีชื่อภาษาไทย`);
  if (!text(raw.nameEn)) errors.push(`${label}: ต้องมีชื่อภาษาอังกฤษ`);
  const kind = text(raw.kind);
  if (!SIDE_ITEM_KINDS.includes(kind)) {
    errors.push(`${label}: ต้องเลือกประเภท (${SIDE_ITEM_KINDS.join(' / ')})`);
  }
  const status = text(raw.priceStatus);
  if (status && !SIDE_ITEM_PRICE_STATUS.includes(status)) {
    errors.push(`${label}: priceStatus ต้องเป็น ${SIDE_ITEM_PRICE_STATUS.join(' หรือ ')}`);
  }
  if (raw.cost !== undefined && raw.cost !== null && raw.cost !== '') {
    const cost = Number(raw.cost);
    if (!Number.isFinite(cost) || cost < 0) errors.push(`${label}: ต้นทุนต้องเป็นตัวเลขที่ไม่ติดลบ`);
  }
  if (raw.priceAdjustment !== undefined && raw.priceAdjustment !== null && raw.priceAdjustment !== '') {
    const adjustment = Number(raw.priceAdjustment);
    if (!Number.isFinite(adjustment) || adjustment <= 0) errors.push(`${label}: ราคาเพิ่มต้องเป็นตัวเลขมากกว่า 0 (ยังไม่พร้อมให้ใส่ค่าว่าง)`);
  }
  return errors;
}

function normalizeSideItem(raw) {
  const id = text(raw?.id).toLowerCase();
  const nameTh = text(raw?.nameTh);
  const kind = text(raw?.kind);
  if (!SIDE_ITEM_ID.test(id) || !nameTh || !SIDE_ITEM_KINDS.includes(kind)) return null;
  const nameEn = text(raw?.nameEn);
  const cost = Number(raw.cost);
  const rawAdjustment = raw.priceAdjustment;
  const hasAdjustment = rawAdjustment !== undefined && rawAdjustment !== null && rawAdjustment !== '';
  const adjustment = Number(rawAdjustment);
  const priceAdjustment = hasAdjustment && Number.isFinite(adjustment) && adjustment > 0
    ? Math.round(adjustment * 100) / 100
    : null;
  // No number means nothing to publish, whatever the status field claims.
  const priceStatus = priceAdjustment === null
    ? 'pending'
    : (SIDE_ITEM_PRICE_STATUS.includes(text(raw.priceStatus)) ? text(raw.priceStatus) : 'pending');
  return {
    id,
    nameTh,
    nameEn: nameEn || nameTh,
    kind,
    ...(Number.isFinite(cost) && cost >= 0 ? { cost: Math.round(cost * 100) / 100 } : {}),
    priceAdjustment,
    priceStatus,
    active: raw.active === undefined ? true : raw.active === true,
    // The owner's job is to decide WHEN a dish goes on the web, so a dish they
    // just added is visible by default; switching it off is one checkbox.
    public: raw.public === undefined ? true : raw.public === true,
  };
}

export function normalizeSideItems(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const item of raw) {
    const normalized = normalizeSideItem(item);
    if (!normalized || seen.has(normalized.id)) continue;
    seen.add(normalized.id);
    out.push(normalized);
  }
  return out;
}

// Exactly the fields the web may read. `cost` has no key here by construction.
// `kind` is published so consumers can tell a Signature second dish from a
// premium-box dessert; the customer-facing label stays "อาหารเมนูที่ 2".
export function publicSideItemOf(item) {
  return {
    id: item.id,
    nameTh: item.nameTh,
    nameEn: item.nameEn,
    kind: item.kind,
    priceAdjustment: item.priceStatus === 'ready' ? item.priceAdjustment : null,
    priceStatus: item.priceStatus,
    active: item.active === true,
    public: item.public === true,
  };
}

export function publicSideItemsOf(list) {
  return normalizeSideItems(list).map(publicSideItemOf);
}

// A menu's tier decides the starting price a customer is shown for it, so the
// migration never guesses: the published tier wins, then the legacy one, and a
// draft written before tiers existed falls back to the classic tier. The owner
// refines the rest from the admin page.
function tierFromSources(publishedTier, legacyTier) {
  for (const candidate of [publishedTier, legacyTier]) {
    if (isTierId(candidate)) return candidate;
  }
  return TIER_CLASSIC;
}

export const PUBLIC_OVERRIDE_KEYS = [
  'prices', 'mins', 'images', 'names',
  'descs', 'badges', 'sortOrder', 'popular', 'deleted', 'quoteOnly',
  'tiers', 'newMenus', 'toppings', 'sideItems',
  'snackPrices', 'snackNames', 'snackCats', 'snackAddons',
  'exportedAt', 'release',
];

// Central-managed keys: rebuilt from the central draft on every publish
// (`release` included: the build stamp belongs to the pipeline, never carried).
// toppings is rebuilt too — leaving it to the carry-over loop below would
// silently keep stale published values even though lines 502+ just rebuilt it
// from the draft. sideItems is rebuilt here for the same reason: a renamed side
// or a confirmed price must reach the web on publish.
export const CENTRAL_MANAGED_KEYS = [
  'prices', 'mins', 'images', 'names',
  'descs', 'badges', 'sortOrder', 'popular', 'deleted', 'quoteOnly', 'release',
  'tiers', 'toppings', 'sideItems',
];

// Keys a previously published file may still carry that this pipeline no longer
// produces. They are DROPPED on publish — never carried over, never an error — so
// the first publish after a field is retired removes it from the web instead of
// failing or leaving the retired value live. `categories` + `categoryList` are
// here because a menu is now grouped by its tier alone, with no second axis.
export const RETIRED_OVERRIDE_KEYS = ['categories', 'categoryList'];

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
// values (desc/badge) from js/menu-data.js, display order from the
// menu-data.js line order, popular order from the hydrate POPULAR_IDS list.
// Internal data is deliberately NOT copied here.
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
      tier: tierFromSources(planner.tiers?.[id], legacy.tier),
      image: planner.images?.[id] ?? legacy.image ?? '',
      desc: typeof legacy.desc === 'string' ? legacy.desc : '',
      badge: typeof legacy.badge === 'string' ? legacy.badge : '',
      minPerMenu: planner.mins?.[id] ?? legacy.minPerMenu ?? 5,
      hidden: deleted.has(String(id)),
      sortOrder: fileOrder.has(String(id)) ? fileOrder.get(String(id)) : 10000 + Number(id),
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
    // Side items carry no cost in the published file, so a fresh migration can
    // only recover the customer-facing half; the owner re-enters cost locally.
    sideItems: publicSideItemsOf(planner.sideItems || []),
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
    const tier = text(raw.tier);
    if (tier && !isTierId(tier)) {
      errors.push(`${label}: ระดับสินค้า “${tier}” ไม่ถูกต้อง (ต้องเป็น classic, signature หรือ executive)`);
    }
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
      // A draft written before tiers existed gets the migration default here,
      // so saving never silently flattens every set to the classic tier.
      tier: isTierId(raw.tier) ? raw.tier : tierFromSources(undefined, undefined),
      image,
      desc: typeof raw.desc === 'string' ? raw.desc : '',
      badge: typeof raw.badge === 'string' ? raw.badge : '',
      minPerMenu,
      hidden: raw.hidden === true,
      sortOrder,
      // Owner switches (business rule: data/business-rules.json -> menuPublishing).
      // showPrice:false publishes the menu in `quoteOnly` (name + ask-for-quote
      // marker, excluded from ordering) because there is no customer-facing
      // price. noLock is owner-tool only and is never published.
      showPrice: raw.showPrice === undefined ? true : raw.showPrice === true,
      noLock: raw.noLock === undefined ? true : raw.noLock === true,
      internalNote: typeof raw.internalNote === 'string' ? raw.internalNote : '',
    });
  }
for (const key of ['toppings']) {
    const list = central[key];
    if (list !== undefined && !Array.isArray(list)) errors.push(`${key} ต้องเป็นอาร์เรย์`);
  }
  // Side items: a malformed entry is an error, never a silent drop. The owner
  // must never believe a side he typed was saved when it was thrown away.
  const rawSideItems = central.sideItems === undefined ? [] : central.sideItems;
  if (!Array.isArray(rawSideItems)) {
    errors.push('sideItems ต้องเป็นอาร์เรย์');
  } else {
    const sideIds = new Set();
    rawSideItems.forEach((raw, index) => {
      errors.push(...sideItemErrors(raw, `sideItems[${index}]`));
      const id = text(raw?.id).toLowerCase();
      if (sideIds.has(id)) errors.push(`sideItems[${index}]: id ซ้ำ (${id})`);
      sideIds.add(id);
    });
  }
  const sideItems = normalizeSideItems(rawSideItems);
  const popular = central.popular === undefined ? [] : central.popular;
  if (!Array.isArray(popular)) errors.push('popular ต้องเป็นอาร์เรย์รหัสเมนูตามลำดับแสดง');
  else {
    for (const id of popular) {
      if (!seen.has(Number(id))) errors.push(`popular: ไม่พบเมนูรหัส ${id} ในฐานกลาง`);
    }
  }
  if (errors.length) return { ok: false, errors, data: null };
  data.toppings = Array.isArray(central.toppings) ? central.toppings : [];
  data.sideItems = sideItems;
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

// Price rule (business rule: data/business-rules.json -> mealBox.tiers + the
// central menu database). A tier starting price is never declared anywhere: it
// is the cheapest set of that tier that is open for sale and shown on the web.
// A tier with no such set has no price, and the web asks for a quotation
// instead of repeating an older figure.
export function tierPriceConsistency(rules, projection) {
  const menus = projection?.menus instanceof Map ? projection.menus : new Map();
  const definitions = tierDefinitions(rules);
  const sets = setsFromProjection(projection);
  const { floors, members } = computeTierFloors(sets);
  const warnings = [];
  if (!definitions.length) {
    warnings.push('ไม่พบระดับข้าวกล่องใน business-rules.json (services.mealBox.tiers)');
  }
  if (!floors[TIER_CLASSIC]) {
    warnings.push('ยังไม่มีชุดระดับ classic ที่เปิดขายและแสดงบนเว็บ — ยังประกาศราคาเริ่มต้นไม่ได้');
  }
  const tiers = definitions.map((tier) => {
    const floor = floors[tier.id] ?? null;
    return {
      id: tier.id,
      nameTh: tier.nameTh,
      nameEn: tier.nameEn,
      boxFormatTh: tier.boxFormatTh,
      boxFormatEn: tier.boxFormatEn,
      priceFrom: floor ? floor.priceFrom : null,
      sourceId: floor ? floor.sourceId : null,
      sourceName: floor ? floor.sourceName : null,
      memberCount: members[tier.id].length,
    };
  });
  const unassigned = [...menus.entries()]
    .filter(([, menu]) => menu.hidden !== true && !isTierId(menu.tier))
    .map(([id, menu]) => ({ id: Number(id), name: menu.name }))
    .sort((a, b) => a.id - b.id);
  return {
    ok: warnings.length === 0,
    tiers,
    unassigned,
    sellableCount: sets.filter(isSellableSet).length,
    warnings,
  };
}

function isSellableSet(set) {
  return !set.hidden && !set.quoteOnly && set.price > 0;
}

function effectiveHiddenOf(menu) {
  return menu.hidden === true;
}

// Quote-only: the owner deliberately switched the price off, so the customer
// cannot see a price. The name may still show with an ask-for-quote marker, but
// the menu stays out of ordering/calculation/recommendation. There is no cost
// gate — every served menu that carries a price is orderable.
function isQuoteOnly(menu) {
  if (menu.hidden === true) return false;
  return menu.showPrice === false;
}

// Public projection of the central draft: ONLY publishable fields.
// Cost/internal data cannot leak through the diff because it never enters it.
export function publicProjectionOfCentral(central) {
  const menus = new Map();
  for (const menu of central.menus || []) {
    menus.set(String(menu.id), {
      name: menu.name,
      price: menu.price,
      tier: normalizeTier(menu.tier),
      image: menu.image,
      desc: menu.desc || '',
      badge: menu.badge || '',
      minPerMenu: menu.minPerMenu,
      hidden: effectiveHiddenOf(menu),
      ownerHidden: menu.hidden === true,
      // The owner switched the price off — the only reason a served dish is not
      // orderable.
      costBlocked: isQuoteOnly(menu),
      priceHidden: menu.showPrice === false,
      sortOrder: menu.sortOrder,
    });
  }
  return {
    menus,
    toppings: central.toppings || [],
sideItems: publicSideItemsOf(central.sideItems || []),
    popular: (central.popular || []).map(String),
  };
}

// Public projection of the published files. menu-data.js is parsed for
// desc/badge/sortOrder (overrides maps carry the rest).
export function publicProjectionOfPublished({ overrides, menuDataMenus = [] }) {
  const legacyById = new Map(menuDataMenus.map((menu) => [String(menu.id), menu]));
  const menus = new Map();
  const deleted = new Set((overrides.deleted || []).map(String));
  for (const id of Object.keys(overrides.prices || {})) {
    const legacy = legacyById.get(String(id)) || {};
    menus.set(String(id), {
      name: overrides.names?.[id] ?? legacy.name,
      price: overrides.prices?.[id],
      tier: normalizeTier(overrides.tiers?.[id] ?? legacy.tier),
      image: overrides.images?.[id] ?? legacy.image,
      desc: overrides.descs?.[id] ?? legacy.desc ?? '',
      badge: overrides.badges?.[id] ?? legacy.badge ?? '',
      minPerMenu: overrides.mins?.[id] ?? legacy.minPerMenu,
      hidden: deleted.has(String(id)),
      sortOrder: overrides.sortOrder?.[id] ?? legacy.sortOrder ?? null,
    });
  }
  return {
    menus,
    toppings: overrides.toppings || [],
sideItems: publicSideItemsOf(overrides.sideItems || []),
    popular: (overrides.popular || []).map(String),
  };
}

const COMPARE_FIELDS = [
  'name', 'price', 'tier', 'image', 'desc', 'badge',
  'minPerMenu', 'hidden', 'sortOrder',
];

// Diff central draft vs last published release, public fields only.
// A cost-AMOUNT-only edit (still orderable) never appears here; a cost edit
// that flips quote-only status (no cost -> confirmed, or confirmed -> cleared)
// DOES create a pending web publish because ordering availability changes.
// Name/price/tier edits always appear, so renames reach both the cards
// and the full name list in one publish.
export function diffPublicChanges(central, published) {
  const left = publicProjectionOfCentral(central);
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
  const popularChanged = JSON.stringify(left.popular) !== JSON.stringify(right.popular);
  // A side rename, a confirmed price or a retired side all change what the web
  // may say about Signature, so each one is a pending publish.
  const sideItemsChanged = JSON.stringify(left.sideItems) !== JSON.stringify(right.sideItems);
  const hasChanges = added.length > 0 || changed.length > 0 || shown.length > 0
    || hidden.length > 0 || removed.length > 0
    || quoteOnlyChanged || toppingsChanged || popularChanged
    || sideItemsChanged;
  return {
    added, changed, shown, hidden, removed, costBlocked,
    quoteOnlyChanged,
    toppingsChanged, popularChanged, sideItemsChanged,
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

export function buildPlannerOverrides(central, current, now = new Date()) {
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
  next.tiers = pick((menu) => normalizeTier(menu.tier));
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
    .filter((menu) => isQuoteOnly(menu))
    .map((menu) => menu.id)
    .sort((a, b) => a - b);
  next.toppings = central.toppings || [];
  // Side items: published field-by-field, so `cost` cannot leak and an
  // unconfirmed price stays null instead of becoming a number to guess at.
  next.sideItems = publicSideItemsOf(central.sideItems || []);
  // Carried-over keys (preserved verbatim; out of menu-publish scope).
  for (const key of Object.keys(current || {})) {
    if (CENTRAL_MANAGED_KEYS.includes(key)) continue;
    if (RETIRED_OVERRIDE_KEYS.includes(key)) continue;
    // newMenus[] used to carry owner-added sets that predated the central draft,
    // straight past the draft into the published file. Because those entries are
    // not owned by the draft, hiding a menu in the admin UI could never reach
    // them: the customer menu page appended every one of them to the catalogue
    // at runtime, so retired dishes kept showing up next to live ones. The
    // central draft is the single source of truth for the catalogue, so a set
    // that is not in the draft is not for sale. The key stays (as an empty list)
    // so the consumers that read it keep working.
    if (key === 'newMenus') {
      next.newMenus = [];
      continue;
    }
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
// legacy exporter (id/name/price/tier/image/desc/badge/minPerMenu + shared
// toppings) plus sortOrder for display order.
export function buildMenuDataJs(central, exportedAt = new Date()) {
  const sorted = [...central.menus].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
const toppings = central.toppings || [];
  const lines = [
    `/* EED HALAL — Menu database for budget calculator — auto-export ${exportedAt.toLocaleString('th-TH')} */`,
    `var EED_DEFAULT_TOPPINGS = ${JSON.stringify(toppings)};`,
    'var EED_MENUS = [',
  ];
  sorted.forEach((menu, index) => {
    const topStr = toppings.length ? `, toppings: ${JSON.stringify(toppings)}` : '';
    const imgSafe = String(menu.image || '').replace(/\\/g, '/');
    let line = `  { id: ${menu.id}, name: ${jsString(menu.name)}, price: ${menu.price}, tier: ${jsString(normalizeTier(menu.tier))}, image: ${jsString(imgSafe)}, desc: ${jsString(menu.desc || '')}, badge: ${jsString(menu.badge || '')}, minPerMenu: ${menu.minPerMenu}, sortOrder: ${menu.sortOrder}${topStr} }`;
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
// strict catalog id consistency the menu API relies on (fail closed).
export function assertPublishSafe({ overrides, menuDataJs, root }) {
  for (const key of Object.keys(overrides)) {
    if (!PUBLIC_OVERRIDE_KEYS.includes(key)) {
      throw new Error(`คีย์สาธารณะไม่อยู่ใน allowlist: ${key}`);
    }
  }
  const { prices, mins, names, images, tiers } = overrides;
  for (const map of [prices, mins, names, images, tiers]) {
    if (!isPlainObject(map)) throw new Error('catalog maps ต้องเป็นอ็อบเจกต์');
  }
  const priceIds = Object.keys(prices || {});
  if (priceIds.length === 0) throw new Error('catalog ว่างเปล่า — ห้ามเผยแพร่');
  for (const map of [mins, names, images, tiers]) {
    const keys = Object.keys(map || {});
    if (keys.length !== priceIds.length || !priceIds.every((id) => Object.hasOwn(map, id))) {
      throw new Error('catalog maps คลุม id ไม่ตรงกัน — ห้ามเผยแพร่ครึ่งๆ กลางๆ');
    }
  }
  for (const [id, tier] of Object.entries(tiers)) {
    if (!isTierId(tier)) {
      throw new Error(`tiers[${id}] = “${tier}” ไม่ใช่ระดับสินค้าที่ถูกต้อง`);
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
  // Side items: the same rule the tier copy depends on — a published price must
  // be a confirmed number, and kitchen cost must never reach the web.
  const sideIds = new Set();
  for (const item of overrides.sideItems || []) {
    if (!isPlainObject(item)) throw new Error('sideItems ต้องเป็นอาร์เรย์ของอ็อบเจกต์');
    if (Object.hasOwn(item, 'cost')) throw new Error(`sideItems ${item.id}: ต้นทุนห้ามเผยแพร่`);
    if (sideIds.has(item.id)) throw new Error(`sideItems: id ซ้ำ (${item.id})`);
    sideIds.add(item.id);
    if (item.priceStatus === 'ready' && !Number.isFinite(Number(item.priceAdjustment))) {
      throw new Error(`sideItems ${item.id}: priceStatus=ready แต่ไม่มีราคาเพิ่ม — ห้ามเผยแพร่ราคาที่ยังไม่ยืนยัน`);
    }
    if (item.priceStatus !== 'ready' && item.priceAdjustment !== null) {
      throw new Error(`sideItems ${item.id}: ยังไม่ยืนยันราคาแต่มีตัวเลขอยู่ — ต้องตั้ง priceStatus เป็น ready เมื่อพร้อม`);
    }
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
export async function publishCentral({ root, dataDir, central, now = new Date(), fault = null }) {
  const validated = validateCentral(central);
  if (!validated.ok) {
    const error = new Error(`ฐานกลางไม่ผ่านการตรวจ: ${validated.errors.join(' | ')}`);
    error.code = 'ECENTRALINVALID';
    throw error;
  }
  const clean = { ...validated.data, version: central.version ?? 0, updatedAt: central.updatedAt ?? null };
  const current = await loadPublished(root);
  const overrides = buildPlannerOverrides(clean, current.overrides, now);
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
