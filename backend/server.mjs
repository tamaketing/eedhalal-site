import { createServer } from 'node:http';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const adminDir = path.resolve(__dirname, 'admin');
const dataDir = path.resolve(rootDir, 'data');
const dbFile = path.resolve(dataDir, 'app-db.json');
const seedMenuFile = path.resolve(rootDir, 'menu.json');

const host = process.env.API_HOST;
const port = Number(process.env.API_PORT || 80);
const lineOaLink = process.env.LINE_OA_LINK || 'https://line.me/R/ti/p/@eedhalal';
const lineChannelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN || '';

const DAY_MS = 24 * 60 * 60 * 1000;
const FIRST_TIME_DISCOUNT_RATE = 0.10;
const PROMOTION_TYPES = new Set(['clearance_percent', 'clearance_fixed_price', 'bundle']);
const ORDER_STATUSES = new Set(['New', 'Cooking', 'Ready', 'Completed']);

function safeJsonParse(raw, fallback) {
  try {
    return raw ? JSON.parse(raw) : fallback;
  } catch (_error) {
    return fallback;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function roundMoney(value) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return 0;
  return Math.round(numeric * 100) / 100;
}

function normalizeOrderStatus(rawStatus) {
  const status = String(rawStatus || '').trim();
  if (ORDER_STATUSES.has(status)) return status;

  if (status === 'AwaitingSlip') return 'New';
  if (status === 'SlipReceived') return 'Cooking';
  if (status === 'SlipRejected') return 'New';
  if (status === 'Confirmed') return 'Completed';

  return 'New';
}

function createId(prefix) {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function normalizePhoneKey(phoneRaw) {
  const digitsOnly = String(phoneRaw || '').replace(/\D/g, '');
  if (!digitsOnly) return '';
  if (digitsOnly.startsWith('66') && digitsOnly.length === 11) {
    return `0${digitsOnly.slice(2)}`;
  }
  return digitsOnly;
}

function generateOrderId(phoneKey = '') {
  const timestamp = Date.now().toString().slice(-6);
  const random = Math.floor(Math.random() * 900 + 100);
  const phoneToken = phoneKey ? phoneKey.slice(-4) : '0000';
  return `ODR-${phoneToken}-${timestamp}${random}`;
}

function normalizeMenuItem(item, index = 0) {
  const priceValue = Number(item?.price);
  return {
    id: item?.id || createId('menu'),
    name: String(item?.name || `Menu ${index + 1}`),
    description: String(item?.description || ''),
    image: String(item?.image || ''),
    tag: String(item?.tag || ''),
    price: Number.isFinite(priceValue) ? roundMoney(priceValue) : 0
  };
}

function normalizeMenuList(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map((item, index) => normalizeMenuItem(item, index));
}

function getMenuIndex(menuItems) {
  return new Map((Array.isArray(menuItems) ? menuItems : []).map((item) => [item.id, item]));
}

function normalizeAddon(addon, index = 0) {
  return {
    id: String(addon?.id || `addon-${index + 1}`),
    label: String(addon?.label || 'Add-on'),
    price: Number.isFinite(Number(addon?.price)) ? roundMoney(addon.price) : 0
  };
}

function normalizeAddons(addons) {
  if (!Array.isArray(addons)) return [];
  return addons.map((addon, index) => normalizeAddon(addon, index)).filter((addon) => addon.label);
}

function buildLineSummary(item) {
  const parts = [];
  if (item.selectedProtein) {
    parts.push(`Protein: ${item.selectedProtein}`);
  }
  if (item.addons.length) {
    parts.push(item.addons.map((addon) => addon.label).join(', '));
  }
  if (item.itemNote) {
    parts.push(`Note: ${item.itemNote}`);
  }
  return parts.join(' | ');
}

function normalizeOrderItem(item, menuIndex, index = 0) {
  const matchedMenu = menuIndex.get(String(item?.id || '')) || null;
  const addons = normalizeAddons(item?.addons);
  const addonTotal = roundMoney(addons.reduce((sum, addon) => sum + addon.price, 0));
  const menuBasePrice = Number.isFinite(Number(item?.menuBasePrice))
    ? roundMoney(item.menuBasePrice)
    : roundMoney(matchedMenu?.price || item?.basePrice || item?.price || 0);

  const normalized = {
    cartItemId: String(item?.cartItemId || `line-${index + 1}`),
    id: String(matchedMenu?.id || item?.id || ''),
    name: String(item?.name || matchedMenu?.name || 'Menu'),
    quantity: Number.isFinite(Number(item?.quantity)) ? Math.max(1, Number(item.quantity)) : 1,
    menuBasePrice,
    addons,
    addonTotal,
    selectedProtein: String(item?.selectedProtein || ''),
    itemNote: String(item?.itemNote || ''),
    lineSummary: String(item?.lineSummary || ''),
    image: String(item?.image || matchedMenu?.image || ''),
    price: roundMoney(Number(item?.price || menuBasePrice + addonTotal))
  };

  if (!normalized.lineSummary) {
    normalized.lineSummary = buildLineSummary(normalized);
  }

  return normalized;
}

function normalizeCustomersMap(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const next = {};
  for (const [key, value] of Object.entries(raw)) {
    const phoneKey = normalizePhoneKey(key || value?.phoneKey || value?.phone);
    if (!phoneKey) continue;
    next[phoneKey] = {
      phoneKey,
      phone: phoneKey,
      name: String(value?.name || '-'),
      address: String(value?.address || '-'),
      segment: String(value?.segment || 'Regular'),
      note: String(value?.note || value?.lastNote || ''),
      lastNote: String(value?.lastNote || ''),
      orderCount: Number(value?.orderCount || 0),
      firstOrderAt: String(value?.firstOrderAt || ''),
      lastOrderAt: String(value?.lastOrderAt || ''),
      lineUserId: String(value?.lineUserId || ''),
      totalSpent: roundMoney(value?.totalSpent || 0)
    };
  }
  return next;
}

function normalizePromotion(raw, index = 0) {
  const type = PROMOTION_TYPES.has(String(raw?.type || '').trim()) ? String(raw.type).trim() : 'clearance_percent';
  const targetMenuIds = Array.isArray(raw?.targetMenuIds) ? raw.targetMenuIds.map((id) => String(id || '').trim()).filter(Boolean) : [];
  const bundleMenuIds = Array.isArray(raw?.bundleMenuIds) ? raw.bundleMenuIds.map((id) => String(id || '').trim()).filter(Boolean).slice(0, 2) : [];
  const createdAt = typeof raw?.createdAt === 'string' ? raw.createdAt : nowIso();

  return {
    id: String(raw?.id || createId(`promo-${index + 1}`)),
    type,
    status: String(raw?.status || 'active').trim().toLowerCase() === 'inactive' ? 'inactive' : 'active',
    label: String(raw?.label || (type === 'bundle' ? 'Value set' : 'Clearance deal')),
    targetMenuIds,
    bundleMenuIds,
    discountPercent: Number.isFinite(Number(raw?.discountPercent)) ? Math.max(0, Math.min(95, roundMoney(raw.discountPercent))) : 0,
    fixedPrice: Number.isFinite(Number(raw?.fixedPrice)) ? Math.max(0, roundMoney(raw.fixedPrice)) : 0,
    bundlePrice: Number.isFinite(Number(raw?.bundlePrice)) ? Math.max(0, roundMoney(raw.bundlePrice)) : 0,
    startsAt: typeof raw?.startsAt === 'string' ? raw.startsAt : '',
    endsAt: typeof raw?.endsAt === 'string' ? raw.endsAt : '',
    createdAt,
    updatedAt: typeof raw?.updatedAt === 'string' ? raw.updatedAt : createdAt
  };
}

function normalizePromotionList(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((promotion, index) => normalizePromotion(promotion, index))
    .filter((promotion) => {
      if (promotion.type === 'bundle') {
        return promotion.bundleMenuIds.length === 2;
      }
      return promotion.targetMenuIds.length > 0;
    });
}

function isPromotionActive(promotion, nowMs = Date.now()) {
  if (!promotion || promotion.status !== 'active') return false;
  const startsAtMs = promotion.startsAt ? Date.parse(promotion.startsAt) : Number.NEGATIVE_INFINITY;
  const endsAtMs = promotion.endsAt ? Date.parse(promotion.endsAt) : Number.POSITIVE_INFINITY;
  return nowMs >= startsAtMs && nowMs <= endsAtMs;
}

let store;

function getActivePromotions(nowMs = Date.now(), promotionsList = store?.promotions || []) {
  return (Array.isArray(promotionsList) ? promotionsList : []).filter((promotion) => isPromotionActive(promotion, nowMs));
}

function getCustomerLookup(phoneRaw, customersMap = store?.customers || {}) {
  const phoneKey = normalizePhoneKey(phoneRaw);
  const customer = customersMap[phoneKey] || null;
  const orderCount = Number(customer?.orderCount || 0);
  return {
    phoneKey,
    exists: Boolean(customer),
    isFirstTimeBuyer: Boolean(phoneKey) && orderCount === 0,
    orderCount,
    lastOrderAt: customer?.lastOrderAt || '',
    totalSpent: roundMoney(customer?.totalSpent || 0)
  };
}

function getLineBindingStatus(phoneRaw, customersMap = store?.customers || {}) {
  const phoneKey = normalizePhoneKey(phoneRaw);
  const customer = customersMap[phoneKey] || {};
  return {
    phoneKey,
    bound: Boolean(customer.lineUserId),
    lineUserId: customer.lineUserId || ''
  };
}

function getBestItemPromotion(itemId, menuBasePrice, activePromotions) {
  const candidates = activePromotions.filter((promotion) => {
    if (promotion.type !== 'clearance_percent' && promotion.type !== 'clearance_fixed_price') {
      return false;
    }
    return promotion.targetMenuIds.includes(itemId);
  });

  let selected = null;
  let bestPrice = roundMoney(menuBasePrice);

  for (const promotion of candidates) {
    let candidatePrice = bestPrice;
    if (promotion.type === 'clearance_percent') {
      candidatePrice = roundMoney(menuBasePrice * (1 - (promotion.discountPercent / 100)));
    }
    if (promotion.type === 'clearance_fixed_price') {
      candidatePrice = roundMoney(promotion.fixedPrice);
    }
    candidatePrice = Math.max(0, candidatePrice);
    if (!selected || candidatePrice < bestPrice) {
      selected = promotion;
      bestPrice = candidatePrice;
    }
  }

  return {
    promotion: selected,
    discountedMenuPrice: bestPrice
  };
}

function estimateBundleSavings(promotion, activePromotions, menuIndex) {
  if (!promotion || promotion.type !== 'bundle' || promotion.bundleMenuIds.length !== 2) return 0;
  const [firstId, secondId] = promotion.bundleMenuIds;
  const firstMenu = menuIndex.get(firstId);
  const secondMenu = menuIndex.get(secondId);
  if (!firstMenu || !secondMenu) return 0;
  const firstDeal = getBestItemPromotion(firstId, firstMenu.price, activePromotions).discountedMenuPrice;
  const secondDeal = getBestItemPromotion(secondId, secondMenu.price, activePromotions).discountedMenuPrice;
  return roundMoney((firstDeal + secondDeal) - promotion.bundlePrice);
}

function buildOrderQuote({
  items,
  customerPhone,
  menuItems = store?.menu || [],
  customersMap = store?.customers || {},
  promotionsList = store?.promotions || []
}) {
  const menuIndex = getMenuIndex(menuItems);
  const customerLookup = getCustomerLookup(customerPhone, customersMap);
  const activePromotions = getActivePromotions(Date.now(), promotionsList);
  const normalizedItems = Array.isArray(items)
    ? items.map((item, index) => normalizeOrderItem(item, menuIndex, index)).filter((item) => item.id && item.quantity > 0)
    : [];

  const units = [];
  const lineItemsBase = normalizedItems.map((item) => {
    const unitBasePrice = roundMoney(item.menuBasePrice + item.addonTotal);
    const itemPromotionResult = getBestItemPromotion(item.id, item.menuBasePrice, activePromotions);
    const regularUnitPrice = roundMoney(itemPromotionResult.discountedMenuPrice + item.addonTotal);

    for (let count = 0; count < item.quantity; count += 1) {
      units.push({
        lineKey: item.cartItemId,
        itemId: item.id,
        addonTotal: item.addonTotal,
        itemPromotionId: itemPromotionResult.promotion?.id || '',
        itemPromotionLabel: itemPromotionResult.promotion?.label || '',
        itemPromoMenuPrice: itemPromotionResult.discountedMenuPrice,
        regularUnitPrice,
        finalUnitPrice: regularUnitPrice,
        bundlePromotionId: '',
        usedInBundle: false
      });
    }

    return {
      ...item,
      unitBasePrice,
      regularUnitPrice
    };
  });

  const bundlePromotions = activePromotions
    .filter((promotion) => promotion.type === 'bundle' && promotion.bundleMenuIds.length === 2)
    .sort((a, b) => estimateBundleSavings(b, activePromotions, menuIndex) - estimateBundleSavings(a, activePromotions, menuIndex));

  const bundleApplicationsMap = new Map();

  for (const promotion of bundlePromotions) {
    const [firstId, secondId] = promotion.bundleMenuIds;
    while (true) {
      const firstUnit = units.find((unit) => !unit.usedInBundle && unit.itemId === firstId);
      const secondUnit = units.find((unit) => !unit.usedInBundle && unit.itemId === secondId);
      if (!firstUnit || !secondUnit) break;

      firstUnit.usedInBundle = true;
      secondUnit.usedInBundle = true;
      firstUnit.bundlePromotionId = promotion.id;
      secondUnit.bundlePromotionId = promotion.id;

      const combinedPromoMenuPrice = roundMoney(firstUnit.itemPromoMenuPrice + secondUnit.itemPromoMenuPrice);
      const combinedBundlePrice = roundMoney(promotion.bundlePrice);
      const firstShare = combinedPromoMenuPrice > 0
        ? roundMoney(combinedBundlePrice * (firstUnit.itemPromoMenuPrice / combinedPromoMenuPrice))
        : roundMoney(combinedBundlePrice / 2);
      const secondShare = roundMoney(combinedBundlePrice - firstShare);

      firstUnit.finalUnitPrice = roundMoney(firstShare + firstUnit.addonTotal);
      secondUnit.finalUnitPrice = roundMoney(secondShare + secondUnit.addonTotal);

      const existing = bundleApplicationsMap.get(promotion.id) || {
        promotionId: promotion.id,
        label: promotion.label,
        bundleMenuIds: promotion.bundleMenuIds,
        count: 0
      };
      existing.count += 1;
      bundleApplicationsMap.set(promotion.id, existing);
    }
  }

  const lineItems = lineItemsBase.map((item) => {
    const lineUnits = units.filter((unit) => unit.lineKey === item.cartItemId);
    const baseLineTotal = roundMoney(lineUnits.reduce((sum) => sum + item.unitBasePrice, 0));
    const finalLineTotal = roundMoney(lineUnits.reduce((sum, unit) => sum + unit.finalUnitPrice, 0));
    const appliedPromotionIds = [...new Set(lineUnits.flatMap((unit) => [unit.itemPromotionId, unit.bundlePromotionId]).filter(Boolean))];
    const appliedPromotionLabels = [...new Set(lineUnits.flatMap((unit) => [unit.itemPromotionLabel]).filter(Boolean))];

    return {
      cartItemId: item.cartItemId,
      id: item.id,
      name: item.name,
      quantity: item.quantity,
      image: item.image,
      selectedProtein: item.selectedProtein,
      addons: item.addons,
      itemNote: item.itemNote,
      lineSummary: item.lineSummary,
      menuBasePrice: item.menuBasePrice,
      addonTotal: item.addonTotal,
      unitBasePrice: item.unitBasePrice,
      baseLineTotal,
      finalLineTotal,
      discountTotal: roundMoney(baseLineTotal - finalLineTotal),
      appliedPromotionIds,
      appliedPromotionLabels
    };
  });

  const subtotal = roundMoney(lineItems.reduce((sum, item) => sum + item.baseLineTotal, 0));
  const promotionSubtotal = roundMoney(lineItems.reduce((sum, item) => sum + item.finalLineTotal, 0));
  const promotionDiscountTotal = roundMoney(subtotal - promotionSubtotal);
  const firstTimeDiscount = customerLookup.isFirstTimeBuyer ? roundMoney(promotionSubtotal * FIRST_TIME_DISCOUNT_RATE) : 0;
  const discountTotal = roundMoney(promotionDiscountTotal + firstTimeDiscount);
  const finalTotal = roundMoney(Math.max(0, promotionSubtotal - firstTimeDiscount));
  const appliedPromotionIds = [...new Set([
    ...lineItems.flatMap((item) => item.appliedPromotionIds),
    ...(firstTimeDiscount > 0 ? ['first_time_buyer_10'] : [])
  ])];

  return {
    lineItems,
    subtotal,
    promotionSubtotal,
    promotionDiscountTotal,
    firstTimeDiscount,
    discountTotal,
    finalTotal,
    appliedPromotionIds,
    bundleApplications: [...bundleApplicationsMap.values()],
    customerLookup,
    customerSegment: customerLookup.isFirstTimeBuyer ? 'first_time' : 'returning'
  };
}

function normalizeOrderPayload(payload, customers, menuItems) {
  const customer = payload?.customer || {};
  const phoneKey = normalizePhoneKey(payload?.customerPhoneKey || customer.phone);
  const linked = customers[phoneKey] || {};
  const quote = buildOrderQuote({
    items: Array.isArray(payload?.items) ? payload.items : [],
    customerPhone: phoneKey,
    menuItems,
    customersMap: customers,
    promotionsList: []
  });

  return {
    id: String(payload?.id || generateOrderId(phoneKey)),
    createdAt: typeof payload?.createdAt === 'string' ? payload.createdAt : nowIso(),
    status: normalizeOrderStatus(payload?.status),
    customerPhoneKey: phoneKey,
    customer: {
      name: String(customer?.name || linked?.name || '-'),
      phone: phoneKey,
      address: String(customer?.address || linked?.address || '-'),
      note: String(customer?.note || '')
    },
    items: quote.lineItems,
    subtotal: Number.isFinite(Number(payload?.subtotal)) ? roundMoney(payload.subtotal) : quote.subtotal,
    promotionSubtotal: Number.isFinite(Number(payload?.promotionSubtotal)) ? roundMoney(payload.promotionSubtotal) : quote.promotionSubtotal,
    promotionDiscountTotal: Number.isFinite(Number(payload?.promotionDiscountTotal)) ? roundMoney(payload.promotionDiscountTotal) : quote.promotionDiscountTotal,
    orderDiscountTotal: Number.isFinite(Number(payload?.orderDiscountTotal)) ? roundMoney(payload.orderDiscountTotal) : quote.firstTimeDiscount,
    discountTotal: Number.isFinite(Number(payload?.discountTotal)) ? roundMoney(payload.discountTotal) : quote.discountTotal,
    finalTotal: Number.isFinite(Number(payload?.finalTotal)) ? roundMoney(payload.finalTotal) : quote.finalTotal,
    total: Number.isFinite(Number(payload?.total)) ? roundMoney(payload.total) : quote.finalTotal,
    appliedPromotionIds: Array.isArray(payload?.appliedPromotionIds) ? payload.appliedPromotionIds.map((id) => String(id || '')).filter(Boolean) : quote.appliedPromotionIds,
    bundleApplications: Array.isArray(payload?.bundleApplications) ? payload.bundleApplications : quote.bundleApplications,
    customerSegment: String(payload?.customerSegment || quote.customerSegment || 'returning'),
    lineUserId: String(linked?.lineUserId || payload?.lineUserId || ''),
    statusUpdatedAt: typeof payload?.statusUpdatedAt === 'string' ? payload.statusUpdatedAt : nowIso(),
    adminNote: String(payload?.adminNote || '')
  };
}

async function ensureDataDir() {
  await mkdir(dataDir, { recursive: true });
}

async function loadSeedMenu() {
  try {
    const raw = await readFile(seedMenuFile, 'utf8');
    return normalizeMenuList(safeJsonParse(raw, []));
  } catch (_error) {
    return [];
  }
}

async function loadDb() {
  await ensureDataDir();
  try {
    await access(dbFile);
    const raw = await readFile(dbFile, 'utf8');
    const parsed = safeJsonParse(raw, {});
    const menu = normalizeMenuList(parsed?.menu);
    const customers = normalizeCustomersMap(parsed?.customers);
    const promotions = normalizePromotionList(parsed?.promotions);
    const orders = Array.isArray(parsed?.orders)
      ? parsed.orders.map((order) => normalizeOrderPayload(order, customers, menu))
      : [];
    return { menu, customers, promotions, orders };
  } catch (_error) {
    const seededMenu = await loadSeedMenu();
    const initial = { menu: seededMenu, customers: {}, promotions: [], orders: [] };
    await writeFile(dbFile, JSON.stringify(initial, null, 2), 'utf8');
    return initial;
  }
}

store = await loadDb();

async function saveDb() {
  await ensureDataDir();
  await writeFile(dbFile, JSON.stringify(store, null, 2), 'utf8');
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Robots-Tag': 'noindex, nofollow',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Line-Signature',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS'
  });
  res.end(JSON.stringify(payload));
}

