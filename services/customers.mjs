// EED HALAL — customer resolution service.
// LINE userId -> find Customer by lineUserId -> create when missing.
// Idempotent: many messages from the same LINE user never create duplicates.
// Race safety: UNIQUE(line_user_id) + find-then-create with one safe retry;
// PostgreSQL enforces it at the database level (code 23505), the file/memory
// adapters raise UNIQUE_VIOLATION, and both paths re-read the winner.

import { randomUUID } from 'node:crypto';
import { isUniqueViolation } from '../db/index.mjs';
import { recordAudit } from './audit.mjs';

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

export async function resolveCustomer(repos, input = {}, actor = { type: 'SYSTEM', id: '' }) {
  const lineUserId = input.lineUserId ? String(input.lineUserId) : null;
  if (lineUserId) {
    const existing = await repos.customers.findByLineUserId(lineUserId);
    if (existing) return existing;
    try {
      return await repos.transaction(async (tx) => {
        const created = await tx.customers.create(buildCustomerRow({ ...input, lineUserId }));
        await recordAudit(tx, {
          entityType: 'customer', entityId: created.id, action: 'CUSTOMER_CREATED',
          actorType: actor.type || 'SYSTEM', actorId: actor.id || '',
          beforeData: null, afterData: { id: created.id, lineUserId, displayName: created.displayName },
        });
        return created;
      });
    } catch (error) {
      // Lost a race: someone else created this lineUserId first. Re-read.
      if (!isUniqueViolation(error)) throw error;
      const winner = await repos.customers.findByLineUserId(lineUserId);
      if (!winner) throw error;
      return winner;
    }
  }
  // No LINE identity (should be rare): create an anonymous profile. Phone and
  // email stay optional because a LINE customer may not share them yet.
  return repos.customers.create(buildCustomerRow(input));
}
