// Internal recommendation engine for the owner demo. Uses only owner-confirmed
// cost data from owner-costs.json (single source); never public sale prices.
//
// Owner model: the owner records each menu/set with its own per-person food
// cost. The engine SELECTS recorded, enabled, fully cost-confirmed dishes
// that pass the budget and profit tiers. It never composes sets, never adds
// food, and never changes a dish's box on its own.
import { MINIMUM_PER_MENU, money } from './logic.mjs';

export const PROFIT_LABEL = 'กำไรหลังหักต้นทุนที่ระบุ';

export function toCents(value) {
  if (value === '' || value == null) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed * 100);
}

// Owner-confirmed entry → integer cents, or null while it is still unconfirmed.
export function entryCents(entry) {
  return confirmedCents(entry);
}

function confirmedCents(entry) {
  if (!entry || entry.status !== 'confirmed') return null;
  const value = Number(entry.cost);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 100);
}

export function validateTiers(tiers) {
  const errors = [];
  if (!Array.isArray(tiers) || tiers.length === 0) return ['ตารางกำไรภายในยังไม่มีข้อมูล (owner-settings.json)'];
  tiers.forEach((tier, index) => {
    const label = `ขั้นที่ ${index + 1}`;
    const from = Number(tier.from);
    const to = Number(tier.to);
    if (!Number.isFinite(from) || !Number.isFinite(to)) {
      errors.push(`${label}: ต้องระบุช่วงยอดขาย from/to เป็นตัวเลข`);
      return;
    }
    if (from >= to) errors.push(`${label}: ยอดขายเริ่มต้นต้องน้อยกว่ายอดขายสิ้นสุด`);
    const minProfit = Number(tier.minProfit);
    const targetProfit = Number(tier.targetProfit);
    if (!Number.isInteger(minProfit) || !Number.isInteger(targetProfit)) {
      errors.push(`${label}: อัตรากำไรต้องเป็นจำนวนเต็มร้อยละ`);
      return;
    }
    if (minProfit < 0 || targetProfit > 100) errors.push(`${label}: อัตรากำไรต้องอยู่ระหว่าง 0–100`);
    if (minProfit > targetProfit) errors.push(`${label}: กำไรขั้นต่ำ (${minProfit}%) ห้ามเกินกำไรเป้าหมาย (${targetProfit}%)`);
  });
  const usable = tiers
    .filter((tier) => Number.isFinite(Number(tier.from)) && Number.isFinite(Number(tier.to)))
    .sort((a, b) => Number(a.from) - Number(b.from));
  for (let index = 1; index < usable.length; index += 1) {
    const previous = usable[index - 1];
    const current = usable[index];
    const overlaps = previous.toInclusive
      ? Number(current.from) <= Number(previous.to)
      : Number(current.from) < Number(previous.to);
    if (overlaps) errors.push(`ช่วงยอดขายซ้อนกัน: ${previous.from}–${previous.to} กับขั้นที่เริ่มที่ ${current.from}`);
  }
  return errors;
}

export function tierForSales(tiers, salesCents) {
  for (const tier of Array.isArray(tiers) ? tiers : []) {
    const from = toCents(tier.from);
    const to = toCents(tier.to);
    if (from === null || to === null) continue;
    if (salesCents >= from && (tier.toInclusive ? salesCents <= to : salesCents < to)) return tier;
  }
  return null;
}

// Exact integer-cent formula: [sales x (1 - rate) - shipping - other] / boxes.
export function foodAllowanceCents({ salesCents, rate, shipCents, otherCents, count }) {
  const numerator = salesCents * (100 - Number(rate)) - 100 * (shipCents + otherCents);
  return Math.floor(numerator / (100 * count));
}

