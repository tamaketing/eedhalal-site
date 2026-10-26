// EED HALAL — weekly broadcast draft builder (real data only).
//
// Composes ONE broadcast draft per ISO week from authoritative sources:
//   - the meal-box catalogue (data/planner-overrides.json via
//     services/menus.mjs) for menu names and prices, and
//   - data/business-rules.json for shop facts (minimum order, lead time,
//     halal material, fulfilment, tier selling points).
// Nothing else may be invented: no prices, no discounts, no "ดีที่สุด /
// อันดับหนึ่ง" claims. The owner still approves every draft before anything
// is sent; this module only makes the review easy.
//
// Determinism: the theme, the featured menus/tier and one of the shop's
// pre-approved copy variants rotate by ISO week number (Asia/Bangkok), so
// the same week always yields the same draft — tests and rebuilds are
// reproducible. Variant layouts 0-1 per theme are the originals; 2+ were
// drafted by the shop's content agent (AI copywriter, 2026-10-26) under
// the Human Sales Page Rules. Nothing is invented at send time: prices and
// facts are injected from the catalogue and business rules during build.

import { getMealboxMenuCatalog } from '../../services/menus.mjs';
import { loadBusinessRules } from '../../services/quotations.mjs';
import { isoWeekKeyBangkok, isoWeekNumber } from '../../services/broadcast-schema.mjs';

export const DEFAULT_SITE_BASE_URL = 'https://eedhalal.com';
// Public menu page that exists today on the published site (see DEPLOY.md).
export const MENU_PAGE_PATH = 'popular-menu.html';

export const BROADCAST_THEMES = Object.freeze(['weeklyFeatured', 'tierHighlight']);
export const TIER_ROTATION = Object.freeze(['classic', 'signature', 'executive']);

