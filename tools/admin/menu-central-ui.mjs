// Owner-only central menu manager (LOCAL ONLY, never deployed).
// Single screen to add/edit name, image, product level, description, selling
// price, display order and visibility per stable menu ID.
//
// A menu has ONE level (classic / signature / executive) declared in
// data/business-rules.json, and nothing else to file it under. There is no
// category anywhere: the level is what the customer pages, the calculator, the
// API and the LINE bot all group and filter by, so the two can never disagree.
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

const state = {
  saved: null, working: null,
  publish: null, busy: false, loadOk: false,
  filter: { q: '', tier: '', vis: 'all' },
};

const clone = (value) => JSON.parse(JSON.stringify(value));
// Menus, toppings, side items and the popular order are all owner-editable, so
// "unsaved work" has to look at every one of them. Comparing only menus would
// leave the save button disabled after a topping, side-item or popular edit.
const isDirty = () => Boolean(state.saved && state.working)
  && ['menus', 'toppings', 'sideItems', 'popular'].some(
    (key) => JSON.stringify(state.working[key] ?? null) !== JSON.stringify(state.saved[key] ?? null),
  );

// ---------------------------------------------------------------------------
// Draft recovery (local only).
// The owner edits prices for a while and then closes the tab or the laptop
// sleeps. Without this every unsaved edit is gone. The draft is mirrored into
// localStorage on every keystroke (debounced) and offered back on the next
// load. It never overwrites the saved draft: the owner has to choose.
// ---------------------------------------------------------------------------
const DRAFT_KEY = 'eedhalal.menuCentral.draft';

function draftBackup() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeDraftBackup() {
  if (!state.working || !isDirty()) return;
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({
      baseVersion: state.saved?.version ?? null,
      savedAt: new Date().toISOString(),
      working: state.working,
    }));
  } catch { /* storage full or blocked: recovery is best effort */ }
}

function clearDraftBackup() {
  try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
}

let draftTimer = null;
function scheduleDraftBackup() {
  if (draftTimer) clearTimeout(draftTimer);
  draftTimer = setTimeout(writeDraftBackup, 400);
}

// Offer back an unsaved draft. Only when it was based on the version we just
// loaded, so a stale backup from an older revision can never resurrect itself.
function offerDraftRestore() {
  const backup = draftBackup();
  if (!backup?.working || !state.saved) return false;
  if ((backup.baseVersion ?? null) !== (state.saved.version ?? null)) {
    clearDraftBackup();
    return false;
  }
  if (!JSON.stringify(backup.working.menus)) return false;
  const changed = backup.working.menus.filter((menu, index) => JSON.stringify(menu) !== JSON.stringify(state.saved.menus[index]));
  if (!changed.length) {
    clearDraftBackup();
    return false;
  }
  const when = new Date(backup.savedAt).toLocaleString('th-TH');
  const summary = changed.slice(0, 6).map((m) => `#${m.id} ${m.name}`).join(', ')
    + (changed.length > 6 ? ` (+${changed.length - 6})` : '');
  if (!window.confirm(`พบร่างที่ยังไม่ได้บันทึกจาก ${when}\n${summary}\n\nกู้คืนร่างนี้? (กด "ตกลง" เพื่อกู้คืน, "ยกเลิก" เพื่อใช้ฉบับที่บันทึกไว้)`)) {
    clearDraftBackup();
    return false;
  }
  state.working = backup.working;
  renderTable();
  updateButtons();
  setFormStatus(`กู้คืนร่างที่ยังไม่บันทึกแล้ว (${changed.length} รายการ) — กด "บันทึก" เพื่อเก็บถาวร`, 'ok');
  return true;
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
    + `<button type="button" class="cp-btn" id="mc-release-open">อัปเดตเว็บทั้งหมด</button>`
    + `<button type="button" class="cp-btn ghost sm" id="mc-verify-live">ตรวจเว็บจริงตอนนี้</button>`
    + `<button type="button" class="cp-btn ghost sm" id="mc-deploy-open"${info.deployEnabled ? '' : ' disabled title="ยังไม่เปิดการขึ้นเว็บอัตโนมัติ"'}>เผยแพร่ขึ้นเว็บจริง</button>`
    + `<span class="cp-form-status" id="mc-deploy-status"></span></div>`
    + '<div id="mc-release-panel"></div>'
    + `<div id="mc-backups"><p class="cp-sub">กำลังโหลดรายการสำรอง…</p></div>`;
  $('#mc-verify-live')?.addEventListener('click', verifyLive);
  $('#mc-deploy-open')?.addEventListener('click', openDeployConfirm);
  $('#mc-release-open')?.addEventListener('click', openRelease);
  loadBackups();
}

/** The single-button path: one gate, then stage + push + wait + verify. */
function openRelease() {
  runFullRelease();
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
  if (query && !`${menu.name} ${menu.tier} ${menu.id}`.toLowerCase().includes(query)) return false;
  if (state.filter.tier && menu.tier !== state.filter.tier) return false;
  if (state.filter.vis === 'visible') return !menu.hidden;
  if (state.filter.vis === 'hidden') return Boolean(menu.hidden);
  return true;
}

// Tier options come from business-rules.json via the release card, so the owner
// always picks from the levels the website and the bot actually publish.
const TIER_FALLBACK_LABELS = { classic: 'Classic', signature: 'Signature', executive: 'Executive' };

function tierOptions(current) {
  const known = new Set(Object.keys(TIER_FALLBACK_LABELS));
  const declared = state.publish?.tiers || [];
  const options = declared.length
    ? declared
      .map((tier) => `<option value="${esc(tier.id)}"${tier.id === current ? ' selected' : ''}>${esc(tier.nameTh || tier.nameEn || tier.id)}</option>`)
      .join('')
    : Object.keys(TIER_FALLBACK_LABELS)
      .map((id) => `<option value="${id}"${id === current ? ' selected' : ''}>${TIER_FALLBACK_LABELS[id]}</option>`)
      .join('');
  const extra = current && !known.has(current)
    ? `<option value="${esc(current)}" selected>${esc(current)} (ไม่อยู่ในระดับที่ประกาศ)</option>`
    : '';
  return options + extra;
}