// Pass/fail uses the real values before any display rounding.
export function evaluateOption({ costPerPersonCents, count, salesCents, shipCents, otherCents, tier }) {
  const foodTotalCents = costPerPersonCents * count;
  const totalCostCents = foodTotalCents + shipCents + otherCents;
  const profitCents = salesCents - totalCostCents;
  const reachesTarget = profitCents * 100 >= salesCents * Number(tier.targetProfit);
  const reachesMinimum = profitCents * 100 >= salesCents * Number(tier.minProfit);
  return {
    foodTotalCents,
    totalCostCents,
    profitCents,
    profitBaht: profitCents / 100,
    pct: salesCents > 0 ? (profitCents * 100) / salesCents : 0,
    group: reachesTarget ? 'target' : reachesMinimum ? 'minimum' : 'fail',
  };
}

export function jobContext({ saleBudget, boxCount, shipping, otherExpenses, settings }) {
  const errors = [];
  const tiers = Array.isArray(settings?.profitTiers) ? settings.profitTiers : [];
  errors.push(...validateTiers(tiers));
  const saleCents = toCents(saleBudget);
  if (saleCents === null || saleCents <= 0) errors.push('กรุณาระบุงบขายต่อกล่อง (รวมค่าส่งแล้ว) มากกว่า 0 บาท');
  const count = Number(boxCount);
  if (!Number.isSafeInteger(count) || count < MINIMUM_PER_MENU) {
    errors.push(`จำนวนกล่องต้องเป็นจำนวนเต็มอย่างน้อย ${MINIMUM_PER_MENU} กล่องต่อเมนู`);
  }
  const shipCents = toCents(shipping);
  if (shipCents === null) {
    errors.push('ต้นทุนค่าส่งรวมงานยังไม่ทราบ — เว้นว่างหมายถึงยังไม่ทราบ ระบบไม่แทนด้วย 0 (ไม่มีค่าส่งจริงให้กรอก 0)');
  }
  let otherCents = 0;
  let otherSpecified = false;
  const otherText = otherExpenses == null ? '' : String(otherExpenses).trim();
  if (otherText !== '') {
    const parsed = toCents(otherText);
    if (parsed === null) errors.push('ค่าใช้จ่ายอื่นของงานต้องเป็นตัวเลขที่ไม่ติดลบ (เว้นว่าง = ไม่ระบุ ใช้ 0)');
    else {
      otherCents = parsed;
      otherSpecified = true;
    }
  }
  if (errors.length) return { ok: false, errors, context: null, usedValues: [] };
  const salesCents = saleCents * count;
  const tier = tierForSales(tiers, salesCents);
  if (!tier) {
    return {
      ok: false,
      errors: [`ยอดขายรวมงาน ${money(salesCents / 100)} บาท อยู่นอกตารางกำไรภายใน — ต้องกำหนดเกณฑ์เองใน owner-settings.json ก่อน ระบบไม่เดาอัตรา`],
      context: null,
      usedValues: [],
    };
  }
  const allowanceTargetCents = foodAllowanceCents({ salesCents, rate: tier.targetProfit, shipCents, otherCents, count });
  const allowanceMinCents = foodAllowanceCents({ salesCents, rate: tier.minProfit, shipCents, otherCents, count });
  const context = { saleCents, count, salesCents, shipCents, otherCents, otherSpecified, tier, allowanceTargetCents, allowanceMinCents };
  const usedValues = [
    `งบขายต่อกล่อง ${money(saleCents / 100)} บาท (รวมค่าจัดส่งแล้ว)`,
    `จำนวนกล่อง ${money(count)} กล่อง`,
    `ค่าส่งรวมงาน ${money(shipCents / 100)} บาท`,
    otherSpecified ? `ค่าใช้จ่ายอื่นของงาน ${money(otherCents / 100)} บาท` : 'ค่าใช้จ่ายอื่นของงาน ไม่ได้กรอก → ใช้ 0 บาท',
    `ยอดขายรวมงาน ${money(salesCents / 100)} บาท = งบขายต่อกล่อง x จำนวนกล่อง`,
    `เรทโซนที่ใช้ ${money(tier.from)}–${money(tier.to)}${tier.toInclusive ? '' : ' (ไม่รวมปลายช่วง)'} บาท → กำไรขั้นต่ำ ${tier.minProfit}% เป้าหมาย ${tier.targetProfit}%`,
    `งบอาหารและกล่องต่อคน: ถึงกำไรเป้าหมาย ${money(allowanceTargetCents / 100)} บาท/คน · ผ่านกำไรขั้นต่ำ ${money(allowanceMinCents / 100)} บาท/คน`,
    'อ่านตารางกำไรจาก owner-settings.json เท่านั้น ไม่ใช้เรทโซนเดิม',
  ];
  return { ok: true, errors: [], context, usedValues };
}

