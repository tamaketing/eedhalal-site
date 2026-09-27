// Owner-only cost editor. Reads and writes the single internal cost source
// (owner-costs.json) through the local loopback server. Never publishes anything.
//
// Owner model: each menu/set ("dishes") carries its own per-person food cost,
// box type, and flags. Nothing is inferred from names and no base cost is
// ever copied into a dish automatically.
const $ = (selector) => document.querySelector(selector);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]);

const KIND_LABEL = { soup: 'ต้ม / น้ำซุป', curry: 'แกง', side: 'กับข้าวเพิ่ม', dessert: 'ขนม' };
const EXTRA_GROUP = { soup: 'soup', curry: 'soup', side: 'side', dessert: 'dessert' };

const state = {
  saved: null, working: null, catalog: [], rowMarks: {}, busy: false, loadOk: false,
  tab: 'dishes', editDish: null, addDishOpen: false, dishFilter: { q: '', status: 'all' },
};
let toppingSequence = 0;

function getPath(object, path) {
  return path.reduce((value, key) => (value == null ? value : value[key]), object);
}
function setPath(object, path, value) {
  let cursor = object;
  for (let index = 0; index < path.length - 1; index += 1) cursor = cursor[path[index]];
  cursor[path[path.length - 1]] = value;
}
const rowKey = (path) => path.join('.');
const clone = (value) => JSON.parse(JSON.stringify(value));
const priceOf = (entry) => (entry?.foodCost ?? entry?.cost);
const isDishPath = (path) => path[0] === 'dishes';

function isDirty() {
  return Boolean(state.saved && state.working) && JSON.stringify(state.working) !== JSON.stringify(state.saved);
}
function rowDirty(row) {
  return JSON.stringify(getPath(state.working, row.path)) !== JSON.stringify(getPath(state.saved, row.path));
}
function confirmed(entry) {
  if (!entry || entry.status !== 'confirmed') return false;
  const value = Number(priceOf(entry));
  return Number.isFinite(value) && value > 0;
}
function recommendable(dish) {
  return confirmed(dish) && dish.enabled !== false && !toppingIssue(dish);
}
function toppingById(id) {
  return (state.working?.toppings || []).find((item) => String(item.id) === String(id)) || null;
}
function toppingIssue(dish) {
  for (const selection of Array.isArray(dish.toppings) ? dish.toppings : []) {
    const item = toppingById(selection.toppingId);
    if (!item) return `ไม่พบรายการ ${selection.toppingId || 'ท็อปปิ้ง'} — ตรวจองค์ประกอบชุด`;
    if (item.enabled === false) return `${item.name} ปิดใช้งาน — ชุดยังไม่พร้อมแนะนำ`;
    if (!confirmed(item)) return `${item.name} รอยืนยันทุน — ชุดยังไม่พร้อมแนะนำ`;
    const amount = Number(selection.quantity);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 1000) return `${item.name} ยังไม่ระบุจำนวนต่อกล่อง`;
  }
  return '';
}
function catalogName(menuId) {
  const found = state.catalog.find((item) => String(item.id) === String(menuId));
  return found ? found.name : null;
}
const DISH_KIND_LABEL = { menu: 'เมนูอาหาร', set: 'ชุดอาหาร', internal: 'ข้อมูลภายใน' };
const dishKind = (dish) => (dish && dish.kind === 'menu') || (dish && dish.kind === 'set') ? dish.kind : 'internal';
function dishById(dishId) {
  return (state.working?.dishes || []).find((item) => String(item.id) === String(dishId)) || null;
}
function memberNames(dish) {
  const ids = Array.isArray(dish?.menuIds) ? dish.menuIds : [];
  if (!ids.length) return '';
  return ids.map((ref) => {
    const menu = dishById(ref);
    return menu ? (menu.publicName || menu.name || ref) : `ไม่พบ (${ref})`;
  }).join(', ');
}
// Public-only payload for website preparation: never cost, notes, or IDs.
function publicPayload(dish) {
  return {
    name: dish.publicName || dish.name || '',
    image: dish.image || '',
    category: dish.category || '',
    description: dish.description || '',
  };
}

// --- rendering ---------------------------------------------------------------

function statsHtml() {
  const dishes = state.working.dishes || [];
  const ready = dishes.filter(recommendable).length;
  const waiting = dishes.length - ready;
  const linked = dishes.filter((dish) => dish.menuId !== null && dish.menuId !== undefined && dish.menuId !== '').length;
  const updated = state.working.updatedAt ? new Date(state.working.updatedAt).toLocaleString('th-TH') : 'ยังไม่เคยบันทึก';
  return `
    <div class="cp-stat"><span>เมนู / ชุดอาหาร</span><b>${dishes.length}</b><small>ผูกเมนูในรายการกลาง ${linked} รายการ</small></div>
    <div class="cp-stat"><span>พร้อมแนะนำ</span><b>${ready}</b><small>ยืนยันทุนครบ + เปิดใช้ — กลุ่มนี้เท่านั้นที่เข้าระบบแนะนำ</small></div>
    <div class="cp-stat"><span>รอยืนยัน / ปิดใช้</span><b>${waiting}</b><small>เว้นว่าง = ยังไม่ทราบทุน ไม่แทนด้วย 0 ไม่ถูกนำไปจัดชุด</small></div>
    <div class="cp-stat"><span>รุ่นข้อมูล</span><b>${esc(state.working.version ?? 0)}</b><small>อัปเดต ${esc(updated)}</small></div>`;
}

function costInput(row, entry, field = 'cost') {
  const value = priceOf(entry) === null || priceOf(entry) === undefined ? '' : priceOf(entry);
  return `<input class="cp-input narrow mono" type="number" inputmode="decimal" min="0.01" step="0.01" placeholder="ยังไม่ระบุ" value="${esc(value)}" data-path='${JSON.stringify(row.path)}' data-field="${field}" aria-label="ราคาทุน">`;
}
function statusCell(row, entry, field = 'cost') {
  const isConfirmed = confirmed(entry);
  const price = field === 'foodCost' ? entry.foodCost : entry.cost;
  const missingPrice = price === null || price === undefined || price === '';
  return `<label class="cp-check"><input type="checkbox" ${isConfirmed ? 'checked' : ''} ${missingPrice ? 'disabled title="กรอกราคาก่อนยืนยัน"' : ''} data-path='${JSON.stringify(row.path)}' data-field="status">ยืนยันราคา</label>`;
}
function rowActions(row) {
  const key = rowKey(row.path);
  const mark = state.rowMarks[key];
  const dirty = rowDirty(row);
  const canDelete = row.path[0] === 'extras' || row.path[0] === 'dishes';
  return `<div class="cp-row-actions">
    ${mark ? `<span class="cp-tag ok">${esc(mark)}</span>` : ''}
    ${dirty ? `<button type="button" class="cp-btn ghost sm" data-action="save">บันทึก</button>` : ''}
    ${canDelete ? `<button type="button" class="cp-btn danger sm" data-action="delete-row" data-path='${JSON.stringify(row.path)}'>ลบ</button>` : ''}
  </div>`;
}

function rowsFor(groupKey) {
  const data = state.working;
  const rows = [];
  if (groupKey === 'dishes') {
    (data.dishes || []).forEach((item, index) => rows.push({ path: ['dishes', index], type: 'dish' }));
  } else if (groupKey === 'toppings') {
    (data.toppings || []).forEach((item, index) => rows.push({ path: ['toppings', index], type: 'topping' }));
  } else if (groupKey === 'fruit') {
    rows.push({ path: [groupKey], type: 'entry' });
  } else if (groupKey === 'packaging') {
    for (const key of Object.keys(data.boxes || {})) rows.push({ path: ['boxes', key], type: 'entry' });
  } else {
    (data.extras || []).forEach((item, index) => {
      if (EXTRA_GROUP[item.kind] === groupKey) rows.push({ path: ['extras', index], type: 'extra' });
    });
  }
  return rows;
}

function entryRowHtml(row, unitFallback) {
  const entry = getPath(state.working, row.path);
  const dirty = rowDirty(row);
  const isConfirmed = confirmed(entry);
  const missingPrice = entry.cost === null || entry.cost === undefined;
  const nameCell = row.type === 'extra' || row.type === 'topping'
    ? `<input class="cp-input" type="text" value="${esc(entry.name)}" data-path='${JSON.stringify(row.path)}' data-field="name" aria-label="ชื่อรายการ">`
    : `<span class="cp-name">${esc(entry.label)}</span>`;
  const unitCell = row.type === 'extra' || row.type === 'topping'
    ? `<input class="cp-input" type="text" value="${esc(entry.unit)}" placeholder="${esc(unitFallback)}" data-path='${JSON.stringify(row.path)}' data-field="unit" aria-label="หน่วยราคา">`
    : `<span class="cp-sub">${esc(unitFallback)}</span>`;
  const idNote = row.type === 'topping' ? `<span class="cp-sub">ID: ${esc(entry.id)}</span>` : '';
  const kindSelect = row.type === 'extra'
    ? `<select class="cp-input cp-kind" data-path='${JSON.stringify(row.path)}' data-field="kind" aria-label="ประเภท">${Object.entries(KIND_LABEL).map(([value, label]) => `<option value="${value}" ${entry.kind === value ? 'selected' : ''}>${esc(label)}</option>`).join('')}</select>`
    : '';
  const enabledControl = row.type === 'topping'
    ? `<label class="cp-check"><input type="checkbox" ${entry.enabled !== false ? 'checked' : ''} data-path='${JSON.stringify(row.path)}' data-field="enabled">เปิดใช้</label>`
    : '';
  return `<tr class="${isConfirmed && entry.enabled !== false ? '' : 'wait '}${dirty ? 'dirty' : ''}" data-row="${esc(rowKey(row.path))}">
    <td>${nameCell}${kindSelect}${idNote}</td>
    <td>${unitCell}</td>
    <td>${costInput(row, entry)}${missingPrice ? '<span class="cp-sub">ยังไม่ระบุราคา</span>' : ''}</td>
    <td>${statusCell(row, entry)}${enabledControl}<span class="cp-sub" data-entry-status>${entry.enabled === false ? 'ปิดใช้งาน' : isConfirmed ? 'ยืนยันแล้ว' : 'รอยืนยัน — ไม่ถูกนำคำนวณ'}</span></td>
    <td><input class="cp-input" type="text" value="${esc(entry.note || '')}" placeholder="ไม่บังคับ" data-path='${JSON.stringify(row.path)}' data-field="note" aria-label="หมายเหตุ"></td>
    <td>${rowActions(row)}</td>
  </tr>`;
}

