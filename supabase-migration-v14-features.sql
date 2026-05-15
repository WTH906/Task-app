-- ============================================================
-- Migration v14: Monitoring, project start dates, routine enhancements
-- ============================================================

-- 1. Monitored tasks table
CREATE TABLE IF NOT EXISTS monitored_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  task_id UUID REFERENCES project_tasks(id) ON DELETE CASCADE,
  subtask_id UUID REFERENCES subtasks(id) ON DELETE SET NULL,
  project_title TEXT NOT NULL DEFAULT '',
  task_name TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','resolved')),
  added_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_monitored_user ON monitored_tasks(user_id, status);
ALTER TABLE monitored_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users own monitored_tasks" ON monitored_tasks
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 2. Project start date for retro planning
ALTER TABLE projects ADD COLUMN IF NOT EXISTS start_date TEXT DEFAULT NULL;

-- 3. Project sort_order (for sidebar drag)
ALTER TABLE projects ADD COLUMN IF NOT EXISTS sort_order INT DEFAULT 0;

-- 4. Weekly routine: day of week assignment
ALTER TABLE weekly_routine_tasks ADD COLUMN IF NOT EXISTS day_of_week INT DEFAULT NULL;
-- 0=Monday, 1=Tuesday, ... 6=Sunday. NULL = every week (no specific day)

-- 5. Monthly routine: date range
ALTER TABLE monthly_routine_tasks ADD COLUMN IF NOT EXISTS date_from INT DEFAULT NULL;
ALTER TABLE monthly_routine_tasks ADD COLUMN IF NOT EXISTS date_to INT DEFAULT NULL;
-- Day-of-month range (1-31). NULL = anytime during the month

-- 6. Monitoring status on project_tasks and subtasks
ALTER TABLE project_tasks ADD COLUMN IF NOT EXISTS monitoring BOOLEAN DEFAULT false;
ALTER TABLE subtasks ADD COLUMN IF NOT EXISTS monitoring BOOLEAN DEFAULT false;
