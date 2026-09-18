// EED HALAL — PostgreSQL repository adapter (production target).
// Same repository contract as db/memory.mjs and db/file.mjs, plus:
//   drafts.updateIfCurrent(id, patch, {status?, updatedAt?}) — atomic
//     compare-and-swap (0 rows = conflict), the cross-process guard for
//     owner actions.
//   transaction(fn) — BEGIN/COMMIT/ROLLBACK around state change + audit so
//     they commit together. Business rules stay in services/*, never in SQL.
//
// Usage:
//   createPostgresAdapter({ query })  // injected query fn (tests, custom pools;
//                                     // transaction() degrades to direct call)
//   createPostgresAdapter({ connectionString, ssl })  // lazy `pg` pool
//
// The `pg` package is intentionally NOT a repo dependency (see docs/database.md):
// install it only on hosts that set DB_ADAPTER=postgres. Importing this module
// never touches `pg`; the driver loads only when a pool query runs.

const CUSTOMER_COLUMNS = ['id', 'line_user_id', 'display_name', 'phone', 'email', 'company_name', 'tax_id', 'address', 'notes', 'created_at', 'updated_at'];
const LEAD_COLUMNS = ['id', 'customer_id', 'source', 'service_type', 'event_date', 'quantity', 'location', 'budget_per_person', 'status', 'summary', 'source_event_id', 'created_at', 'updated_at'];
const DRAFT_COLUMNS = ['id', 'draft_id', 'customer_id', 'lead_id', 'channel', 'incoming_message', 'draft_response', 'owner_final_response', 'final_action', 'status', 'source', 'ai_model', 'rule_revision', 'metadata', 'history', 'source_event_id', 'created_at', 'updated_at', 'approved_at', 'sent_at'];
const AUDIT_COLUMNS = ['id', 'entity_type', 'entity_id', 'action', 'actor_type', 'actor_id', 'before_data', 'after_data', 'created_at'];
const INBOUND_FIELDS = {
  id: 'id', customerId: 'customer_id', lineUserId: 'line_user_id', channel: 'channel',
  messageType: 'message_type', incomingMessage: 'incoming_message', sourceEventId: 'source_event_id',
  status: 'status', aiErrorCode: 'ai_error_code', aiErrorDetail: 'ai_error_detail', retryCount: 'retry_count',
  revision: 'revision', leadId: 'lead_id', draftId: 'draft_id', metadata: 'metadata',
};
import { inboundDefaults, inboundPatch } from './inbound-contract.mjs';

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

function buildRepos(run) {
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
      const values = [row.id, row.customerId, row.source ?? 'line', row.serviceType ?? null, row.eventDate ?? null, row.quantity ?? null, row.location ?? null, row.budgetPerPerson ?? null, row.status ?? 'NEW', row.summary ?? '', row.sourceEventId ?? null];
      return mapOne(await run(
        `INSERT INTO leads (${LEAD_COLUMNS.slice(0, 11).join(', ')}) VALUES (${placeholders(11)}) RETURNING *`,
        values,
      ));
    },
    async findById(id) {
      return mapOne(await run('SELECT * FROM leads WHERE id = $1', [id]));
    },
    async findByCustomerAndEvent(customerId, sourceEventId) {
      if (!sourceEventId) return null;
      return mapOne(await run(
        'SELECT * FROM leads WHERE customer_id = $1 AND source_event_id = $2',
        [customerId, sourceEventId],
      ));
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
      const values = [row.id, row.draftId, row.customerId ?? null, row.leadId ?? null, row.channel ?? 'line', row.incomingMessage ?? '', row.draftResponse ?? '', row.ownerFinalResponse ?? null, row.finalAction ?? null, row.status ?? 'WAITING_FOR_HUMAN', row.source ?? 'conversation-ai', row.aiModel ?? '', row.ruleRevision ?? '', JSON.stringify(row.metadata ?? {}), JSON.stringify(row.history ?? []), row.sourceEventId ?? null];
      return mapOne(await run(
        `INSERT INTO drafts (${DRAFT_COLUMNS.slice(0, 16).join(', ')}) VALUES (${placeholders(16)}) RETURNING *`,
        values,
      ));
    },
    async findById(id) {
      return mapOne(await run('SELECT * FROM drafts WHERE id = $1', [id]));
    },
    async findBySourceEventId(sourceEventId) {
      if (!sourceEventId) return null;
      return mapOne(await run('SELECT * FROM drafts WHERE source_event_id = $1', [sourceEventId]));
    },
    async findByDraftId(draftId) {
      return mapOne(await run('SELECT * FROM drafts WHERE draft_id = $1', [draftId]));
    },
    async listByStatus(status) {
      return mapAll(await run('SELECT * FROM drafts WHERE status = $1 ORDER BY created_at ASC', [status]));
    },
    async update(id, patch) {
      return applyDraftUpdate(run, id, patch, {});
    },
    // Atomic guard for owner actions across processes: the write lands only
    // when the row still matches the state the owner saw. Null = conflict.
    async updateIfCurrent(id, patch, expected = {}) {
      return applyDraftUpdate(run, id, patch, expected);
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

  const inboundMessages = {
    kind: 'inboundMessages',
    async create(input) {
      const row = inboundDefaults(input);
      const values = Object.keys(INBOUND_FIELDS).map((key) => key === 'metadata' ? JSON.stringify(row[key]) : row[key]);
      return mapOne(await run(
        `INSERT INTO inbound_messages (${Object.values(INBOUND_FIELDS).join(', ')}) VALUES (${placeholders(values.length)}) RETURNING *`, values,
      ));
    },
    async findById(id) { return mapOne(await run('SELECT * FROM inbound_messages WHERE id = $1', [id])); },
    async findBySourceEventId(eventId) {
      if (eventId == null) return null;
      return mapOne(await run('SELECT * FROM inbound_messages WHERE source_event_id = $1', [eventId]));
    },
    async updateIfCurrent(id, patch, expected) {
      const fields = Object.entries(inboundPatch(patch));
      const values = [id, ...fields.map(([, value]) => value), expected.status, expected.revision];
      const sets = fields.map(([key], i) => `${INBOUND_FIELDS[key]} = $${i + 2}`);
      sets.push('updated_at = now()');
      return mapOne(await run(
        `UPDATE inbound_messages SET ${sets.join(', ')} WHERE id = $1 AND status = $${values.length - 1} AND revision = $${values.length} RETURNING *`, values,
      ));
    },
  };
  return { customers, leads, drafts, auditLogs, inboundMessages };
}