function boxOptions(selected) {
  const boxes = state.working.boxes || {};
  const options = Object.entries(boxes).map(([key, info]) => {
    const cost = confirmed(info) ? `${info.cost} บาท` : 'รอยืนยันราคากล่อง';
    return `<option value="${esc(key)}" ${key === selected ? 'selected' : ''}>${esc(info.label)} · ${esc(cost)}</option>`;
  }).join('');
  return `<option value="">ยังไม่เลือกกล่อง</option>${options}`;
}

// Pure computation shared by the overview table and the editor summary.
// Same formula as before; dishCostSummary only formats the result.
function computeDishCost(dish) {
  const missing = [];
  const base = confirmed(dish) ? Number(dish.foodCost) : null;
  if (base === null) missing.push('ทุนอาหาร');
  let toppingAdd = 0;
  for (const selection of Array.isArray(dish.toppings) ? dish.toppings : []) {
    const topping = toppingById(selection.toppingId);
    const amount = Number(selection.quantity);
    if (!topping || topping.enabled === false || !confirmed(topping) || !Number.isFinite(amount) || amount <= 0 || amount > 1000) {
      missing.push(topping?.name || 'ท็อปปิ้งที่เลือก');
    } else if (!selection.includedInFoodCost) toppingAdd += amount * Number(topping.cost);
  }
  const box = state.working.boxes?.[dish.box];
  let boxCost = 0;
  if (!dish.box || !box) missing.push('ชนิดกล่อง');
  else if (!dish.includesBox) {
    if (!confirmed(box)) missing.push('ต้นทุนกล่อง');
    else boxCost = Number(box.cost);
  }
  if (missing.length) return { ok: false, missing };
  const total = Math.round((base + toppingAdd + boxCost) * 100) / 100;
  const boxLabel = dish.includesBox ? 'กล่องรวมในทุนอาหาร' : `กล่อง ${formatMoney(boxCost)} บาท`;
  return { ok: true, base, toppingAdd, boxCost, boxLabel, total, missing: [] };
}

function formatMoney(value) {
  return new Intl.NumberFormat('th-TH', { maximumFractionDigits: 2 }).format(value);
}

function dishStatusText(dish) {
  const issue = toppingIssue(dish);
  if (issue) return issue;
  if (recommendable(dish)) return 'พร้อมแนะนำ';
  if (confirmed(dish)) return 'ยืนยันแล้ว · ปิดการใช้แนะนำ';
  return 'รอยืนยัน — ไม่ถูกนำคำนวณ';
}

function dishCostSummary(dish) {
  const result = computeDishCost(dish);
  if (!result.ok) return `ต้นทุนรวมต่อกล่อง: รอยืนยัน (${result.missing.join(' · ')})`;
  return `ต้นทุนรวมต่อกล่อง ${formatMoney(result.total)} บาท = ทุนอาหาร ${formatMoney(result.base)} + ท็อปปิ้งส่วนเพิ่ม ${formatMoney(result.toppingAdd)} + ${result.boxLabel}`;
}

// Short status for the overview table: always text, never color-only.
function dishStatusShort(dish) {
  if (recommendable(dish)) return { tone: 'ok', text: 'พร้อมแนะนำ' };
  const issue = toppingIssue(dish);
  if (issue) return { tone: 'wait', text: issue };
  if (dish.enabled === false) return { tone: 'wait', text: 'ปิดการใช้แนะนำ' };
  if (confirmed(dish)) return { tone: 'wait', text: 'ยืนยันแล้ว · ปิดการใช้แนะนำ' };
  return { tone: 'wait', text: 'รอยืนยันทุน' };
}

function dishBoxLabel(dish) {
  return state.working.boxes?.[dish.box]?.label || 'ยังไม่เลือกกล่อง';
}

// Read-only overview row: name + items summary / box / total per box / status / edit.
// Mobile CSS turns these rows into cards (data-th labels), never a sideways scroll.
function dishOverviewRowHtml(row) {
  const dish = getPath(state.working, row.path);
  const dirty = rowDirty(row);
  const ready = recommendable(dish);
  const status = dishStatusShort(dish);
  const cost = computeDishCost(dish);
  const items = (dish.items || []).join(', ');
  const kind = dishKind(dish);
  const link = dish.menuId !== null && dish.menuId !== undefined && dish.menuId !== ''
    ? `<span class="cp-sub">รหัสเมนู ${esc(dish.menuId)} · ${esc(catalogName(dish.menuId) || 'ไม่อยู่ในรายการกลาง')}</span>`
    : '<span class="cp-sub">ชุดเฉพาะของร้าน (ไม่มีในรายการกลาง)</span>';
  const kindNote = kind === 'menu'
    ? `<span class="cp-sub">${esc(dish.category || 'ยังไม่ระบุหมวด')} · ${dish.image ? 'มีรูปแล้ว' : 'ยังไม่มีรูป'} · ${dish.showOnWebsite ? 'แสดงบนเว็บไซต์' : 'ไม่แสดงบนเว็บ'}</span>`
    : kind === 'set' && memberNames(dish)
      ? `<span class="cp-sub" data-overview-members>ประกอบจาก: ${esc(memberNames(dish))}</span>`
      : kind === 'set'
        ? '<span class="cp-sub" data-overview-members>ยังไม่เลือกเมนูในชุด</span>'
        : '<span class="cp-sub">รอเจ้าของเลือกประเภท (เมนู/ชุด)</span>';
  const totalCell = cost.ok
    ? `<div class="cp-total">${esc(formatMoney(cost.total))} <small>บาท/กล่อง</small></div>`
    : `<div class="cp-total incomplete">ยังไม่ครบ<span class="cp-reason">${esc(cost.missing.join(' · '))}</span></div>`;
  return `<tr class="${ready ? '' : 'wait '}${dirty ? 'dirty' : ''}" data-overview-row='${JSON.stringify(row.path)}'>
    <td data-th="ชื่อชุด"><span class="cp-kind-tag kind-${kind}">${esc(DISH_KIND_LABEL[kind])}</span> <span class="cp-name">${esc(dish.name) || 'ยังไม่มีชื่อ'}</span>${items ? `<span class="cp-sub">${esc(items)}</span>` : ''}${kindNote}${link}</td>
    <td data-th="กล่อง">${esc(dishBoxLabel(dish))}${dish.includesBox ? '<span class="cp-sub">รวมในทุนอาหารแล้ว</span>' : ''}</td>
    <td data-th="ต้นทุนรวม" class="ta-right">${totalCell}</td>
    <td data-th="สถานะ"><span class="cp-tag ${status.tone}">${esc(status.text)}</span></td>
    <td data-th="แก้ไข"><div class="cp-row-actions"><button type="button" class="cp-btn ghost sm" data-action="edit-dish" data-path='${JSON.stringify(row.path)}'>แก้ไข</button></div></td>
  </tr>`;
}

function dishesSummaryHtml() {
  const dishes = state.working.dishes || [];
  const ready = dishes.filter(recommendable).length;
  const menus = dishes.filter((dish) => dishKind(dish) === 'menu');
  const sets = dishes.filter((dish) => dishKind(dish) === 'set');
  const internal = dishes.length - menus.length - sets.length;
  const onWeb = menus.filter((dish) => dish.showOnWebsite).length;
  const updated = state.working.updatedAt ? new Date(state.working.updatedAt).toLocaleString('th-TH') : 'ยังไม่เคยบันทึก';
  return `<div class="cp-dish-summary" id="dish-summary">
      <div><b>${menus.length}</b><span>เมนูอาหาร${onWeb ? ` · แสดงบนเว็บ ${onWeb}` : ''}</span></div>
      <div><b>${sets.length}</b><span>ชุดอาหารแอดมิน</span></div>
      <div><b>${internal}</b><span>รอจัดประเภท</span></div>
      <div><b>${ready}</b><span>พร้อมแนะนำ</span></div>
    </div>
    <p class="cp-version">รุ่นข้อมูล ${esc(state.working.version ?? 0)} · อัปเดต ${esc(updated)}</p>`;
}

