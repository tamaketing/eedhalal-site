-- B2.5/4B-4 Step 1: owner-approved reusable response examples.
-- Additive only; migrations 001-004 stay immutable. Examples are created
-- ONLY by explicit owner opt-in on SENT drafts (no auto-ingestion) and store
-- communication patterns, never customer identity or business facts.
CREATE TABLE IF NOT EXISTS response_examples (
  id UUID PRIMARY KEY,
  source_draft_id UUID NOT NULL UNIQUE REFERENCES drafts(id),
  intent TEXT NOT NULL CHECK (intent <> ''),
  service_type TEXT,
  incoming_example TEXT NOT NULL CHECK (incoming_example <> ''),
  approved_response TEXT NOT NULL CHECK (approved_response <> ''),
  style_tags JSONB NOT NULL DEFAULT '[]',
  reusable BOOLEAN NOT NULL DEFAULT TRUE,
  business_rules_revision TEXT NOT NULL,
  fingerprint TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS response_examples_reusable_intent_idx
  ON response_examples (reusable, intent);

-- Least privilege: runtime manages examples, never deletes schema or rows.
REVOKE ALL ON response_examples FROM PUBLIC;
REVOKE ALL ON response_examples FROM eedhalal_app;
GRANT SELECT, INSERT, UPDATE ON response_examples TO eedhalal_app;
