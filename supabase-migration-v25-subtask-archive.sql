-- v25: Subtask archiving
--
-- Adds archived_at to subtasks so individual subtasks can be archived
-- independently of their parent task, mirroring the pattern already
-- established for project_tasks in v6.

ALTER TABLE subtasks ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_subtasks_archived
  ON subtasks (task_id) WHERE archived_at IS NULL;