async function applyDraftUpdate(run, id, patch, expected) {
  const sets = [];
  const values = [];
  const map = { draftId: 'draft_id', customerId: 'customer_id', leadId: 'lead_id', channel: 'channel', incomingMessage: 'incoming_message', draftResponse: 'draft_response', ownerFinalResponse: 'owner_final_response', finalAction: 'final_action', status: 'status', source: 'source', aiModel: 'ai_model', ruleRevision: 'rule_revision', approvedAt: 'approved_at', sentAt: 'sent_at' };
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
  const conditions = ['id = $1'];
  const params = [id, ...values];
  if (expected.status !== undefined) {
    conditions.push(`status = $${params.length + 1}`);
    params.push(expected.status);
  }
  if (expected.updatedAt !== undefined) {
    // PostgreSQL now() carries microseconds but JS ISO strings round-trip at
    // millisecond precision: compare truncated, otherwise every guarded write
    // would conflict with itself. (Two writes inside the same millisecond
    // still race on the status guard; documented in docs/database.md.)
    conditions.push(`date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', $${params.length + 1}::timestamptz)`);
    params.push(expected.updatedAt);
  }
  // Renumber SET placeholders to follow $1 (id).
  const renumbered = sets.map((clause) => clause.replace(/\$(\d+)/g, (_, n) => `$${Number(n) + 1}`));
  const result = await run(
    `UPDATE drafts SET ${renumbered.join(', ')} WHERE ${conditions.join(' AND ')} RETURNING *`,
    params,
  );
  const row = result.rows?.[0];
  return row ? toCamel(row) : null;
}

export function createPostgresAdapter({ connectionString, query, ssl } = {}) {
  if (!query && !connectionString) throw new Error('postgres adapter needs query or connectionString.');
  let pool = null;
  async function poolQuery(text, params = []) {
    if (!pool) {
      const { default: pg } = await import('pg');
      pool = new pg.Pool({ connectionString, ...(ssl ? { ssl } : {}) });
    }
    return pool.query(text, params);
  }
  const run = query || poolQuery;
  const repos = buildRepos(run);

  return {
    ...repos,
    // Draft state change + audit commit together. With a real pool this is a
    // single database transaction; with an injected plain query fn it runs
    // directly (documented: no atomicity without a pool/client).
    async transaction(fn) {
      if (query || !connectionString) return fn(repos);
      if (!pool) {
        const { default: pg } = await import('pg');
        pool = new pg.Pool({ connectionString, ...(ssl ? { ssl } : {}) });
      }
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const out = await fn(buildRepos((text, params = []) => client.query(text, params)));
        await client.query('COMMIT');
        return out;
      } catch (error) {
        try {
          await client.query('ROLLBACK');
        } catch {
          // Rollback failure must not mask the original error.
        }
        throw error;
      } finally {
        client.release();
      }
    },
    async ping() {
      await run('SELECT 1 AS ok');
      return { ok: true, adapter: 'postgres' };
    },
    async close() {
      if (pool) {
        await pool.end();
        pool = null;
      }
    },
  };
}
