import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildMenuContext,
  buildMenuQueryString,
  MENU_FETCH_MODES,
  MENU_TIERS,
  MENU_TIER_LABELS,
  parseMenuIntent,
} from '../line-ai/menu-intent.mjs';

// §9 query-plan contract: exact field set, nullable scalars.
test('parser output keeps the deterministic plan shape', () => {
  for (const text of ['งบ 75 บาท', 'ไม่เกิน 100', 'ข้าวไก่เทอริยากิ ราคาเท่าไร', 'เมนูนี้ราคาเท่าไร', 'สวัสดี']) {
    const plan = parseMenuIntent(text);
    assert.deepEqual(Object.keys(plan).sort(), ['maxPrice', 'menuLookupNeeded', 'mode', 'price', 'query', 'tier']);
    assert.ok(['exact-price', 'max-price', 'name-lookup', 'name-price', 'name-max', 'tier-price', 'tier-max', 'clarify', 'none'].includes(plan.mode));
    assert.equal(plan.menuLookupNeeded, MENU_FETCH_MODES.includes(plan.mode));
  }
  // The three published levels, and every customer spelling maps onto one of
  // them. No dish-type list exists any more.
  assert.deepEqual([...new Set(Object.values(MENU_TIERS))].sort(), ['classic', 'executive', 'signature']);
  assert.deepEqual(Object.keys(MENU_TIER_LABELS).sort(), ['classic', 'executive', 'signature']);
});

// §24 mandatory parser cases.
test('exact-price parsing', () => {
  for (const text of ['งบ 75 บาท มีเมนูอะไรบ้าง', 'เมนู 75 บาท', 'งบกล่องละ 70 มีอะไรบ้าง', 'ขอเมนูราคา 75']) {
    const plan = parseMenuIntent(text);
    assert.equal(plan.mode, 'exact-price', text);
    assert.equal(plan.menuLookupNeeded, true, text);
  }
  assert.equal(parseMenuIntent('งบ 75 บาท มีเมนูอะไรบ้าง').price, 75);
  assert.equal(parseMenuIntent('เมนู 75 บาท').price, 75);
});

test('max-price parsing wins over exact wording', () => {
  for (const text of ['ไม่เกิน 100 บาท', 'งบไม่เกิน 100', 'มีเมนูไม่เกิน 100 บาทไหม', 'ราคาไม่เกิน 100 บาท']) {
    const plan = parseMenuIntent(text);
    assert.equal(plan.mode, 'max-price', text);
    assert.equal(plan.maxPrice, 100, text);
    assert.equal(plan.price, null, text);
  }
});

test('quantity is never mistaken for price', () => {
  assert.equal(parseMenuIntent('75 กล่อง').mode, 'none');
  const mixed = parseMenuIntent('ขอ 75 กล่อง งบ 100 บาท');
  assert.equal(mixed.mode, 'exact-price');
  assert.equal(mixed.price, 100);
  assert.equal(mixed.query, null);
});

test('explicit Thai name lookup', () => {
  const plan = parseMenuIntent('ข้าวไก่เทอริยากิ ราคาเท่าไร');
  assert.equal(plan.mode, 'name-lookup');
  assert.equal(plan.query, 'ข้าวไก่เทอริยากิ');
  assert.equal(parseMenuIntent('ข้าวไก่เทอริยากิเท่าไหร่').query, 'ข้าวไก่เทอริยากิ');
  assert.equal(parseMenuIntent('ข้าวผัดปลาทู ราคาเท่าไร').query, 'ข้าวผัดปลาทู');
});

test('demonstrative without a name clarifies instead of guessing', () => {
  for (const text of ['เมนูนี้ราคาเท่าไร', 'อันนี้เท่าไหร่', 'เมนูนั้นกี่บาท']) {
    const plan = parseMenuIntent(text);
    assert.equal(plan.mode, 'clarify', text);
    assert.equal(plan.menuLookupNeeded, false, text);
    assert.equal(plan.query, null, text);
  }
});

