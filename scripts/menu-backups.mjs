// Automatic pre-write backups for owner-only local data (tracked logic;
// the backup FILES live under demo/backups/, gitignored and never deployed).
//
// History: backups/ previously held MANUAL snapshots only. This module adds
// the automatic step: every server-side overwrite of menu-central.json /
// menu-central.json first copies the current bytes aside. Rotation keeps the
// newest BACKUP_KEEP files per name.
//
// LIMITATION: same-machine copies protect against bad edits and bad
// publishes, NOT against machine loss/theft. Copy backups/<date>-* off this
// machine (external drive / private storage) for disaster recovery.
// Cost/internal data must NEVER enter the public repo or deploy files.

import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const BACKUP_DIR = 'backups';
export const BACKUP_KEEP = 20;

const BACKUP_NAME = /^[0-9]{8}-[0-9]{6}(?:-[0-9]{3})?-(?:r[0-9]+-)?(?:pre-restore-)?[a-z0-9-]+\.json$/;
const BACKUP_PREFIX = /^[0-9]{8}-[0-9]{6}(?:-[0-9]{3})?-(?:r[0-9]+-)?(?:pre-restore-)?/;

// Single helper: backup filename -> live filename. Shared by the server and
// restoreBackup so a new stamp format can never desync the two again.
export function liveNameFromBackup(backupFile) {
  return String(backupFile || '').replace(BACKUP_PREFIX, '');
}

export function stamp(now = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}-${String(now.getMilliseconds()).padStart(3, '0')}`;
}

export function backupPath(dataDir, filename, now = new Date()) {
  return path.join(dataDir, BACKUP_DIR, `${stamp(now)}-${filename}`);
}

export async function listBackups(dataDir) {
  const dir = path.join(dataDir, BACKUP_DIR);
  let entries = [];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  const rows = [];
  for (const name of entries) {
    if (!BACKUP_NAME.test(name)) continue;
    try {
      const info = await stat(path.join(dir, name));
      rows.push({ file: name, size: info.size, mtime: info.mtime.toISOString() });
    } catch { /* ignore disappearing files */ }
  }
  return rows.sort((a, b) => (a.file < b.file ? 1 : -1));
}

// Copy current bytes aside BEFORE an overwrite. Returns the backup name, or
// null when there is nothing to back up yet (first write). Throws on I/O
// failure — callers must abort the overwrite then (no silent data loss).
export async function backupBeforeWrite(dataDir, filename, now = new Date()) {
  const source = path.join(dataDir, filename);
  let current;
  try {
    current = await readFile(source);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new Error(`สำรอง ${filename} ไม่สำเร็จ (${error.message}) — ยกเลิกการบันทึกเพื่อความปลอดภัย`);
  }
  const dir = path.join(dataDir, BACKUP_DIR);
  await mkdir(dir, { recursive: true });
  // Same-millisecond saves must never overwrite each other: append a sequence.
  let name = `${stamp(now)}-${filename}`;
  for (let seq = 2; seq < 1000; seq += 1) {
    try {
      await stat(path.join(dir, name));
      name = `${stamp(now)}-r${seq}-${filename}`;
    } catch {
      break;
    }
  }
  const temp = path.join(dir, `${name}.${process.pid}.tmp`);
  try {
    await writeFile(temp, current);
    await rename(temp, path.join(dir, name));
  } catch (error) {
    await unlink(temp).catch(() => {});
    throw new Error(`สำรอง ${filename} ไม่สำเร็จ (${error.message}) — ยกเลิกการบันทึกเพื่อความปลอดภัย`);
  }
  // Rotation: keep newest BACKUP_KEEP per filename.
  try {
    const rows = (await listBackups(dataDir)).filter((row) => row.file.endsWith(`-${filename}`));
    for (const extra of rows.slice(BACKUP_KEEP)) {
      await unlink(path.join(dir, extra.file)).catch(() => {});
    }
  } catch { /* rotation is best effort */ }
  return name;
}

// Restore a backup over its live file (with its own pre-restore backup).
// validate(parsed) must return {ok, errors[]} using the file's own validator.
export async function restoreBackup(dataDir, backupFile, validate) {
  if (!BACKUP_NAME.test(String(backupFile || ''))) throw new Error('ชื่อไฟล์สำรองไม่ถูกต้อง');
  const liveName = liveNameFromBackup(backupFile);
  const backupBytes = await readFile(path.join(dataDir, BACKUP_DIR, backupFile)).catch(() => null);
  if (!backupBytes) throw new Error('ไม่พบไฟล์สำรองที่ระบุ');
  let parsed;
  try {
    parsed = JSON.parse(backupBytes.toString('utf8'));
  } catch {
    throw new Error('ไฟล์สำรองไม่ใช่ JSON ที่ถูกต้อง — ไม่กู้คืน');
  }
  const checked = validate(parsed);
  if (!checked.ok) throw new Error(`ไฟล์สำรองไม่ผ่านการตรวจ: ${(checked.errors || []).join(' | ')}`);
  const preRestore = await backupBeforeWrite(dataDir, liveName).catch(() => null);
  // Restore byte-identical (keeps version/updatedAt continuity for staleness
  // detection); the bytes just passed validation above.
  const livePath = path.join(dataDir, liveName);
  const temp = `${livePath}.${process.pid}.tmp`;
  await writeFile(temp, backupBytes);
  await rename(temp, livePath);
  return { ok: true, restored: liveName, from: backupFile, preRestore };
}
