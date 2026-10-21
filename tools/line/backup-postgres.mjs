// EED HALAL — encrypted backup of the customer database.
//
//   node tools/line/backup-postgres.mjs                 backup now
//   node tools/line/backup-postgres.mjs --keep 30       keep 30 days (default)
//   node tools/line/backup-postgres.mjs --dest "C:\Users\me\My Drive\EED HALAL"
//                                                        write straight into the
//                                                        Google Drive folder
//
// WHY ENCRYPTED: the dump contains every customer's name, phone number and
// conversation. A backup that sits on a cloud drive must not be readable by
// anyone who gets the file, so the dump is encrypted with AES-256-GCM before
// it leaves the machine.
//
// HOW IT REACHES GOOGLE DRIVE: the simplest way on Windows is the Google
// Drive for Desktop app — the backup is written into the synced folder and
// the app uploads it. With rclone installed the script can also push it
// itself (see the note it prints).
import { execFile } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, stat, unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { decryptValue, encryptValue, encryptionEnabled } from '../../services/encryption.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const isCli = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
const DAY = 24 * 60 * 60 * 1000;

const PG_BIN = process.env.EED_PG_BIN || 'C:/Program Files/PostgreSQL/17/bin';

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

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { windowsHide: true, maxBuffer: 32 * 1024 * 1024, ...options }, (error, stdout, stderr) => {
      if (error) reject(new Error(`${command} ${args.join(' ')} -> ${error.message}${stderr ? `: ${String(stderr).slice(0, 300)}` : ''}`));
      else resolve({ stdout, stderr });
    });
  });
}

/** The database URL without the password, for pg_dump. */
function dumpTarget(url) {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: parsed.port || '5432',
    user: decodeURIComponent(parsed.username),
    database: decodeURIComponent(parsed.pathname.replace(/^\//, '')),
  };
}

/** The password of a postgres URL, for PGPASSWORD. */
function passwordOf(url) {
  return decodeURIComponent(new URL(url).password || '');
}

/**
 * The cloud folder that syncs itself, if the machine has one.
 *
 * Only Google Drive is detected automatically: the "My Drive" / "Google Drive"
 * folder exists ONLY when Google Drive for Desktop is installed and signed
 * in, so its presence is proof that the folder really syncs. OneDrive is not
 * detected automatically because the folder can exist without the app being
 * signed in — that would look like a backup "in the cloud" while staying on
 * the machine. Point at it with --dest when it is set up.
 */
export function findCloudFolder(home = os.homedir()) {
  const candidates = [
    path.join(home, 'My Drive', 'EED HALAL'),
    path.join(home, 'My Drive'),
    path.join(home, 'Google Drive', 'EED HALAL'),
    path.join(home, 'Google Drive'),
  ];
  for (const dir of candidates) {
    try {
      if (!existsSync(dir)) continue;
      if (!readdirSync(dir).length) continue; // not signed in / still empty
      return dir;
    } catch {
      // Not readable: try the next one.
    }
  }
  return null;
}

export async function main(argv = process.argv.slice(2)) {
  const env = await loadEnv();
  if (!env.DATABASE_URL) throw new Error('ต้องมี DATABASE_URL (ดู data/line-runtime/runtime.env)');
  // The dump needs the owner role: the runtime role may not lock the tables.
  const source = env.EED_MIGRATOR_DATABASE_URL || env.DATABASE_URL;
  if (!encryptionEnabled(env)) {
    throw new Error('ยังไม่ได้ตั้ง EED_DATA_KEY — สำรองแบบไม่เข้ารหัสไม่ได้ (สำรองข้อมูลลูกค้าที่อ่านได้ทันทีคืออันตราย)');
  }
  const keepDays = Number(argv[argv.indexOf('--keep') + 1]) || 30;
  const destIndex = argv.indexOf('--dest');
  const cloud = findCloudFolder();
  const dest = destIndex !== -1 && argv[destIndex + 1] && !argv[destIndex + 1].startsWith('--')
    ? path.resolve(argv[destIndex + 1])
    : (cloud || path.join(ROOT, 'data', 'line-runtime', 'backups'));
  await mkdir(dest, { recursive: true });

  const target = dumpTarget(source);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const raw = path.join(dest, `eedhalal-${stamp}.dump`);
  const sealed = `${raw}.enc`;

  // 1. Dump. PGPASSWORD is passed through the environment, never on the
  //    command line, so it cannot show up in a process list.
  await run(path.join(PG_BIN, 'pg_dump.exe'), [
    '-h', target.host, '-p', target.port, '-U', target.user, '-d', target.database,
    '-Fc', '--no-owner', '--no-acl', '-f', raw,
  ], { env: { ...process.env, PGPASSWORD: passwordOf(source) } });

  const size = (await stat(raw)).size;
  // 2. Encrypt: the dump becomes one encrypted file, and the plain dump is
  //    destroyed right away.
  const body = await readFile(raw);
  const encrypted = encryptValue(body.toString('base64'), env);
  await (await import('node:fs/promises')).writeFile(sealed, encrypted, 'utf8');
  await rm(raw, { force: true });

  // 3. Keep the folder small: the backups older than the period are removed.
  let removed = 0;
  const files = await readdir(dest);
  for (const file of files) {
    if (!file.endsWith('.dump.enc')) continue;
    const full = path.join(dest, file);
    const age = (Date.now() - (await stat(full)).mtimeMs) / DAY;
    if (age > keepDays) {
      await rm(full, { force: true });
      removed += 1;
    }
  }

  console.log(`สำรองแล้ว: ${sealed}`);
  console.log(`  ขนาด ${(size / 1024 / 1024).toFixed(2)} MB (เข้ารหัสแล้ว) · เก็บไว้ ${keepDays} วัน · ลบเก่า ${removed} ไฟล์`);
  if (cloud) {
    console.log(`  อยู่ในโฟลเดอร์ที่ซิงก์อัตโนมัติ: ${cloud} — ไฟล์จะถูกอัปโหลดเอง`);
  } else {
    console.log('  ยังไม่มีโฟลเดอร์ที่ซิงก์อัตโนมัติ (Google Drive / OneDrive) — ไฟล์ยังอยู่บนเครื่องนี้เท่านั้น');
    console.log('  วิธีสำรองออกนอกเครื่อง: ติดตั้ง Google Drive for Desktop แล้วรันอีกครั้ง (ระบบจะเลือกโฟลเดอร์ให้เอง) หรือสั่ง --dest "<โฟลเดอร์ My Drive>"');
  }
  return { ok: true, file: sealed, size, removed, dest, cloud };
}

/** Open a backup for a restore: decrypt it into a plain dump file. */
export async function decryptBackup(file, env) {
  const encrypted = await readFile(file, 'utf8');
  const plain = decryptValue(encrypted, env);
  if (plain === encrypted) throw new Error('เปิดไฟล์สำรองไม่ได้ (กุญแจไม่ตรง หรือไฟล์เสีย)');
  const out = file.replace(/\.enc$/, '');
  await (await import('node:fs/promises')).writeFile(out, Buffer.from(plain, 'base64'));
  return out;
}

if (isCli) {
  main().catch((error) => {
    process.stderr.write(`สำรองไม่สำเร็จ: ${error.message}\n`);
    process.exitCode = 1;
  });
}
