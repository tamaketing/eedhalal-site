// Single internal source of truth for owner costs (never exposed to Git/Pages).
// The budget-planner page edits it; the recommendation tool reads the same file.
//
// Owner model: the owner records each menu/set with its own per-person food
// cost ("dishes"). Protein-type base costs and special-replacement prices no
// longer exist — nothing is inferred from names and no base cost is ever
// copied into a dish automatically.
import { readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const COSTS_FILE = 'owner-costs.json';
export const SETTINGS_FILE = 'owner-settings.json';
export const EXTRA_KINDS = ['soup', 'curry', 'side', 'dessert'];
export const STATUSES = ['confirmed', 'pending'];
export const MAX_BODY_BYTES = 128 * 1024;

const TOP_LEVEL_KEYS = [
  '_note', 'version', 'updatedAt', 'groupMeta', 'dishes',
  'extras', 'toppings', 'fruit', 'boxes',
];

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

// Cost values are either a positive amount or null (= still waiting for the owner).
// 0 and negative numbers are rejected so a missing price can never be stored as zero.
function readCost(value, label, errors) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    errors.push(`${label}: ราคาต้องเป็นตัวเลข`);
    return 'invalid';
  }
  if (parsed < 0) {
    errors.push(`${label}: ราคาห้ามติดลบ`);
    return 'invalid';
  }
  if (parsed === 0) {
    errors.push(`${label}: ห้ามใส่ 0 — เว้นว่างไว้หากยังไม่มีราคา`);
    return 'invalid';
  }
  return Math.round(parsed * 100) / 100;
}

function readStatus(cost, status, label, errors, costRejected) {
  const normalized = STATUSES.includes(status) ? status : 'pending';
  if (costRejected) return 'pending';
  if (normalized === 'confirmed' && cost === null) {
    errors.push(`${label}: ยืนยันแล้วแต่ยังไม่มีราคา — ต้องกรอกราคาก่อนยืนยัน หรือปล่อยเป็นรอยืนยัน`);
  }
  // A blank price can never be stored as confirmed; the server never confirms drafts by itself.
  if (cost === null) return 'pending';
  return normalized;
}

function readEntry(raw, label, errors) {
  if (!isPlainObject(raw)) {
    errors.push(`${label}: ข้อมูลไม่ถูกต้อง`);
    return { label: '', cost: null, status: 'pending', note: '' };
  }
  const label_ = text(raw.label);
  if (!label_) errors.push(`${label}: ต้องมีชื่อรายการ`);
  const cost = readCost(raw.cost, label, errors);
  const rejected = cost === 'invalid';
  const status = readStatus(rejected ? null : cost, raw.status, label, errors, rejected);
  return { label: label_, cost: rejected ? null : cost, status, note: text(raw.note) };
}

function readItem(raw, label, errors) {
  if (!isPlainObject(raw)) {
    errors.push(`${label}: ข้อมูลไม่ถูกต้อง`);
    return { id: '', name: '', kind: 'side', unit: '', cost: null, status: 'pending', note: '' };
  }
  const id = text(raw.id);
  const name = text(raw.name);
  const unit = text(raw.unit);
  if (!id) errors.push(`${label}: ต้องมี id`);
  if (!name) errors.push(`${label}: ต้องมีชื่อรายการ`);
  if (!unit) errors.push(`${label}: ต้องมีหน่วยราคา`);
  const kind = EXTRA_KINDS.includes(raw.kind) ? raw.kind : 'side';
  const cost = readCost(raw.cost, label, errors);
  const rejected = cost === 'invalid';
  const status = readStatus(rejected ? null : cost, raw.status, label, errors, rejected);
  return { id, name, kind, unit, cost: rejected ? null : cost, status, note: text(raw.note) };
}

function readTopping(raw, label, errors) {
  if (!isPlainObject(raw)) {
    errors.push(`${label}: ข้อมูลไม่ถูกต้อง`);
    return { id: '', name: '', unit: '', cost: null, status: 'pending', enabled: true, note: '' };
  }
  const id = text(raw.id);
  const name = text(raw.name);
  const unit = text(raw.unit);
  if (!id) errors.push(`${label}: ต้องมี id`);
  if (!name) errors.push(`${label}: ต้องมีชื่อรายการ`);
  if (!unit) errors.push(`${label}: ต้องมีหน่วยนับ`);
  const cost = readCost(raw.cost, label, errors);
  const rejected = cost === 'invalid';
  const status = readStatus(rejected ? null : cost, raw.status, label, errors, rejected);
  return {
    id,
    name,
    unit,
    cost: rejected ? null : cost,
    status,
    enabled: raw.enabled === undefined ? true : Boolean(raw.enabled),
    note: text(raw.note),
  };
}

