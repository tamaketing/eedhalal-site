// EED HALAL — JSON file repository adapter (local persistence, zero deps).
// One JSON document per table under DB_DIR. Writes are atomic (tmp + rename)
// and serialized through an in-process queue so concurrent async callers in
// this process cannot interleave read-modify-write cycles.
// Cross-process races (two bot processes) are resolved by the service layer
// via find-then-create + unique-retry; PostgreSQL remains the production
// target where the UNIQUE constraint enforces this at the database level.

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isUniqueViolation } from './memory.mjs';

function clone(value) {
  return value === undefined ? value : structuredClone(value);
}

const TABLES = ['customers', 'leads', 'drafts', 'auditLogs'];

export function createFileAdapter(dir) {
  if (!dir) throw new Error('DB_DIR is required for the file adapter.');
  let queue = Promise.resolve();
  let depth = 0;
  const state = { loaded: false, tables: null };

  // Serialize all mutations/reads that depend on file contents. Re-entrant:
  // code already inside a transaction runs directly instead of re-queueing.
  function exclusive(task) {
    if (depth > 0) return task();
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
        tables.leads[row.id] = stamp({ ...row }, true, now);
        await persist();
        return clone(tables.leads[row.id]);
      });
    },
    async findById(id) {
      return exclusive(async () => clone((await load()).leads[id] || null));
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
    // Groups several repository calls into one exclusive section so no other
    // task in this process can interleave between them. Repos passed to fn
    // are the same objects (re-entrant via the depth counter above).
    async transaction(fn) {
      return exclusive(async () => {
        depth += 1;
        try {
          return await fn({ customers, leads, drafts, auditLogs });
        } finally {
          depth -= 1;
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
