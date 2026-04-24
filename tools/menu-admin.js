const STORAGE_KEY = 'eedhalal.ownerMenuDraft.v1';
const SOURCE_PATH = '../menu.json';
const DEFAULT_IMAGE = '../img/chef-profile.jpg';

const state = {
  items: [],
  sourceLabel: 'ยังไม่โหลด'
};

const statusBanner = document.getElementById('status-banner');
const menuList = document.getElementById('menu-list');
const statCount = document.getElementById('stat-count');
const statAverage = document.getElementById('stat-average');
const statSource = document.getElementById('stat-source');

function createMenuId() {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') {
    return `menu-${window.crypto.randomUUID()}`;
  }
  return `menu-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function normalizeItem(item, index = 0) {
  const parsedPrice = Number(item?.price);
  return {
    id: typeof item?.id === 'string' && item.id.trim() ? item.id.trim() : createMenuId(),
    name: typeof item?.name === 'string' && item.name.trim() ? item.name.trim() : `เมนู ${index + 1}`,
    description: typeof item?.description === 'string' ? item.description.trim() : '',
    price: Number.isFinite(parsedPrice) ? parsedPrice : 0,
    image: typeof item?.image === 'string' && item.image.trim() ? item.image.trim() : DEFAULT_IMAGE,
    tag: typeof item?.tag === 'string' ? item.tag.trim() : ''
  };
}

function normalizeList(list) {
  if (!Array.isArray(list)) return [];
  return list.map((item, index) => normalizeItem(item, index));
}

function setStatus(message, tone = 'info') {
  const palette = {
    info: '#5f7266',
    success: '#177245',
    error: '#b93838'
  };
  statusBanner.textContent = message;
  statusBanner.style.color = palette[tone] || palette.info;
}

function renderStats() {
  const count = state.items.length;
  const average = count
    ? Math.round(state.items.reduce((sum, item) => sum + Number(item.price || 0), 0) / count)
    : 0;

  statCount.textContent = String(count);
  statAverage.textContent = `${average} บาท`;
  statSource.textContent = state.sourceLabel;
}

function updateField(index, key, value) {
  if (!state.items[index]) return;
  if (key === 'price') {
    const numeric = Number(value);
    state.items[index][key] = Number.isFinite(numeric) ? numeric : 0;
  } else {
    state.items[index][key] = value;
  }
  render();
}

function removeItem(index) {
  state.items.splice(index, 1);
  render();
  setStatus('ลบเมนูออกจาก draft แล้ว', 'success');
}

function render() {
  renderStats();

  if (!state.items.length) {
    menuList.innerHTML = '<div class="empty">ยังไม่มีเมนูใน draft กด "โหลดจาก menu.json" หรือ "เพิ่มเมนู"</div>';
    return;
  }

  menuList.innerHTML = state.items.map((item, index) => `
    <article class="card">
      <div class="card-header">
        <div>
          <h2 class="card-title">${item.name || `เมนู ${index + 1}`}</h2>
          <div class="meta">ID: <code>${item.id}</code></div>
        </div>
        <button class="danger" type="button" data-action="remove" data-index="${index}">ลบเมนูนี้</button>
      </div>

      <div class="menu-fields">
        <div class="field">
          <label for="id-${index}">ID</label>
          <input id="id-${index}" data-index="${index}" data-key="id" value="${escapeHtml(item.id)}">
        </div>
        <div class="field">
          <label for="name-${index}">ชื่อเมนู</label>
          <input id="name-${index}" data-index="${index}" data-key="name" value="${escapeHtml(item.name)}">
        </div>
        <div class="field">
          <label for="price-${index}">ราคา</label>
          <input id="price-${index}" type="number" min="0" step="1" data-index="${index}" data-key="price" value="${Number(item.price || 0)}">
        </div>
        <div class="field">
          <label for="tag-${index}">แท็ก</label>
          <input id="tag-${index}" data-index="${index}" data-key="tag" value="${escapeHtml(item.tag)}">
        </div>
        <div class="field field-wide">
          <label for="image-${index}">ลิงก์รูปภาพ (หรืออัปโหลดใหม่)</label>
          <div style="display: flex; gap: 8px;">
            <input id="image-${index}" data-index="${index}" data-key="image" value="${escapeHtml(item.image)}">
            <button class="secondary" type="button" style="padding: 0 12px; height: 42px; white-space: nowrap; font-size: 11px;" data-action="trigger-upload" data-index="${index}">อัปโหลดรูป</button>
            <input type="file" id="file-input-${index}" style="display: none;" accept="image/*" data-action="file-input" data-index="${index}">
          </div>
        </div>
        <div class="field field-wide">
          <label for="description-${index}">รายละเอียด</label>
          <textarea id="description-${index}" data-index="${index}" data-key="description">${escapeHtml(item.description)}</textarea>
        </div>
      </div>

      <div class="preview">
        <img src="${escapeAttribute(item.image)}" alt="${escapeAttribute(item.name)}" onerror="this.src='${DEFAULT_IMAGE}'">
        <div>
          <strong>${escapeHtml(item.name)}</strong>
          <div class="meta">${Number(item.price || 0)} บาท${item.tag ? ` • ${escapeHtml(item.tag)}` : ''}</div>
        </div>
      </div>
    </article>
  `).join('');
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/'/g, '&#39;');
}

async function loadMenuFromSource() {
  const response = await fetch(SOURCE_PATH, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`โหลด ${SOURCE_PATH} ไม่สำเร็จ`);
  }
  const payload = await response.json();
  state.items = normalizeList(payload);
  state.sourceLabel = 'source file';
  render();
  setStatus('โหลดข้อมูลล่าสุดจาก menu.json แล้ว', 'success');
}

function loadDraftFromStorage() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    state.items = normalizeList(JSON.parse(raw));
    state.sourceLabel = 'draft local';
    render();
    setStatus('โหลด draft จากเบราว์เซอร์นี้แล้ว', 'success');
    return true;
  } catch (_error) {
    return false;
  }
}

function saveDraftToStorage() {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state.items));
  state.sourceLabel = 'draft local';
  renderStats();
  setStatus('บันทึก draft ลงในเบราว์เซอร์นี้แล้ว', 'success');
}

function resetDraft() {
  window.localStorage.removeItem(STORAGE_KEY);
  setStatus('ล้าง draft local แล้ว กำลังโหลดจาก menu.json ใหม่...', 'info');
  loadMenuFromSource().catch((error) => {
    setStatus(error.message, 'error');
  });
}

function addItem() {
  state.items.push(normalizeItem({}, state.items.length));
  render();
  setStatus('เพิ่มเมนูใหม่ใน draft แล้ว', 'success');
}

function exportMenuJson() {
  const payload = JSON.stringify(normalizeList(state.items), null, 2);
  const blob = new Blob([payload], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'menu.json';
  link.click();
  URL.revokeObjectURL(url);
  setStatus('Export menu.json แล้ว นำไฟล์ไปแทนที่ไฟล์เดิมใน repo ก่อน push', 'success');
}

document.addEventListener('input', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return;
  const index = Number(target.dataset.index);
  const key = target.dataset.key;
  if (!Number.isFinite(index) || !key) return;
  updateField(index, key, target.value);
});

document.addEventListener('click', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;

  const action = target.dataset.action;
  if (action === 'remove') {
    const index = Number(target.dataset.index);
    if (Number.isFinite(index)) {
      removeItem(index);
    }
  } else if (action === 'trigger-upload') {
    const index = Number(target.dataset.index);
    const input = document.getElementById(`file-input-${index}`);
    if (input) input.click();
  }
});

document.addEventListener('change', async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement) || target.dataset.action !== 'file-input') return;

  const index = Number(target.dataset.index);
  const file = target.files?.[0];
  if (!file || !Number.isFinite(index)) return;

  try {
    setStatus('กำลังอัปโหลด...', 'info');
    const filename = `${Date.now()}-${file.name.replace(/\s+/g, '_')}`;
    const response = await fetch('/upload', {
      method: 'POST',
      headers: {
        'X-Filename': filename
      },
      body: file
    });

    if (!response.ok) throw new Error('อัปโหลดไม่สำเร็จ');

    const result = await response.json();
    updateField(index, 'image', result.path);
    setStatus('อัปโหลดและอัปเดตรูปภาพแล้ว', 'success');
  } catch (error) {
    setStatus(error.message, 'error');
  }
});

document.getElementById('reload-source-btn')?.addEventListener('click', () => {
  loadMenuFromSource().catch((error) => {
    setStatus(error.message, 'error');
  });
});

document.getElementById('save-draft-btn')?.addEventListener('click', saveDraftToStorage);
document.getElementById('reset-draft-btn')?.addEventListener('click', resetDraft);
document.getElementById('add-item-btn')?.addEventListener('click', addItem);
document.getElementById('export-btn')?.addEventListener('click', exportMenuJson);

async function init() {
  if (loadDraftFromStorage()) return;
  try {
    await loadMenuFromSource();
  } catch (error) {
    state.items = normalizeList([]);
    render();
    setStatus(`${error.message} เปิดผ่าน npm run public:serve แล้วลองใหม่`, 'error');
  }
}

init();