test('a dish word plus a budget still resolves, now as a name query', () => {
  // "ข้าวผัด งบ 70" used to be a category lookup. There is no category axis any
  // more, so the dish word is matched against menu names and composes with the
  // price filter — the customer loses nothing.
  const exact = parseMenuIntent('ข้าวผัด งบ 70');
  assert.equal(exact.mode, 'name-price');
  assert.equal(exact.query, 'ข้าวผัด');
  assert.equal(exact.price, 70);
  assert.equal(exact.tier, null);
  const max = parseMenuIntent('ข้าวผัดไม่เกิน 100');
  assert.equal(max.mode, 'name-max');
  assert.equal(max.query, 'ข้าวผัด');
  assert.equal(max.maxPrice, 100);
});

test('the level a customer names resolves in either spelling', () => {
  for (const [text, tier] of [
    ['เมนู Signature งบ 200', 'signature'],
    ['เมนูซิกเนเจอร์งบ 200', 'signature'],
    ['เมนู Classic งบ 70', 'classic'],
    ['เมนูพรีเมียมไม่เกิน 250', 'executive'],
    ['เมนู executive ไม่เกิน 250', 'executive'],
  ]) {
    const plan = parseMenuIntent(text);
    assert.equal(plan.tier, tier, text);
    assert.ok(MENU_FETCH_MODES.includes(plan.mode), `${text}: ${plan.mode} must be a fetch mode`);
    // The level word is consumed, so it never leaks into the name query.
    assert.ok(!/signature|classic|executive|ซิกเนเจอร์|พรีเมียม/i.test(plan.query || ''), text);
  }
  assert.equal(parseMenuIntent('เมนู Signature งบ 200').mode, 'tier-price');
  assert.equal(parseMenuIntent('เมนูพรีเมียมไม่เกิน 250').mode, 'tier-max');
});

test('a budget with no dish word and no level stays a plain price lookup', () => {
  const plan = parseMenuIntent('งบ 70');
  assert.equal(plan.mode, 'exact-price');
  assert.equal(plan.price, 70);
  assert.equal(plan.query, null);
  assert.equal(plan.tier, null);
});

test('protein words stay name keywords, never a formal level', () => {
  // "ไก่" is a menu-name keyword, never a level. The mode says `name-max`
  // because the name filter really is applied alongside the cap (the query
  // string always carried `q=`), so the label now matches the request instead
  // of claiming a bare budget search.
  const plan = parseMenuIntent('มีเมนูไก่ไม่เกิน 100 บาทไหม');
  assert.equal(plan.mode, 'name-max');
  assert.equal(plan.maxPrice, 100);
  assert.equal(plan.tier, null);
  assert.equal(plan.query, 'ไก่');
  assert.equal(
    buildMenuQueryString(plan),
    'maxPrice=100&q=%E0%B9%84%E0%B8%81%E0%B9%88&limit=100',
  );
});

test('delivery and general messages stay out of menu lookup', () => {
  for (const text of [
    '80 กล่อง ส่งวัฒนา ส่งฟรีไหม',
    '20 กล่องส่งสาทรค่าส่งเท่าไหร่',
    'ค่าส่ง 75 บาท',
    'เอาแบบแรก',
    'ขอบคุณ',
    'สวัสดี',
    '',
  ]) {
    const plan = parseMenuIntent(text);
    assert.equal(plan.mode, 'none', text);
    assert.equal(plan.menuLookupNeeded, false, text);
  }
});

