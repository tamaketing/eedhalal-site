// Owner-only central menu manager (LOCAL ONLY, never deployed).
// Single screen to add/edit name, image, category, description, selling price,
// display order, no-meat flag, and visibility per stable menu ID. Costs stay in
// owner-costs.json: this UI only READS them (joined by menuId) for the profit
// preview — a cost-only edit never creates a pending web publish.
//
// Two main actions:
//   บันทึก                  -> POST /menu-central (central draft; admin tools
//                              use it immediately, customer web unchanged)
//   ดูตัวอย่างและเผยแพร่      -> GET /menu-publish-preview (added/changed/hidden
//                              vs the last published release + customer sample)
//                              then POST /menu-publish on confirm. No tokens,
//                              no network: the local server rewrites the two
//                              published static files; `git push` stays manual.
const $ = (selector) => document.querySelector(selector);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]);

const CATEGORIES = ['ข้าวราดแกง', 'ข้าวผัด', 'เส้น', 'อาหารอินเดีย', 'พรีเมียม'];

const state = {
  saved: null, working: null, costs: null,
  publish: null, busy: false, loadOk: false,
  filter: { q: '', vis: 'all' },
};

const clone = (value) => JSON.parse(JSON.stringify(value));
const isDirty = () => Boolean(state.saved && state.working)
  && JSON.stringify(state.working.menus) !== JSON.stringify(state.saved.menus);

function costByMenuId(menuId) {
  const dish = (state.costs?.dishes || []).find((item) => Number(item.menuId) === Number(menuId));
  if (!dish) return null;
  if (dish.status !== 'confirmed') return { label: 'รอยืนยันทุน', confirmed: false };
  const value = Number(dish.foodCost);
  if (!Number.isFinite(value) || value <= 0) return { label: 'รอยืนยันทุน', confirmed: false };
  return { label: `${value} บาท/กล่อง`, confirmed: true, value };
}

function profitPreview(menu) {
  const cost = costByMenuId(menu.id);
  if (!cost || !cost.confirmed) return '<span class="cp-sub">กำไร: รอทุนอาหารยืนยัน</span>';
  const profit = Math.round((menu.price - cost.value) * 100) / 100;
  return `<span class="cp-sub">กำไรเบื้องต้น ~${profit} บาท/กล่อง <span title="ราคาขายลบทุนอาหาร ยังไม่รวมกล่อง/ท็อปปิ้ง ดูยอดรวมที่ส่วนต้นทุน">(ขาย ${menu.price} − ทุน ${cost.value})</span></span>`;
}

function statusPill() {
  const box = $('#mc-status');
  if (!box) return;
  const info = state.publish;
  if (!info) { box.innerHTML = '<span class="cp-tag wait">กำลังตรวจสถานะ…</span>'; return; }
  const tone = { draft: 'wait', dirty: 'wait', publishing: 'wait', staged: 'wait', published: 'ok', failed: 'bad' }[info.status] || 'wait';
  const draft = info.central ? `ฉบับร่าง v${esc(info.central.version ?? 0)}` : 'ฉบับร่าง —';
  const file = info.file?.status === 'staged'
    ? `ฉบับไฟล์ v${esc(info.file.fileVersion)} (${esc((info.file.builtAt || '').slice(0, 16).replace('T', ' ') )})`
    : 'ฉบับไฟล์ — ยังไม่สร้าง';
  const live = info.live?.state === 'live' && Number(info.live.liveVersion) === Number(info.file?.fileVersion)
    ? `ฉบับบนเว็บ v${esc(info.live.liveVersion)} ✓ ตรงกัน`
    : 'ฉบับบนเว็บ — ยังไม่ยืนยัน';
  box.innerHTML = `<span class="cp-tag ${tone}">${esc(info.statusTh)}</span>`
    + `<div class="cp-sub" style="margin-top:.3rem">${esc(draft)} · ${esc(file)} · ${esc(live)}</div>`;
  renderDeploy();
}

