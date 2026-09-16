-- EED HALAL central database — migration 001: core entities.
-- Canonical schema for Phase 3. PostgreSQL is the production target.
-- The file/memory adapters (db/file.mjs, db/memory.mjs) persist the same
-- fields as JSON 1:1, so this file is the single schema definition.
--
-- Out of scope (DO NOT add here yet): quotations, orders, jobs, suppliers,
-- purchases, payments, job costs, invoices, receipts.

CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS customers (
  id UUID PRIMARY KEY,
  line_user_id TEXT UNIQUE,
  display_name TEXT NOT NULL DEFAULT '',
  phone TEXT,
  email TEXT,
  company_name TEXT,
  tax_id TEXT,
  address TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS customers_line_user_id_idx ON customers (line_user_id);

CREATE TABLE IF NOT EXISTS leads (
  id UUID PRIMARY KEY,
  customer_id UUID NOT NULL REFERENCES customers (id),
  source TEXT NOT NULL DEFAULT 'line',
  service_type TEXT,
  event_date DATE,
  quantity INTEGER,
  location TEXT,
  budget_per_person NUMERIC,
  status TEXT NOT NULL DEFAULT 'NEW'
    CHECK (status IN ('NEW', 'QUALIFYING', 'QUALIFIED', 'QUOTATION_PENDING', 'WON', 'LOST')),
  summary TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS leads_customer_id_idx ON leads (customer_id);
CREATE INDEX IF NOT EXISTS leads_status_idx ON leads (status);

CREATE TABLE IF NOT EXISTS drafts (
  id UUID PRIMARY KEY,
  draft_id TEXT NOT NULL UNIQUE,
  customer_id UUID REFERENCES customers (id),
  lead_id UUID REFERENCES leads (id),
  channel TEXT NOT NULL DEFAULT 'line',
  incoming_message TEXT NOT NULL DEFAULT '',
  draft_response TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'WAITING_FOR_HUMAN'
    CHECK (status IN ('WAITING_FOR_HUMAN', 'APPROVED', 'EDITED', 'REGENERATED', 'REJECTED', 'SENT', 'FAILED')),
  source TEXT NOT NULL DEFAULT 'conversation-ai',
  ai_model TEXT NOT NULL DEFAULT '',
  rule_revision TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}',
  history JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS drafts_customer_id_idx ON drafts (customer_id);
CREATE INDEX IF NOT EXISTS drafts_lead_id_idx ON drafts (lead_id);
CREATE INDEX IF NOT EXISTS drafts_status_idx ON drafts (status);

CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('AI', 'OWNER', 'SYSTEM')),
  actor_id TEXT NOT NULL DEFAULT '',
  before_data JSONB,
  after_data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_logs_entity_idx ON audit_logs (entity_type, entity_id);
