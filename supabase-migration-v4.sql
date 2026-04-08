-- ============================================================
-- Migration v4: Quick task date + deadline
-- Run in Supabase SQL Editor
-- ============================================================

ALTER TABLE quick_tasks ADD COLUMN IF NOT EXISTS date_key DATE;
ALTER TABLE quick_tasks ADD COLUMN IF NOT EXISTS deadline DATE;
ALTER TABLE quick_tasks ADD COLUMN IF NOT EXISTS recurrence TEXT;
