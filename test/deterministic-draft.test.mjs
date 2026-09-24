import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { createMemoryAdapter } from '../db/memory.mjs';
import { createInternalApi } from '../server/internal-api.mjs';
import { presentDraft } from '../server/present.mjs';
import {
  DETERMINISTIC_DRAFT_MODES,
  MENU_DRAFT_DISPLAY_LIMIT,
  buildDeterministicMenuDraft,
} from '../line-ai/menu-intent.mjs';
import { buildDeterministicMenuDraftNodeCode } from '../line-ai/conversation-update.mjs';

function menu(id, name, price, minPerMenu = 5, category = 'ข้าวผัด') {
  return { id, name, price, minPerMenu, category };
}

function pairsIn(draft, menus) {
  const known = new Set(menus.map((m) => `${m.name}|${m.price}`));
  const found = [...draft.matchAll(/• (.+?) — (\d+(?:\.\d+)?) บาท\/กล่อง/g)].map((m) => `${m[1]}|${Number(m[2])}`);
  const single = draft.match(/^(.+?) ราคา (\d+(?:\.\d+)?) บาท\/กล่อง/u);
  if (single) found.push(`${single[1]}|${Number(single[2])}`);
  return { found, unknown: found.filter((pair) => !known.has(pair)) };
}

test('exact-price draft lists API menus only', () => {
  const menus = [
    menu('14', 'ข้าวไก่เทอริยากิ', 75, 5, 'ข้าวราดแกง'),
    menu('15', 'ข้าวคลุกกะปิ', 75, 5, 'ข้าวผัด'),
    menu('20', 'ข้าวหมกน่องไก่', 75, 10, 'อาหารอินเดีย'),
    menu('104', 'ข้าวผัดปลาทู', 75, 5, 'ข้าวผัด'),
  ];
  const draft = buildDeterministicMenuDraft({ mode: 'exact-price', price: 75 }, { ok: true, menus });
  assert.ok(draft.startsWith('สำหรับงบ 75 บาท/กล่อง มีเมนูดังนี้ค่ะ'));
  const { found, unknown } = pairsIn(draft, menus);
  assert.equal(found.length, 4);
  assert.deepEqual(unknown, []);
});

test('max-price draft caps display and notes the remainder', () => {
  const menus = Array.from({ length: 33 }, (_, i) => menu(String(i + 1), `เมนูที่ ${i + 1}`, 60 + (i % 41), 5));
  const draft = buildDeterministicMenuDraft({ mode: 'max-price', maxPrice: 100 }, { ok: true, menus });
  assert.ok(draft.startsWith('เมนูไม่เกิน 100 บาท/กล่อง มีดังนี้ค่ะ'));
  assert.equal(draft.match(/• /g).length, MENU_DRAFT_DISPLAY_LIMIT);
  assert.ok(draft.includes(`ยังมีอีก ${33 - MENU_DRAFT_DISPLAY_LIMIT} รายการค่ะ`));
  const { unknown } = pairsIn(draft, menus);
  assert.deepEqual(unknown, []);
});

test('category modes label the category in the header', () => {
  const menus = [menu('2', 'ข้าวผัดกะเพรา', 60)];
  const exact = buildDeterministicMenuDraft({ mode: 'category-price', price: 60, category: 'ข้าวผัด' }, { ok: true, menus });
  assert.ok(exact.startsWith('เมนูข้าวผัด งบ 60 บาท/กล่อง มีเมนูดังนี้ค่ะ'));
  const max = buildDeterministicMenuDraft({ mode: 'category-max', maxPrice: 70, category: 'ข้าวผัด' }, { ok: true, menus });
  assert.ok(max.startsWith('เมนูข้าวผัด ไม่เกิน 70 บาท/กล่อง มีเมนูดังนี้ค่ะ'));
});

