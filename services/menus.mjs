// EED HALAL — deterministic meal-box menu service (planner-backed).
//
// SOURCE OF TRUTH for meal-box pricing: data/planner-overrides.json.
//   PRICE          -> planner prices[id]      (customer selling price, THB/box)
//   MINIMUM/MENU   -> planner mins[id]
//   DISPLAY NAME   -> planner names[id]      (Thai; no English names exist)
//   CATEGORY       -> planner categories[id]
//   AVAILABILITY   -> planner deleted[]       (listed ids are hidden)
//
// Menu identity is stable by menu id. The legacy website JS menu file may
// still provide non-price descriptive metadata (desc/badge) elsewhere, but
// its price field is NEVER authoritative here: this module does not import
// it and never falls back to it. No prompt, website, memory, or hardcoded
// price is consulted either: on any planner problem this module throws
// (fail closed) instead of returning stale data.
//
// Freshness: the planner file is re-read whenever its mtime changes, so a
// price-only planner edit is visible without an API restart, without
// check-system --write, and without prompt regeneration.
//
// LIMITATION (by data, not by code): planner categories are
// ข้าวราดแกง / ข้าวผัด / เส้น / อาหารอินเดีย / พรีเมียม. There is no
// protein/type field, so a query like "เมนูไก่ไม่เกิน 100" cannot be
// reliably classified from category alone. This service does NOT infer
// protein from menu names.

import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ValidationError } from './errors.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PLANNER_PATH = path.resolve(HERE, '..', 'data', 'planner-overrides.json');

export const MEALBOX_SOURCE = 'planner-overrides';
export const MEALBOX_SERVICE_TYPE = 'mealbox';
export const MENU_DEFAULT_LIMIT = 20;
export const MENU_MAX_LIMIT = 100;

// Fail-closed catalog error. The HTTP layer maps unknown errors to
// 500 { error: 'internal_error' }, so the message below never reaches a
// caller with filesystem details. Keep it generic on purpose.
export class MenuCatalogError extends Error {
  constructor(message = 'mealbox catalog unavailable') {
    super(message);
    this.name = 'MenuCatalogError';
  }
}

// Cache: plannerPath -> { mtimeMs, menus }. Reloads automatically when
// the file mtime changes (price edits need no restart).
const cache = new Map();

function fail() {
  throw new MenuCatalogError();
}

function isRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeId(value) {
  if (typeof value === 'number' && Number.isInteger(value)) return String(value);
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) return String(Number(value.trim()));
  return null;
}

// Build the ACTIVE catalog (planner ids minus deleted[]) from raw planner
// JSON. Throws MenuCatalogError on anything unexpected: missing maps,
// invalid price/min/name/category/image, inconsistent id sets across maps,
// or an invalid deleted entry. Never returns partial/stale data.
function buildActiveCatalog(planner) {
  if (!isRecord(planner)) fail();
  const { prices, mins, names, categories, images, deleted } = planner;
  for (const map of [prices, mins, names, categories, images]) {
    if (!isRecord(map)) fail();
  }
  if (!Array.isArray(deleted)) fail();

  const priceIds = Object.keys(prices);
  if (priceIds.length === 0) fail();
  // The five catalog maps must cover exactly the same menu ids. A partial
  // edit (e.g. price added without a name) fails closed instead of
  // serving a half-written entry.
  for (const map of [mins, names, categories, images]) {
    const keys = Object.keys(map);
    if (keys.length !== priceIds.length || !priceIds.every((id) => Object.hasOwn(map, id))) fail();
  }

  const deletedIds = new Set();
  for (const entry of deleted) {
    const id = normalizeId(entry);
    if (id === null || !Object.hasOwn(prices, id)) fail();
    deletedIds.add(id);
  }

  const menus = [];
  for (const id of priceIds) {
    if (deletedIds.has(id)) continue;
    const price = prices[id];
    const minPerMenu = mins[id];
    const name = names[id];
    const category = categories[id];
    const image = images[id];
    if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) fail();
    if (typeof minPerMenu !== 'number' || !Number.isInteger(minPerMenu) || minPerMenu < 1) fail();
    if (typeof name !== 'string' || !name.trim()) fail();
    if (typeof category !== 'string' || !category.trim()) fail();
    if (typeof image !== 'string' || !image.trim()) fail();
    menus.push({
      id,
      name: name.trim(),
      price,
      minPerMenu,
      category: category.trim(),
      image: image.trim(),
    });
  }
  if (menus.length === 0) fail();
  return sortMenus(menus);
}

function sortMenus(menus) {
  return [...menus].sort((a, b) => {
    if (a.price !== b.price) return a.price - b.price;
    if (a.name !== b.name) return a.name < b.name ? -1 : 1;
    return Number(a.id) - Number(b.id);
  });
}