function readDishTopping(raw, label, errors) {
  if (!isPlainObject(raw)) {
    errors.push(`${label}: ข้อมูลไม่ถูกต้อง`);
    return { toppingId: '', quantity: null, includedInFoodCost: false };
  }
  const toppingId = text(raw.toppingId);
  if (!toppingId) errors.push(`${label}: ต้องเลือกรายการไข่หรือท็อปปิ้ง`);
  const amount = raw.quantity === '' || raw.quantity === null || raw.quantity === undefined
    ? null
    : Number(raw.quantity);
  const validAmount = Number.isFinite(amount) && amount > 0 && amount <= 1000;
  if (!validAmount) errors.push(`${label}: จำนวนต้องมากกว่า 0 และไม่เกิน 1,000 หน่วยต่อกล่อง`);
  if (raw.includedInFoodCost !== undefined && typeof raw.includedInFoodCost !== 'boolean') {
    errors.push(`${label}: สถานะรวมในทุนอาหารต้องเป็น true/false`);
  }
  return {
    toppingId,
    quantity: validAmount ? Math.round(amount * 1000) / 1000 : null,
    includedInFoodCost: raw.includedInFoodCost === true,
  };
}

function migrateLegacyCosts(raw) {
  const migrated = { ...raw };
  const groupMeta = isPlainObject(raw.groupMeta) ? { ...raw.groupMeta } : raw.groupMeta;
  if (!Array.isArray(raw.toppings)) {
    const legacyEgg = isPlainObject(raw.egg) ? raw.egg : null;
    migrated.toppings = legacyEgg ? [{
      id: 'egg-legacy',
      name: text(legacyEgg.label) || 'ไข่',
      unit: 'ฟอง',
      cost: legacyEgg.cost ?? null,
      status: legacyEgg.status || 'pending',
      enabled: true,
      note: text(legacyEgg.note),
    }] : [];
  }
  delete migrated.egg;
  if (isPlainObject(groupMeta)) {
    if (!groupMeta.toppings) {
      groupMeta.toppings = {
        title: 'ไข่และท็อปปิ้ง',
        unit: 'บาท / หน่วย',
        includes: 'รายการที่เจ้าของเลือกต่อกล่องตามจำนวน',
        excludes: 'อาหารหลัก เว้นแต่เลือกว่ารวมอยู่ในทุนอาหารที่กรอกแล้ว',
        note: 'เพิ่มไข่และท็อปปิ้งแยกรายการ ราคาที่เว้นว่างจะเป็นรอยืนยัน',
      };
    }
    delete groupMeta.egg;
    migrated.groupMeta = groupMeta;
  }
  if (Array.isArray(raw.dishes)) {
    migrated.dishes = raw.dishes.map((dish) => isPlainObject(dish) && !Array.isArray(dish.toppings)
      ? { ...dish, toppings: [] }
      : dish);
  }
  return migrated;
}

function readGroupMeta(raw, errors) {
  const result = {};
  if (!isPlainObject(raw)) {
    errors.push('groupMeta: ต้องเป็นอ็อบเจกต์');
    return result;
  }
  for (const [key, entry] of Object.entries(raw)) {
    if (!isPlainObject(entry)) {
      errors.push(`groupMeta.${key}: ข้อมูลไม่ถูกต้อง`);
      continue;
    }
    result[key] = {
      title: text(entry.title),
      unit: text(entry.unit),
      includes: text(entry.includes),
      excludes: text(entry.excludes),
      note: text(entry.note),
    };
    if (!result[key].title) errors.push(`groupMeta.${key}: ต้องมีชื่อกลุ่ม`);
    if (!result[key].unit) errors.push(`groupMeta.${key}: ต้องมีหน่วยราคา`);
  }
  return result;
}

