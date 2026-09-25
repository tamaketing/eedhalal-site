import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { loadSystemData, renderKnowledge } from '../scripts/check-system.mjs';

// VAT / quotation fact accuracy (Phase 4B business-fact fix).
// Owner fact: EED HALAL does NOT add VAT to customer prices, so the AI must
// never say "excluding VAT" or imply VAT will be added. Withholding-tax
// policy is undecided, so the AI must escalate instead of inventing it.

const root = new URL('../', import.meta.url);
const data = await loadSystemData();
const knowledge = renderKnowledge(data.rules, data.catalog, data.legacy.menus);

// A prohibition quote ("do NOT say X") legitimately names X; strip those
// guard lines before asserting no positive add/exclude-VAT instruction.
function positiveInstructions(text) {
  return text.split('\n').filter((line) => !/ห้ามพูดว่า|ห้ามเดา|ห้ามอนุมาน|ห้ามบอกว่า/.test(line)).join('\n');
}

test('canonical rules carry explicit vatCharge=false', () => {
  assert.equal(data.rules.documents.vatRegistered, false);
  assert.equal(data.rules.documents.vatCharge, false);
});

test('generated prompt never instructs VAT exclusion or later addition', () => {
  const positive = positiveInstructions(knowledge);
  // Note: "ไม่บวก VAT เพิ่ม" (no VAT added) is the intended final-price
  // statement, so the forbidden list targets exclusion/addition phrasing.
  for (const phrase of ['ไม่รวม VAT', 'excluding VAT', 'VAT excluded', 'plus VAT']) {
    assert.ok(!positive.includes(phrase), `forbidden instruction: ${phrase}`);
  }
  assert.ok(!/VAT\s*7%\s*(เพิ่ม|บวก)|บวก\s*VAT\s*7%|VAT 7%.*(เพิ่ม|บวก)/.test(positive), 'no VAT-7%-will-be-added wording');
});

test('generated prompt states final-price behavior from vatCharge', () => {
  assert.ok(knowledge.includes('ราคาสุทธิสุดท้าย'));
  assert.ok(knowledge.includes('ไม่เรียกเก็บ VAT'));
});

test('direct VAT questions get a current-rule-safe instruction', () => {
  assert.ok(knowledge.includes('ถ้าลูกค้าถามเรื่อง VAT โดยตรง'));
  assert.ok(knowledge.includes('ออกใบกำกับภาษี / Tax Invoice ไม่ได้ทุกกรณี'));
});

test('vatRate presence alone cannot produce VAT-addition wording', () => {
  const inflated = structuredClone(data.rules);
  inflated.documents.vatRate = 99;
  inflated.documents.vatCharge = false;
  const rendered = renderKnowledge(inflated, data.catalog, data.legacy.menus);
  assert.ok(!positiveInstructions(rendered).includes('99%'), 'rate value must not leak');
  assert.ok(!/ไม่รวม VAT|excluding VAT/i.test(positiveInstructions(rendered)), 'no exclusion wording at any rate');
});

test('VAT and withholding tax are treated separately', () => {
  assert.ok(knowledge.includes('VAT กับภาษีหัก ณ ที่จ่ายเป็นคนละเรื่องกัน'));
  assert.ok(knowledge.includes('ขออนุญาตตรวจสอบเรื่องหัก ณ ที่จ่ายกับทางทีมก่อนนะคะ'));
  const whtLines = knowledge.split('\n').filter((line) => /หัก ณ ที่จ่าย|withholding/i.test(line));
  for (const line of whtLines) {
    assert.ok(!/\d+\s*%/.test(line), `no invented withholding rate: ${line.slice(0, 80)}`);
  }
});

test('missing business facts must be escalated, never invented', () => {
  assert.ok(knowledge.includes('ห้ามเดาหรือสร้างนโยบายขึ้นเอง'));
  const positive = positiveInstructions(knowledge);
  assert.ok(!/ยืนราคา\s*\d+\s*วัน|quotation valid/i.test(positive), 'no invented quotation-validity policy');
  assert.ok(!/ค่าบริการเพิ่มเติม\s*\d+|service charge\s*\d+/i.test(positive), 'no invented service-charge policy');
});

test('both workflow artifacts carry the corrected prompt', async () => {
  for (const file of ['line-ai/n8n-workflow.json', 'line-ai/n8n-workflow-b25-persist-first.json']) {
    const workflow = JSON.parse(await readFile(new URL(`../${file}`, import.meta.url), 'utf8'));
    const message = workflow.nodes.find((node) => node.id === 'ai-agent').parameters.options.systemMessage;
    assert.ok(message.includes('ราคาสุทธิสุดท้าย'), `${file} has final-price instruction`);
    assert.ok(!message.includes('ราคาไม่รวม VAT 7%'), `${file} dropped the false sentence`);
  }
});

test('confirmed business facts are unchanged', () => {
  assert.equal(data.rules.services.mealBox.minimumOrder, 10);
  assert.equal(data.rules.services.snackBox.minimumOrder, 30);
  assert.equal(data.rules.paymentTerms.bookingDepositPercent, 50);
  assert.ok(knowledge.includes('กรุณาสอบถามค่าจัดส่งกับแอดมิน'));
  assert.ok(!/ส่งฟรี|มอเตอร์ไซค์|zone_\d/.test(knowledge));
  assert.ok(knowledge.includes('7 วัน') || knowledge.includes('อย่างน้อย 7 วัน'));
});
