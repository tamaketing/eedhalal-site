// EED HALAL — PDPA tools for the customer data.
//
// Three jobs, all for the personal data of the shop's customers:
//
//   node tools/line/privacy.mjs encrypt      encrypt the PII that is already
//                                             stored in plain text
//   node tools/line/privacy.mjs purge        delete data that is older than
//                                             the retention period
//   node tools/line/privacy.mjs forget       erase one customer on request
//                                             (PDPA right to erasure)
//
//   node tools/line/privacy.mjs encrypt --dry-run
//   node tools/line/privacy.mjs purge --months 24 --dry-run
//   node tools/line/privacy.mjs forget --line-user-id Uxxxx --yes
//
// The rules:
// - The identity data (phone, email, company, tax id, address, notes) is
//   encrypted at rest with EED_DATA_KEY.
// - The conversation text is kept for the retention period and then removed.
// - The audit trail stays: it records THAT something happened, never the
//   personal data itself.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createAdapter } from '../../db/index.mjs';
import { blankCustomerRow, decryptCustomerRow, encryptCustomerRow, encryptionEnabled, PII_FIELDS } from '../../services/encryption.mjs';
import { recordAudit } from '../../services/audit.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const isCli = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

const DAY = 24 * 60 * 60 * 1000;

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

function flag(argv, name, fallback = null) {
  const index = argv.indexOf(name);
  if (index === -1) return fallback;
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('--')) return true;
  return value;
}

/** Encrypt the identity data that is still stored in plain text. */
export async function encryptExisting(repos, env, { dryRun = false } = {}) {
  const rows = await repos.customers.list();
  let changed = 0;
  for (const row of rows) {
    const plain = decryptCustomerRow(row, env);
    const needs = PII_FIELDS.some((field) => plain[field] && plain[field] !== row[field]);
    if (!needs) continue;
    changed += 1;
    if (dryRun) {
      console.log(`- จะเข้ารหัส: ${plain.displayName || plain.lineUserId || row.id}`);
      continue;
    }
    await repos.customers.update(row.id, encryptCustomerRow(plain, env));
    await repos.transaction(async (tx) => {
      await recordAudit(tx, {
        entityType: 'customer', entityId: row.id, action: 'CUSTOMER_PII_ENCRYPTED',
        actorType: 'SYSTEM', actorId: 'privacy',
        beforeData: null, afterData: { fields: PII_FIELDS },
      });
    });
    console.log(`- เข้ารหัสแล้ว: ${plain.displayName || plain.lineUserId || row.id}`);
  }
  return { changed, total: rows.length };
}

/** Delete the conversation data that is older than the retention period. */
export async function purgeOldData(repos, { months = 24, dryRun = false } = {}) {
  const cutoff = new Date(Date.now() - months * 30 * DAY).toISOString();
  const inbound = await repos.inboundMessages.list();
  const oldInbound = inbound.filter((row) => String(row.createdAt || '') < cutoff);
  const drafts = await repos.drafts.list();
  const oldDrafts = drafts.filter((row) => String(row.createdAt || '') < cutoff);
  if (!dryRun) {
    // The rows are removed, not blanked: the message text IS the personal
    // data, and a redacted line would still be a line of the conversation.
    for (const row of oldInbound) await repos.inboundMessages.remove(row.id);
    for (const row of oldDrafts) await repos.drafts.remove(row.id);
  }
  console.log(`${dryRun ? 'จะลบ' : 'ลบ'}ข้อความเข้า ${oldInbound.length} รายการ · draft ${oldDrafts.length} รายการ (เก่ากว่า ${months} เดือน)`);
  return { inbound: oldInbound.length, drafts: oldDrafts.length, cutoff };
}

