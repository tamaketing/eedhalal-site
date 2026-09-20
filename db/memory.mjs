// EED HALAL — in-memory repository adapter (tests, CI, ephemeral use).
// Implements the repository contract documented in db/index.mjs.
// No I/O, no dependencies. Do not use for production persistence.

import { AsyncLocalStorage } from 'node:async_hooks';
import { inboundDefaults, inboundPatch, validateInboundRow } from './inbound-contract.mjs';
import { exampleDefaults, examplePatch, validateExampleRow } from './examples-contract.mjs';

function clone(value) {
  return value === undefined ? value : structuredClone(value);
}

function withTimestamps(row, isNew, now) {
  const next = { ...row };
  if (isNew && !next.createdAt) next.createdAt = now;
  next.updatedAt = now;
  return next;
}

export function createMemoryAdapter() {
  const tables = {
    customers: new Map(),
    leads: new Map(),
    drafts: new Map(),
    auditLogs: new Map(),
    inboundMessages: new Map(),
    responseExamples: new Map(),
  };
  const customers = {
    kind: 'customers',
    async create(row, now = new Date().toISOString()) {
      if (tables.customers.has(row.id)) throw conflict(`customer ${row.id} already exists`);
      if (row.lineUserId) {
        for (const existing of tables.customers.values()) {
          if (existing.lineUserId === row.lineUserId) throw conflict(`lineUserId ${row.lineUserId} already exists`);
        }
      }
      const saved = withTimestamps({ ...row }, true, now);
      tables.customers.set(saved.id, saved);
      return clone(saved);
    },
    async findById(id) {
      return clone(tables.customers.get(id) || null);
    },
    async findByLineUserId(lineUserId) {
      if (!lineUserId) return null;
      for (const row of tables.customers.values()) {
        if (row.lineUserId === lineUserId) return clone(row);
      }
      return null;
    },
    async update(id, patch, now = new Date().toISOString()) {
      const current = tables.customers.get(id);
      if (!current) return null;
      if (patch.lineUserId && patch.lineUserId !== current.lineUserId) {
        for (const row of tables.customers.values()) {
          if (row.id !== id && row.lineUserId === patch.lineUserId) throw conflict(`lineUserId ${patch.lineUserId} already exists`);
        }
      }
      const next = withTimestamps({ ...current, ...patch, id }, false, now);
      tables.customers.set(id, next);
      return clone(next);
    },
    async list() {
      return [...tables.customers.values()].map(clone);
    },
  };

  const leads = {
    kind: 'leads',
    async create(row, now = new Date().toISOString()) {
      if (tables.leads.has(row.id)) throw conflict(`lead ${row.id} already exists`);
      if (row.sourceEventId != null && [...tables.leads.values()].some(
        (r) => r.customerId === row.customerId && r.sourceEventId === row.sourceEventId,
      )) throw conflict(`lead for event ${row.sourceEventId} already exists`);
      const saved = withTimestamps({ ...row }, true, now);
      tables.leads.set(saved.id, saved);
      return clone(saved);
    },
    async findById(id) {
      return clone(tables.leads.get(id) || null);
    },
    async findByCustomerAndEvent(customerId, sourceEventId) {
      if (!sourceEventId) return null;
      for (const row of tables.leads.values()) {
        if (row.customerId === customerId && row.sourceEventId === sourceEventId) return clone(row);
      }
      return null;
    },
    async listByCustomer(customerId) {
      return [...tables.leads.values()].filter((row) => row.customerId === customerId).map(clone);
    },
    async update(id, patch, now = new Date().toISOString()) {
      const current = tables.leads.get(id);
      if (!current) return null;
      const next = withTimestamps({ ...current, ...patch, id }, false, now);
      tables.leads.set(id, next);
      return clone(next);
    },
  };

  const drafts = {
    kind: 'drafts',
    async create(row, now = new Date().toISOString()) {
      if (tables.drafts.has(row.id)) throw conflict(`draft ${row.id} already exists`);
      for (const existing of tables.drafts.values()) {
        if (existing.draftId === row.draftId) throw conflict(`draftId ${row.draftId} already exists`);
        if (row.sourceEventId != null && existing.sourceEventId === row.sourceEventId) {
          throw conflict(`draft for event ${row.sourceEventId} already exists`);
        }
      }
      const saved = withTimestamps({ ...row }, true, now);
      tables.drafts.set(saved.id, saved);
      return clone(saved);
    },
    async findById(id) {
      return clone(tables.drafts.get(id) || null);
    },
    async findByDraftId(draftId) {
      for (const row of tables.drafts.values()) {
        if (row.draftId === draftId) return clone(row);
      }
      return null;
    },
    async findBySourceEventId(sourceEventId) {
      if (!sourceEventId) return null;
      for (const row of tables.drafts.values()) {
        if (row.sourceEventId === sourceEventId) return clone(row);
      }
      return null;
    },
    async listByStatus(status) {
      return [...tables.drafts.values()].filter((row) => row.status === status).map(clone);
    },
    async update(id, patch, now = new Date().toISOString()) {
      const current = tables.drafts.get(id);
      if (!current) return null;
      const next = withTimestamps({ ...current, ...patch, id }, false, now);
      tables.drafts.set(id, next);
      return clone(next);
    },
    // Atomic compare-and-swap: applies only when the row still matches the
    // state the caller saw. Returns null on conflict (caller maps to 409).
    // Single-threaded here, so check-and-write is naturally atomic.
    async updateIfCurrent(id, patch, expected = {}, now = new Date().toISOString()) {
      const current = tables.drafts.get(id);
      if (!current) return null;
      if (expected.status !== undefined && current.status !== expected.status) return null;
      if (expected.updatedAt !== undefined && current.updatedAt !== expected.updatedAt) return null;
      const next = withTimestamps({ ...current, ...patch, id }, false, now);
      tables.drafts.set(id, next);
      return clone(next);
    },
  };

  const inboundMessages = {
    kind: 'inboundMessages',
    async create(input, now = new Date().toISOString()) {
      const row = inboundDefaults(input);
      if (tables.inboundMessages.has(row.id) || (row.sourceEventId != null &&
          [...tables.inboundMessages.values()].some((r) => r.sourceEventId === row.sourceEventId))) {
        throw conflict('inbound already exists');
      }
      validateInboundRow(row, (table, id) => tables[table].has(id));
      const saved = withTimestamps(row, true, now);
      tables.inboundMessages.set(row.id, saved);
      return clone(saved);
    },
    async findById(id) { return clone(tables.inboundMessages.get(id) || null); },
    async findBySourceEventId(eventId) {
      return eventId == null ? null : clone([...tables.inboundMessages.values()].find((r) => r.sourceEventId === eventId) || null);
    },
    async updateIfCurrent(id, patch, expected, now = new Date().toISOString()) {
      const row = tables.inboundMessages.get(id);
      if (!row || row.status !== expected.status || row.revision !== expected.revision) return null;
      const saved = withTimestamps({ ...row, ...inboundPatch(patch) }, false, now);
      validateInboundRow(saved, (table, key) => tables[table].has(key));
      tables.inboundMessages.set(id, saved);
      return clone(saved);
    },
  };

  const responseExamples = {
    kind: 'responseExamples',
    async create(input, now = new Date().toISOString()) {
      const row = exampleDefaults(input);
      if (tables.responseExamples.has(row.id) || [...tables.responseExamples.values()].some(
        (r) => (row.sourceDraftId != null && r.sourceDraftId === row.sourceDraftId) ||
          (row.fingerprint != null && r.fingerprint === row.fingerprint))) {
        throw conflict('response example already exists');
      }
      validateExampleRow(row, (table, id) => tables[table].has(id));
      const saved = withTimestamps(row, true, now);
      tables.responseExamples.set(row.id, saved);
      return clone(saved);
    },
    async findById(id) { return clone(tables.responseExamples.get(id) || null); },
    async findBySourceDraftId(sourceDraftId) {
      if (sourceDraftId == null) return null;
      return clone([...tables.responseExamples.values()].find((r) => r.sourceDraftId === sourceDraftId) || null);
    },
    async findByFingerprint(fingerprint) {
      if (fingerprint == null) return null;
      return clone([...tables.responseExamples.values()].find((r) => r.fingerprint === fingerprint) || null);
    },
    async list({ reusable, intent, serviceType, limit = 20 } = {}) {
      const capped = Math.min(Math.max(Number(limit) || 20, 1), 100);
      return [...tables.responseExamples.values()]
        .filter((r) => (reusable === undefined || r.reusable === reusable) &&
          (intent === undefined || r.intent === intent) &&
          (serviceType === undefined || r.serviceType === serviceType))
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
        .slice(0, capped)
        .map(clone);
    },
    async update(id, patch, now = new Date().toISOString()) {
      const current = tables.responseExamples.get(id);
      if (!current) return null;
      const next = withTimestamps({ ...current, ...examplePatch(patch), id }, false, now);
      validateExampleRow(next, (table, key) => tables[table].has(key));
      tables.responseExamples.set(id, next);
      return clone(next);
    },
  };

  // Append-only by construction: no update/delete methods exist.
  const auditLogs = {
    kind: 'auditLogs',
    async append(row, now = new Date().toISOString()) {
      if (tables.auditLogs.has(row.id)) throw conflict(`audit log ${row.id} already exists`);
      const saved = { ...row };
      if (!saved.createdAt) saved.createdAt = now;
      tables.auditLogs.set(saved.id, saved);
      return clone(saved);
    },
    async listByEntity(entityType, entityId) {
      return [...tables.auditLogs.values()]
        .filter((row) => row.entityType === entityType && row.entityId === entityId)
        .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))
        .map(clone);
    },
    async list() {
      return [...tables.auditLogs.values()].map(clone);
    },
  };

  // Async callbacks can interleave even on one JS thread. Serialize repository
  // access and restore the snapshot if a transaction (including audit) fails.
  const context = new AsyncLocalStorage();
  let queue = Promise.resolve();
  function exclusive(task) {
    if (context.getStore()) return task();
    const run = queue.then(() => context.run(true, task));
    queue = run.catch(() => {});
    return run;
  }
  const repos = { customers, leads, drafts, auditLogs, inboundMessages, responseExamples };
  for (const repo of Object.values(repos)) {
    for (const [key, fn] of Object.entries(repo)) {
      if (typeof fn === 'function') repo[key] = (...args) => exclusive(() => fn(...args));
    }
  }
  return {
    ...repos,
    async transaction(fn) {
      return exclusive(async () => {
        const snapshot = structuredClone(tables);
        try { return await fn(repos); }
        catch (error) { Object.assign(tables, snapshot); throw error; }
      });
    },
    async ping() {
      return { ok: true, adapter: 'memory' };
    },
    async close() {},
  };
}

function conflict(message) {
  const error = new Error(message);
  error.code = 'UNIQUE_VIOLATION';
  return error;
}

export function isUniqueViolation(error) {
  return !!error && (error.code === 'UNIQUE_VIOLATION' || error.code === '23505');
}
