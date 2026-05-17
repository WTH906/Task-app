-- ============================================================
-- Migration v15: Additional contact fields
-- ============================================================
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS website TEXT NOT NULL DEFAULT '';
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS social_handle TEXT NOT NULL DEFAULT '';
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS company_position TEXT NOT NULL DEFAULT '';
