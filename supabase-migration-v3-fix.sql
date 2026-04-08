-- ============================================================
-- Migration v3-fix: Add missing columns to quick_tasks
-- Run this if you already ran migration v3 before this fix
-- ============================================================

ALTER TABLE quick_tasks ADD COLUMN IF NOT EXISTS date_key DATE;
ALTER TABLE quick_tasks ADD COLUMN IF NOT EXISTS deadline DATE;
ALTER TABLE quick_tasks ADD COLUMN IF NOT EXISTS recurrence TEXT;
