// EED HALAL — automatic backup + restore tests (temp dirs only).
//
// Regression coverage for the millis-stamp collision: two backups in the same
// second must never overwrite each other, and restore must resolve the live
// filename through the single shared helper (server and restoreBackup use the
// same liveNameFromBackup).

import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  backupBeforeWrite,
  listBackups,
  liveNameFromBackup,
  restoreBackup,
} from '../scripts/menu-backups.mjs';

async function seedFile(dataDir, name, payload) {
  const { mkdir } = await import('node:fs/promises');
  await mkdir(dataDir, { recursive: true });
  await writeFile(path.join(dataDir, name), JSON.stringify(payload), 'utf8');
}

const validateCentralShape = (raw) => (raw && Array.isArray(raw.menus)
  ? { ok: true, errors: [] }
  : { ok: false, errors: ['not central'] });

test('liveNameFromBackup resolves every stamp format (single helper)', () => {
  assert.equal(liveNameFromBackup('20260927-065539-482-menu-central.json'), 'menu-central.json');
  assert.equal(liveNameFromBackup('20260927-065502-menu-central.json'), 'menu-central.json');
  assert.equal(liveNameFromBackup('20260927-065612-560-pre-restore-owner-costs.json'), 'owner-costs.json');
  assert.equal(liveNameFromBackup('whatever.json'), 'whatever.json');
});

test('two backups in the same millisecond never collide', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'eed-backup-test-'));
  await seedFile(dataDir, 'menu-central.json', { version: 1, menus: [] });
  const fixed = new Date('2026-09-27T06:55:39.482Z');
  const first = await backupBeforeWrite(dataDir, 'menu-central.json', fixed);
  const second = await backupBeforeWrite(dataDir, 'menu-central.json', fixed);
  assert.ok(first);
  assert.ok(second);
  assert.notEqual(first, second);
  const rows = await listBackups(dataDir);
  assert.equal(rows.length, 2);
});

test('restore round-trip is byte-identical and keeps version continuity', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'eed-backup-test-'));
  const v4 = { version: 4, updatedAt: '2026-09-26T00:00:00.000Z', menus: [{ id: 1 }] };
  await seedFile(dataDir, 'menu-central.json', v4);
  const name = await backupBeforeWrite(dataDir, 'menu-central.json');
  await seedFile(dataDir, 'menu-central.json', { version: 5, updatedAt: 'now', menus: [{ id: 1 }, { id: 2 }] });
  const result = await restoreBackup(dataDir, name, validateCentralShape);
  assert.equal(result.ok, true);
  assert.equal(result.restored, 'menu-central.json');
  assert.ok(result.preRestore, 'pre-restore backup of the current version is kept');
  assert.deepEqual(JSON.parse(await readFile(path.join(dataDir, 'menu-central.json'), 'utf8')), v4);
});

test('restore rejects bad names, missing files, and invalid content', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'eed-backup-test-'));
  await seedFile(dataDir, 'menu-central.json', { version: 1, menus: [] });
  await assert.rejects(() => restoreBackup(dataDir, '../../evil.json', validateCentralShape), /ไม่ถูกต้อง/);
  await assert.rejects(() => restoreBackup(dataDir, '20260927-000000-000-menu-central.json', validateCentralShape), /ไม่พบ/);
  const { mkdir, writeFile: write } = await import('node:fs/promises');
  await mkdir(path.join(dataDir, 'backups'), { recursive: true });
  await write(path.join(dataDir, 'backups', '20260927-000000-000-menu-central.json'), '{"version":1}', 'utf8');
  await assert.rejects(
    () => restoreBackup(dataDir, '20260927-000000-000-menu-central.json', validateCentralShape),
    /ไม่ผ่านการตรวจ/,
  );
});
