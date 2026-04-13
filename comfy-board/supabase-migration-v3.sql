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

-- Roadmap data per project (JSONB phases)
CREATE TABLE IF NOT EXISTS roadmap_data (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  phases JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, project_id)
);

ALTER TABLE roadmap_data ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rd_select" ON roadmap_data FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "rd_insert" ON roadmap_data FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "rd_update" ON roadmap_data FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "rd_delete" ON roadmap_data FOR DELETE USING (user_id = auth.uid());

-- Quick tasks (task dump list)
CREATE TABLE IF NOT EXISTS quick_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  priority INT DEFAULT 3, -- 1-5
  notes TEXT DEFAULT '',
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE quick_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "qt_select" ON quick_tasks FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "qt_insert" ON quick_tasks FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "qt_update" ON quick_tasks FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "qt_delete" ON quick_tasks FOR DELETE USING (user_id = auth.uid());

-- Fix: Add missing columns to quick_tasks
ALTER TABLE quick_tasks ADD COLUMN IF NOT EXISTS date_key DATE;
ALTER TABLE quick_tasks ADD COLUMN IF NOT EXISTS deadline DATE;
ALTER TABLE quick_tasks ADD COLUMN IF NOT EXISTS recurrence TEXT;
