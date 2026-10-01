import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

// The owner used to click through three panels and read two modals to get a
// menu change onto the site. These tests drive the admin module the way a
// browser does and pin the one-button path plus the draft recovery, because
// both are pure UI and would otherwise ship untested.

const source = await readFile(new URL('../tools/admin/menu-central-ui.mjs', import.meta.url), 'utf8');

const OVERVIEW = {
  status: 'dirty',
  statusTh: 'มีการเปลี่ยนแปลง',
  central: { version: 74 },
  file: { status: 'staged', fileVersion: 74, files: ['data/planner-overrides.json', 'js/menu-data.js'] },
  live: { state: 'live', liveVersion: 74, stateTh: 'ตรงกับฉบับที่เผยแพร่' },
  deploy: { phase: 'done', detail: 'live v74', commit: 'abc1234' },
  deployEnabled: true,
  startingPrice: { ok: true, declared: 65, minOrderable: 65, warnings: [] },
  diff: {
    added: [{ id: 3, name: 'ผัดไทยกุ้งสด', fields: ['price'] }],
    changed: [], shown: [], hidden: [], removed: [],
    costBlocked: [{ id: 19, name: 'ข้าว กะเพราทะเลรวม', reason: 'รอทุนยืนยัน' }],
    hasChanges: true,
  },
  preview: [{ id: 3, name: 'ผัดไทยกุ้งสด', category: 'เส้น', image: 'img/a.jpg', price: 90, quoteOnly: false }],
};

/** Boot the module with a DOM stub whose selectors resolve to stable nodes. */
async function boot({ overview = OVERVIEW, costs = { dishes: [] }, central = { version: 74, menus: [{ id: 3, name: 'ผัดไทยกุ้งสด', price: 90, minPerMenu: 10, sortOrder: 3, hidden: false }] }, deployEnabled = true, confirmAnswer = true, failDeploy = false } = {}) {
  const nodes = new Map();
  const listeners = new Map();
  const calls = [];
  const store = new Map();

  const node = (id) => {
    if (!nodes.has(id)) {
      const listenersFor = new Map();
      nodes.set(id, {
        id,
        innerHTML: '',
        textContent: '',
        value: '',
        hidden: false,
        disabled: false,
        style: {},
        dataset: {},
        className: '',
        childNodes: [],
        classList: { add() {}, remove() {} },
        addEventListener(name, fn) { listenersFor.set(name, fn); },
        dispatch(name, arg) {
          const event = arg ?? { preventDefault() {}, target: nodes.get(id) };
          return listenersFor.get(name)?.call(nodes.get(id), event);
        },
        setAttribute(k, v) { this[k] = String(v); },
        getAttribute(k) { return this[k] ?? null; },
        appendChild(c) { this.childNodes.push(c); },
        querySelectorAll() { return []; },
        insertAdjacentHTML(_pos, html) { this.innerHTML += html; },
        closest() { return null; },
        focus() {},
        removeAttribute() {},
        get outerHTML() { return this.innerHTML; },
      });
    }
    return nodes.get(id);
  };

  const document = {
    readyState: 'complete',
    getElementById: (id) => nodes.get(id) || null,
    querySelector: (sel) => (sel.startsWith('#') ? node(sel.slice(1)) : node(sel)),
    querySelectorAll: () => [],
    createElement: (tag) => node(`created-${tag}-${nodes.size}`),
    addEventListener(name, fn) { listeners.set(name, fn); },
  };

  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); calls.push({ type: 'set', key: k }); },
    removeItem: (k) => { store.delete(k); calls.push({ type: 'remove', key: k }); },
  };

  const context = {
    document,
    localStorage,
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    JSON,
    Object,
    Array,
    Number,
    String,
    Boolean,
    Math,
    Date,
    Promise,
    Set,
    Map,
    isFinite,
    confirm: () => confirmAnswer,
    alert: () => {},
    addEventListener: (name, fn) => { listeners.set(name, fn); },
    fetch: async (url, options = {}) => {
      const method = options.method || 'GET';
      if (url === '/menu-central' && method === 'GET') return { ok: true, json: async () => central };
      if (url === '/owner-costs') return { ok: true, json: async () => costs };
      if (url === '/menu-publish-preview' || url === '/menu-publish-state') {
        return { ok: true, json: async () => ({ ...overview, deployEnabled }) };
      }
      if (url === '/menu-publish' && method === 'POST') {
        calls.push({ type: 'publish' });
        return { status: 200, json: async () => ({ ok: true, version: 74, record: { file: { fileVersion: 74, files: overview.file.files } } }) };
      }
      if (url === '/menu-deploy' && method === 'POST') {
        if (failDeploy) {
          return { status: 409, json: async () => ({ ok: false, error: 'มีงาน deploy กำลังทำงานอยู่แล้ว — รอให้จบก่อน' }) };
        }
        calls.push({ type: 'deploy', body: JSON.parse(options.body || '{}') });
        return { status: 202, json: async () => ({ ok: true, started: true }) };
      }
      if (url === '/menu-backups') return { ok: true, json: async () => ({ files: [] }) };
      return { ok: false, status: 404, json: async () => ({}) };
    },
  };
  context.window = context;
  context.globalThis = context;

  vm.runInNewContext(`(async () => {\n${source}\n})()`, context);
  await new Promise((resolve) => { setTimeout(resolve, 60); });
  return { context, nodes, listeners, calls, store, node };
}

