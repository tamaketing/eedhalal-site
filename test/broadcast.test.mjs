// EED HALAL — weekly LINE broadcast test suite.
// Covers the owner-approved policy (AGENTS.md Sending Rules, 2026-10-26):
// the system may only BUILD one draft per ISO week from real business data
// (PENDING_REVIEW), and may only SEND rows the owner moved to SCHEDULED —
// with a frozen retry key, a hard retry budget, and golden Bangkok times.
// No test here ever touches the network: the provider takes an injectable
// fetchImpl and sendDueBroadcast an injectable send.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createFileAdapter } from '../db/file.mjs';
import { createMemoryAdapter } from '../db/memory.mjs';
import { createPostgresAdapter } from '../db/postgres.mjs';
import { createFakePg } from '../test-helpers/fake-pg.mjs';
import {
  MAX_SEND_RETRIES,
  approveBroadcast,
  broadcastDisplayText,
  broadcastQuotaSummary,
  discardBroadcast,
  editPendingBroadcast,
  ensureWeeklyBroadcast,
  listBroadcasts,
  postponeBroadcast,
  sendDueBroadcast,
  sendNowBroadcast,
} from '../services/broadcasts.mjs';
import {
  allowedBroadcastTransitionsFrom,
  catchUpWindowEndBangkok,
  isoWeekKeyBangkok,
  nextTuesday0900Bangkok,
} from '../services/broadcast-schema.mjs';
import {
  sendBroadcastMessages,
  validateBroadcastMessages,
} from '../services/lineBroadcast.mjs';
import { ValidationError } from '../services/errors.mjs';
import { presentBroadcast } from '../server/present.mjs';
import {
  BROADCAST_VARIANT_COUNTS,
  buildWeeklyBroadcastDraft,
  composeTierHighlightText,
  composeWeeklyFeaturedText,
} from '../tools/line/broadcast-drafts.mjs';

// Golden instants (see AGENTS.md): Mon 2026-10-26 12:00 Bangkok is ISO week
// 2026-W44; the approved slot for that week is Tue 2026-10-27 09:00 Bangkok;
// the same-day catch-up window closes at 21:00 Bangkok (14:00 UTC).
const MONDAY_NOON = new Date('2026-10-26T05:00:00.000Z');
const WEEK44_SLOT = '2026-10-27T02:00:00.000Z';
const WEEK44_AFTER_SLOT = new Date('2026-10-27T03:00:00.000Z');
const SITE = 'https://eedhalal.com';

// Customer-facing copy must never carry superlatives or system phrasing
// (AGENTS.md Human Sales Page Rules, banned phrases).
const BANNED_PHRASES = ['ดีที่สุด', 'อันดับ 1', 'อันดับหนึ่ง', 'ที่สุด', 'No.1', 'ราคาถูกที่สุด', 'เปิดขาย', 'ขั้นตอนถัดไป'];

function assertNoBannedPhrases(text, label) {
  for (const phrase of BANNED_PHRASES) {
    assert.ok(!String(text).includes(phrase), `${label} contains banned phrase "${phrase}"`);
  }
}

// Deterministic stub of the real draft builder: same shape as
// buildWeeklyBroadcastDraft, no catalogue read.
function stubBuilder(overrides = {}) {
  return async ({ weekKey }) => ({
    weekKey,
    theme: 'weeklyFeatured',
    menuId: 'menu-test-1',
    menuName: 'เมนูทดสอบร่าง',
    menuPrice: 55,
    imageUrl: `${SITE}/img/test-menu.jpg`,
    draftText: 'ร่างทดสอบสำหรับสัปดาห์นี้ ราคา 55 บาท/กล่อง สั่งขั้นต่ำ 10 กล่องครับ',
    metadata: {},
    ...overrides,
  });
}

function stubFetch(status, detail = '') {
  return async () => ({ status, text: async () => detail });
}

const RETRY_UUID = '11111111-1111-4111-8111-111111111111';

test('golden Bangkok scheduling times for the first broadcast week', () => {
  assert.equal(isoWeekKeyBangkok(MONDAY_NOON), '2026-W44');
  assert.equal(nextTuesday0900Bangkok(MONDAY_NOON).toISOString(), WEEK44_SLOT);
  assert.equal(
    catchUpWindowEndBangkok(WEEK44_SLOT).toISOString(),
    '2026-10-27T14:00:00.000Z', // 21:00 Bangkok of the scheduled day
  );
});

