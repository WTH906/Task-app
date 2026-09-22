-- ============================================================
-- Migration v9: Add subtask_id FK to week_tasks
-- Fixes P0 #1 from code review — eliminates text-based subtask matching
-- ============================================================

-- Add subtask_id column with FK to subtasks
-- ON DELETE SET NULL: if the subtask is hard-deleted, keep the week_task as an orphaned standalone entry
ALTER TABLE week_tasks
  ADD COLUMN IF NOT EXISTS subtask_id UUID NULL REFERENCES subtasks(id) ON DELETE SET NULL;

-- Partial index for the lookup pattern (find week_task by subtask_id)
CREATE INDEX IF NOT EXISTS idx_week_tasks_subtask_id
  ON week_tasks(subtask_id)
  WHERE subtask_id IS NOT NULL;

-- Backfill: for existing rows where text contains "↳", try to find the matching subtask
-- This is best-effort — exact matches only, case-insensitive
-- Rows that don't match stay with subtask_id = NULL (treated as standalone week_tasks)
UPDATE week_tasks wt
SET subtask_id = s.id
FROM subtasks s
WHERE wt.subtask_id IS NULL
  AND wt.project_task_id = s.task_id
  AND wt.text LIKE '%↳%'
  -- Extract the part after "↳ " and compare case-insensitively to subtask name
  AND lower(trim(split_part(wt.text, '↳', 2))) = lower(trim(s.name));

-- ============================================================
-- P0 #4: Move alarm_fired from projects (per-project) to project_tasks (per-task)
-- ============================================================
ALTER TABLE project_tasks ADD COLUMN IF NOT EXISTS alarm_fired_at TIMESTAMPTZ NULL;

-- Safe to drop after code is deployed — the column is no longer read
-- Run this AFTER confirming the new code is live:
-- ALTER TABLE projects DROP COLUMN IF EXISTS alarm_fired;

-- ============================================================
-- P2 #12: User settings table (replaces localStorage feature flags)
-- ============================================================
CREATE TABLE IF NOT EXISTS user_settings (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  monthly_routine_enabled BOOLEAN DEFAULT false,
  dashboard_card_order JSONB DEFAULT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users own settings" ON user_settings
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- P0 #3: Timer state in DB — store started_at for drift-proof tracking
-- ============================================================
ALTER TABLE project_tasks ADD COLUMN IF NOT EXISTS timer_started_at TIMESTAMPTZ NULL;
ALTER TABLE subtasks ADD COLUMN IF NOT EXISTS timer_started_at TIMESTAMPTZ NULL;