// Only dishes the owner recorded, enabled, and fully cost-confirmed enter.
// Anything else is reported with its reason — never guessed, never zero-filled.
function toppingCosts(dish, costs) {
  const catalog = Array.isArray(costs.toppings) ? costs.toppings : [];
  const lines = [];
  const seen = new Set();
  let addedCents = 0;
  for (const [index, selection] of (Array.isArray(dish.toppings) ? dish.toppings : []).entries()) {
    const id = String(selection?.toppingId || '');
    const topping = catalog.find((item) => String(item.id) === id);
    const name = String(topping?.name || id || `รายการ ${index + 1}`);
    if (!topping) return { ok: false, reason: `${name} ไม่มีในรายการไข่และท็อปปิ้ง` };
    if (seen.has(id)) return { ok: false, reason: `${name} ถูกเลือกซ้ำในชุด — รวมจำนวนไว้บรรทัดเดียว` };
    seen.add(id);
    if (topping.enabled === false) return { ok: false, reason: `${name} ปิดใช้งาน` };
    if (topping.status !== 'confirmed') return { ok: false, reason: `${name} ยังรอยืนยันทุน` };
    const unitCents = toCents(topping.cost);
    if (unitCents === null || unitCents <= 0) return { ok: false, reason: `${name} ยังไม่ระบุต้นทุนต่อหน่วย` };
    const quantity = Number(selection.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 1000) return { ok: false, reason: `${name} ยังไม่มีจำนวนต่อกล่องที่ถูกต้อง` };
    const included = selection.includedInFoodCost === true;
    const cents = included ? 0 : Math.round(unitCents * quantity);
    addedCents += cents;
    lines.push({
      id: topping.id,
      name: String(topping.name),
      unit: String(topping.unit),
      quantity,
      includedInFoodCost: included,
      cents,
    });
  }
  return { ok: true, lines, addedCents };
}

function dishCandidates(costs) {
  const list = [];
  const skipped = [];
  const boxes = costs.boxes || {};
  for (const dish of Array.isArray(costs.dishes) ? costs.dishes : []) {
    const name = String(dish?.name || '').trim();
    const label = name || `ชุด ${String(dish?.id || '').trim() || 'ไม่ระบุชื่อ'}`;
    if (!name) {
      skipped.push({ label, reason: 'ไม่มีชื่อเมนู/ชุด' });
      continue;
    }
    if (dish.status !== 'confirmed') {
      skipped.push({ label, reason: 'ยังไม่ยืนยันต้นทุน (รอยืนยันทุนรายเมนู)' });
      continue;
    }
    if (dish.enabled === false) {
      skipped.push({ label, reason: 'เจ้าของปิดใช้แนะนำ' });
      continue;
    }
    const toppingResult = toppingCosts(dish, costs);
    if (!toppingResult.ok) {
      skipped.push({ label, reason: `ท็อปปิ้ง ${toppingResult.reason}` });
      continue;
    }
    const foodCents = toCents(dish.foodCost);
    if (foodCents === null || foodCents <= 0) {
      skipped.push({ label, reason: 'ยังไม่ระบุต้นทุนอาหาร' });
      continue;
    }
    const boxKey = String(dish.box || '').trim();
    if (!boxKey) {
      skipped.push({ label, reason: 'ยังไม่ระบุชนิดกล่อง' });
      continue;
    }
    const boxInfo = boxes[boxKey];
    if (!boxInfo) {
      skipped.push({ label, reason: `ชนิดกล่อง ${boxKey} ไม่มีในข้อมูลบรรจุภัณฑ์` });
      continue;
    }
    const boxLabel = String(boxInfo.label || boxKey);
    if (dish.includesBox) {
      list.push(dishEntry(dish, name, foodCents, toppingResult, { key: boxKey, label: boxLabel, cents: 0, included: true }));
      continue;
    }
    const boxCents = confirmedCents(boxInfo);
    if (boxCents === null) {
      skipped.push({ label, reason: `ต้นทุนกล่อง${boxLabel ? ` ${boxLabel}` : ''}ยังไม่ยืนยัน` });
      continue;
    }
    list.push(dishEntry(dish, name, foodCents, toppingResult, { key: boxKey, label: boxLabel, cents: boxCents, included: false }));
  }
  return { list, skipped };
}