function renderDeploy() {
  const box = $('#mc-deploy');
  if (!box) return;
  const info = state.publish;
  if (!info) { box.innerHTML = '<p class="cp-sub">กำลังโหลดสถานะ…</p>'; return; }
  const deploy = info.deploy;
  const phase = deploy ? `<p class="cp-sub">งานขึ้นเว็บล่าสุด: <strong>${esc(deploy.phase)}</strong> · ${esc(deploy.detail || '')}${deploy.commit ? ` · commit ${esc(String(deploy.commit).slice(0, 40))}` : ''}</p>` : '<p class="cp-sub">ยังไม่เคยขึ้นเว็บจากหลังบ้านนี้</p>';
  const liveLine = info.live
    ? `<p class="cp-sub">เว็บจริง: <strong>${esc(info.live.stateTh || info.live.state)}</strong>${info.live.liveVersion ? ` (v${esc(info.live.liveVersion)})` : ''} · ${esc(info.live.reason || '')}</p>`
    : '';
  const guardNote = info.deployEnabled
    ? ''
    : '<p class="cp-sub">การขึ้นเว็บอัตโนมัติยังไม่เปิดในเครื่องนี้ (รอบนี้ทดสอบกระบวนการเท่านั้น) — เปิดโดยตั้งค่า EED_ALLOW_GIT_DEPLOY=1 แล้วเริ่ม server ใหม่</p>';
  box.innerHTML = `${phase}${liveLine}${guardNote}`
    + `<div class="cp-actions" style="display:flex;gap:.5rem;flex-wrap:wrap;align-items:center">`
    + `<button type="button" class="cp-btn ghost sm" id="mc-verify-live">ตรวจเว็บจริงตอนนี้</button>`
    + `<button type="button" class="cp-btn sm" id="mc-deploy-open"${info.deployEnabled ? '' : ' disabled title="ยังไม่เปิดการขึ้นเว็บอัตโนมัติ"'}>เผยแพร่ขึ้นเว็บจริง</button>`
    + `<span class="cp-form-status" id="mc-deploy-status"></span></div>`
    + `<div id="mc-backups"><p class="cp-sub">กำลังโหลดรายการสำรอง…</p></div>`;
  $('#mc-verify-live')?.addEventListener('click', verifyLive);
  $('#mc-deploy-open')?.addEventListener('click', openDeployConfirm);
  loadBackups();
}