function tabsHtml() {
  const dishes = state.working.dishes || [];
  const toppings = state.working.toppings || [];
  const more = Object.keys(state.working.groupMeta || {}).filter((key) => key !== 'dishes' && key !== 'toppings')
    .reduce((count, key) => count + rowsFor(key).length, 0);
  const tabs = [
    ['dishes', 'เมนูและชุดอาหาร', dishes.length],
    ['toppings', 'ไข่และท็อปปิ้ง', toppings.length],
    ['more', 'กล่องและส่วนเพิ่ม', more],
  ];
  return `<div class="cp-tabs" role="tablist" aria-label="กลุ่มข้อมูลต้นทุน">${tabs.map(([key, label, count]) => `
    <button type="button" role="tab" class="cp-tab" aria-selected="${state.tab === key ? 'true' : 'false'}" data-action="tab" data-tab="${key}">${esc(label)} <span class="cp-tab-count">(${count})</span></button>`).join('')}
  </div>`;
}

// Inner content of the dish topping block, reused by the editor.
// Logic identical to the previous inline composition rows.
function dishToppingsInner(row) {
  const dish = getPath(state.working, row.path);
  const picks = Array.isArray(dish.toppings) ? dish.toppings : [];
  const picked = new Set(picks.map((item) => String(item.toppingId)));
  const available = (state.working.toppings || []).filter((item) => item.enabled !== false && !picked.has(String(item.id)));
  const lines = picks.map((selection, index) => {
    const topping = toppingById(selection.toppingId);
    const label = topping ? `${topping.name} · ${topping.unit} · ${confirmed(topping) ? `${topping.cost} บาท/หน่วย` : 'รอยืนยันทุน'}` : `ไม่พบรายการ (${selection.toppingId})`;
    return `<div class="cp-dish-topping" data-dish-topping-row="${index}">
      <span class="cp-dish-topping-name">${esc(label)}</span>
      <label class="cp-field">จำนวน / กล่อง<input class="cp-input cp-qty" type="number" inputmode="decimal" min="0.001" max="1000" step="0.001" value="${esc(selection.quantity)}" data-dish-path='${JSON.stringify(row.path)}' data-dish-index="${index}" data-dish-field="quantity"></label>
      <label class="cp-check"><input type="checkbox" ${selection.includedInFoodCost ? 'checked' : ''} data-dish-path='${JSON.stringify(row.path)}' data-dish-index="${index}" data-dish-field="includedInFoodCost">รวมอยู่ในทุนอาหารที่กรอกแล้ว — ไม่บวกซ้ำ</label>
      <button type="button" class="cp-btn danger sm" data-action="remove-dish-topping" data-path='${JSON.stringify(row.path)}' data-index="${index}">เอาออก</button>
    </div>`;
  }).join('');
  const options = available.map((item) => `<option value="${esc(item.id)}">${esc(item.name)} · ${esc(item.unit)} · ${confirmed(item) ? `${esc(item.cost)} บาท/หน่วย` : 'รอยืนยัน'}</option>`).join('');
  const activeCount = (state.working.toppings || []).filter((item) => item.enabled !== false).length;
  const add = available.length
    ? `<div class="cp-dish-topping-add"><label class="cp-field">เพิ่มไข่หรือท็อปปิ้ง<select class="cp-input" data-dish-add-select='${JSON.stringify(row.path)}'><option value="" selected>เลือกรายการก่อน</option>${options}</select></label><button type="button" class="cp-btn ghost sm" data-action="add-dish-topping" data-path='${JSON.stringify(row.path)}'>+ เพิ่มในชุดนี้</button></div>`
    : `<p class="cp-sub">${activeCount ? 'เลือกรายการที่เปิดใช้งานครบแล้ว' : 'ไม่มีรายการที่เปิดใช้ — เปิดแท็บ “ไข่และท็อปปิ้ง” เพื่อเพิ่มหรือเปิดใช้รายการ'}</p>`;
  return `<strong>ไข่และท็อปปิ้งในชุดนี้</strong>
    <p class="cp-sub">เลือกรายการและจำนวนต่อกล่องให้ตรงชุดที่เจ้าของจัด · ค่าเริ่มต้นถือเป็นส่วนเพิ่มจากทุนอาหาร · ติ๊ก “รวมอยู่ในทุนอาหารแล้ว” หากรวมไว้ในยอดทุนอาหารด้านบน เพื่อไม่บวกซ้ำ · รายการรอยืนยันหรือปิดใช้จะกันชุดนี้ออกจากคำแนะนำ</p>
    <p class="cp-cost-summary">${esc(dishCostSummary(dish))}</p>
    ${lines || '<p class="cp-sub">ชุดนี้ยังไม่มีไข่หรือท็อปปิ้ง</p>'}${add}`;
}

// Preview of the public-only payload: name/image/category/description.
// Cost, notes, and IDs never appear here.
function publicPreviewHtml(dish) {
  const payload = publicPayload(dish);
  const shownName = payload.name || 'ยังไม่มีชื่อสาธารณะ';
  return `<div class="cp-public-preview" aria-label="ตัวอย่างข้อมูลสาธารณะ">
    <strong>ตัวอย่างข้อมูลสาธารณะ</strong>
    <p class="cp-sub">เฉพาะชื่อ รูป หมวด และคำอธิบาย — ไม่รวมทุน หมายเหตุภายใน หรือรหัสใด ๆ</p>
    <div class="cp-public-name">${esc(shownName)}</div>
    <p class="cp-sub">${esc(payload.category || 'ยังไม่ระบุหมวด')} · ${payload.image ? `รูป: ${esc(payload.image)}` : 'ยังไม่มีรูป'}</p>
    <p>${esc(payload.description || 'ยังไม่มีคำอธิบายสำหรับลูกค้า')}</p>
  </div>`;
}

function membersPickerHtml(row) {
  const dish = getPath(state.working, row.path);
  const picked = new Set(Array.isArray(dish.menuIds) ? dish.menuIds.map(String) : []);
  const menus = (state.working.dishes || []).filter((item) => dishKind(item) === 'menu');
  if (!menus.length) return '<p class="cp-sub">ยังไม่มีเมนูอาหาร — เปลี่ยนประเภทของรายการอื่นเป็น “เมนูอาหาร” ก่อน แล้วค่อยมาเลือกที่นี่</p>';
  return `<div class="cp-members">${menus.map((menu) => `
    <label class="cp-check"><input type="checkbox" ${picked.has(String(menu.id)) ? 'checked' : ''} data-path='${JSON.stringify(row.path)}' data-member-id="${esc(menu.id)}">${esc(menu.publicName || menu.name || menu.id)}</label>`).join('')}
  </div>`;
}

