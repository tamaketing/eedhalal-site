// EED HALAL — tests for the quotation flow and the agent write tools.
//
// WHY THIS FILE IS NOT IN test/: agents may not edit `test/**` (the project
// permission list denies it), so the file lives next to the code it covers.
// `node --test` still discovers it. When the owner allows edits under
// test/**, move it to `test/agent-tools.test.mjs` and add it to the `unit`
// category in scripts/run-tests.mjs.
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { extractLeadSignals, leadFunnel, listLeadsByStatus } from '../../../services/leads.mjs';
import { createMemoryAdapter } from '../../../db/memory.mjs';
import { boxCost, marginRows } from '../../../tools/agent/finance.mjs';
import {
  isQuotationDraft,
  loadBusinessRules,
  quotationGaps,
  quotationView,
  QUOTATION_DRAFT_SOURCE,
} from '../../../services/quotations.mjs';

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

test('a date is read the way the customer wrote it', () => {
  const iso = extractLeadSignals('ขอ 80 กล่อง วันที่ 2026-12-01 ส่งที่สำนักงาน');
  assert.equal(iso.eventDate, '2026-12-01', 'ISO date must not be read as day 26 of year 01');

  const thai = extractLeadSignals('ขอใบเสนอราคาบุฟเฟต์ 100 คน วันที่ 20/12/2026 งบ 250 บาท');
  assert.equal(thai.eventDate, '2026-12-20', 'day/month/year stays day/month/year');

  const buddhist = extractLeadSignals('สั่ง 50 กล่อง วันที่ 5/1/70');
  assert.equal(buddhist.eventDate, '2027-01-05', 'a two-digit Thai year means the Buddhist year');

  const monthFirst = extractLeadSignals('งาน 30 ท่าน 12/25/2026');
  assert.equal(monthFirst.eventDate, '2026-12-25', 'a second number above 12 can only be the day');

  const none = extractLeadSignals('สนใจสอบถามราคา');
  assert.equal(none.eventDate, null, 'no date in the message means no date');
});

test('a quotation without a lead is not ready, and says why', async () => {
  const rules = await loadBusinessRules();
  const gaps = quotationGaps(null, rules);
  assert.equal(gaps.blocking.length, 3, 'quantity, date and location are still missing');
  assert.ok(gaps.blocking.every((gap) => gap.field));
});

test('a quotation below the published minimum is blocked with the real number', async () => {
  const rules = await loadBusinessRules();
  const minimum = rules.services.mealBox.minimumOrder;
  const gaps = quotationGaps({ quantity: minimum - 1, eventDate: '2030-01-01', location: 'สาทร' }, rules);
  const quantityGap = gaps.blocking.find((gap) => gap.field === 'quantity');
  assert.ok(quantityGap, 'the order is below the minimum');
  assert.match(quantityGap.why, new RegExp(String(minimum)), 'the gap names the published minimum');
});

test('a complete quotation is ready and still flags what the owner must decide', async () => {
  const rules = await loadBusinessRules();
  const gaps = quotationGaps({ quantity: 80, eventDate: '2030-01-01', location: 'สำนักงาน', budgetPerPerson: 120 }, rules);
  assert.deepEqual(gaps.blocking, [], 'nothing blocks a complete job');
  const fields = gaps.advisory.map((gap) => gap.field);
  assert.ok(fields.includes('delivery'), 'the delivery fee stays the owner\'s number');
  assert.ok(fields.includes('vat'), 'the shop is not VAT-registered');
});

test('a quotation view carries the job, the text and the readiness', async () => {
  const rules = await loadBusinessRules();
  const view = quotationView({
    draft: {
      id: 'd1', draftId: 'LD-1', status: 'WAITING_FOR_HUMAN', source: QUOTATION_DRAFT_SOURCE,
      incomingMessage: 'ขอ 80 กล่อง', draftResponse: 'เรียนรับทราบครับ', metadata: {},
    },
    lead: { id: 'l1', status: 'NEW', quantity: 80, eventDate: '2030-01-01', location: 'สำนักงาน', budgetPerPerson: 120 },
    customer: { id: 'c1', displayName: 'คุณแก้ว' },
    rules,
  });
  assert.equal(view.quotationId, 'LD-1');
  assert.equal(view.customerName, 'คุณแก้ว');
  assert.equal(view.quantity, 80);
  assert.equal(view.readyForOwner, true);
  assert.equal(view.quoteText, 'เรียนรับทราบครับ');
});

test('only the quotation drafts are treated as quotations', () => {
  assert.equal(isQuotationDraft({ source: QUOTATION_DRAFT_SOURCE, metadata: {} }), true);
  assert.equal(isQuotationDraft({ source: 'conversation-ai', metadata: { quotation: { quantity: 1 } } }), true);
  assert.equal(isQuotationDraft({ source: 'conversation-ai', metadata: {} }), false);
  assert.equal(isQuotationDraft(null), false);
});

test('the agent write tools print their usage without needing the API', async () => {
  for (const tool of ['draft.mjs', 'quotation.mjs']) {
    const { stdout } = await execFileAsync(process.execPath, [path.join(ROOT, 'tools', 'agent', tool), '--help']);
    assert.match(stdout, /--help/);
  }
});

test('the lead funnel counts the jobs in every status', async () => {
  const repos = createMemoryAdapter();
  const customer = await repos.customers.create({ id: 'c-funnel', lineUserId: 'U_funnel' });
  await repos.leads.create({ id: 'l-1', customerId: customer.id, status: 'NEW', summary: '' });
  await repos.leads.create({ id: 'l-2', customerId: customer.id, status: 'NEW', summary: '' });
  await repos.leads.create({ id: 'l-3', customerId: customer.id, status: 'QUALIFIED', summary: '' });
  const counts = await leadFunnel(repos);
  assert.equal(counts.NEW, 2);
  assert.equal(counts.QUALIFIED, 1);
  assert.equal(counts.WON, 0);
  const rows = await listLeadsByStatus(repos, 'NEW');
  assert.equal(rows.length, 2);
});

test('a margin is the selling price minus the owner cost', () => {
  assert.equal(boxCost({ food: 45, packing: 6, labor: 8, delivery: 15 }), 74);
  assert.equal(boxCost({ food: 45, packing: 6 }), null, 'an incomplete cost is not a cost');
  const { rows } = marginRows(
    { menus: { '3': { food: 45, packing: 6, labor: 8, delivery: 15 } } },
    { menus: { '3': { name: 'ผัดไทยกุ้งสด', price: 90 } } },
    {},
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].cost, 74);
  assert.equal(rows[0].marginPerBox, 16);
  assert.ok(rows[0].marginPct > 17 && rows[0].marginPct < 18);
});

test('a menu that costs more than it sells is flagged, not hidden', () => {
  const { rows } = marginRows(
    { menus: { '8': { food: 70, packing: 6, labor: 8, delivery: 15 } } },
    { menus: { '8': { name: 'ข้าวผัดเนื้อ', price: 80 } } },
    {},
  );
  assert.equal(rows[0].marginPerBox, -19);
  assert.ok(rows[0].marginPct < 0);
});
