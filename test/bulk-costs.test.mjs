import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { applyBulkCosts, bulkCostRows } from '../tools/admin/bulk-costs.mjs';

// Confirming costs one dish at a time was the slowest part of the menu
// workflow. The batch merge has to be safe enough to trust with 39 rows at
// once, so these tests pin the rules that protect the owner's numbers: 0 is
// never a cost, a batch merges instead of replacing, and an unusable row is
// reported rather than confirmed.

const BOXES = {
  three: { label: 'กล่อง 3 ช่อง (รวมช้อนส้อม)', cost: 5, status: 'confirmed', note: '' },
  four: { label: 'กล่อง 4 ช่อง (รวมช้อนส้อม)', cost: 8, status: 'confirmed', note: '' },
  pendingBox: { label: 'กล่องที่ยังไม่ยืนยันต้นทุน', cost: null, status: 'pending', note: '' },
};

const emptyStore = () => ({ version: 1, boxes: structuredClone(BOXES), dishes: [], extras: [], toppings: [] });

const row = (menuId, name, foodCost, box = 'three', extra = {}) => ({
  menuId, name, foodCost, box, ...extra,
});

test('a confirmed batch creates one dish per menu and opens nothing by itself', () => {
  const store = emptyStore();
  const { costs, applied, skipped, errors } = applyBulkCosts(store, [
    row(1, 'ข้าว กะเพราไก่สับ', 42),
    row(2, 'ข้าวผัดกะเพรา', 48, 'four'),
  ]);
  assert.deepEqual(errors, []);
  assert.deepEqual(skipped, []);
  assert.equal(applied.length, 2);
  assert.equal(costs.dishes.length, 2);
  assert.deepEqual(costs.dishes.map((d) => d.status), ['confirmed', 'confirmed']);
  // Landed cost is food plus box, which is what the owner needs to sanity check.
  assert.equal(applied[0].landedCost, 47);
  assert.equal(applied[1].landedCost, 56);
});

test('0 is never a cost: the row stays unconfirmed and is reported', () => {
  const { costs, applied, skipped } = applyBulkCosts(emptyStore(), [
    row(1, 'ห้ามใส่ศูนย์', 0),
    row(2, 'เว้นว่าง', null),
    row(3, 'ลบเครื่องหมาย', 'abc'),
  ]);
  assert.equal(applied.length, 0);
  assert.equal(skipped.length, 3);
  assert.equal(costs.dishes.length, 0, 'a skipped row must not create a dish');
  for (const item of skipped) assert.match(item.reason, /ต้นทุนอาหาร/);
});

test('a negative cost is refused like zero', () => {
  const { applied, skipped } = applyBulkCosts(emptyStore(), [row(1, 'ติดลบ', -10)]);
  assert.equal(applied.length, 0);
  assert.equal(skipped.length, 1);
});

test('an unknown box, or a box whose cost is unconfirmed, blocks the row', () => {
  const { applied, skipped } = applyBulkCosts(emptyStore(), [
    row(1, 'กล่องไม่รู้จัก', 40, 'gold'),
    row(2, 'กล่องยังไม่ยืนยันทุน', 40, 'pendingBox'),
  ]);
  assert.equal(applied.length, 0);
  assert.equal(skipped.length, 2);
  assert.match(skipped[0].reason, /ไม่รู้จักกล่อง/);
  assert.match(skipped[1].reason, /ยังไม่ยืนยันต้นทุนกล่อง/);
});

test('the batch merges: dishes the owner did not touch are untouched', () => {
  const store = emptyStore();
  store.dishes.push({
    id: 'menu-9', menuId: 9, name: 'เดิม', items: [], toppings: [],
    foodCost: 60, box: 'three', includesBox: false, status: 'confirmed',
    enabled: true, note: 'โน้ตเดิม', kind: 'menu', menuIds: [],
    publicName: '', image: '', category: '', description: '', showOnWebsite: false,
  });
  const { costs } = applyBulkCosts(store, [row(1, 'ใหม่', 42)]);
  assert.equal(costs.dishes.length, 2);
  const kept = costs.dishes.find((d) => d.id === 'menu-9');
  assert.equal(kept.foodCost, 60);
  assert.equal(kept.note, 'โน้ตเดิม');
  assert.equal(kept.status, 'confirmed');
});

