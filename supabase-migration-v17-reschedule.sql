-- ============================================================
-- Migration v17: Reschedule tracking on week_tasks
-- ============================================================
ALTER TABLE week_tasks ADD COLUMN IF NOT EXISTS rescheduled_to TEXT DEFAULT NULL;
-- When non-null, this task was rescheduled to that date (YYYY-MM-DD)
-- The old entry stays for stats accountability, the new entry is on the target date
