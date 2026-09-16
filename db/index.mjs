// EED HALAL — repository contract + adapter factory.
//
// Contract (every adapter implements exactly these methods; conformance is
// tested in test/central-database.test.mjs against memory, file, and a fake
// PostgreSQL client):
//
//   repos.customers: create(row) | findById(id) | findByLineUserId(lineUserId)
//                    | update(id, patch) | list()
//   repos.leads:     create(row) | findById(id) | listByCustomer(customerId)
//                    | update(id, patch)
//   repos.drafts:    create(row) | findById(id) | findByDraftId(draftId)
//                    | listByStatus(status) | update(id, patch)
//   repos.auditLogs: append(row) | listByEntity(entityType, entityId) | list()
//                    (append-only: update/delete MUST NOT exist)
//
// Rows use camelCase in JS; the postgres adapter maps to snake_case columns
// defined in db/migrations/001_core.sql. Unique conflicts surface as errors
// with code 'UNIQUE_VIOLATION' (memory/file) or '23505' (PostgreSQL).
//
// No AI agent, n8n node, or frontend code may import db/* adapters directly
// for SQL — all business access goes through services/*.

import { createFileAdapter, isUniqueViolation } from './file.mjs';
import { createMemoryAdapter } from './memory.mjs';
import { createPostgresAdapter } from './postgres.mjs';

export { isUniqueViolation };

export function createAdapter(env = process.env) {
  const kind = (env.DB_ADAPTER || 'memory').toLowerCase();
  if (kind === 'postgres') {
    if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required when DB_ADAPTER=postgres.');
    return createPostgresAdapter({ connectionString: env.DATABASE_URL });
  }
  if (kind === 'file') {
    if (!env.DB_DIR) throw new Error('DB_DIR is required when DB_ADAPTER=file.');
    return createFileAdapter(env.DB_DIR);
  }
  if (kind === 'memory') return createMemoryAdapter();
  throw new Error(`unknown DB_ADAPTER: ${kind} (use memory, file, or postgres)`);
}
