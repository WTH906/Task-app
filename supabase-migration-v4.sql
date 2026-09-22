-- ============================================================
-- Migration v4: Hardening — proper foreign keys + error resilience
-- Run in Supabase SQL Editor
-- ============================================================

-- Add source_task_id to deadlines (replaces label-matching)
ALTER TABLE deadlines ADD COLUMN IF NOT EXISTS source_task_id UUID REFERENCES project_tasks(id) ON DELETE CASCADE;

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_deadlines_source_task ON deadlines(source_task_id) WHERE source_task_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_week_tasks_project_task ON week_tasks(project_task_id) WHERE project_task_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_week_tasks_date_user ON week_tasks(user_id, date_key);

-- Backfill: link existing deadlines to their tasks by matching labels
DO $$
DECLARE
  d RECORD;
  t RECORD;
BEGIN
  FOR d IN SELECT id, label, user_id FROM deadlines WHERE source_task_id IS NULL LOOP
    FOR t IN 
      SELECT pt.id 
      FROM project_tasks pt 
      JOIN projects p ON pt.project_id = p.id 
      WHERE pt.user_id = d.user_id 
        AND d.label LIKE '[' || p.title || '] ' || pt.name || '%'
      LIMIT 1
    LOOP
      UPDATE deadlines SET source_task_id = t.id WHERE id = d.id;
    END LOOP;
  END LOOP;
END $$;