/** Erase one customer: the identity data AND the conversation text. */
export async function forgetCustomer(repos, env, { lineUserId, dryRun = false } = {}) {
  const customers = await repos.customers.list();
  const customer = customers.find((row) => row.lineUserId === lineUserId);
  if (!customer) throw new Error(`ไม่พบลูกค้าที่ LINE id นี้: ${lineUserId}`);
  const plain = decryptCustomerRow(customer, env);
  const inbound = await repos.inboundMessages.list();
  const drafts = await repos.drafts.list();
  const mine = (rows) => rows.filter((row) => row.customerId === customer.id);
  if (dryRun) {
    console.log(`จะลบข้อมูลลูกค้า ${plain.displayName || lineUserId}: ข้อความ ${mine(inbound).length} · draft ${mine(drafts).length} · lead ${(await repos.leads.listByCustomer(customer.id)).length}`);
    return { ok: true, dryRun: true };
  }
  for (const row of mine(inbound)) {
    await repos.inboundMessages.remove(row.id);
  }
  for (const row of mine(drafts)) {
    await repos.drafts.remove(row.id);
  }
  const memory = await repos.customerMemories.findByCustomerId(customer.id);
  if (memory) {
    await repos.customerMemories.update(memory.id, { summary: '', facts: {}, history: [], status: 'CLOSED' });
  }
  await repos.customers.update(customer.id, blankCustomerRow(plain, env));
  await repos.transaction(async (tx) => {
    await recordAudit(tx, {
      entityType: 'customer', entityId: customer.id, action: 'CUSTOMER_DATA_FORGOTTEN',
      actorType: 'OWNER', actorId: 'owner',
      beforeData: null, afterData: { lineUserId, messages: mine(inbound).length, drafts: mine(drafts).length },
    });
  });
  console.log(`ลบข้อมูลลูกค้าคนนี้แล้ว: ข้อความ ${mine(inbound).length} · draft ${mine(drafts).length} (audit trail ยังอยู่)`);
  return { ok: true, customerId: customer.id };
}

export async function main(argv = process.argv.slice(2)) {
  const command = argv.find((arg) => !arg.startsWith('-')) || 'encrypt';
  const dryRun = argv.includes('--dry-run');
  const env = await loadEnv();
  if (!env.DATABASE_URL) throw new Error('ต้องมี DATABASE_URL (ดู data/line-runtime/runtime.env)');
  const repos = createAdapter({ ...env, DB_ADAPTER: 'postgres' });
  try {
    if (command === 'encrypt') {
      if (!encryptionEnabled(env)) {
        console.log('ยังไม่ได้ตั้ง EED_DATA_KEY — ข้อมูลยังเก็บเป็นข้อความธรรมดา');
        return { ok: false };
      }
      const result = await encryptExisting(repos, env, { dryRun });
      console.log(`\n${dryRun ? 'จะเข้ารหัส' : 'เข้ารหัส'} ${result.changed} จาก ${result.total} คน`);
      return { ok: true, ...result };
    }
    if (command === 'purge') {
      const months = Number(flag(argv, '--months', 24)) || 24;
      return { ok: true, ...(await purgeOldData(repos, { months, dryRun })) };
    }
    if (command === 'forget') {
      const lineUserId = flag(argv, '--line-user-id');
      if (!lineUserId || lineUserId === true) throw new Error('ต้องใส่ --line-user-id Uxxxx');
      if (!argv.includes('--yes') && !dryRun) {
        console.log('ยังไม่ได้ลบ — เพิ่ม --yes เพื่อยืนยัน');
        return { ok: false };
      }
      return await forgetCustomer(repos, env, { lineUserId: String(lineUserId), dryRun });
    }
    throw new Error(`ไม่รู้จักคำสั่ง "${command}" — ใช้ได้แค่: encrypt, purge, forget`);
  } finally {
    await repos.close();
  }
}

if (isCli) {
  main().catch((error) => {
    process.stderr.write(`ทำงานไม่สำเร็จ: ${error.message}\n`);
    process.exitCode = 1;
  });
}
