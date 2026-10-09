// Owner-only budget matcher (LOCAL ONLY, never deployed).
// One input: the customer's budget per box. One rule: a dish is offered only
// while `box price + chosen second dish + chosen add-ons <= budget`. Options that
// would push the total over the budget are not rendered at all, so an over-budget
// total can never be shown as a suggestion.
//
// The second dish ("อาหารเมนูที่ 2") is a dish IN the box and a Signature box
// takes exactly one, so it is a radio choice (one per box), never a checkbox.
// Which tier may offer one, and under which name, comes from
// data/business-rules.json; the name and the confirmed extra price come from the
// central draft through GET /sellable-menus.
//
// Selling price only: this file never reads cost data and never computes profit.
// Prices come from GET /sellable-menus, which serves the central draft.
const $ = (selector) => document.querySelector(selector);
const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]);

const state = {
  data: { menus: [], toppings: [], secondDish: {} },
  budgetCents: 0,
  // Menu IDs the owner ticked. Picking a dish never requires a topping: the
  // dish is selected on its own and toppings are opt-in extras on top of it.
  selected: new Set(),
  // menuId -> Set(topping names) ticked for that dish.
  picked: new Map(),
  // menuId -> side item id. The second dish ("อาหารเมนูที่ 2") is ONE dish per
  // box — a Signature box holds one main and one second dish — so it is stored as
  // a single id, never as a set like toppings.
  sides: new Map(),
};

