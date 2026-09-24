import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateShipping,
  checkSystem,
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
  assert.ok(activeMenus.some((menu) => menu.minPerMenu === 5));
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

test('Sathorn uses motorcycle through 40 boxes and car above 40', () => {
  assert.deepEqual(
    calculateShipping(data.rules, data.catalog, 'สาทร', 20),
    {
      found: true,
      zoneId: 'zone_1',
      zoneLabel: 'กรุงเทพชั้นใน',
      vehicle: 'moto',
      freeFrom: 50,
      isFree: false,
      fee: 60,
    },
  );
  assert.equal(calculateShipping(data.rules, data.catalog, 'สาทร', 40).fee, 60);
  assert.equal(calculateShipping(data.rules, data.catalog, 'สาทร', 41).fee, 120);
  assert.equal(calculateShipping(data.rules, data.catalog, 'สาทร', 50).fee, 0);
});

test('Sukhumvit zone becomes free at exactly 75 boxes', () => {
  const beforeThreshold = calculateShipping(data.rules, data.catalog, 'วัฒนา', 74);
  const atThreshold = calculateShipping(data.rules, data.catalog, 'วัฒนา', 75);
  assert.equal(beforeThreshold.vehicle, 'car');
  assert.equal(beforeThreshold.fee, 180);
  assert.equal(beforeThreshold.isFree, false);
  assert.equal(atThreshold.fee, 0);
  assert.equal(atThreshold.isFree, true);
});

test('zone 5 never becomes free when threshold is zero', () => {
  const quote = calculateShipping(data.rules, data.catalog, 'ลาดกระบัง', 1000);
  assert.equal(quote.freeFrom, null);
  assert.equal(quote.isFree, false);
  assert.equal(quote.fee, 500);
});

test('district delivery thresholds use the canonical zone, not a nearby local-page name', () => {
  const ladphraoAt75 = calculateShipping(data.rules, data.catalog, 'ลาดพร้าว', 75);
  const bangPhlatAt75 = calculateShipping(data.rules, data.catalog, 'บางพลัด', 75);
  const bangKhaeAt100 = calculateShipping(data.rules, data.catalog, 'บางแค', 100);
  assert.equal(ladphraoAt75.zoneId, 'zone_4');
  assert.equal(ladphraoAt75.isFree, false);
  assert.equal(calculateShipping(data.rules, data.catalog, 'ลาดพร้าว', 100).isFree, true);
  assert.equal(bangPhlatAt75.zoneId, 'zone_4');
  assert.equal(bangPhlatAt75.isFree, false);
  assert.equal(bangKhaeAt100.zoneId, 'zone_5');
  assert.equal(bangKhaeAt100.isFree, false);
});

test('unknown districts require a manual quote', () => {
  assert.deepEqual(
    calculateShipping(data.rules, data.catalog, 'นนทบุรี', 100),
    { found: false, fee: null, isFree: false, zoneId: null },
  );
});

test('meal-box lead time starts at the published 10-box minimum', () => {
  assert.deepEqual(
    [9, 10, 50, 100, 101].map((quantity) => getLeadTime(data.rules, quantity)?.minQuantity),
    [undefined, 10, 10, 10, 10],
  );
  assert.equal(getLeadTime(data.rules, 9), null);
});
