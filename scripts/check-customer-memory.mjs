// EED HALAL — check the customer memory.
//
// The memory is what the bot remembers about a customer between messages, so
// the rules that fill it are worth checking on every build: a wrong number or
// a lost fact is worse than no memory at all.
//
//   node scripts/check-customer-memory.mjs
//
// Read-only: it never touches a real database.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createMemoryAdapter } from '../db/memory.mjs';
import { createFileAdapter } from '../db/file.mjs';
import { memoryDefaults, validateMemoryRow, MEMORY_SUMMARY_MAX, MEMORY_HISTORY_MAX } from '../db/customer-memory-contract.mjs';
import {
  buildSummary,
  closeJob,
  extractFacts,
  factsChanged,
  lockedFactKeys,
  memoryPromptBlock,
  mergeFacts,
  missingQuestions,
  saveOwnerMemory,
  upsertMemory,
} from '../services/customerMemory.mjs';
import { buildChatPrompt, buildMemoryPrompt, HISTORY_LIMIT } from '../tools/agent/line-chat.mjs';

const checks = [];
function check(name, fn) { checks.push({ name, fn }); }

check('the rules read the facts a customer literally stated', () => {
  const facts = extractFacts('ขอ 50 กล่อง งบ 70 บาทต่อกล่อง ส่งที่ BITEC BANGNA เบอร์ 061-272-5989');
  assert.equal(facts.quantity.value, 50);
  assert.equal(facts.quantity.unit, 'กล่อง');
  assert.equal(facts.budgetPerPerson, 70);
  assert.equal(facts.location, 'BITEC BANGNA');
  assert.equal(facts.phone, '0612725989');
});

check('a Thai short year becomes the real year', () => {
  const facts = extractFacts('สั่งวันที่ 21/10/69 ค่ะ');
  assert.equal(facts.eventDateISO, '2026-10-21');
});

check('the rules never invent a tax id from a phone number', () => {
  const facts = extractFacts('เบอร์ 0931575379');
  assert.equal(facts.phone, '0931575379');
  assert.equal(facts.taxId, undefined);
});

check('a question is not a place', () => {
  const facts = extractFacts('นี่มีส่งฟรีมั้ยคะ');
  assert.equal(facts.location, undefined);
});

check('a politeness word is not a name', () => {
  const facts = extractFacts('ขอบคุณค่ะ');
  assert.equal(facts.contactName, undefined);
  const named = extractFacts('ติดต่อคุณปิ่น');
  assert.equal(named.contactName, 'คุณปิ่น');
});

check('a new fact replaces an old one, a locked fact does not', () => {
  const merged = mergeFacts(
    { phone: '0612725989', location: 'สาทร' },
    { phone: '0800000000', location: 'บางนา' },
    { locked: ['phone'] },
  );
  assert.equal(merged.phone, '0612725989', 'the owner confirmed the phone');
  assert.equal(merged.location, 'บางนา', 'the new location wins');
});

check('nothing new means nothing changed', () => {
  const current = { quantity: { value: 50, unit: 'กล่อง' } };
  assert.equal(factsChanged(current, { quantity: { value: 50, unit: 'กล่อง' } }), false);
  assert.equal(factsChanged(current, { quantity: { value: 60, unit: 'กล่อง' } }), true);
});

check('the summary stays short and lists what is still missing', () => {
  const summary = buildSummary({ quantity: { value: 50, unit: 'กล่อง' }, location: 'สาทร' });
  assert.ok(summary.length <= MEMORY_SUMMARY_MAX);
  assert.match(summary, /50 กล่อง/);
  const questions = missingQuestions({ quantity: { value: 50, unit: 'กล่อง' } });
  assert.ok(questions.includes('วันที่ต้องการ'));
});

check('the owner confirmed facts are locked', () => {
  const locked = lockedFactKeys({ phone: '0612725989', taxId: '0105558065167', address: 'กรุงเทพ' });
  assert.ok(locked.includes('phone'));
  assert.ok(locked.includes('taxId'));
  assert.ok(locked.includes('location'));
});

