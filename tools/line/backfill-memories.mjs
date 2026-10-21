// EED HALAL — backfill the customer memory for every customer that has none.
//
// WHY: the memory (what the bot remembers about a customer) only exists for
// messages that arrive after the feature was switched on. The customers who
// talked to the shop before that have no memory, so the bot starts from zero
// with them. This script rebuilds it from the conversation they already had.
//
//   node tools/line/backfill-memories.mjs --dry-run   report only
//   node tools/line/backfill-memories.mjs             rebuild (rules only)
//   node tools/line/backfill-memories.mjs --ai        rebuild + let the model
//                                                     write the summary
//
// The facts come from the rules (never guessed); the summary is written by
// the model when --ai is given, otherwise the rule summary is used.
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createAdapter } from '../../db/index.mjs';
import { buildSummary, extractFacts, mergeFacts, missingQuestions } from '../../services/customerMemory.mjs';
import { botStorePath } from './bot-store.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const isCli = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

async function loadEnv() {
  const out = { ...process.env };
  for (const file of [path.join(ROOT, '.env'), path.join(ROOT, 'data', 'line-runtime', 'runtime.env')]) {
    let raw = '';
    try { raw = await readFile(file, 'utf8'); } catch { continue; }
    for (const line of raw.split(/\r?\n/)) {
      const match = line.match(/^([A-Z_]+)=(.*)$/);
      if (match && out[match[1]] === undefined) out[match[1]] = match[2];
    }
  }
  return out;
}

export async function main(argv = process.argv.slice(2)) {
  const dryRun = argv.includes('--dry-run');
  const useAi = argv.includes('--ai');
  const env = await loadEnv();
  if (!env.DATABASE_URL) throw new Error('ต้องมี DATABASE_URL (ดู data/line-runtime/runtime.env)');
  const repos = createAdapter({ ...env, DB_ADAPTER: 'postgres' });

  let askMemoryWriter = null;
  if (useAi) {
    // The model runs through the bot's own OpenCode store, so the summaries
    // never show up in the owner's chat list.
    process.env.EED_BOT_OPENCODE_DB = botStorePath(env);
    ({ askMemoryWriter } = await import('../agent/line-chat.mjs'));
  }

  const customers = await repos.customers.list();
  const report = [];
  try {
    for (const customer of customers) {
      const existing = await repos.customerMemories.findByCustomerId(customer.id);
      if (existing) {
        report.push({ name: customer.displayName || customer.lineUserId, status: 'มีความจำอยู่แล้ว' });
        continue;
      }
      const inbound = await repos.inboundMessages.listByCustomer(customer.id);
      const messages = inbound
        .filter((row) => row.messageType === 'text' && String(row.incomingMessage || '').trim())
        .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
      if (!messages.length) {
        report.push({ name: customer.displayName || customer.lineUserId, status: 'ไม่มีข้อความ' });
        continue;
      }
      // The facts of the whole conversation, oldest first.
      let facts = {};
      for (const row of messages) facts = mergeFacts(facts, extractFacts(row.incomingMessage));
      facts.openQuestions = missingQuestions(facts);
      const summary = buildSummary(facts);
      report.push({
        name: customer.displayName || customer.lineUserId,
        status: 'จะสร้าง',
        messages: messages.length,
        summary,
      });
      if (dryRun) continue;

      let written = summary;
      if (useAi) {
        const turns = messages.slice(-10).map((row) => ({ role: 'customer', text: row.incomingMessage }));
        const answer = await askMemoryWriter({
          message: messages[messages.length - 1].incomingMessage,
          history: turns,
          facts,
          currentSummary: '',
        });
        if (answer.ok) written = answer.summary;
      }
      const saved = await repos.transaction(async (tx) => tx.customerMemories.create({
        id: randomUUID(),
        customerId: customer.id,
        summary: written,
        facts,
        history: [],
        status: 'OPEN',
        source: useAi ? 'ai' : 'rule',
        ruleRevision: '',
      }));
      report[report.length - 1].status = 'สร้างแล้ว';
      report[report.length - 1].id = saved.id;
    }
  } finally {
    await repos.close();
  }

  for (const row of report) {
    console.log(`- ${row.name}: ${row.status}${row.summary ? ` · ${row.summary.slice(0, 90)}` : ''}`);
  }
  const created = report.filter((row) => row.status === 'สร้างแล้ว').length;
  console.log(`\n${dryRun ? 'จะสร้าง' : 'สร้าง'}ความจำให้ ${created} คน จากทั้งหมด ${report.length} คน`);
  return { created, report };
}

if (isCli) {
  main().catch((error) => {
    process.stderr.write(`ย้อนความจำไม่สำเร็จ: ${error.message}\n`);
    process.exitCode = 1;
  });
}
