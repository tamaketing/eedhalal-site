// EED HALAL — customer resolution service.
// LINE userId -> find Customer by lineUserId -> create when missing.
// Idempotent: many messages from the same LINE user never create duplicates.
// Race safety: UNIQUE(line_user_id) + find-then-create with one safe retry;
// PostgreSQL enforces it at the database level (code 23505), the file/memory
// adapters raise UNIQUE_VIOLATION, and both paths re-read the winner.

import { randomUUID } from 'node:crypto';
import { isUniqueViolation } from '../db/index.mjs';
import { NotFoundError, ValidationError } from './errors.mjs';
import { recordAudit } from './audit.mjs';
import { cleanDisplayName } from './lineProfile.mjs';
import { decryptCustomerRow, encryptCustomerRow } from './encryption.mjs';

export function buildCustomerRow(input = {}) {
  return {
    id: input.id || randomUUID(),
    lineUserId: input.lineUserId ? String(input.lineUserId) : null,
    displayName: String(input.displayName || ''),
    phone: input.phone ? String(input.phone) : null,
    email: input.email ? String(input.email) : null,
    companyName: input.companyName ? String(input.companyName) : null,
    taxId: input.taxId ? String(input.taxId) : null,
    address: input.address ? String(input.address) : null,
    notes: input.notes ? String(input.notes) : null,
  };
}

// The personal fields are encrypted before they touch the database and opened
// again when they are read (see services/encryption.mjs).
const readCustomer = (row) => decryptCustomerRow(row);
const writeCustomer = (row) => encryptCustomerRow(row);

export async function resolveCustomer(repos, input = {}, actor = { type: 'SYSTEM', id: '' }) {
  const lineUserId = input.lineUserId ? String(input.lineUserId) : null;
  if (lineUserId) {
    const existing = await repos.customers.findByLineUserId(lineUserId);
    if (existing) return readCustomer(existing);
    try {
      return await repos.transaction(async (tx) => {
        const created = await tx.customers.create(writeCustomer(buildCustomerRow({ ...input, lineUserId })));
        await recordAudit(tx, {
          entityType: 'customer', entityId: created.id, action: 'CUSTOMER_CREATED',
          actorType: actor.type || 'SYSTEM', actorId: actor.id || '',
          beforeData: null, afterData: { id: created.id, lineUserId, displayName: created.displayName },
        });
        return readCustomer(created);
      });
    } catch (error) {
      // Lost a race: someone else created this lineUserId first. Re-read.
      if (!isUniqueViolation(error)) throw error;
      const winner = await repos.customers.findByLineUserId(lineUserId);
      if (!winner) throw error;
      return readCustomer(winner);
    }
  }
  // No LINE identity (should be rare): create an anonymous profile. Phone and
  // email stay optional because a LINE customer may not share them yet.
  return readCustomer(await repos.customers.create(writeCustomer(buildCustomerRow(input))));
}

// Owner control over the auto-reply bot, one customer at a time. Both actions
// change ONLY this customer's row, so pausing one conversation never silences
// the bot for anybody else. Empty botPausedAt means "bot replies normally".
function botAuditActor(actor = {}) {
  return { type: actor.type || 'SYSTEM', id: actor.id || '' };
}

// Store the LINE display name fetched by the gateway or the backfill script.
// The timestamp moves even when the name is unchanged, so a weekly refresh does
// not create an audit row every time. An actual rename is audited once.
export async function applyProfileName(repos, input = {}, actor = { type: 'SYSTEM', id: '' }) {
  const customerId = input.customerId ? String(input.customerId) : '';
  if (!customerId) throw new ValidationError('applyProfileName needs a customerId');
  const displayName = cleanDisplayName(input.displayName);
  if (!displayName) throw new ValidationError('applyProfileName needs a displayName');
  const syncedAt = input.syncedAt ? String(input.syncedAt) : new Date().toISOString();

  const before = await repos.customers.findById(customerId);
  if (!before) throw new NotFoundError(`customer not found: ${customerId}`);
  if (before.displayName === displayName) {
    return readCustomer(await repos.customers.update(customerId, { profileSyncedAt: syncedAt }));
  }

  return repos.transaction(async (tx) => {
    const updated = await tx.customers.update(customerId, { displayName, profileSyncedAt: syncedAt });
    if (!updated) throw new NotFoundError(`customer not found: ${customerId}`);
    await recordAudit(tx, {
      entityType: 'customer', entityId: customerId, action: 'CUSTOMER_PROFILE_SYNCED',
      actorType: actor.type || 'SYSTEM', actorId: actor.id || '',
      beforeData: { displayName: before.displayName || '' },
      afterData: { displayName: updated.displayName || '' },
    });
    return readCustomer(updated);
  });
}

export async function pauseBot(repos, input = {}, actor = { type: 'SYSTEM', id: '' }) {
  const customerId = input.customerId ? String(input.customerId) : '';
  if (!customerId) throw new ValidationError('pauseBot needs a customerId');
  const before = await repos.customers.findById(customerId);
  if (!before) throw new NotFoundError(`customer not found: ${customerId}`);
  const botPausedAt = new Date().toISOString();
  const botPauseReason = input.reason ? String(input.reason) : null;
  return repos.transaction(async (tx) => {
    const updated = await tx.customers.update(customerId, { botPausedAt, botPauseReason });
    if (!updated) throw new NotFoundError(`customer not found: ${customerId}`);
    await recordAudit(tx, {
      entityType: 'customer', entityId: customerId, action: 'CUSTOMER_BOT_PAUSED',
      actorType: botAuditActor(actor).type, actorId: botAuditActor(actor).id,
      beforeData: { botPausedAt: before.botPausedAt ?? null, botPauseReason: before.botPauseReason ?? null },
      afterData: { botPausedAt: updated.botPausedAt ?? botPausedAt, botPauseReason: updated.botPauseReason ?? null },
    });
    return readCustomer(updated);
  });
}

export async function resumeBot(repos, input = {}, actor = { type: 'SYSTEM', id: '' }) {
  const customerId = input.customerId ? String(input.customerId) : '';
  if (!customerId) throw new ValidationError('resumeBot needs a customerId');
  const before = await repos.customers.findById(customerId);
  if (!before) throw new NotFoundError(`customer not found: ${customerId}`);
  return repos.transaction(async (tx) => {
    const updated = await tx.customers.update(customerId, { botPausedAt: null, botPauseReason: null });
    if (!updated) throw new NotFoundError(`customer not found: ${customerId}`);
    await recordAudit(tx, {
      entityType: 'customer', entityId: customerId, action: 'CUSTOMER_BOT_RESUMED',
      actorType: botAuditActor(actor).type, actorId: botAuditActor(actor).id,
      beforeData: { botPausedAt: before.botPausedAt ?? null, botPauseReason: before.botPauseReason ?? null },
      afterData: { botPausedAt: null, botPauseReason: null },
    });
    return readCustomer(updated);
  });
}
