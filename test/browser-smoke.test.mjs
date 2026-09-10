import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const [calculatorHtml, popularHtml, snackHtml, popularSource, snackHydrateSource, snackBuilderSource] = await Promise.all([
  readFile(new URL('../budget-calculator.html', import.meta.url), 'utf8'),
  readFile(new URL('../popular-menu.html', import.meta.url), 'utf8'),
  readFile(new URL('../snack-box.html', import.meta.url), 'utf8'),
  readFile(new URL('../js/popular-menu-hydrate.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/snack-hydrate.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/snack-builder.js', import.meta.url), 'utf8'),
]);

function element(id) {
  const listeners = {};
  let textContent = '';
  return {
    id,
    innerHTML: '',
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
  };
}

function browserContext(ids, values = {}) {
  const elements = Object.fromEntries(ids.map((id) => [id, element(id)]));
  const document = {
    readyState: 'complete',
    getElementById(id) { return elements[id] || null; },
    querySelectorAll() { return []; },
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

test('calculator page has a complete browser DOM contract and shared draft script', () => {
  const requiredIds = [
    'budgetNumber', 'budgetRange', 'qtyNumber', 'qtyRange', 'deliveryDate', 'deliveryTime',
    'shippingMode', 'shippingFee', 'districtInput', 'shippingZone', 'copySummary',
    'lineSelected', 'calcResults', 'calcSelectedList', 'sumTotal', 'floatingTotal',
  ];
  for (const id of requiredIds) assert.match(calculatorHtml, new RegExp(`id=["']${id}["']`));
  assert.ok(calculatorHtml.indexOf('js/order-draft.js') < calculatorHtml.indexOf('js/budget-calculator.js'));
  assert.match(calculatorHtml, /ส่งสรุปให้แอดมินตรวจสอบ/);
});

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
    EED_SNACK_MIN_ORDER: 50,
  });
  vm.runInNewContext(snackHydrateSource, context);

  assert.equal(elements.snackFullMenu.getAttribute('data-hydrated'), 'true');
  assert.match(elements.snackFullMenu.innerHTML, /บราวนี่/);
  assert.equal(elements.snackBasePrice.textContent, '40');
  assert.equal(elements.snackMinOrder.textContent, '50');
});

test('snack box builder updates summary in a browser-like context', () => {
  const ids = [
    'sbDeliveryZone', 'sbSweetList', 'sbSavoryList', 'sbJuiceList', 'sbAddonList',
    'sbSweetCount', 'sbSavoryCount', 'sbJuiceCount', 'sbQtyNumber', 'sbQtyRange',
    'sbQtyDec', 'sbQtyInc', 'sbSumBudget', 'sbSumQty', 'sbSumQty2', 'sbSumAddon',
    'sbSumAddonPrice', 'sbSumSweet', 'sbSumSavory', 'sbSumJuice', 'sbSumFood',
    'sbSumShipLabel', 'sbSumShip', 'sbSumTotal', 'sbSumAvg', 'sbLineBtn', 'sbCopySummary', 'sbCopyToast',
  ];
  const { context, elements } = browserContext(ids, {
    EED: {
      shippingZones: { zone_1: { label: 'กรุงเทพชั้นใน', moto: 60, car: 120 } },
      shippingZoneFreeThresholds: { zone_1: 50 },
      shippingCarMinQty: 40,
    },
    EED_SNACK_MENUS: [],
    EED_SNACK_ADDONS: [{ id: 'water', name: 'น้ำเปล่า', note: '', price: 0 }],
  });
  vm.runInNewContext(snackBuilderSource, context);

  assert.match(elements.sbDeliveryZone.innerHTML, /zone_1/);
  assert.equal(elements.sbSumQty.textContent, '50');
  assert.match(elements.sbSumShip.textContent, /เลือกเขต/);
  elements.sbQtyInc.dispatch('click');
  assert.equal(elements.sbSumQty.textContent, '55');
});

test('public pages load their browser enhancers after shared data scripts', () => {
  assert.ok(popularHtml.indexOf('js/menu-data.js') < popularHtml.indexOf('js/popular-menu-hydrate.js'));
  assert.ok(snackHtml.indexOf('js/snack-data.js') < snackHtml.indexOf('js/snack-hydrate.js'));
  assert.ok(snackHtml.indexOf('js/snack-hydrate.js') < snackHtml.indexOf('js/snack-builder.js'));
});
