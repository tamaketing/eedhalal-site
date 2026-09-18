import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { receiveInboundMessage } from '../services/inboundMessages.mjs';
import { createMemoryAdapter } from '../db/memory.mjs';
import { createFileAdapter } from '../db/file.mjs';
import { createPostgresAdapter } from '../db/postgres.mjs';
import { createFakePg } from '../test-helpers/fake-pg.mjs';
import { inboundContract } from '../test-helpers/inbound-contract.mjs';

test('inbound contract: memory', (t) => inboundContract(t, createMemoryAdapter()));
test('inbound contract: file', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'eed-inbound-'));
  try { await inboundContract(t, createFileAdapter(dir)); }
  finally { await rm(dir, { recursive: true, force: true }); }
});
test('inbound contract: PostgreSQL query shapes (fake, no transaction emulation)', (t) =>
  inboundContract(t, createPostgresAdapter({ query: createFakePg().query }), { rollback: false }));

test('file adapter receipt and audit survive reopening', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'eed-inbound-reopen-'));
  try {
    const repos = createFileAdapter(dir);
    const { inbound } = await receiveInboundMessage(repos, { incomingMessage: 'ข้อความ\n😊' });
    const reopened = createFileAdapter(dir);
    assert.deepEqual(await reopened.inboundMessages.findById(inbound.id), inbound);
    assert.equal((await reopened.auditLogs.listByEntity('inbound_message', inbound.id)).length, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
