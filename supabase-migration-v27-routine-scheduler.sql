-- v27: Routine tasks in the scheduler
--
-- Lets the hour grid pull in routine tasks as schedulable week_tasks rows.
-- Each row links back to its source routine via routine_task_id + routine_type.

-- ── week_tasks: link to routine source ────────────────────────────────────

ALTER TABLE week_tasks
  ADD COLUMN IF NOT EXISTS routine_task_id UUID DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS routine_type TEXT DEFAULT NULL;

ALTER TABLE week_tasks
  ADD CONSTRAINT chk_routine_type
  CHECK (routine_type IS NULL OR routine_type IN ('daily', 'weekly', 'monthly', 'yearly'));

ALTER TABLE week_tasks
  ADD CONSTRAINT chk_routine_pair
  CHECK ((routine_task_id IS NULL) = (routine_type IS NULL));

-- One routine task per day — prevents duplicates on reload.
CREATE UNIQUE INDEX IF NOT EXISTS idx_week_tasks_routine_unique
  ON week_tasks (user_id, date_key, routine_task_id)
  WHERE routine_task_id IS NOT NULL;

-- ── yearly_routine_tasks: day precision ───────────────────────────────────

ALTER TABLE yearly_routine_tasks
  ADD COLUMN IF NOT EXISTS day_from INT DEFAULT NULL;

COMMENT ON COLUMN yearly_routine_tasks.day_from IS '1-31, day of month within month_from to place on the scheduler';