function dishEntry(dish, name, foodCents, toppingResult, box) {
  const costPerPersonCents = foodCents + toppingResult.addedCents + box.cents;
  return {
    signature: `dish:${dish.id}`,
    dish: {
      id: dish.id,
      menuId: dish.menuId ?? null,
      name,
      items: Array.isArray(dish.items) ? dish.items.filter((item) => String(item || '').trim()).map((item) => String(item).trim()) : [],
      toppings: toppingResult.lines,
      foodCents,
      toppingCents: toppingResult.addedCents,
      includesBox: Boolean(dish.includesBox),
    },
    box,
    costPerPersonCents,
  };
}

function compareOptions(a, b) {
  if (b.evaluation.pct !== a.evaluation.pct) return b.evaluation.pct - a.evaluation.pct;
  if (a.costPerPersonCents !== b.costPerPersonCents) return a.costPerPersonCents - b.costPerPersonCents;
  return a.signature < b.signature ? -1 : a.signature > b.signature ? 1 : 0;
}

function noPassReasons({ context, usable, skipped }) {
  const reasons = [];
  if (usable.length) {
    const cheapest = Math.min(...usable.map((option) => option.costPerPersonCents));
    if (cheapest > context.allowanceMinCents) {
      reasons.push(`ต้นทุนต่ำสุดที่บันทึกไว้ ${money(cheapest / 100)} บาท/คน สูงกว่างบอาหารและกล่องที่ยังเหลือ ${money(context.allowanceMinCents / 100)} บาท/คน (เกณฑ์กำไรขั้นต่ำ ${context.tier.minProfit}%)`);
    } else {
      reasons.push(`ไม่มีเมนู/ชุดใดผ่านเกณฑ์กำไรขั้นต่ำ ${context.tier.minProfit}% ด้วยต้นทุนที่บันทึกไว้`);
    }
  } else if (skipped.length) {
    reasons.push(`ยังไม่มีเมนู/ชุดที่บันทึก เปิดใช้ และยืนยันต้นทุนครบ — บันทึกและยืนยันทุนรายเมนูที่หน้าจัดการเมนูก่อน`);
  }
  if (skipped.length) {
    const preview = skipped.slice(0, 3).map((item) => `${item.label} (${item.reason})`).join(' · ');
    reasons.push(`รายการที่ถูกข้าม ${skipped.length} รายการ${preview ? `: ${preview}` : ''}`);
  }
  reasons.push('ระบบไม่ลดเกณฑ์กำไรเอง เกณฑ์ขั้นต่ำและเป้าหมายยังคงตามตารางกำไรที่ตั้งไว้');
  reasons.push('ระบบไม่สร้างชุดหรือเดาราคาใหม่ — ลองปรับ: เพิ่มงบขายต่อกล่อง, ลดค่าส่งรวมงาน, ลดค่าใช้จ่ายอื่นของงาน, หรือบันทึกเมนู/ชุดต้นทุนต่ำกว่า');
  return reasons;
}