function routeNotFound(res) {
  sendJson(res, 404, { ok: false, message: 'not_found' });
}

async function readJsonBody(req, maxBytes = 1_500_000) {
  const chunks = [];
  let total = 0;

  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) {
      const error = new Error('payload_too_large');
      error.code = 'payload_too_large';
      throw error;
    }
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  return safeJsonParse(raw, {});
}

async function pushLineMessage(lineUserId, messageText) {
  if (!lineChannelAccessToken || !lineUserId || typeof fetch !== 'function') {
    return false;
  }

  try {
    const response = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${lineChannelAccessToken}`
      },
      body: JSON.stringify({
        to: lineUserId,
        messages: [{ type: 'text', text: messageText }]
      })
    });
    return response.ok;
  } catch (_error) {
    return false;
  }
}

async function replyLineMessage(replyToken, messageText) {
  if (!lineChannelAccessToken || !replyToken || typeof fetch !== 'function') {
    return false;
  }

  try {
    const response = await fetch('https://api.line.me/v2/bot/message/reply', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${lineChannelAccessToken}`
      },
      body: JSON.stringify({
        replyToken,
        messages: [{ type: 'text', text: messageText }]
      })
    });
    return response.ok;
  } catch (_error) {
    return false;
  }
}

function listOrdersDesc() {
  return [...store.orders].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}

