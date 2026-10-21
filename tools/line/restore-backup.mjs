// EED HALAL — restore the customer database from an encrypted backup.
//
//   node tools/line/restore-backup.mjs --file <backup.dump.enc> --dry-run
//   node tools/line/restore-backup.mjs --file <backup.dump.enc> --yes
//
// The restore REPLACES the current database. The current one is dumped first,
// so a wrong restore can be undone.
import { execFile } from 'node:child_process';
import { readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { decryptBackup } from './backup-postgres.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const isCli = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
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
      if (error) reject(new Error(`${command} -> ${error.message}${stderr ? `: ${String(stderr).slice(0, 400)}` : ''}`));
      else resolve({ stdout, stderr });
    });
  });
}

export async function main(argv = process.argv.slice(2)) {
  const env = await loadEnv();
  if (!env.DATABASE_URL) throw new Error('ต้องมี DATABASE_URL (ดู data/line-runtime/runtime.env)');
  const fileIndex = argv.indexOf('--file');
  const file = fileIndex !== -1 ? argv[fileIndex + 1] : null;
  if (!file) throw new Error('ต้องใส่ --file <ไฟล์สำรอง.dump.enc>');
  const dryRun = argv.includes('--dry-run');
  const confirmed = argv.includes('--yes');

  const size = (await stat(file)).size;
  console.log(`ไฟล์สำรอง: ${file} (${(size / 1024 / 1024).toFixed(2)} MB)`);
  const plain = await decryptBackup(path.resolve(file), env);
  console.log(`ถอดรหัสแล้ว: ${plain}`);
  try {
    if (dryRun) {
      console.log('โหมดทดลอง — ยังไม่ได้กู้คืนจริง (เพิ่ม --yes เพื่อทำจริง)');
      return { ok: true, dryRun: true };
    }
    if (!confirmed) {
      console.log('ยังไม่ได้กู้คืน — เพิ่ม --yes เพื่อยืนยัน (ข้อมูลปัจจุบันจะถูกแทนที่)');
      return { ok: false };
    }

    const url = new URL(env.DATABASE_URL);
    const target = {
      host: url.hostname,
      port: url.port || '5432',
      user: decodeURIComponent(url.username),
      database: decodeURIComponent(url.pathname.replace(/^\//, '')),
    };
    const password = decodeURIComponent(url.password || '');
    // The current state is dumped first, so a wrong restore can be undone.
    const safety = path.join(ROOT, 'data', 'line-runtime', 'backups', `before-restore-${Date.now()}.dump`);
    await run(path.join(PG_BIN, 'pg_dump.exe'), [
      '-h', target.host, '-p', target.port, '-U', target.user, '-d', target.database,
      '-Fc', '--no-owner', '--no-acl', '-f', safety,
    ], { env: { ...process.env, PGPASSWORD: password } });
    console.log(`สำรองของเดิมไว้ที่: ${safety}`);

    await run(path.join(PG_BIN, 'pg_restore.exe'), [
      '-h', target.host, '-p', target.port, '-U', target.user, '-d', target.database,
      '--clean', '--if-exists', '--no-owner', '--no-acl', plain,
    ], { env: { ...process.env, PGPASSWORD: password } });
    console.log('กู้คืนเรียบร้อย');
    return { ok: true, safety, plain };
  } finally {
    // The plain dump holds every customer's data in the clear: it must not
    // stay on the disk, not even for a minute.
    await rm(plain, { force: true });
  }
}

if (isCli) {
  main().catch((error) => {
    process.stderr.write(`กู้คืนไม่สำเร็จ: ${error.message}\n`);
    process.exitCode = 1;
  });
}
