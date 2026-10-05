import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

// The homepage cards and the tier table link to popular-menu.html#tier-<id>, so
// the renderer must treat that link as a filter over the published sets - and
// let the customer out of it again. This drives js/popular-menu.js the way a
// browser does, with a DOM stub instead of a real page.

const root = new URL('../', import.meta.url);
const [source, menuDataJs, plannerJson, page] = await Promise.all([
  readFile(new URL('js/popular-menu.js', root), 'utf8'),
  readFile(new URL('js/menu-data.js', root), 'utf8'),
  readFile(new URL('data/planner-overrides.json', root), 'utf8'),
  readFile(new URL('popular-menu.html', root), 'utf8'),
]);

const overrides = JSON.parse(plannerJson);

const tierById = overrides.tiers || {};
const executiveIds = Object.keys(tierById).filter((id) => tierById[id] === 'executive');
const classicIds = Object.keys(overrides.prices).filter((id) => tierById[id] !== 'executive');

function cardMarkup(id, tier) {
  return `<article class="pm-card" id="menu-${id}" data-menu-id="${id}" data-tier="${tier}">`
    + `<img class="pm-photo" src="img/a.jpg" alt=""><div class="pm-card-body">`
    + `<p class="pm-card-cat">cat</p><h3 class="pm-card-name">menu ${id}</h3>`
    + '<a class="pm-card-cta" href="https://lin.ee/CfvqJTd">สอบถาม</a></div></article>';
}

function rowMarkup(id, tier) {
  return `<div class="pm-row" id="menu-${id}" data-menu-id="${id}" data-tier="${tier}">`
    + '<div class="pm-row-text"><p class="pm-row-cat">cat</p><p class="pm-row-name">menu '
    + `${id}</p></div><div class="pm-row-actions"></div></div>`;
}

/** Boot the renderer with the given hash and a stub DOM, then return it. */
async function render({ hash = '' } = {}) {
  const cards = new Map();
  const rows = new Map();
  const make = (html, store) => {
    const item = {
      hidden: false,
      attrs: {},
      getAttribute(name) {
        const match = new RegExp(`${name}="([^"]*)"`).exec(html);
        return match ? match[1] : null;
      },
      querySelector(selector) {
        const key = selector.includes('name') ? 'name' : 'cat';
        const found = new RegExp(`class="pm-(?:card|row)-${key}">([^<]*)<`).exec(html);
        return { textContent: found ? found[1] : '' };
      },
    };
    store.set(html.match(/id="([^"]+)"/)[1], item);
    return item;
  };
  const byId = {
    'pm-grid': {
      set innerHTML(html) {
        cards.clear();
        for (const chunk of html.split('<article class="pm-card"').slice(1)) cards.set(`menu-${chunk.match(/id="menu-(\d+)"/)[1]}`, make(`<article class="pm-card"${chunk.split('>').slice(0, -1).join('>')}>`, cards));
      },
      querySelectorAll: (sel) => (sel.includes('pm-card') ? [...cards.values()] : []),
    },
    'pm-list': {
      set innerHTML(html) {
        rows.clear();
        for (const chunk of html.split('<div class="pm-row"').slice(1)) rows.set(`menu-${chunk.match(/id="menu-(\d+)"/)[1]}`, make(`<div class="pm-row"${chunk.split('>').slice(0, -1).join('>')}>`, rows));
      },
      querySelectorAll: () => [...rows.values()],
    },
    'pm-search': { value: '', addEventListener() {} },
    'pm-filter': { value: 'all', innerHTML: '', appendChild() {} },
    'pm-count': { textContent: '' },
    'pm-empty': { hidden: true },
    'pm-photo-heading': { hidden: false },
    'pm-plain-heading': { hidden: false },
    'pm-visually-hidden': { hidden: false },
  };
  for (const stub of Object.values(byId)) {
    if (!stub.addEventListener) stub.addEventListener = () => {};
    if (!stub.querySelectorAll) stub.querySelectorAll = () => [];
    if (!stub.querySelector) stub.querySelector = () => null;
  }
  const documentListeners = {};
  const document = {
    readyState: 'complete',
    getElementById: (id) => byId[id] || null,
    querySelectorAll: () => [],
    createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, setAttribute() {}, addEventListener() {}, textContent: '' }),
    addEventListener: (name, fn) => { documentListeners[name] = fn; },
  };
  const menus = [
    { id: executiveIds[0], name: 'executive set', price: 230, image: 'img/x.jpg', desc: '', minPerMenu: 10, sortOrder: 1, tier: 'executive' },
    { id: classicIds[0], name: 'classic set', price: 65, image: 'img/y.jpg', desc: '', minPerMenu: 10, sortOrder: 2, tier: 'classic' },
  ];
  const context = {
    document,
    window: { location: { hash }, addEventListener() {} },
    fetch: async () => ({ ok: true, json: async () => ({ deleted: overrides.deleted || [], tiers: tierById }) }),
    EED_MENUS: menus,
    setTimeout, clearTimeout, console, Date, Math, Set, Map, Promise, Object, Array, JSON, String, Number, Boolean, isFinite,
  };
  context.window.document = document;
  context.globalThis = context;
  vm.runInNewContext(source, context);
  await new Promise((resolve) => { setTimeout(resolve, 20); });
  return { cards, rows, byId, documentListeners, menus };
}