export function broadcastSiteBaseUrl(env = process.env) {
  const value = String(env.EED_BROADCAST_SITE_URL || '').trim();
  if (value && /^https:\/\//.test(value)) return value.replace(/\/+$/, '');
  if (value && !/^https:\/\//.test(value)) throw new Error('EED_BROADCAST_SITE_URL must start with https://');
  return DEFAULT_SITE_BASE_URL;
}

function formatPrice(value) {
  const price = Number(value);
  if (!Number.isFinite(price) || price <= 0) return null;
  if (Number.isInteger(price)) return String(price);
  return price.toFixed(2).replace(/\.00$/, '');
}

function absoluteImageUrl(menu, siteBaseUrl) {
  const image = String(menu?.image || '').trim();
  if (!image) return null;
  if (/^https:\/\//i.test(image)) return image;
  if (!/^[A-Za-z0-9._/-]+$/.test(image)) return null; // catalogue paths only
  return `${siteBaseUrl}/${image.replace(/^\/+/, '')}`;
}

// Deterministic pick. The catalogue is the price authority; keep selection
// stable by numeric id so the same week always recommends the same dish.
function pickRotating(entries, weekNumber) {
  if (!entries.length) return null;
  const sorted = [...entries].sort((a, b) => Number(a.id) - Number(b.id));
  return sorted[(weekNumber - 1 + sorted.length) % sorted.length] ?? null;
}

function mealBoxRuleLines(rules) {
  const mealBox = rules?.services?.mealBox || {};
  const minimum = Number(mealBox.minimumOrder);
  const leadTime = Number(mealBox.leadTimeDays);
  const lines = [];
  if (Number.isFinite(minimum) && minimum > 0) lines.push(`สั่งตั้งแต่ ${minimum} กล่องขึ้นไป`);
  if (Number.isFinite(leadTime) && leadTime > 0) {
    lines.push(`จองล่วงหน้า ${leadTime} วันทำการ`);
  }
  if (typeof mealBox.halalMaterial === 'string' && mealBox.halalMaterial.trim()) {
    lines.push(mealBox.halalMaterial.trim());
  }
  if (typeof mealBox.fulfillment === 'string' && mealBox.fulfillment.trim()) {
    lines.push(mealBox.fulfillment.trim());
  }
  return lines;
}

function menuLink(siteBaseUrl) {
  return `${siteBaseUrl}/${MENU_PAGE_PATH}`;
}

// ---- Theme 1: เมนูนำหน้า — เมนูเดียวที่ระบบชี้ให้เป็นของสัปดาห์นี้ ----
// รูปแบบหมุน (variants): index 0-1 = รูปแบบเดิมที่ติดตั้งแต่ต้น, index 2+ =
// ร่างเพิ่มโดยแผนกเนื้อหาของร้าน (AI copywriter, 2026-10-26) ที่ผ่านกติกา
// Human Sales Page Rules ก่อนบรรจุ ทุกตัวเลข/ลิงก์ไม่ได้พิมพ์ในข้อความ —
// ระบบอ่านจากแคตตาล็อกจริงและกฎร้านเสมอ (ไม่มีราคาที่แต่งขึ้นในไฟล์นี้)
export function composeWeeklyFeaturedText({ menu, rules, siteBaseUrl, variant = 0 }) {
  const ctx = prepareFeatured({ menu, rules, siteBaseUrl });
  return variantAt(WEEKLY_FEATURED_VARIANTS, variant)(ctx);
}

function prepareFeatured({ menu, rules, siteBaseUrl }) {
  const price = formatPrice(menu.price);
  return {
    menu,
    price,
    priceLine: price ? `ราคา ${price} บาท/กล่อง` : 'ราคาบอกผ่านแชทได้ทันทีครับ',
    ruleLine: mealBoxRuleLines(rules).join(' · ') || null,
    link: menuLink(siteBaseUrl),
    rules,
  };
}

// เส้นโครงข้อความ LINE: คั่นพารากราฟด้วยบรรทัดว่าง ('' = บรรทัดว่างจริง)
// และตัดแถวที่เทมเพลตเลือกไม่ใช้ออก (null/undefined เมื่อไม่มีกฎให้อ้าง)
function l(...rows) {
  return rows.filter((row) => typeof row === 'string').join('\n');
}

const WEEKLY_FEATURED_VARIANTS = Object.freeze([
  // 0 — รูปแบบเดิม (ประชุม/อบรม/งานบริษัท): เหมาะกับงานบริษัทที่ต้องแยกกับข้าวเป็นสัดส่วน และเสิร์ฟให้ลูกค้าได้ดูดี
  ({ menu, price, ruleLine, link }) => l(
    `เมนูของสัปดาห์นี้: ${menu.name}`,
    price ? `ราคา ${price} บาท/กล่อง` : 'ขอดูราคาเมนูนี้ได้ทางแชทครับ',
    '',
    `ถ้าวันนี้ที่คุณกำลังหาข้าวกล่องฮาลาลส่งถึงหน้างาน เมนูนี้พร้อมจัดให้แบบไม่ต้องรอ${ruleLine ? `\n${ruleLine}` : ''}`,
    '',
    'ดูเมนูทั้งหมด: ' + link,
    'สนใจเมนูนี้ ทักมาบอกจำนวนกล่องและวันที่ใช้งานมาได้เลยครับ ทีมจะส่งรายละเอียดและราคารวมให้ก่อนเสมอ',
  ),
  // 1 — รูปแบบเดิม (จับสายตาแขก/ผู้บริหาร): เหมาะทำให้กล่องดูดีขึ้น อ่านง่ายก่อนเปิดงาน
  ({ menu, priceLine, link, rules }) => l(
    `ขนาดเมนู ${menu.name} อยู่ประจำกล่องฮาลาลของเรา — สัปดาห์นี้ขอชี้ให้ดูไว้ก่อนใคร`,
    priceLine,
    '',
    `บริการของเราจัดให้ได้จริง: สั่งขั้นต่ำ ${Number(rules?.services?.mealBox?.minimumOrder) || 'ตามเสียงตอบกลับจากทีม'} กล่องขึ้นไป และส่งถึงหน้างานตรงเวลา`,
    '',
    'ถ้าประชุม อบรม หรืองานรับรอง และไม่แน่ใจว่าเมนูอะไรได้ใจ บอกจำนวนคนและงบมาได้เลยครับ ทีมจะเสนอให้ก่อนบันทึกออเดอร์',
    '',
    'ดูรายการอาหารทั้งหมด: ' + link,
  ),
  // 2 — ประชุมประจำสัปดาห์ (เงียบแต่ตรง): ตอนเที่ยวทีมไม่แยกย้าย ต่องานได้ทันที
  ({ menu, priceLine, ruleLine, link }) => l(
    'ถ้าคุณมีประชุมประจำสัปดาห์และต้องหาข้าวเที่ยงให้ทีมทุกสัปดาห์ สัปดาห์นี้ขอแนะนำเมนูดังนี้ครับ',
    `${menu.name} ${priceLine}`,
    `เหมาะกับมื้อประชุมที่ต้องการความเรียบร้อย ข้าวกับกับข้าวแยกส่วน เสิร์ฟดูดีและทานง่ายระหว่างประชุม${ruleLine ? `\n${ruleLine}` : ''}`,
    '',
    'บอกจำนวนคน งบประมาณ และวันใช้งานมาได้เลยครับ ทีมจะจัดตัวเลือกให้เหมาะกับงานของคุณ',
    '',
    'ดูเมนูเพิ่มเติมที่ ' + link,
  ),
  // 3 — อบรมสองวัน: มื้อต่อเนื่องไม่น่าเบื่อ ทีมคงสมาธิได้ตลอดคอร์ส
  ({ menu, priceLine, ruleLine, link }) => l(
    'อบรมสองวันอยากได้ข้าวกล่องที่อร่อยต่อเนื่องไม่น่าเบื่อ เราจัดมื้อเที่ยงให้ทีมทุกวันได้ครับ',
    `${menu.name} ${priceLine}`,
    `เหมาะเป็นมื้อเที่ยงของวันอบรมที่ทีมต้องคงสมาธิต่อเนื่อง${ruleLine ? `\n${ruleLine}` : ''}`,
    '',
    'แจ้งจำนวนคน วันอบรม และงบประมาณมาได้เลยครับ ทีมจะเตรียมเมนูให้เหมาะกับอบรมของคุณ',
    '',
    'ดูเมนูเพิ่มเติมที่ ' + link,
  ),
  // 4 — งานรับรองแขกผู้ใหญ่: กล่องข้าวคือหน้าพร้อมของงาน
  ({ menu, priceLine, ruleLine, link }) => l(
    'งานรับรองลูกค้าหรือวันที่มีแขกผู้ใหญ่มาเยี่ยมบริษัท กล่องข้าวก็คือหน้าพร้อมที่ทำให้ประทับใจตั้งแต่แรกพบครับ',
    `${menu.name} ${priceLine}`,
    `จัดวางเรียบร้อย เหมาะเสิร์ฟให้แขกในงานรับรอง${ruleLine ? `\n${ruleLine}` : ''}`,
    '',
    'บอกรายละเอียดงานและจำนวนแขกมาได้เลยครับ ทีมจะเสนอเมนูที่เหมาะกับงานรับรองของคุณ',
    '',
    'ดูเมนูเพิ่มเติมที่ ' + link,
  ),
  // 5 — เลี้ยงทีมหลังโปรเจกต์จบ: ขอบคุณทีมด้วยมื้อฉลอง
  ({ menu, priceLine, ruleLine, link }) => l(
    'โปรเจกต์จบแล้ว อยากเลี้ยงทีมให้เต็มที่และขอบคุณทุกคนที่ร่วมผ่านงานหนักมาด้วยกัน เราเตรียมข้าวให้พร้อมครับ',
    `${menu.name} ${priceLine}`,
    `เหมาะกับมื้อฉลองทีมงานหลังส่งงานเสร็จ${ruleLine ? `\n${ruleLine}` : ''}`,
    '',
    'แจ้งจำนวนทีมและวันจัดงานมาได้เลยครับ ทีมจะจัดเตรียมข้าวกล่องส่งตรงถึงหน้างาน',
    '',
    'ดูเมนูเพิ่มเติมที่ ' + link,
  ),
  // 6 — ผู้จัดการที่ไม่มีเวลาเลือกข้าวเที่ยงให้ทีม
  ({ menu, priceLine, ruleLine, link }) => l(
    'ผู้จัดการไม่มีเวลาเลือกข้าวเที่ยงให้ทีม? ฝากมื้อกลางวันไว้กับเราได้ครับ',
    `${menu.name} ${priceLine}`,
    `ไม่ต้องแยกย้ายไปหาอาหารกลางวัน ทีมกินครบทุกคนแล้วต่องานได้ทันที${ruleLine ? `\n${ruleLine}` : ''}`,
    '',
    'บอกจำนวนคน งบประมาณ และวันใช้งานมาได้เลยครับ ทีมจะคัดเมนูที่เหมาะกับทีมของคุณให้เลือก',
    '',
    'ดูเมนูเพิ่มเติมที่ ' + link,
  ),
  // 7 — ลูกค้าประจำที่กำลังขยายจำนวนคน: เมนูเดิมจัดทั้งงานได้
  ({ menu, priceLine, ruleLine, link }) => l(
    'ถ้าคุณสั่งกับเราเป็นประจำและกำลังขยายจำนวนคน เมนูที่ทีมชอบก็จัดพร้อมทั้งงานได้ครับ',
    `${menu.name} ${priceLine}`,
    ruleLine,
    '',
    'แจ้งจำนวนกล่องและวันที่ต้องการมาได้เลยครับ ทีมจะปรับปริมาณให้เหมาะกับงานของคุณ',
    '',
    'ดูเมนูเพิ่มเติมที่ ' + link,
  ),
]);

const TIER_HIGHLIGHT_VARIANTS = Object.freeze([
  // 0 — รูปแบบเดิม (งานขนาดระดับที่รู้แล้ว)
  (ctx) => l(
    `${ctx.tierName}${ctx.sampleTail}`,
    ctx.priceLineFrom,
    '',
    `${ctx.sellingPoint ? `${ctx.sellingPoint}\n` : ''}เหมาะกับ: ${ctx.bestFor || 'งานบริษัทและการจัดเลี้ยงของทีม'}${ctx.ruleLine ? `\n${ctx.ruleLine}` : ''}`,
    '',
    'ถ้ารู้แล้วว่างานของคุณมีขนาดแค่ไหน ทักมาบอกจำนวนคนและวันที่ใช้งานมาได้เลยครับ ทีมจะส่งเมนูและราคารวมให้ก่อนเสมอ',
    '',
    'ดูรายการอาหารทั้งหมด: ' + ctx.link,
  ),
  // 1 — รูปแบบเดิม (ชี้ระดับให้งานคุณ)
  (ctx) => l(
    `${ctx.tierName}${ctx.sampleTail}`,
    ctx.priceLineFrom,
    '',
    `${ctx.sellingPoint ? `${ctx.sellingPoint}\n` : ''}เหมาะกับ: ${ctx.bestFor || 'งานบริษัทและการจัดเลี้ยงของทีม'}${ctx.ruleLine ? `\n${ctx.ruleLine}` : ''}`,
    '',
    'ถ้ารู้แล้วว่างานของคุณควรอยู่ระดับนี้ ทักมาบอกจำนวนคนและงบมาได้เลยครับ ทีมจะส่งเมนูและราคาแบบไม่ต้องเดาให้ก่อนเสมอ',
    '',
    'ดูรายการอาหารทั้งหมด: ' + ctx.link,
  ),
  // 2 — ประชุม/อบรมที่ต้องคุมงบให้เนี้ยบ
  (ctx) => l(
    'ต้องจัดข้าวกล่องให้ประชุม/อบรมที่จำนวนคนเยอะ แต่ยังต้องคุมงบประมาณให้เนี้ยบ เรามีทางครับ',
    `${ctx.tierName}${ctx.sampleTail}`,
    ctx.priceLineFrom,
    `${ctx.sellingPoint ? `${ctx.sellingPoint}\n` : ''}เหมาะสำหรับ: ${ctx.bestFor || 'งานบริษัทและการจัดเลี้ยงของทีม'}${ctx.ruleLine ? `\n${ctx.ruleLine}` : ''}`,
    '',
    'แจ้งจำนวนคนและวันใช้งานมาได้เลยครับ ทีมจะเสนอชุดกล่องที่คุมงบได้ให้คุณ',
    '',
    'ดูรายละเอียดชุดกล่องที่ ' + ctx.link,
  ),
  // 3 — งานรับรองที่ต้องการให้กล่องดูดีขึ้น
  (ctx) => l(
    'วันที่ต้องต้อนรับแขกให้ดูดีขึ้น กล่องข้าวก็มีส่วนช่วยหน้างานครับ',
    `${ctx.tierName}${ctx.sampleTail}`,
    ctx.priceLineFrom,
    `${ctx.sellingPoint ? `${ctx.sellingPoint}\n` : ''}เหมาะสำหรับ: ${ctx.bestFor || 'งานบริษัทและการจัดเลี้ยงของทีม'}${ctx.ruleLine ? `\n${ctx.ruleLine}` : ''}`,
    '',
    'บอกรายละเอียดงานของคุณมาได้เลยครับ ทีมจะจัดชุดกล่องที่ดูดีเหมาะกับงานรับรอง',
    '',
    'ดูรายละเอียดชุดกล่องที่ ' + ctx.link,
  ),
  // 4 — ผู้บริหาร VIP และคณะกรรมการ ที่ต้องการความใส่ใจพิเศษ
  (ctx) => l(
    'งานที่มีผู้บริหาร VIP หรือคณะกรรมการเข้าร่วม ต้องการความใส่ใจพิเศษในทุกจุด กล่องอาหารก็เช่นกันครับ',
    `${ctx.tierName}${ctx.sampleTail}`,
    ctx.priceLineFrom,
    `${ctx.sellingPoint ? `${ctx.sellingPoint}\n` : ''}เหมาะสำหรับ: ${ctx.bestFor || 'งานบริษัทและการจัดเลี้ยงของทีม'}${ctx.ruleLine ? `\n${ctx.ruleLine}` : ''}`,
    '',
    'แจ้งรายละเอียดงานมาได้เลยครับ ทีมจะเตรียมชุดกล่องที่เหมาะกับงานของคุณ',
    '',
    'ดูรายละเอียดชุดกล่องที่ ' + ctx.link,
  ),
  // 5 — อบรมหลายวันที่ต้องการมื้อต่อเนื่อง
  (ctx) => l(
    'อบรมหลายวันต้องจัดมื้อให้ต่อเนื่องและไม่น่าเบื่อ เพื่อให้ทีมคงสมาธิได้ตลอดคอร์สครับ',
    `${ctx.tierName}${ctx.sampleTail}`,
    ctx.priceLineFrom,
    `${ctx.sellingPoint ? `${ctx.sellingPoint}\n` : ''}เหมาะสำหรับ: ${ctx.bestFor || 'งานบริษัทและการจัดเลี้ยงของทีม'}${ctx.ruleLine ? `\n${ctx.ruleLine}` : ''}`,
    '',
    'แจ้งจำนวนคนและวันอบรมมาได้เลยครับ ทีมจะจัดชุดกล่องที่เหมาะกับอบรมของคุณ',
    '',
    'ดูรายละเอียดชุดกล่องที่ ' + ctx.link,
  ),
  // 6 — เลี้ยงทีมหลังโปรเจกต์จบ
  (ctx) => l(
    'เมื่อโปรเจกต์ปิดจบภารกิจ การเลี้ยงขอบคุณทีมก็เป็นกำลังใจที่ช่วยเติมพลังงานให้เริ่มงานถัดไปได้ทันทีครับ',
    `${ctx.tierName}${ctx.sampleTail}`,
    ctx.priceLineFrom,
    `${ctx.sellingPoint ? `${ctx.sellingPoint}\n` : ''}เหมาะสำหรับ: ${ctx.bestFor || 'งานบริษัทและการจัดเลี้ยงของทีม'}${ctx.ruleLine ? `\n${ctx.ruleLine}` : ''}`,
    '',
    'แจ้งจำนวนทีมและวันจัดงานมาได้เลยครับ ทีมจะเตรียมชุดกล่องให้คุณ',
    '',
    'ดูรายละเอียดชุดกล่องที่ ' + ctx.link,
  ),
  // 7 — ผู้จัดการที่ไม่มีเวลาไล่เทียบชุดกล่อง
  (ctx) => l(
    'ผู้จัดการไม่มีเวลานั่งไล่เทียบชุดกล่องให้ทีม? ฝากให้ทีมของเราช่วยเลือกให้ได้ครับ',
    `${ctx.tierName}${ctx.sampleTail}`,
    ctx.priceLineFrom,
    `${ctx.sellingPoint ? `${ctx.sellingPoint}\n` : ''}เหมาะสำหรับ: ${ctx.bestFor || 'งานบริษัทและการจัดเลี้ยงของทีม'}${ctx.ruleLine ? `\n${ctx.ruleLine}` : ''}`,
    '',
    'บอกจำนวนคน งบประมาณ และวันใช้งานมาได้เลยครับ ทีมจะคัดชุดกล่องที่เหมาะส่งให้คุณเลือก',
    '',
    'ดูรายละเอียดชุดกล่องที่ ' + ctx.link,
  ),
]);

// เลือกรูปแบบข้อความจากเลขสัปดาห์ (มาจาก buildWeeklyBroadcastDraft) —
// modulo ปลอดภัยกันเลขติดลบ/ล้นชุด เพื่อให้สัปดาห์เดียวกันได้ร่างเดียวกันเสมอ
function variantAt(variants, variant = 0) {
  const len = variants.length;
  const index = ((Number(variant) % len) + len) % len;
  return variants[Number.isFinite(index) ? index : 0];
}

// จำนวนรูปแบบข้อความต่อธีม — ครบกองในสาย 16 สัปดาห์ (สลับธีมรายสัปดาห์,
// ขยับรูปแบบทุกสองสัปดาห์) ใช้เป็นเพดานสแกนในเทสต์กติกาขายทุกรูปแบบ
export const BROADCAST_VARIANT_COUNTS = Object.freeze({
  weeklyFeatured: WEEKLY_FEATURED_VARIANTS.length,
  tierHighlight: TIER_HIGHLIGHT_VARIANTS.length,
});

// ---- Theme 2: ชุดระดับ — ขายระดับกล่อง (คลาสสิก / ซิกเนเจอร์ / พรีเมียม) ----
export function composeTierHighlightText({ tierMeta, fromPrice, menu, rules, siteBaseUrl, variant = 0 }) {
  const ctx = prepareTier({ tierMeta, fromPrice, menu, rules, siteBaseUrl });
  return variantAt(TIER_HIGHLIGHT_VARIANTS, variant)(ctx);
}

function prepareTier({ tierMeta, fromPrice, menu, rules, siteBaseUrl }) {
  const sampleLine = menu ? `อย่างเมนู ${menu.name} อยู่ในระดับนี้` : '';
  return {
    tierName: tierMeta?.nameTh ? tierMeta.nameTh : '',
    sampleTail: sampleLine ? ` — ${sampleLine}` : '',
    priceLineFrom: fromPrice ? `เริ่มต้น ${fromPrice} บาท/กล่อง` : 'ราคาบอกผ่านแชทได้ทันทีครับ',
    sellingPoint: tierMeta?.sellingPointTh ? tierMeta.sellingPointTh : '',
    bestFor: tierMeta?.bestForTh ? tierMeta.bestForTh : '',
    ruleLine: mealBoxRuleLines(rules).join(' · ') || null,
    link: menuLink(siteBaseUrl),
  };
}

export async function buildWeeklyBroadcastDraft({
  now = new Date(),
  plannerPath,
  rulesPath,
  siteBaseUrl = broadcastSiteBaseUrl(),
  catalog = null,
  rules = null,
} = {}) {
  const weekKey = isoWeekKeyBangkok(now);
  const weekNumber = isoWeekNumber(weekKey);
  const catalogue = catalog ?? await getMealboxMenuCatalog({ plannerPath });
  const shopRules = rules ?? await loadBusinessRules(rulesPath);
  const rulesRevision = typeof shopRules?.revision === 'string' ? shopRules.revision : '';

  // เมนูที่โชว์รูปได้เท่านั้นเข้าตัวเลือกการแนะนำ — ข้อความพร้อมรูปต้องมีรูปจริง
  const withImage = catalogue.filter((menu) => String(menu.image || '').trim() && absoluteImageUrl(menu, siteBaseUrl));

  // Alternate themes weekly: even week → เมนูนำหน้า, odd week → ชุดระดับ.
  const themeIndex = (weekNumber % 2 + 2) % 2;
  const theme = BROADCAST_THEMES[themeIndex];
  // แต่ละรูปแบบข้อความอยู่ตำแหน่งละสองสัปดาห์ (ธีมสลับรายสัปดาห์) — หมุนครบ
  // ชุดแล้วเริ่มใหม่จากเดิม ทำให้สัปดาห์เดียวกันได้ร่างเดิมเสมอ
  const variantStep = Math.floor((weekNumber - 1) / 2);

  if (theme === 'weeklyFeatured') {
    const menu = pickRotating(withImage.length ? withImage : catalogue, weekNumber);
    if (!menu) throw new Error('menu catalogue is empty; broadcast draft skipped');
    const imageUrl = absoluteImageUrl(menu, siteBaseUrl);
    if (!imageUrl) {
      throw new Error('no real menu image available; refusing to send text-only broadcast');
    }
    return {
      weekKey,
      theme,
      menuId: String(menu.id),
      menuName: menu.name,
      menuPrice: Number(menu.price),
      imageUrl,
      draftText: composeWeeklyFeaturedText({
        menu,
        rules: shopRules,
        siteBaseUrl,
        variant: variantStep % WEEKLY_FEATURED_VARIANTS.length,
      }),
      metadata: { plannerRevision: rulesRevision, menuTier: menu.tier },
    };
  }

  const tiers = Array.isArray(shopRules?.services?.mealBox?.tiers) ? shopRules.services.mealBox.tiers : [];
  const available = TIER_ROTATION.filter((tierId) =>
    catalogue.some((menu) => menu.tier === tierId) &&
    (tiers.length === 0 || tiers.some((tier) => tier.id === tierId)));
  if (!available.length) throw new Error('no published meal-box tier available; broadcast draft skipped');
  const tierId = available[(weekNumber - 1 + available.length) % available.length];
  const tierMenus = catalogue.filter((menu) => menu.tier === tierId);
  const fromPrice = formatPrice(Math.min(...tierMenus.map((menu) => Number(menu.price))));
  const tierMeta = tiers.find((tier) => tier.id === tierId) || null;
  // เมนูนำรูปของระดับ: เอกละชั้นราคาต่ำสุดที่มีรูปจริงก่อน แล้วเลือกหมุนจากรายการ
  // เมนูนี้ ("เริ่มต้น X บาท") ต้องตั้งบนราคาที่มีอยู่จริงในแคตตาล็อกเท่านั้น
  const cheapestWithImage = tierMenus.filter((menu) =>
    formatPrice(menu.price) === fromPrice && absoluteImageUrl(menu, siteBaseUrl));
  const allWithImage = tierMenus.filter((menu) => absoluteImageUrl(menu, siteBaseUrl));
  const pool = cheapestWithImage.length ? cheapestWithImage : allWithImage;
  const menu = pool.length ? pickRotating(pool, weekNumber) : null;
  const imageUrl = absoluteImageUrl(menu, siteBaseUrl);

  return {
    weekKey,
    theme,
    menuId: menu ? String(menu.id) : null,
    menuName: menu ? menu.name : null,
    menuPrice: Number(fromPrice) || null,
    imageUrl,
    draftText: composeTierHighlightText({
      tierMeta,
      fromPrice,
      menu,
      rules: shopRules,
      siteBaseUrl,
      variant: variantStep % TIER_HIGHLIGHT_VARIANTS.length,
    }),
    metadata: { plannerRevision: rulesRevision, menuTier: tierId },
  };
}