test('name lookup answers a single menu with per-menu minimum', () => {
  const menus = [menu('14', 'ข้าวไก่เทอริยากิ', 75, 5, 'ข้าวราดแกง')];
  const draft = buildDeterministicMenuDraft({ mode: 'name-lookup', query: 'ข้าวไก่เทอริยากิ' }, { ok: true, menus });
  assert.ok(draft.includes('ข้าวไก่เทอริยากิ ราคา 75 บาท/กล่องค่ะ'));
  assert.ok(draft.includes('เมนูนี้ขั้นต่ำ 5 กล่องต่อเมนูค่ะ'));
  assert.ok(!draft.includes('สั่งขั้นต่ำ'), 'must not confuse per-menu minimum with overall minimum');
  assert.ok(!draft.includes('ขั้นต่ำ 10 กล่อง'), 'must never state the overall minimum as a menu fact');
});

test('clarify asks for the name with no lookup', () => {
  assert.equal(
    buildDeterministicMenuDraft({ mode: 'clarify' }, null),
    'ขอชื่อเมนูที่ต้องการเช็กราคาหน่อยค่ะ',
  );
});

test('empty and failure states never invent a price', () => {
  assert.equal(
    buildDeterministicMenuDraft({ mode: 'name-lookup', query: 'เมนูสมมุติ' }, { ok: true, menus: [] }),
    'ขออนุญาตเช็กราคาเมนูนี้กับทางทีมก่อนนะคะ',
  );
  assert.equal(
    buildDeterministicMenuDraft({ mode: 'max-price', maxPrice: 60 }, { ok: true, menus: [] }),
    'ตอนนี้ยังไม่พบเมนูในช่วงราคานี้จากรายการปัจจุบันค่ะ',
  );
  for (const bad of [{ ok: false }, null, { ok: true, menus: [{ id: '14' }] }]) {
    const draft = buildDeterministicMenuDraft({ mode: 'exact-price', price: 75 }, bad);
    assert.equal(draft, 'ขออนุญาตตรวจสอบรายการเมนูและราคากับทางทีมก่อนนะคะ');
    assert.ok(!/\d+\s*บาท/.test(draft), 'failure draft must contain no price figure');
  }
});

test('non-eligible modes yield no deterministic draft', () => {
  assert.equal(buildDeterministicMenuDraft({ mode: 'none' }, null), '');
});

test('deterministic drafts keep LINE-safe style', () => {
  const menus = [menu('14', 'ข้าวไก่เทอริยากิ', 75, 5, 'ข้าวราดแกง')];
  const drafts = [
    buildDeterministicMenuDraft({ mode: 'exact-price', price: 75 }, { ok: true, menus }),
    buildDeterministicMenuDraft({ mode: 'name-lookup', query: 'ข้าวไก่เทอริยากิ' }, { ok: true, menus }),
    buildDeterministicMenuDraft({ mode: 'clarify' }, null),
    buildDeterministicMenuDraft({ mode: 'max-price', maxPrice: 60 }, { ok: true, menus: [] }),
  ];
  for (const draft of drafts) {
    assert.ok(!draft.includes('**'), 'no Markdown markers');
    assert.ok(!/Internal API|planner|HTTP|timeout|MENU_CONTEXT/.test(draft), 'no technical wording');
    assert.ok(!draft.includes('มัดจำ') && !draft.includes('VAT') && !draft.includes('จัดส่ง'), 'no business-policy numbers');
  }
});

test('eligible modes cover the deterministic set', () => {
  assert.deepEqual([...DETERMINISTIC_DRAFT_MODES].sort(), ['category-max', 'category-price', 'clarify', 'exact-price', 'max-price', 'name-lookup'].sort());
});