// One card per menu. The common job — editing a price — is the biggest thing on
// the card; everything else stays tucked behind "รายละเอียด" so a 44-menu
// catalogue stays scannable on a phone.
function cardHtml(menu, index) {
  const flags = [
    menu.hidden ? '<span class="mc-flag is-off">ซ่อนจากเว็บ</span>' : '<span class="mc-flag is-on">ขึ้นเว็บ</span>',
    `<span class="mc-flag mc-id">ID ${esc(menu.id)}</span>`,
  ].join('');
  return `<article class="mc-card${menu.hidden ? ' is-hidden' : ''}" data-mc-row="${index}">
    <div class="mc-card-top">
      <img class="mc-thumb" src="${esc(menu.image)}" alt="" loading="lazy" onerror="this.remove()">
      <div class="mc-card-id">
        <label class="mc-label">ชื่อเมนู</label>
        <input class="cp-input" type="text" value="${esc(menu.name)}" data-mc="${index}" data-field="name" aria-label="ชื่อเมนู">
        <label class="mc-label mc-tier-label">ระดับสินค้า
          <select class="cp-input" data-mc="${index}" data-field="tier" aria-label="ระดับสินค้า ${esc(menu.name)}">${tierOptions(menu.tier)}</select>
        </label>
        <div class="mc-flags">${flags}</div>
      </div>
      <div class="mc-card-price">
        <label class="mc-label" for="p-${index}">ราคาขาย</label>
        <input id="p-${index}" class="cp-input mc-price" type="number" min="1" step="1" value="${esc(menu.price)}" data-mc="${index}" data-field="price" aria-label="ราคาขาย ${esc(menu.name)}">
        <span class="mc-unit">บาท/กล่อง</span>
      </div>
    </div>
    <details class="mc-more">
      <summary>รายละเอียดอื่น</summary>
      <div class="mc-grid">
        <label class="mc-label">ขั้นต่ำ (กล่อง)
          <input class="cp-input" type="number" min="1" step="1" value="${esc(menu.minPerMenu)}" data-mc="${index}" data-field="minPerMenu" aria-label="ขั้นต่ำ">
        </label>
        <label class="mc-label">ลำดับแสดง
          <input class="cp-input" type="number" step="1" value="${esc(menu.sortOrder)}" data-mc="${index}" data-field="sortOrder" aria-label="ลำดับแสดง">
        </label>
        <label class="mc-label">รูป
          <input class="cp-input" type="text" value="${esc(menu.image)}" data-mc="${index}" data-field="image" aria-label="รูป" placeholder="img/...">
        </label>
        <label class="mc-label mc-span">คำอธิบาย (ลูกค้าเห็น)
          <input class="cp-input" type="text" value="${esc(menu.desc || '')}" data-mc="${index}" data-field="desc" aria-label="คำอธิบาย" placeholder="คำอธิบายสั้น">
        </label>
        <label class="mc-label mc-span">หมายเหตุภายใน (ลูกค้าไม่เห็น)
          <input class="cp-input" type="text" value="${esc(menu.internalNote || '')}" data-mc="${index}" data-field="internalNote" aria-label="หมายเหตุภายใน">
        </label>
      </div>
      <div class="mc-toggles">
        <label class="cp-check"><input type="checkbox"${menu.hidden ? ' checked' : ''} data-mc="${index}" data-field="hidden">ซ่อนจากเว็บ</label>
        <button type="button" class="cp-btn danger sm" data-mc-delete="${index}">ลบถาวร</button>
      </div>
    </details>
  </article>`;
}

