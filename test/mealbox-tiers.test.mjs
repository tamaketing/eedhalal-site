import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  computeTierFloors,
  isLaunching,
  renderTierCards,
  renderTierTable,
  resolveSideChoices,
  setsFromPlanner,
  sideChoiceLine,
  sideChoiceProblems,
  sideChoiceSummary,
  sideItemsFromPlanner,
  tierContext,
  tierDefinitions,
} from '../scripts/mealbox-tiers.mjs';
import { renderAdminTierTable } from '../scripts/mealbox-tiers.mjs';

// One definition (business-rules.json), one price rule (the published
// catalogue), three renderers (menu page, homepage, admin preview). Nothing
// here may contain a typed price: every figure in the output has to be the
// cheapest open set of that tier.

const root = new URL('../', import.meta.url);
const rules = JSON.parse(await readFile(new URL('data/business-rules.json', root), 'utf8'));
const overrides = JSON.parse(await readFile(new URL('data/planner-overrides.json', root), 'utf8'));
const sets = setsFromPlanner(overrides);
const floors = computeTierFloors(sets).floors;

const moneyIn = (html) => [...html.matchAll(/(\d[\d,]*)\s*(?:บาท|THB)/g)].map((m) => Number(m[1].replace(/,/g, '')));
const allowedMoney = new Set([
  ...new Set(sets.filter((set) => !set.hidden && !set.quoteOnly).map((set) => set.price)),
]);

test('the three levels are declared once, in business data', () => {
  const tiers = tierDefinitions(rules);
  assert.deepEqual(tiers.map((tier) => tier.id), ['classic', 'signature', 'executive']);
  for (const tier of tiers) {
    for (const field of ['nameTh', 'nameEn', 'sellingPointTh', 'sellingPointEn', 'bestForTh', 'bestForEn']) {
      assert.ok(tier[field] && tier[field].length > 2, `${tier.id}.${field} must be written, not invented at render time`);
    }
  }
  // The Thai first mention explains what the level is.
  assert.match(tiers[2].nameTh, /^Executive Premium Halal Box — ข้าวกล่องฮาลาลระดับพรีเมียม/);
});

test('the Thai first mention names the level in English and explains it', () => {
  const tiers = tierDefinitions(rules);
  for (const tier of tiers) {
    assert.ok(tier.nameTh.startsWith(tier.nameEn), `${tier.id}: the Thai name must lead with the English level name`);
  }
});

// --- Signature: the second dish, and an open-for-sale tier ---

test('a side item is named from the catalogue, never typed into the page', () => {
  const sideItems = sideItemsFromPlanner({
    sideItems: [
      { id: 'side-001', nameTh: 'ไก่ทอด', nameEn: 'Fried Chicken', kind: 'side', priceAdjustment: 25, priceStatus: 'ready', active: true, public: true },
      { id: 'soup-001', nameTh: 'ต้มยำไก่', nameEn: 'Chicken Tom Yum', kind: 'soup_curry', priceAdjustment: null, priceStatus: 'pending', active: true, public: true },
      { id: 'side-003', nameTh: 'ผัดผักรวม', nameEn: 'Stir-fried mixed vegetables', kind: 'side', priceAdjustment: 20, priceStatus: 'ready', active: true, public: false },
    ],
  });
  const signature = { ...tierDefinitions(rules).find((tier) => tier.id === 'signature'), sideChoices: ['side-001', 'soup-001', 'side-003', 'side-404'] };
  const { items, unresolved } = resolveSideChoices(signature, sideItems);
  assert.deepEqual(items.map((item) => item.id), ['side-001', 'soup-001', 'side-003']);
  // A dangling id is reported, never silently swallowed.
  assert.deepEqual(unresolved, ['side-404']);
  // A public side reaches the page; a non-public one stays in the back office.
  assert.equal(sideChoiceLine(signature, sideItems, false).includes('ผัดผักรวม'), false);
  assert.equal(sideChoiceLine(signature, sideItems, false).includes('ไก่ทอด'), true);
  // An unconfirmed side has no number anywhere a customer can read it.
  assert.equal(sideItems.get('soup-001').priceAdjustment, null);
  for (const figure of moneyIn(sideChoiceLine(signature, sideItems, false) + sideChoiceSummary(signature, sideItems, true))) {
    assert.ok(!figure, 'a side-choice list must never carry a price');
  }
});

