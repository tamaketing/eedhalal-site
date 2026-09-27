import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateSet, customerMessage, dishById, mainCost, recommendBox, savouryCount, SHIPPING_PENDING } from '../tools/admin/logic.mjs';

// Fixture mirrors the dishes schema: recorded menus/sets with their own costs.
const costs = {
  dishes: [
    { id: 'menu-15', menuId: 15, name: 'ชุดทดสอบ ก', items: ['ชุดทดสอบ ก'], toppings: [], foodCost: 60, box: 'three', includesBox: false, status: 'confirmed', enabled: true, note: '' },
    { id: 'set-morning', menuId: null, name: 'ชุดทดสอบเช้า', items: ['ข้าวทดสอบ', 'ท็อปปิ้งไข่ทดสอบ'], toppings: [], foodCost: 70, box: 'four', includesBox: true, status: 'confirmed', enabled: true, note: '' },
    { id: 'menu-16', menuId: 16, name: 'ชุดทดสอบ ข', items: ['ชุดทดสอบ ข'], toppings: [], foodCost: null, box: '', includesBox: false, status: 'pending', enabled: true, note: '' },
  ],
  extras: [],
  toppings: [
    { id: 'egg-legacy', name: 'ท็อปปิ้งไข่', unit: 'ฟอง', cost: 8, status: 'confirmed', enabled: true, note: '' },
    { id: 'topping-new', name: 'ท็อปปิ้งทดสอบ', unit: 'ชิ้น', cost: 5, status: 'confirmed', enabled: true, note: '' },
    { id: 'topping-pending', name: 'ท็อปปิ้งท็อปปิ้งไข่ทดสอบ', unit: 'ชิ้น', cost: null, status: 'pending', enabled: true, note: '' },
  ],
  fruit: { label: 'ผลไม้ทดสอบ', cost: 30, status: 'confirmed', note: '' },
  boxes: {
    three: { label: 'กล่อง 3 ช่อง (รวมช้อนส้อม)', cost: 5, status: 'confirmed', note: '' },
    four: { label: 'กล่อง 4 ช่อง (รวมช้อนส้อม)', cost: 8, status: 'confirmed', note: '' },
    corrugated: { label: 'กล่องลูกฟูก (รวมช้อนส้อม)', cost: 25, status: 'confirmed', note: '' },
  },
};
const catalog = [{ id: 15, name: 'ชุดทดสอบ ก', category: 'ข้าวทดสอบ' }];
function draft(overrides = {}) {
  return { title: 'ชุดทดสอบ', menuId: 15, customMain: '', count: '10', costChoice: 'dish:menu-15',
    manualMainCost: '', toppings: [], fruit: false, extras: [], dishItems: [], box: 'three', boxTouched: true,
    boxIncludedInCost: false, quote: '', internalNote: 'PRIVATE-KITCHEN-NOTE', ...overrides };
}

test('เมนูที่บันทึก + ท็อปปิ้งไข่เดิมหนึ่งฟอง + กล่องสามช่อง = 73 บาท/กล่อง', () => {
  assert.equal(dishById(costs, 'menu-15').name, 'ชุดทดสอบ ก');
  assert.equal(mainCost(draft(), costs), 60);
  const result = calculateSet(draft({ toppings: [{ toppingId: 'egg-legacy', quantity: '1', includedInFoodCost: false }], quote: '95' }), costs, catalog);
  assert.equal(result.knownPerBox, 73);
  assert.equal(result.knownTotal, 730);
  assert.equal(result.differencePerBox, 22);
  assert.equal(result.differenceTotal, 220);
  assert.deepEqual(result.missing, []);
});

test('คำนวณหลายท็อปปิ้งตามจำนวนต่อกล่อง และไม่บวกซ้ำเมื่อรวมในทุนอาหาร', () => {
  const toppings = [
    { toppingId: 'egg-legacy', quantity: 2, includedInFoodCost: false },
    { toppingId: 'topping-new', quantity: 3, includedInFoodCost: false },
  ];
  const added = calculateSet(draft({ toppings }), costs, catalog);
  assert.equal(added.knownPerBox, 96); // 60 + (2 × 8) + (3 × 5) + กล่อง 5
  assert.deepEqual(added.missing, []);
  const included = calculateSet(draft({ toppings: toppings.map((item) => ({ ...item, includedInFoodCost: true })) }), costs, catalog);
  assert.equal(included.knownPerBox, 65); // ทุนอาหารรวมไว้แล้ว จึงบวกเฉพาะกล่อง
  assert.equal(included.complete, true);
});

