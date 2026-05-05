-- ============================================================
-- Migration v11: Performance indexes for sync hot paths
-- ============================================================

-- week_tasks: the most queried table during sync operations
CREATE INDEX IF NOT EXISTS idx_week_tasks_project_task ON week_tasks(project_task_id, user_id) WHERE project_task_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_week_tasks_subtask ON week_tasks(subtask_id, user_id) WHERE subtask_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_week_tasks_user_date ON week_tasks(user_id, date_key);

-- deadlines: queried by source_task_id during sync, and by label for subtask deadlines
CREATE INDEX IF NOT EXISTS idx_deadlines_source_task ON deadlines(source_task_id, user_id) WHERE source_task_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_deadlines_user_label ON deadlines(user_id, label);

-- subtasks: queried by task_id when recalculating parent progress
CREATE INDEX IF NOT EXISTS idx_subtasks_task ON subtasks(task_id);

-- project_tasks: queried by project_id + sort_order on every page load
CREATE INDEX IF NOT EXISTS idx_project_tasks_project ON project_tasks(project_id, sort_order);
