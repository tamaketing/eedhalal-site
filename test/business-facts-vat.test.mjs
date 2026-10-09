import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { loadSystemData } from '../scripts/check-system.mjs';

// VAT / quotation fact accuracy.
// Owner fact: EED HALAL does NOT add VAT to customer prices, so published copy
// must never imply VAT is added on top of a quoted price. Withholding-tax
// policy is undecided, so copy must escalate instead of inventing it.
//
// The AI prompt that used to carry these rules is gone. llms.txt and
// llms-full.md are now the machine-readable statement of the same fact that
// the website publishes in Thai and English.

const root = new URL('../', import.meta.url);
const data = await loadSystemData();
const published = [
  await readFile(new URL('llms.txt', root), 'utf8'),
  await readFile(new URL('llms-full.md', root), 'utf8'),
].join('\n');

// A prohibition quote ("do NOT say X") legitimately names X; strip those
// guard lines before asserting no positive add/exclude-VAT instruction.
function positiveInstructions(text) {
  return text
    .split('\n')
    .filter((line) => !/ห้ามพูดว่า|ห้ามเดา|ห้ามอนุมาน|ห้ามบอกว่า|Do not say|Do not claim/.test(line))
    .join('\n');
}

test('canonical rules carry explicit vatCharge=false', () => {
  assert.equal(data.rules.documents.vatRegistered, false);
  assert.equal(data.rules.documents.vatCharge, false);
});

test('published AI files never instruct VAT exclusion or later addition', () => {
  const positive = positiveInstructions(published);
  // "does not add VAT" is the intended final-price statement, so the forbidden
  // list targets exclusion/addition phrasing instead.
  for (const phrase of ['ไม่รวม VAT', 'excluding VAT', 'VAT excluded', 'do not include VAT', 'prices do not include VAT']) {
    assert.ok(!positive.includes(phrase), `forbidden instruction: ${phrase}`);
  }
  assert.ok(
    !/VAT\s*7%\s*(เพิ่ม|บวก)|บวก\s*VAT\s*7%|VAT 7%.*(เพิ่ม|บวก)/.test(positive),
    'no VAT-7%-will-be-added wording',
  );
});

test('published AI files state that prices are final', () => {
  assert.ok(/prices are final/i.test(published), 'final-price statement is present');
  assert.ok(
    positiveInstructions(published).includes('does not add VAT'),
    'no VAT is added on top of a quoted price',
  );
});

test('VAT rate is never published as a customer-facing number', () => {
  const inflated = structuredClone(data.rules);
  inflated.documents.vatRate = 99;
  inflated.documents.vatCharge = false;
  assert.ok(!positiveInstructions(published).includes('99%'), 'no rate value is published');
  assert.ok(
    !/รวม VAT แล้ว|ราคารวม VAT|include VAT/i.test(positiveInstructions(published)),
    'no VAT-inclusion wording at any rate',
  );
});

test('VAT and withholding tax are treated separately', () => {
  const whtLines = published.split('\n').filter((line) => /หัก ณ ที่จ่าย|withholding/i.test(line));
  for (const line of whtLines) {
    assert.ok(!/\d+\s*%/.test(line), `no invented withholding rate: ${line.slice(0, 80)}`);
  }
});

test('missing business facts must be escalated, never invented', () => {
  const positive = positiveInstructions(published);
  assert.ok(!/ยืนราคา\s*\d+\s*วัน|quotation valid/i.test(positive), 'no invented quotation-validity policy');
  assert.ok(!/ค่าบริการเพิ่มเติม\s*\d+|service charge\s*\d+/i.test(positive), 'no invented service-charge policy');
});

test('confirmed business facts are unchanged', () => {
  assert.equal(data.rules.services.mealBox.minimumOrder, 10);
  assert.equal(data.rules.services.snackBox.minimumOrder, 30);
  assert.equal(data.rules.paymentTerms.bookingDepositPercent, 50);
  assert.ok(
    published.includes('no fixed delivery rate table'),
    'delivery is quoted per order, never calculated from a rate table',
  );
  assert.ok(!/ส่งฟรี|มอเตอร์ไซค์|zone_\d/.test(published), 'no retired free-delivery or zone wording');
  assert.ok(published.includes('7 วัน') || published.includes('อย่างน้อย 7 วัน') || published.includes('7 days ahead'));
});
