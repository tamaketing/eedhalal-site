-- EED HALAL central database — migration 002: owner final message.
-- Backward compatible: nullable additive columns only. Never edit 001 after
-- it has run in production. Schemaless adapters (memory/file) store these
-- fields as plain JSON properties; no migration step needed there.
--
-- draft_response keeps the ORIGINAL AI draft forever.
-- owner_final_response holds the OWNER's final text (edit), or mirrors
-- draft_response when approved without edit (service-derived rule).
-- final_action records which owner action produced the final text.

ALTER TABLE drafts ADD COLUMN IF NOT EXISTS owner_final_response TEXT;
ALTER TABLE drafts ADD COLUMN IF NOT EXISTS final_action TEXT
  CHECK (final_action IS NULL OR final_action IN ('APPROVED', 'EDITED'));