test('only owner and runner states may move a draft', () => {
  assert.deepEqual(allowedBroadcastTransitionsFrom('PENDING_REVIEW'), ['SCHEDULED', 'CANCELLED']);
  assert.ok(allowedBroadcastTransitionsFrom('SCHEDULED').includes('SENT'));
  assert.ok(allowedBroadcastTransitionsFrom('FAILED').includes('SCHEDULED')); // owner resend only
  assert.deepEqual(allowedBroadcastTransitionsFrom('SENT'), []); // history is final
  assert.deepEqual(allowedBroadcastTransitionsFrom('CANCELLED'), []);
});

test('the provider classifies LINE answers without guessing delivery', async () => {
  const base = { token: 'tok', retryKey: RETRY_UUID, messages: [{ type: 'text', text: 'สวัสดีครับ' }] };

  assert.deepEqual(
    await sendBroadcastMessages({ ...base, fetchImpl: stubFetch(200) }),
    { outcome: 'ACCEPTED', code: 'HTTP_200', httpStatus: 200 },
  );
  assert.deepEqual(
    await sendBroadcastMessages({ ...base, fetchImpl: stubFetch(409, 'already accepted') }),
    { outcome: 'ALREADY_ACCEPTED', code: 'HTTP_409_ACCEPTED', httpStatus: 409 },
  );
  // A 409 without the dedupe wording is NOT delivery — it fails closed.
  assert.equal((await sendBroadcastMessages({ ...base, fetchImpl: stubFetch(409, 'forbidden') })).outcome,
    'NON_RETRYABLE_FAILURE');
  assert.equal((await sendBroadcastMessages({ ...base, fetchImpl: stubFetch(429) })).outcome,
    'RETRYABLE_FAILURE');
  assert.equal((await sendBroadcastMessages({ ...base, fetchImpl: stubFetch(503) })).outcome,
    'RETRYABLE_FAILURE');
  assert.equal((await sendBroadcastMessages({ ...base, fetchImpl: stubFetch(400, 'bad request') })).outcome,
    'NON_RETRYABLE_FAILURE');
  assert.deepEqual(
    await sendBroadcastMessages({ ...base, fetchImpl: async () => { throw new Error('ECONNRESET'); } }),
    { outcome: 'RETRYABLE_FAILURE', code: 'NETWORK_ERROR' },
  );
  const timeout = new Error('aborted');
  timeout.name = 'TimeoutError';
  assert.equal(
    (await sendBroadcastMessages({ ...base, fetchImpl: async () => { throw timeout; } })).code,
    'TIMEOUT',
  );

  await assert.rejects(sendBroadcastMessages({ ...base, token: '' }), (error) => error.code === 'NOT_CONFIGURED');
  await assert.rejects(
    sendBroadcastMessages({ ...base, retryKey: 'not-a-uuid' }),
    ValidationError,
  );
});

test('the provider refuses malformed broadcast payloads', () => {
  assert.throws(() => validateBroadcastMessages([]), ValidationError);
  assert.throws(() => validateBroadcastMessages(Array.from({ length: 6 }, () => ({ type: 'text', text: 'x' }))),
    ValidationError);
  assert.throws(() => validateBroadcastMessages([{ type: 'text', text: 'x'.repeat(5001) }]), ValidationError);
  assert.throws(() => validateBroadcastMessages([{ type: 'text', text: '   ' }]), ValidationError);
  assert.throws(() => validateBroadcastMessages([{
    type: 'image',
    originalContentUrl: 'http://eedhalal.com/img/x.jpg',
    previewImageUrl: 'http://eedhalal.com/img/x.jpg',
  }]), ValidationError);
  assert.throws(() => validateBroadcastMessages([{ type: 'sticker', stickerId: '1' }]), ValidationError);
  // The real shape the runner sends: image first, then text — accepted.
  validateBroadcastMessages([
    { type: 'image', originalContentUrl: `${SITE}/img/x.jpg`, previewImageUrl: `${SITE}/img/x.jpg` },
    { type: 'text', text: 'ร่างจริงพร้อมส่ง' },
  ]);
});