// Single editor panel: opens only via + เพิ่มชุดอาหาร or แก้ไข, one at a time.
// Field order: ชื่อชุด → รายการอาหาร → ทุนอาหาร → ท็อปปิ้ง → กล่อง → สรุป → ยืนยัน.
function dishEditorHtml(row) {
  const dish = getPath(state.working, row.path);
  const key = rowKey(row.path);
  const dirty = rowDirty(row);
  const kind = dishKind(dish);
  const missingPrice = dish.foodCost === null || dish.foodCost === undefined || dish.foodCost === '';
  const link = dish.menuId !== null && dish.menuId !== undefined && dish.menuId !== ''
    ? `<span class="cp-sub">รหัสเมนู ${esc(dish.menuId)} · ${esc(catalogName(dish.menuId) || 'ไม่อยู่ในรายการกลาง')}</span>`
    : '<span class="cp-sub">ชุดเฉพาะของร้าน (ไม่มีในรายการกลาง)</span>';
  const kindRadios = `<div class="cp-editor-sec" aria-label="ประเภทรายการ">
    <h4>ประเภท</h4>
    <div class="cp-radios">
      <label class="cp-check"><input type="radio" name="kind-${esc(key)}" value="menu" ${kind === 'menu' ? 'checked' : ''} data-path='${JSON.stringify(row.path)}' data-field="kind">เมนูอาหาร</label>
      <label class="cp-check"><input type="radio" name="kind-${esc(key)}" value="set" ${kind === 'set' ? 'checked' : ''} data-path='${JSON.stringify(row.path)}' data-field="kind">ชุดอาหาร (แอดมิน)</label>
      <label class="cp-check"><input type="radio" name="kind-${esc(key)}" value="internal" ${kind === 'internal' ? 'checked' : ''} data-path='${JSON.stringify(row.path)}' data-field="kind">ข้อมูลภายใน (รอจัดประเภท)</label>
    </div>
  </div>`;
  const menuSection = kind === 'menu' ? `<div class="cp-editor-sec" aria-label="ข้อมูลสาธารณะของเมนู">
    <h4>ข้อมูลสำหรับลูกค้า</h4>
    <div class="cp-editor-grid">
      <label class="cp-field">ชื่อแสดงบนเว็บ (ไม่บังคับ ใช้ชื่อชุดถ้าเว้นว่าง)<input class="cp-input" type="text" value="${esc(dish.publicName || '')}" data-path='${JSON.stringify(row.path)}' data-field="publicName" aria-label="ชื่อแสดงบนเว็บ"></label>
      <label class="cp-field">รูป (พาธหรือ URL)<input class="cp-input" type="text" value="${esc(dish.image || '')}" placeholder="เช่น img/menu-15.jpg" data-path='${JSON.stringify(row.path)}' data-field="image" aria-label="รูปเมนู"></label>
      <label class="cp-field">หมวด<input class="cp-input" type="text" value="${esc(dish.category || '')}" placeholder="เช่น ข้าวหมก" data-path='${JSON.stringify(row.path)}' data-field="category" aria-label="หมวดเมนู"></label>
      <label class="cp-field full">คำอธิบายสำหรับลูกค้า<textarea class="cp-input" rows="2" data-path='${JSON.stringify(row.path)}' data-field="description" aria-label="คำอธิบายสำหรับลูกค้า">${esc(dish.description || '')}</textarea></label>
    </div>
    <label class="cp-check"><input type="checkbox" ${dish.showOnWebsite ? 'checked' : ''} data-path='${JSON.stringify(row.path)}' data-field="showOnWebsite">แสดงบนเว็บไซต์ (เตรียมเผยแพร่ชื่อและรูปนี้)</label>
    ${publicPreviewHtml(dish)}
    <div><button type="button" class="cp-btn ghost sm" data-action="copy-public" data-path='${JSON.stringify(row.path)}'>คัดลอกข้อมูลสาธารณะ (JSON)</button></div>
  </div>` : '';
  const setSection = kind === 'set' ? `<div class="cp-editor-sec" aria-label="เมนูในชุด">
    <h4>เมนูในชุด (เลือกจากรายการเมนูอาหาร)</h4>
    ${membersPickerHtml(row)}
    <p class="cp-sub">ชุดเป็นเครื่องมือแอดมินเท่านั้น ไม่มีตัวเลือกเผยแพร่บนเว็บ ชื่อและรูปเมนูอ้างอิงผ่านรหัสเดิม ไม่ต้องกรอกซ้ำ</p>
  </div>` : '';
  return `<section class="cp-editor" data-editor="${esc(key)}" aria-label="แก้ไขชุดอาหาร">
    <div class="cp-editor-head">
      <h3>แก้ไข: ${esc(dish.name) || 'ชุดอาหาร'}</h3>
      ${dirty ? '<span class="cp-editor-flag">มีการแก้ไขยังไม่บันทึก</span>' : ''}
      <button type="button" class="cp-btn ghost sm" data-action="close-editor">ปิด</button>
    </div>
    <div class="cp-editor-body">
      ${kindRadios}
      <div class="cp-editor-grid">
        <label class="cp-field">ชื่อชุด<input class="cp-input" type="text" value="${esc(dish.name)}" data-path='${JSON.stringify(row.path)}' data-field="name" aria-label="ชื่อชุด">${link}</label>
        <label class="cp-field">รายการอาหารในชุด (คั่นด้วยจุลภาค)<input class="cp-input" type="text" value="${esc((dish.items || []).join(', '))}" placeholder="เช่น ข้าวคลุกกะปิ, ไข่ต้ม" data-path='${JSON.stringify(row.path)}' data-field="items" aria-label="รายการอาหารที่รวมในชุด"></label>
        <label class="cp-field">ทุนอาหาร / ต่อกล่อง (บาท)<input class="cp-input mono" type="number" inputmode="decimal" min="0.01" step="0.01" placeholder="ยังไม่ระบุ" value="${esc(missingPrice ? '' : dish.foodCost)}" data-path='${JSON.stringify(row.path)}' data-field="foodCost" aria-label="ทุนอาหารต่อกล่อง">${missingPrice ? '<span class="cp-sub">เว้นว่าง = ยังไม่ทราบทุน ไม่ใช้ 0 แทน</span>' : ''}</label>
        <label class="cp-check"><input type="checkbox" ${dish.includesBox ? 'checked' : ''} data-path='${JSON.stringify(row.path)}' data-field="includesBox">ทุนนี้รวมค่ากล่องแล้ว</label>
      </div>
      <div class="cp-editor-sec" aria-label="ไข่และท็อปปิ้ง">${dishToppingsInner(row)}</div>
      ${menuSection}
      ${setSection}
      <div class="cp-editor-sec" aria-label="กล่อง">
        <h4>กล่อง</h4>
        <label class="cp-field">ชนิดกล่อง<select class="cp-input" data-path='${JSON.stringify(row.path)}' data-field="box" aria-label="ชนิดกล่อง">${boxOptions(dish.box)}</select></label>
      </div>
      <div class="cp-editor-sec" aria-label="ยืนยัน">
        <h4>ยืนยัน</h4>
        <label class="cp-check"><input type="checkbox" ${dish.status === 'confirmed' && confirmed(dish) ? 'checked' : ''} ${missingPrice ? 'disabled title="กรอกทุนอาหารก่อนยืนยัน"' : ''} data-path='${JSON.stringify(row.path)}' data-field="status">ยืนยันต้นทุน — ตรวจแล้วว่าทุนครบถูกต้อง</label>
        <label class="cp-check"><input type="checkbox" ${dish.enabled !== false ? 'checked' : ''} data-path='${JSON.stringify(row.path)}' data-field="enabled">ใช้แนะนำ — ให้ระบบเลือกชุดนี้ตามงบลูกค้า</label>
        <span class="cp-sub" data-dish-status>${esc(dishStatusText(dish))}</span>
        <label class="cp-field">หมายเหตุ (ไม่บังคับ)<input class="cp-input" type="text" value="${esc(dish.note || '')}" placeholder="ไม่บังคับ" data-path='${JSON.stringify(row.path)}' data-field="note" aria-label="หมายเหตุ"></label>
      </div>
      <div class="cp-errors" data-editor-errors hidden></div>
      <div class="cp-editor-actions">
        <button type="button" class="cp-btn" data-action="save">บันทึกการเปลี่ยนแปลง</button>
        <button type="button" class="cp-btn ghost" data-action="revert-row" data-path='${JSON.stringify(row.path)}'>ยกเลิกการแก้ไข</button>
        <span class="spacer"></span>
        <button type="button" class="cp-btn danger sm" data-action="delete-row" data-path='${JSON.stringify(row.path)}'>ลบชุดนี้</button>
      </div>
      <p class="cp-sub">ปิดฟอร์มได้โดยค่าที่แก้ไว้ไม่หาย (ยังค้างเป็น “ยังไม่บันทึก” จนกว่าจะกดบันทึก) · “ยกเลิกการแก้ไข” จะทิ้งค่าที่แก้ในชุดนี้กลับเป็นค่าที่บันทึกไว้</p>
    </div>
  </section>`;
}

function dishSectionHtml(kind, title, hint, rows) {
  const body = rows.length
    ? rows.map((row) => dishOverviewRowHtml(row)).join('')
    : `<tr><td class="cp-empty">${hint}</td></tr>`;
  return `<section class="cp-part" aria-label="${esc(title)}">
    <div class="cp-part-head"><h3>${esc(title)}</h3><span class="cp-tag ${rows.length ? 'ok' : 'wait'}">${rows.length} รายการ</span></div>
    <div class="cp-table-wrap"><table class="cp-table cp-overview">
      <thead><tr><th>ชื่อชุดและรายการ</th><th>กล่อง</th><th class="ta-right">ต้นทุนรวมต่อกล่อง</th><th>สถานะ</th><th><span class="cp-sub">แก้ไข</span></th></tr></thead>
      <tbody>${body}</tbody>
    </table></div>
  </section>`;
}

function dishesPanelHtml() {
  const rows = rowsFor('dishes');
  const byKind = (kind) => rows.filter((row) => dishKind(getPath(state.working, row.path)) === kind);
  const editor = state.editDish === null ? '' : (() => {
    const row = { path: ['dishes', state.editDish] };
    return getPath(state.working, row.path) ? dishEditorHtml(row) : '';
  })();
  const addForm = state.addDishOpen ? dishAddHtml() : '';
  return `<div data-tab-panel="dishes">
    ${dishesSummaryHtml()}
    <div class="cp-toolbar">
      <label class="cp-search">ค้นหาชื่อชุด<input class="cp-input" type="search" id="dish-search" value="${esc(state.dishFilter.q)}" placeholder="พิมพ์ชื่อชุดหรือรายการอาหาร" aria-label="ค้นหาชื่อชุด"></label>
      <label class="cp-field">สถานะ<select class="cp-input" id="dish-status-filter" aria-label="กรองตามสถานะ">
        <option value="all"${state.dishFilter.status === 'all' ? ' selected' : ''}>ทุกสถานะ</option>
        <option value="ready"${state.dishFilter.status === 'ready' ? ' selected' : ''}>พร้อมแนะนำ</option>
        <option value="waiting"${state.dishFilter.status === 'waiting' ? ' selected' : ''}>รอยืนยัน</option>
      </select></label>
      <button type="button" class="cp-btn" data-action="add-dish-open">${state.addDishOpen ? 'ซ่อนฟอร์ม' : '+ เพิ่มชุดอาหาร'}</button>
    </div>
    ${dishSectionHtml('menu', 'เมนูอาหาร', 'ยังไม่มีเมนูอาหาร — เพิ่มแล้วเลือกประเภท “เมนูอาหาร” ชื่อและรูปที่ติ๊ก “แสดงบนเว็บไซต์” จะใช้เตรียมเผยแพร่', byKind('menu'))}
    ${dishSectionHtml('set', 'จัดชุดอาหารสำหรับแอดมิน', 'ยังไม่มีชุดอาหาร — เพิ่มแล้วเลือกประเภท “ชุดอาหาร” ชุดเป็นเครื่องมือแอดมินเท่านั้น ไม่เผยแพร่บนเว็บ', byKind('set'))}
    ${dishSectionHtml('internal', 'รอจัดประเภท (ข้อมูลภายใน)', 'ไม่มีรายการค้างจัดประเภท', byKind('internal'))}
    ${editor}
    ${addForm}
  </div>`;
}

