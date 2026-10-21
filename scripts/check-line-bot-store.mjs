// EED HALAL — check that the LINE bot keeps its OpenCode sessions to itself.
//
// Why this check exists: tools/agent/line-chat.mjs spawns `opencode run`
// once per inbound LINE message. Without a private store, every customer
// message opened a session in the OWNER's OpenCode database, so customer
// conversations appeared in the owner's desktop chat list and customer text
// (phone, tax id, address) landed in the owner's own store.
//
//   node scripts/check-line-bot-store.mjs
//
// Exit code 0 = pass, 1 = fail. Read-only: it never touches the owner's
// OpenCode database and never starts the bot.
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { agentRunArgs, CHAT_AGENT, CHAT_MODEL } from '../tools/agent/line-chat.mjs';
import {
  BOT_DB_ENV,
  botStoreEnv,
  botStorePath,
  openSqlite,
  ownerStorePath,
  pruneOldSessions,
  removeOwnerChatReplierSessions,
  wipeSessions,
} from '../tools/line/bot-store.mjs';

const DAY = 24 * 60 * 60 * 1000;
const checks = [];

function check(name, fn) {
  checks.push({ name, fn });
}

check('the bot opens its own server only when a private store is prepared', () => {
  const shared = agentRunArgs({ isolated: false });
  assert.deepEqual(shared, ['run', '--agent', CHAT_AGENT, '--model', CHAT_MODEL]);
  assert.ok(!shared.includes('--standalone'), 'the shared path must not start a private server');

  const isolated = agentRunArgs({ isolated: true });
  assert.ok(isolated.includes('--standalone'), 'an isolated run needs its own server');
  assert.ok(isolated.indexOf('--standalone') < isolated.indexOf('--agent'));
});

check('the bot only points at the private store when that file exists', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'eed-bot-store-'));
  try {
    const dbPath = path.join(dir, 'opencode-bot.db');
    assert.deepEqual(botStoreEnv({ env: {}, dbPath }), {}, 'no env var means no isolation');
    assert.deepEqual(botStoreEnv({ env: { [BOT_DB_ENV]: dbPath }, dbPath }), {}, 'a missing file means no isolation');
    await writeFile(dbPath, 'not-a-real-db', 'utf8');
    assert.deepEqual(
      botStoreEnv({ env: { [BOT_DB_ENV]: dbPath }, dbPath }),
      { OPENCODE_DB: dbPath },
      'a prepared store is passed to the child process',
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

check('the owner store and the bot store are never the same file', () => {
  const owner = ownerStorePath({});
  const bot = botStorePath({});
  assert.notEqual(owner, bot, 'the bot must not write into the owner database');
  assert.ok(bot.includes(path.join('data', 'line-runtime')), 'the bot store belongs to the gitignored runtime folder');
});

check('a fresh bot store keeps no customer session', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'eed-bot-store-'));
  try {
    const db = await openSqlite(path.join(dir, 'opencode-bot.db'));
    if (!db) {
      process.stdout.write('    (ข้าม: node:sqlite ไม่พร้อมใช้งานบน Node นี้)\n');
      return;
    }
    db.exec('create table session_v2 (id text primary key, agent text, title text, time_created integer)');
    db.exec('create table session_message (id text primary key, session_id text, type text, seq integer, time_created integer, time_updated integer, data text)');
    db.exec('create table session_inbox (id text primary key, session_id text)');
    db.exec('create table session_pending (id text primary key, session_id text)');
    db.exec("insert into session_v2 values ('s1', 'chat-replier', 'จัดส่งข้าวกล่อง BITEC', 1)");
    db.exec("insert into session_message values ('m1', 's1', 'user', 1, 1, 1, '{}')");

    const wiped = wipeSessions(db);
    assert.equal(wiped.sessions, 1);
    assert.equal(wiped.messages, 1);
    assert.equal(db.prepare('select count(*) as n from session_v2').get().n, 0);
    assert.equal(db.prepare('select count(*) as n from session_message').get().n, 0);
    db.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

check('old bot sessions are pruned and recent ones are kept', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'eed-bot-store-'));
  try {
    const db = await openSqlite(path.join(dir, 'opencode-bot.db'));
    if (!db) {
      process.stdout.write('    (ข้าม: node:sqlite ไม่พร้อมใช้งานบน Node นี้)\n');
      return;
    }
    db.exec('create table session_v2 (id text primary key, agent text, title text, time_created integer)');
    db.exec('create table session_message (id text primary key, session_id text, type text, seq integer, time_created integer, time_updated integer, data text)');
    db.exec('create table session_inbox (id text primary key, session_id text)');
    db.exec('create table session_pending (id text primary key, session_id text)');
    const now = Date.now();
    db.exec(`insert into session_v2 values ('old', 'chat-replier', 'เก่า', ${now - 30 * DAY})`);
    db.exec(`insert into session_v2 values ('new', 'chat-replier', 'ใหม่', ${now - 1 * DAY})`);
    db.exec("insert into session_message values ('m1', 'old', 'user', 1, 1, 1, '{}')");

    const pruned = pruneOldSessions(db, { keepDays: 7, now });
    assert.equal(pruned.removed, 1);
    assert.equal(pruned.kept, 1);
    assert.equal(db.prepare('select count(*) as n from session_message').get().n, 0);
    assert.equal(db.prepare('select id from session_v2').get().id, 'new');
    db.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

check('the owner cleanup removes chat-replier sessions only', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'eed-owner-store-'));
  try {
    const db = await openSqlite(path.join(dir, 'opencode.db'));
    if (!db) {
      process.stdout.write('    (ข้าม: node:sqlite ไม่พร้อมใช้งานบน Node นี้)\n');
      return;
    }
    db.exec('create table session_v2 (id text primary key, agent text, title text, time_created integer)');
    db.exec('create table session_message (id text primary key, session_id text, type text, seq integer, time_created integer, time_updated integer, data text)');
    db.exec('create table session_inbox (id text primary key, session_id text)');
    db.exec('create table session_pending (id text primary key, session_id text)');
    db.exec("insert into session_v2 values ('bot1', 'chat-replier', 'ข้อความลูกค้า', 1)");
    db.exec("insert into session_v2 values ('own1', 'build', 'งานของเจ้าของ', 1)");
    db.exec("insert into session_message values ('m1', 'bot1', 'user', 1, 1, 1, '{}')");

    const result = removeOwnerChatReplierSessions(db);
    assert.equal(result.removed, 1);
    assert.equal(result.messages, 1);
    const left = db.prepare('select id from session_v2').all().map((row) => row.id);
    assert.deepEqual(left, ['own1'], "the owner's own sessions must survive");
    db.close();
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
  ? `\nLINE bot store check: ${failed}/${checks.length} ไม่ผ่าน\n`
  : `\nLINE bot store check: ผ่าน ${checks.length}/${checks.length}\n`);
process.exitCode = failed ? 1 : 0;