function upsertCustomer(payload, preferLineUserId = '') {
  const phoneKey = normalizePhoneKey(payload?.phone || payload?.phoneKey);
  if (!phoneKey) {
    return { ok: false, message: 'invalid_phone', phoneKey: '' };
  }

  const now = nowIso();
  const previous = store.customers[phoneKey] || {};
  store.customers[phoneKey] = {
    phoneKey,
    phone: phoneKey,
    name: String(payload?.name || previous.name || '-'),
    address: String(payload?.address || previous.address || '-'),
    segment: String(payload?.segment || previous.segment || 'Regular'),
    note: String(payload?.note || payload?.lastNote || previous.note || previous.lastNote || ''),
    lastNote: String(payload?.note || payload?.lastNote || previous.lastNote || ''),
    orderCount: Number(payload?.orderCount ?? previous.orderCount ?? 0),
    firstOrderAt: String(payload?.firstOrderAt || previous.firstOrderAt || now),
    lastOrderAt: String(payload?.lastOrderAt || previous.lastOrderAt || now),
    lineUserId: String(preferLineUserId || payload?.lineUserId || previous.lineUserId || ''),
    totalSpent: roundMoney(payload?.totalSpent ?? previous.totalSpent ?? 0)
  };

  return { ok: true, phoneKey, customer: store.customers[phoneKey] };
}