// One owner-recorded menu/set. foodCost is the food-only cost per set per
// person; the box cost is added once at recommendation time unless
// includesBox is true. A missing box key or an unknown box cost keeps the
// dish out of recommendations (never guessed, never zero-filled).
//
// kind separates public menus from admin-only sets:
// - "menu": a food menu with optional public fields (name/image/category/
//   description for customers) and an opt-in showOnWebsite flag.
// - "set": an admin-only set that references menu dishes by their existing
//   IDs (menuIds). Sets never get a publish flag and never create public
//   catalog entries.
// - "internal": undecided records stay internal until the owner classifies
//   them. Existing records without a kind default here — never assumed public.
export const DISH_KINDS = ['menu', 'set', 'internal'];
function readDish(raw, label, errors, boxKeys, toppingIds, seenIds, dishIds) {
  if (!isPlainObject(raw)) {
    errors.push(`${label}: ข้อมูลไม่ถูกต้อง`);
    return { id: '', menuId: null, name: '', items: [], toppings: [], foodCost: null, box: '', includesBox: false, status: 'pending', enabled: true, note: '' };
  }
  const id = text(raw.id);
  const name = text(raw.name);
  if (!id) errors.push(`${label}: ต้องมี id`);
  if (id) {
    if (seenIds.has(id)) errors.push(`${label}: id ซ้ำ (${id})`);
    seenIds.add(id);
  }
  if (!name) errors.push(`${label}: ต้องมีชื่อเมนูหรือชื่อชุด`);
  let menuId = null;
  if (raw.menuId !== null && raw.menuId !== undefined && raw.menuId !== '') {
    const parsed = typeof raw.menuId === 'number' ? raw.menuId : Number(text(raw.menuId));
    if (!Number.isFinite(parsed)) errors.push(`${label}: menuId ต้องเป็นตัวเลขรหัสเมนูหรือเว้นว่าง`);
    else menuId = parsed;
  }
  let items = [];
  if (raw.items !== undefined) {
    if (!Array.isArray(raw.items)) errors.push(`${label}: รายการอาหารต้องเป็นอาร์เรย์`);
    else {
      items = raw.items.map((item) => (typeof item === 'string' ? item.trim() : '')).filter(Boolean);
      if (raw.items.some((item) => typeof item !== 'string')) errors.push(`${label}: รายการอาหารต้องเป็นข้อความ`);
    }
  }
  let toppings = [];
  if (raw.toppings !== undefined) {
    if (!Array.isArray(raw.toppings)) errors.push(`${label}: ไข่และท็อปปิ้งต้องเป็นอาร์เรย์`);
    else {
      const seenToppings = new Set();
      toppings = raw.toppings.map((item, index) => {
        const selection = readDishTopping(item, `${label}.toppings[${index}]`, errors);
        if (selection.toppingId) {
          if (seenToppings.has(selection.toppingId)) errors.push(`${label}: เลือกท็อปปิ้งรหัส ${selection.toppingId} ซ้ำ — ใช้หนึ่งรายการและปรับจำนวน`);
          seenToppings.add(selection.toppingId);
          if (!toppingIds.has(selection.toppingId)) errors.push(`${label}: ไม่พบไข่หรือท็อปปิ้งรหัส ${selection.toppingId}`);
        }
        return selection;
      });
    }
  }
  const foodCost = readCost(raw.foodCost, label, errors);
  const rejected = foodCost === 'invalid';
  const box = text(raw.box);
  if (box && !boxKeys.includes(box)) errors.push(`${label}: ชนิดกล่อง ${box} ไม่มีในข้อมูลบรรจุภัณฑ์`);
  const status = readStatus(rejected ? null : foodCost, raw.status, label, errors, rejected);
  let kind = 'internal';
  if (raw.kind !== undefined && raw.kind !== null && raw.kind !== '') {
    if (!DISH_KINDS.includes(raw.kind)) errors.push(`${label}: ประเภทต้องเป็น เมนูอาหาร / ชุดอาหาร / ข้อมูลภายใน`);
    else kind = raw.kind;
  }
  let menuIds = [];
  if (raw.menuIds !== undefined) {
    if (!Array.isArray(raw.menuIds)) errors.push(`${label}: เมนูในชุดต้องเป็นอาร์เรย์รหัสเมนู`);
    else {
      const seenMenus = new Set();
      menuIds = raw.menuIds.map((ref) => text(ref));
      menuIds.forEach((ref, index) => {
        if (!ref) errors.push(`${label}.menuIds[${index}]: ต้องระบุรหัสเมนู`);
        else {
          if (seenMenus.has(ref)) errors.push(`${label}: เลือกเมนูรหัส ${ref} ซ้ำ`);
          seenMenus.add(ref);
          if (!dishIds.has(ref)) errors.push(`${label}: ไม่พบเมนูรหัส ${ref}`);
        }
      });
    }
  }
  const publicName = text(raw.publicName);
  const image = text(raw.image);
  const category = text(raw.category);
  const description = text(raw.description);
  const showOnWebsite = raw.showOnWebsite === true;
  if (showOnWebsite && kind !== 'menu') errors.push(`${label}: ตัวเลือกแสดงบนเว็บไซต์มีเฉพาะเมนูอาหาร — ชุดอาหารไม่มีตัวเลือกเผยแพร่`);
  if (kind !== 'menu' && (publicName || image || category || description)) {
    errors.push(`${label}: ชื่อ/รูป/หมวด/คำอธิบายสาธารณะใช้ได้เฉพาะเมนูอาหาร`);
  }
  return {
    id,
    menuId,
    name,
    items,
    toppings,
    foodCost: rejected ? null : foodCost,
    box,
    includesBox: Boolean(raw.includesBox),
    status,
    enabled: raw.enabled === undefined ? true : Boolean(raw.enabled),
    note: text(raw.note),
    kind,
    menuIds,
    publicName,
    image,
    category,
    description,
    showOnWebsite,
  };
}