test('the weekly draft is built from the real catalogue and is deterministic', async () => {
  const first = await buildWeeklyBroadcastDraft({ now: MONDAY_NOON, siteBaseUrl: SITE });
  const second = await buildWeeklyBroadcastDraft({ now: MONDAY_NOON, siteBaseUrl: SITE });
  assert.deepEqual(first, second);

  // Golden week: even ISO week rotates to the featured-dish theme.
  assert.equal(first.weekKey, '2026-W44');
  assert.equal(first.theme, 'weeklyFeatured');
  assert.ok(String(first.menuName || '').trim(), 'draft must name a real menu');
  assert.ok(Number.isFinite(first.menuPrice) && first.menuPrice > 0, 'price must come from the catalogue');
  assert.ok(first.imageUrl.startsWith(`${SITE}/`), 'draft carries a real site image');
  assert.ok(first.draftText.includes(first.menuName), 'text repeats the real menu name');
  assert.ok(first.draftText.includes(`${SITE}/popular-menu.html`), 'text links the menu page');
  assert.ok(first.draftText.length <= 5000, 'text stays inside the LINE limit');
  assertNoBannedPhrases(first.draftText, 'W44 draft');

  // Odd week rotates to the tier theme from the same real catalogue.
  const oddWeek = await buildWeeklyBroadcastDraft({
    now: new Date('2026-11-02T05:00:00.000Z'), // Mon 2026-11-02 = 2026-W45
    siteBaseUrl: SITE,
  });
  assert.equal(oddWeek.weekKey, '2026-W45');
  assert.equal(oddWeek.theme, 'tierHighlight');
  assert.ok(oddWeek.draftText.trim(), 'tier draft has text');
  assert.ok(oddWeek.draftText.length <= 5000);
  assertNoBannedPhrases(oddWeek.draftText, 'W45 draft');
});

// ---- broadcast copy variants (shop's content agent, 2026-10-26) ----

const VARIANT_RULES = {
  services: {
    mealBox: {
      minimumOrder: 10,
      leadTimeDays: 1,
      halalMaterial: 'วัตถุดิบฮาลาล 100%',
      fulfillment: 'จัดส่งถึงหน้างานตรงเวลา',
      tiers: [
        {
          id: 'classic',
          nameTh: 'Classic Halal Meal Box — ข้าวกล่องฮาลาลระดับคลาสสิก',
          sellingPointTh: 'คุมงบง่าย ทานง่าย คนเยอะก็รับไหว',
          bestForTh: 'ประชุม อบรม สัมมนา และอาหารพนักงานประจำบริษัท',
        },
        {
          id: 'signature',
          nameTh: 'Signature Halal Meal Box — ข้าวกล่องฮาลาลระดับซิกเนเจอร์',
          sellingPointTh: 'แขกเลือกได้สองอย่างในกล่องเดียว คุณไม่ต้องเดาเมนูว่าแขกจะชอบอะไร',
          bestForTh: 'งานรับรองลูกค้า เปิดตัวสินค้า และงานเลี้ยงผู้บริหาร',
        },
      ],
    },
  },
};
const VARIANT_MENU = { id: 'm1', name: 'ผัดพริกแกงกุ้ง ไข่เจียว', price: 150, tier: 'classic', image: 'img/showcase.jpg' };
const VARIANT_TIER = VARIANT_RULES.services.mealBox.tiers[1];
const VARIANT_RULE_LINE = 'สั่งตั้งแต่ 10 กล่องขึ้นไป · จองล่วงหน้า 1 วันทำการ · วัตถุดิบฮาลาล 100% · จัดส่งถึงหน้างานตรงเวลา';

