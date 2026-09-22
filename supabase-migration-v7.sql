-- ============================================================
-- Migration v7: Add date_key to project_tasks and subtasks
-- Separates calendar date from deadline
-- ============================================================

ALTER TABLE project_tasks ADD COLUMN IF NOT EXISTS date_key DATE;
ALTER TABLE subtasks ADD COLUMN IF NOT EXISTS date_key DATE;

CREATE INDEX IF NOT EXISTS idx_project_tasks_date_key ON project_tasks(date_key) WHERE date_key IS NOT NULL;