function parseBindPhoneFromMessage(text) {
  const cleaned = String(text || '').trim();
  if (!cleaned) return '';
  const bindMatch = cleaned.match(/^(?:bind|ผูก)\s+(.+)$/i);
  if (!bindMatch) return '';
  return normalizePhoneKey(bindMatch[1]);
}

function buildMenuPerformanceReport(days = 7) {
  const safeDays = Math.max(1, Math.min(30, Number(days || 7)));
  const nowMs = Date.now();
  const currentStart = nowMs - (safeDays * DAY_MS);
  const previousStart = nowMs - (safeDays * DAY_MS * 2);
  const rows = store.menu.map((menu) => ({
    menuId: menu.id,
    name: menu.name,
    image: menu.image,
    price: menu.price,
    currentQty: 0,
    previousQty: 0
  }));
  const byId = new Map(rows.map((row) => [row.menuId, row]));

  for (const order of store.orders) {
    const createdAtMs = Date.parse(order.createdAt || '');
    if (!Number.isFinite(createdAtMs) || createdAtMs < previousStart) continue;
    const targetField = createdAtMs >= currentStart ? 'currentQty' : 'previousQty';
    for (const item of Array.isArray(order.items) ? order.items : []) {
      const row = byId.get(String(item?.id || ''));
      if (!row) continue;
      row[targetField] += Number(item?.quantity || 0);
    }
  }

  const currentSorted = [...rows].filter((row) => row.currentQty > 0).sort((a, b) => b.currentQty - a.currentQty);
  const bestSellerCount = currentSorted.length > 0 ? Math.max(1, Math.ceil(rows.length * 0.2)) : 0;
  const bestSellerIds = new Set(currentSorted.slice(0, bestSellerCount).map((row) => row.menuId));

  const reportRows = rows.map((row) => {
    const flags = [];
    if (row.currentQty === 0) flags.push('unsold_7d');
    if (row.previousQty > 0 && row.currentQty <= row.previousQty * 0.7) flags.push('sales_down');
    if (bestSellerIds.has(row.menuId)) flags.push('best_seller');

    return {
      ...row,
      deltaQty: row.currentQty - row.previousQty,
      salesChangeRatio: row.previousQty > 0 ? roundMoney((row.currentQty - row.previousQty) / row.previousQty) : null,
      flags,
      performanceState: flags.includes('best_seller')
        ? 'best_seller'
        : (flags.includes('unsold_7d') || flags.includes('sales_down') ? 'slow_moving' : 'stable')
    };
  });

  return {
    summary: {
      days: safeDays,
      bestSellerCount: reportRows.filter((row) => row.flags.includes('best_seller')).length,
      slowMovingCount: reportRows.filter((row) => row.flags.includes('unsold_7d') || row.flags.includes('sales_down')).length,
      unsoldCount: reportRows.filter((row) => row.flags.includes('unsold_7d')).length
    },
    rows: reportRows.sort((a, b) => {
      const aPriority = a.flags.includes('unsold_7d') ? 3 : (a.flags.includes('sales_down') ? 2 : (a.flags.includes('best_seller') ? 1 : 0));
      const bPriority = b.flags.includes('unsold_7d') ? 3 : (b.flags.includes('sales_down') ? 2 : (b.flags.includes('best_seller') ? 1 : 0));
      if (bPriority !== aPriority) return bPriority - aPriority;
      return a.name.localeCompare(b.name);
    })
  };
}

