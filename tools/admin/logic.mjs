// Local-only owner draft. Never import sales prices or business costs from public pages.
export const MINIMUM_PER_MENU = 10;
export const SHIPPING_PENDING = 'ค่าจัดส่งสอบถามแอดมิน';

export function money(value) {
  return new Intl.NumberFormat('th-TH', { maximumFractionDigits: 2 }).format(value);
}

export function positiveNumber(value) {
  if (value === '' || value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function quantity(value) {
  const parsed = Number(value);
  return value !== '' && Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

// Only owner-confirmed prices are usable. Blank or draft prices stay unknown — never 0.
export function confirmedCost(entry) {
  if (!entry || entry.status !== 'confirmed') return null;
  const value = Number(entry.cost);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 100) / 100;
}

// Main-dish cost comes only from a recorded dish ("dish:<id>") or an
// owner-typed manual cost. Protein-type base costs and special replacements
// no longer exist — nothing is inferred from names.
export function dishById(costs, id) {
  return (Array.isArray(costs.dishes) ? costs.dishes : []).find((dish) => String(dish?.id) === String(id)) || null;
}

export function mainCost(set, costs) {
  const [kind, ...rest] = String(set.costChoice || '').split(':');
  if (kind === 'dish') {
    const dish = dishById(costs, rest.join(':'));
    if (!dish || dish.status !== 'confirmed') return null;
    return positiveNumber(dish.foodCost);
  }
  if (set.costChoice === 'manual') return positiveNumber(set.manualMainCost);
  return null;
}

function toppingCatalog(costs) {
  if (Array.isArray(costs.toppings)) return costs.toppings;
  if (costs.egg) {
    return [{
      id: 'egg-legacy', name: costs.egg.label || 'ไข่', unit: 'ฟอง',
      cost: costs.egg.cost, status: costs.egg.status, enabled: true,
    }];
  }
  return [];
}

function amount(value) {
  if (value === '' || value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 1000 ? parsed : null;
}

function setToppingSelections(set) {
  const selections = Array.isArray(set.toppings) ? set.toppings : [];
  const legacyEggs = Number(set.eggs);
  if (selections.length || !Number.isFinite(legacyEggs) || legacyEggs <= 0) return selections;
  return [{ toppingId: 'egg-legacy', quantity: set.eggs, includedInFoodCost: false }];
}

// Rice is included in the main dish; egg/fruit/dessert never count as savoury dishes.
export function savouryCount(set) {
  return 1 + set.extras.filter((item) => ['soup', 'curry', 'side'].includes(item.kind)).length;
}

export function recommendBox(set) {
  const hasSoupOrCurry = set.extras.some((item) => item.kind === 'soup' || item.kind === 'curry');
  const hasDessert = set.extras.some((item) => item.kind === 'dessert');
  if (savouryCount(set) > 3 && set.fruit && hasDessert) {
    return { id: 'corrugated', reason: 'อาหารคาวมากกว่า 3 อย่าง พร้อมผลไม้และขนม', needsConfirmation: false };
  }
  if (hasSoupOrCurry && set.fruit) {
    return { id: 'four', reason: 'อาหารหลัก + น้ำแกง/น้ำซุป + ผลไม้', needsConfirmation: false };
  }
  if (!set.extras.length && !set.fruit) {
    return { id: 'three', reason: 'ชุดพื้นฐาน (อาหารหลัก และไข่เพิ่มได้)', needsConfirmation: false };
  }
  return { id: null, reason: 'องค์ประกอบนอกเงื่อนไขตัวอย่าง — เจ้าของต้องเลือกและยืนยันกล่องเอง', needsConfirmation: true };
}

export function calculateSet(set, costs, catalog) {
  const missing = [];
  let known = 0;
  const mainName = catalog.find((item) => String(item.id) === String(set.menuId))?.name ||
    String(set.customMain || '').trim();
  if (!mainName) missing.push('ชื่ออาหารหลัก');
  const main = mainCost(set, costs);
  if (main === null) missing.push('ต้นทุนอาหารหลัก');
  else known += main;

  const toppingItems = toppingCatalog(costs);
  const seenToppings = new Set();
  const toppingDetails = [];
  setToppingSelections(set).forEach((selection, index) => {
    const item = toppingItems.find((candidate) => String(candidate.id) === String(selection.toppingId));
    const name = item?.name || `รายการ ${index + 1}`;
    const count = amount(selection.quantity);
    if (!item) missing.push(`${name} — ไม่พบในรายการไข่และท็อปปิ้ง`);
    else if (item.enabled === false) missing.push(`${name} — ปิดใช้งาน`);
    if (!selection.toppingId) missing.push(`เลือกรายการไข่หรือท็อปปิ้ง ${index + 1}`);
    if (count === null) missing.push(`${name} — ระบุจำนวนต่อกล่องให้ถูกต้อง`);
    if (seenToppings.has(String(selection.toppingId))) missing.push(`${name} — เลือกซ้ำ กรุณารวมเป็นบรรทัดเดียวและปรับจำนวน`);
    seenToppings.add(String(selection.toppingId));
    const unitCost = confirmedCost(item);
    if (item && unitCost === null) missing.push(`${name} — ต้นทุนยังไม่ยืนยัน`);
    const includedInFoodCost = selection.includedInFoodCost === true;
    if (item && count !== null && unitCost !== null && !includedInFoodCost) known += count * unitCost;
    if (item && count !== null) {
      toppingDetails.push({ id: item.id, name: item.name, quantity: count, unit: item.unit, includedInFoodCost });
    }
  });
  if (set.fruit) {
    const fruitCost = confirmedCost(costs.fruit);
    if (fruitCost === null) missing.push('ต้นทุนผลไม้ยังไม่ยืนยัน');
    else known += fruitCost;
  }

  set.extras.forEach((item, index) => {
    if (!String(item.name || '').trim()) missing.push(`ชื่อรายการเพิ่ม ${index + 1}`);
    const cost = positiveNumber(item.cost);
    if (cost === null) missing.push(`${String(item.name || '').trim() || `รายการเพิ่ม ${index + 1}`} — ยังไม่ระบุต้นทุน`);
    else known += cost;
  });
  const box = costs.boxes[set.box];
  const boxCost = confirmedCost(box);
  if (!box) missing.push('ชนิดกล่อง');
  else if (set.boxIncludedInCost) {
    // The recorded dish cost already includes this box: the box type is kept
    // for reference but its cost is added exactly zero times (never double-count).
  } else if (boxCost === null) missing.push('ต้นทุนกล่องยังไม่ยืนยัน');
  else known += boxCost;

  const count = quantity(set.count);
  if (count === null || count < MINIMUM_PER_MENU) missing.push(`จำนวนขั้นต่ำ ${MINIMUM_PER_MENU} กล่องต่อเมนู`);
  const recommendation = recommendBox(set);
  const boxConfirmed = !recommendation.needsConfirmation || Boolean(set.boxTouched);
  const quote = positiveNumber(set.quote);
  const result = {
    missing,
    recommendation,
    boxConfirmed,
    mainName,
    toppings: toppingDetails,
    savoury: savouryCount(set),
    knownPerBox: Math.round(known * 100) / 100,
    knownTotal: count === null ? null : Math.round(known * count * 100) / 100,
    quote,
    count,
    complete: missing.length === 0 && boxConfirmed,
    differencePerBox: null,
    differenceTotal: null,
  };
  if (result.complete && quote !== null) {
    result.differencePerBox = Math.round((quote - result.knownPerBox) * 100) / 100;
    result.differenceTotal = Math.round(result.differencePerBox * count * 100) / 100;
  }
  return result;
}

// Customer copy is built from an explicit allowlist, never from the cost summary or DOM.
export function customerMessage(sets, results, shippingQuote, costs = {}) {
  const shipping = positiveNumber(shippingQuote);
  const toppingItems = toppingCatalog(costs);
  const lines = [];
  sets.forEach((set, index) => {
    const result = results[index];
    lines.push(String(set.title || '').trim() || `ชุดที่ ${index + 1}`);
    lines.push(`อาหารหลักพร้อมข้าว: ${result.mainName}`);
    const dishItems = Array.isArray(set.dishItems) ? set.dishItems.map((item) => String(item || '').trim()).filter(Boolean) : [];
    if (dishItems.length) lines.push(`รายการในชุด: ${dishItems.join(', ')}`);
    set.extras.forEach((item) => lines.push(`${item.kind === 'dessert' ? 'ขนม' : item.kind === 'soup' ? 'ต้ม/ซุป' : item.kind === 'curry' ? 'แกง' : 'กับข้าวเพิ่ม'}: ${item.name.trim()}`));
    setToppingSelections(set).forEach((selection) => {
      const item = toppingItems.find((candidate) => String(candidate.id) === String(selection.toppingId));
      const count = amount(selection.quantity);
      if (item && count !== null) lines.push(`${item.name} ${count} ${item.unit}/กล่อง`);
    });
    if (set.fruit) lines.push('ผลไม้ 1 ชุด/กล่อง (ใส่ในกล่อง)');
    lines.push(`จำนวน ${result.count} กล่อง`);
    if (result.quote !== null) {
      if (set.priceIncludesDelivery) {
        lines.push(`ราคา ${money(result.quote)} บาท/กล่อง (รวมค่าจัดส่งแล้ว)`);
        lines.push(`ยอดรวม ${money(Math.round(result.quote * result.count * 100) / 100)} บาท`);
      } else {
        lines.push(`ราคาขายที่เสนอ ${money(result.quote)} บาท/กล่อง`);
      }
    }
    lines.push('');
  });
  if (sets.some((set) => !set.priceIncludesDelivery)) {
    lines.push(shipping === null ? SHIPPING_PENDING : `ค่าจัดส่ง ${money(shipping)} บาท`);
  }
  return lines.join('\n').trim();
}
