// EED HALAL — housekeeping for the bot's private OpenCode store.
//
//   node tools/line/clean-bot-sessions.mjs                  prune old bot sessions (7 days)
//   node tools/line/clean-bot-sessions.mjs --keep-days 3    keep 3 days instead
//   node tools/line/clean-bot-sessions.mjs --owner          also remove the chat-replier
//                                                        sessions left in the OWNER's store
//   node tools/line/clean-bot-sessions.mjs --owner --dry-run  report only, change nothing
//
// The owner store is only touched when --owner is given explicitly: those
// sessions are the customer conversations that used to leak into the owner's
// OpenCode chat list, and the owner asked for them to be removed.
//
// After removing sessions from the owner's store, restart the OpenCode
// background service (`opencode service restart`) so the desktop app shows
// the cleaned list.
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  BOT_DB_ENV,
  botStorePath,
  fileSize,
  openSqlite,
  ownerStorePath,
  pruneOldSessions,
  removeOwnerChatReplierSessions,
} from './bot-store.mjs';

const isCli = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
const DEFAULT_KEEP_DAYS = 7;

function readFlag(name, fallback = null) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  if (value === undefined || value.startsWith('--')) return true;
  return value;
}

function megabytes(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export async function main(argv = process.argv.slice(2)) {
  const dryRun = argv.includes('--dry-run');
  const keepDays = Number(readFlag('--keep-days', DEFAULT_KEEP_DAYS)) || DEFAULT_KEEP_DAYS;
  const alsoOwner = argv.includes('--owner');

  const botPath = botStorePath();
  const botDb = existsSync(botPath) ? await openSqlite(botPath) : null;
  let pruned = null;
  let before = 0;
  let botSessions = 0;
  if (!botDb) {
    process.stdout.write(`ที่เก็บแชทของบอท: ยังไม่มี (${botPath})\n`);
  } else {
    before = await fileSize(botPath);
    pruned = { removed: 0, kept: 0, messages: 0 };
    try {
      botSessions = botDb.prepare('select count(*) as n from session_v2').get().n;
      if (dryRun) {
        const cutoff = Date.now() - keepDays * 24 * 60 * 60 * 1000;
        const stale = botDb.prepare('select count(*) as n from session_v2 where time_created < ?').get(cutoff).n;
        pruned = { removed: Number(stale), kept: botSessions, messages: 0 };
      } else {
        pruned = pruneOldSessions(botDb, { keepDays });
      }
    } catch {
      process.stdout.write(`ที่เก็บแชทของบอท: ไฟล์ไม่ใช่ฐานข้อมูล OpenCode (${botPath}) — ข้าม\n`);
    }
    botDb.close();

    console.log(`ที่เก็บแชทของบอท: ${botPath}`);
    console.log(`  ขนาดก่อนล้าง ${megabytes(before)} · session ทั้งหมด ${botSessions}`);
    console.log(`  ${dryRun ? 'จะลบ' : 'ลบ'} ${pruned.removed} ห้อง (เก็บไว้ ${keepDays} วัน) · เหลือ ${pruned.kept} ห้อง`);
  }

  let ownerResult = null;
  if (alsoOwner) {
    const ownerPath = ownerStorePath();
    const ownerDb = await openSqlite(ownerPath);
    if (!ownerDb) {
      console.log('  อ่านที่เก็บของเจ้าของไม่ได้ — ข้าม');
    } else {
      const ownerBefore = await fileSize(ownerPath);
      const chatSessions = ownerDb.prepare("select count(*) as n from session_v2 where agent = 'chat-replier'").get().n;
      ownerResult = dryRun
        ? { removed: Number(chatSessions), messages: 0 }
        : removeOwnerChatReplierSessions(ownerDb);
      ownerDb.close();
      console.log(`ที่เก็บของเจ้าของ: ${ownerPath}`);
      console.log(`  ${dryRun ? 'จะลบ' : 'ลบ'} ${ownerResult.removed} session ของ chat-replier (ลบข้อความ ${ownerResult.messages} รายการ)`);
      if (!dryRun) {
        console.log('  → สั่ง "opencode service restart" เพื่อให้รายการแชทในแอปเปลี่ยนตาม');
      }
    }
  }

  return { ok: true, pruned, owner: ownerResult, botPath, before };
}

if (isCli) {
  main().catch((error) => {
    process.stderr.write(`ล้างข้อมูลไม่สำเร็จ: ${error.message}\n`);
    process.exitCode = 1;
  });
}

export { DEFAULT_KEEP_DAYS };
export const BOT_STORE_ENV_NAME = BOT_DB_ENV;
export const OWNER_STORE_PATH_HINT = path.resolve('~/.local/share/opencode/opencode.db');