test('the customer is offered a "second dish", never a cooking category', () => {
  const sideItems = sideItemsFromPlanner({
    sideItems: [
      { id: 'side-001', nameTh: 'ไก่ทอด', nameEn: 'Fried Chicken', kind: 'side', priceAdjustment: null, priceStatus: 'pending', active: true, public: true },
      { id: 'soup-001', nameTh: 'ต้มยำไก่', nameEn: 'Chicken Tom Yum', kind: 'soup_curry', priceAdjustment: null, priceStatus: 'pending', active: true, public: true },
    ],
  });
  const signature = { ...tierDefinitions(rules).find((tier) => tier.id === 'signature'), sideChoices: ['side-001', 'soup-001'] };
  const line = sideChoiceLine(signature, sideItems, false);
  const summary = sideChoiceSummary(signature, sideItems, true);
  // Both cooking types sit under one label, because that is what the guest picks.
  assert.match(line, /^<p class="tier-side-choices">อาหารเมนูที่ 2: /);
  assert.ok(line.includes('ไก่ทอด · ต้มยำไก่'));
  assert.match(summary, /^Second dish: /);
  // The internal kind never reaches the page. Compare the visible text only:
  // the markup legitimately contains a `tier-side-choices` class name.
  const visible = line.replace(/<[^>]+>/g, '');
  for (const internal of ['side', 'soup_curry']) {
    assert.ok(!visible.includes(internal), `${internal} must not be customer-facing`);
  }
});

test('the box says four compartments: rice, main, second dish, vegetables', () => {
  const signature = tierDefinitions(rules).find((tier) => tier.id === 'signature');
  assert.match(signature.boxFormatTh, /ข้าว อาหารหลัก 1 อย่าง อาหารรอง 1 อย่าง และผัก ในกล่อง 4 ช่อง/);
  assert.match(signature.boxFormatEn, /Rice, one main, one second dish, and vegetables, in a four-compartment box/);
});

test('the side-choice list is never empty-handed: a typo cannot pass the gate', () => {
  const clean = { ...tierDefinitions(rules).find((tier) => tier.id === 'signature'), sideChoices: [] };
  const broken = { ...clean, sideChoices: ['side-001'] };
  assert.deepEqual(sideChoiceProblems({ services: { mealBox: { tiers: [clean] } } }, { sideItems: [] }), []);
  assert.equal(sideChoiceProblems({ services: { mealBox: { tiers: [broken] } } }, { sideItems: [] }).length, 1);
});

test('a tier with published sets is open for sale, whatever the launch flag says', () => {
  const signature = tierDefinitions(rules).find((tier) => tier.id === 'signature');
  // Signature has published sets, so it must read as orderable and must not
  // print the launch note. `isLaunching` is only ever true with no floor.
  assert.ok(floors.signature, 'Signature has open sets in the published catalogue');
  assert.ok(!isLaunching(signature, floors.signature), 'a published set wins over any launch flag');
  for (const page of [renderTierTable({ rules, sets }), renderTierCards({ rules, sets })]) {
    assert.ok(!/กำลังเตรียมเปิดตัว|ยังสั่งไม่ได้/.test(page), 'an open tier must not say it is not for sale');
    assert.ok(!/ยังไม่ประกาศราคา|แจ้งให้ผมทราบเมื่อเปิด/.test(page));
  }
});

test('the launch treatment still exists for a tier that has no set yet', () => {
  // The mechanism must stay for a future level, so prove it on a synthetic tier
  // rather than by putting Signature back into a state it has left.
  const launching = { ...tierDefinitions(rules).find((tier) => tier.id === 'classic'), id: 'signature', launchStatus: 'launching', launchNoteTh: 'กำลังเตรียมเปิดตัว' };
  assert.ok(isLaunching(launching, null));
  assert.ok(!isLaunching(launching, { priceFrom: 90, sourceId: 1, sourceName: 'x' }));
});

test('the launch note reaches the customer page for a tier that has no set yet', () => {
  // Signature is on sale now, so prove the launch copy still renders by taking a
  // tier definition and giving it no published sets at all.
  const launching = {
    ...tierDefinitions(rules).find((tier) => tier.id === 'executive'),
    id: 'executive',
    launchStatus: 'launching',
    launchNoteTh: 'กำลังเตรียมเปิดตัว',
    launchNoteEn: 'preparing to launch',
  };
  for (const en of [false, true]) {
    const table = renderTierTable({ rules: { services: { mealBox: { tiers: [launching] } } }, sets: [], en });
    assert.ok(table.includes(en ? 'preparing to launch' : 'กำลังเตรียมเปิดตัว'), `EN=${en}`);
    assert.ok(table.includes(en ? 'Tell me when it opens' : 'แจ้งให้ผมทราบเมื่อเปิด'), `EN=${en}`);
  }
});

