-- ============================================================
-- Migration v2: Dashboard, Colors, Activity Log, Recurring Deadlines
-- Run in Supabase SQL Editor after previous migrations
-- ============================================================

-- Project colors
ALTER TABLE projects ADD COLUMN IF NOT EXISTS color TEXT DEFAULT '#e05555';

-- Recurring deadlines
ALTER TABLE deadlines ADD COLUMN IF NOT EXISTS recurrence TEXT DEFAULT NULL;
-- recurrence values: null, 'daily', 'weekly', 'monthly', 'yearly'

-- Activity log
CREATE TABLE IF NOT EXISTS activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  detail TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE activity_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users own activity_log" ON activity_log;
CREATE POLICY "Users own activity_log" ON activity_log
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Index for fast dashboard queries
CREATE INDEX IF NOT EXISTS idx_activity_log_user_created
  ON activity_log (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_activity_log_project
  ON activity_log (project_id, created_at DESC);