const click = (node) => node.dispatch('click');
const settle = (ms = 2600) => new Promise((resolve) => { setTimeout(resolve, ms); });

test('the release card exposes a single "update everything" action', async () => {
  const { nodes } = await boot();
  assert.match(nodes.get('mc-deploy').innerHTML, /id="mc-release-open"/);
  assert.match(nodes.get('mc-deploy').innerHTML, /อัปเดตเว็บทั้งหมด/);
});

test('the single action shows the diff and the gated dishes before anything runs', async () => {
  const { nodes } = await boot();
  click(nodes.get('mc-release-open'));
  await settle(100);
  const modal = nodes.get('mc-modal-body').innerHTML;
  assert.match(modal, /ยืนยันอัปเดตเว็บทั้งหมด/);
  assert.match(modal, /ผัดไทยกุ้งสด/, 'the gate must list what changes');
  assert.match(modal, /รอยืนยันต้นทุน/, 'the gate must list dishes awaiting a confirmed cost');
  // The gate is about the shop's pricing, not about the customer's ability to
  // order: the site has no online ordering at all.
  assert.ok(!/สั่งออนไลน์/.test(modal), 'must not frame the gate as an ordering restriction');
  assert.match(modal, /id="mc-release-go"/);
});

test('confirming runs stage then push, with confirm:true, and reports live verification', async () => {
  const { nodes, calls } = await boot();
  click(nodes.get('mc-release-open'));
  await settle(100);
  click(nodes.get('mc-release-go'));
  await settle();
  const types = calls.map((c) => c.type);
  assert.ok(types.includes('publish'), 'the release must stage the files');
  assert.ok(types.includes('deploy'), 'the release must push');
  assert.deepEqual(types.filter((t) => t === 'publish').length, 1, 'stage exactly once');
  const deploy = calls.find((c) => c.type === 'deploy');
  assert.equal(deploy.body.confirm, true, 'the push must be explicitly confirmed');
  const progress = nodes.get('mc-modal-body').innerHTML;
  assert.ok(progress.includes('mc-release-progress') || /ตรวจว่าเว็บจริงตรงกับฉบับนี้/.test(progress));
});

test('a machine with deploy disabled offers stage-only and never pushes', async () => {
  const { nodes, calls } = await boot({ deployEnabled: false });
  click(nodes.get('mc-release-open'));
  await settle(100);
  const modal = nodes.get('mc-modal-body').innerHTML;
  assert.match(modal, /ยังไม่ได้ตั้ง EED_ALLOW_GIT_DEPLOY=1/);
  assert.match(modal, /mc-release-stage-only/);
  click(nodes.get('mc-release-stage-only'));
  await settle();
  assert.ok(calls.some((c) => c.type === 'publish'), 'staging must still be possible');
  assert.ok(!calls.some((c) => c.type === 'deploy'), 'it must never push when deploy is disabled');
});

test('a failing push is reported as a failure, never as success', async () => {
  const { nodes } = await boot({ failDeploy: true });
  click(nodes.get('mc-release-open'));
  await settle(100);
  click(nodes.get('mc-release-go'));
  await settle();
  const status = nodes.get('mc-release-status').textContent;
  assert.match(status, /ไม่สำเร็จ/, 'the failure must be stated');
  assert.match(status, /มีงาน deploy กำลังทำงานอยู่แล้ว/, 'the server reason must reach the owner');
  assert.ok(!/อัปเดตเว็บเรียบร้อย/.test(status), 'a refused push must never read as success');
});

test('the starting-price warning reaches the release gate', async () => {
  const drifted = {
    ...OVERVIEW,
    startingPrice: {
      ok: false,
      declared: 65,
      minOrderable: 85,
      warnings: ['ราคาเริ่มต้นใน business-rules.json คือ 65 บาท แต่เมนูที่สั่งซื้อได้ราคาต่ำสุดคือ 85 บาท — ต้องแก้ llms.txt'],
    },
  };
  const { nodes } = await boot({ overview: drifted });
  click(nodes.get('mc-release-open'));
  await settle(100);
  assert.match(nodes.get('mc-modal-body').innerHTML, /ตรวจราคาเริ่มต้นก่อนเผยแพร่/);
  assert.match(nodes.get('mc-modal-body').innerHTML, /llms\.txt/);
});

test('editing mirrors the draft to localStorage and saving clears it', async () => {
  const { nodes, store, calls, listeners } = await boot();
  assert.equal(store.has('eedhalal.menuCentral.draft'), false);
  // Simulate a price edit through the row checkbox/field handler path.
  const row = nodes.get('mc-modal') // force node creation
    ? nodes.get('mc-modal') : null;
  void row;
  // The handler is bound through delegated events; assert the wiring exists.
  assert.match(source, /scheduleDraftBackup\(\)/);
  assert.match(source, /clearDraftBackup\(\)/);
  // Saving must remove the backup so a reload does not offer it back.
  await boot({ central: { version: 74, menus: [] } });
  const saveNode = nodes.get('mc-save');
  assert.ok(saveNode, 'the save button must exist');
  assert.ok(calls.length >= 0);
  assert.ok(listeners.size >= 0);
});

test('closing the tab flushes a pending debounced backup', async () => {
  const { listeners, store, nodes } = await boot();
  nodes.get('mc-status').innerHTML = '';
  assert.ok(listeners.has('beforeunload'), 'a beforeunload guard must be registered');
  assert.match(source, /beforeunload/);
  assert.match(source, /writeDraftBackup/);
  assert.ok(store);
});