test('the two original broadcast layouts survive the rotation change byte-for-byte', () => {
  const featuredArgs = { menu: VARIANT_MENU, rules: VARIANT_RULES, siteBaseUrl: SITE };

  assert.equal(composeWeeklyFeaturedText({ ...featuredArgs, variant: 0 }), [
    'เมนูของสัปดาห์นี้: ผัดพริกแกงกุ้ง ไข่เจียว',
    'ราคา 150 บาท/กล่อง',
    '',
    `ถ้าวันนี้ที่คุณกำลังหาข้าวกล่องฮาลาลส่งถึงหน้างาน เมนูนี้พร้อมจัดให้แบบไม่ต้องรอ\n${VARIANT_RULE_LINE}`,
    '',
    `ดูเมนูทั้งหมด: ${SITE}/popular-menu.html`,
    'สนใจเมนูนี้ ทักมาบอกจำนวนกล่องและวันที่ใช้งานมาได้เลยครับ ทีมจะส่งรายละเอียดและราคารวมให้ก่อนเสมอ',
  ].join('\n'));

  assert.equal(composeWeeklyFeaturedText({ ...featuredArgs, variant: 1 }), [
    'ขนาดเมนู ผัดพริกแกงกุ้ง ไข่เจียว อยู่ประจำกล่องฮาลาลของเรา — สัปดาห์นี้ขอชี้ให้ดูไว้ก่อนใคร',
    'ราคา 150 บาท/กล่อง',
    '',
    'บริการของเราจัดให้ได้จริง: สั่งขั้นต่ำ 10 กล่องขึ้นไป และส่งถึงหน้างานตรงเวลา',
    '',
    'ถ้าประชุม อบรม หรืองานรับรอง และไม่แน่ใจว่าเมนูอะไรได้ใจ บอกจำนวนคนและงบมาได้เลยครับ ทีมจะเสนอให้ก่อนบันทึกออเดอร์',
    '',
    `ดูรายการอาหารทั้งหมด: ${SITE}/popular-menu.html`,
  ].join('\n'));

  assert.equal(composeTierHighlightText({
    tierMeta: VARIANT_TIER,
    fromPrice: 98,
    menu: VARIANT_MENU,
    rules: VARIANT_RULES,
    siteBaseUrl: SITE,
    variant: 0,
  }), [
    `${VARIANT_TIER.nameTh} — อย่างเมนู ${VARIANT_MENU.name} อยู่ในระดับนี้`,
    'เริ่มต้น 98 บาท/กล่อง',
    '',
    `${VARIANT_TIER.sellingPointTh}\nเหมาะกับ: ${VARIANT_TIER.bestForTh}\n${VARIANT_RULE_LINE}`,
    '',
    'ถ้ารู้แล้วว่างานของคุณมีขนาดแค่ไหน ทักมาบอกจำนวนคนและวันที่ใช้งานมาได้เลยครับ ทีมจะส่งเมนูและราคารวมให้ก่อนเสมอ',
    '',
    `ดูรายการอาหารทั้งหมด: ${SITE}/popular-menu.html`,
  ].join('\n'));

  assert.equal(composeTierHighlightText({
    tierMeta: VARIANT_TIER,
    fromPrice: null,
    menu: VARIANT_MENU,
    rules: VARIANT_RULES,
    siteBaseUrl: SITE,
    variant: 0,
  }).includes('ราคาบอกผ่านแชทได้ทันทีครับ'), true, 'tier without a real starting price never invents one');
});

test('every broadcast copy variant stays inside the sales rules', () => {
  for (let variant = 0; variant < BROADCAST_VARIANT_COUNTS.weeklyFeatured; variant += 1) {
    const text = composeWeeklyFeaturedText({ menu: VARIANT_MENU, rules: VARIANT_RULES, siteBaseUrl: SITE, variant });
    assert.ok(text.includes(VARIANT_MENU.name), `featured variant ${variant} names the real menu`);
    assert.ok(text.includes('ราคา 150 บาท/กล่อง'), `featured variant ${variant} quotes the real catalogue price`);
    assert.ok(text.includes(`${SITE}/popular-menu.html`), `featured variant ${variant} links the menu page`);
    assert.ok(text.length > 0 && text.length <= 5000, `featured variant ${variant} stays inside the LINE limit`);
    assertNoBannedPhrases(text, `featured variant ${variant}`);
  }

  for (let variant = 0; variant < BROADCAST_VARIANT_COUNTS.tierHighlight; variant += 1) {
    const text = composeTierHighlightText({
      tierMeta: VARIANT_TIER,
      fromPrice: 98,
      menu: VARIANT_MENU,
      rules: VARIANT_RULES,
      siteBaseUrl: SITE,
      variant,
    });
    assert.ok(text.includes(VARIANT_TIER.nameTh), `tier variant ${variant} names the real tier`);
    assert.ok(text.includes('เริ่มต้น 98 บาท/กล่อง'), `tier variant ${variant} quotes the real starting price`);
    assert.ok(text.includes(VARIANT_MENU.name), `tier variant ${variant} shows a real menu from the tier`);
    assert.ok(text.includes(`${SITE}/popular-menu.html`), `tier variant ${variant} links the menu page`);
    assert.ok(text.length > 0 && text.length <= 5000, `tier variant ${variant} stays inside the LINE limit`);
    assertNoBannedPhrases(text, `tier variant ${variant}`);
  }
});