// Non-dish groups keep their existing tables; only wrapped per tab.
function groupSectionHtml(groupKey, meta) {
  const rows = rowsFor(groupKey);
  const waiting = rows.filter((row) => !confirmed(getPath(state.working, row.path))).length;
  const body = rows.length
    ? rows.map((row) => entryRowHtml(row, meta.unit)).join('')
    : '<tr><td colspan="6" class="cp-empty">ยังไม่มีรายการในกลุ่มนี้</td></tr>';
  const addRow = groupKey === 'toppings' ? toppingAddHtml()
    : (groupKey === 'side' || groupKey === 'soup' || groupKey === 'dessert') ? extraAddHtml(groupKey) : '';
  return `<section class="cp-card cp-group" aria-label="${esc(meta.title)}">
    <div class="cp-group-head">
      <div>
        <h3>${esc(meta.title)}</h3>
        <p class="cp-group-meta">${esc(meta.note || '')}${meta.note ? ' · ' : ''}<b>รวม:</b> ${esc(meta.includes)} · <b>ไม่รวม:</b> ${esc(meta.excludes)}</p>
      </div>
      <span class="cp-tag ${waiting ? 'wait' : 'ok'}">${rows.length} รายการ · รอยืนยัน ${waiting}</span>
    </div>
    <div class="cp-table-wrap"><table class="cp-table">
      <thead><tr><th>รายการ</th><th>หน่วยราคา</th><th>ราคาทุน</th><th>สถานะ</th><th>หมายเหตุ</th><th class="ta-right">จัดการ</th></tr></thead>
      <tbody>${body}</tbody>
    </table></div>
    ${addRow}
  </section>`;
}

function renderGroups() {
  const data = state.working;
  const meta = data.groupMeta || {};
  const moreKeys = Object.keys(meta).filter((key) => key !== 'dishes' && key !== 'toppings');
  const html = `${tabsHtml()}
    <div data-tab-panel="dishes"${state.tab === 'dishes' ? '' : ' hidden'}>${dishesPanelHtml()}</div>
    <div data-tab-panel="toppings"${state.tab === 'toppings' ? '' : ' hidden'}>${meta.toppings ? groupSectionHtml('toppings', meta.toppings) : ''}</div>
    <div data-tab-panel="more"${state.tab === 'more' ? '' : ' hidden'}>${moreKeys.map((key) => groupSectionHtml(key, meta[key])).join('')}</div>`;
  $('#groups').innerHTML = html;
  applyDishFilter();
}

// Tab switching only toggles visibility: values being edited are never rebuilt.
function applyTab() {
  document.querySelectorAll('[data-tab-panel]').forEach((panel) => {
    panel.hidden = panel.dataset.tabPanel !== state.tab;
  });
  document.querySelectorAll('[data-action="tab"]').forEach((button) => {
    button.setAttribute('aria-selected', button.dataset.tab === state.tab ? 'true' : 'false');
  });
}

function dishMatchesFilter(dish) {
  const query = state.dishFilter.q.trim().toLowerCase();
  if (query) {
    const haystack = `${dish.name || ''} ${dish.publicName || ''} ${dish.category || ''} ${(dish.items || []).join(' ')} ${DISH_KIND_LABEL[dishKind(dish)] || ''} ${memberNames(dish)}`.toLowerCase();
    if (!haystack.includes(query)) return false;
  }
  if (state.dishFilter.status === 'ready') return recommendable(dish);
  if (state.dishFilter.status === 'waiting') return !recommendable(dish);
  return true;
}

function applyDishFilter() {
  document.querySelectorAll('[data-overview-row]').forEach((tr) => {
    const dish = getPath(state.working, JSON.parse(tr.dataset.overviewRow));
    tr.hidden = dish ? !dishMatchesFilter(dish) : false;
  });
  document.querySelectorAll('.cp-part').forEach((part) => {
    const visible = [...part.querySelectorAll('[data-overview-row]')].some((tr) => !tr.hidden);
    part.hidden = !visible;
  });
}

function extraAddHtml(groupKey) {
  return `<div class="cp-add-row">
    <label class="cp-field">ชื่อรายการ<input class="cp-input" type="text" data-add="name" placeholder="เช่น ต้มข่าไก่"></label>
    <label class="cp-field">หน่วยราคา<input class="cp-input" type="text" data-add="unit" placeholder="ถ้วยต่อคน"></label>
    <label class="cp-field">ราคาทุน (บาท)<input class="cp-input narrow" type="number" inputmode="decimal" min="0.01" step="0.01" data-add="cost" placeholder="เว้นว่าง = รอยืนยัน"></label>
    <label class="cp-check"><input type="checkbox" data-add="status">ยืนยันราคา</label>
    <button type="button" class="cp-btn ghost sm" data-action="add-extra" data-group="${esc(groupKey)}">+ เพิ่มรายการ</button>
    <span class="cp-sub" data-add="msg"></span>
  </div>`;
}

function toppingAddHtml() {
  return `<div class="cp-add-row cp-topping-add">
    <label class="cp-field">ชื่อไข่หรือท็อปปิ้ง<input class="cp-input" type="text" data-add-topping="name" placeholder="เช่น ไข่ดาว"></label>
    <label class="cp-field">หน่วยนับ<input class="cp-input" type="text" data-add-topping="unit" placeholder="ฟอง"></label>
    <label class="cp-field">ต้นทุนต่อหน่วย (บาท)<input class="cp-input narrow" type="number" inputmode="decimal" min="0.01" step="0.01" data-add-topping="cost" placeholder="เว้นว่าง = รอยืนยัน"></label>
    <label class="cp-check"><input type="checkbox" data-add-topping="status">ยืนยันทุน</label>
    <button type="button" class="cp-btn ghost sm" data-action="add-topping">+ เพิ่มรายการ</button>
    <span class="cp-sub" data-add-topping="msg"></span>
  </div>`;
}

function dishAddHtml() {
  const linkedIds = new Set((state.working.dishes || []).map((dish) => String(dish.menuId ?? '')).filter(Boolean));
  const available = state.catalog.filter((item) => !linkedIds.has(String(item.id)));
  const boxSelect = `<select class="cp-input" data-add-dish="box"><option value="">ยังไม่เลือกกล่อง</option>${Object.entries(state.working.boxes || {}).map(([key, info]) => `<option value="${esc(key)}">${esc(info.label)}</option>`).join('')}</select>`;
  return `<div class="cp-add-row" id="dish-add">
    <div class="cp-field">ประเภท<label class="cp-check"><input type="radio" name="dish-kind-add" value="menu" data-add-dish="kind">เมนูอาหาร</label><label class="cp-check"><input type="radio" name="dish-kind-add" value="set" data-add-dish="kind">ชุดอาหาร (แอดมิน)</label><label class="cp-check"><input type="radio" name="dish-kind-add" value="internal" data-add-dish="kind" checked>ข้อมูลภายใน (รอจัดประเภท)</label></div>
    <label class="cp-field">ชื่อเมนู / ชุด<input class="cp-input" type="text" data-add-dish="name" placeholder="เช่น ชุดประชุมเช้า"></label>
    <label class="cp-field">ผูกเมนูในรายการกลาง (ไม่บังคับ)<select class="cp-input" data-add-dish="menuId"><option value="">ไม่ผูก — ชุดเฉพาะของร้าน</option>${available.map((item) => `<option value="${esc(item.id)}">${esc(item.name)} (${esc(item.id)})</option>`).join('')}</select></label>
    <label class="cp-field">รายการอาหารในชุด (คั่นด้วยจุลภาค)<input class="cp-input" type="text" data-add-dish="items" placeholder="เช่น ข้าวคลุกกะปิ, ไข่ต้ม"></label>
    <label class="cp-field">ต้นทุนอาหาร / ชุดต่อคน (บาท)<input class="cp-input narrow" type="number" inputmode="decimal" min="0.01" step="0.01" data-add-dish="foodCost" placeholder="เว้นว่าง = รอยืนยัน"></label>
    <label class="cp-field">ชนิดกล่อง${boxSelect}</label>
    <label class="cp-check"><input type="checkbox" data-add-dish="includesBox">ทุนที่กรอกรวมกล่องแล้ว</label>
    <label class="cp-check"><input type="checkbox" data-add-dish="status">ยืนยันทุน</label>
    <label class="cp-check"><input type="checkbox" data-add-dish="enabled" checked>ใช้แนะนำ</label>
    <button type="button" class="cp-btn ghost sm" data-action="dish-add">+ เพิ่มเมนู/ชุด</button>
    <span class="cp-sub" data-add-dish="msg"></span>
  </div>`;
}

function renderAll() {
  $('#stats').innerHTML = statsHtml();
  renderGroups();
  updateSaveButton();
}