check('the memory row is valid and the defaults are complete', () => {
  assert.deepEqual(validateMemoryRow(memoryDefaults({})), []);
  assert.ok(validateMemoryRow({ ...memoryDefaults({}), summary: 'x'.repeat(MEMORY_SUMMARY_MAX + 1) }).length > 0);
  assert.ok(validateMemoryRow({ ...memoryDefaults({}), status: 'NOPE' }).length > 0);
  assert.ok(validateMemoryRow({ ...memoryDefaults({}), history: new Array(MEMORY_HISTORY_MAX + 1).fill({}) }).length > 0);
});

check('the bot sees the customer situation in the prompt', () => {
  const block = memoryPromptBlock({ summary: 'ลูกค้าขอ 50 กล่อง ส่งสาทร', facts: { quantity: { value: 50, unit: 'กล่อง' } }, status: 'OPEN' });
  assert.match(block, /สถานะของลูกค้าคนนี้/);
  assert.match(block, /ยังต้องถามลูกค้าเรื่อง/);
  const prompt = buildChatPrompt({ message: 'วันนี้ส่งได้ไหมครับ', history: [], facts: block });
  assert.match(prompt, /สถานะของลูกค้าคนนี้/);
});

check('the memory writer is asked for one line, not a reply', () => {
  const prompt = buildMemoryPrompt({ message: 'ขอ 20 กล่อง', history: [], facts: { quantity: { value: 20, unit: 'กล่อง' } }, currentSummary: '' });
  assert.match(prompt, /1 บรรทัด/);
  assert.match(prompt, /ห้ามคิดตัวเลขใหม่|ห้ามเขียนราคา/);
});

check('the bot may see more than four turns of the conversation', () => {
  assert.ok(HISTORY_LIMIT >= 20, 'the bot must not forget the last exchanges');
  const history = Array.from({ length: 40 }, (_, i) => ({ role: 'customer', text: `ที่ ${i}` }));
  const prompt = buildChatPrompt({ message: 'ใหม่', history, facts: '' });
  assert.match(prompt, /ที่ 39/);
});

check('one memory per customer, on every adapter', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'eed-memory-'));
  try {
    for (const repos of [createMemoryAdapter(), createFileAdapter(dir)]) {
      const customer = await repos.customers.create({ id: 'c1', lineUserId: 'U1', displayName: 'ทดสอบ' });
      const first = await upsertMemory(repos, { customerId: customer.id, message: 'ขอ 20 กล่อง', customer });
      assert.equal(first.memory.status, 'OPEN');
      assert.equal(first.memory.facts.quantity.value, 20);
      const again = await upsertMemory(repos, { customerId: customer.id, message: 'ส่งที่บางนา', customer });
      assert.equal(again.memory.facts.quantity.value, 20, 'the earlier fact is kept');
      assert.equal(again.memory.facts.location, 'บางนา');
      // A second memory for the same customer must be impossible.
      const duplicate = await repos.customerMemories.create({
        id: 'c2', customerId: customer.id, summary: '', facts: {}, history: [], status: 'OPEN', source: 'rule', ruleRevision: '',
      }).then(() => null, () => 'rejected');
      assert.equal(duplicate, 'rejected');
      // The owner writes the summary: the bot may not overwrite it.
      const owned = await saveOwnerMemory(repos, { customerId: customer.id, summary: 'เจ้าของเขียนเอง', actor: { type: 'OWNER', id: 'owner' } });
      assert.equal(owned.source, 'owner');
      const afterBot = await upsertMemory(repos, { customerId: customer.id, message: 'ส่งที่ห้วยขวาง', customer });
      assert.equal(afterBot.memory.summary, 'เจ้าของเขียนเอง', 'the owner summary survives the bot');
      // Closing the job moves it into the history.
      const closed = await closeJob(repos, { customerId: customer.id, actor: { type: 'OWNER', id: 'owner' } });
      assert.equal(closed.status, 'CLOSED');
      assert.equal(closed.history.length, 1);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

let failed = 0;
for (const item of checks) {
  try {
    await item.fn();
    process.stdout.write(`  ✓ ${item.name}\n`);
  } catch (error) {
    failed += 1;
    process.stdout.write(`  ✗ ${item.name}\n    ${error.message}\n`);
  }
}
process.stdout.write(failed
  ? `\nCustomer memory check: ${failed}/${checks.length} ไม่ผ่าน\n`
  : `\nCustomer memory check: ผ่าน ${checks.length}/${checks.length}\n`);
process.exitCode = failed ? 1 : 0;