function resolvePlannerPath(override) {
  if (typeof override === 'string' && override.trim()) return path.resolve(override.trim());
  if (typeof process.env.EED_PLANNER_PATH === 'string' && process.env.EED_PLANNER_PATH.trim()) {
    return path.resolve(process.env.EED_PLANNER_PATH.trim());
  }
  return DEFAULT_PLANNER_PATH;
}

async function loadActiveCatalog(plannerPath) {
  const resolved = resolvePlannerPath(plannerPath);
  let mtimeMs;
  try {
    ({ mtimeMs } = await stat(resolved));
  } catch {
    fail();
  }
  const cached = cache.get(resolved);
  if (cached && cached.mtimeMs === mtimeMs) return cached.menus;
  let raw;
  try {
    raw = await readFile(resolved, 'utf8');
  } catch {
    fail();
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    fail();
  }
  const menus = buildActiveCatalog(parsed);
  cache.set(resolved, { mtimeMs, menus });
  return menus;
}

// Test hook: drop cached planner data (e.g. between fixture rewrites when
// the filesystem mtime granularity cannot be trusted).
export function clearMenuCache(plannerPath) {
  if (plannerPath === undefined) cache.clear();
  else cache.delete(resolvePlannerPath(plannerPath));
}

export function normalizeMenuQuery(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function matchesQuery(menu, query) {
  const name = normalizeMenuQuery(menu.name);
  const q = normalizeMenuQuery(query);
  if (!q) return false;
  return name === q || name.includes(q);
}

// Active catalog, sorted by price ASC, then name, then id.
export async function getMealboxMenuCatalog(options = {}) {
  return loadActiveCatalog(options.plannerPath);
}

export async function getMealboxMenuById(id, options = {}) {
  const normalized = normalizeId(id);
  if (normalized === null) return null;
  const menus = await loadActiveCatalog(options.plannerPath);
  return menus.find((menu) => menu.id === normalized) ?? null;
}

// Deterministic Thai name lookup over ACTIVE menus only. Exact normalized
// matches sort before substring matches. No English invention: a query
// with no safe Thai match returns [].
export async function lookupMealboxMenuByName(query, options = {}) {
  const q = normalizeMenuQuery(query);
  if (!q) return [];
  const menus = await loadActiveCatalog(options.plannerPath);
  const exact = [];
  const partial = [];
  for (const menu of menus) {
    const name = normalizeMenuQuery(menu.name);
    if (name === q) exact.push(menu);
    else if (name.includes(q)) partial.push(menu);
  }
  return [...sortMenus(exact), ...sortMenus(partial)];
}

export async function findMealboxMenusByExactPrice(price, options = {}) {
  return findMealboxMenus({ ...options, exactPrice: price });
}

export async function findMealboxMenusByMaxPrice(maxPrice, options = {}) {
  return findMealboxMenus({ ...options, maxPrice });
}

// Combined deterministic filter. exactPrice/maxPrice must be finite
// numbers > 0 when provided; invalid filter input throws ValidationError
// (HTTP 400), while catalog problems throw MenuCatalogError (fail closed).
// Unknown categories match nothing (never an error, never a guess).
export async function findMealboxMenus(options = {}) {
  const { exactPrice, maxPrice, category, query, limit, plannerPath } = options;
  let menus = await loadActiveCatalog(plannerPath);
  if (exactPrice !== undefined && exactPrice !== null) {
    if (typeof exactPrice !== 'number' || !Number.isFinite(exactPrice) || exactPrice <= 0) {
      throw new ValidationError('invalid price');
    }
    menus = menus.filter((menu) => menu.price === exactPrice);
  }
  if (maxPrice !== undefined && maxPrice !== null) {
    if (typeof maxPrice !== 'number' || !Number.isFinite(maxPrice) || maxPrice <= 0) {
      throw new ValidationError('invalid maxPrice');
    }
    menus = menus.filter((menu) => menu.price <= maxPrice);
  }
  if (category !== undefined && category !== null && String(category).trim() !== '') {
    const wanted = String(category).trim();
    menus = menus.filter((menu) => menu.category === wanted);
  }
  if (query !== undefined && query !== null && normalizeMenuQuery(query) !== '') {
    const q = normalizeMenuQuery(query);
    const exact = menus.filter((menu) => normalizeMenuQuery(menu.name) === q);
    const partial = menus.filter((menu) => {
      const name = normalizeMenuQuery(menu.name);
      return name !== q && name.includes(q);
    });
    menus = [...sortMenus(exact), ...sortMenus(partial)];
  }
  const sorted = sortMenus(menus);
  const take = clampLimit(limit);
  return sorted.slice(0, take);
}

export function clampLimit(limit) {
  const parsed = Number(limit);
  if (limit === undefined || limit === null || limit === '' || !Number.isFinite(parsed)) return MENU_DEFAULT_LIMIT;
  return Math.min(Math.max(Math.floor(parsed), 1), MENU_MAX_LIMIT);
}