function updateSaveButton() {
  const dirty = isDirty();
  $('#save-all').disabled = !dirty || state.busy || !state.loadOk;
  if (dirty && !state.busy && !$('#save-status').classList.contains('bad')) setStatus('มีการแก้ไขยังไม่บันทึก', 'warn');
  if (!dirty && $('#save-status').classList.contains('warn')) $('#save-status').classList.remove('show', 'warn');
}

function setStatus(text, tone = '') {
  const pill = $('#save-status');
  pill.textContent = text;
  pill.className = `cp-save show${tone ? ` ${tone}` : ''}`;
}
function clearStatus() {
  $('#form-status').textContent = '';
  $('#form-status').className = 'cp-form-status';
  $('#save-errors').hidden = true;
  const editorBox = document.querySelector('[data-editor-errors]');
  if (editorBox) editorBox.hidden = true;
}

// --- editing -----------------------------------------------------------------

function parsePriceInput(raw) {
  const text = String(raw ?? '').trim();
  if (text === '') return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : text;
}

function onFieldEdit(target) {
  const path = JSON.parse(target.dataset.path);
  const field = target.dataset.field;
  const entry = getPath(state.working, path);
  if (!entry) return;
  const priceField = isDishPath(path) ? 'foodCost' : 'cost';
  if (field === 'status') {
    entry.status = target.checked ? 'confirmed' : 'pending';
    const price = priceField === 'foodCost' ? entry.foodCost : entry.cost;
    if (target.checked && (price === null || price === undefined || price === '')) {
      // Never confirm an item without a price.
      target.checked = false;
      entry.status = 'pending';
      setStatus('ต้องกรอกราคาก่อนกดยืนยัน', 'bad');
      return;
    }
  } else if (field === 'cost' || field === 'foodCost') {
    entry[field] = parsePriceInput(target.value);
    if (entry[field] === null && entry.status === 'confirmed') {
      // Clearing the price drops the row back to "waiting" instead of keeping a confirmed zero.
      entry.status = 'pending';
    }
  } else if (field === 'items') {
    entry.items = String(target.value).split(/[,،\n]/).map((item) => item.trim()).filter(Boolean);
  } else if (field === 'includesBox' || field === 'enabled' || field === 'showOnWebsite') {
    entry[field] = target.checked;
  } else if (field === 'kind') {
    changeDishKind(path, target.value);
    return;
  } else {
    entry[field] = target.value;
  }
  delete state.rowMarks[rowKey(path)];
  if (isDishPath(path)) refreshDishRow(path);
  else refreshRow(path);
  $('#stats').innerHTML = statsHtml();
  clearStatus();
  $('#save-status').textContent = 'มีการแก้ไขยังไม่บันทึก';
  $('#save-status').className = 'cp-save show warn';
  $('#save-all').disabled = false;
}

function syncRowStatusCheckbox(tr, entry, priceField) {
  const checkbox = tr.querySelector('[data-field="status"]');
  if (checkbox) {
    checkbox.checked = entry.status === 'confirmed' && confirmed(entry);
    checkbox.disabled = entry[priceField] === null || entry[priceField] === undefined || entry[priceField] === '';
  }
}

function refreshRow(path) {
  const key = rowKey(path);
  const tr = document.querySelector(`[data-row="${CSS.escape(key)}"]`);
  if (!tr) return;
  const row = { path };
  const dirty = rowDirty(row);
  tr.classList.toggle('dirty', dirty);
  const entry = getPath(state.working, path);
  tr.classList.toggle('wait', !confirmed(entry) || entry.enabled === false);
  const actions = tr.querySelector('.cp-row-actions');
  if (actions) actions.innerHTML = rowActions({ path });
  syncRowStatusCheckbox(tr, entry, 'cost');
  const enabled = tr.querySelector('[data-field="enabled"]');
  if (enabled) enabled.checked = entry.enabled !== false;
  const statusText = tr.querySelector('[data-entry-status]');
  if (statusText) statusText.textContent = entry.enabled === false ? 'ปิดใช้งาน' : confirmed(entry) ? 'ยืนยันแล้ว' : 'รอยืนยัน — ไม่ถูกนำคำนวณ';
  if (path[0] === 'toppings') {
    (state.working.dishes || []).forEach((_, index) => refreshDishRow(['dishes', index]));
  }
}

function refreshDishRow(path) {
  const key = rowKey(path);
  const dish = getPath(state.working, path);
  if (!dish) return;
  const dirty = rowDirty({ path });
  const ready = recommendable(dish);
  // Overview row: status tag, total, box label stay fresh without a full re-render.
  const overview = document.querySelector(`[data-overview-row="${CSS.escape(key)}"]`);
  if (overview) {
    overview.classList.toggle('wait', !ready);
    overview.classList.toggle('dirty', dirty);
    const status = dishStatusShort(dish);
    const tag = overview.querySelector('.cp-tag');
    if (tag) {
      tag.className = `cp-tag ${status.tone}`;
      tag.textContent = status.text;
    }
    const cost = computeDishCost(dish);
    const total = overview.querySelector('.cp-total');
    if (total) {
      if (cost.ok) {
        total.classList.remove('incomplete');
        total.innerHTML = `${esc(formatMoney(cost.total))} <small>บาท/กล่อง</small>`;
      } else {
        total.classList.add('incomplete');
        total.innerHTML = `ยังไม่ครบ<span class="cp-reason">${esc(cost.missing.join(' · '))}</span>`;
      }
    }
    const members = overview.querySelector('[data-overview-members]');
    if (members) {
      const names = memberNames(dish);
      members.textContent = names ? `ประกอบจาก: ${names}` : 'ยังไม่เลือกเมนูในชุด';
    }
  }
  // Open editor: dirty flag, summary, status line, checkbox states.
  const editor = document.querySelector(`[data-editor="${CSS.escape(key)}"]`);
  if (editor) {
    const flag = editor.querySelector('.cp-editor-flag');
    if (flag) flag.hidden = !dirty;
    else if (dirty) editor.querySelector('.cp-editor-head h3')?.insertAdjacentHTML('afterend', '<span class="cp-editor-flag">มีการแก้ไขยังไม่บันทึก</span>');
    const summary = editor.querySelector('.cp-cost-summary');
    if (summary) summary.textContent = dishCostSummary(dish);
    const statusText = editor.querySelector('[data-dish-status]');
    if (statusText) statusText.textContent = dishStatusText(dish);
    const statusBox = editor.querySelector('[data-field="status"]');
    if (statusBox) {
      statusBox.checked = dish.status === 'confirmed' && confirmed(dish);
      statusBox.disabled = dish.foodCost === null || dish.foodCost === undefined || dish.foodCost === '';
    }
    const enabledBox = editor.querySelector('[data-field="enabled"]');
    if (enabledBox) enabledBox.checked = dish.enabled !== false;
    const includesBox = editor.querySelector('[data-field="includesBox"]');
    if (includesBox) includesBox.checked = Boolean(dish.includesBox);
    const showOnWebsite = editor.querySelector('[data-field="showOnWebsite"]');
    if (showOnWebsite) showOnWebsite.checked = dish.showOnWebsite === true;
    const preview = editor.querySelector('.cp-public-preview');
    if (preview) preview.outerHTML = publicPreviewHtml(dish);
  }
  if (dishKind(dish) === 'menu') {
    // Keep member-picker labels in open set editors in sync with menu renames.
    document.querySelectorAll('[data-member-id]').forEach((box) => {
      if (box.dataset.memberId === String(dish.id) && box.parentElement?.classList.contains('cp-check')) {
        const textNode = [...box.parentElement.childNodes].find((node) => node.nodeType === 3);
        if (textNode) textNode.textContent = dish.publicName || dish.name || dish.id;
      }
    });
  }
  const summary = $('#dish-summary');
  if (summary) summary.outerHTML = dishesSummaryHtml();
  const tabs = document.querySelector('.cp-tabs');
  if (tabs) tabs.outerHTML = tabsHtml();
  $('#stats').innerHTML = statsHtml();
}

function changeDishKind(path, value) {
  const dish = getPath(state.working, path);
  if (!dish || !['menu', 'set', 'internal'].includes(value)) { renderAll(); return; }
  if (dishKind(dish) === value) return;
  if (value !== 'menu' && (dish.publicName || dish.image || dish.category || dish.description || dish.showOnWebsite)) {
    if (!window.confirm('เปลี่ยนประเภทจะล้างชื่อ/รูป/หมวด/คำอธิบายสาธารณะที่กรอกไว้ ดำเนินการต่อ?')) { renderAll(); return; }
    dish.publicName = '';
    dish.image = '';
    dish.category = '';
    dish.description = '';
    dish.showOnWebsite = false;
  }
  if (value !== 'set' && Array.isArray(dish.menuIds) && dish.menuIds.length) {
    if (!window.confirm('เปลี่ยนประเภทจะล้างเมนูที่เลือกไว้ในชุดนี้ ดำเนินการต่อ?')) { renderAll(); return; }
    dish.menuIds = [];
  }
  dish.kind = value;
  delete state.rowMarks[rowKey(path)];
  renderAll();
  setStatus('มีการแก้ไขยังไม่บันทึก', 'warn');
}

function markDishCompositionChanged(path) {
  delete state.rowMarks[rowKey(path)];
  refreshDishRow(path);
  clearStatus();
  $('#save-status').textContent = 'มีการแก้ไขยังไม่บันทึก';
  $('#save-status').className = 'cp-save show warn';
  $('#save-all').disabled = false;
}

