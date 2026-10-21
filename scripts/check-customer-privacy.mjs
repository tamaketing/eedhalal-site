// EED HALAL — check the privacy tools (PDPA).
//
//   node scripts/check-customer-privacy.mjs
//
// Read-only: it works on a throwaway in-memory database and never touches the
// real one.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createMemoryAdapter } from '../db/memory.mjs';
import { resolveCustomer } from '../services/customers.mjs';
import { decryptBackup } from '../tools/line/backup-postgres.mjs';
import {
  blankCustomerRow,
  decryptCustomerRow,
  decryptValue,
  encryptCustomerRow,
  encryptValue,
  encryptionEnabled,
  isEncrypted,
  PII_FIELDS,
} from '../services/encryption.mjs';
import { forgetCustomer, purgeOldData } from '../tools/line/privacy.mjs';

const env = { ...process.env, EED_DATA_KEY: 'check-only-key' };
const plainEnv = { ...process.env, EED_DATA_KEY: '' };
// The services read the key from the process environment, so the check sets it
// there too (and removes it again for the "no key" case).
process.env.EED_DATA_KEY = 'check-only-key';
const checks = [];
function check(name, fn) { checks.push({ name, fn }); }

check('the identity data is encrypted at rest and readable again', () => {
  assert.equal(encryptionEnabled(env), true);
  const encrypted = encryptValue('0891234567', env);
  assert.ok(isEncrypted(encrypted));
  assert.ok(!encrypted.includes('0891234567'), 'the phone number must not be readable in the stored value');
  assert.equal(decryptValue(encrypted, env), '0891234567');
});

check('without a key nothing is encrypted and the shop keeps working', () => {
  assert.equal(encryptionEnabled(plainEnv), false);
  const value = encryptValue('0891234567', plainEnv);
  assert.equal(value, '0891234567');
  assert.equal(decryptValue(value, plainEnv), '0891234567');
});

check('a value that cannot be opened stays visible instead of vanishing', () => {
  const encrypted = encryptValue('0891234567', env);
  const other = decryptValue(encrypted, { ...env, EED_DATA_KEY: 'a-different-key' });
  assert.equal(other, encrypted, 'a wrong key must not silently empty the field');
});

check('every personal field is covered', () => {
  assert.deepEqual([...PII_FIELDS].sort(), ['address', 'companyName', 'email', 'notes', 'phone', 'taxId']);
  const row = encryptCustomerRow({
    phone: '0891234567', email: 'a@b.co', companyName: 'บริษัท', taxId: '0105558065167',
    address: '123 ถนน', notes: 'หมายเหตุ', displayName: 'ชื่อ',
  }, env);
  for (const field of PII_FIELDS) assert.ok(isEncrypted(row[field]), `${field} must be encrypted`);
  assert.equal(row.displayName, 'ชื่อ', 'the display name stays readable for the queue');
  const back = decryptCustomerRow(row, env);
  assert.equal(back.phone, '0891234567');
  assert.equal(back.taxId, '0105558065167');
});

check('the customer row is encrypted when it is stored and readable when it is read', async () => {
  const repos = createMemoryAdapter();
  const created = await resolveCustomer(repos, {
    lineUserId: 'U_CHECK_ENC', displayName: 'ทดสอบ', phone: '0891234567', taxId: '0105558065167',
  }, { type: 'SYSTEM', id: 'check' });
  assert.equal(created.phone, '0891234567', 'the caller sees the plain value');
  const raw = await repos.customers.findByLineUserId('U_CHECK_ENC');
  assert.ok(isEncrypted(raw.phone), 'the stored value is encrypted');
  assert.ok(!String(raw.phone).includes('0891234567'));
});

check('a deletion request removes the identity data and the conversation', async () => {
  const repos = createMemoryAdapter();
  const customer = await resolveCustomer(repos, {
    lineUserId: 'U_CHECK_FORGET', displayName: 'ทดสอบ', phone: '0891234567',
  }, { type: 'SYSTEM', id: 'check' });
  await repos.inboundMessages.create({
    id: 'i1', customerId: customer.id, lineUserId: 'U_CHECK_FORGET', channel: 'line',
    messageType: 'text', incomingMessage: 'เบอร์ 0891234567 ส่งที่บางนา', sourceEventId: 'e1',
    status: 'RECEIVED', retryCount: 0, revision: 0, metadata: {},
  });
  const result = await forgetCustomer(repos, env, { lineUserId: 'U_CHECK_FORGET' });
  assert.equal(result.ok, true);
  const after = await repos.customers.findByLineUserId('U_CHECK_FORGET');
  assert.equal(after.phone, null, 'the phone number is gone');
  assert.equal(after.displayName, '');
  const inbound = await repos.inboundMessages.findById('i1');
  assert.equal(inbound, null, 'the message itself is gone');
});

check('the retention period removes the conversation rows', async () => {
  const repos = createMemoryAdapter();
  const customer = await resolveCustomer(repos, { lineUserId: 'U_CHECK_PURGE', displayName: 'ทดสอบ' }, { type: 'SYSTEM', id: 'check' });
  const old = new Date(Date.now() - 900 * 24 * 60 * 60 * 1000).toISOString();
  await repos.inboundMessages.create({
    id: 'i2', customerId: customer.id, lineUserId: 'U_CHECK_PURGE', channel: 'line',
    messageType: 'text', incomingMessage: 'ข้อความเก่ามาก', sourceEventId: 'e2',
    status: 'RECEIVED', retryCount: 0, revision: 0, metadata: {}, createdAt: old, updatedAt: old,
  });
  const result = await purgeOldData(repos, { months: 24 });
  assert.equal(result.inbound, 1);
  assert.equal(await repos.inboundMessages.findById('i2'), null, 'the old message is gone');
});

check('a blanked row keeps no personal field', () => {
  const blank = blankCustomerRow({ phone: '0891234567', taxId: '1', address: 'x', notes: 'y', email: 'z', companyName: 'c', displayName: 'ชื่อ' }, env);
  assert.equal(blank.phone, null);
  assert.equal(blank.taxId, null);
  assert.equal(blank.address, null);
  assert.equal(blank.notes, null);
  assert.equal(blank.email, null);
  assert.equal(blank.companyName, null);
  assert.equal(blank.displayName, '');
});

check('a backup is encrypted and can be opened again', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'eed-backup-'));
  try {
    const file = path.join(dir, 'eedhalal.dump.enc');
    const body = Buffer.from('PGDMP fake dump with customer data', 'utf8');
    await writeFile(file, encryptValue(body.toString('base64'), env), 'utf8');
    const onDisk = await readFile(file, 'utf8');
    assert.ok(!onDisk.includes('customer data'), 'the dump must not be readable on the disk');
    const plain = await decryptBackup(file, env);
    assert.equal((await readFile(plain)).toString('utf8'), 'PGDMP fake dump with customer data');
    await rm(plain, { force: true });
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
  ? `\nCustomer privacy check: ${failed}/${checks.length} ไม่ผ่าน\n`
  : `\nCustomer privacy check: ผ่าน ${checks.length}/${checks.length}\n`);
process.exitCode = failed ? 1 : 0;
