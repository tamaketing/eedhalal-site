// Bulk cost entry: confirm many menus at once.
//
// The owner had to open the cost planner and fill in one dish at a time. With
// 39 menus still waiting on a confirmed cost that is a long slog, and the whole
// point of the gate is that a menu without a confirmed cost cannot be ordered.
//
// This module merges a batch of {menuId, foodCost, box, ...} rows into the
// existing cost store. It MERGES, never replaces: dishes the owner did not
// touch keep their values, and every dish the batch does not mention is left
// exactly as it was.
//
// Rules that must not be softened:
//   - foodCost must be a positive finite number. Zero is never a cost; the
//     owner rules say an unconfirmed figure stays null rather than 0, because 0
//     would silently read as "free".
//   - a row with no usable cost is skipped and reported, never confirmed.
//   - the merged store is re-validated before it is written, so a bad batch
//     cannot corrupt the file.

const DISH_KINDS = ['menu', 'set', 'internal'];
const CONFIRMED = 'confirmed';

const asText = (value) => (typeof value === 'string' ? value.trim() : '');
const asNumber = (value) => {
  if (value === '' || value === null || value === undefined) return null;
  const parsed = typeof value === 'number' ? value : Number(String(value).trim());
  return Number.isFinite(parsed) ? parsed : null;
};

/**
 * Apply a batch to a cost store.
 * @returns {{ costs: object, applied: object[], skipped: object[], errors: string[] }}
 */
export function applyBulkCosts(costs, rows, { defaultBox = '', defaultKind = 'menu' } = {}) {
  const errors = [];
  const applied = [];
  const skipped = [];

  if (!Array.isArray(rows)) {
    return { costs, applied, skipped, errors: ['รายการทุนต้องเป็นอาร์เรย์'] };
  }

  const store = JSON.parse(JSON.stringify(costs));
  if (!Array.isArray(store.dishes)) store.dishes = [];
  if (!store.boxes || typeof store.boxes !== 'object') store.boxes = {};

  const boxKeys = Object.keys(store.boxes);
  const byMenuId = new Map();
  for (const dish of store.dishes) {
    if (dish.menuId !== null && dish.menuId !== undefined) byMenuId.set(Number(dish.menuId), dish);
  }
  const dishIds = new Set(store.dishes.map((dish) => dish.id));

  for (const [index, raw] of rows.entries()) {
    const label = `รายการที่ ${index + 1}`;
    if (!raw || typeof raw !== 'object') {
      skipped.push({ menuId: null, reason: `${label}: ไม่ใช่ข้อมูลที่ใช้ได้` });
      continue;
    }

    const menuId = asNumber(raw.menuId);
    if (menuId === null || !Number.isInteger(menuId)) {
      skipped.push({ menuId: null, reason: `${label}: ไม่มีเลขเมนู` });
      continue;
    }

    const foodCost = asNumber(raw.foodCost);
    if (foodCost === null || foodCost <= 0) {
      // Never confirm a row without a real cost. Leaving it untouched keeps the
      // menu ask-for-quote, which is the honest state.
      skipped.push({ menuId, name: asText(raw.name), reason: `${label}: ยังไม่ได้ใส่ต้นทุนอาหาร (ห้ามใส่ 0)` });
      continue;
    }

    const box = asText(raw.box) || defaultBox;
    if (box && !boxKeys.includes(box)) {
      skipped.push({ menuId, name: asText(raw.name), reason: `${label}: ไม่รู้จักกล่อง "${box}"` });
      continue;
    }
    const boxCost = box ? asNumber(store.boxes[box]?.cost) : null;
    if (box && (boxCost === null || boxCost <= 0)) {
      skipped.push({ menuId, name: asText(raw.name), reason: `${label}: ยังไม่ยืนยันต้นทุนกล่อง "${box}"` });
      continue;
    }

    const name = asText(raw.name);
    if (!name) {
      skipped.push({ menuId, reason: `${label}: ไม่มีชื่อเมนู` });
      continue;
    }

    const kind = DISH_KINDS.includes(asText(raw.kind)) ? asText(raw.kind) : defaultKind;
    const includesBox = raw.includesBox === true;
    // Landed cost per box: food plus the box, unless the owner said the dish
    // already accounts for it. This is what the owner needs to see to sanity
    // check a batch, and it is never published.
    const landed = foodCost + (includesBox ? 0 : (boxCost ?? 0));

    let dish = byMenuId.get(menuId);
    const created = !dish;
    if (!dish) {
      let id = `menu-${menuId}`;
      if (dishIds.has(id)) {
        skipped.push({ menuId, name, reason: `${label}: id ${id} ถูกใช้แล้ว` });
        continue;
      }
      dish = {
        id,
        menuId,
        name,
        items: [],
        toppings: [],
        foodCost: null,
        box,
        includesBox,
        status: 'pending',
        enabled: true,
        note: '',
        kind,
        menuIds: [],
        publicName: '',
        image: '',
        category: '',
        description: '',
        showOnWebsite: false,
      };
      store.dishes.push(dish);
      dishIds.add(id);
      byMenuId.set(menuId, dish);
    }

    dish.name = name;
    dish.foodCost = foodCost;
    dish.box = box;
    dish.includesBox = includesBox;
    // foodCost passed the positive-finite check above, so the cost is
    // confirmed by definition here. readCost/readStatus in cost-store.mjs will
    // downgrade it again if anything about the row is inconsistent.
    dish.status = CONFIRMED;
    if (raw.note !== undefined) dish.note = asText(raw.note);
    if (raw.enabled !== undefined) dish.enabled = raw.enabled !== false;
    // Only touch classification when the batch actually carried one.
    if (asText(raw.kind)) dish.kind = kind;

    applied.push({ menuId, name, foodCost, box, includesBox, landedCost: landed, created });
  }

  return { costs: store, applied, skipped, errors };
}

/** Cost rows for every published menu, with the shop's selling price for context. */
export function bulkCostRows(costs, catalogue) {
  const byMenuId = new Map();
  for (const dish of costs?.dishes || []) {
    if (dish.menuId !== null && dish.menuId !== undefined) byMenuId.set(Number(dish.menuId), dish);
  }
  const rows = [];
  for (const menu of catalogue) {
    const id = Number(menu.id);
    const dish = byMenuId.get(id);
    const boxCost = dish?.box ? asNumber(costs?.boxes?.[dish.box]?.cost) : null;
    rows.push({
      menuId: id,
      name: menu.name,
      category: menu.category,
      image: menu.image,
      sellPrice: menu.price,
      minPerMenu: menu.minPerMenu,
      costId: dish?.id || `menu-${id}`,
      confirmed: dish?.status === 'confirmed' && asNumber(dish.foodCost) > 0,
      foodCost: dish ? asNumber(dish.foodCost) : null,
      box: dish?.box || '',
      includesBox: dish?.includesBox === true,
      note: dish?.note || '',
      boxCost: boxCost ?? null,
    });
  }
  return rows;
}