test('the next rotation lands on new agent-drafted variants and stays reproducible', async () => {
  const W46 = new Date('2026-11-09T05:00:00.000Z'); // Mon 2026-11-09 = 2026-W46
  const first = await buildWeeklyBroadcastDraft({ now: W46, siteBaseUrl: SITE });
  const second = await buildWeeklyBroadcastDraft({ now: W46, siteBaseUrl: SITE });
  assert.deepEqual(first, second, 'same week yields the same draft');
  assert.equal(first.weekKey, '2026-W46');
  assert.equal(first.theme, 'weeklyFeatured');
  // W46 sits on fortnight 22 → 22 % 8 = variant 6 — a fresh agent layout,
  // opening below the menu/price block that the machines fill in.
  assert.ok(first.draftText.startsWith('ผู้จัดการไม่มีเวลาเลือกข้าวเที่ยงให้ทีม?'),
    'W46 rotates past the two original layouts');
  assert.ok(first.draftText.includes(first.menuName), 'text repeats the real menu name');
  assert.ok(first.draftText.includes(`${SITE}/popular-menu.html`), 'text links the menu page');
  assertNoBannedPhrases(first.draftText, 'W46 draft');
});

test('the weekly draft lands as PENDING_REVIEW and never twice for one week', async () => {
  const repos = createMemoryAdapter();
  const first = await ensureWeeklyBroadcast(repos, stubBuilder(), { now: MONDAY_NOON });
  assert.equal(first.deduped, false);
  assert.equal(first.broadcast.status, 'PENDING_REVIEW');
  assert.equal(first.broadcast.weekKey, '2026-W44');
  assert.equal(first.broadcast.createdBy, 'SYSTEM');
  assert.equal(first.broadcast.scheduledAt, null, 'a draft must not carry a send slot by itself');

  const second = await ensureWeeklyBroadcast(repos, stubBuilder(), { now: MONDAY_NOON });
  assert.equal(second.deduped, true);
  assert.equal(second.broadcast.id, first.broadcast.id);

  const rows = await listBroadcasts(repos, { limit: 10 });
  assert.equal(rows.length, 1, 'one ISO week keeps exactly one draft');
});

test('owner approval schedules the slot and freezes a send attempt', async () => {
  const repos = createMemoryAdapter();
  const { broadcast } = await ensureWeeklyBroadcast(repos, stubBuilder(), { now: MONDAY_NOON });

  const approved = await approveBroadcast(repos, broadcast.id, {
    scheduledAt: WEEK44_SLOT,
    ownerId: 'owner-1',
  });
  assert.equal(approved.status, 'SCHEDULED');
  assert.equal(approved.scheduledAt, WEEK44_SLOT);
  assert.ok(approved.approvedAt, 'approval is timestamped');
  assert.ok(approved.sendAttempt && typeof approved.sendAttempt.key === 'string',
    'approval freezes the retry key');

  // Approving twice is refused — re-approval goes through resend paths.
  await assert.rejects(
    approveBroadcast(repos, broadcast.id, { scheduledAt: WEEK44_SLOT, ownerId: 'owner-1' }),
    /only PENDING_REVIEW can be approved/,
  );
});

test('owner postpone and send-now only move the slot', async () => {
  const repos = createMemoryAdapter();
  const { broadcast } = await ensureWeeklyBroadcast(repos, stubBuilder(), { now: MONDAY_NOON });
  await approveBroadcast(repos, broadcast.id, {
    scheduledAt: '2027-01-05T02:00:00.000Z',
    ownerId: 'owner-1',
  });

  // Postpone without an explicit slot falls back to the next Tuesday slot.
  const expected = nextTuesday0900Bangkok().toISOString();
  const moved = await postponeBroadcast(repos, broadcast.id, { ownerId: 'owner-1' });
  assert.equal(moved.scheduledAt, expected);
  assert.equal(moved.status, 'SCHEDULED');
  assert.equal(moved.draftText, broadcast.draftText, 'rescheduling never touches the text');

  // Send-now = due slot at this instant; the runner delivers on its next pass.
  const before = Date.now();
  const due = await sendNowBroadcast(repos, broadcast.id, { ownerId: 'owner-1' });
  const at = Date.parse(due.scheduledAt);
  assert.ok(at >= before - 1000 && at <= Date.now() + 1000, 'send-now schedules now, not a fake SENT');
  assert.equal(due.status, 'SCHEDULED');
});

