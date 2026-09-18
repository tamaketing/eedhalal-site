// EED HALAL — JSON file repository adapter (local persistence, zero deps).
// One JSON document per table under DB_DIR. Writes are atomic (tmp + rename)
// and serialized through an in-process queue so concurrent async callers in
// this process cannot interleave read-modify-write cycles.
// Single-process only: multiple adapter instances/processes do not share a
// lock or cache. PostgreSQL is the production target for durable transactions
// and cross-process UNIQUE/CAS enforcement.

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { isUniqueViolation } from './memory.mjs';
import { inboundDefaults, inboundPatch, validateInboundRow } from './inbound-contract.mjs';

function clone(value) {
  return value === undefined ? value : structuredClone(value);
}

const TABLES = ['customers', 'leads', 'drafts', 'auditLogs', 'inboundMessages'];

export function createFileAdapter(dir) {
  if (!dir) throw new Error('DB_DIR is required for the file adapter.');
  let queue = Promise.resolve();
  const transactionContext = new AsyncLocalStorage();
  const state = { loaded: false, tables: null };

  // Serialize all mutations/reads that depend on file contents. Re-entrant
  // only for callers in this transaction's own async context.
  function exclusive(task) {
    if (transactionContext.getStore()) return task();
    const run = queue.then(task, task);
    queue = run.catch(() => {});
    return run;
  }

  async function load() {
    if (state.loaded) return state.tables;
    await mkdir(dir, { recursive: true });
    const tables = {};
    for (const name of TABLES) {
      try {
        tables[name] = JSON.parse(await readFile(path.join(dir, `${name}.json`), 'utf8'));
      } catch {
        tables[name] = {};
      }
    }
    state.tables = tables;
    state.loaded = true;
    return tables;
  }

  async function persist() {
    if (transactionContext.getStore()) return;
    for (const name of TABLES) {
      const tmp = path.join(dir, `${name}.json.tmp`);
      await writeFile(tmp, JSON.stringify(state.tables[name], null, 2));
      await rename(tmp, path.join(dir, `${name}.json`));
    }
  }

  function conflict(message) {
    const error = new Error(message);
    error.code = 'UNIQUE_VIOLATION';
    return error;
  }

  function stamp(row, isNew, now) {
    const next = { ...row };
    if (isNew && !next.createdAt) next.createdAt = now;
    next.updatedAt = now;
    return next;
  }

  const customers = {
    kind: 'customers',
    async create(row, now = new Date().toISOString()) {
      return exclusive(async () => {
        const tables = await load();
        if (tables.customers[row.id]) throw conflict(`customer ${row.id} already exists`);
        if (row.lineUserId && Object.values(tables.customers).some((r) => r.lineUserId === row.lineUserId)) {
          throw conflict(`lineUserId ${row.lineUserId} already exists`);
        }
        tables.customers[row.id] = stamp({ ...row }, true, now);
        await persist();
        return clone(tables.customers[row.id]);
      });
    },
    async findById(id) {
      return exclusive(async () => clone((await load()).customers[id] || null));
    },
    async findByLineUserId(lineUserId) {
      if (!lineUserId) return null;
      return exclusive(async () => {
        const rows = Object.values((await load()).customers);
        return clone(rows.find((r) => r.lineUserId === lineUserId) || null);
      });
    },
    async update(id, patch, now = new Date().toISOString()) {
      return exclusive(async () => {
        const tables = await load();
        const current = tables.customers[id];
        if (!current) return null;
        if (patch.lineUserId && patch.lineUserId !== current.lineUserId &&
          Object.values(tables.customers).some((r) => r.id !== id && r.lineUserId === patch.lineUserId)) {
          throw conflict(`lineUserId ${patch.lineUserId} already exists`);
        }
        tables.customers[id] = stamp({ ...current, ...patch, id }, false, now);
        await persist();
        return clone(tables.customers[id]);
      });
    },
    async list() {
      return exclusive(async () => Object.values((await load()).customers).map(clone));
    },
  };

  const leads = {
    kind: 'leads',
    async create(row, now = new Date().toISOString()) {
      return exclusive(async () => {
        const tables = await load();
        if (tables.leads[row.id]) throw conflict(`lead ${row.id} already exists`);
        if (row.sourceEventId != null && Object.values(tables.leads).some(
          (r) => r.customerId === row.customerId && r.sourceEventId === row.sourceEventId,
        )) throw conflict(`lead for event ${row.sourceEventId} already exists`);
        tables.leads[row.id] = stamp({ ...row }, true, now);
        await persist();
        return clone(tables.leads[row.id]);
      });
    },
    async findById(id) {
      return exclusive(async () => clone((await load()).leads[id] || null));
    },
    async findByCustomerAndEvent(customerId, sourceEventId) {
      if (!sourceEventId) return null;
      return exclusive(async () => {
        const rows = Object.values((await load()).leads);
        return clone(rows.find((r) => r.customerId === customerId && r.sourceEventId === sourceEventId) || null);
      });
    },
    async listByCustomer(customerId) {
      return exclusive(async () =>
        Object.values((await load()).leads).filter((r) => r.customerId === customerId).map(clone));
    },
    async update(id, patch, now = new Date().toISOString()) {
      return exclusive(async () => {
        const tables = await load();
        if (!tables.leads[id]) return null;
        tables.leads[id] = stamp({ ...tables.leads[id], ...patch, id }, false, now);
        await persist();
        return clone(tables.leads[id]);
      });
    },
  };

  const drafts = {
    kind: 'drafts',
    async create(row, now = new Date().toISOString()) {
      return exclusive(async () => {
        const tables = await load();
        if (tables.drafts[row.id]) throw conflict(`draft ${row.id} already exists`);
        if (Object.values(tables.drafts).some((r) => r.draftId === row.draftId)) {
          throw conflict(`draftId ${row.draftId} already exists`);
        }
        if (row.sourceEventId != null && Object.values(tables.drafts).some(
          (r) => r.sourceEventId === row.sourceEventId,
        )) throw conflict(`draft for event ${row.sourceEventId} already exists`);
        tables.drafts[row.id] = stamp({ ...row }, true, now);
        await persist();
        return clone(tables.drafts[row.id]);
      });
    },
    async findById(id) {
      return exclusive(async () => clone((await load()).drafts[id] || null));
    },
    async findByDraftId(draftId) {
      return exclusive(async () => {
        const rows = Object.values((await load()).drafts);
        return clone(rows.find((r) => r.draftId === draftId) || null);
      });
    },
    async findBySourceEventId(sourceEventId) {
      if (!sourceEventId) return null;
      return exclusive(async () => {
        const rows = Object.values((await load()).drafts);
        return clone(rows.find((r) => r.sourceEventId === sourceEventId) || null);
      });
    },
    async listByStatus(status) {
      return exclusive(async () =>
        Object.values((await load()).drafts).filter((r) => r.status === status).map(clone));
    },
    async update(id, patch, now = new Date().toISOString()) {
      return exclusive(async () => {
        const tables = await load();
        if (!tables.drafts[id]) return null;
        tables.drafts[id] = stamp({ ...tables.drafts[id], ...patch, id }, false, now);
        await persist();
        return clone(tables.drafts[id]);
      });
    },
    // Atomic within this process (runs inside the exclusive queue with no
    // interleaving read-modify-write). Cross-process races rely on the
    // service-layer unique retry; PostgreSQL enforces it at the database.
    async updateIfCurrent(id, patch, expected = {}, now = new Date().toISOString()) {
      return exclusive(async () => {
        const tables = await load();
        const current = tables.drafts[id];
        if (!current) return null;
        if (expected.status !== undefined && current.status !== expected.status) return null;
        if (expected.updatedAt !== undefined && current.updatedAt !== expected.updatedAt) return null;
        tables.drafts[id] = stamp({ ...current, ...patch, id }, false, now);
        await persist();
        return clone(tables.drafts[id]);
      });
    },
  };

  const inboundMessages = {
    kind: 'inboundMessages',
    async create(input, now = new Date().toISOString()) {
      return exclusive(async () => {
        const tables = await load();
        const row = inboundDefaults(input);
        if (tables.inboundMessages[row.id] || (row.sourceEventId != null &&
            Object.values(tables.inboundMessages).some((r) => r.sourceEventId === row.sourceEventId))) {
          throw conflict('inbound already exists');
        }
        validateInboundRow(row, (table, id) => !!tables[table][id]);
        tables.inboundMessages[row.id] = stamp(row, true, now);
        await persist();
        return clone(tables.inboundMessages[row.id]);
      });
    },
    async findById(id) { return exclusive(async () => clone((await load()).inboundMessages[id] || null)); },
    async findBySourceEventId(eventId) {
      return exclusive(async () => eventId == null ? null : clone(
        Object.values((await load()).inboundMessages).find((r) => r.sourceEventId === eventId) || null));
    },
    async updateIfCurrent(id, patch, expected, now = new Date().toISOString()) {
      return exclusive(async () => {
        const tables = await load();
        const row = tables.inboundMessages[id];
        if (!row || row.status !== expected.status || row.revision !== expected.revision) return null;
        const saved = stamp({ ...row, ...inboundPatch(patch) }, false, now);
        validateInboundRow(saved, (table, key) => !!tables[table][key]);
        tables.inboundMessages[id] = saved;
        await persist();
        return clone(saved);
      });
    },
  };

  const auditLogs = {
    kind: 'auditLogs',
    async append(row, now = new Date().toISOString()) {
      return exclusive(async () => {
        const tables = await load();
        if (tables.auditLogs[row.id]) throw conflict(`audit log ${row.id} already exists`);
        tables.auditLogs[row.id] = { ...row };
        if (!tables.auditLogs[row.id].createdAt) tables.auditLogs[row.id].createdAt = now;
        await persist();
        return clone(tables.auditLogs[row.id]);
      });
    },
    async listByEntity(entityType, entityId) {
      return exclusive(async () =>
        Object.values((await load()).auditLogs)
          .filter((r) => r.entityType === entityType && r.entityId === entityId)
          .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))
          .map(clone));
    },
    async list() {
      return exclusive(async () => Object.values((await load()).auditLogs).map(clone));
    },
  };

  return {
    customers,
    leads,
    drafts,
    auditLogs,
    inboundMessages,
    // Groups several repository calls into one exclusive section so no other
    // task in this process can interleave between them. Repos passed to fn
    // are re-entrant only in this async context, not in unrelated callers.
    // Multi-file commits are not crash-atomic; production uses PostgreSQL.
    async transaction(fn) {
      return exclusive(async () => {
        const snapshot = clone(await load());
        try {
          const result = await transactionContext.run(true, () => fn({ customers, leads, drafts, auditLogs, inboundMessages }));
          await persist();
          return result;
        } catch (error) {
          state.tables = snapshot;
          throw error;
        }
      });
    },
    async ping() {
      await load();
      return { ok: true, adapter: 'file' };
    },
    async close() {},
  };
}

export { isUniqueViolation };
