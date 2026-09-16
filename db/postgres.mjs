// EED HALAL — PostgreSQL repository adapter (production target).
// Same repository contract as db/memory.mjs and db/file.mjs.
//
// Usage:
//   createPostgresAdapter({ query })            // injected query fn (tests, custom pools)
//   createPostgresAdapter({ connectionString }) // lazy `pg` import on first use
//
// The `pg` package is intentionally NOT a repo dependency (see docs/database.md):
// install it only on hosts that set DB_ADAPTER=postgres. Importing this module
// never touches `pg`; the driver loads only when a connectionString query runs.

const CUSTOMER_COLUMNS = ['id', 'line_user_id', 'display_name', 'phone', 'email', 'company_name', 'tax_id', 'address', 'notes', 'created_at', 'updated_at'];
const LEAD_COLUMNS = ['id', 'customer_id', 'source', 'service_type', 'event_date', 'quantity', 'location', 'budget_per_person', 'status', 'summary', 'created_at', 'updated_at'];
const DRAFT_COLUMNS = ['id', 'draft_id', 'customer_id', 'lead_id', 'channel', 'incoming_message', 'draft_response', 'status', 'source', 'ai_model', 'rule_revision', 'metadata', 'history', 'created_at', 'updated_at', 'approved_at', 'sent_at'];
const AUDIT_COLUMNS = ['id', 'entity_type', 'entity_id', 'action', 'actor_type', 'actor_id', 'before_data', 'after_data', 'created_at'];

function toCamel(row) {
  if (!row) return row;
  const out = {};
  for (const [key, value] of Object.entries(row)) {
    const camel = key.replace(/_([a-z])/g, (_, ch) => ch.toUpperCase());
    out[camel] = value instanceof Date ? value.toISOString() : value;
  }
  return out;
}

function placeholders(count, start = 1) {
  return Array.from({ length: count }, (_, i) => `$${start + i}`).join(', ');
}