export function recommendSets(input) {
  const { costs, settings, catalogCount = 0 } = input;
  const base = jobContext(input);
  const emptyGroups = { target: [], minimum: [] };
  if (!base.ok) return { ...base, groups: emptyGroups, skipped: null, reasons: [] };
  if (!costs || !settings) return { ...base, ok: false, errors: ['ข้อมูลต้นทุนภายในยังโหลดไม่สำเร็จ'], groups: emptyGroups, skipped: null, reasons: [] };
  const context = base.context;
  const { list: usable, skipped: skippedDishes } = dishCandidates(costs);
  if (!usable.length) {
    return { ...base, ok: false, errors: ['ยังไม่มีเมนู/ชุดอาหารที่บันทึก เปิดใช้ และยืนยันต้นทุนครบในไฟล์ต้นทุนภายใน — บันทึกที่หน้าจัดการเมนูก่อน ระบบไม่สร้างชุดหรือเดาราคาเอง'], groups: emptyGroups, skipped: null, reasons: [] };
  }
  const evaluated = usable.map((option) => ({
    ...option,
    evaluation: evaluateOption({
      costPerPersonCents: option.costPerPersonCents,
      count: context.count,
      salesCents: context.salesCents,
      shipCents: context.shipCents,
      otherCents: context.otherCents,
      tier: context.tier,
    }),
    breakdown: [],
  }));
  const passing = evaluated.filter((option) => option.evaluation.group !== 'fail');
  for (const option of passing) {
    const foodLabel = `อาหารในชุด ${option.dish.name}`;
    option.breakdown = [
      { label: foodLabel, cents: option.dish.foodCents },
      ...option.dish.toppings.map((item) => ({
        label: item.includedInFoodCost
          ? `${item.name} ${item.quantity} ${item.unit} (รวมในทุนอาหารแล้ว ไม่บวกซ้ำ)`
          : `${item.name} ${item.quantity} ${item.unit} (ส่วนเพิ่ม)` ,
        cents: item.cents,
      })),
      ...(option.box.included
        ? [{ label: `${option.box.label} (รวมในทุนอาหารแล้ว ไม่บวกซ้ำ)`, cents: 0 }]
        : [{ label: option.box.label, cents: option.box.cents }]),
      { label: 'ต้นทุนอาหารและกล่องรวม / คน', cents: option.costPerPersonCents, sub: true },
      { label: `ต้นทุนอาหารและกล่องรวม x ${context.count} กล่อง`, cents: option.evaluation.foodTotalCents, sub: true },
      { label: 'ค่าส่งรวมงาน', cents: context.shipCents },
      ...(context.otherCents ? [{ label: 'ค่าใช้จ่ายอื่นของงาน', cents: context.otherCents }] : []),
      { label: 'ต้นทุนรวมงาน', cents: option.evaluation.totalCostCents, bold: true },
      { label: PROFIT_LABEL, cents: option.evaluation.profitCents, bold: true, profit: true },
    ];
    option.components = [
      ...(option.dish.items.length ? option.dish.items : [option.dish.name]),
      ...option.dish.toppings.map((item) => `${item.name} ${item.quantity} ${item.unit}`),
      option.box.included ? `${option.box.label.replace(' (รวมช้อนส้อม)', '')} (รวมในทุนแล้ว)` : option.box.label.replace(' (รวมช้อนส้อม)', ''),
    ];
  }
  const cap = Number(settings.maxResultsPerGroup) > 0 ? Number(settings.maxResultsPerGroup) : 6;
  const rank = (items) => [...items].sort(compareOptions).slice(0, cap);
  const groups = {
    target: rank(passing.filter((item) => item.evaluation.group === 'target')),
    minimum: rank(passing.filter((item) => item.evaluation.group === 'minimum')),
  };
  const skipped = {
    dishes: skippedDishes,
    dishesUsed: usable.length,
    linkedCount: (Array.isArray(costs.dishes) ? costs.dishes : []).filter((dish) => dish?.menuId !== null && dish?.menuId !== undefined && dish?.menuId !== '').length,
    catalogCount,
    passingCount: passing.length,
  };
  const reasons = groups.target.length || groups.minimum.length
    ? []
    : noPassReasons({ context, usable: passing.length ? passing : usable, skipped: skippedDishes });
  return { ok: true, errors: [], ...base, groups, skipped, reasons };
}
