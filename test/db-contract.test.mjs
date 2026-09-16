import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createFileAdapter } from '../db/file.mjs';
import { createMemoryAdapter } from '../db/memory.mjs';
import { migrateStatus, migrateUp } from '../db/migrate.mjs';
import { createPostgresAdapter } from '../db/postgres.mjs';
import { createFakePg } from '../test-helpers/fake-pg.mjs';

// Contract additions from Phase 4B-1, proven on every adapter:
// updateIfCurrent (atomic compare-and-swap), transaction, ping.

async function eachAdapter(label, fn) {
  await fn(`${label}:memory`, createMemoryAdapter());
  const dir = await mkdtemp(path.join(tmpdir(), 'eed-dbc-'));
  try {
    await fn(`${label}:file`, createFileAdapter(dir));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  await fn(`${label}:postgres-fake`, createPostgresAdapter({ query: createFakePg().query }));
}

async function seedDraft(repos) {
  return repos.drafts.create({
    id: 'd1', draftId: 'LD-1', customerId: null, leadId: null, channel: 'line',
    incomingMessage: 'hi', draftResponse: 'hello', status: 'WAITING_FOR_HUMAN',
  });
}

test('updateIfCurrent applies only on a matching state', async () => {
  await eachAdapter('cas', async (label, repos) => {
    const saved = await seedDraft(repos);
    const stale = await repos.drafts.updateIfCurrent(saved.id, { status: 'APPROVED' }, { status: 'REJECTED' });
    assert.equal(stale, null, label);
    const moved = await repos.drafts.update(
      saved.id,
      { status: 'APPROVED', ownerFinalResponse: 'x', finalAction: 'APPROVED' },
    );
    const conflict = await repos.drafts.updateIfCurrent(
      saved.id, { status: 'REJECTED' }, { status: 'WAITING_FOR_HUMAN', updatedAt: saved.updatedAt },
    );
    assert.equal(conflict, null, label);
    const winner = await repos.drafts.updateIfCurrent(
      saved.id, { status: 'REJECTED' }, { status: moved.status, updatedAt: moved.updatedAt },
    );
    assert.equal(winner.status, 'REJECTED', label);
    assert.equal(await repos.drafts.updateIfCurrent('missing', { status: 'X' }, {}), null, label);
  });
});

test('transaction groups calls and propagates results', async () => {
  await eachAdapter('tx', async (label, repos) => {
    const out = await repos.transaction(async (tx) => {
      const customer = await tx.customers.create({ id: 'c1', lineUserId: null, displayName: '' });
      await tx.auditLogs.append({ id: 'a1', entityType: 'customer', entityId: customer.id, action: 'CUSTOMER_CREATED', actorType: 'SYSTEM', actorId: '' });
      return customer.id;
    });
    assert.equal(out, 'c1', label);
    assert.equal((await repos.auditLogs.listByEntity('customer', 'c1')).length, 1, label);
  });
});

test('ping reports adapter readiness without secrets', async () => {
  await eachAdapter('ping', async (label, repos) => {
    const pong = await repos.ping();
    assert.equal(pong.ok, true, label);
    assert.ok(!JSON.stringify(pong).match(/password|secret|:\/\/[^/]*@/i), label);
  });
});

test('migrations apply 001 then 002 and rerun safely', async () => {
  const fake = createFakePg();
  const env = { DB_ADAPTER: 'postgres' };
  const before = await migrateStatus(env, fake.query);
  assert.deepEqual(before.pending, ['001_core', '002_owner_final']);
  const first = await migrateUp(env, fake.query);
  assert.deepEqual(first.applied, ['001_core', '002_owner_final']);
  const second = await migrateUp(env, fake.query);
  assert.deepEqual(second.applied, []);
  const after = await migrateStatus(env, fake.query);
  assert.deepEqual(after.pending, []);
  assert.deepEqual(after.applied, ['001_core', '002_owner_final']);
});
