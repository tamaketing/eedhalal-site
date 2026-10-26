-- Broadcast announcement queue (ระบบกระจายข้อมูลรายสัปดาห์). Additive only;
-- migrations 001-010 stay immutable.
--
-- Policy (owner decision recorded in AGENTS.md, 2026-10-26): the shop adds a
-- single owner-approved weekly broadcast. Only the runner outside
-- server/services/db (tools/line/broadcast-runner.mjs) delivers SCHEDULED
-- rows; PENDING_REVIEW rows cannot send without the owner pressing approve.
CREATE TABLE IF NOT EXISTS broadcast_messages (
  id UUID PRIMARY KEY,
  week_key TEXT,
  theme TEXT NOT NULL DEFAULT 'custom',
  menu_id TEXT,
  menu_name TEXT,
  menu_price NUMERIC,
  image_url TEXT,
  draft_text TEXT NOT NULL DEFAULT '',
  final_text TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING_REVIEW'
    CHECK (status IN ('PENDING_REVIEW', 'SCHEDULED', 'SENT', 'FAILED', 'MISSED', 'CANCELLED')),
  scheduled_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  -- Frozen LINE retry key + fingerprint (same pattern as drafts.sendAttempt).
  send_attempt JSONB,
  retry_count INTEGER NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  error_code TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_by TEXT NOT NULL DEFAULT 'SYSTEM'
    CHECK (created_by IN ('SYSTEM', 'OWNER')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- One system draft per ISO week (Asia/Bangkok). NULL week_key stays legal so
-- future owner-created broadcasts do not fight this rule.
CREATE UNIQUE INDEX IF NOT EXISTS broadcast_messages_week_key_uniq
  ON broadcast_messages(week_key) WHERE week_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS broadcast_messages_status_idx ON broadcast_messages(status);
CREATE INDEX IF NOT EXISTS broadcast_messages_scheduled_at_idx
  ON broadcast_messages(scheduled_at) WHERE status = 'SCHEDULED';

-- Do not create/alter cluster roles from a schema migration. The deployment
-- role must already exist and must not own this table (verified by PG tests).
REVOKE ALL ON broadcast_messages FROM PUBLIC;
REVOKE ALL ON broadcast_messages FROM eedhalal_app;
GRANT SELECT, INSERT, UPDATE ON broadcast_messages TO eedhalal_app;
