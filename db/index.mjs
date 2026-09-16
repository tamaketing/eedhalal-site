// EED HALAL — repository contract + adapter factory.
//
// Contract (every adapter implements exactly these methods; conformance is
// tested in test/central-database.test.mjs and test/db-contract.test.mjs
// against memory, file, and a fake PostgreSQL client):
//
//   repos.customers: create(row) | findById(id) | findByLineUserId(lineUserId)
//                    | update(id, patch) | list()
//   repos.leads:     create(row) | findById(id) | listByCustomer(customerId)
//                    | findByCustomerAndEvent(customerId, sourceEventId)
//                    | update(id, patch)
//   repos.drafts:    create(row) | findById(id) | findByDraftId(draftId)
//                    | findBySourceEventId(sourceEventId)
//                    | listByStatus(status) | update(id, patch)
//                    | updateIfCurrent(id, patch, {status?, updatedAt?})
//                      -> null on conflict (caller maps to 409)
//   repos.auditLogs: append(row) | listByEntity(entityType, entityId) | list()
//                    (append-only: update/delete MUST NOT exist)
//   repos.transaction(fn) — runs fn(txRepos) so state change + audit commit
//                    together (real transaction on PostgreSQL, serialized
//                    section on file, direct call on memory).
//   repos.ping()     — { ok, adapter } connectivity check (no secrets).
//   repos.close()    — releases pooled resources (postgres only matters).
//
// Rows use camelCase in JS; the postgres adapter maps to snake_case columns
// defined in db/migrations/*.sql. Unique conflicts surface as errors
// with code 'UNIQUE_VIOLATION' (memory/file) or '23505' (PostgreSQL).
//
// Fail-closed: DB_ADAPTER=postgres without DATABASE_URL throws immediately —
// the API must never silently fall back to memory/file/static staging.
//
// No AI agent, n8n node, or frontend code may import db/* adapters directly
// for SQL — all business access goes through services/*.

import { createFileAdapter, isUniqueViolation } from './file.mjs';
import { createMemoryAdapter } from './memory.mjs';
import { createPostgresAdapter } from './postgres.mjs';

export { isUniqueViolation };

// Strip credentials for logs/status, keeping only scheme://***@host/db.
// (Deliberately no credential-shaped example here so secret scans stay clean.)
export function redactUrl(url) {
  return String(url || '').replace(/(\/\/[^/@:]+:)[^/@]+(@)/, '$1***$2');
}

// Explicit TLS: PGSSLMODE=require (or a sslmode=require URL param) enables
// verification. Verification is NEVER disabled by this factory.
export function postgresSsl(env = process.env) {
  const mode = String(env.PGSSLMODE || '').toLowerCase();
  const url = String(env.DATABASE_URL || '').toLowerCase();
  if (mode === 'require' || url.includes('sslmode=require')) return { rejectUnauthorized: true };
  return undefined;
}

export function createAdapter(env = process.env) {
  const kind = (env.DB_ADAPTER || 'memory').toLowerCase();
  if (kind === 'postgres') {
    if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required when DB_ADAPTER=postgres.');
    return createPostgresAdapter({ connectionString: env.DATABASE_URL, ssl: postgresSsl(env) });
  }
  if (kind === 'file') {
    if (!env.DB_DIR) throw new Error('DB_DIR is required when DB_ADAPTER=file.');
    return createFileAdapter(env.DB_DIR);
  }
  if (kind === 'memory') return createMemoryAdapter();
  throw new Error(`unknown DB_ADAPTER: ${kind} (use memory, file, or postgres)`);
}
