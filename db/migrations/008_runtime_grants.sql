-- EED HALAL central database — migration 008: runtime role grants.
--
-- WHY: migrations 001-003 created the core tables without granting anything
-- to the runtime role. A fresh database therefore left the app unable to
-- write: `receiveInboundMessage` inserts a receipt AND an audit row, and the
-- audit insert failed with "permission denied for table audit_logs" because
-- only migrations 004-007 granted their own table.
--
-- This migration makes the least-privilege set explicit for ALL six tables.
-- It is additive only; migrations 001-007 stay immutable.
--
-- The runtime role may:
--   - read, insert and update the tables it manages
--   - append to audit_logs (SELECT + INSERT only: the audit trail is
--     append-only, so the app can never rewrite history)
-- The runtime role may never delete, truncate or change the schema.

REVOKE ALL ON customers, leads, drafts, inbound_messages, response_examples FROM eedhalal_app;
GRANT SELECT, INSERT, UPDATE ON customers, leads, drafts, inbound_messages, response_examples TO eedhalal_app;

REVOKE ALL ON audit_logs FROM eedhalal_app;
GRANT SELECT, INSERT ON audit_logs TO eedhalal_app;

-- The schema itself stays closed: no CREATE for the runtime role, so it can
-- never add a table or an index behind the migration role's back.
REVOKE CREATE ON SCHEMA public FROM eedhalal_app;