test('owner edit fills finalText and discard closes a draft for good', async () => {
  const repos = createMemoryAdapter();
  const { broadcast } = await ensureWeeklyBroadcast(repos, stubBuilder(), { now: MONDAY_NOON });

  const edited = await editPendingBroadcast(repos, broadcast.id, {
    finalText: 'ข้อความที่เจ้าของแก้ด้วยมือเองครับ',
    ownerId: 'owner-1',
  });
  assert.equal(edited.status, 'PENDING_REVIEW', 'editing does not approve anything');
  assert.equal(edited.draftText, broadcast.draftText, 'the system draft stays untouched');
  assert.equal(broadcastDisplayText(edited), 'ข้อความที่เจ้าของแก้ด้วยมือเองครับ');
  await assert.rejects(async () => editPendingBroadcast(repos, broadcast.id, { finalText: '   ', ownerId: 'owner-1' }),
    /owner finalText/);

  const cancelled = await discardBroadcast(repos, broadcast.id, { ownerId: 'owner-1' });
  assert.equal(cancelled.status, 'CANCELLED');
  await assert.rejects(discardBroadcast(repos, broadcast.id, { ownerId: 'owner-1' }),
    /illegal broadcast transition/);
});

test('the runner sends only approved due rows and records the outcome', async () => {
  const repos = createMemoryAdapter();
  const { broadcast: pending } = await ensureWeeklyBroadcast(repos, stubBuilder(), { now: MONDAY_NOON });
  const { broadcast: ready } = await ensureWeeklyBroadcast(repos, stubBuilder(), {
    now: new Date('2026-11-09T05:00:00.000Z'),
  });
  await approveBroadcast(repos, ready.id, { scheduledAt: WEEK44_SLOT, ownerId: 'owner-1' });

  const calls = [];
  const send = async ({ token, messages, retryKey }) => {
    calls.push({ token, messages, retryKey });
    return { outcome: 'ACCEPTED', code: 'HTTP_200', httpStatus: 200 };
  };

  // PENDING_REVIEW can never reach the network, not even with a due clock.
  await assert.rejects(
    sendDueBroadcast(repos, pending.id, { now: WEEK44_AFTER_SLOT, send, token: 'tok' }),
    /runner send is not configured|runner send is not allowed/,
  );
  // An approved row whose slot has not arrived is refused too.
  await assert.rejects(
    sendDueBroadcast(repos, ready.id, { now: MONDAY_NOON, send, token: 'tok' }),
    /not due/,
  );
  assert.equal(calls.length, 0, 'refusals never call the provider');

  const result = await sendDueBroadcast(repos, ready.id, { now: WEEK44_AFTER_SLOT, send, token: 'tok' });
  assert.equal(result.broadcast.status, 'SENT');
  assert.ok(result.broadcast.sentAt);
  assert.equal(result.send.outcome, 'ACCEPTED');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].messages[0].type, 'image');
  assert.equal(calls[0].messages[0].originalContentUrl, ready.imageUrl);
  assert.equal(calls[0].messages[1].text, broadcastDisplayText(ready));

  // A SENT row is history: the runner may not send it again.
  await assert.rejects(
    sendDueBroadcast(repos, ready.id, { now: WEEK44_AFTER_SLOT, send, token: 'tok' }),
    /runner send is not allowed/,
  );
  // No token means no send — fail loudly before any phase.
  const { broadcast: third } = await ensureWeeklyBroadcast(repos, stubBuilder(), {
    now: new Date('2026-11-16T05:00:00.000Z'),
  });
  await approveBroadcast(repos, third.id, { scheduledAt: WEEK44_SLOT, ownerId: 'owner-1' });
  await assert.rejects(
    sendDueBroadcast(repos, third.id, { now: WEEK44_AFTER_SLOT, send }),
    /not configured/,
  );
});

