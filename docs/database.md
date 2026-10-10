# EED HALAL Central Database (Phase 3)

## Technology / why

- **PostgreSQL is the production target** (UUID PKs, UNIQUE constraints for
  race safety, JSONB for metadata/history, transactional migrations).
- **Dependencies are explicit:** `package.json` declares the `pg` PostgreSQL
  driver. Business logic never touches SQL — everything goes through
  `services/*` → repository interfaces in `db/index.mjs`.
- Three adapters implement one contract (conformance-tested):
  `memory` (tests/CI), `file` (local JSON docs, atomic tmp+rename writes),
  `postgres` (production; `pg` is lazily imported only on hosts with
  `DB_ADAPTER=postgres`).

## Current (Phase 3 — implemented)

```
LINE userId
  → services/customers.mjs resolveCustomer()   (idempotent, unique+retry)
  → Customer ──< Leads ──< Drafts (leadId NULLABLE)
  → services/leads.mjs maybeCreateLead()       (deterministic rule only)
  → AI text → services/drafts.mjs persistDraft()
  → Draft WAITING_FOR_HUMAN → STOP (owner reviews manually)
  → every important change → services/audit.mjs (append-only)
```

Tables: `customers`, `leads`, `drafts`, `audit_logs`
(`db/migrations/001_core.sql`, tracked by `schema_migrations`).

## Future (NOT IMPLEMENTED — schema must stay easy to extend)

```
Customer
   ↓
Lead            ← YOU ARE HERE (Phase 3 ends here)
   ↓
Quotation       (NOT IMPLEMENTED)
   ↓
Order           (NOT IMPLEMENTED)
   ↓
Job             (NOT IMPLEMENTED)
   ├── Supplier/Purchase   (NOT IMPLEMENTED)
   ├── Operations          (NOT IMPLEMENTED)
   ├── Job Cost            (NOT IMPLEMENTED)
   └── Payment             (NOT IMPLEMENTED)
          ↓
Accounting      (NOT IMPLEMENTED)
```

New phases add `002_*.sql` migrations — never edit `001_core.sql` after it
has run in production, never alter production schema by hand.

## Integration boundary

```
Owner Console ──X direct SQL (forbidden)
Owner Console ──> Internal API chain ──> PostgreSQL   (SOURCE OF TRUTH)
```

Only `server/internal-api.mjs` may import the `db/*` adapters. It is
localhost-only and bearer-gated by `EED_INTERNAL_API_SECRET`
(see `docs/internal-api.md`). Nothing outside the API reaches PostgreSQL, and
nothing reaches a customer without an owner action.

## Development setup

```powershell
# ephemeral (default, nothing to configure)
node db/migrate.mjs status
# local persistence
$env:DB_ADAPTER='file'; $env:DB_DIR='D:\eedhalal-data\db'
node db/migrate.mjs status
node --test --test-concurrency=1 test/central-database.test.mjs
```

## Production setup (PostgreSQL host)

1. Install PostgreSQL and the repository dependencies (`npm ci`) on that host.
2. `CREATE DATABASE eedhalal;` + least-privilege role (no superuser).
3. Grant the runtime role `SELECT, INSERT, UPDATE` — but not `DELETE`,
   `TRUNCATE`, or DDL — on the application tables it manages (`customers`,
   `leads`, `drafts`, `audit_logs`, `inbound_messages`, `response_examples`).
   Run schema changes only with the migration role.
4. Set `DB_ADAPTER=postgres` and `DATABASE_URL` in the host secret manager
   (never in the repo; `.env.example` holds placeholders only).
5. `node db/migrate.mjs status` → `node db/migrate.mjs up`.
6. Schedule `pg_dump` backups (below) and test a restore quarterly.

## PostgreSQL runtime rules (Phase 4B-1)

- **Fail closed:** `DB_ADAPTER=postgres` with an unreachable/misconfigured
  database refuses to start the API — never silently falls back to
  memory/file/static staging.
- **Lifecycle:** startup runs a connectivity check first; SIGINT/SIGTERM stop
  accepting requests, then close the pool cleanly.
- **Readiness:** `GET /healthz` = process alive; `GET /readiness` = database
  reachable (`{ ready, adapter }`, no hosts/users/passwords/URLs/secrets).
- **Concurrency:** owner actions use `UPDATE ... WHERE id AND status AND
  updated_at` (0 rows = HTTP 409) — safe across processes.
- **Atomicity:** draft state change + audit records commit in one transaction.
- **TLS:** set `PGSSLMODE=require` (or `?sslmode=require` in the URL) to
  verify the server certificate. Verification is never disabled by this repo.
- **Migrations:** versioned, transactional per migration on one checked-out
  database connection, recorded in `schema_migrations`, guarded by an advisory
  lock, safe to rerun.
- **Known driver behavior:** `NUMERIC` (e.g. `budget_per_person`) reads back
  as string from real `pg` — coerce with `Number()` at use sites.

## Real-PostgreSQL integration test

```powershell
# Password via PGPASSWORD (from the setup step) or .pgpass — never in the repo.
$env:PGPASSWORD = '<from-step-2>'
$env:EED_TEST_DATABASE_URL = 'postgres://eedhalal_tester@localhost:5432/eedhalal_test'
node --test --test-concurrency=1 test/postgres-integration.test.mjs
```

Guardrails: without the variable the test SKIPS (never fails, never touches
anything); with it, the target is refused unless the database name contains
`test` or the host is loopback, production-like names are blocked even on
loopback, and cleanup truncates only the 6 known tables.
Run PostgreSQL-backed suites serialized
(`node --test --test-concurrency=1 test/postgres-integration.test.mjs test/inbound-postgres.test.mjs test/response-examples-postgres.test.mjs`):
parallel files share one test database and their truncate hooks overlap.
Status 2026-10-10: ran green (36/36) against an isolated local PostgreSQL 17
test database `eedhalal_test` — REAL PG VERIFIED on this host. Re-run on any
new host before trusting it there.

## Backup / restore (no passwords in repo — pass via env/prompts)

```bash
pg_dump --format=custom -d "$PGDATABASE" -f eedhalal-$(date +%F).dump
pg_restore --clean -d "$PGDATABASE" eedhalal-<date>.dump
```

## Privacy

- `services/sanitize.mjs` runs before every metadata/audit persist: drops
  tokens, secrets, credentials, headers, raw bodies; redacts bearer-like
  values; truncates long strings.
- Never stored: LINE access tokens, secrets, request headers, credentials.
- Audit logs are append-only in the application layer (no update/delete API);
  harden production further with a DB REVOKE + trigger if needed.