export function createPostgresAdapter({ connectionString, query } = {}) {
  if (!query && !connectionString) throw new Error('postgres adapter needs query or connectionString.');
  let pool = null;
  async function run(text, params = []) {
    if (query) return query(text, params);
    if (!pool) {
      const { default: pg } = await import('pg');
      pool = new pg.Pool({ connectionString });
    }
    return pool.query(text, params);
  }

  function mapOne(result) {
    const row = result.rows?.[0];
    return row ? toCamel(row) : null;
  }
  function mapAll(result) {
    return (result.rows || []).map(toCamel);
  }

  const customers = {
    kind: 'customers',
    async create(row) {
      const values = [row.id, row.lineUserId ?? null, row.displayName ?? '', row.phone ?? null, row.email ?? null, row.companyName ?? null, row.taxId ?? null, row.address ?? null, row.notes ?? null];
      return mapOne(await run(
        `INSERT INTO customers (${CUSTOMER_COLUMNS.slice(0, 9).join(', ')}) VALUES (${placeholders(9)}) RETURNING *`,
        values,
      ));
    },
    async findById(id) {
      return mapOne(await run('SELECT * FROM customers WHERE id = $1', [id]));
    },
    async findByLineUserId(lineUserId) {
      if (!lineUserId) return null;
      return mapOne(await run('SELECT * FROM customers WHERE line_user_id = $1', [lineUserId]));
    },
    async update(id, patch) {
      const sets = [];
      const values = [];
      const map = { lineUserId: 'line_user_id', displayName: 'display_name', phone: 'phone', email: 'email', companyName: 'company_name', taxId: 'tax_id', address: 'address', notes: 'notes' };
      for (const [camel, column] of Object.entries(map)) {
        if (patch[camel] !== undefined) {
          sets.push(`${column} = $${values.length + 1}`);
          values.push(patch[camel]);
        }
      }
      sets.push('updated_at = now()');
      values.push(id);
      return mapOne(await run(`UPDATE customers SET ${sets.join(', ')} WHERE id = $${values.length} RETURNING *`, values));
    },
    async list() {
      return mapAll(await run('SELECT * FROM customers ORDER BY created_at ASC'));
    },
  };

  const leads = {
    kind: 'leads',
    async create(row) {
      const values = [row.id, row.customerId, row.source ?? 'line', row.serviceType ?? null, row.eventDate ?? null, row.quantity ?? null, row.location ?? null, row.budgetPerPerson ?? null, row.status ?? 'NEW', row.summary ?? ''];
      return mapOne(await run(
        `INSERT INTO leads (${LEAD_COLUMNS.slice(0, 10).join(', ')}) VALUES (${placeholders(10)}) RETURNING *`,
        values,
      ));
    },
    async findById(id) {
      return mapOne(await run('SELECT * FROM leads WHERE id = $1', [id]));
    },
    async listByCustomer(customerId) {
      return mapAll(await run('SELECT * FROM leads WHERE customer_id = $1 ORDER BY created_at ASC', [customerId]));
    },
    async update(id, patch) {
      const sets = [];
      const values = [];
      const map = { customerId: 'customer_id', source: 'source', serviceType: 'service_type', eventDate: 'event_date', quantity: 'quantity', location: 'location', budgetPerPerson: 'budget_per_person', status: 'status', summary: 'summary' };
      for (const [camel, column] of Object.entries(map)) {
        if (patch[camel] !== undefined) {
          sets.push(`${column} = $${values.length + 1}`);
          values.push(patch[camel]);
        }
      }
      sets.push('updated_at = now()');
      values.push(id);
      return mapOne(await run(`UPDATE leads SET ${sets.join(', ')} WHERE id = $${values.length} RETURNING *`, values));
    },
  };

  const drafts = {
    kind: 'drafts',
    async create(row) {
      const values = [row.id, row.draftId, row.customerId ?? null, row.leadId ?? null, row.channel ?? 'line', row.incomingMessage ?? '', row.draftResponse ?? '', row.status ?? 'WAITING_FOR_HUMAN', row.source ?? 'conversation-ai', row.aiModel ?? '', row.ruleRevision ?? '', JSON.stringify(row.metadata ?? {}), JSON.stringify(row.history ?? [])];
      return mapOne(await run(
        `INSERT INTO drafts (${DRAFT_COLUMNS.slice(0, 13).join(', ')}) VALUES (${placeholders(13)}) RETURNING *`,
        values,
      ));
    },
    async findById(id) {
      return mapOne(await run('SELECT * FROM drafts WHERE id = $1', [id]));
    },
    async findByDraftId(draftId) {
      return mapOne(await run('SELECT * FROM drafts WHERE draft_id = $1', [draftId]));
    },
    async listByStatus(status) {
      return mapAll(await run('SELECT * FROM drafts WHERE status = $1 ORDER BY created_at ASC', [status]));
    },
    async update(id, patch) {
      const sets = [];
      const values = [];
      const map = { draftId: 'draft_id', customerId: 'customer_id', leadId: 'lead_id', channel: 'channel', incomingMessage: 'incoming_message', draftResponse: 'draft_response', status: 'status', source: 'source', aiModel: 'ai_model', ruleRevision: 'rule_revision', approvedAt: 'approved_at', sentAt: 'sent_at' };
      for (const [camel, column] of Object.entries(map)) {
        if (patch[camel] !== undefined) {
          sets.push(`${column} = $${values.length + 1}`);
          values.push(patch[camel]);
        }
      }
      if (patch.metadata !== undefined) {
        sets.push(`metadata = $${values.length + 1}`);
        values.push(JSON.stringify(patch.metadata));
      }
      if (patch.history !== undefined) {
        sets.push(`history = $${values.length + 1}`);
        values.push(JSON.stringify(patch.history));
      }
      sets.push('updated_at = now()');
      values.push(id);
      return mapOne(await run(`UPDATE drafts SET ${sets.join(', ')} WHERE id = $${values.length} RETURNING *`, values));
    },
  };

  const auditLogs = {
    kind: 'auditLogs',
    async append(row) {
      const values = [row.id, row.entityType, row.entityId, row.action, row.actorType, row.actorId ?? '', row.beforeData === undefined ? null : JSON.stringify(row.beforeData), row.afterData === undefined ? null : JSON.stringify(row.afterData)];
      return mapOne(await run(
        `INSERT INTO audit_logs (${AUDIT_COLUMNS.slice(0, 8).join(', ')}) VALUES (${placeholders(8)}) RETURNING *`,
        values,
      ));
    },
    async listByEntity(entityType, entityId) {
      return mapAll(await run(
        'SELECT * FROM audit_logs WHERE entity_type = $1 AND entity_id = $2 ORDER BY created_at ASC',
        [entityType, entityId],
      ));
    },
    async list() {
      return mapAll(await run('SELECT * FROM audit_logs ORDER BY created_at ASC'));
    },
  };

  return { customers, leads, drafts, auditLogs, close: async () => { if (pool) await pool.end(); } };
}