// Level chips: "ทั้งหมด" plus one chip per level that actually has menus, in the
// order data/business-rules.json declares them.
function renderTierChips() {
  const box = $('#mc-tiers');
  if (!box || !state.working) return;
  const counts = new Map();
  for (const menu of state.working.menus) {
    const key = menu.tier || 'classic';
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const chips = [['all', `ทั้งหมด (${state.working.menus.length})`]];
  for (const id of Object.keys(TIER_FALLBACK_LABELS)) {
    if (counts.has(id)) chips.push([id, `${TIER_FALLBACK_LABELS[id]} (${counts.get(id)})`]);
  }
  for (const [key, count] of counts) {
    if (!(key in TIER_FALLBACK_LABELS)) chips.push([key, `${key} (${count})`]);
  }
  box.innerHTML = chips
    .map(([key, label]) => `<button type="button" class="mc-chip${state.filter.tier === key ? ' is-on' : ''}" data-tier="${esc(key)}">${esc(label)}</button>`)
    .join('');
}

function updateCountLabel() {
  const count = $('#mc-count');
  if (!count || !state.working) return;
  const hidden = state.working.menus.filter((menu) => menu.hidden).length;
  count.textContent = `${state.working.menus.length} เมนู · ขึ้นเว็บ ${state.working.menus.length - hidden} · ซ่อน ${hidden}`;
}

// Checkbox clicks must NOT re-render. renderCards() replaces the nodes while the
// browser is still dispatching the click that caused it, so the next click at the
// same screen position lands on a different menu — on 2026-09-29 that walked
// owner-hidden from 25 to 39 menus, one per save, and publish v72 put 32 live
// menus behind `deleted`. Toggling a flag only needs the card's own state and the
// counter refreshed, so patch those in place.
function refreshRowState(target) {
  const card = target.closest('[data-mc-row]');
  if (card) {
    card.classList.toggle('is-hidden', Boolean(state.working.menus[Number(card.dataset.mcRow)]?.hidden));
  }
  updateCountLabel();
}

function renderTable() {
  if (!state.working) return;
  renderTierChips();
  renderToppings();
  renderSideItems();
  const rows = state.working.menus
    .map((menu, index) => ({ menu, index }))
    .filter(({ menu }) => matchesFilter(menu))
    .sort((a, b) => a.menu.sortOrder - b.menu.sortOrder || a.menu.id - b.menu.id);
  updateCountLabel();
  const groups = $('#mc-groups');
  if (!groups) return;
  if (!rows.length) {
    groups.innerHTML = '<p class="cp-empty">ไม่พบเมนูที่ค้นหา — ลองล้างคำค้นหาหรือเลือกระดับอื่น</p>';
    return;
  }
  // Cards are grouped by level, in the order business-rules.json declares them,
  // so the screen reads the same way the customer pages do.
  const byTier = new Map();
  for (const row of rows) {
    const key = row.menu.tier || 'classic';
    if (!byTier.has(key)) byTier.set(key, []);
    byTier.get(key).push(row);
  }
  const ordered = [
    ...Object.keys(TIER_FALLBACK_LABELS).filter((id) => byTier.has(id)),
    ...[...byTier.keys()].filter((id) => !(id in TIER_FALLBACK_LABELS)),
  ];
  groups.innerHTML = ordered
    .map((tier) => {
      const items = byTier.get(tier);
      const label = TIER_FALLBACK_LABELS[tier] || tier;
      return `<section class="mc-group">
        <h3 class="mc-group-head">${esc(label)} <span>${items.length} เมนู</span></h3>
        <div class="mc-grid-cards">${items.map(({ menu, index }) => cardHtml(menu, index)).join('')}</div>
      </section>`;
    })
    .join('');
}

// Toppings: the shared add-on list every dish can take. Price 0 is refused on
// save (the customer menu only offers add-ons with a price), so the warning
// here is the first place the owner hears about it.
function renderToppings() {
  const box = $('#mc-toppings');
  if (!box || !state.working) return;
  const list = Array.isArray(state.working.toppings) ? state.working.toppings : [];
  if (!list.length) {
    box.innerHTML = '<p class="cp-sub">ยังไม่มีท็อปปิ้ง — เพิ่มได้จากช่องด้านล่าง (ถ้าไม่มีท็อปปิ้ง หน้าเมนูลูกค้าจะไม่มีตัวเลือกเพิ่ม)</p>';
    return;
  }
  box.innerHTML = list.map((item, index) => `
    <div class="cp-add-row" data-tp-row="${index}">
      <label class="mc-label">ชื่อ
        <input class="cp-input" type="text" value="${esc(item.name)}" data-tp="${index}" data-tp-field="name" aria-label="ชื่อท็อปปิ้ง">
      </label>
      <label class="mc-label">ราคา (บาท)
        <input class="cp-input narrow" type="number" min="1" step="1" value="${esc(item.price)}" data-tp="${index}" data-tp-field="price" aria-label="ราคาท็อปปิ้ง ${esc(item.name)}">
      </label>
      <button type="button" class="cp-btn danger sm" data-tp-delete="${index}">ลบ</button>
    </div>`).join('');
}

function addTopping() {
  const name = ($('#mc-tp-name')?.value || '').trim();
  const msg = $('#mc-tp-msg');
  const list = Array.isArray(state.working?.toppings) ? state.working.toppings : (state.working.toppings = []);
  if (!name) { if (msg) msg.textContent = 'กรอกชื่อท็อปปิ้งก่อน'; $('#mc-tp-name')?.focus(); return; }
  if (list.some((item) => item.name === name)) { if (msg) msg.textContent = `มี “${name}” อยู่แล้ว`; return; }
  const price = Number($('#mc-tp-price')?.value) || 0;
  list.push({ name, price });
  if ($('#mc-tp-name')) $('#mc-tp-name').value = '';
  if (msg) msg.textContent = `เพิ่ม “${name}” แล้ว${price > 0 ? '' : ' — ราคา 0 จะไม่แสดงบนเว็บ ต้องมากกว่า 0'}`;
  renderToppings();
  updateButtons();
  scheduleDraftBackup();
}

function deleteTopping(index) {
  const list = state.working?.toppings;
  const item = list?.[index];
  if (!item) return;
  if (!window.confirm(`ลบท็อปปิ้ง “${item.name}” (${item.price} บาท) ออกจากรายการท็อปปิ้ง?\n\nเมนูที่เคยเลือกท็อปปิ้งนี้ไว้ในรายการสั่งซื้อเก่าจะแสดงชื่อท็อปปิ้งที่ไม่มีราคาแล้ว`)) return;
  list.splice(index, 1);
  renderToppings();
  updateButtons();
  scheduleDraftBackup();
  setFormStatus(`ลบท็อปปิ้ง “${item.name}” ออกจากฉบับร่างแล้ว — กด “บันทึก” เพื่อเก็บถาวร`, 'ok');
}

// Side items: the SECOND dish of the Signature box (ข้าว / อาหารหลัก /
// อาหารเมนูที่ 2 / ผัก). Unlike a topping it is a real dish the guest eats, so
// it carries a name in two languages, an internal cost that never leaves this
// machine, and a price adjustment the owner confirms later. Until `priceStatus`
// is `ready` no renderer may show a number for it.
//
// `kind` is not shown to the customer (the page says "อาหารเมนูที่ 2"); it says
// what kind of dish this is, because cooking type changes cost and packing:
//   side / soup_curry -> may sit in a Signature box
//   dessert          -> sweet, needs a corrugated box, so it is an Executive
//                       item and must not be listed as a Signature choice
const SIDE_ITEM_KIND_OPTIONS = [
  { value: 'side', label: 'อาหารรองคาว (ผัด/ทอด)' },
  { value: 'soup_curry', label: 'ต้ม / แกง' },
  { value: 'dessert', label: 'ของหวาน (กล่องลูกฟูก / Executive)' },
];

function renderSideItems() {
  const box = $('#mc-sideitems');
  if (!box || !state.working) return;
  const list = Array.isArray(state.working.sideItems) ? state.working.sideItems : [];
  if (!list.length) {
    box.innerHTML = '<p class="cp-sub">ยังไม่มีอาหารรอง — เพิ่มได้จากช่องด้านล่าง (ยังไม่มีรายการ หน้าเว็บจะยังไม่แสดงชื่ออาหารรอง แต่ข้อความวิธีเลือกยังทำงานตามปกติ)</p>';
    return;
  }
  box.innerHTML = list.map((item, index) => {
    const ready = item.priceStatus === 'ready' && Number.isFinite(Number(item.priceAdjustment));
    return `
    <div class="cp-add-row" data-si-row="${index}">
      <label class="mc-label">id
        <input class="cp-input narrow" type="text" value="${esc(item.id)}" data-si="${index}" data-si-field="id" aria-label="id อาหารรอง">
      </label>
      <label class="mc-label">ชื่อไทย
        <input class="cp-input" type="text" value="${esc(item.nameTh)}" data-si="${index}" data-si-field="nameTh" aria-label="ชื่ออาหารรองภาษาไทย">
      </label>
      <label class="mc-label">ชื่ออังกฤษ
        <input class="cp-input" type="text" value="${esc(item.nameEn || '')}" data-si="${index}" data-si-field="nameEn" aria-label="ชื่ออาหารรองภาษาอังกฤษ">
      </label>
      <label class="mc-label">ประเภท
        <select class="cp-input narrow" data-si="${index}" data-si-field="kind" aria-label="ประเภทอาหารรอง ${esc(item.nameTh)}">
          ${SIDE_ITEM_KIND_OPTIONS.map((option) => `<option value="${option.value}"${item.kind === option.value ? ' selected' : ''}>${option.label}</option>`).join('')}
        </select>
      </label>
      <label class="mc-label">ต้นทุน (บาท)
        <input class="cp-input narrow" type="number" min="0" step="1" value="${item.cost ?? ''}" data-si="${index}" data-si-field="cost" aria-label="ต้นทุนอาหารรอง ${esc(item.nameTh)}">
      </label>
      <label class="mc-label">ราคาเพิ่ม (บาท)
        <input class="cp-input narrow" type="number" min="0" step="1" value="${item.priceAdjustment ?? ''}" data-si="${index}" data-si-field="priceAdjustment" aria-label="ราคาเพิ่มอาหารรอง ${esc(item.nameTh)}">
      </label>
      <label class="mc-label">สถานะราคา
        <select class="cp-input narrow" data-si="${index}" data-si-field="priceStatus" aria-label="สถานะราคาอาหารรอง ${esc(item.nameTh)}">
          <option value="pending"${ready ? '' : ' selected'}>รอยืนยัน</option>
          <option value="ready"${ready ? ' selected' : ''}>ยืนยันแล้ว</option>
        </select>
      </label>
      <label class="mc-label" title="แสดงชื่อบนหน้าเว็บได้ไหม">
        <span class="cp-inline">
          <input type="checkbox" data-si="${index}" data-si-field="public"${item.public ? ' checked' : ''}> ขึ้นเว็บ
        </span>
      </label>
      <label class="mc-label" title="ยังใช้อยู่ไหม">
        <span class="cp-inline">
          <input type="checkbox" data-si="${index}" data-si-field="active"${item.active === false ? '' : ' checked'}> ใช้งาน
        </span>
      </label>
      <button type="button" class="cp-btn danger sm" data-si-delete="${index}">ลบ</button>
    </div>`;
  }).join('');
}

function addSideItem() {
  const msg = $('#mc-si-msg');
  const list = Array.isArray(state.working?.sideItems) ? state.working.sideItems : (state.working.sideItems = []);
  const nameTh = ($('#mc-si-name-th')?.value || '').trim();
  const nameEn = ($('#mc-si-name-en')?.value || '').trim();
  if (!nameTh) { if (msg) msg.textContent = 'กรอกชื่ออาหารรองภาษาไทยก่อน'; $('#mc-si-name-th')?.focus(); return; }
  if (!nameEn) { if (msg) msg.textContent = 'กรอกชื่อภาษาอังกฤษด้วย (หน้าเว็บภาษาอังกฤษใช้ชื่อนี้)'; $('#mc-si-name-en')?.focus(); return; }
  // Suggest the next free side-NNN id so the owner never has to invent one.
  let next = 1;
  while (list.some((item) => item.id === `side-${String(next).padStart(3, '0')}`)) next += 1;
  const id = `side-${String(next).padStart(3, '0')}`;
  list.push({
    id,
    nameTh,
    nameEn,
    kind: 'side',
    cost: null,
    priceAdjustment: null,
    priceStatus: 'pending',
    active: true,
    // Visible by default: the owner's job is to decide WHEN a dish goes on the
    // web, and switching one off is a single checkbox.
    public: true,
  });
  if ($('#mc-si-name-th')) $('#mc-si-name-th').value = '';
  if ($('#mc-si-name-en')) $('#mc-si-name-en').value = '';
  if (msg) msg.textContent = `เพิ่ม ${nameTh} (${id}) แล้ว — ชื่อจะขึ้นเว็บทันที ถ้ายังไม่พร้อมให้เอาติ๊ก “ขึ้นเว็บ” ออก`;
  renderSideItems();
  updateButtons();
  scheduleDraftBackup();
}

function onSideItemEdit(target) {
  const index = Number(target.dataset.si);
  const field = target.dataset.siField;
  const item = state.working?.sideItems?.[index];
  if (!item || !field) return;
  const msg = $('#mc-si-msg');
  if (field === 'cost') {
    const value = target.value === '' ? null : Number(target.value);
    item.cost = Number.isFinite(value) && value >= 0 ? value : null;
  } else if (field === 'priceAdjustment') {
    const value = target.value === '' ? null : Number(target.value);
    const next = Number.isFinite(value) && value > 0 ? value : null;
    item.priceAdjustment = next;
    // A number without a confirmed status must not reach the web: the publish
    // guard refuses it, and the owner is told here instead of at publish time.
    if (next === null) item.priceStatus = 'pending';
  } else if (field === 'priceStatus') {
    if (target.value === 'ready' && !Number.isFinite(Number(item.priceAdjustment))) {
      item.priceStatus = 'pending';
      if (msg) msg.textContent = 'ยังตั้ง “ยืนยันแล้ว” ไม่ได้ — ต้องมีราคาเพิ่มเป็นตัวเลขก่อน';
    } else {
      item.priceStatus = target.value === 'ready' ? 'ready' : 'pending';
    }
  } else if (field === 'public' || field === 'active') {
    item[field] = target.checked === true;
  } else {
    item[field] = target.value;
  }
  renderSideItems();
  updateButtons();
  scheduleDraftBackup();
  setFormStatus('', '');
}

function deleteSideItem(index) {
  const list = state.working?.sideItems;
  const item = list?.[index];
  if (!item) return;
  if (!window.confirm(`ลบอาหารรอง “${item.nameTh}” (${item.id}) ออกจากรายการ?\n\nถ้า business-rules.json ยังอ้าง id นี้อยู่ ตัวตรวจจะแจ้งว่าอ้างไม่ถูกต้อง — ให้เอา id ออกจาก sideChoices ของระดับ Signature ด้วย`)) return;
  list.splice(index, 1);
  renderSideItems();
  updateButtons();
  scheduleDraftBackup();
  setFormStatus(`ลบอาหารรอง “${item.nameTh}” ออกจากฉบับร่างแล้ว — กด “บันทึก” เพื่อเก็บถาวร`, 'ok');
}

function onToppingEdit(target) {
  const index = Number(target.dataset.tp);
  const field = target.dataset.tpField;
  const item = state.working?.toppings?.[index];
  if (!item || !field) return;
  if (field === 'price') {
    const value = target.value === '' ? 0 : Number(target.value);
    item.price = Number.isFinite(value) ? Math.max(0, value) : 0;
  } else {
    item.name = target.value;
  }
  updateButtons();
  scheduleDraftBackup();
  setFormStatus('', '');
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
    const centralResponse = await fetch('/menu-central', { cache: 'no-store' });
    if (!centralResponse.ok) throw new Error(`HTTP ${centralResponse.status}`);
    state.saved = await centralResponse.json();
    state.working = clone(state.saved);
    state.loadOk = true;
    renderTable();
    updateButtons();
    await refreshPublish();
    if (!silent) {
      const restored = offerDraftRestore();
      if (!restored) setFormStatus(`โหลดฐานกลางแล้ว · รุ่น ${state.saved.version ?? 0}`, 'ok');
    }
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
  if (field === 'hidden') menu[field] = target.checked;
  else if (field === 'price' || field === 'minPerMenu' || field === 'sortOrder') {
    const value = target.value === '' ? '' : Number(target.value);
    menu[field] = value;
  } else menu[field] = target.value;
  scheduleDraftBackup();
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
      clearDraftBackup();
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
function warningPanel(tierPrices) {
  if (!tierPrices || tierPrices.ok || !tierPrices.warnings?.length) return '';
  return `<div style="margin:.75rem 0;padding:.7rem .85rem;border:1px solid #E4B768;background:#FFF9EC;border-radius:10px">`
    + '<strong style="color:#8A5A12">ตรวจราคาเริ่มต้นก่อนเผยแพร่</strong>'
    + `<ul style="margin:.35rem 0 0;padding-left:1.2rem;color:#8A5A12">`
    + tierPrices.warnings.map((w) => `<li>${esc(w)}</li>`).join('')
    + '</ul></div>';
}

function unassignedTierPanel(tierPrices) {
  const items = tierPrices?.unassigned || [];
  if (!items.length) return '';
  return `<div style="margin:.75rem 0;padding:.7rem .85rem;border:1px solid var(--border);border-radius:10px">`
    + `<strong>เมนูที่ยังไม่ได้จัดระดับ (${items.length})</strong> <span class="cp-sub">· ระดับที่ยังไม่ได้เลือกจะถูกนับเป็น classic · ชุดที่มีอาหารหลัก 1 อย่าง + อาหารรองที่จับคู่ไว้ 1 อย่าง ในกล่อง 4 ช่อง ควรเป็น signature</span>`
    + `<ul style="margin:.35rem 0 0;padding-left:1.2rem">`
    + items.map((item) => `<li>${esc(item.name)} (ID ${item.id})</li>`).join('')
    + '</ul></div>';
}

function tierPanel(state) {
  const changes = state?.tierChanges || [];
  if (!changes.length) return '';
  const rows = changes.map((tier) => {
    const price = tier.to === null ? 'ยังไม่มีชุดเปิดขาย' : `${tier.to} บาท`;
    const source = tier.sourceName ? `${tier.sourceName} (ID ${tier.sourceId})` : '—';
    const move = tier.from === null && tier.to === null
      ? 'ไม่เปลี่ยน'
      : tier.from === tier.to
        ? 'ไม่เปลี่ยน'
        : `${tier.from === null ? 'ยังไม่มีราคา' : `${tier.from} บาท`} → ${tier.to === null ? 'ยังไม่มีชุดเปิดขาย' : `${tier.to} บาท`}`;
    return `<tr><th scope="row">${esc(tier.nameTh)}<br><span class="cp-sub">${esc(tier.nameEn)}</span></th>`
      + `<td>${esc(price)}</td><td>${esc(source)}</td><td>${esc(move)}</td></tr>`;
  }).join('');
  return '<div style="margin:.75rem 0">'
    + '<strong>ระดับข้าวกล่องที่จะขึ้นเว็บ</strong> <span class="cp-sub">· ราคาเริ่มต้นคำนวณจากชุดที่เปิดขายและแสดงบนเว็บเท่านั้น ระดับที่ยังไม่มีชุดจะขึ้น “สอบถามรายละเอียดชุดอาหาร”</span>'
    + '<table class="tier-admin-table"><thead><tr><th scope="col">ระดับ</th><th scope="col">ราคาเริ่มต้น</th><th scope="col">ชุดที่เป็นที่มาของราคา</th><th scope="col">เทียบกับที่เผยแพร่อยู่</th></tr></thead>'
    + `<tbody>${rows}</tbody></table></div>`;
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
      body.innerHTML = `<p><strong>ไม่มีรายการรอเผยแพร่เว็บ</strong></p><p class="cp-sub">ฐานกลางตรงกับฉบับเผยแพร่ล่าสุดแล้ว (เทียบเฉพาะฟิลด์สาธารณะ)</p>`
        + `<div class="cp-editor-actions"><button type="button" class="cp-btn ghost" data-mc-close>ปิด</button></div>`;
      return;
    }
    body.innerHTML = `<p><strong>รายการที่จะเปลี่ยนบนเว็บลูกค้าหลังกดยืนยัน</strong> <span class="cp-sub">· สถานะ: ${esc(info.statusTh)}</span></p>`
      + diffList('จะเพิ่ม', diff.added)
      + diffList('จะเปลี่ยน', diff.changed)
      + diffList('จะซ่อนจากเว็บ (ยังอยู่ในชุด/ประวัติ)', diff.hidden)
      + diffList('จะกลับมาแสดง', diff.shown)
      + (diff.removed.length
        ? `<p style="color:#DC2626;font-weight:800">${diff.removed.length} รายการจะหายถาวรจากระบบ (ลบถาวรจากฐานกลาง)</p>`
          + `<div style="color:#DC2626">${diffList('จะหายไปเลย', diff.removed).replace('<ul', '<ul style="color:#DC2626"')}</div>`
          + '<p class="cp-sub">หลังเผยแพร่ เมนูเหล่านี้จะไม่มีราคาในไฟล์ จะไม่โชว์บนหน้าเว็บและหน้าเมนู และบอทจะไม่อ้างราคาเมนูเหล่านี้อีก กู้คืนได้จากไฟล์สำรองก่อนบันทึกเท่านั้น</p>'
        : '')
      + ((diff.toppingsChanged || diff.sideItemsChanged || diff.popularChanged) ? '<p class="cp-sub">มีการเปลี่ยนรายการท็อปปิ้ง/อาหารรอง/ลำดับยอดนิยมร่วมด้วย</p>' : '')
      + (diff.costBlocked?.length ? diffList(`ปิดราคา — ยังไม่มีราคาที่จะคิดให้ลูกค้า (${diff.costBlocked.length} รายการ)`, diff.costBlocked.map((item) => ({ id: item.id, name: `${item.name} — ${item.reason}` }))) : '')
      + warningPanel(info.tierPrices)
      + unassignedTierPanel(info.tierPrices)
      + tierPanel(info)
      + `<div style="margin:.75rem 0"><strong>ตัวอย่างหน้าเว็บ (8 รายการแรกที่จะแสดง)</strong> <span class="cp-sub">· หน้าเว็บเป็นแค่แคตตาล็อก ไม่มีราคาและไม่มีระบบสั่งออนไลน์ ลูกค้าเลือกเมนูแล้วทัก LINE</span><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:.5rem;margin-top:.4rem">`
      + info.preview.map((item) => `<div style="border:1px solid var(--border);border-radius:10px;overflow:hidden"><img src="${esc(item.image)}" alt="" style="width:100%;height:90px;object-fit:cover;display:block" onerror="this.style.display='none'"><div style="padding:.4rem .55rem"><div style="font-weight:800;font-size:.82rem">${esc(item.name)}</div><div class="cp-sub">${esc(TIER_FALLBACK_LABELS[item.tier] || item.tier || '')}</div></div></div>`).join('')
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

// ---------------------------------------------------------------------------
// One-button release: publish -> push -> wait -> verify.
//
// The owner used to click through three separate panels and read two modals.
// The safety gate stays exactly where it was (nothing is written or pushed
// until the diff has been shown and confirmed), but once confirmed the whole
// chain runs by itself and reports each step, so "published" is never a guess.
// ---------------------------------------------------------------------------
const RELEASE_STEPS = [
  { key: 'preview', label: 'ตรวจรายการเปลี่ยนแปลง' },
  { key: 'stage', label: 'สร้างไฟล์ฉบับใหม่' },
  { key: 'push', label: 'ส่งขึ้น GitHub' },
  { key: 'wait', label: 'รอเว็บจริงอัปเดต' },
  { key: 'verify', label: 'ตรวจว่าเว็บจริงตรงกับฉบับนี้' },
];

function renderReleaseProgress(box, steps) {
  box.innerHTML = `<ol style="margin:.6rem 0 0;padding-left:1.3rem">`
    + steps.map((step) => {
      const tone = { ok: '#1d6b3e', bad: '#DC2626', wait: '#8a5a12' }[step.tone] || '#66675f';
      const mark = { ok: '✓', bad: '✗', wait: '…' }[step.tone] || '·';
      return `<li style="color:${tone}">${mark} ${esc(step.label)}${step.detail ? ` — ${esc(step.detail)}` : ''}</li>`;
    }).join('')
    + '</ol>';
}

async function pollUntilSettled(onStep, { timeoutMs = 240000, intervalMs = 2000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < deadline) {
    await new Promise((resolve) => { setTimeout(resolve, intervalMs); });
    let info;
    try {
      const response = await fetch('/menu-publish-preview', { cache: 'no-store' });
      if (!response.ok) continue;
      info = await response.json();
    } catch {
      continue;
    }
    state.publish = info;
    const deploy = info.deploy || {};
    const phase = String(deploy.phase || '');
    onStep(info, phase, last);
    last = phase;
    // Settled when the deploy finished and the live check agrees with the file.
    const deployDone = /^(done|success|failed|error|verified|live)$/i.test(phase);
    if (deployDone && (info.live?.state === 'live' || info.live?.state === 'outdated' || info.live?.state === 'unverified')) {
      return info;
    }
    if (/failed|error|abort/i.test(phase)) return info;
  }
  return null;
}

/**
 * One click: stage the files, then push, then wait, then verify. Stops early
 * and says why if the local machine has deploy disabled, so a half-done release
 * is never presented as success.
 */
async function runFullRelease() {
  const modal = $('#mc-modal');
  const body = $('#mc-modal-body');
  if (!modal || !body) return;
  const info = state.publish;
  if (!info?.diff?.hasChanges) {
    await refreshPublish();
    if (!state.publish?.diff?.hasChanges) {
      body.innerHTML = `<p><strong>ไม่มีรายการรออัปเดต</strong></p><p class="cp-sub">ฐานกลางตรงกับฉบับที่เผยแพร่แล้ว</p><div class="cp-editor-actions"><button type="button" class="cp-btn ghost" data-mc-close>ปิด</button></div>`;
      modal.hidden = false;
      return;
    }
  }

  if (!state.publish.deployEnabled) {
    // Deploy is off on this machine: stage only, and be explicit about it.
    body.innerHTML = warningPanel(state.publish.tierPrices)
      + unassignedTierPanel(state.publish.tierPrices)
      + tierPanel(state.publish)
      + `<p><strong>สร้างไฟล์ได้ แต่ขึ้นเว็บอัตโนมัติยังไม่เปิด</strong></p>`
      + '<p class="cp-sub">เครื่องนี้ยังไม่ได้ตั้ง EED_ALLOW_GIT_DEPLOY=1 — ระบบจะสร้างไฟล์ในเครื่องเท่านั้น ไม่ได้ push ขึ้น GitHub</p>'
      + `<div class="cp-editor-actions"><button type="button" class="cp-btn" id="mc-release-stage-only">สร้างไฟล์เท่านั้น</button><button type="button" class="cp-btn ghost" data-mc-close>ปิด</button></div>`;
    modal.hidden = false;
    $('#mc-release-stage-only')?.addEventListener('click', () => { publish(); });
    return;
  }

  const diff = state.publish.diff;
  body.innerHTML = `<p><strong>ยืนยันอัปเดตเว็บทั้งหมด</strong> <span class="cp-sub">· สถานะตอนนี้ ${esc(state.publish.statusTh)}</span></p>`
    + warningPanel(state.publish.tierPrices)
    + tierPanel(state.publish)
    + diffList('จะเพิ่ม', diff.added)
    + diffList('จะเปลี่ยน', diff.changed)
    + diffList('จะซ่อนจากเว็บ', diff.hidden)
    + diffList('จะกลับมาแสดง', diff.shown)
    + (diff.costBlocked?.length ? diffList(`ปิดราคา (${diff.costBlocked.length})`, diff.costBlocked.map((item) => ({ id: item.id, name: `${item.name} — ${item.reason}` }))) : '')
    + '<p class="cp-sub">ระบบจะทำต่อให้จบเอง: สร้างไฟล์ → commit เฉพาะ 2 ไฟล์เผยแพร่ → push → รอเว็บจริง → ตรวจว่าเว็บให้บริการตรงกับฉบับนี้ ถ้าตรวจไม่ได้จะขึ้น “ยังไม่ยืนยัน” ไม่ถือว่าสำเร็จ</p>'
    + '<p class="cp-sub">ห้ามรวมงานอื่นเข้า commit อัตโนมัติ: ถ้ามี commit อื่นรอ push อยู่ ระบบจะหยุดและแจ้งสาเหตุ</p>'
    + `<div class="cp-editor-actions"><button type="button" class="cp-btn" id="mc-release-go">ยืนยันและอัปเดตเว็บ</button><button type="button" class="cp-btn ghost" data-mc-close>ยกเลิก</button><span class="cp-form-status" id="mc-release-status"></span></div>`
    + '<div id="mc-release-progress"></div>';
  modal.hidden = false;
  $('#mc-release-go')?.addEventListener('click', () => { executeRelease(); });
}

async function executeRelease() {
  const body = $('#mc-modal-body');
  const progress = $('#mc-release-progress');
  const statusBox = $('#mc-release-status');
  const go = $('#mc-release-go');
  if (go) go.disabled = true;
  const steps = RELEASE_STEPS.map((step) => ({ ...step, tone: 'wait' }));
  if (progress) renderReleaseProgress(progress, steps);
  const mark = (key, tone, detail = '') => {
    const step = steps.find((s) => s.key === key);
    if (!step) return;
    step.tone = tone;
    step.detail = detail;
    if (progress) renderReleaseProgress(progress, steps);
  };

  mark('preview', 'ok');
  try {
    // 1. Stage the release (writes the two published files).
    if (statusBox) statusBox.textContent = 'กำลังสร้างไฟล์…';
    const stage = await fetch('/menu-publish', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    const staged = await stage.json().catch(() => ({}));
    if (stage.status !== 200 || !staged.ok) throw new Error(staged.error || `HTTP ${stage.status}`);
    mark('stage', 'ok', `ไฟล์ v${staged.record?.file?.fileVersion ?? ''}`);

    // 2. Push.
    if (statusBox) statusBox.textContent = 'กำลังส่งขึ้น GitHub…';
    const deploy = await fetch('/menu-deploy', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirm: true }),
    });
    const pushed = await deploy.json().catch(() => ({}));
    if (deploy.status !== 202 || !pushed.ok) throw new Error(pushed.error || `HTTP ${deploy.status}`);
    mark('push', 'ok');
    if (statusBox) statusBox.textContent = 'รอเว็บจริงอัปเดต…';

    // 3+4. Wait for the deploy, then confirm the live site serves this build.
    const settled = await pollUntilSettled((current, phase) => {
      if (/pushing|commit/i.test(phase)) mark('push', 'wait', phase);
      if (/wait|build|deploy/i.test(phase)) mark('wait', 'wait', phase);
      if (/fail|error|abort/i.test(phase)) mark('wait', 'bad', phase);
    });
    const live = state.publish?.live || {};
    if (live.state === 'live') {
      mark('wait', 'ok', live.liveVersion ? `เว็บ v${live.liveVersion}` : '');
      mark('verify', 'ok', 'เว็บจริงให้บริการตรงกับฉบับนี้แล้ว');
      if (statusBox) { statusBox.textContent = 'อัปเดตเว็บเรียบร้อย ✓'; statusBox.className = 'cp-form-status ok'; }
    } else {
      mark('wait', live.state === 'unverified' ? 'bad' : 'wait', live.stateTh || live.state || '');
      mark('verify', 'bad', live.reason || 'ยังไม่ยืนยัน — ไม่ถือว่าสำเร็จ');
      if (statusBox) { statusBox.textContent = `ยังไม่ยืนยัน: ${live.reason || 'ตรวจเว็บจริงอีกครั้ง'}`; statusBox.className = 'cp-form-status bad'; }
    }
    void settled;
  } catch (error) {
    mark('push', 'bad', error.message);
    if (statusBox) { statusBox.textContent = `ไม่สำเร็จ: ${error.message}`; statusBox.className = 'cp-form-status bad'; }
  } finally {
    if (go) go.disabled = false;
    await refreshPublish();
    renderTable();
  }
}

