import assert from 'node:assert/strict';
import test from 'node:test';
import {
  checkSystem,
  deliveryPolicy,
  getEffectiveMenus,
  getLeadTime,
  loadSystemData,
  validateData,
} from '../scripts/check-system.mjs';

const data = await loadSystemData();

test('all system data and generated AI files are synchronized', async () => {
  await checkSystem();
});

test('business and menu data satisfy the canonical rules', () => {
  validateData(data.rules, data.catalog, data.legacy);
  const activeMenus = getEffectiveMenus(data.legacy.menus, data.catalog);
  assert.ok(activeMenus.length >= data.rules.services.mealBox.menuCountFrom);
  assert.equal(Math.min(...activeMenus.map((menu) => menu.price)), data.rules.services.mealBox.priceFrom);
  assert.ok(activeMenus.every((menu) => menu.minPerMenu === data.rules.services.mealBox.standardMenuMinimum));
  assert.ok(activeMenus.some((menu) => menu.minPerMenu === 10));
  assert.ok(!activeMenus.some((menu) => menu.minPerMenu === 8));
});

test('premium menu prices stay within the approved range', () => {
  const premium = getEffectiveMenus(data.legacy.menus, data.catalog)
    .filter((menu) => menu.category === 'พรีเมียม');
  assert.ok(premium.length > 0, 'at least one premium menu is required');
  premium.forEach((menu) => {
    assert.ok(menu.price >= data.rules.services.mealBox.premiumPriceFrom, `${menu.name} is below the premium price floor`);
    assert.ok(menu.price <= data.rules.services.mealBox.premiumPriceTo, `${menu.name} is above the premium price ceiling`);
  });
});

test('order minimum accepts 10 boxes and rejects 9', () => {
  const minimum = data.rules.services.mealBox.minimumOrder;
  assert.equal(9 >= minimum, false);
  assert.equal(10 >= minimum, true);
});

test('Snack Box minimum accepts 30 boxes and rejects 29', () => {
  const minimum = data.rules.services.snackBox.minimumOrder;
  assert.equal(29 >= minimum, false);
  assert.equal(30 >= minimum, true);
});

test('delivery is admin-quoted with complete policy messages', () => {
  const policy = deliveryPolicy(data.rules);
  assert.equal(policy.policy, 'adminQuote');
  assert.equal(policy.messageTh, 'กรุณาสอบถามค่าจัดส่งกับแอดมิน โดยแจ้งสถานที่จัดส่งและจำนวนที่ต้องการ');
  assert.equal(policy.messageEn, 'Please contact our team for a delivery quote with your delivery location and order quantity.');
  assert.equal(policy.coverageTh, 'จัดส่งทั่วกรุงเทพฯ');
  assert.equal(policy.coverageEn, 'Delivery across Bangkok');
  assert.equal(policy.pendingTh, 'รอแอดมินยืนยัน');
});

test('no zone rates, vehicle rules, or free thresholds remain in business data', () => {
  assert.equal(data.rules.delivery.zones, undefined);
  assert.equal(data.rules.delivery.carWhenQuantityAbove, undefined);
  assert.equal(data.rules.delivery.freeThresholdDefault, undefined);
  const legacy = data.legacy.business;
  for (const retired of ['shippingZones', 'shippingZoneFreeThresholds', 'freeDeliveryFrom', 'shippingCarMinQty', 'shippingAutoNote']) {
    assert.equal(legacy[retired], undefined, `${retired} must stay removed`);
  }
});

test('every district gets the same admin-quote answer (no lookup)', () => {
  for (const district of ['สาทร', 'วัฒนา', 'ลาดกระบัง', 'นนทบุรี', 'ลาดพร้าว']) {
    assert.equal(deliveryPolicy(data.rules).messageTh, data.rules.delivery.messageTh, district);
  }
  assert.ok(!/zone|50\+|75\+|100\+|มอเตอร์ไซค์|รถยนต์/.test(deliveryPolicy(data.rules).messageTh), 'policy message carries no rates');
});

test('meal-box lead time starts at the published 10-box minimum', () => {
  assert.deepEqual(
    [9, 10, 50, 100, 101].map((quantity) => getLeadTime(data.rules, quantity)?.minQuantity),
    [undefined, 10, 10, 10, 10],
  );
  assert.equal(getLeadTime(data.rules, 9), null);
});