test('the pairing sentence reaches every generated channel', () => {
  const signature = tierDefinitions(rules).find((tier) => tier.id === 'signature');
  for (const html of [renderTierTable({ rules, sets }), renderTierCards({ rules, sets })]) {
    assert.ok(html.includes(signature.sideChoiceNoteTh), 'the web must explain how the pairing works');
  }
});

test('Signature is open for sale and its price comes from the catalogue', () => {
  const signature = tierDefinitions(rules).find((tier) => tier.id === 'signature');
  assert.equal(signature.launchStatus, 'open', 'no tier carries a launch flag while it is on sale');
  assert.equal(signature.launchNoteTh, '', 'the launch note must not linger on an open tier');
  assert.equal(signature.launchNoteEn, '');
  const floor = floors.signature;
  assert.ok(floor, 'Signature must have an open set');
  for (const en of [false, true]) {
    const page = renderTierTable({ rules, sets, overrides, en });
    assert.ok(page.includes(String(floor.priceFrom)), `EN=${en} must show the computed price`);
    // The Thai row names the set the price came from; the English row is kept
    // compact and says the figure is food only. Both must avoid a bare promise.
    assert.ok(
      en ? page.includes('Food only, per box.') : page.includes(floor.sourceName),
      `EN=${en} must qualify the price`,
    );
  }
});

test('every published second dish has a confirmed price and none leaks a cost', () => {
  const signature = tierDefinitions(rules).find((tier) => tier.id === 'signature');
  const items = resolveSideChoices(signature, sideItemsFromPlanner(overrides)).items;
  assert.ok(items.length >= 3, 'Signature must offer a real choice of second dishes');
  for (const item of items) {
    assert.ok(item.priceAdjustment > 0, `${item.id} must have a confirmed price adjustment`);
    assert.equal(item.priceStatus, 'ready');
    // The published projection has no cost key at all, so nothing can leak it.
    assert.ok(!('cost' in item), `${item.id} must not carry a cost`);
  }
});

test('a tier price is the cheapest published set of that tier', () => {
  for (const tier of tierDefinitions(rules)) {
    const members = sets.filter((set) => set.tier === tier.id && set.price > 0);
    const floor = floors[tier.id];
    if (!members.length) {
      assert.equal(floor, null, `${tier.id} has no open set, so it must have no price`);
      continue;
    }
    const cheapest = members.reduce((a, b) => (b.price < a.price ? b : a));
    assert.equal(floor.priceFrom, cheapest.price);
    assert.equal(floor.sourceId, cheapest.id);
    assert.equal(floor.sourceName, cheapest.name);
  }
});

test('adding a cheaper set moves the floor, hiding it puts the old price back', () => {
  const base = computeTierFloors(sets).floors.executive;
  assert.ok(base, 'the committed catalogue has an executive set');
  const withCheaper = [...sets, { id: 900, name: 'ชุดบริหาร 150', price: 150, tier: 'executive', image: 'img/x.jpg', minPerMenu: 10 }];
  assert.equal(computeTierFloors(withCheaper).floors.executive.priceFrom, 150, 'a cheaper executive set must lower the floor');
  const withoutIt = [...sets.filter((set) => set.id !== 900), { id: 900, name: 'ชุดบริหาร 150', price: 150, tier: 'executive', image: '', minPerMenu: 10, hidden: true }];
  assert.equal(computeTierFloors(withoutIt).floors.executive.priceFrom, base.priceFrom, 'a hidden set must not define the floor');
  const switchedOff = [...sets, { id: 901, name: 'ปิดราคา', price: 100, tier: 'executive', image: '', minPerMenu: 10, quoteOnly: true }];
  assert.equal(computeTierFloors(switchedOff).floors.executive.priceFrom, base.priceFrom, 'a set with its price switched off must not define the floor');
});