function buildAiPromotionSuggestions() {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const now = Date.now();
  const currentStart = now - (7 * DAY_MS);
  const priorStart = now - (14 * DAY_MS);
  const orders = store.orders || [];

  const qtyCurrent = {};
  const qtyPrior = {};
  store.menu.forEach(m => {
    qtyCurrent[m.id] = 0;
    qtyPrior[m.id] = 0;
  });

  orders.forEach(o => {
    const createdAtMs = Date.parse(o.createdAt || '');
    if (!Number.isFinite(createdAtMs)) return;
    if (createdAtMs >= currentStart && createdAtMs < now) {
      for (const item of o.items || []) {
        const menuId = String(item.id || '');
        qtyCurrent[menuId] = (qtyCurrent[menuId] || 0) + (item.quantity || 0);
      }
    }
    if (createdAtMs >= priorStart && createdAtMs < currentStart) {
      for (const item of o.items || []) {
        const menuId = String(item.id || '');
        qtyPrior[menuId] = (qtyPrior[menuId] || 0) + (item.quantity || 0);
      }
    }
  });

  const suggestions = [];
  const round = n => Math.round(n * 10) / 10;

  store.menu.forEach(m => {
    const currentQty = qtyCurrent[m.id] || 0;
    const priorQty = qtyPrior[m.id] || 0;
    if (currentQty === 0 || (priorQty > 0 && currentQty <= priorQty * 0.7)) {
      suggestions.push({
        id: `sug-slow-${m.id}`,
        type: 'clearance_percent',
        priority: currentQty === 0 ? 'high' : 'medium',
        icon: 'trending-down',
        title: 'ลดราคาเมนูขายช้า',
        description: `${m.name} ไม่มียอดขาย ${currentQty} ชิ้นใน 7 วันที่ผ่านมา แนะนำลดราคา ${round(currentQty === 0 ? 20 : 15)}%`,
        targetMenuNames: [m.name],
        suggestedDiscount: currentQty === 0 ? 20 : 15,
        reasoning: `ไม่มียอดขายใน 7 วันที่ผ่านมา ลดราคาช่วยกระตุ้นความสนใจ`
      });
    }
  });

  const menuQtyList = store.menu.map(m => ({ id: m.id, qty: qtyCurrent[m.id] || 0 }));
  const sortedByQty = [...menuQtyList].sort((a, b) => b.qty - a.qty);
  const bestCount = Math.max(1, Math.ceil(sortedByQty.length * 0.2));
  const bestSellerIds = new Set(sortedByQty.slice(0, bestCount).map(item => item.id));

  store.menu.forEach(bundleMenu => {
    const bundleId = bundleMenu.id;
    if (bestSellerIds.has(bundleId) && qtyCurrent[bundleId] > 0) {
      const partnerCandidates = store.menu.filter(m => {
        return m.id !== bundleId && (qtyCurrent[m.id] === 0 || (qtyPrior[m.id] > 0 && qtyCurrent[m.id] <= qtyPrior[m.id] * 0.7));
      });
      partnerCandidates.forEach(partner => {
        const bundlePriceEstimate = Math.round((bundleMenu.price + partner.price) * 0.9);
        suggestions.push({
          id: `sug-bundle-${bundleId}-${partner.id}`,
          type: 'bundle',
          priority: 'medium',
          icon: 'package',
          title: 'จับคู่เมนูพิเศษ',
          description: `${bundleMenu.name} + ${partner.name} ราคาพิเศษ ฿${bundlePriceEstimate}`,
          bundleMenuNames: [bundleMenu.name, partner.name],
          bundlePrice: bundlePriceEstimate,
          reasoning: `รวมเมนูขายดีกับเมนูขายช้า ลดราคา 10% เป็นพิเศษ`
        });
      });
    }
  });

  store.menu.forEach(m => {
    if (!m.price || !m.cost) return;
    const margin = ((m.price - m.cost) / m.price) * 100;
    if (margin > 50 && qtyCurrent[m.id] === 0) {
      suggestions.push({
        id: `sug-highmargin-${m.id}`,
        type: 'clearance_percent',
        priority: 'low',
        icon: 'shopping-bag',
        title: 'ดันเมนูต้นทุนสูง',
        description: `${m.name} มี margin สูง (${round(margin)}%) แต่ขาย 0 ชิ้น แนะนำลด ${round(10)}% ดันยอด`,
        targetMenuNames: [m.name],
        suggestedDiscount: 10,
        reasoning: `มี margin สูงแต่ไม่มียอดขาย ลดราคาเล็กน้อยเพื่อกระตุ้นการสั่ง`
      });
    }
  });

  const activePromoCount = (store.promotions || []).filter(p => p.status === 'active').length;
  if (activePromoCount === 0) {
    suggestions.unshift({
      id: 'sug-no-active',
      type: 'none',
      priority: 'high',
      icon: 'lightbulb',
      title: 'ไม่มีโปรโมชั่น active',
      description: 'ยังไม่มีโปรโมชั่นใด active – แนะนำเริ่มจากเมนูขายช้าก่อน',
      reasoning: 'ตรวจพบว่าไม่มีโปรโมชั่นใด active – สร้างโปรโมชั่นบนเมนูขายช้าก่อน'
    });
  }

  return {
    ok: true,
    suggestions,
    analysisTimestamp: new Date().toISOString(),
    dataSnapshot: {
      totalMenus: store.menu.length,
      totalOrders: store.orders.length,
      totalCustomers: Object.keys(store.customers || {}).length,
      activePromotions: (store.promotions || []).length
    }
  };
}