// Builds a clean copy with a fixed schema: unknown keys never reach disk.
export function validateCosts(raw) {
  const errors = [];
  if (!isPlainObject(raw)) return { ok: false, errors: ['ข้อมูลต้องเป็นอ็อบเจกต์ JSON'], data: null };
  raw = migrateLegacyCosts(raw);
  for (const key of Object.keys(raw)) {
    if (!TOP_LEVEL_KEYS.includes(key)) errors.push(`ไม่อนุญาตให้บันทึกคีย์ ${key}`);
  }
  const data = {
    _note: text(raw._note),
    updatedAt: null,
    groupMeta: readGroupMeta(raw.groupMeta, errors),
    dishes: [],
    extras: [],
    toppings: [],
    fruit: null,
    boxes: {},
  };
  for (const key of ['fruit']) {
    if (!isPlainObject(raw[key])) {
      errors.push(`${key}: ต้องเป็นอ็อบเจกต์`);
      continue;
    }
    data[key] = readEntry(raw[key], key, errors);
  }
  if (!isPlainObject(raw.boxes)) errors.push('boxes: ต้องเป็นอ็อบเจกต์');
  else {
    for (const [key, entry] of Object.entries(raw.boxes)) {
      data.boxes[key] = readEntry(entry, `boxes.${key}`, errors);
    }
  }
  if (!Array.isArray(raw.extras)) errors.push('extras: ต้องเป็นอาร์เรย์');
  else {
    const seen = new Set();
    raw.extras.forEach((entry, index) => {
      const item = readItem(entry, `extras[${index}]`, errors);
      if (item.id) {
        if (seen.has(item.id)) errors.push(`extras[${index}]: id ซ้ำ (${item.id})`);
        seen.add(item.id);
      }
      data.extras.push(item);
    });
  }
  if (!Array.isArray(raw.toppings)) errors.push('toppings: ต้องเป็นอาร์เรย์');
  else {
    const seen = new Set();
    raw.toppings.forEach((entry, index) => {
      const item = readTopping(entry, `toppings[${index}]`, errors);
      if (item.id) {
        if (seen.has(item.id)) errors.push(`toppings[${index}]: id ซ้ำ (${item.id})`);
        seen.add(item.id);
      }
      data.toppings.push(item);
    });
  }
  if (!Array.isArray(raw.dishes)) errors.push('dishes: ต้องเป็นอาร์เรย์');
  else {
    const seenIds = new Set();
    const boxKeys = Object.keys(data.boxes);
    const toppingIds = new Set(data.toppings.map((item) => item.id));
    const dishIds = new Set();
    raw.dishes.forEach((entry) => {
      if (isPlainObject(entry) && text(entry.id)) dishIds.add(text(entry.id));
    });
    raw.dishes.forEach((entry, index) => {
      data.dishes.push(readDish(entry, `dishes[${index}]`, errors, boxKeys, toppingIds, seenIds, dishIds));
    });
  }
  if (errors.length) return { ok: false, errors, data: null };
  return { ok: true, errors: [], data };
}

export async function readCosts(dataDir) {
  const file = path.join(dataDir, COSTS_FILE);
  const raw = JSON.parse(await readFile(file, 'utf8'));
  const result = validateCosts(raw);
  if (!result.ok) {
    const error = new Error(`ข้อมูลทุนภายในไม่ผ่านการตรวจ: ${result.errors.join(' | ')}`);
    error.code = 'ECOSTSINVALID';
    throw error;
  }
  result.data.version = Number.isFinite(Number(raw.version)) ? Number(raw.version) : 0;
  result.data.updatedAt = text(raw.updatedAt) || null;
  return result.data;
}

// Writes atomically and bumps the version so open pages can detect the change.
export async function saveCosts(dataDir, raw) {
  const result = validateCosts(raw);
  if (!result.ok) return result;
  const current = await readCosts(dataDir).catch(() => null);
  const version = (current?.version ?? 0) + 1;
  const updatedAt = new Date().toISOString();
  const payload = { ...result.data, version, updatedAt };
  const file = path.join(dataDir, COSTS_FILE);
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  await rename(temp, file);
  return { ok: true, errors: [], data: payload };
}