test('ท็อปปิ้งรอยืนยันหรือปิดใช้งานกันชุดออกจากสถานะพร้อม', () => {
  const pending = calculateSet(draft({ toppings: [{ toppingId: 'topping-pending', quantity: 1, includedInFoodCost: false }] }), costs, catalog);
  assert.equal(pending.complete, false);
  assert.ok(pending.missing.some((value) => value.includes('ต้นทุนยังไม่ยืนยัน')));
  const disabledCosts = { ...costs, toppings: costs.toppings.map((item) => item.id === 'egg-legacy' ? { ...item, enabled: false } : item) };
  const disabled = calculateSet(draft({ toppings: [{ toppingId: 'egg-legacy', quantity: 1, includedInFoodCost: false }] }), disabledCosts, catalog);
  assert.equal(disabled.complete, false);
  assert.ok(disabled.missing.some((value) => value.includes('ปิดใช้งาน')));
});

test('ชุดที่รวมกล่องแล้วไม่บวกค่ากล่องซ้ำ', () => {
  const included = draft({ title: 'ชุดทดสอบเช้า', menuId: 'custom', customMain: 'ชุดทดสอบเช้า', costChoice: 'dish:set-morning', box: 'four', boxIncludedInCost: true });
  assert.equal(mainCost(included, costs), 70);
  assert.equal(calculateSet(included, costs, catalog).knownPerBox, 70);
  const added = calculateSet({ ...included, boxIncludedInCost: false }, costs, catalog);
  assert.equal(added.knownPerBox, 78);
});

test('ทุนอาหารรอยืนยัน/ไม่ระบุไม่ใช้ 0 และไม่คำนวณส่วนต่างหรือความคุ้มงบ', () => {
  const pending = calculateSet(draft({ costChoice: 'dish:menu-16', quote: '95' }), costs, catalog);
  assert.equal(mainCost(draft({ costChoice: 'dish:menu-16' }), costs), null);
  assert.ok(pending.missing.includes('ต้นทุนอาหารหลัก'));
  assert.equal(pending.differencePerBox, null);
  assert.ok(!pending.missing.join(' ').includes('0 บาท'));
  const result = calculateSet(draft({ quote: '95', extras: [{ kind: 'side', name: 'กับข้าวทดสอบ', cost: '' }] }), costs, catalog);
  assert.equal(result.knownPerBox, 65);
  assert.equal(result.complete, false);
  assert.equal(result.differencePerBox, null);
  assert.match(result.missing.join(' '), /กับข้าวทดสอบ — ยังไม่ระบุต้นทุน/);
  const missingMain = calculateSet(draft({ costChoice: '', quote: '95' }), costs, catalog);
  assert.ok(missingMain.missing.includes('ต้นทุนอาหารหลัก'));
  assert.equal(missingMain.differencePerBox, null);
});

test('ข้าวไม่นับกับข้าว และกล่องสี่ช่องเมื่อมีต้ม/กับแกงทดสอบพร้อมผลไม้ทดสอบ', () => {
  const set = draft({ fruit: true, extras: [{ kind: 'soup', name: 'ซุปทดสอบ', cost: '20' }] });
  assert.equal(savouryCount(set), 2);
  assert.equal(recommendBox(set).id, 'four');
  const withCurry = draft({ fruit: true, extras: [{ kind: 'curry', name: 'กับแกงทดสอบ', cost: '20' }] });
  assert.equal(recommendBox(withCurry).id, 'four');
  const example = draft({ extras: [
    { kind: 'side', name: 'กับข้าวทดสอบ', cost: '15' },
    { kind: 'soup', name: 'ซุปทดสอบ', cost: '20' },
  ] });
  assert.equal(savouryCount(example), 3); // main + side + soup; rice is excluded
});

