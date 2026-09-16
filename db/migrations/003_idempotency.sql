-- EED HALAL central database — migration 003: source-event idempotency.
-- Additive only: two nullable columns + two partial unique indexes.
-- Never edit 001/002. LINE retries carry the same message id, so a retried
-- delivery reuses the persisted Customer/Lead/Draft instead of duplicating.
-- Events without a stable id keep NULL (multiple NULLs allowed) and behave
-- exactly as before.

ALTER TABLE drafts ADD COLUMN IF NOT EXISTS source_event_id TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS source_event_id TEXT;

-- LINE message ids are globally unique: one event id maps to at most one draft.
CREATE UNIQUE INDEX IF NOT EXISTS drafts_source_event_id_uniq
  ON drafts (source_event_id) WHERE source_event_id IS NOT NULL;

-- One customer re-delivering the same event must not grow a second lead.
CREATE UNIQUE INDEX IF NOT EXISTS leads_customer_event_uniq
  ON leads (customer_id, source_event_id) WHERE source_event_id IS NOT NULL;
