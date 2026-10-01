import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const [popularHtml, snackHtml, popularSource, popularRenderer, snackHydrateSource, plannerSource] = await Promise.all([
  readFile(new URL('../popular-menu.html', import.meta.url), 'utf8'),
  readFile(new URL('../snack-box.html', import.meta.url), 'utf8'),
  readFile(new URL('../js/popular-menu-hydrate.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/popular-menu.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/snack-hydrate.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/budget-planner.js', import.meta.url), 'utf8'),
]);

function element(id) {
  const listeners = {};
  let textContent = '';
  return {
    id,
    innerHTML: '',
    childNodes: [],
    get textContent() { return textContent; },
    set textContent(value) { textContent = String(value); },
    value: '',
    style: {},
    classList: { add() {}, remove() {} },
    setAttribute(name, value) { this[name] = String(value); },
    getAttribute(name) { return this[name] ?? null; },
    addEventListener(name, handler) { listeners[name] = handler; },
    dispatch(name) { if (listeners[name]) listeners[name].call(this, { target: this }); },
    querySelectorAll() { return []; },
    appendChild(child) { this.childNodes.push(child); },
  };
}

function browserContext(ids, values = {}) {
  const elements = Object.fromEntries(ids.map((id) => [id, element(id)]));
  const document = {
    readyState: 'complete',
    getElementById(id) { return elements[id] || null; },
    querySelectorAll() { return []; },
    createElement(tag) {
      const node = element(`created-${tag}`);
      node.tagName = String(tag).toUpperCase();
      node.childNodes = [];
      node.appendChild = (child) => {
        node.childNodes.push(child);
        node.textContent += child.textContent;
      };
      return node;
    },
    addEventListener() {},
    dispatchEvent() {},
  };
  const context = {
    document,
    location: { protocol: 'file:', pathname: '/index.html' },
    localStorage: { getItem() { return null; }, setItem() {} },
    CustomEvent: class CustomEvent { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
    console,
    setTimeout,
    clearTimeout,
    isFinite,
    Number,
    String,
    Object,
    Array,
    JSON,
    Math,
    Date,
    ...values,
  };
  context.window = context;
  return { context, elements };
}

test('popular menu hydrates its grid in a browser-like context', () => {
  const { context, elements } = browserContext(['popularMenuGrid'], {
    EED_MENUS: [
      { id: 1, name: 'เมนู <ทดสอบ>', price: 60, category: 'ข้าวราดแกง', image: 'img/test.jpg', desc: 'เมนูทดสอบ' },
    ],
  });
  vm.runInNewContext(popularSource, context);

  assert.equal(elements.popularMenuGrid.getAttribute('data-hydrated'), 'true');
  assert.match(elements.popularMenuGrid.innerHTML, /เมนู &lt;ทดสอบ&gt;/);
});

test('snack box hydrates menus and renders delivery-zone choices', () => {
  const { context, elements } = browserContext(['snackFullMenu', 'snackAddOns', 'snackBasePrice', 'snackMinOrder', 'sbDeliveryZone'], {
    EED_SNACK_MENUS: [{ id: 'sweet-1', name: 'บราวนี่', category: 'sweet', price: 0 }],
    EED_SNACK_CATEGORIES: [{ id: 'sweet', emoji: '*', label: 'ของหวาน' }],
    EED_SNACK_ADDONS: [{ id: 'water', name: 'น้ำเปล่า', emoji: '*', price: 0 }],
    EED_SNACK_BASE_PRICE: 40,
    EED_SNACK_MIN_ORDER: 30,
  });
  vm.runInNewContext(snackHydrateSource, context);

  assert.equal(elements.snackFullMenu.getAttribute('data-hydrated'), 'true');
  assert.match(elements.snackFullMenu.innerHTML, /บราวนี่/);
  assert.equal(elements.snackBasePrice.textContent, '40');
  assert.equal(elements.snackMinOrder.textContent, '30');
});

test('snack-box page has no calculator: product sets with LINE quotation CTAs', () => {
  for (const id of [
    'sbDeliveryZone', 'sbSweetList', 'sbSavoryList', 'sbJuiceList', 'sbAddonList',
    'sbQtyNumber', 'sbQtyRange', 'sbSumBudget', 'sbSumQty', 'sbSumTotal', 'sbLineBtn', 'sbCopySummary',
  ]) {
    assert.ok(!new RegExp(`id=["']${id}["']`).test(snackHtml), `retired builder id must be gone: ${id}`);
  }
  assert.ok(!/snack-builder\.js/.test(snackHtml), 'retired builder script must not be loaded');
  assert.ok(/30 กล่องต่อเมนู/.test(snackHtml), 'snack minimum per menu is stated');
});

test('planner applies local menu overrides without authentication or browser dependencies', () => {
  const stored = new Map([
    ['eed_selling_v1', JSON.stringify({ 1: 85 })],
    ['eed_mins_v1', JSON.stringify({ 1: 8 })],
  ]);
  const { context, elements } = browserContext(['plannerApp', 'priceTableBody', 'statCount', 'statCat', 'statRange', 'statLast', 'globalToppingsList', 'meatsList', 'snackTableBody'], {
    EED_MENUS: [{ id: 1, name: 'เมนูทดสอบ', price: 60, category: 'ข้าวราดแกง', image: 'img/test.jpg', minPerMenu: 5 }],
    EED_DEFAULT_TOPPINGS: [],
    EED_SNACK_MENUS: [],
    localStorage: { getItem(key) { return stored.get(key) ?? null; }, setItem(key, value) { stored.set(key, value); }, removeItem(key) { stored.delete(key); } },
  });
  vm.runInNewContext(plannerSource, context);

  assert.equal(elements.plannerApp.style.display, 'block');
  assert.equal(context.EED_MENUS[0].price, 85);
  assert.equal(context.EED_MENUS[0].minPerMenu, 8);
});

test('public pages load their browser enhancers after shared data scripts', () => {
  assert.ok(popularHtml.indexOf('js/menu-data.js') < popularHtml.indexOf('js/popular-menu.js'));
  assert.ok(snackHtml.indexOf('js/snack-data.js') < snackHtml.indexOf('js/snack-hydrate.js'));
});

test('production menu renderer prints no price and hides nothing by cost state', async () => {
  const menus = [
    { id: 1, name: 'เมนูหนึ่ง', price: 65, category: 'ข้าวราดแกง', image: 'img/a.jpg', desc: '' },
    { id: 2, name: 'เมนูสอง', price: 70, category: 'ข้าวราดแกง', image: 'img/b.jpg', desc: '' },
  ];
  // quoteOnly is still fetched for internal reasons, but nothing may change on
  // the page because of it: the site has no ordering flow to gate.
  const { context, elements } = browserContext(['pm-grid', 'pm-list', 'pm-search', 'pm-filter', 'pm-count', 'pm-empty', 'pm-photo-heading', 'pm-plain-heading'], {
    EED_MENUS: menus,
    fetch: async () => ({ ok: true, json: async () => ({ deleted: [], quoteOnly: [2] }) }),
  });
  vm.runInNewContext(popularRenderer, context);
  await new Promise((resolve) => setImmediate(resolve));

  const grid = elements['pm-grid'].innerHTML;
  assert.match(grid, /เมนูหนึ่ง/);
  assert.match(grid, /เมนูสอง/);
  // No cost-state label, and both dishes get the identical CTA.
  assert.ok(!grid.includes('pm-quote-note'), 'no ask-for-quote label');
  assert.ok(!grid.includes('สอบถามราคา'), 'no price-asking CTA');
  assert.equal((grid.match(/สอบถามเมนูนี้ทาง LINE/g) || []).length, 2);
  // No sale price may ever reach the DOM on this page.
  assert.ok(!grid.includes('65') && !grid.includes('70'), 'no price figure is rendered');
  assert.ok(!/บาท/.test(grid), 'no currency label is rendered');
});

test('production menu renderer still hides owner-hidden dishes', async () => {
  const menus = [
    { id: 1, name: 'ยังแสดง', price: 65, category: 'ข้าวราดแกง', image: 'img/a.jpg', desc: '' },
    { id: 2, name: 'ถูกซ่อน', price: 70, category: 'ข้าวราดแกง', image: 'img/b.jpg', desc: '' },
  ];
  const { context, elements } = browserContext(['pm-grid', 'pm-list', 'pm-search', 'pm-filter', 'pm-count', 'pm-empty', 'pm-photo-heading', 'pm-plain-heading'], {
    EED_MENUS: menus,
    fetch: async () => ({ ok: true, json: async () => ({ deleted: [2] }) }),
  });
  vm.runInNewContext(popularRenderer, context);
  await new Promise((resolve) => setImmediate(resolve));

  const grid = elements['pm-grid'].innerHTML;
  assert.match(grid, /ยังแสดง/);
  assert.ok(!grid.includes('ถูกซ่อน'), 'hidden dishes never reach the page');
});