test('re-confirming an existing dish updates it instead of duplicating', () => {
  const store = emptyStore();
  store.dishes.push({
    id: 'menu-1', menuId: 1, name: 'เดิม', items: [], toppings: [],
    foodCost: 30, box: 'three', includesBox: false, status: 'confirmed',
    enabled: true, note: '', kind: 'menu', menuIds: [],
    publicName: '', image: '', category: '', description: '', showOnWebsite: false,
  });
  const { costs, applied } = applyBulkCosts(store, [row(1, 'แก้แล้ว', 55)]);
  assert.equal(costs.dishes.length, 1, 'must update, never append');
  assert.equal(costs.dishes[0].foodCost, 55);
  assert.equal(costs.dishes[0].name, 'แก้แล้ว');
  assert.equal(applied[0].created, false);
});

test('includesBox means the food cost already covers the box', () => {
  const { applied } = applyBulkCosts(emptyStore(), [row(1, 'รวมกล่อง', 45, 'three', { includesBox: true })]);
  assert.equal(applied[0].landedCost, 45);
});

test('a row with no name or no id is reported, never guessed', () => {
  const { applied, skipped } = applyBulkCosts(emptyStore(), [
    { foodCost: 40, box: 'three' },
    { menuId: 'abc', name: 'เลขเมนูพัง', foodCost: 40 },
    row(4, '', 40),
  ]);
  assert.equal(applied.length, 0);
  assert.equal(skipped.length, 3);
  assert.match(skipped[2].reason, /ไม่มีชื่อเมนู/);
});

test('a non-array payload is refused instead of wiping the store', () => {
  const store = emptyStore();
  store.dishes.push({ id: 'menu-1', menuId: 1, name: 'ของเดิม' });
  const { costs, errors } = applyBulkCosts(store, 'nope');
  assert.equal(errors.length, 1);
  assert.equal(costs.dishes.length, 1, 'the store must be untouched');
});

test('bulkCostRows reports every published menu with its cost state', () => {
  const costs = emptyStore();
  costs.dishes.push({
    id: 'menu-1', menuId: 1, name: 'ยืนยันแล้ว', items: [], toppings: [],
    foodCost: 42, box: 'three', includesBox: false, status: 'confirmed',
    enabled: true, note: '', kind: 'menu', menuIds: [],
    publicName: '', image: '', category: '', description: '', showOnWebsite: false,
  });
  const catalogue = [
    { id: 1, name: 'ยืนยันแล้ว', category: 'ข้าวราดแกง', image: 'img/a.jpg', price: 90, minPerMenu: 10 },
    { id: 2, name: 'ยังไม่ยืนยัน', category: 'ข้าวผัด', image: 'img/b.jpg', price: 70, minPerMenu: 10 },
  ];
  const rows = bulkCostRows(costs, catalogue);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].confirmed, true);
  assert.equal(rows[0].boxCost, 5);
  assert.equal(rows[1].confirmed, false);
  assert.equal(rows[1].foodCost, null);
  assert.equal(rows[1].sellPrice, 70);
});

test('a confirmed dish with no cost is not reported as confirmed', () => {
  const costs = emptyStore();
  costs.dishes.push({
    id: 'menu-1', menuId: 1, name: 'สถานะเพี้ยน', items: [], toppings: [],
    foodCost: null, box: 'three', includesBox: false, status: 'confirmed',
    enabled: true, note: '', kind: 'menu', menuIds: [],
    publicName: '', image: '', category: '', description: '', showOnWebsite: false,
  });
  const rows = bulkCostRows(costs, [{ id: 1, name: 'x', category: '', image: '', price: 90, minPerMenu: 10 }]);
  assert.equal(rows[0].confirmed, false, 'confirmed with no cost must not count');
});

test('the server refuses a batch that would fail validation', async () => {
  const server = await readFile(new URL('../tools/admin/server.mjs', import.meta.url), 'utf8');
  // The endpoint must validate the merged store before writing it.
  assert.match(server, /applyBulkCosts\(current, parsed\?\.rows\)/);
  assert.match(server, /validateCosts\(result\.costs\)/);
  assert.match(server, /backupBeforeWrite\(dataDir, 'owner-costs\.json'\)/);
  // And it must not be reachable cross-origin.
  const block = server.slice(server.indexOf("'/owner-costs/bulk'"), server.indexOf("'/owner-costs' &&"));
  assert.match(block, /Local use only/);
  assert.match(block, /application\/json/);
});