test('กล่องลูกฟูกเมื่ออาหารคาวเกิน 3 อย่างพร้อมผลไม้ทดสอบและของหวานทดสอบ; นอกเงื่อนไขต้องยืนยันเอง', () => {
  const set = draft({ fruit: true, extras: [
    { kind: 'side', name: 'กับข้าวทดสอบ', cost: '15' }, { kind: 'soup', name: 'ซุปทดสอบ', cost: '20' },
    { kind: 'curry', name: 'กับแกงทดสอบ', cost: '25' }, { kind: 'dessert', name: 'ของหวานทดสอบ', cost: '12' },
  ] });
  assert.equal(savouryCount(set), 4);
  assert.equal(recommendBox(set).id, 'corrugated');
  const outside = draft({ quote: '90', boxTouched: false, extras: [{ kind: 'side', name: 'กับข้าวทดสอบ', cost: '15' }] });
  assert.equal(recommendBox(outside).needsConfirmation, true);
  assert.equal(calculateSet(outside, costs, catalog).differencePerBox, null);
  assert.equal(calculateSet({ ...outside, boxTouched: true }, costs, catalog).complete, true);
});

test('กล่องปรับเองได้และจำนวนต่ำกว่า 10 ต่อชุดต้องเตือน', () => {
  assert.equal(calculateSet(draft({ box: 'four' }), costs, catalog).knownPerBox, 68);
  assert.equal(calculateSet(draft({ box: 'corrugated' }), costs, catalog).knownPerBox, 85);
  assert.ok(calculateSet(draft({ count: '9' }), costs, catalog).missing.some((value) => value.includes('10 กล่อง')));
  assert.ok(calculateSet(draft({ count: '10' }), costs, catalog).complete);
});

test('ข้อความลูกค้าไม่เปิดเผยต้นทุน, ส่วนต่าง, บันทึกภายใน หรือแต่งราคาขาย', () => {
  const set = draft({ toppings: [{ toppingId: 'egg-legacy', quantity: '1', includedInFoodCost: false }], fruit: true, extras: [{ kind: 'dessert', name: 'ของหวานทดสอบทดสอบ', cost: '17' }] });
  const result = calculateSet(set, costs, catalog);
  const withoutQuote = customerMessage([set], [result], '', costs);
  assert.ok(withoutQuote.includes(SHIPPING_PENDING));
  assert.ok(withoutQuote.includes('ท็อปปิ้งไข่ 1 ฟอง/กล่อง'));
  assert.ok(withoutQuote.includes('จำนวน 10 กล่อง'));
  assert.ok(!withoutQuote.includes('ราคาขายที่เสนอ'));
  for (const forbidden of ['ต้นทุน', 'ส่วนต่าง', 'PRIVATE-KITCHEN-NOTE', '73 บาท', '17 บาท']) assert.ok(!withoutQuote.includes(forbidden), forbidden);
  const quoted = customerMessage([{ ...set, quote: '110' }], [calculateSet({ ...set, quote: '110' }, costs, catalog)], '45', costs);
  assert.ok(quoted.includes('ราคาขายที่เสนอ 110 บาท/กล่อง'));
  assert.ok(quoted.includes('ค่าจัดส่ง 45 บาท'));
  assert.ok(!quoted.includes('PRIVATE-KITCHEN-NOTE'));
});

test('ข้อความลูกค้าของชุดแนะนำแสดงรายการอาหารตรงตามเจ้าของจัด', () => {
  const set = draft({ title: 'ชุดชุดทดสอบ ก', dishItems: ['ชุดทดสอบ ก'], quote: '120', priceIncludesDelivery: true });
  const text = customerMessage([set], [calculateSet(set, costs, catalog)], '', costs);
  assert.ok(text.includes('รายการในชุด: ชุดทดสอบ ก'));
  assert.ok(text.includes('ราคา 120 บาท/กล่อง (รวมค่าจัดส่งแล้ว)'));
  for (const forbidden of ['ต้นทุน', 'กำไร', 'ส่วนต่าง', '65 บาท', 'PRIVATE-KITCHEN-NOTE']) {
    assert.ok(!text.includes(forbidden), forbidden);
  }
});