test('the table shows a computed price or an honest alternative, never a fallback', () => {
  for (const en of [false, true]) {
    const table = renderTierTable({ rules, sets, en });
    const context = tierContext(rules, sets);
    for (const tier of context.tiers) {
      const row = table.split('<tr ').find((chunk) => chunk.includes(`id="tier-${tier.id}"`));
      assert.ok(row, `${tier.id} row must exist`);
      const floor = context.floors[tier.id];
      if (floor) {
        assert.ok(row.includes(String(floor.priceFrom)), `${tier.id} must show its computed price`);
      } else if (isLaunching(tier, floor)) {
        // A tier being prepared must read as "not yet", never as an order path.
        assert.ok(row.includes(en ? 'Launching soon' : 'กำลังเตรียมเปิดตัว'), `${tier.id} must say it is launching`);
        assert.ok(row.includes(en ? 'Tell me when it opens' : 'แจ้งให้ผมทราบเมื่อเปิด'), `${tier.id} must invite interest, not an order`);
      } else {
        assert.ok(row.includes(en ? 'Ask us about this set' : 'สอบถามรายละเอียดชุดอาหาร'), `${tier.id} must ask instead of quoting`);
        assert.ok(!/\d+\s*(?:บาท|THB)/.test(row.split('<td>')[2] ?? ''), `${tier.id} must not print a price`);
      }
      // Whatever the state, an unpriced tier never prints a figure.
      if (!floor) {
        assert.ok(!new RegExp(`\\d+\\s*(?:บาท|THB)`).test(row.split('<td>')[1] ?? ''), `${tier.id} must not print a price`);
      }
    }
  }
});

test('every money figure on the tier pages is a catalogue price', () => {
  const pages = [renderTierTable({ rules, sets }), renderTierTable({ rules, sets, en: true }),
    renderTierCards({ rules, sets }), renderTierCards({ rules, sets, en: true })];
  for (const page of pages) {
    for (const figure of moneyIn(page)) {
      assert.ok(allowedMoney.has(figure), `${figure} THB is not a price the catalogue sells`);
    }
  }
});

test('the tier cards and table name every level and link to it', () => {
  const cards = renderTierCards({ rules, sets });
  const table = renderTierTable({ rules, sets });
  for (const tier of tierDefinitions(rules)) {
    assert.ok(cards.includes(`id="tier-${tier.id}-card"`), `${tier.id} card`);
    assert.ok(table.includes(`id="tier-${tier.id}"`), `${tier.id} table row`);
    assert.ok(cards.includes(tier.nameTh), `${tier.id} name on the homepage`);
  }
});

test('the homepage card uses the real photo of the set behind the price', () => {
  const cards = renderTierCards({ rules, sets });
  const classic = floors.classic;
  const source = sets.find((set) => set.id === classic.sourceId);
  assert.ok(cards.includes(source.image), 'the classic card must show the set that sets the price');
});

test('English cards use a parent-relative image path', () => {
  const cards = renderTierCards({ rules, sets, en: true });
  const source = sets.find((set) => set.id === floors.classic.sourceId);
  assert.ok(cards.includes(`src="../${source.image}"`), 'en/ pages need ../assets');
});

test('the admin preview names the price, the set and the id behind it', () => {
  const preview = renderAdminTierTable({ rules, sets });
  for (const tier of tierDefinitions(rules)) {
    const floor = floors[tier.id];
    if (!floor) {
      // A launching tier is stated as such; a tier with no sets at all says so.
      assert.ok(
        preview.includes(isLaunching(tier, floor) ? 'กำลังเตรียมเปิดตัว' : 'ยังไม่มีชุดเปิดขาย'),
        `${tier.id} must say why it has no price`,
      );
      continue;
    }
    assert.ok(preview.includes(`${floor.sourceName} (ID ${floor.sourceId})`), `${tier.id} must name its cheapest set`);
    assert.ok(preview.includes(`${floor.priceFrom.toLocaleString('en-US')} บาท`), `${tier.id} must show its price`);
  }
});

test('the admin preview shows the change against what is published now', () => {
  const cheaper = sets.map((set) => (set.id === floors.executive.sourceId ? { ...set, price: set.price - 50 } : set));
  const preview = renderAdminTierTable({ rules, sets: cheaper, previous: sets });
  const from = floors.executive.priceFrom;
  assert.ok(preview.includes(`${from} → ${from - 50} บาท`), 'a moving floor must show the old and the new figure');
});

test('a catalogue with nothing open produces no price anywhere', () => {
  const empty = computeTierFloors([]).floors;
  assert.deepEqual(Object.values(empty), [null, null, null]);
  const table = renderTierTable({ rules, sets: [], en: true });
  assert.ok(!/\d+\s*THB/.test(table.split('<tbody>')[1] ?? ''), 'no price may appear without an open set');
  assert.ok(table.includes('Ask us about this set'));
});