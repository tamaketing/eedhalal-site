// EED HALAL — in-memory repository adapter (tests, CI, ephemeral use).
// Implements the repository contract documented in db/index.mjs.
// No I/O, no dependencies. Do not use for production persistence.

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
      const saved = withTimestamps({ ...row }, true, now);
      tables.leads.set(saved.id, saved);
      return clone(saved);
    },
    async findById(id) {
      return clone(tables.leads.get(id) || null);
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

  return { customers, leads, drafts, auditLogs };
}

function conflict(message) {
  const error = new Error(message);
  error.code = 'UNIQUE_VIOLATION';
  return error;
}

export function isUniqueViolation(error) {
  return !!error && (error.code === 'UNIQUE_VIOLATION' || error.code === '23505');
}