async function verifyLive() {
  const statusBox = $('#mc-deploy-status');
  if (statusBox) statusBox.textContent = 'กำลังติดต่อเว็บจริง…';
  try {
    const response = await fetch('/menu-verify-live', { method: 'POST', headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' }, body: '{}' });
    const body = await response.json();
    if (!body.ok) throw new Error(body.error || `HTTP ${response.status}`);
  } catch (error) {
    if (statusBox) statusBox.textContent = `ตรวจไม่สำเร็จ: ${error.message}`;
  }
  await refreshPublish();
}

function openDeployConfirm() {
  const modal = $('#mc-modal');
  const body = $('#mc-modal-body');
  if (!modal || !body) return;
  const info = state.publish;
  if (info?.diff?.hasChanges) {
    body.innerHTML = '<p><strong>ขึ้นเว็บไม่ได้ตอนนี้</strong></p><p class="cp-sub">ฐานกลางยังใหม่กว่าฉบับไฟล์ — กด “ดูตัวอย่างและเผยแพร่” (สร้างไฟล์) ก่อน แล้วค่อยกลับมาขึ้นเว็บ</p><div class="cp-editor-actions"><button type="button" class="cp-btn ghost" data-mc-close>ปิด</button></div>';
    modal.hidden = false;
    return;
  }
  body.innerHTML = '<p><strong>ยืนยันขึ้นเว็บจริง</strong></p>'
    + '<p class="cp-sub">ระบบจะทำจากเครื่องนี้: ตรวจไฟล์อีกรอบ → commit <strong>เฉพาะ</strong> data/planner-overrides.json + js/menu-data.js (งานค้างอื่นไม่รวม) → push → รอตรวจว่าเว็บจริงให้บริการฉบับนี้แล้ว ถ้าตรวจไม่ได้จะขึ้น “ยังไม่ยืนยัน” ไม่ถือว่าสำเร็จ</p>'
    + '<p class="cp-sub">ห้ามรวมงานอื่นเข้า commit อัตโนมัติ: ถ้ามี commit อื่นรอ push อยู่ ระบบจะหยุดและแจ้งสาเหตุ</p>'
    + '<div class="cp-editor-actions"><button type="button" class="cp-btn" id="mc-deploy-confirm">ยืนยันขึ้นเว็บจริง</button><button type="button" class="cp-btn ghost" data-mc-close>ปิด</button><span class="cp-form-status" id="mc-deploy-confirm-status"></span></div>';
  modal.hidden = false;
  $('#mc-deploy-confirm')?.addEventListener('click', async () => {
    const statusBox = $('#mc-deploy-confirm-status');
    if (statusBox) statusBox.textContent = 'เริ่มงานขึ้นเว็บ… (ติดตามที่การ์ดด้านล่าง)';
    try {
      const response = await fetch('/menu-deploy', { method: 'POST', headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' }, body: JSON.stringify({ confirm: true }) });
      const result = await response.json();
      if (statusBox) statusBox.textContent = result.ok ? 'เริ่มงานแล้ว — อย่าปิดหน้านี้ระหว่างตรวจเว็บจริง' : `เริ่มไม่ได้: ${result.error || ''}`;
    } catch (error) {
      if (statusBox) statusBox.textContent = `เริ่มไม่ได้: ${error.message}`;
    }
    await refreshPublish();
  });
}

async function loadBackups() {
  const box = $('#mc-backups');
  if (!box) return;
  try {
    const rows = await fetch('/menu-backups', { cache: 'no-store' }).then((r) => r.json());
    if (!rows.length) { box.innerHTML = '<p class="cp-sub">ยังไม่มีไฟล์สำรอง — ระบบจะสำรองอัตโนมัติก่อนบันทึกทุกครั้ง</p>'; return; }
    const latest = rows.slice(0, 6);
    box.innerHTML = '<p class="cp-sub" style="margin-bottom:.3rem"><strong>สำรองอัตโนมัติในเครื่องนี้</strong> (กันแก้พลาด/เผยแพร่พลาด — <strong>ไม่กันเครื่องเสีย</strong> ควรคัดลอกออกนอกเครื่องเป็นระยะ) · ไฟล์สำรองไม่เข้า git ไม่ขึ้นเว็บ</p>'
      + latest.map((row) => `<div style="display:flex;gap:.5rem;align-items:center;margin:.2rem 0"><span class="cp-sub" style="flex:1">${esc(row.file)} · ${(row.size / 1024).toFixed(1)} KB</span><button type="button" class="cp-btn ghost sm" data-mc-restore="${esc(row.file)}">กู้คืน</button></div>`).join('')
      + `<p class="cp-sub">แสดง ${latest.length} จาก ${rows.length} ไฟล์ (เก็บ 20 ฉบับต่อข้อมูล)</p>`;
    box.querySelectorAll('[data-mc-restore]').forEach((button) => {
      button.addEventListener('click', async () => {
        if (!window.confirm(`กู้คืนจาก ${button.dataset.mcRestore}?\n(ระบบจะสำรองฉบับปัจจุบันไว้ก่อนกู้)`)) return;
        try {
          const response = await fetch('/menu-restore', { method: 'POST', headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' }, body: JSON.stringify({ file: button.dataset.mcRestore }) });
          const result = await response.json();
          setFormStatus(result.ok ? `กู้คืนแล้ว ✓ (${result.restored})` : `กู้คืนไม่สำเร็จ: ${result.error}`, result.ok ? 'ok' : 'bad');
        } catch (error) {
          setFormStatus(`กู้คืนไม่สำเร็จ: ${error.message}`, 'bad');
        }
        await load({ silent: true });
      });
    });
  } catch {
    box.innerHTML = '<p class="cp-sub">โหลดรายการสำรองไม่สำเร็จ</p>';
  }
}

function matchesFilter(menu) {
  const query = state.filter.q.trim().toLowerCase();
  if (query && !`${menu.name} ${menu.category} ${menu.id}`.toLowerCase().includes(query)) return false;
  if (state.filter.vis === 'visible') return !menu.hidden;
  if (state.filter.vis === 'hidden') return Boolean(menu.hidden);
  return true;
}

const MC_TABLE_HEAD = '<thead><tr><th>เมนู (ID/ลำดับ/กำไรเบื้องต้น)</th><th>ชื่อ</th><th>หมวด · ราคาขาย</th><th>รูป · คำอธิบาย</th><th>ขั้นต่ำ · ลำดับ</th><th>ทุน/สถานะเว็บ</th><th>หมายเหตุภายใน</th></tr></thead>';

function rowHtml(menu, index) {
  const cost = costByMenuId(menu.id);
  return `<tr data-mc-row="${index}" class="${menu.hidden ? 'wait' : ''}">`
    + `<td><div style="display:flex;gap:.55rem;align-items:center;min-width:210px"><img src="${esc(menu.image)}" alt="" style="width:38px;height:38px;border-radius:8px;object-fit:cover;flex-shrink:0" onerror="this.style.display='none'"><div><div style="font-weight:800">${esc(menu.name)}${menu.hidden ? ' <span class="cp-tag wait">ซ่อนจากเว็บ</span>' : ''}</div><div class="cp-sub">ID ${esc(menu.id)} · ลำดับ ${esc(menu.sortOrder)}</div>${profitPreview(menu)}</div></div></td>`
    + `<td><input class="cp-input" type="text" value="${esc(menu.name)}" data-mc="${index}" data-field="name" aria-label="ชื่อเมนู" style="width:150px"></td>`
    + `<td><select class="cp-input" data-mc="${index}" data-field="category" aria-label="หมวด">${CATEGORIES.map((cat) => `<option value="${esc(cat)}"${cat === menu.category ? ' selected' : ''}>${esc(cat)}</option>`).join('')}</select><input class="cp-input mono" type="number" value="${esc(menu.price)}" min="1" step="1" data-mc="${index}" data-field="price" aria-label="ราคาขาย" style="width:84px;margin-top:.3rem"><div class="cp-sub">บาท/กล่อง</div></td>`
    + `<td><input class="cp-input" type="text" value="${esc(menu.image)}" data-mc="${index}" data-field="image" aria-label="รูป" style="width:150px" placeholder="img/..."><input class="cp-input" type="text" value="${esc(menu.desc || '')}" data-mc="${index}" data-field="desc" aria-label="คำอธิบาย" style="width:150px;margin-top:.3rem" placeholder="คำอธิบายสั้น"></td>`
    + `<td style="text-align:center"><input class="cp-input mono" type="number" value="${esc(menu.minPerMenu)}" min="1" step="1" data-mc="${index}" data-field="minPerMenu" aria-label="ขั้นต่ำ" style="width:64px"><div class="cp-sub">กล่อง/เมนู</div><input class="cp-input mono" type="number" value="${esc(menu.sortOrder)}" step="1" data-mc="${index}" data-field="sortOrder" aria-label="ลำดับแสดง" style="width:64px;margin-top:.3rem"><div class="cp-sub">ลำดับแสดง</div></td>`
    + `<td style="text-align:center"><div class="cp-sub">${cost ? esc(cost.label) : 'ไม่มีทุนผูก ID'}</div><label class="cp-check"><input type="checkbox"${menu.noMeat ? ' checked' : ''} data-mc="${index}" data-field="noMeat">ไม่เลือกเนื้อ</label><label class="cp-check"><input type="checkbox"${menu.hidden ? ' checked' : ''} data-mc="${index}" data-field="hidden">ซ่อนจากเว็บ</label></td>`
    + `<td><input class="cp-input" type="text" value="${esc(menu.internalNote || '')}" data-mc="${index}" data-field="internalNote" aria-label="หมายเหตุภายใน" style="width:140px" placeholder="ภายในเท่านั้น"></td>`
    + '</tr>';
}

// Screen-adaptive groups: one collapsible <details> per category (native,
// works without extra JS). Wide screens start expanded; narrow screens start
// collapsed; searching forces everything open. Falls back to the flat
// #mc-tbody table when the grouped container is absent.
function startExpanded() {
  if (state.filter.q.trim()) return true;
  try {
    if (window.matchMedia && window.matchMedia('(max-width: 720px)').matches) return false;
  } catch { /* default open */ }
  return true;
}

function updateCountLabel() {
  const count = $('#mc-count');
  if (!count || !state.working) return;
  const hidden = state.working.menus.filter((menu) => menu.hidden).length;
  count.textContent = `${state.working.menus.length} เมนู · แสดงบนเว็บ ${state.working.menus.length - hidden} · ซ่อน ${hidden}`;
}

// Checkbox clicks must NOT re-render the table. renderTable() replaces the
// rows while the browser is still dispatching the click that caused it, so the
// next click at the same screen position lands on a different menu — on
// 2026-09-29 that walked owner-hidden from 25 to 39 menus, one per save, and
// publish v72 put 32 live menus behind `deleted`. Toggling a flag only needs
// the row's own state and the counter refreshed, so patch those in place.
function refreshRowState(target) {
  const row = target.closest('tr[data-mc-row]');
  if (row) row.classList.toggle('wait', target.checked);
  updateCountLabel();
}

function renderTable() {
  if (!state.working) return;
  const rows = state.working.menus
    .map((menu, index) => ({ menu, index }))
    .filter(({ menu }) => matchesFilter(menu))
    .sort((a, b) => a.menu.sortOrder - b.menu.sortOrder || a.menu.id - b.menu.id);
  const count = $('#mc-count');
  if (count) updateCountLabel();
  const groups = $('#mc-groups');
  if (!groups) {
    const body = $('#mc-tbody');
    if (!body) return;
    body.innerHTML = rows.length
      ? rows.map(({ menu, index }) => rowHtml(menu, index)).join('')
      : '<tr><td colspan="7" style="text-align:center;padding:1.5rem;color:var(--text-muted)">ไม่พบเมนูที่ค้นหา</td></tr>';
    return;
  }
  if (!rows.length) {
    groups.innerHTML = '<p class="cp-sub" style="padding:1rem 0">ไม่พบเมนูที่ค้นหา</p>';
    return;
  }
  const open = startExpanded();
  const byCat = new Map();
  for (const row of rows) {
    const key = row.menu.category || 'อื่นๆ';
    if (!byCat.has(key)) byCat.set(key, []);
    byCat.get(key).push(row);
  }
  const ordered = [...CATEGORIES.filter((cat) => byCat.has(cat)), ...[...byCat.keys()].filter((cat) => !CATEGORIES.includes(cat))];
  groups.innerHTML = `<div class="cp-actions" style="display:flex;gap:.5rem;margin:.4rem 0"><button type="button" class="cp-btn ghost sm" data-mc-expand-all>ขยายทั้งหมด</button><button type="button" class="cp-btn ghost sm" data-mc-collapse-all>ย่อทั้งหมด</button></div>`
    + ordered.map((cat) => {
      const items = byCat.get(cat);
      const hiddenCount = items.filter(({ menu }) => menu.hidden).length;
      return `<details class="mc-cat" data-cat="${esc(cat)}"${open ? ' open' : ''}>`
        + `<summary style="cursor:pointer;font-weight:800;padding:.45rem 0">${esc(cat)} <span class="cp-sub">(${items.length} เมนู${hiddenCount ? ` · ซ่อน ${hiddenCount}` : ''})</span></summary>`
        + `<div class="cp-table-wrap"><table class="cp-table">${MC_TABLE_HEAD}<tbody>`
        + items.map(({ menu, index }) => rowHtml(menu, index)).join('')
        + '</tbody></table></div></details>';
    }).join('');
}

function setFormStatus(text, tone = '') {
  const box = $('#mc-form-status');
  if (!box) return;
  box.textContent = text;
  box.className = `cp-form-status${tone ? ` ${tone}` : ''}`;
}

function refreshPublish() {
  return fetch('/menu-publish-state', { cache: 'no-store' })
    .then((response) => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json(); })
    .then((info) => { state.publish = info; statusPill(); updateButtons(); })
    .catch(() => { state.publish = null; statusPill(); });
}

function updateButtons() {
  const dirty = isDirty();
  const save = $('#mc-save');
  const preview = $('#mc-publish-open');
  if (save) save.disabled = !dirty || state.busy || !state.loadOk;
  if (preview) preview.disabled = state.busy || !state.loadOk;
  const hint = $('#mc-dirty-hint');
  if (hint) hint.textContent = dirty ? 'มีการแก้ไขยังไม่บันทึก — กด “บันทึก” ก่อน (เว็บลูกค้ายังใช้ฉบับเดิมจนกว่าจะเผยแพร่)' : '';
}

async function load({ silent = false } = {}) {
  try {
    const [centralResponse, costsResponse] = await Promise.all([
      fetch('/menu-central', { cache: 'no-store' }),
      fetch('/owner-costs', { cache: 'no-store' }),
    ]);
    if (!centralResponse.ok || !costsResponse.ok) throw new Error(`HTTP ${centralResponse.status}/${costsResponse.status}`);
    state.saved = await centralResponse.json();
    state.working = clone(state.saved);
    state.costs = await costsResponse.json();
    state.loadOk = true;
    renderTable();
    updateButtons();
    await refreshPublish();
    if (!silent) setFormStatus(`โหลดฐานกลางแล้ว · รุ่น ${state.saved.version ?? 0}`, 'ok');
  } catch {
    state.loadOk = false;
    updateButtons();
    setFormStatus('โหลดฐานกลางไม่สำเร็จ — ตรวจว่าเซิร์ฟเวอร์ local กำลังทำงาน แล้วกด “โหลดข้อมูลใหม่”', 'bad');
  }
}

function onEdit(target) {
  const index = Number(target.dataset.mc);
  const field = target.dataset.field;
  const menu = state.working?.menus?.[index];
  if (!menu || !field) return;
  if (field === 'noMeat' || field === 'hidden') menu[field] = target.checked;
  else if (field === 'price' || field === 'minPerMenu' || field === 'sortOrder') {
    const value = target.value === '' ? '' : Number(target.value);
    menu[field] = value;
  } else menu[field] = target.value;
  updateButtons();
  setFormStatus('', '');
}

async function save({ confirmBulkHide = false } = {}) {
  if (state.busy || !state.working) return;
  state.busy = true;
  updateButtons();
  setFormStatus('กำลังบันทึกฐานกลาง…');
  try {
    const response = await fetch('/menu-central', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(confirmBulkHide ? { ...state.working, confirmBulkHide: true } : state.working),
    });
    if (response.status === 200) {
      const payload = await response.json();
      await load({ silent: true });
      setFormStatus(`บันทึกแล้ว ✓ รุ่น ${payload.version ?? ''} — เครื่องมือแอดมินใช้ข้อมูลล่าสุดทันที เว็บลูกค้ายังใช้ฉบับเผยแพร่เดิม`.trim(), 'ok');
      return;
    }
    let errors = [];
    let body = null;
    try {
      body = await response.json();
      if (Array.isArray(body?.errors)) errors = body.errors;
    } catch { /* keep generic */ }
    // Refused runaway bulk hide: nothing was written, so asking twice is safe.
    if (body?.bulkHide === true && !confirmBulkHide) {
      const ids = (body.newlyHidden || []).join(', ');
      setFormStatus(errors.join(' | '), 'bad');
      if (window.confirm(`คำสั่งนี้ซ่อนเมนูหลายรายการในครั้งเดียว (ID ${ids})\n\nโดยปกติหมายถึงว่าคลิกผิดแถว ไม่ใช่การตั้งใจซ่อนจริง\nกด "ตกลง" เพื่อซ่อนตามนี้ หรือ "ยกเลิก" เพื่อโหลดข้อมูลกลับไปเป็นฉบับที่บันทึกไว้`)) {
        // Release the busy flag first: the recursive call returns early on it.
        state.busy = false;
        await save({ confirmBulkHide: true });
      } else {
        await load({ silent: true });
        setFormStatus('ยกเลิกแล้ว — โหลดข้อมูลกลับไปเป็นฉบับที่บันทึกไว้', 'ok');
      }
      return;
    }
    if (!errors.length) errors = [`บันทึกไม่สำเร็จ (HTTP ${response.status}) — ฐานกลางยังไม่ถูกเปลี่ยน`];
    setFormStatus(errors.join(' | '), 'bad');
  } catch {
    setFormStatus('ติดต่อเซิร์ฟเวอร์ local ไม่ได้ — ยังไม่ได้บันทึก', 'bad');
  } finally {
    state.busy = false;
    updateButtons();
  }
}

function diffList(title, items, suffix = '') {
  if (!items.length) return '';
  return `<div style="margin:.5rem 0"><strong>${esc(title)} (${items.length})</strong><ul style="margin:.25rem 0;padding-left:1.2rem">`
    + items.map((item) => `<li>ID ${esc(item.id)} · ${esc(item.name)}${item.fields ? ` <span class="cp-sub">(${item.fields.join(', ')})</span>` : ''}${suffix}</li>`).join('')
    + '</ul></div>';
}

// The advertised "starting from" price must equal the cheapest dish a customer
// can actually order. If it does not, llms.txt / FAQ / JSON-LD will keep
// advertising a price nobody can buy, so warn before the owner publishes.
function warningPanel(startingPrice) {
  if (!startingPrice || startingPrice.ok || !startingPrice.warnings?.length) return '';
  return `<div style="margin:.75rem 0;padding:.7rem .85rem;border:1px solid #E4B768;background:#FFF9EC;border-radius:10px">`
    + '<strong style="color:#8A5A12">ตรวจราคาเริ่มต้นก่อนเผยแพร่</strong>'
    + `<ul style="margin:.35rem 0 0;padding-left:1.2rem;color:#8A5A12">`
    + startingPrice.warnings.map((w) => `<li>${esc(w)}</li>`).join('')
    + '</ul></div>';
}

async function openPreview() {
  const modal = $('#mc-modal');
  const body = $('#mc-modal-body');
  if (!modal || !body) return;
  body.innerHTML = '<p>กำลังเทียบกับฉบับที่เผยแพร่…</p>';
  modal.hidden = false;
  try {
    const response = await fetch('/menu-publish-preview', { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const info = await response.json();
    state.publish = info;
    statusPill();
    const diff = info.diff;
    if (!diff.hasChanges) {
      body.innerHTML = `<p><strong>ไม่มีรายการรอเผยแพร่เว็บ</strong></p><p class="cp-sub">ฐานกลางตรงกับฉบับเผยแพร่ล่าสุดแล้ว (เทียบเฉพาะฟิลด์สาธารณะ — การแก้เฉพาะต้นทุนไม่สร้างรายการรอเผยแพร่)</p>`
        + `<div class="cp-editor-actions"><button type="button" class="cp-btn ghost" data-mc-close>ปิด</button></div>`;
      return;
    }
    body.innerHTML = `<p><strong>รายการที่จะเปลี่ยนบนเว็บลูกค้าหลังกดยืนยัน</strong> <span class="cp-sub">· สถานะ: ${esc(info.statusTh)}</span></p>`
      + diffList('จะเพิ่ม', diff.added)
      + diffList('จะเปลี่ยน', diff.changed)
      + diffList('จะซ่อนจากเว็บ (ยังอยู่ในชุด/ประวัติ)', diff.hidden)
      + diffList('จะกลับมาแสดง', diff.shown)
      + (diff.removed.length ? `<p style="color:#DC2626;font-weight:800">พบ ${diff.removed.length} รายการหายจากฐานกลาง — ระบบห้ามลบเมนู ให้ใช้ “ซ่อนจากเว็บ” แทน กรุณาตรวจสอบก่อนเผยแพร่</p>` : '')
      + ((diff.toppingsChanged || diff.meatsChanged || diff.popularChanged) ? '<p class="cp-sub">มีการเปลี่ยนรายการท็อปปิ้ง/เนื้อ/ลำดับยอดนิยมร่วมด้วย</p>' : '')
      + (diff.costBlocked?.length ? diffList(`จะยังสั่งออนไลน์ไม่ได้ (แสดงชื่ออย่างเดียว · ${diff.costBlocked.length} รายการ)`, diff.costBlocked.map((item) => ({ id: item.id, name: `${item.name} — ${item.reason}` }))) : '')
      + warningPanel(info.startingPrice)
      + `<div style="margin:.75rem 0"><strong>ตัวอย่างหน้าเว็บ (8 รายการแรกที่จะแสดง)</strong><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:.5rem;margin-top:.4rem">`
      + info.preview.map((item) => `<div style="border:1px solid var(--border);border-radius:10px;overflow:hidden"><img src="${esc(item.image)}" alt="" style="width:100%;height:90px;object-fit:cover;display:block" onerror="this.style.display='none'"><div style="padding:.4rem .55rem"><div style="font-weight:800;font-size:.82rem">${esc(item.name)}</div><div class="cp-sub">${esc(item.category)} · ${item.quoteOnly ? '<strong style="color:#8A5A12">ราคาขอสอบถามทาง LINE</strong>' : `${esc(item.price)} บาท`}</div></div></div>`).join('')
      + '</div></div>'
      + `<p class="cp-sub">กดยืนยัน = สร้างไฟล์ในเครื่องเท่านั้น (สถานะ “เตรียมไฟล์แล้ว — รอขึ้นเว็บไซต์”) · ขึ้นเว็บจริงเป็นอีกขั้นตอนที่การ์ดด้านล่าง · ถ้าสร้างไฟล์ล้มเหลว ฉบับเดิมยังใช้งานได้และสถานะจะขึ้น “เผยแพร่ไม่สำเร็จ”</p>`
      + `<div class="cp-editor-actions"><button type="button" class="cp-btn" id="mc-publish-confirm">ยืนยันเผยแพร่</button><button type="button" class="cp-btn ghost" data-mc-close>ปิด</button><span class="cp-form-status" id="mc-publish-status"></span></div>`;
    $('#mc-publish-confirm')?.addEventListener('click', publish);
  } catch {
    body.innerHTML = `<p style="color:#DC2626;font-weight:800">เทียบฉบับเผยแพร่ไม่สำเร็จ — ตรวจเซิร์ฟเวอร์ local แล้วลองใหม่</p><div class="cp-editor-actions"><button type="button" class="cp-btn ghost" data-mc-close>ปิด</button></div>`;
  }
}

async function publish() {
  const statusBox = $('#mc-publish-status');
  const button = $('#mc-publish-confirm');
  if (button) button.disabled = true;
  if (statusBox) statusBox.textContent = 'กำลังเผยแพร่… (ตรวจไฟล์ก่อนสลับฉบับจริง)';
  try {
    const response = await fetch('/menu-publish', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    const body = await response.json().catch(() => ({}));
    if (response.status === 200 && body.ok) {
      if (statusBox) { statusBox.textContent = 'เตรียมไฟล์แล้ว ✓ — รอขึ้นเว็บไซต์ (ยังไม่ถือว่าเผยแพร่แล้ว)'; }
      await refreshPublish();
      renderTable();
      const record = (body.record || {}).file || {};
      const modalBody = $('#mc-modal-body');
      if (modalBody) {
        modalBody.insertAdjacentHTML('beforeend', `<p class="cp-sub" style="margin-top:.6rem">ไฟล์: ${((body.record || {}).file?.files || []).join(', ')} · ฉบับไฟล์ v${esc(record.fileVersion ?? '')}</p>`
          + `<p class="cp-sub">ขั้นต่อไป: กด “เผยแพร่ขึ้นเว็บจริง” ที่การ์ดด้านล่าง แล้วรอให้ระบบตรวจว่าเว็บจริงให้บริการฉบับนี้แล้ว — ขึ้น “เผยแพร่แล้ว” ต่อเมื่อตรวจพบจริงเท่านั้น</p>`);
      }
      return;
    }
    throw new Error(body.error || `HTTP ${response.status}`);
  } catch (error) {
    if (statusBox) statusBox.textContent = `เผยแพร่ไม่สำเร็จ: ${error.message} — ฉบับเดิมยังใช้งานได้`;
    await refreshPublish();
  } finally {
    if (button) button.disabled = false;
  }
}

function addMenu() {
  const name = ($('#mc-new-name')?.value || '').trim();
  const msg = $('#mc-new-msg');
  if (!name) { if (msg) msg.textContent = 'กรอกชื่อเมนูก่อน'; $('#mc-new-name')?.focus(); return; }
  const menus = state.working.menus;
  const maxId = menus.reduce((max, menu) => Math.max(max, menu.id), 0);
  const maxOrder = menus.reduce((max, menu) => Math.max(max, menu.sortOrder), -1);
  menus.push({
    id: maxId + 1,
    name,
    price: Number($('#mc-new-price')?.value) || 65,
    category: $('#mc-new-cat')?.value || CATEGORIES[0],
    image: ($('#mc-new-img')?.value || '').trim() || 'img/logo.jpg',
    desc: ($('#mc-new-desc')?.value || '').trim(),
    badge: 'ใหม่',
    minPerMenu: Number($('#mc-new-min')?.value) || 5,
    hidden: false,
    sortOrder: maxOrder + 1,
    noMeat: false,
    internalNote: '',
  });
  if ($('#mc-new-name') ) $('#mc-new-name').value = '';
  if (msg) msg.textContent = `เพิ่ม “${name}” (ID ${maxId + 1}) แล้ว — กด “บันทึก” เพื่อให้เครื่องมือแอดมินใช้ทันที`;
  renderTable();
  updateButtons();
}

function bind() {
  document.addEventListener('input', (event) => {
    const target = event.target;
    if (target.dataset?.mc !== undefined && target.dataset.field) onEdit(target);
  });
  document.addEventListener('change', (event) => {
    const target = event.target;
    if (target.dataset?.mc !== undefined && target.dataset.field) {
      onEdit(target);
      // Checkbox: patch the row in place (see refreshRowState). Everything else
      // re-renders, because a sort-order or category edit changes the row list.
      if (target.type === 'checkbox') refreshRowState(target);
      else renderTable();
    }
    if (target.id === 'mc-search') { state.filter.q = target.value; renderTable(); }
    if (target.id === 'mc-vis') { state.filter.vis = target.value; renderTable(); }
  });
  document.addEventListener('click', (event) => {
    const closer = event.target.closest('[data-mc-close]');
    if (closer) { $('#mc-modal').hidden = true; return; }
    if (event.target.closest('[data-mc-expand-all]')) {
      document.querySelectorAll('#mc-groups details.mc-cat').forEach((el) => { el.open = true; });
      return;
    }
    if (event.target.closest('[data-mc-collapse-all]')) {
      document.querySelectorAll('#mc-groups details.mc-cat').forEach((el) => { el.open = false; });
    }
  });
  $('#mc-save')?.addEventListener('click', save);
  $('#mc-publish-open')?.addEventListener('click', openPreview);
  $('#mc-reload')?.addEventListener('click', () => load());
  $('#mc-refresh-profit')?.addEventListener('click', () => load({ silent: true }));
  $('#mc-add')?.addEventListener('click', addMenu);
}

bind();
await load({ silent: true });
