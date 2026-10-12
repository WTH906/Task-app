-- ============================================================
-- Migration v28: RPC hardening (red team findings F-15, F-16)
-- Run in Supabase SQL Editor
-- ============================================================

-- ── F-15: reorder_rows — verify row ownership before updating ──
--
-- The existing WHERE clause (user_id = p_user_id) should prevent
-- cross-user writes, but since SECURITY DEFINER bypasses RLS,
-- we add an explicit pre-check: if ANY of the supplied IDs
-- don't belong to the caller, the entire call is rejected.
-- This also makes a silent no-op (0 rows matched) into a loud
-- error, which is better for debugging.
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
  bad_count INT;
  allowed_tables TEXT[] := ARRAY[
    'routine_tasks', 'weekly_routine_tasks', 'monthly_routine_tasks',
    'project_tasks', 'subtasks', 'week_tasks', 'projects', 'quick_tasks'
  ];
BEGIN
  IF auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'Unauthorized: caller does not match p_user_id';
  END IF;

  IF NOT (p_table = ANY(allowed_tables)) THEN
    RAISE EXCEPTION 'Table not allowed: %', p_table;
  END IF;

  IF array_length(p_ids, 1) IS NULL OR array_length(p_ids, 1) = 0 THEN
    RETURN;
  END IF;

  -- Verify ALL supplied IDs belong to the caller before touching anything.
  EXECUTE format(
    'SELECT count(*) FROM %I WHERE id = ANY($1) AND user_id IS DISTINCT FROM $2',
    p_table
  ) INTO bad_count USING p_ids, p_user_id;

  IF bad_count > 0 THEN
    RAISE EXCEPTION 'Unauthorized: one or more rows do not belong to caller';
  END IF;

  FOR i IN 1..array_length(p_ids, 1) LOOP
    EXECUTE format(
      'UPDATE %I SET sort_order = $1 WHERE id = $2 AND user_id = $3',
      p_table
    ) USING i - 1, p_ids[i], p_user_id;
  END LOOP;
END;
$$;


-- ── F-16: cleanup_activity_log — guard against p_keep < 1 ──────
--
-- p_keep = 0 deletes the entire activity log (self-DoS).
-- p_keep < 0 causes a Postgres error. Both are now rejected.
CREATE OR REPLACE FUNCTION cleanup_activity_log(p_user_id UUID, p_keep INT DEFAULT 500)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  deleted_count INT;
BEGIN
  IF auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'Unauthorized: caller does not match p_user_id';
  END IF;

  IF p_keep < 1 THEN
    RAISE EXCEPTION 'p_keep must be at least 1';
  END IF;

  WITH to_delete AS (
    SELECT id FROM activity_log
    WHERE user_id = p_user_id
    ORDER BY created_at DESC
    OFFSET p_keep
  )
  DELETE FROM activity_log WHERE id IN (SELECT id FROM to_delete);
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;