test('without a tier link every set stays visible', async () => {
  const { cards, rows, byId } = await render();
  assert.equal(cards.size + rows.size, 2, 'both fixtures must render');
  assert.ok([...cards.values(), ...rows.values()].every((item) => item.hidden === false));
  assert.match(byId['pm-count'].textContent, /ตอนนี้มี 2 เมนูให้เลือก/);
});

test('#tier-executive shows only that level', async () => {
  const { cards, rows, byId } = await render({ hash: '#tier-executive' });
  const visible = [...cards.values(), ...rows.values()].filter((item) => item.hidden === false);
  assert.equal(visible.length, 1);
  assert.equal(visible[0].getAttribute('data-tier'), 'executive');
  assert.match(byId['pm-count'].textContent, /ระดับ Executive/);
});

test('clicking the same tier link clears the filter', async () => {
  const { cards, rows, documentListeners } = await render({ hash: '#tier-executive' });
  const link = {
    getAttribute: () => '/popular-menu.html#tier-executive',
    closest: (selector) => (selector.includes('a[href') ? link : null),
  };
  let prevented = false;
  documentListeners.click({ preventDefault: () => { prevented = true; }, target: { closest: (selector) => (selector.includes('a[href') ? link : null) } });
  assert.ok(prevented, 'the renderer must handle the link itself');
  assert.ok([...cards.values(), ...rows.values()].every((item) => item.hidden === false), 'a second click clears the level');
});

test('every published tier is tagged in the static markup and in the runtime data', () => {
  const staticTiers = [...page.matchAll(/data-menu-id="(\d+)" data-tier="([a-z]+)"/g)];
  assert.equal(staticTiers.length, Object.keys(overrides.prices).length, 'every published set is tagged in the static page');
  for (const [, id, tier] of staticTiers) {
    assert.equal(tier, tierById[id] ?? 'classic', `menu ${id} tier must match the catalogue`);
  }
  const dataTiers = [...menuDataJs.matchAll(/id:\s*(\d+),[^\n]*?tier:\s*"([a-z]+)"/g)];
  assert.equal(dataTiers.length, staticTiers.length, 'js/menu-data.js carries the same tiers');
  for (const [, id, tier] of dataTiers) {
    assert.equal(tier, tierById[id] ?? 'classic', `menu ${id} tier in js/menu-data.js`);
  }
  assert.match(page, /id="tier-classic"/, 'the tier table anchors exist for the deep links');
  assert.match(page, /href="\/popular-menu\.html#tier-classic"/, 'the table links to its own level');
});