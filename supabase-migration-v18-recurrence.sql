-- ============================================================
-- Comfy Board — migration v18
-- Persist task recurrence + indexes for the planner top-up.
--
-- Why: recurrence was previously a one-shot form value. It was used to
-- generate a handful of week_tasks rows at save time and then thrown away,
-- so:
--   * a "daily" task ran out of rows after 7 days and silently stopped
--   * editing the task (or its calendar date) regenerated a single, non-
--     recurring occurrence, wiping the rest
--
-- Storing it on the row lets `extendRecurringWeekTasks()` roll occurrences
-- forward on every planner load.
--
-- Safe to re-run.
-- ============================================================

ALTER TABLE project_tasks
  ADD COLUMN IF NOT EXISTS recurrence TEXT;

COMMENT ON COLUMN project_tasks.recurrence IS
  'null | daily | weekly | monthly | yearly — drives week_tasks generation';

-- Only recurring, unfinished, unarchived tasks are ever topped up.
CREATE INDEX IF NOT EXISTS idx_project_tasks_recurrence
  ON project_tasks (user_id, recurrence)
  WHERE recurrence IS NOT NULL AND archived_at IS NULL;

-- The top-up reads existing occurrences by (project_task_id, date_key).
CREATE INDEX IF NOT EXISTS idx_week_tasks_task_date
  ON week_tasks (user_id, project_task_id, date_key);

-- ------------------------------------------------------------
-- A project task should appear at most once per day in the planner.
-- Enforcing this in the database makes the recurrence top-up safe against
-- concurrent runs (two browser tabs, or React StrictMode's double effect),
-- which would otherwise both insert the same missing occurrences.
--
-- Existing duplicates are collapsed first, keeping the oldest row and any
-- completed state on it.
-- ------------------------------------------------------------
DELETE FROM week_tasks w
USING week_tasks keep
WHERE w.project_task_id IS NOT NULL
  AND w.subtask_id IS NULL
  AND keep.project_task_id = w.project_task_id
  AND keep.subtask_id IS NULL
  AND keep.user_id = w.user_id
  AND keep.date_key = w.date_key
  AND (
    keep.done > w.done
    OR (keep.done = w.done AND keep.created_at < w.created_at)
    OR (keep.done = w.done AND keep.created_at = w.created_at AND keep.id < w.id)
  );

CREATE UNIQUE INDEX IF NOT EXISTS uniq_week_tasks_main_occurrence
  ON week_tasks (user_id, project_task_id, date_key)
  WHERE project_task_id IS NOT NULL AND subtask_id IS NULL;

-- Deadline cleanup on task delete/archive matches on source_task_id.
CREATE INDEX IF NOT EXISTS idx_deadlines_source_task
  ON deadlines (user_id, source_task_id);

-- ------------------------------------------------------------
-- Subtask deadlines were keyed by their rendered label string
-- ("[Project] ↳ Name"). Renaming a subtask orphaned its countdown, and two
-- subtasks sharing a name in one project deleted each other's row.
-- Key them on the subtask id instead.
-- ------------------------------------------------------------
ALTER TABLE deadlines
  ADD COLUMN IF NOT EXISTS source_subtask_id UUID
  REFERENCES subtasks(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_deadlines_source_subtask
  ON deadlines (user_id, source_subtask_id);

-- Backfill: attach existing label-matched subtask deadlines to their subtask.
UPDATE deadlines d
SET source_subtask_id = s.id
FROM subtasks s
JOIN project_tasks pt ON pt.id = s.task_id
JOIN projects p ON p.id = pt.project_id
WHERE d.source_subtask_id IS NULL
  AND d.source_task_id IS NULL
  AND d.user_id = s.user_id
  AND d.label = '[' || p.title || '] ↳ ' || s.name;

-- ------------------------------------------------------------
-- Backfill: nothing to do. Existing tasks keep recurrence = NULL
-- (one-off), which matches how they currently behave.
-- ------------------------------------------------------------
