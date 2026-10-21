// EED HALAL — a private OpenCode store for the LINE bot.
//
// WHY THIS EXISTS
// tools/agent/line-chat.mjs spawns `opencode run` once per inbound LINE
// message so the chat-replier agent can draft an answer. Every `opencode run`
// creates a session in the shared OpenCode database, and the session title is
// the customer's own message — so every customer conversation showed up in the
// owner's OpenCode desktop chat list, and customer text (phone number, tax id,
// address) landed in the owner's session store next to the owner's own work.
//
// THE FIX
// Give the bot its own OpenCode database (OPENCODE_DB) and its own server
// (--standalone). The clone keeps the provider credential and the model
// catalogue so the bot can still answer, but it starts with ZERO sessions, so
// no customer text is ever carried over and none of it reaches the owner's
// desktop list.
//
// SAFETY
// - The owner's database is only ever READ (cloned). Nothing in this module
//   writes to it.
// - The bot database lives in data/line-runtime/ which is gitignored.
// - If the store cannot be prepared, the caller keeps the old behaviour
//   (shared store) instead of breaking the bot.

import { existsSync } from 'node:fs';
import { copyFile, mkdir, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** Env var that points the bot at its own OpenCode database. */
export const BOT_DB_ENV = 'EED_BOT_OPENCODE_DB';
/** Env var that overrides where the owner's OpenCode database lives. */
export const OWNER_DB_ENV = 'EED_OWNER_OPENCODE_DB';

/** Session tables that must be empty in a fresh bot store. */
const SESSION_TABLES = ['session_message', 'session_v2', 'session_pending', 'session_inbox'];

const DAY_MS = 24 * 60 * 60 * 1000;

/** Where the owner's OpenCode CLI keeps its database. */
export function ownerStorePath(env = process.env) {
  const override = env[OWNER_DB_ENV];
  if (override && String(override).trim()) return path.resolve(String(override).trim());
  return path.join(os.homedir(), '.local', 'share', 'opencode', 'opencode.db');
}

/** Where the bot's private OpenCode database lives. */
export function botStorePath(env = process.env) {
  const override = env[BOT_DB_ENV];
  if (override && String(override).trim()) return path.resolve(String(override).trim());
  return path.join(ROOT, 'data', 'line-runtime', 'opencode-bot.db');
}

/**
 * node:sqlite is built in from Node 22.5 but needs --experimental-sqlite on
 * Node 22, and Node 24 loads it without a flag. Import it dynamically so a
 * missing flag never breaks the bot — the caller falls back to a file copy.
 */
export async function openSqlite(dbPath) {
  let DatabaseSync;
  try {
    ({ DatabaseSync } = await import('node:sqlite'));
  } catch {
    return null;
  }
  try {
    return new DatabaseSync(dbPath);
  } catch {
    return null;
  }
}

/** Session ids the bot store keeps — everything else is history to prune. */
function sessionRows(db) {
  return db.prepare('select id, agent, title, time_created from session_v2').all();
}

/**
 * Remove every session (and its messages) from a database.
 * @returns {{sessions:number, messages:number}}
 */
export function wipeSessions(db) {
  const sessions = db.prepare('select count(*) as n from session_v2').get().n;
  const messages = db.prepare('select count(*) as n from session_message').get().n;
  for (const table of SESSION_TABLES) {
    try {
      db.exec(`delete from "${table}"`);
    } catch {
      // A table that this opencode build does not have is not an error.
    }
  }
  return { sessions: Number(sessions), messages: Number(messages) };
}

/**
 * Delete sessions older than `keepDays` (and their messages).
 * @returns {{removed:number, kept:number}}
 */
export function pruneOldSessions(db, { keepDays = 7, now = Date.now() } = {}) {
  const cutoff = now - Math.max(0, Number(keepDays) || 0) * DAY_MS;
  const stale = sessionRows(db).filter((row) => Number(row.time_created || 0) < cutoff);
  let messages = 0;
  for (const row of stale) {
    try {
      messages += db.prepare('delete from session_message where session_id = ?').run(row.id).changes;
      db.prepare('delete from session_inbox where session_id = ?').run(row.id);
      db.prepare('delete from session_pending where session_id = ?').run(row.id);
      db.prepare('delete from session_v2 where id = ?').run(row.id);
    } catch {
      // Keep going: one broken row must not stop the cleanup.
    }
  }
  const kept = sessionRows(db).length;
  return { removed: stale.length, kept, messages };
}

/**
 * Delete the bot's own chat-replier sessions from the OWNER's database.
 * Explicit opt-in only (the owner asked for it): never called by the launcher.
 * @returns {{removed:number, messages:number}}
 */
export function removeOwnerChatReplierSessions(db, { agent = 'chat-replier' } = {}) {
  const rows = sessionRows(db).filter((row) => row.agent === agent);
  let messages = 0;
  for (const row of rows) {
    try {
      messages += db.prepare('delete from session_message where session_id = ?').run(row.id).changes;
      db.prepare('delete from session_inbox where session_id = ?').run(row.id);
      db.prepare('delete from session_pending where session_id = ?').run(row.id);
      db.prepare('delete from session_v2 where id = ?').run(row.id);
    } catch {
      // Ignore a row we cannot delete.
    }
  }
  return { removed: rows.length, messages };
}

/** Copy the SQLite file (and its WAL side files) when node:sqlite is absent. */
async function copyStoreFiles(source, target) {
  await mkdir(path.dirname(target), { recursive: true });
  await rm(target, { force: true });
  await rm(`${target}-wal`, { force: true });
  await rm(`${target}-shm`, { force: true });
  await copyFile(source, target);
  for (const suffix of ['-wal', '-shm']) {
    const side = `${source}${suffix}`;
    if (existsSync(side)) await copyFile(side, `${target}${suffix}`);
  }
}

/** True when the file is a usable OpenCode store (it has the session table). */
async function isUsableStore(dbPath) {
  const db = await openSqlite(dbPath);
  if (!db) return false;
  try {
    db.prepare('select count(*) as n from session_v2').get();
    return true;
  } catch {
    return false;
  } finally {
    db.close();
  }
}

/**
 * Prepare the bot's private OpenCode store.
 *
 * - Missing store  -> clone the owner's store, then wipe every session.
 * - Existing store -> leave it alone (the bot keeps its own history).
 *
 * @returns {{ok:boolean, created:boolean, path:string, reason?:string,
 *            sessions?:number, messages?:number}}
 */
export async function prepareBotStore({ source = ownerStorePath(), target = botStorePath() } = {}) {
  if (!existsSync(source)) {
    return { ok: false, created: false, path: target, reason: 'ไม่พบฐานข้อมูล OpenCode ของเจ้าของ' };
  }
  if (existsSync(target)) {
    if (await isUsableStore(target)) {
      return { ok: true, created: false, path: target };
    }
    // An empty or foreign file (a crashed run, a stray copy): start over
    // rather than let the bot open a database without the credential.
    await rm(target, { force: true });
    await rm(`${target}-wal`, { force: true });
    await rm(`${target}-shm`, { force: true });
  }

  const db = await openSqlite(source);
  if (db) {
    try {
      // VACUUM INTO writes a clean, self-contained copy (no WAL side files).
      db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
    } catch (error) {
      db.close();
      return { ok: false, created: false, path: target, reason: `คัดลอกฐานข้อมูลไม่สำเร็จ: ${error.message}` };
    }
    const targetDb = await openSqlite(target);
    let wiped = { sessions: 0, messages: 0 };
    if (targetDb) {
      try {
        wiped = wipeSessions(targetDb);
        // The clone carries the whole file size; VACUUM gives the space back
        // instead of leaving a 100 MB store behind for a chat-only database.
        targetDb.exec('VACUUM');
      } catch {
        // A store that cannot be compacted still works.
      } finally {
        targetDb.close();
      }
    }
    db.close();
    return { ok: true, created: true, path: target, ...wiped };
  }

  // node:sqlite is unavailable (Node 22 without the flag): fall back to a file
  // copy. The bot store then starts with the owner's old sessions inside it —
  // harmless for the owner (different file) but not clean, so say so.
  try {
    await copyStoreFiles(source, target);
    return { ok: true, created: true, path: target, sessions: 0, messages: 0, copied: true };
  } catch (error) {
    return { ok: false, created: false, path: target, reason: `คัดลอกฐานข้อมูลไม่สำเร็จ: ${error.message}` };
  }
}

/**
 * Environment for the bot's `opencode run` child process.
 * Returns {} when the bot store is missing, so the caller keeps the old
 * (shared store) behaviour instead of pointing at a database without
 * credentials.
 */
export function botStoreEnv({ env = process.env, dbPath = botStorePath(env) } = {}) {
  if (!env[BOT_DB_ENV]) return {};
  if (!existsSync(dbPath)) return {};
  return { OPENCODE_DB: dbPath };
}

/** Size of a file in bytes, or 0 when it does not exist. */
export async function fileSize(filePath) {
  try {
    const info = await stat(filePath);
    return info.size;
  } catch {
    return 0;
  }
}

/**
 * Give the space back after the old sessions were removed.
 *
 * Deleting rows does not shrink a SQLite file, so without this the bot store
 * would keep the size of every conversation it ever had.
 */
export async function compactBotStore(dbPath) {
  const db = await openSqlite(dbPath);
  if (!db) return { compacted: false };
  try {
    const before = (await fileSize(dbPath));
    db.exec('VACUUM');
    const after = (await fileSize(dbPath));
    return { compacted: true, before, after };
  } catch {
    return { compacted: false };
  } finally {
    db.close();
  }
}

export { DAY_MS, SESSION_TABLES };