function toggleDishMember(path, ref, checked) {
  const dish = getPath(state.working, path);
  if (!dish) return;
  const ids = Array.isArray(dish.menuIds) ? dish.menuIds.map(String) : [];
  dish.menuIds = checked ? [...new Set([...ids, String(ref)])] : ids.filter((item) => item !== String(ref));
  markDishCompositionChanged(path);
}

async function copyPublicDish(path) {
  const dish = getPath(state.working, path);
  if (!dish) return;
  const text = JSON.stringify(publicPayload(dish), null, 2);
  try {
    if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
    await navigator.clipboard.writeText(text);
    $('#form-status').textContent = 'คัดลอกข้อมูลสาธารณะแล้ว (ไม่มีทุน/หมายเหตุภายใน)';
    $('#form-status').className = 'cp-form-status ok';
  } catch {
    $('#form-status').textContent = 'คัดลอกไม่สำเร็จในเบราว์เซอร์นี้ — ดูตัวอย่างด้านบนแล้วจดไปใช้';
    $('#form-status').className = 'cp-form-status bad';
  }
}

async function save() {
  if (state.busy || !state.working) return;
  if (!state.loadOk) {
    showErrors(['ยังไม่พร้อมบันทึก — กด “โหลดข้อมูลใหม่” ให้โหลดข้อมูลที่ถูกต้องสำเร็จก่อน']);
    setStatus('ยังไม่ได้บันทึก', 'bad');
    return;
  }
  const rowKeys = collectDirtyRowKeys();
  state.busy = true;
  updateSaveButton();
  $('#form-status').textContent = 'กำลังบันทึก…';
  $('#form-status').className = 'cp-form-status';
  $('#save-errors').hidden = true;
  try {
    const response = await fetch('/owner-costs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(state.working),
    });
    if (response.status === 200) {
      const payload = await response.json();
      await load({ force: true, silent: true });
      rowKeys.forEach((key) => { state.rowMarks[key] = 'บันทึกแล้ว ✓'; });
      renderAll();
      setStatus(`บันทึกแล้ว ✓ รุ่น ${payload.version ?? ''}`.trim());
      $('#form-status').textContent = payload.updatedAt
        ? `บันทึกเมื่อ ${new Date(payload.updatedAt).toLocaleString('th-TH')} — กลับไปหน้าจัดชุดแล้วกด “แนะนำชุดเมนู” ใหม่เพื่อใช้ต้นทุนล่าสุด`
        : 'บันทึกแล้ว';
      $('#form-status').className = 'cp-form-status ok';
      return;
    }
    let errors = [];
    if (String(response.headers.get('content-type') || '').includes('application/json')) {
      const body = await response.json().catch(() => null);
      errors = Array.isArray(body?.errors) ? body.errors : [];
    }
    if (!errors.length) errors = [`บันทึกไม่สำเร็จ (HTTP ${response.status}) — ข้อมูลในไฟล์ยังไม่ถูกเปลี่ยน`];
    showErrors(errors);
    setStatus('ยังไม่ได้บันทึก', 'bad');
    $('#form-status').textContent = 'แก้ข้อมูลตามที่แจ้ง แล้วกดบันทึกใหม่';
    $('#form-status').className = 'cp-form-status bad';
  } catch {
    showErrors(['ติดต่อเซิร์ฟเวอร์ local ไม่ได้ — ยังไม่ได้บันทึกข้อมูล']);
    setStatus('ยังไม่ได้บันทึก', 'bad');
    $('#form-status').textContent = '';
    $('#form-status').className = 'cp-form-status bad';
  } finally {
    state.busy = false;
    updateSaveButton();
  }
}

function collectDirtyRowKeys() {
  const keys = [];
  for (const groupKey of Object.keys(state.working.groupMeta || {})) {
    for (const row of rowsFor(groupKey)) if (rowDirty(row)) keys.push(rowKey(row.path));
  }
  return keys;
}

function showErrors(errors) {
  const box = $('#save-errors');
  box.hidden = false;
  box.innerHTML = `<strong>ยังบันทึกไม่ได้</strong><ul>${errors.map((error) => `<li>${esc(error)}</li>`).join('')}</ul>`;
  // Mirror into the open editor so the message sits next to the form being fixed.
  const editorBox = document.querySelector('[data-editor-errors]');
  if (editorBox) {
    editorBox.hidden = false;
    editorBox.innerHTML = `<strong>ยังบันทึกไม่ได้ — ค่าที่กรอกไว้ยังอยู่ แก้ตามนี้แล้วกดบันทึกใหม่</strong><ul>${errors.map((error) => `<li>${esc(error)}</li>`).join('')}</ul>`;
  }
}

function addExtra(groupKey) {
  const form = document.querySelector(`[data-action="add-extra"][data-group="${CSS.escape(groupKey)}"]`)?.closest('.cp-add-row');
  if (!form) return;
  const name = form.querySelector('[data-add="name"]').value.trim();
  const unit = form.querySelector('[data-add="unit"]').value.trim();
  const costRaw = form.querySelector('[data-add="cost"]').value.trim();
  const status = form.querySelector('[data-add="status"]').checked;
  const msg = form.querySelector('[data-add="msg"]');
  if (!name || !unit) { msg.textContent = 'กรอกชื่อรายการและหน่วยราคา'; return; }
  if (status && !costRaw) { msg.textContent = 'กรอกราคาก่อนยืนยัน'; return; }
  const cost = costRaw === '' ? null : Number(costRaw);
  if (costRaw !== '' && (!Number.isFinite(cost) || cost <= 0)) { msg.textContent = 'ราคาต้องมากกว่า 0 (เว้นว่างหากยังไม่ทราบทุน)'; return; }
  const kind = groupKey === 'soup' ? 'soup' : groupKey === 'dessert' ? 'dessert' : 'side';
  state.working.extras.push({
    id: `extra-${Date.now().toString(36)}-${state.working.extras.length}`,
    name, kind, unit, cost, status: cost === null ? 'pending' : (status ? 'confirmed' : 'pending'), note: '',
  });
  renderAll();
  setStatus('มีการแก้ไขยังไม่บันทึก', 'warn');
}

function addTopping() {
  const form = document.querySelector('[data-action="add-topping"]')?.closest('.cp-add-row');
  if (!form) return;
  const name = form.querySelector('[data-add-topping="name"]').value.trim();
  const unit = form.querySelector('[data-add-topping="unit"]').value.trim();
  const costRaw = form.querySelector('[data-add-topping="cost"]').value.trim();
  const status = form.querySelector('[data-add-topping="status"]').checked;
  const msg = form.querySelector('[data-add-topping="msg"]');
  if (!name || !unit) { msg.textContent = 'กรอกชื่อรายการและหน่วยนับ'; return; }
  if (status && !costRaw) { msg.textContent = 'กรอกราคาก่อนยืนยัน'; return; }
  const cost = costRaw === '' ? null : Number(costRaw);
  if (costRaw !== '' && (!Number.isFinite(cost) || cost <= 0)) { msg.textContent = 'ราคาต้องมากกว่า 0 (เว้นว่างหากยังไม่ทราบทุน)'; return; }
  let id;
  do {
    toppingSequence += 1;
    id = `topping-${Date.now().toString(36)}-${toppingSequence.toString(36)}`;
  } while (state.working.toppings.some((item) => item.id === id));
  state.working.toppings.push({
    id, name, unit, cost, status: cost === null ? 'pending' : (status ? 'confirmed' : 'pending'), enabled: true, note: '',
  });
  renderAll();
  setStatus('มีการแก้ไขยังไม่บันทึก', 'warn');
}

function addDishTopping(button) {
  const path = JSON.parse(button.dataset.path);
  const dish = getPath(state.working, path);
  const select = button.closest('[data-editor]')?.querySelector('[data-dish-add-select]');
  if (!dish || !select || !select.value) return;
  dish.toppings = Array.isArray(dish.toppings) ? dish.toppings : [];
  if (dish.toppings.some((item) => String(item.toppingId) === select.value)) return;
  dish.toppings.push({ toppingId: select.value, quantity: 1, includedInFoodCost: false });
  renderAll();
  setStatus('มีการแก้ไขยังไม่บันทึก', 'warn');
}

function removeDishTopping(button) {
  const path = JSON.parse(button.dataset.path);
  const dish = getPath(state.working, path);
  const index = Number(button.dataset.index);
  if (!dish || !Array.isArray(dish.toppings) || !Number.isSafeInteger(index)) return;
  dish.toppings.splice(index, 1);
  renderAll();
  setStatus('มีการแก้ไขยังไม่บันทึก', 'warn');
}

function editDishTopping(target) {
  const path = JSON.parse(target.dataset.dishPath);
  const dish = getPath(state.working, path);
  const index = Number(target.dataset.dishIndex);
  const field = target.dataset.dishField;
  const selection = dish?.toppings?.[index];
  if (!selection || !['quantity', 'includedInFoodCost'].includes(field)) return;
  selection[field] = field === 'includedInFoodCost'
    ? target.checked
    : target.value === '' ? '' : Number(target.value);
  markDishCompositionChanged(path);
}

function deleteRow(path) {
  const [section] = path;
  if (section === 'extras' || section === 'dishes') state.working[section].splice(path[1], 1);
  // Row indexes shift: never leave the editor pointing at the wrong dish.
  state.editDish = null;
  renderAll();
  setStatus('มีการแก้ไขยังไม่บันทึก', 'warn');
}

