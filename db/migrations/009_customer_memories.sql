-- EED HALAL central database — migration 009: customer memory.
--
-- WHY: the LINE bot only saw the last few turns of a conversation, so a
-- customer who had already given their phone number, tax id, delivery date
-- or dietary note was asked again on every new message. One row per customer
-- holds the current situation, so every reply starts from what is already
-- known instead of from zero.
--
-- Additive only; migrations 001-008 stay immutable.
--
-- summary  - a short Thai note about the customer's current situation
-- facts    - the structured facts extracted from the customer's own words
--            (quantity, menu, date, location, budget, phone, invoice, notes)
-- history  - situations of jobs that are already closed (newest last)
-- source   - 'rule' (generated), 'ai' (written by the model) or 'owner'
--            (the owner typed it: the bot must never overwrite that)
-- status   - OPEN while the job is running, CLOSED once it is finished
CREATE TABLE IF NOT EXISTS customer_memories (
  id UUID PRIMARY KEY,
  customer_id UUID NOT NULL UNIQUE REFERENCES customers(id),
  summary TEXT NOT NULL DEFAULT '',
  facts JSONB NOT NULL DEFAULT '{}',
  history JSONB NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'OPEN'
    CHECK (status IN ('OPEN', 'CLOSED')),
  source TEXT NOT NULL DEFAULT 'rule'
    CHECK (source IN ('rule', 'ai', 'owner')),
  rule_revision TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS customer_memories_status_idx ON customer_memories (status);

-- Least privilege: the runtime role manages memories, never deletes them and
-- never changes the schema. DELETE stays with the migration role so a closed
-- job's history can only be purged deliberately.
REVOKE ALL ON customer_memories FROM PUBLIC;
REVOKE ALL ON customer_memories FROM eedhalal_app;
GRANT SELECT, INSERT, UPDATE ON customer_memories TO eedhalal_app;
