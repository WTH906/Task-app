-- ============================================================
-- Migration v3: Project deadline + Subtask timer + Weekly routine
-- Run in Supabase SQL Editor
-- ============================================================

ALTER TABLE projects ADD COLUMN IF NOT EXISTS deadline DATE;
ALTER TABLE subtasks ADD COLUMN IF NOT EXISTS elapsed_seconds REAL DEFAULT 0;

-- Weekly routine tasks (same structure as daily routine)
CREATE TABLE IF NOT EXISTS weekly_routine_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  text TEXT NOT NULL,
  est_minutes INT DEFAULT 0,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS weekly_routine_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  task_id UUID NOT NULL REFERENCES weekly_routine_tasks(id) ON DELETE CASCADE,
  week_key TEXT NOT NULL, -- e.g. "2026-W14"
  UNIQUE(user_id, task_id, week_key)
);

ALTER TABLE weekly_routine_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE weekly_routine_checks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "wrt_select" ON weekly_routine_tasks FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "wrt_insert" ON weekly_routine_tasks FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "wrt_update" ON weekly_routine_tasks FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "wrt_delete" ON weekly_routine_tasks FOR DELETE USING (user_id = auth.uid());

CREATE POLICY "wrc_select" ON weekly_routine_checks FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "wrc_insert" ON weekly_routine_checks FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "wrc_delete" ON weekly_routine_checks FOR DELETE USING (user_id = auth.uid());
