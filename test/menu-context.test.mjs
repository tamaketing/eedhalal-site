import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// §27: the generated runtime prompt must not contain the full per-menu
// price catalog. The structural pattern below matches the retired menu
// lines ("name | 75 บาท/กล่อง | ...") while ignoring legitimate policy
// lines such as "เริ่ม 65 บาท/กล่อง" (no pipe before the price).
function assertNoMenuPriceLines(source, label) {
  assert.ok(!/^.+ \| \d+ บาท\/กล่อง/m.test(source), `no menu price lines in ${label}`);
}

test('knowledge pack carries the menu-context rule instead of a price catalog', async () => {
  const knowledge = await readFile(new URL('../line-ai/knowledge-pack.md', import.meta.url), 'utf8');
  assertNoMenuPriceLines(knowledge, 'knowledge-pack.md');
  assert.ok(knowledge.includes('MENU_CONTEXT'), 'menu-context rule present');
  assert.ok(knowledge.includes('เริ่ม 65 บาท/กล่อง'), 'starting-price policy retained');
  assert.ok(!knowledge.includes('const menus ='), 'no embedded catalog');
});

test('combined n8n system message carries no baked menu prices', async () => {
  const message = await readFile(new URL('../line-ai/system-message-node.txt', import.meta.url), 'utf8');
  assertNoMenuPriceLines(message, 'system-message-node.txt');
  assert.ok(message.includes('MENU_CONTEXT'), 'menu-context rule present');
  assert.ok(message.includes('ทุกคู่ชื่อเมนู+ราคา'), 'price-integrity rule present');
});

test('system prompt states the price-integrity contract', async () => {
  const prompt = await readFile(new URL('../line-ai/system-prompt.md', import.meta.url), 'utf8');
  assert.ok(prompt.includes('MENU_CONTEXT'), 'menu-context rule present');
  assert.ok(prompt.includes('ทุกคู่ชื่อเมนู+ราคา'), 'price-integrity rule present');
  assert.ok(prompt.includes('ขอเช็กราคากับทางทีมก่อน'), 'no-guess fallback present');
});
