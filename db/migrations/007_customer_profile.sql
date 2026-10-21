-- Customer profile sync: remember when the LINE display name was last fetched.
-- Additive only; migrations 001-006 stay immutable.
-- Empty profile_synced_at means the name has not been fetched yet (or the last
-- attempt failed), so the next message / backfill will try again.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS profile_synced_at TIMESTAMPTZ;

-- Do not create/alter cluster roles from a schema migration. The deployment
-- role must already exist and must not own this table (verified by PG tests).
REVOKE ALL ON customers FROM PUBLIC;
REVOKE ALL ON customers FROM eedhalal_app;
GRANT SELECT, INSERT, UPDATE ON customers TO eedhalal_app;
