-- ============================================================
-- Migration v12: Time logs for per-day/week tracking
-- ============================================================

CREATE TABLE IF NOT EXISTS time_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  task_id UUID REFERENCES project_tasks(id) ON DELETE SET NULL,
  subtask_id UUID REFERENCES subtasks(id) ON DELETE SET NULL,
  duration_seconds INT NOT NULL CHECK (duration_seconds > 0),
  date_key TEXT NOT NULL,  -- YYYY-MM-DD for easy grouping
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_time_logs_user_date ON time_logs(user_id, date_key);
CREATE INDEX IF NOT EXISTS idx_time_logs_user_project ON time_logs(user_id, project_id);

ALTER TABLE time_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users own time_logs" ON time_logs
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