// §10: Gemini 429 must not prevent deterministic menu drafts. This harness
// drives FAQ plan -> failed fetch (429-style) -> Build -> Eligible? ->
// deterministic Draft -> candidate Normalize Response -> Internal API
// persist with NO Gemini anywhere in the loop.
test('forced Gemini outage still yields WAITING_FOR_HUMAN menu drafts', async () => {
  const candidate = JSON.parse(await readFile(new URL('../line-ai/n8n-workflow-b25-persist-first.json', import.meta.url), 'utf8'));
  const byName = new Map(candidate.nodes.map((n) => [n.name, n]));
  const SECRET = randomUUID();
  const { server } = createInternalApi({ repos: createMemoryAdapter(), env: { EED_INTERNAL_API_SECRET: SECRET } });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  test.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;

  const cases = [
    {
      mode: 'exact-price',
      text: 'งบ 75 บาท มีเมนูอะไรบ้าง',
      fetchJson: { error: { message: 'HTTP 429 quota exceeded' } },
      expect: 'ขออนุญาตตรวจสอบรายการเมนูและราคากับทางทีมก่อนนะคะ',
    },
    {
      mode: 'max-price',
      text: 'มีเมนูไม่เกิน 100 บาทไหม',
      fetchJson: { error: { message: 'socket hang up' } },
      expect: 'ขออนุญาตตรวจสอบรายการเมนูและราคากับทางทีมก่อนนะคะ',
    },
    {
      mode: 'name-lookup',
      text: 'ข้าวไก่เทอริยากิ ราคาเท่าไร',
      fetchJson: { menus: [{ id: '14', name: 'ข้าวไก่เทอริยากิ', price: 75, minPerMenu: 5, category: 'ข้าวราดแกง' }] },
      expect: 'ข้าวไก่เทอริยากิ ราคา 75 บาท/กล่องค่ะ',
    },
    {
      mode: 'clarify',
      text: 'เมนูนี้ราคาเท่าไร',
      fetchJson: { menus: [] },
      expect: 'ขอชื่อเมนูที่ต้องการเช็กราคาหน่อยค่ะ',
    },
  ];
  for (const { mode, text, fetchJson, expect } of cases) {
    const webhookInput = { body: { events: [{ type: 'message', source: { userId: 'Utest' }, message: { id: 'm1', type: 'text', text } }] } };
    const [faqOut] = vm.runInNewContext(`(function () { ${byName.get('Deterministic FAQ').parameters.jsCode} })()`, {
      $input: { first: () => ({ json: webhookInput }) },
    });
    const faqJson = JSON.parse(JSON.stringify(faqOut.json));
    assert.equal(faqJson.menuPlan.mode, mode, text);
    const [drafted] = vm.runInNewContext(`(function () { ${byName.get('Build Deterministic Menu Draft').parameters.jsCode} })()`, {
      $input: { first: () => ({ json: { menuContext: 'CTX' } }) },
      $: (name) => {
        if (name === 'Deterministic FAQ') return { first: () => ({ json: faqJson }) };
        if (name === 'Build Menu Context') return { first: () => ({ json: { menuContext: 'CTX' } }) };
        if (name === 'Fetch Menu Catalog') return { first: () => ({ json: fetchJson }) };
        throw new Error('unexpected reference: ' + name);
      },
    });
    const item = drafted.json;
    assert.ok(item.draftResponse.includes(expect), text);
    assert.equal(item.draftSource, 'deterministic-menu', text);
    const [normalized] = vm.runInNewContext(`(function () { ${byName.get('Normalize Response').parameters.jsCode} })()`, {
      $input: { first: () => ({ json: item }) },
      $: () => ({ first: () => ({ json: {} }) }),
    });
    const payload = normalized.json;
    assert.equal(payload.source, 'deterministic-menu', text);
    assert.equal(payload.aiModel, null, text + ' must not claim a Gemini model');
    const customer = await (await fetch(`${base}/api/v1/customers/resolve`, {
      method: 'POST',
      headers: { authorization: `Bearer ${SECRET}`, 'content-type': 'application/json' },
      body: JSON.stringify({ lineUserId: 'Utest429' }),
    })).json();
    const persisted = await fetch(`${base}/api/v1/drafts`, {
      method: 'POST',
      headers: { authorization: `Bearer ${SECRET}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        customerId: customer.customer.id,
        incomingMessage: text,
        draftResponse: payload.draftResponse,
        source: payload.source,
        sourceEventId: 'evt-' + text.length + '-' + randomUUID(),
      }),
    });
    assert.ok([200, 201].includes(persisted.status), text);
    const draft = (await persisted.json()).draft;
    assert.equal(draft.status, 'WAITING_FOR_HUMAN', text);
    assert.ok(draft.draftResponse.includes(expect), text);
    assert.equal(draft.aiModel, '', text + ' persists the empty non-AI convention');
    assert.equal(presentDraft({ ...draft, customerId: customer.customer.id }).aiModel, '', text + ' presents no model claim');
  }
});