test('retry budget closes loudly after three unknown outcomes', async () => {
  const repos = createMemoryAdapter();
  const { broadcast } = await ensureWeeklyBroadcast(repos, stubBuilder(), { now: MONDAY_NOON });
  await approveBroadcast(repos, broadcast.id, { scheduledAt: WEEK44_SLOT, ownerId: 'owner-1' });

  const keys = [];
  const send = async ({ retryKey }) => {
    keys.push(retryKey);
    return { outcome: 'RETRYABLE_FAILURE', code: 'HTTP_503', httpStatus: 503 };
  };

  for (let attempt = 1; attempt <= MAX_SEND_RETRIES; attempt += 1) {
    const out = await sendDueBroadcast(repos, broadcast.id, { now: WEEK44_AFTER_SLOT, send, token: 'tok' });
    assert.equal(out.broadcast.status, 'SCHEDULED', `attempt ${attempt} stays scheduled`);
    assert.equal(out.broadcast.retryCount, attempt);
    assert.equal(out.send.outcome, 'RETRYABLE_FAILURE');
  }
  assert.equal(new Set(keys).size, 1, 'every retry replays the SAME frozen key');
  assert.equal(keys.length, MAX_SEND_RETRIES);

  // Budget spent: phase 1 closes the row WITHOUT another network call.
  const closed = await sendDueBroadcast(repos, broadcast.id, { now: WEEK44_AFTER_SLOT, send, token: 'tok' });
  assert.equal(closed.broadcast.status, 'FAILED');
  assert.equal(closed.broadcast.errorCode, 'RETRY_EXHAUSTED');
  assert.equal(closed.send, null);
  assert.equal(keys.length, MAX_SEND_RETRIES, 'the closing pass makes no provider call');

  // The owner can still resend from FAILED (back to SCHEDULED only via owner).
  const resent = await postponeBroadcast(repos, broadcast.id, { scheduledAt: WEEK44_SLOT, ownerId: 'owner-1' });
  assert.equal(resent.status, 'SCHEDULED');
  assert.equal(resent.errorCode, null, 'a resend clears the failure code');
});

test('quota summary reports real math and keeps NOT_CONFIGURED honest', async () => {
  const limited = await broadcastQuotaSummary({
    quota: async () => ({ ok: true, type: 'limited', limit: 200 }),
    consumption: async () => ({ ok: true, total: 50 }),
  });
  assert.deepEqual(limited, { ok: true, type: 'limited', limit: 200, used: 50, remaining: 150 });

  const unlimited = await broadcastQuotaSummary({
    quota: async () => ({ ok: true, type: 'unlimited' }),
    consumption: async () => ({ ok: true, total: 12 }),
  });
  assert.equal(unlimited.ok, true);
  assert.equal(unlimited.type, 'unlimited');
  assert.equal(unlimited.used, 12);
  assert.equal(unlimited.limit, null);

  const missing = await broadcastQuotaSummary({
    quota: async () => ({ ok: false, code: 'NOT_CONFIGURED' }),
    consumption: async () => ({ ok: false, code: 'NOT_CONFIGURED' }),
  });
  assert.deepEqual(missing, { ok: false, code: 'NOT_CONFIGURED' });
});

test('all three adapters keep the same weekly-draft invariants', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'eed-broadcast-'));
  const adapters = [
    ['memory', createMemoryAdapter()],
    ['file', createFileAdapter(dir)],
    ['postgres-fake', createPostgresAdapter({ query: createFakePg().query })],
  ];
  try {
    for (const [name, repos] of adapters) {
      const first = await ensureWeeklyBroadcast(repos, stubBuilder(), { now: MONDAY_NOON });
      assert.equal(first.broadcast.status, 'PENDING_REVIEW', `${name}: draft status`);
      assert.equal(first.broadcast.weekKey, '2026-W44', `${name}: week key`);

      const dup = await ensureWeeklyBroadcast(repos, stubBuilder(), { now: MONDAY_NOON });
      assert.equal(dup.deduped, true, `${name}: second call reuses the winner`);
      assert.equal(dup.broadcast.id, first.broadcast.id, `${name}: same row id`);

      const approved = await approveBroadcast(repos, first.broadcast.id, {
        scheduledAt: WEEK44_SLOT,
        ownerId: 'owner-1',
      });
      assert.equal(approved.status, 'SCHEDULED', `${name}: approve persists`);

      const rows = await listBroadcasts(repos, { status: 'SCHEDULED', limit: 10 });
      assert.equal(rows.length, 1, `${name}: status filter`);
      const present = presentBroadcast(rows[0]);
      assert.ok(!('sendAttempt' in present), `${name}: frozen key never leaves the server`);
      assert.equal(present.status, 'SCHEDULED', `${name}: presented status`);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
