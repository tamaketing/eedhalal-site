// Bulk cost entry UI (LOCAL ONLY, never deployed).
//
// The owner confirms costs so a menu stops being ask-for-quote. Doing that one
// dish at a time is the slowest part of the whole menu workflow, so this screen
// lists every published menu in one table and confirms the filled-in rows in a
// single save.
//
// It writes costs only. Nothing here publishes, and nothing here touches a
// selling price: the cost gate opens when the owner runs the separate release
// step, so the two decisions never blur into each other.
//
// Hard rules mirrored from the server:
//   - 0 is never a cost. A row with 0 or a blank stays ask-for-quote and is
//     reported back, never silently confirmed.
//   - an unknown box, or a box whose own cost is unconfirmed, blocks that row.
//   - nothing is saved until the owner presses the confirm button.
const $ = (selector) => document.querySelector(selector);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[c]);

const state = { rows: [], boxes: {}, query: '', scope: 'waiting', busy: false, dirty: false };

function boxCost(box) {
  const value = Number(state.boxes?.[box]?.cost);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function boxOptions(selected) {
  return '<option value="">— ไม่ระบุ —</option>'
    + Object.entries(state.boxes).map(([key, box]) => {
      const label = `${box.label || key}${box.cost ? ` (${box.cost} บาท)` : ' (ยังไม่ยืนยันต้นทุน)'}`;
      return `<option value="${esc(key)}"${key === selected ? ' selected' : ''}>${esc(label)}</option>`;
    }).join('');
}

function landedCost(row) {
  const food = Number(row.foodCost);
  if (!Number.isFinite(food) || food <= 0) return null;
  const box = row.box ? boxCost(row.box) : 0;
  if (row.box && box === null) return null;
  return food + (row.includesBox ? 0 : (box ?? 0));
}

function marginOf(row) {
  const landed = landedCost(row);
  const sell = Number(row.sellPrice);
  if (landed === null || !Number.isFinite(sell) || sell <= 0) return null;
  return { baht: sell - landed, pct: Math.round(((sell - landed) / sell) * 100) };
}

function setStatus(text, tone = '') {
  const box = $('#bulk-status');
  if (box) { box.textContent = text; box.className = `cp-save${tone ? ` ${tone}` : ''}`; }
}

/** Rows the owner should see, filtered by search and scope. */
function visibleRows() {
  const q = state.query.trim().toLowerCase();
  return state.rows.filter((row) => {
    if (state.scope === 'waiting' && row.confirmed) return false;
    if (!q) return true;
    return String(row.menuId).includes(q) || String(row.name).toLowerCase().includes(q);
  });
}

function rowHtml(row) {
  const landed = landedCost(row);
  const margin = marginOf(row);
  const marginText = margin
    ? `${margin.baht} บาท (${margin.pct}%)`
    : landed === null ? 'ยังคิดไม่ได้' : 'ไม่มีราคาขาย';
  const marginTone = margin == null ? '' : margin.baht < 0 ? 'color:#DC2626;font-weight:800' : margin.pct < 20 ? 'color:#8A5A12;font-weight:700' : '';
  const boxMissing = row.box && boxCost(row.box) === null;
  return `<tr data-menu="${esc(row.menuId)}">`
    + `<td style="white-space:nowrap"><strong>${esc(row.menuId)}</strong></td>`
    + `<td>${esc(row.name)}<div class="cp-sub">${esc(row.category || '')} · ขาย ${esc(row.sellPrice)} บาท</div></td>`
    + `<td><input class="cp-input narrow" type="number" min="1" step="0.5" data-field="foodCost" value="${row.foodCost ?? ''}" aria-label="ต้นทุนอาหาร ${esc(row.name)}"></td>`
    + `<td><select class="cp-input" data-field="box" aria-label="กล่อง ${esc(row.name)}">${boxOptions(row.box)}</select></td>`
    + `<td style="white-space:nowrap"><label style="display:flex;gap:.3rem;align-items:center"><input type="checkbox" data-field="includesBox"${row.includesBox ? ' checked' : ''}> รวมกล่องแล้ว</label></td>`
    + `<td style="white-space:nowrap"${marginTone ? ` style="${marginTone}"` : ''}>${esc(marginText)}${landed === null && Number(row.foodCost) > 0 ? '' : ''}</td>`
    + `<td style="white-space:nowrap">${row.confirmed ? '<span class="cp-tag ok">ยืนยันแล้ว</span>' : '<span class="cp-tag wait">รอยืนยัน</span>'}${boxMissing ? '<div class="cp-sub" style="color:#DC2626">ต้นทุนกล่องยังไม่ยืนยัน</div>' : ''}</td>`
    + '</tr>';
}

function renderRows() {
  const rows = visibleRows();
  const body = $('#bulk-rows');
  if (!body) return;
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="7" class="cp-sub">ไม่มีเมนูตามเงื่อนไขนี้</td></tr>';
  } else {
    body.innerHTML = rows.map(rowHtml).join('');
  }
  const pending = rows.filter((r) => !r.confirmed && landedCost(r) !== null).length;
  const count = $('#bulk-count');
  if (count) {
    count.textContent = `แสดง ${rows.length} จาก ${state.rows.length} เมนู · กรอกพร้อมยืนยัน ${pending} รายการ`
      + (state.dirty ? ' · มีการแก้ที่ยังไม่บันทึก' : '');
  }
}

