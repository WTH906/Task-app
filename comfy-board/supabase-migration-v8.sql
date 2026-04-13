-- ============================================================
-- Migration v8: Monthly routine + Task list planner support
-- ============================================================

CREATE TABLE IF NOT EXISTS monthly_routine_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  est_minutes INT DEFAULT 0 CHECK (est_minutes >= 0),
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS monthly_routine_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  task_id UUID NOT NULL REFERENCES monthly_routine_tasks(id) ON DELETE CASCADE,
  month_key TEXT NOT NULL,
  UNIQUE(user_id, task_id, month_key)
);

ALTER TABLE monthly_routine_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE monthly_routine_checks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "mrt_select" ON monthly_routine_tasks FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "mrt_insert" ON monthly_routine_tasks FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "mrt_update" ON monthly_routine_tasks FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "mrt_delete" ON monthly_routine_tasks FOR DELETE USING (user_id = auth.uid());

CREATE POLICY "mrc_select" ON monthly_routine_checks FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "mrc_insert" ON monthly_routine_checks FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "mrc_delete" ON monthly_routine_checks FOR DELETE USING (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_mrt_user_sort ON monthly_routine_tasks(user_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_mrc_user_month ON monthly_routine_checks(user_id, month_key);

-- Update reorder_rows to include monthly_routine_tasks
CREATE OR REPLACE FUNCTION reorder_rows(
  p_table TEXT,
  p_ids UUID[],
  p_user_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  i INT;
  allowed_tables TEXT[] := ARRAY[
    'routine_tasks', 'weekly_routine_tasks', 'monthly_routine_tasks',
    'project_tasks', 'subtasks', 'week_tasks', 'projects', 'quick_tasks'
  ];
BEGIN
  -- Verify caller is who they claim to be
  IF auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'Unauthorized: caller does not match p_user_id';
  END IF;

  IF NOT (p_table = ANY(allowed_tables)) THEN
    RAISE EXCEPTION 'Table not allowed: %', p_table;
  END IF;
  FOR i IN 1..array_length(p_ids, 1) LOOP
    EXECUTE format(
      'UPDATE %I SET sort_order = $1 WHERE id = $2 AND user_id = $3',
      p_table
    ) USING i - 1, p_ids[i], p_user_id;
  END LOOP;
END;
$$;
