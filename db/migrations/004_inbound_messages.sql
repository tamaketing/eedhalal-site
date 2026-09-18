-- B2.5 receipt ledger. Additive only; migrations 001-003 stay immutable.
CREATE TABLE IF NOT EXISTS inbound_messages (
  id UUID PRIMARY KEY,
  customer_id UUID REFERENCES customers(id),
  line_user_id TEXT,
  channel TEXT NOT NULL DEFAULT 'line',
  message_type TEXT NOT NULL DEFAULT 'text',
  incoming_message TEXT NOT NULL DEFAULT '',
  source_event_id TEXT,
  status TEXT NOT NULL DEFAULT 'RECEIVED'
    CHECK (status IN ('RECEIVED', 'PROCESSING', 'AI_FAILED', 'DRAFT_CREATED')),
  ai_error_code TEXT,
  ai_error_detail TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  -- Fences stale callbacks even after PROCESSING -> AI_FAILED -> PROCESSING.
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  lead_id UUID REFERENCES leads(id),
  draft_id UUID REFERENCES drafts(id),
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inbound_messages_status_idx ON inbound_messages(status);
CREATE INDEX IF NOT EXISTS inbound_messages_customer_id_idx ON inbound_messages(customer_id);
CREATE UNIQUE INDEX IF NOT EXISTS inbound_messages_source_event_id_uniq
  ON inbound_messages(source_event_id) WHERE source_event_id IS NOT NULL;

-- Do not create/alter cluster roles from a schema migration. The deployment
-- role must already exist and must not own this table (verified by PG tests).
REVOKE ALL ON inbound_messages FROM PUBLIC;
REVOKE ALL ON inbound_messages FROM eedhalal_app;
GRANT SELECT, INSERT, UPDATE ON inbound_messages TO eedhalal_app;