function addMenu() {
  const name = ($('#mc-new-name')?.value || '').trim();
  const msg = $('#mc-new-msg');
  if (!name) { if (msg) msg.textContent = 'กรอกชื่อเมนูก่อน'; $('#mc-new-name')?.focus(); return; }
  const menus = state.working.menus;
  const maxId = menus.reduce((max, menu) => Math.max(max, menu.id), 0);
  const maxOrder = menus.reduce((max, menu) => Math.max(max, menu.sortOrder), -1);
  const tier = $('#mc-new-tier')?.value || 'classic';
  menus.push({
    id: maxId + 1,
    name,
    price: Number($('#mc-new-price')?.value) || 65,
    tier,
    image: ($('#mc-new-img')?.value || '').trim() || 'img/logo.jpg',
    desc: ($('#mc-new-desc')?.value || '').trim(),
    badge: 'ใหม่',
    minPerMenu: Number($('#mc-new-min')?.value) || 5,
    hidden: false,
    sortOrder: maxOrder + 1,
    internalNote: '',
  });
  if ($('#mc-new-name') ) $('#mc-new-name').value = '';
  if (msg) msg.textContent = `เพิ่ม “${name}” (ID ${maxId + 1}) ระดับ ${TIER_FALLBACK_LABELS[tier] || tier} แล้ว — กด “บันทึก” เพื่อให้เครื่องมือแอดมินใช้ทันที`;
  renderTable();
  updateButtons();
}