function collectRows() {
  return [...document.querySelectorAll('#bulk-rows tr[data-menu]')].map((tr) => {
    const menuId = Number(tr.dataset.menu);
    const row = state.rows.find((r) => r.menuId === menuId);
    const food = tr.querySelector('[data-field="foodCost"]')?.value ?? '';
    const box = tr.querySelector('[data-field="box"]')?.value ?? '';
    const includes = tr.querySelector('[data-field="includesBox"]')?.checked === true;
    return {
      ...row,
      foodCost: food === '' ? null : Number(food),
      box,
      includesBox: includes,
      confirmed: row.confirmed,
    };
  });
}

async function openBulk() {
  const modal = $('#bulk-modal');
  const body = $('#bulk-modal-body');
  if (!modal || !body) return;
  body.innerHTML = '<p class="cp-sub">กำลังโหลดรายการ…</p>';
  modal.hidden = false;
  try {
    const response = await fetch('/owner-costs/bulk', { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    state.rows = payload.rows || [];
    state.boxes = payload.boxes || {};
    const boxSelect = $('#bulk-box');
    if (boxSelect) {
      boxSelect.innerHTML = '<option value="">— เลือกเองทีละแถว —</option>'
        + Object.entries(state.boxes).map(([key, box]) => `<option value="${esc(key)}">${esc(box.label || key)}${box.cost ? ` (${box.cost} บาท)` : ''}</option>`).join('');
    }
    renderRows();
    const button = $('#bulk-open');
    if (button) button.disabled = false;
  } catch (error) {
    body.innerHTML = `<p style="color:#DC2626">โหลดรายการไม่สำเร็จ: ${esc(error.message)}</p>`;
  }
}

/** Copy the toolbar's box + food cost into every row that is still empty. */
function fillEmpty() {
  const food = Number($('#bulk-food')?.value);
  const box = $('#bulk-box')?.value || '';
  if (!Number.isFinite(food) || food <= 0) {
    setStatus('ใส่ต้นทุนอาหารเป็นตัวเลขมากกว่า 0 ก่อน (ห้ามใส่ 0)', 'bad');
    return;
  }
  const rows = visibleRows();
  let changed = 0;
  for (const tr of document.querySelectorAll('#bulk-rows tr[data-menu]')) {
    const input = tr.querySelector('[data-field="foodCost"]');
    const select = tr.querySelector('[data-field="box"]');
    if (input && input.value === '') {
      input.value = food;
      const menuId = Number(tr.dataset.menu);
      const row = state.rows.find((r) => r.menuId === menuId);
      if (row) { row.foodCost = food; changed += 1; }
    }
    if (select && box && select.value === '') select.value = box;
  }
  state.dirty = true;
  renderRows();
  setStatus(`ใส่ต้นทุน ${food} บาท ให้ ${changed} แถว — ตรวจรายแถวก่อนยืนยัน`, 'ok');
  void rows;
}

async function saveBulk() {
  const statusBox = $('#bulk-modal-status');
  const button = $('#bulk-save');
  if (state.busy) return;
  const rows = collectRows();
  const payload = rows.filter((row) => Number.isFinite(Number(row.foodCost)) && Number(row.foodCost) > 0);
  if (!payload.length) {
    if (statusBox) statusBox.textContent = 'ยังไม่มีแถวไหนกรอกต้นทุนอาหารเลย';
    return;
  }
  if (!window.confirm(`ยืนยันต้นทุน ${payload.length} เมนู?\n\nเมนูเหล่านี้จะกลับมาสั่งได้หลังกด “อัปเดตเว็บทั้งหมด”\n(ยังไม่ขึ้นเว็บเอง และไม่แตะราคาขาย)`)) return;

  state.busy = true;
  if (button) button.disabled = true;
  if (statusBox) statusBox.textContent = `กำลังบันทึก ${payload.length} รายการ…`;
  try {
    const response = await fetch('/owner-costs/bulk', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rows: payload }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.ok) throw new Error((body.errors || []).join(' | ') || `HTTP ${response.status}`);
    const applied = body.applied?.length || 0;
    const skipped = body.skipped?.length || 0;
    state.dirty = false;
    if (statusBox) {
      statusBox.textContent = `ยืนยันแล้ว ${applied} เมนู${skipped ? ` · ข้าม ${skipped} แถว` : ''} — กด “อัปเดตเว็บทั้งหมด” เพื่อเปิดให้สั่งได้`;
      statusBox.className = 'cp-form-status ok';
    }
    setStatus(`ยืนยันต้นทุนแล้ว ${applied} เมนู`, 'ok');
    await loadBulkRows();
    renderRows();
  } catch (error) {
    if (statusBox) { statusBox.textContent = `บันทึกไม่สำเร็จ: ${error.message}`; statusBox.className = 'cp-form-status bad'; }
  } finally {
    state.busy = false;
    if (button) button.disabled = false;
  }
}

async function loadBulkRows() {
  const response = await fetch('/owner-costs/bulk', { cache: 'no-store' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = await response.json();
  state.rows = payload.rows || [];
  state.boxes = payload.boxes || {};
}

function bind() {
  $('#bulk-open')?.addEventListener('click', openBulk);
  $('#bulk-fill')?.addEventListener('click', fillEmpty);
  $('#bulk-save')?.addEventListener('click', saveBulk);
  $('#bulk-search')?.addEventListener('input', (event) => {
    state.query = event.target.value || '';
    renderRows();
  });
  $('#bulk-scope')?.addEventListener('change', (event) => {
    state.scope = event.target.value || 'waiting';
    renderRows();
  });
  $('#bulk-modal')?.addEventListener('click', (event) => {
    if (event.target.dataset.bulkClose !== undefined || event.target === event.currentTarget) {
      event.currentTarget.hidden = true;
    }
  });
  // Recompute the margin preview whenever a value changes in the table.
  $('#bulk-modal-body')?.addEventListener('input', (event) => {
    if (!event.target.dataset.field) return;
    const tr = event.target.closest('tr[data-menu]');
    const menuId = Number(tr?.dataset.menu);
    const row = state.rows.find((r) => r.menuId === menuId);
    if (!row) return;
    state.dirty = true;
    row.foodCost = event.target.dataset.field === 'foodCost'
      ? (event.target.value === '' ? null : Number(event.target.value))
      : row.foodCost;
    row.box = event.target.dataset.field === 'box' ? event.target.value : row.box;
    row.includesBox = event.target.dataset.field === 'includesBox' ? event.target.checked : row.includesBox;
    renderRows();
  });
  // Restore the row count on first paint so the card is not blank.
  loadBulkRows().then(renderRows).catch(() => setStatus('ยังโหลดรายการไม่ได้ — กดปุ่มเปิดรายการ', 'bad'));
}

bind();