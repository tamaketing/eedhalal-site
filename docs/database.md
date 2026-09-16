# EED HALAL Central Database (Phase 3)

## Technology / why

- **PostgreSQL is the production target** (UUID PKs, UNIQUE constraints for
  race safety, JSONB for metadata/history, transactional migrations).
- **The repo stays zero-dependency:** no `package.json`, `node --test` keeps
  working everywhere. Business logic never touches SQL — everything goes
  through `services/*` → repository interfaces in `db/index.mjs`.
- Three adapters implement one contract (conformance-tested):
  `memory` (tests/CI), `file` (local JSON docs, atomic tmp+rename writes),
  `postgres` (production; `pg` is lazily imported only on hosts with
  `DB_ADAPTER=postgres`, installed there — never in this repo).

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

## n8n integration boundary

```
n8n ──X direct SQL (forbidden; CI fails on api.line.me/lineMessaging senders)
n8n Build Draft ──> static-data staging (INGRESS FALLBACK queue, marked in code)
services/drafts.mjs ──> DraftRepository ──> PostgreSQL   (SOURCE OF TRUTH)
```

Phase 3 builds the service boundary + contract first (this is allowed by the
phase spec). **Implementation path to Phase 4:** add a localhost-only
Internal API (same shared-secret pattern as `webhook-gateway.mjs`) exposing
`POST /internal/drafts` (AI/owner actors only, never a LINE sender); n8n
replaces the static-data write with a call to it. The service functions and
their tests do not change — only the transport does.

## Development setup

```powershell
# ephemeral (default, nothing to configure)
node db/migrate.mjs status
# local persistence
$env:DB_ADAPTER='file'; $env:DB_DIR='D:\eedhalal-data\db'
node db/migrate.mjs status
node --test test/central-database.test.mjs
```

## Production setup (PostgreSQL host)

1. Install PostgreSQL + `npm install pg` **on that host only**.
2. `CREATE DATABASE eedhalal;` + least-privilege role (no superuser).
3. Set `DB_ADAPTER=postgres` and `DATABASE_URL` in the host secret manager
   (never in the repo; `.env.example` holds placeholders only).
4. `node db/migrate.mjs status` → `node db/migrate.mjs up`.
5. Schedule `pg_dump` backups (below) and test a restore quarterly.

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