// ---------------------------------------------------------------------------
// Delete a menu for good (the owner asked for "no data anywhere in the system").
//
// This is the opposite of "ซ่อนจากเว็บ": the row leaves the central draft, so the
// next publish drops its price/name/image from data/planner-overrides.json and
// js/menu-data.js, the customer menu stops showing it, and the LINE bot can no
// longer quote it. Two confirmations (retype the exact name, then confirm)
// because there is no undo here — the only way back is the pre-write backup the
// server keeps. A batch above the same runaway threshold as bulk hide asks once
// more, since a mis-click loop once walked 32 live menus off the site.
// ---------------------------------------------------------------------------
const DELETE_BATCH_LIMIT = 5;

function removedIds() {
  const kept = new Set((state.working?.menus || []).map((menu) => Number(menu.id)));
  return (state.saved?.menus || []).filter((menu) => !kept.has(Number(menu.id))).map((menu) => Number(menu.id));
}

async function deleteMenu(index) {
  const menus = state.working?.menus;
  const menu = menus?.[index];
  if (!menu) return;
  if (menus.length <= 1) {
    setFormStatus('ลบเมนูสุดท้ายไม่ได้ — ต้องมีเมนูอย่างน้อย 1 รายการ ถ้าจะปิดการขายให้กด “ซ่อนจากเว็บ” แทน', 'bad');
    return;
  }
  const typed = window.prompt(`ลบ “${menu.name}” (ID ${menu.id}) ถาวรใช่ไหม\n\nเมนูนี้จะหายจากฐานกลาง เมื่อเผยแพร่จะหายจากหน้าเว็บและหน้าเมนู และบอทจะไม่อ้างราคาเมนูนี้อีก\nย้อนกลับได้จากไฟล์สำรองที่ระบบเขียนไว้ก่อนบันทึกเท่านั้น\n\nพิมพ์ชื่อเมนูให้ตรงทุกตัวอักษรเพื่อยืนยัน:`);
  if (typed === null) return;
  if (typed.trim() !== menu.name) {
    setFormStatus('ยกเลิกลบ — ชื่อที่พิมพ์ไม่ตรงกับเมนู', 'bad');
    return;
  }
  if (!window.confirm(`ยืนยันลบ “${menu.name}” (ID ${menu.id}) ถาวร\n\nเมนูนี้จะไม่มีอยู่ในระบบอีก`)) return;
  if (removedIds().length >= DELETE_BATCH_LIMIT
      && !window.confirm(`คำสั่งนี้ลบเมนูหลายรายการในครั้งเดียว (ทั้งหมด ${removedIds().length + 1} รายการ)\n\nโดยปกติหมายถึงว่ากดผิดแถว ไม่ใช่การตั้งใจลบจริง\nกด “ตกลง” เพื่อลบตามนี้ หรือ “ยกเลิก” เพื่อโหลดข้อมูลกลับเป็นฉบับที่บันทึกไว้`)) {
    state.busy = false;
    await load({ silent: true });
    setFormStatus('ยกเลิกลบแล้ว — โหลดข้อมูลกลับเป็นฉบับที่บันทึกไว้', 'ok');
    return;
  }
  const wasPopular = (state.working.popular || []).some((id) => Number(id) === Number(menu.id));
  menus.splice(index, 1);
  if (wasPopular) state.working.popular = state.working.popular.filter((id) => Number(id) !== Number(menu.id));
  if (state.filter.tier === menu.tier && !menus.some((m) => m.tier === menu.tier)) state.filter.tier = '';
  if ($('#mc-new-name')?.dataset.targetId === String(menu.id)) delete $('#mc-new-name').dataset.targetId;
  renderTable();
  updateButtons();
  scheduleDraftBackup();
  setFormStatus(`ลบ “${menu.name}” (ID ${menu.id}) ออกจากฉบับร่างแล้ว${wasPopular ? ' และถอดออกจากรายการยอดนิยมให้อัตโนมัติ' : ''} — กด “บันทึก” เพื่อเก็บถาวร`, 'ok');
}