function extractCostFromDescription(descriptionRaw) {
  const match = String(descriptionRaw || '').match(/^\[cost:([0-9]+(?:\.[0-9]+)?)\]/i);
  return match ? Number(match[1]) : 0;
}

function generateAutoBundles(maxBundles = 4) {
  const menuWithCost = store.menu
    .map(m => ({
      ...m,
      cost: extractCostFromDescription(m.description)
    }))
    .filter(m => m.price > 0);

  if (menuWithCost.length < 2) return [];

  const bundles = [];
  const usedPairs = new Set();

  // Sort by price descending to pair expensive with cheaper items
  const sorted = [...menuWithCost].sort((a, b) => b.price - a.price);

  for (let i = 0; i < sorted.length && bundles.length < maxBundles; i++) {
    for (let j = i + 1; j < sorted.length && bundles.length < maxBundles; j++) {
      const a = sorted[i];
      const b = sorted[j];
      const pairKey = [a.id, b.id].sort().join('+');
      if (usedPairs.has(pairKey)) continue;

      const totalPrice = a.price + b.price;
      const totalCost = a.cost + b.cost;

      // Decide discount: 10% if both have cost data, 8% otherwise
      const hasReliableCost = a.cost > 0 && b.cost > 0;
      const discountRate = hasReliableCost ? 0.10 : 0.08;
      const bundlePrice = Math.round(totalPrice * (1 - discountRate));

      // Profitability check: bundlePrice must be > totalCost * 1.15 (at least 15% margin)
      if (hasReliableCost && bundlePrice < totalCost * 1.15) continue;

      // Min saving must be at least 5 baht
      const saving = Math.round(totalPrice - bundlePrice);
      if (saving < 5) continue;

      usedPairs.add(pairKey);
      bundles.push({
        id: `auto-bundle-${pairKey}`,
        type: 'bundle',
        status: 'active',
        label: `${a.name} + ${b.name}`,
        bundleMenuIds: [a.id, b.id],
        bundlePrice,
        originalTotal: totalPrice,
        saving,
        totalCost: hasReliableCost ? totalCost : null,
        margin: hasReliableCost ? roundMoney(((bundlePrice - totalCost) / bundlePrice) * 100) : null,
        startsAt: null,
        endsAt: null,
        createdAt: nowIso(),
        updatedAt: nowIso()
      });
    }
  }

  return bundles;
}

function listPromotions(includeInactive = false) {
  const nowMs = Date.now();
  return [...store.promotions]
    .filter((promotion) => includeInactive || isPromotionActive(promotion, nowMs))
    .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
}

const ADMIN_MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8'
};

