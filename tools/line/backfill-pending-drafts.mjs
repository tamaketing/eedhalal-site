// EED HALAL — make every customer message visible in the owner queue.
//
// WHY: a message that never became a draft (the model could not answer, the
// customer sent a picture, the bot was paused) was stored in the receipt
// ledger but never appeared in the owner's queue. The owner could not know a
// customer was waiting. This script creates the missing drafts so every
// message is in front of the owner, who can answer it or mark it as handled.
//
//   node tools/line/backfill-pending-drafts.mjs --dry-run   report only
//   node tools/line/backfill-pending-drafts.mjs --yes       create the drafts
//
// The draft says plainly that the shop has to answer it; the owner replaces
// the text before sending. Nothing is ever sent to a customer by this script.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createAdapter } from '../../db/index.mjs';
import { persistDraft } from '../../services/drafts.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const isCli = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

const PLACEHOLDER = 'ข้อความนี้เข้ามาตอนที่ระบบยังร่างคำตอบให้ไม่ได้ครับ — รอเจ้าของตอบเอง (แก้ข้อความก่อนส่งได้ตามปกติ)';

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
  const confirmed = argv.includes('--yes');
  const env = await loadEnv();
  if (!env.DATABASE_URL) throw new Error('ต้องมี DATABASE_URL (ดู data/line-runtime/runtime.env)');
  const repos = createAdapter({ ...env, DB_ADAPTER: 'postgres' });

  try {
    const inbound = await repos.inboundMessages.list();
    const drafts = await repos.drafts.list();
    const byEvent = new Map();
    for (const draft of drafts) {
      if (draft.sourceEventId) byEvent.set(draft.sourceEventId, draft);
    }
    const pending = inbound.filter((row) => {
      if (row.draftId) return false;
      if (row.sourceEventId && byEvent.has(row.sourceEventId)) return false;
      return String(row.incomingMessage || '').trim();
    });
    console.log(`ข้อความที่ยังไม่มี draft: ${pending.length} รายการ`);
    if (!pending.length) return { created: 0, pending: [] };
    if (!dryRun && !confirmed) {
      console.log('ยังไม่ได้สร้าง — เพิ่ม --yes เพื่อยืนยัน (ระบบจะไม่ส่งอะไรให้ลูกค้าเอง)');
      return { created: 0, pending };
    }

    let created = 0;
    for (const row of pending) {
      const customerId = row.customerId || null;
      if (!customerId) {
        console.log(`- ข้าม (ไม่มีลูกค้าที่ผูก): ${String(row.incomingMessage).slice(0, 50)}`);
        continue;
      }
      if (dryRun) {
        console.log(`- จะสร้าง: ${String(row.incomingMessage).slice(0, 60)}`);
        continue;
      }
      const draft = await persistDraft(repos, {
        customerId,
        channel: row.channel || 'line',
        incomingMessage: row.incomingMessage,
        draftResponse: PLACEHOLDER,
        source: 'conversation-ai',
        aiModel: 'none',
        sourceEventId: row.sourceEventId || null,
        metadata: { backfilled: true, inboundId: row.id },
      }, { type: 'SYSTEM', id: 'backfill-pending-drafts' });
      // Link the receipt to the draft so the thread is whole.
      if (row.draftId === null) {
        await repos.inboundMessages.updateIfCurrent(row.id, { draftId: draft.id }, { status: row.status, revision: row.revision });
      }
      created += 1;
    }
    console.log(`\n${dryRun ? 'จะสร้าง' : 'สร้าง'} draft ให้ ${created} รายการ`);
    return { created, pending };
  } finally {
    await repos.close();
  }
}

if (isCli) {
  main().catch((error) => {
    process.stderr.write(`ย้อน draft ไม่สำเร็จ: ${error.message}\n`);
    process.exitCode = 1;
  });
}