function bind() {
  document.addEventListener('input', (event) => {
    const target = event.target;
    if (target.dataset?.mc !== undefined && target.dataset.field) onEdit(target);
    if (target.dataset?.tp !== undefined && target.dataset.tpField) onToppingEdit(target);
  });
  document.addEventListener('change', (event) => {
    const target = event.target;
    if (target.dataset?.mc !== undefined && target.dataset.field) {
      onEdit(target);
      // Checkbox: patch the row in place (see refreshRowState). Everything else
      // re-renders, because a sort-order or level edit changes the row list.
      if (target.type === 'checkbox') refreshRowState(target);
      else renderTable();
    }
    // A topping price settles on blur/commit: rewriting every menu on each
    // keystroke would leave half-typed numbers in the draft. Same for a side
    // item price: an unconfirmed figure must never look confirmed mid-typing.
    if (target.dataset?.tp !== undefined && target.dataset.tpField) { onToppingEdit(target); renderToppings(); }
    if (target.dataset?.si !== undefined && target.dataset.siField) onSideItemEdit(target);
    if (target.id === 'mc-search') { state.filter.q = target.value; renderTable(); }
  });
  document.addEventListener('click', (event) => {
    const closer = event.target.closest('[data-mc-close]');
    if (closer) { $('#mc-modal').hidden = true; return; }
    const tpDelete = event.target.closest('[data-tp-delete]');
    if (tpDelete) { deleteTopping(Number(tpDelete.dataset.tpDelete)); return; }
    const siDelete = event.target.closest('[data-si-delete]');
    if (siDelete) { deleteSideItem(Number(siDelete.dataset.siDelete)); return; }
    const tierChip = event.target.closest('[data-tier]');
    if (tierChip) {
      state.filter.tier = tierChip.dataset.tier || '';
      renderTable();
      return;
    }
    const del = event.target.closest('[data-mc-delete]');
    if (del) {
      deleteMenu(Number(del.dataset.mcDelete));
      return;
    }
    const visChip = event.target.closest('[data-vis]');
    if (visChip) {
      state.filter.vis = visChip.dataset.vis || 'all';
      document.querySelectorAll('[data-vis]').forEach((el) => el.classList.toggle('is-on', el === visChip));
      renderTable();
    }
  });
  $('#mc-save')?.addEventListener('click', save);
  $('#mc-publish-open')?.addEventListener('click', openPreview);
  $('#mc-reload')?.addEventListener('click', () => load());
  
  $('#mc-add')?.addEventListener('click', addMenu);
  $('#mc-tp-add')?.addEventListener('click', addTopping);
  $('#mc-si-add')?.addEventListener('click', addSideItem);

  // Last line of defence: flush any pending debounce when the tab goes away.
  window.addEventListener('beforeunload', () => {
    if (draftTimer) { clearTimeout(draftTimer); writeDraftBackup(); }
  });
  // Warn before losing unsaved edits, but never on a plain reload-with-recovery.
  window.addEventListener('beforeunload', (event) => {
    if (!isDirty()) return;
    event.preventDefault();
    event.returnValue = '';
  });
}

bind();
await load({ silent: true });
