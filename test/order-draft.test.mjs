import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../js/order-draft.js', import.meta.url), 'utf8');

function loadDraftStore(initial = {}) {
  const values = new Map(Object.entries(initial));
  const localStorage = {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
  };
  const window = { localStorage, Math };
  vm.runInNewContext(source, { window, Date, Math, Uint32Array, isFinite });
  return { api: window.EEDOrderDraft, values };
}

test('order drafts preserve a stable reference and normalize the kitchen snapshot', () => {
  const { api } = loadDraftStore();
  const first = api.save({
    delivery: { date: '2026-09-10', time: '10:00', district: 'สาทร' },
    shipping: { mode: 'pending', fee: 0, text: 'รอแอดมินยืนยัน', requiresConfirmation: true },
    items: [{ id: 1, name: 'ข้าวกะเพราไก่', quantity: 10, options: ['ไก่'], unitPrice: 65, total: 650 }],
    totals: { requestedQuantity: 10, selectedQuantity: 10, food: 650, shipping: 0, grand: 650 },
  });
  const updated = api.save({ totals: { requestedQuantity: 20 } });

  assert.equal(first.schemaVersion, 2);
  assert.match(first.reference, /^EED-\d{8}-[A-Z0-9]+$/);
  assert.equal(updated.reference, first.reference);
  assert.equal(updated.totals.requestedQuantity, 20);
  assert.equal(updated.shipping.mode, 'pending');
  assert.equal(updated.shipping.requiresConfirmation, true);
  assert.deepEqual(api.get(), updated);
});

test('legacy calculator storage migrates to a versioned draft', () => {
  const { api } = loadDraftStore({
    eed_budget_calc_v1: JSON.stringify({ quantity: 10, selected: { 114: 10 }, selectedToppings: {}, selectedMeats: { 114: 0 } }),
    eed_budget_ship_v1: JSON.stringify({ mode: 'zone', fee: 60, district: 'สาทร' }),
    // Note: legacy zone-mode storage always migrates to pending-admin state.
    eed_delivery_date_v1: '2026-09-10',
    eed_delivery_time_v1: '10:00',
  });
  const draft = api.get();

  assert.equal(draft.schemaVersion, 2);
  assert.equal(draft.source, 'budget_calculator_legacy');
  assert.equal(draft.delivery.district, 'สาทร');
  assert.equal(draft.legacy.selected['114'], 10);
});