function budgetInput() {
  const raw = ($('#budget').value || '').trim();
  if (raw === '') return 0;
  const parsed = Math.round(Number(raw) * 100);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

// Integer-cent maths only: no float drift when a price lands on the budget.
const toCents = (value) => Math.round(Number(value) * 100);
const money = (cents) => (cents / 100).toLocaleString('th-TH');

function addonsFor() {
  return state.data.toppings.map((item) => ({ ...item, group: 'topping' }));
}

// Which tier the dish belongs to decides whether it may carry a second dish:
// business-rules.json puts sideChoices on the tier (Signature today), and the
// names/prices come from the central draft through /sellable-menus. A dish of a
// tier with no second dish simply offers none.
function secondDishFor(menu) {
  const group = state.data.secondDish[menu.tier || 'classic'];
  return Array.isArray(group?.items) && group.items.length ? group : null;
}

function secondDishOptions(menu) {
  const group = secondDishFor(menu);
  if (!group) return [];
  const base = toCents(menu.price);
  return group.items.map((item) => ({
    ...item,
    totalCents: base + toCents(item.price),
    fits: base + toCents(item.price) <= state.budgetCents,
  }));
}

function secondDishPrice(menu, id) {
  const group = secondDishFor(menu);
  const item = Array.isArray(group?.items) ? group.items.find((row) => row.id === id) : null;
  return item ? toCents(item.price) : 0;
}

function chosenSideId(menu) {
  return state.sides.get(String(menu.id)) || '';
}

// An option is offered only if it still fits on its own.
function fitsOptions(menu) {
  const base = toCents(menu.price);
  return addonsFor().map((option) => ({
    ...option,
    totalCents: base + toCents(option.price),
    fits: base + toCents(option.price) <= state.budgetCents,
  }));
}

function currentTotal(menu, chosen) {
  const key = String(menu.id);
  const selected = chosen || state.picked.get(key) || new Set();
  let total = toCents(menu.price);
  for (const option of addonsFor()) {
    if (selected.has(option.name)) total += toCents(option.price);
  }
  const sideId = chosenSideId(menu);
  if (sideId) total += secondDishPrice(menu, sideId);
  return total;
}

// A menu stays in the list while the cheapest useful total still fits: at least
// the base price, and any ticked extra must keep the total within budget.
function menuOffered(menu) {
  const base = toCents(menu.price);
  if (base > state.budgetCents) return false;
  const selected = state.picked.get(String(menu.id)) || new Set();
  for (const option of addonsFor()) {
    if (!selected.has(option.name)) continue;
    if (base + toCents(option.price) > state.budgetCents) return false;
  }
  const sideId = chosenSideId(menu);
  if (sideId && !secondDishOptions(menu).some((item) => item.id === sideId && item.fits)) return false;
  return true;
}

function render() {
  const out = $('#results');
  const headline = $('#headline');
  const budget = state.budgetCents;

  if (!budget) {
    headline.innerHTML = '<p class="hint">ใส่งบต่อกล่อง เช่น 100 เพื่อดูรายการ</p>';
    out.innerHTML = '';
    $('#over-budget-box').hidden = true;
    updateCopyButton();
    return;
  }

  const query = ($('#search').value || '').trim().toLowerCase();
  const tier = $('#tier').value;
  const matches = state.data.menus.filter((menu) => {
    if (tier && (menu.tier || 'classic') !== tier) return false;
    if (query && !String(menu.name).toLowerCase().includes(query)) return false;
    return true;
  });

  const withinBudget = matches.filter(menuOffered);
  const overBudget = matches.filter((menu) => toCents(menu.price) > budget);

  headline.innerHTML = `<p class="headline-line">งบ <strong>${money(budget)}</strong> บาท/กล่อง · เมนูที่ไม่เกินงบ <strong>${withinBudget.length}</strong> จาก ${state.data.menus.length} เมนู</p>`;

  if (!withinBudget.length) {
    out.innerHTML = `<p class="empty">ไม่มีเมนูที่ราคาไม่เกิน ${money(budget)} บาท/กล่อง</p>`;
  } else {
    const groups = new Map();
    for (const menu of withinBudget) {
      const key = TIER_LABELS[menu.tier] || menu.tier || 'Classic';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(menu);
    }
    out.innerHTML = [...groups.entries()].map(([key, menus]) => `
      <h3 class="group">${escape(key)} <span>${menus.length} เมนู</span></h3>
      <div class="cards">${menus.map(cardHtml).join('')}</div>
    `).join('');
  }

  const box = $('#over-budget-box');
  box.hidden = overBudget.length === 0;
  if (overBudget.length) {
    $('#over-budget-count').textContent = String(overBudget.length);
    $('#over-budget').innerHTML = `<ul class="plain">${overBudget.map((menu) => `<li><span>${escape(menu.name)}</span><b>${money(toCents(menu.price))} บาท</b></li>`).join('')}</ul>`;
  }

  updateCopyButton();
}

function cardHtml(menu) {
  const key = String(menu.id);
  const chosen = state.picked.get(key) || new Set();
  const options = fitsOptions(menu);
  const offerable = options.filter((option) => option.fits);
  const total = currentTotal(menu, chosen);
  const isPicked = state.selected.has(key);

  const sideGroup = secondDishFor(menu);
  const sideChosen = chosenSideId(menu);
  const sideOfferable = sideGroup ? secondDishOptions(menu).filter((item) => item.fits) : [];
  const sideHtml = !sideGroup ? '' : (sideOfferable.length ? `
    <div class="addons addons-second">
      <span class="addons-label">${escape(sideGroup.label)}</span>
      <label class="addon">
        <input type="radio" name="side-${escape(key)}" data-side="${escape(key)}" data-side-id="" ${sideChosen ? '' : 'checked'}>
        <span>ไม่เพิ่ม</span>
      </label>
      ${sideOfferable.map((item) => `
        <label class="addon">
          <input type="radio" name="side-${escape(key)}" data-side="${escape(key)}" data-side-id="${escape(item.id)}" ${sideChosen === item.id ? 'checked' : ''}>
          <span>${escape(item.name)}</span><b>+${money(toCents(item.price))}</b>
        </label>
      `).join('')}
      <p class="micro addon-note">เลือกได้ 1 อย่างต่อกล่อง</p>
    </div>
  ` : `<p class="micro">ราคาเต็มงบแล้ว · เพิ่ม${escape(sideGroup.label)}ไม่ได้</p>`);

  const optionHtml = offerable.length ? `
    <div class="addons">
      <span class="addons-label">เพิ่มได้</span>
      ${offerable.map((option) => `
        <label class="addon">
          <input type="checkbox" data-menu="${escape(key)}" data-addon="${escape(option.name)}" ${chosen.has(option.name) ? 'checked' : ''}>
          <span>${escape(option.name)}</span><b>+${money(toCents(option.price))}</b>
        </label>
      `).join('')}
    </div>
  ` : '<p class="micro">ราคาเต็มงบแล้ว · เพิ่มตัวเลือกไม่ได้</p>';

  return `
    <article class="card" data-card="${escape(key)}">
      <label class="pick">
        <input type="checkbox" data-pick="${escape(key)}" ${isPicked ? 'checked' : ''}>
        <span class="card-body">
          <span class="card-name">${escape(menu.name)}</span>
          <span class="card-meta">${money(toCents(menu.price))} บาท/กล่อง${menu.minPerMenu ? ` · ขั้นต่ำ ${menu.minPerMenu} กล่อง` : ''}</span>
        </span>
      </label>
      ${sideHtml}
      ${optionHtml}
      <p class="card-total">รวมที่เลือก <b>${money(total)}</b> บาท</p>
    </article>
  `;
}

function pickedMenus() {
  return state.data.menus.filter((menu) => state.selected.has(String(menu.id)));
}

// What the customer will read back to us: the box, then what was added to it.
// The second dish is named first because it is a dish in the box, not an extra.
function chosenExtras(menu) {
  const key = String(menu.id);
  const names = [...(state.picked.get(key) || new Set())];
  const sideId = chosenSideId(menu);
  const group = secondDishFor(menu);
  const side = sideId && Array.isArray(group?.items) ? group.items.find((item) => item.id === sideId) : null;
  if (side) names.unshift(`${group.label}: ${side.name}`);
  return names;
}

function quoteText() {
  const budget = money(state.budgetCents);
  const lines = ['เมนูที่แนะนำภายใต้งบ', ''];
  for (const menu of pickedMenus()) {
    const extras = chosenExtras(menu);
    lines.push(`${menu.name} ${money(currentTotal(menu))} บาท/กล่อง`
      + (extras.length ? ` (${extras.join(', ')})` : '')
      + (menu.minPerMenu ? ` · ขั้นต่ำ ${menu.minPerMenu} กล่อง` : ''));
  }
  lines.push('', `งบที่ลูกค้าแจ้ง: ${budget} บาท/กล่อง`);
  return lines.join('\n');
}

function updateCopyButton() {
  $('#copy-selected').disabled = pickedMenus().length === 0;
}

$('#budget').addEventListener('input', () => {
  state.budgetCents = budgetInput();
  render();
});
$('#search').addEventListener('input', render);
$('#tier').addEventListener('change', render);

$('#results').addEventListener('change', (event) => {
  const box = event.target;
  if (!(box instanceof HTMLInputElement)) return;
  if (box.dataset.sideId !== undefined) {
    // One second dish per box: the radio group already keeps a single choice,
    // and "ไม่เพิ่ม" clears it instead of leaving a hidden extra in the total.
    const key = String(box.dataset.side);
    const id = String(box.dataset.sideId || '');
    if (id) {
      state.sides.set(key, id);
      state.selected.add(key);
    } else {
      state.sides.delete(key);
    }
    render();
    return;
  }
  if (box.dataset.addon !== undefined) {
    const key = String(box.dataset.menu);
    const chosen = state.picked.get(key) || new Set();
    if (box.checked) chosen.add(String(box.dataset.addon));
    else chosen.delete(String(box.dataset.addon));
    if (chosen.size) state.picked.set(key, chosen);
    else state.picked.delete(key);
    if (box.checked) state.selected.add(key);
    render();
    return;
  }
  if (box.dataset.pick !== undefined) {
    const key = String(box.dataset.pick);
    if (box.checked) state.selected.add(key);
    else {
      state.selected.delete(key);
      state.picked.delete(key);
    }
    render();
  }
});

$('#copy-selected').addEventListener('click', async () => {
  const text = quoteText();
  try {
    await navigator.clipboard.writeText(text);
    $('#copy-status').textContent = 'คัดลอกแล้ว ✓';
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    document.body.appendChild(area);
    area.select();
    document.execCommand('copy');
    area.remove();
    $('#copy-status').textContent = 'คัดลอกแล้ว ✓';
  }
});

// The level is the only grouping axis (data/business-rules.json ->
// services.mealBox.tiers), so the filter offers exactly those three.
const TIER_LABELS = { classic: 'Classic', signature: 'Signature', executive: 'Executive' };

function fillTiers() {
  const select = $('#tier');
  for (const [id, label] of Object.entries(TIER_LABELS)) {
    select.insertAdjacentHTML('beforeend', `<option value="${escape(id)}">${escape(label)}</option>`);
  }
}

try {
  const response = await fetch('/sellable-menus', { cache: 'no-store' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  state.data = {
    menus: Array.isArray(data.menus) ? data.menus : [],
    toppings: Array.isArray(data.toppings) ? data.toppings : [],
    secondDish: data.secondDish && typeof data.secondDish === 'object' ? data.secondDish : {},
  };
  fillTiers();
  render();
} catch {
  $('#load-error').hidden = false;
}