// Query-string builder: fixed order, safe limit, URL-encoded.
test('menu query string carries only applicable filters', () => {
  assert.equal(buildMenuQueryString({ price: 75 }), 'price=75&limit=100');
  assert.equal(buildMenuQueryString({ maxPrice: 100 }), 'maxPrice=100&limit=100');
  assert.equal(
    buildMenuQueryString({ maxPrice: 100, query: 'ไก่' }),
    'maxPrice=100&q=%E0%B9%84%E0%B8%81%E0%B9%88&limit=100',
  );
  assert.equal(
    buildMenuQueryString({ maxPrice: 100, tier: 'executive' }),
    'maxPrice=100&tier=executive&limit=100',
  );
  assert.equal(
    buildMenuQueryString({ price: 200, tier: 'signature', query: 'ไก่' }),
    'price=200&tier=signature&q=%E0%B9%84%E0%B8%81%E0%B9%88&limit=100',
  );
  assert.equal(buildMenuQueryString({ mode: 'clarify' }), 'limit=100');
});

// §25 context builder with mocked API responses.
function apiOk(menus) {
  return { ok: true, menus };
}

test('context contains exactly the API-returned candidates', () => {
  const menus = [
    { id: '14', name: 'ข้าวไก่เทอริยากิ', price: 75, minPerMenu: 5, tier: 'classic' },
    { id: '15', name: 'ข้าวคลุกกะปิ', price: 75, minPerMenu: 5, tier: 'classic' },
    { id: '20', name: 'ข้าวหมกน่องไก่', price: 75, minPerMenu: 10, tier: 'signature' },
    { id: '104', name: 'ข้าวผัดปลาทู', price: 75, minPerMenu: 5, tier: 'classic' },
  ];
  const context = buildMenuContext({ mode: 'exact-price', price: 75 }, apiOk(menus));
  assert.ok(context.includes('source: planner-overrides'));
  for (const menu of menus) assert.ok(context.includes(`${menu.id} | ${menu.name} | ${menu.price} บาท/กล่อง`), menu.id);
  assert.equal(context.match(/บาท\/กล่อง/g).length, 4);
  // Every line names the level, never a dish-type category.
  assert.ok(!context.includes('category:'), 'no category may reach the model');
  assert.match(context, /ระดับ Signature/);
});

test('empty budget result carries no price to invent from', () => {
  const context = buildMenuContext({ mode: 'max-price', maxPrice: 60 }, apiOk([]));
  assert.ok(context.includes('result: empty'));
  assert.ok(!/\d+\s*บาท/.test(context), 'empty context must contain no price figure');
});

test('unknown name result never manufactures a price', () => {
  const context = buildMenuContext({ mode: 'name-lookup', query: 'เมนูสมมุติ' }, apiOk([]));
  assert.ok(context.includes('result: empty'));
  assert.ok(!/\d+\s*บาท/.test(context));
});

test('clarify mode asks for the name without any lookup', () => {
  const context = buildMenuContext({ mode: 'clarify' }, null);
  assert.ok(context.includes('need_menu_name'));
  assert.ok(!/\d+\s*บาท/.test(context));
});

test('none mode yields no context at all', () => {
  assert.equal(buildMenuContext({ mode: 'none' }, null), '');
});

test('API failure fails closed with zero price figures', () => {
  for (const bad of [{ ok: false }, null, { ok: true, menus: 'nope' }, { ok: true, menus: [{ id: '14' }] }]) {
    const context = buildMenuContext({ mode: 'exact-price', price: 75 }, bad);
    assert.ok(context.includes('lookup_failed'), JSON.stringify(bad));
    assert.ok(!/\d+\s*บาท/.test(context), 'failure context must contain no price figure');
  }
});

// §26 stale-price fallback elimination: the builder accepts no old-price
// input, so an API price of 80 can never come out as a remembered 75.
test('context authority is the API payload alone', () => {
  const context = buildMenuContext(
    { mode: 'exact-price', price: 80 },
    apiOk([{ id: '14', name: 'ข้าวไก่เทอริยากิ', price: 80, minPerMenu: 5, tier: 'classic' }]),
  );
  assert.ok(context.includes('ข้าวไก่เทอริยากิ | 80 บาท/กล่อง'));
  assert.ok(!context.includes('75 บาท'));
});
