-- ============================================================
-- Migration v6: Soft deletes + Composite indexes
-- Run in Supabase SQL Editor
-- ============================================================

-- ── 1. Soft delete columns ────────────────────────────────────
ALTER TABLE projects ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE project_tasks ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ DEFAULT NULL;

-- Index for filtering out archived rows efficiently
CREATE INDEX IF NOT EXISTS idx_projects_archived ON projects(user_id, archived_at) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_project_tasks_archived ON project_tasks(project_id, archived_at) WHERE archived_at IS NULL;

-- ── 2. Composite indexes for common query patterns ────────────

-- project_tasks: always queried by project_id + sort_order
CREATE INDEX IF NOT EXISTS idx_project_tasks_project_sort
  ON project_tasks(project_id, sort_order);

-- subtasks: always queried by task_id + sort_order
CREATE INDEX IF NOT EXISTS idx_subtasks_task_sort
  ON subtasks(task_id, sort_order);

-- routine_tasks: queried by user_id + sort_order
CREATE INDEX IF NOT EXISTS idx_routine_tasks_user_sort
  ON routine_tasks(user_id, sort_order);

-- weekly_routine_tasks: same pattern
CREATE INDEX IF NOT EXISTS idx_weekly_routine_tasks_user_sort
  ON weekly_routine_tasks(user_id, sort_order);

-- quick_tasks: same pattern
CREATE INDEX IF NOT EXISTS idx_quick_tasks_user_sort
  ON quick_tasks(user_id, sort_order);

-- projects: queried by user_id + sort_order
CREATE INDEX IF NOT EXISTS idx_projects_user_sort
  ON projects(user_id, sort_order);

-- week_tasks: queried by user_id + date_key + sort_order
CREATE INDEX IF NOT EXISTS idx_week_tasks_user_date_sort
  ON week_tasks(user_id, date_key, sort_order);

-- routine_checks: queried by user_id + checked_date
CREATE INDEX IF NOT EXISTS idx_routine_checks_user_date
  ON routine_checks(user_id, checked_date);

-- weekly_routine_checks: queried by user_id + week_key
CREATE INDEX IF NOT EXISTS idx_weekly_routine_checks_user_week
  ON weekly_routine_checks(user_id, week_key);

-- project_tasks with deadline: queried for overdue tasks
CREATE INDEX IF NOT EXISTS idx_project_tasks_deadline
  ON project_tasks(user_id, deadline) WHERE deadline IS NOT NULL AND progress < 100;