function revertDishRow(path) {
  const saved = getPath(state.saved, path);
  if (!saved) return;
  setPath(state.working, path, clone(saved));
  delete state.rowMarks[rowKey(path)];
  renderAll();
  setStatus('ยกเลิกการแก้ไขในชุดนี้แล้ว', 'warn');
}

function addDish() {
  const form = $('#dish-add');
  if (!form) return;
  const kindRaw = form.querySelector('input[data-add-dish="kind"]:checked')?.value;
  const kind = kindRaw === 'menu' || kindRaw === 'set' ? kindRaw : 'internal';
  const name = form.querySelector('[data-add-dish="name"]').value.trim();
  const menuIdRaw = form.querySelector('[data-add-dish="menuId"]').value;
  const itemsRaw = form.querySelector('[data-add-dish="items"]').value;
  const costRaw = form.querySelector('[data-add-dish="foodCost"]').value.trim();
  const box = form.querySelector('[data-add-dish="box"]').value;
  const includesBox = form.querySelector('[data-add-dish="includesBox"]').checked;
  const status = form.querySelector('[data-add-dish="status"]').checked;
  const enabled = form.querySelector('[data-add-dish="enabled"]').checked;
  const msg = form.querySelector('[data-add-dish="msg"]');
  if (!name) { msg.textContent = 'กรอกชื่อเมนูหรือชื่อชุด'; return; }
  if (status && !costRaw) { msg.textContent = 'กรอกทุนอาหารก่อนกดยืนยัน'; return; }
  const foodCost = costRaw === '' ? null : Number(costRaw);
  if (costRaw !== '' && (!Number.isFinite(foodCost) || foodCost <= 0)) { msg.textContent = 'ทุนอาหารต้องมากกว่า 0 (เว้นว่างหากยังไม่ทราบทุน)'; return; }
  let id;
  let menuId = null;
  if (menuIdRaw) {
    menuId = Number(menuIdRaw);
    id = `menu-${menuId}`;
    if ((state.working.dishes || []).some((dish) => dish.id === id)) { msg.textContent = 'เมนูนี้ถูกบันทึกแล้ว (รหัสซ้ำ)'; return; }
  } else {
    id = `set-${Date.now().toString(36)}-${(state.working.dishes || []).length}`;
  }
  state.working.dishes.push({
    id,
    menuId,
    name,
    items: String(itemsRaw).split(/[,،\n]/).map((item) => item.trim()).filter(Boolean),
    foodCost,
    box,
    includesBox,
    status: foodCost === null ? 'pending' : (status ? 'confirmed' : 'pending'),
    enabled,
    note: '',
    kind,
    menuIds: [],
    publicName: '',
    image: '',
    category: '',
    description: '',
    showOnWebsite: false,
  });
  state.addDishOpen = false;
  state.editDish = state.working.dishes.length - 1;
  renderAll();
  setStatus('มีการแก้ไขยังไม่บันทึก', 'warn');
  document.querySelector('[data-editor]')?.scrollIntoView({ block: 'nearest' });
}

// --- loading -----------------------------------------------------------------

async function fetchJson(url) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function load({ force = false, silent = false } = {}) {
  if (force && isDirty() && !silent) {
    if (!window.confirm('มีการแก้ไขที่ยังไม่บันทึก — โหลดใหม่แล้วจะเอาการแก้ไขทิ้ง โหลดต่อหรือไม่?')) return;
  }
  let costs;
  let catalog;
  try {
    [costs, catalog] = await Promise.all([fetchJson('/owner-costs'), fetchJson('/menu-catalog')]);
  } catch {
    // Fetch failed: the local server is unreachable. Old content (if any) stays
    // but saving is blocked until correct data loads.
    state.loadOk = false;
    updateSaveButton();
    const box = $('#load-error');
    box.hidden = false;
    box.textContent = 'โหลดข้อมูลต้นทุนภายในไม่สำเร็จ กรุณาตรวจว่าเซิร์ฟเวอร์ local กำลังทำงาน แล้วกด “โหลดข้อมูลใหม่”';
    setStatus('โหลดข้อมูลไม่สำเร็จ', 'bad');
    return;
  }
  state.saved = costs;
  state.working = clone(costs);
  state.catalog = catalog;
  state.rowMarks = {};
  state.editDish = null;
  $('#file-hint').hidden = true;
  $('#load-error').hidden = true;
  try {
    renderAll();
  } catch (error) {
    // Render failed: page code could not build the UI. The file data is NOT
    // blamed and the server is NOT the cause — say so, and block saving until
    // a correct render succeeds.
    console.error(error);
    state.loadOk = false;
    updateSaveButton();
    const box = $('#load-error');
    box.hidden = false;
    box.textContent = 'แสดงหน้านี้ไม่สำเร็จ (ข้อมูลในไฟล์ไม่เสียหาย ไม่ต้องเปิดเซิร์ฟเวอร์ใหม่) — อย่าเพิ่งบันทึก กรุณาแจ้งผู้ดูแล';
    setStatus('แสดงหน้าไม่สำเร็จ', 'bad');
    return;
  }
  state.loadOk = true;
  if (!silent) setStatus('โหลดข้อมูลล่าสุดแล้ว');
}

// --- events ------------------------------------------------------------------

document.addEventListener('input', (event) => {
  const target = event.target;
  if (target.dataset?.dishPath && target.dataset.dishField === 'quantity') {
    editDishTopping(target);
    return;
  }
  if (target.dataset?.path && target.dataset.field && target.type !== 'checkbox' && target.tagName !== 'SELECT') onFieldEdit(target);
});
document.addEventListener('change', (event) => {
  const target = event.target;
  if (target.dataset?.dishPath && target.dataset.dishField) {
    editDishTopping(target);
    return;
  }
  if (!target.dataset.path || !target.dataset.field) return;
  onFieldEdit(target);
  // Dish rows refresh surgically (keeps typing focus); other rows re-render.
  if (!isDishPath(JSON.parse(target.dataset.path))) renderAll();
});
document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const action = button.dataset.action;
  if (action === 'save') save();
  if (action === 'delete-row') {
    if (button.closest('[data-editor]') && !window.confirm('ลบชุดอาหารนี้? การลบจะมีผลเมื่อกดบันทึก')) return;
    deleteRow(JSON.parse(button.dataset.path));
  }
  if (action === 'add-extra') addExtra(button.dataset.group);
  if (action === 'add-topping') addTopping();
  if (action === 'add-dish-topping') addDishTopping(button);
  if (action === 'remove-dish-topping') removeDishTopping(button);
  if (action === 'dish-add') addDish();
  if (action === 'add-dish-open') {
    state.addDishOpen = !state.addDishOpen;
    state.editDish = null;
    renderAll();
  }
  if (action === 'edit-dish') {
    state.editDish = JSON.parse(button.dataset.path)[1];
    state.addDishOpen = false;
    renderAll();
    document.querySelector('[data-editor]')?.scrollIntoView({ block: 'nearest' });
  }
  if (action === 'close-editor') {
    // Closing keeps typed values as unsaved edits; only revert/reload discards.
    state.editDish = null;
    document.querySelector('[data-editor]')?.remove();
  }
  if (action === 'revert-row') {
    if (!window.confirm('ทิ้งค่าที่แก้ในชุดนี้ กลับเป็นค่าที่บันทึกไว้?')) return;
    revertDishRow(JSON.parse(button.dataset.path));
  }
  if (action === 'copy-public') {
    copyPublicDish(JSON.parse(button.dataset.path));
  }
  if (action === 'tab') {
    state.tab = button.dataset.tab;
    applyTab();
  }
});
$('#save-all').addEventListener('click', () => save());
$('#reload').addEventListener('click', () => load({ force: true }));
$('#groups').addEventListener('input', (event) => {
  if (event.target.id === 'dish-search') {
    state.dishFilter.q = event.target.value;
    applyDishFilter();
  }
});
$('#groups').addEventListener('change', (event) => {
  if (event.target.id === 'dish-status-filter') {
    state.dishFilter.status = event.target.value;
    applyDishFilter();
    return;
  }
  if (event.target.dataset?.memberId && event.target.dataset?.path) {
    toggleDishMember(JSON.parse(event.target.dataset.path), event.target.dataset.memberId, event.target.checked);
  }
});

// Cost data can change while this page is open (another tab or a file edit).
document.addEventListener('visibilitychange', async () => {
  if (document.hidden || !state.saved) return;
  try {
    const fresh = await fetchJson('/owner-costs');
    if (fresh.version === state.saved.version) return;
    if (isDirty()) {
      setStatus('ข้อมูลในไฟล์เปลี่ยนไปขณะคุณกำลังแก้ — กด “โหลดข้อมูลใหม่” เพื่อดูล่าสุด (การแก้ไขของคุณยังอยู่)', 'bad');
      return;
    }
    state.saved = fresh;
    state.working = clone(fresh);
    state.editDish = null;
    try {
      renderAll();
    } catch (error) {
      console.error(error);
      return;
    }
    state.loadOk = true;
    setStatus('อัปเดตข้อมูลล่าสุดจากไฟล์แล้ว');
  } catch {
    /* keep showing the last known data */
  }
});

await load({ silent: true });