async function serveAdminFile(res, filename) {
  const filePath = path.join(adminDir, filename);
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(adminDir)) {
    sendJson(res, 403, { ok: false, message: 'forbidden' });
    return;
  }
  try {
    const content = await readFile(resolved, 'utf8');
    const ext = path.extname(filename).toLowerCase();
    res.writeHead(200, {
      'Content-Type': ADMIN_MIME_TYPES[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    res.end(content);
  } catch (_error) {
    sendJson(res, 404, { ok: false, message: 'not_found' });
  }
}

const server = createServer(async (req, res) => {
  const requestUrl = new URL(req.url || '/', `http://${req.headers.host || `localhost:${port}`}`);
  const pathname = requestUrl.pathname;
  const method = req.method || 'GET';

  if (method === 'OPTIONS') {
    sendJson(res, 204, { ok: true });
    return;
  }

  try {
    if (method === 'GET' && (pathname === '/admin' || pathname === '/admin/')) {
      await serveAdminFile(res, 'dashboard.html');
      return;
    }
    if (method === 'GET' && pathname === '/admin/admin.js') {
      await serveAdminFile(res, 'admin.js');
      return;
    }
    if (method === 'GET' && pathname === '/admin/admin.css') {
      await serveAdminFile(res, 'admin.css');
      return;
    }

    if (method === 'GET' && pathname === '/api/health') {
      sendJson(res, 200, { ok: true, now: nowIso() });
      return;
    }

    if (method === 'GET' && pathname === '/api/menu') {
      sendJson(res, 200, { ok: true, items: store.menu });
      return;
    }

    if (method === 'POST' && pathname === '/api/menu') {
      const body = await readJsonBody(req, 8_000_000);
      const normalized = normalizeMenuItem(body, store.menu.length);
      if (!normalized.name || !normalized.image || !Number.isFinite(normalized.price) || normalized.price < 0) {
        sendJson(res, 400, { ok: false, message: 'invalid_menu_payload' });
        return;
      }
      store.menu = [normalized, ...store.menu];
      await saveDb();
      sendJson(res, 201, { ok: true, item: normalized });
      return;
    }

    const menuIdMatch = pathname.match(/^\/api\/menu\/([^/]+)$/);
    if (menuIdMatch && method === 'PUT') {
      const menuId = decodeURIComponent(menuIdMatch[1]);
      const body = await readJsonBody(req, 8_000_000);
      const nextItem = normalizeMenuItem({ ...body, id: menuId });
      const index = store.menu.findIndex((item) => item.id === menuId);
      if (index === -1) {
        sendJson(res, 404, { ok: false, message: 'menu_not_found' });
        return;
      }
      store.menu[index] = nextItem;
      await saveDb();
      sendJson(res, 200, { ok: true, item: nextItem });
      return;
    }

    if (menuIdMatch && method === 'DELETE') {
      const menuId = decodeURIComponent(menuIdMatch[1]);
      const before = store.menu.length;
      store.menu = store.menu.filter((item) => item.id !== menuId);
      if (store.menu.length === before) {
        sendJson(res, 404, { ok: false, message: 'menu_not_found' });
        return;
      }
      store.promotions = store.promotions.filter((promotion) => {
        if (promotion.type === 'bundle') {
          return !promotion.bundleMenuIds.includes(menuId);
        }
        return !promotion.targetMenuIds.includes(menuId);
      });
      await saveDb();
      sendJson(res, 200, { ok: true });
      return;
    }

    if (method === 'GET' && pathname === '/api/promotions') {
      const includeInactive = requestUrl.searchParams.get('includeInactive') === '1';
      sendJson(res, 200, { ok: true, promotions: listPromotions(includeInactive) });
      return;
    }

    if (method === 'POST' && pathname === '/api/promotions') {
      const body = await readJsonBody(req);
      const promotion = normalizePromotion({
        ...body,
        createdAt: nowIso(),
        updatedAt: nowIso()
      }, store.promotions.length);

      if (promotion.type === 'bundle' && promotion.bundleMenuIds.length !== 2) {
        sendJson(res, 400, { ok: false, message: 'invalid_bundle_payload' });
        return;
      }
      if ((promotion.type === 'clearance_percent' || promotion.type === 'clearance_fixed_price') && promotion.targetMenuIds.length === 0) {
        sendJson(res, 400, { ok: false, message: 'invalid_clearance_payload' });
        return;
      }

      store.promotions = [promotion, ...store.promotions];
      await saveDb();
      sendJson(res, 201, { ok: true, promotion });
      return;
    }

    const promotionIdMatch = pathname.match(/^\/api\/promotions\/([^/]+)$/);
    if (promotionIdMatch && method === 'PATCH') {
      const promotionId = decodeURIComponent(promotionIdMatch[1]);
      const index = store.promotions.findIndex((promotion) => promotion.id === promotionId);
      if (index === -1) {
        sendJson(res, 404, { ok: false, message: 'promotion_not_found' });
        return;
      }
      const body = await readJsonBody(req);
      const nextPromotion = normalizePromotion({
        ...store.promotions[index],
        ...body,
        id: promotionId,
        createdAt: store.promotions[index].createdAt,
        updatedAt: nowIso()
      }, index);
      store.promotions[index] = nextPromotion;
      await saveDb();
      sendJson(res, 200, { ok: true, promotion: nextPromotion });
      return;
    }

    if (method === 'GET' && pathname === '/api/reports/menu-performance') {
      const days = Number(requestUrl.searchParams.get('days') || 7);
      sendJson(res, 200, { ok: true, ...buildMenuPerformanceReport(days) });
      return;
    }

    if (method === 'GET' && pathname === '/api/ai/promotion-suggestions') {
      sendJson(res, 200, { ok: true, ...buildAiPromotionSuggestions() });
      return;
    }

    if (method === 'GET' && pathname === '/api/auto-bundles') {
      const max = Number(requestUrl.searchParams.get('max') || 4);
      const bundles = generateAutoBundles(max);
      sendJson(res, 200, { ok: true, bundles });
      return;
    }

    if (method === 'GET' && pathname === '/api/customers') {
      sendJson(res, 200, { ok: true, customers: store.customers });
      return;
    }

    if (method === 'GET' && pathname === '/api/customers/lookup') {
      const phone = requestUrl.searchParams.get('phone') || '';
      sendJson(res, 200, { ok: true, ...getCustomerLookup(phone) });
      return;
    }

    if (method === 'GET' && pathname === '/api/customers/profile') {
      const phone = requestUrl.searchParams.get('phone') || '';
      const phoneKey = normalizePhoneKey(phone);
      if (!phoneKey) {
        sendJson(res, 400, { ok: false, message: 'invalid_phone' });
        return;
      }
      const customer = store.customers[phoneKey] || null;
      if (!customer) {
        sendJson(res, 200, { ok: true, exists: false, customer: null });
        return;
      }
      sendJson(res, 200, {
        ok: true,
        exists: true,
        customer: {
          name: customer.name || '',
          phone: customer.phone || phoneKey,
          address: customer.address || '',
          note: customer.lastNote || customer.note || '',
          orderCount: Number(customer.orderCount || 0),
          totalSpent: roundMoney(customer.totalSpent || 0)
        }
      });
      return;
    }

    if (method === 'POST' && pathname === '/api/customers/upsert') {
      const body = await readJsonBody(req);
      const result = upsertCustomer(body);
      if (!result.ok) {
        sendJson(res, 400, result);
        return;
      }
      await saveDb();
      sendJson(res, 200, result);
      return;
    }

    const customerDeleteMatch = pathname.match(/^\/api\/customers\/([^/]+)$/);
    if (customerDeleteMatch && method === 'DELETE') {
      const phoneKey = normalizePhoneKey(decodeURIComponent(customerDeleteMatch[1]));
      if (!phoneKey || !store.customers[phoneKey]) {
        sendJson(res, 404, { ok: false, message: 'customer_not_found' });
        return;
      }
      delete store.customers[phoneKey];
      await saveDb();
      sendJson(res, 200, { ok: true });
      return;
    }

    if (method === 'GET' && pathname === '/api/line/bind-status') {
      const phone = requestUrl.searchParams.get('phone') || '';
      const status = getLineBindingStatus(phone);
      sendJson(res, 200, { ok: true, ...status, lineOaLink });
      return;
    }

    if (method === 'GET' && pathname === '/api/orders') {
      sendJson(res, 200, { ok: true, orders: listOrdersDesc() });
      return;
    }

    if (method === 'POST' && pathname === '/api/orders/quote') {
      const body = await readJsonBody(req);
      const phoneKey = normalizePhoneKey(body?.customer?.phone || body?.customerPhoneKey);
      const lineBinding = getLineBindingStatus(phoneKey);
      const quote = buildOrderQuote({
        items: Array.isArray(body?.items) ? body.items : [],
        customerPhone: phoneKey
      });
      sendJson(res, 200, {
        ok: true,
        quote,
        lineBinding: {
          ...lineBinding,
          lineOaLink
        }
      });
      return;
    }

    if (method === 'POST' && pathname === '/api/orders') {
      const body = await readJsonBody(req);
      const customer = body?.customer || {};
      const phoneKey = normalizePhoneKey(customer.phone);
      const quote = buildOrderQuote({
        items: Array.isArray(body?.items) ? body.items : [],
        customerPhone: phoneKey
      });

      if (!phoneKey || !String(customer?.name || '').trim() || !String(customer?.address || '').trim() || quote.lineItems.length === 0) {
        sendJson(res, 400, { ok: false, message: 'invalid_order_payload' });
        return;
      }

      const binding = getLineBindingStatus(phoneKey);

      const previousCustomer = store.customers[phoneKey] || {};
      const order = {
        id: generateOrderId(phoneKey),
        createdAt: nowIso(),
        status: 'New',
        customerPhoneKey: phoneKey,
        customer: {
          name: String(customer.name || previousCustomer.name || '-'),
          phone: phoneKey,
          address: String(customer.address || previousCustomer.address || '-'),
          note: String(customer.note || '')
        },
        items: quote.lineItems,
        subtotal: quote.subtotal,
        promotionSubtotal: quote.promotionSubtotal,
        promotionDiscountTotal: quote.promotionDiscountTotal,
        orderDiscountTotal: quote.firstTimeDiscount,
        discountTotal: quote.discountTotal,
        finalTotal: quote.finalTotal,
        total: quote.finalTotal,
        appliedPromotionIds: quote.appliedPromotionIds,
        bundleApplications: quote.bundleApplications,
        customerSegment: quote.customerSegment,
        lineUserId: binding.lineUserId,
        statusUpdatedAt: nowIso(),
        adminNote: ''
      };

      const customerUpsertResult = upsertCustomer(
        {
          phone: phoneKey,
          name: order.customer.name,
          address: order.customer.address,
          note: order.customer.note,
          orderCount: Number(previousCustomer.orderCount || 0) + 1,
          firstOrderAt: previousCustomer.firstOrderAt || nowIso(),
          lastOrderAt: nowIso(),
          totalSpent: roundMoney(Number(previousCustomer.totalSpent || 0) + quote.finalTotal)
        },
        binding.lineUserId
      );

      store.orders = [order, ...store.orders].slice(0, 1000);
      await saveDb();

      const pushMessage = `Order ${order.id} created. Please send your transfer slip in LINE OA to continue.`;
      const linePushSent = await pushLineMessage(binding.lineUserId, pushMessage);

      sendJson(res, 201, {
        ok: true,
        orderId: order.id,
        order,
        customer: customerUpsertResult.customer,
        linePushSent,
        lineOaLink,
        message: 'Order created. Open LINE OA and send your payment slip.'
      });
      return;
    }

    const orderStatusMatch = pathname.match(/^\/api\/orders\/([^/]+)\/(confirm|reject-slip|slip-received|status)$/);
    if (orderStatusMatch && (method === 'PATCH' || method === 'POST')) {
      const orderId = decodeURIComponent(orderStatusMatch[1]);
      const action = orderStatusMatch[2];
      const body = await readJsonBody(req);
      const index = store.orders.findIndex((order) => order.id === orderId);
      if (index === -1) {
        sendJson(res, 404, { ok: false, message: 'order_not_found' });
        return;
      }

      let nextStatus = normalizeOrderStatus(store.orders[index].status || 'New');
      if (action === 'confirm') nextStatus = 'Completed';
      if (action === 'reject-slip') nextStatus = 'New';
      if (action === 'slip-received') nextStatus = 'Cooking';
      if (action === 'status') nextStatus = normalizeOrderStatus(body?.status || nextStatus);
      if (!ORDER_STATUSES.has(nextStatus)) {
        sendJson(res, 400, { ok: false, message: 'invalid_order_status' });
        return;
      }

      store.orders[index] = {
        ...store.orders[index],
        status: nextStatus,
        statusUpdatedAt: nowIso(),
        adminNote: String(body?.adminNote || store.orders[index].adminNote || '')
      };
      await saveDb();

      const order = store.orders[index];
      if (order.lineUserId) {
        const note = nextStatus === 'Completed'
          ? `Order ${order.id} completed.`
          : nextStatus === 'Ready'
            ? `Order ${order.id} is ready for handoff.`
            : nextStatus === 'Cooking'
              ? `Order ${order.id} is now being prepared.`
              : `Order ${order.id} status updated: ${nextStatus}`;
        await pushLineMessage(order.lineUserId, note);
      }

      sendJson(res, 200, { ok: true, order });
      return;
    }

    if (method === 'POST' && pathname === '/api/line/webhook') {
      const body = await readJsonBody(req, 2_000_000);
      const events = Array.isArray(body?.events) ? body.events : [];
      let boundCount = 0;

      for (const event of events) {
        const messageText = event?.message?.text || '';
        const phoneKey = parseBindPhoneFromMessage(messageText);
        const lineUserId = String(event?.source?.userId || '');
        const replyToken = String(event?.replyToken || '');

        if (!phoneKey || !lineUserId) continue;

        const previous = store.customers[phoneKey] || {};
        upsertCustomer(
          {
            phone: phoneKey,
            name: previous.name || '-',
            address: previous.address || '-',
            note: previous.lastNote || '',
            orderCount: Number(previous.orderCount || 0),
            firstOrderAt: previous.firstOrderAt || '',
            lastOrderAt: previous.lastOrderAt || '',
            totalSpent: roundMoney(previous.totalSpent || 0),
            lineUserId
          },
          lineUserId
        );
        boundCount += 1;

        await replyLineMessage(
          replyToken,
          `LINE binding completed for phone ${phoneKey}. You can now place an order and send your payment slip.`
        );
      }

      if (boundCount > 0) {
        await saveDb();
      }

      sendJson(res, 200, { ok: true, boundCount });
      return;
    }

    routeNotFound(res);
  } catch (error) {
    if (error?.code === 'payload_too_large') {
      sendJson(res, 413, { ok: false, message: 'payload_too_large' });
      return;
    }
    sendJson(res, 500, { ok: false, message: 'internal_error', detail: String(error?.message || 'unknown') });
  }
});

server.listen(port, host, () => {
  const displayHost = host || 'localhost';
  console.log(`API server running at http://${displayHost}:${port}/api/health`);
});
