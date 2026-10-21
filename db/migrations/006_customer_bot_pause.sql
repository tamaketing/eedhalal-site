-- Owner control: pause the auto-reply bot for one customer without touching
-- anyone else. Additive only; migrations 001-005 stay immutable.
-- Empty bot_paused_at = the bot replies normally for that customer.
-- Empty bot_pause_reason = the pause was made without recorded reason.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS bot_paused_at TIMESTAMPTZ;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS bot_pause_reason TEXT;

-- Do not create/alter cluster roles from a schema migration. The deployment
-- role must already exist and must not own this table (verified by PG tests).
REVOKE ALL ON customers FROM PUBLIC;
REVOKE ALL ON customers FROM eedhalal_app;
GRANT SELECT, INSERT, UPDATE ON customers TO eedhalal_app;
