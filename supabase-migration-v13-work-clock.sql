-- ============================================================
-- Migration v13: Work clock column on user_settings
-- ============================================================
ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS work_clock_started_at TIMESTAMPTZ DEFAULT NULL;
