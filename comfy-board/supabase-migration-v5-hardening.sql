-- ============================================================
-- Migration v5: Hardening — FKs, CHECK constraints, indexes,
-- storage policies, activity cleanup
-- Run in Supabase SQL Editor
-- ============================================================

-- ── 1. Missing foreign keys to auth.users ─────────────────────
DO $$ BEGIN
  ALTER TABLE weekly_routine_tasks
    ADD CONSTRAINT wrt_user_fk FOREIGN KEY (user_id)
    REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE weekly_routine_checks
    ADD CONSTRAINT wrc_user_fk FOREIGN KEY (user_id)
    REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE roadmap_data
    ADD CONSTRAINT rd_user_fk FOREIGN KEY (user_id)
    REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE quick_tasks
    ADD CONSTRAINT qt_user_fk FOREIGN KEY (user_id)
    REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 2. CHECK constraints ──────────────────────────────────────
-- priority 1-5 on quick_tasks
DO $$ BEGIN
  ALTER TABLE quick_tasks ADD CONSTRAINT qt_priority_range
    CHECK (priority >= 1 AND priority <= 5);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- est_minutes >= 0
DO $$ BEGIN
  ALTER TABLE routine_tasks ADD CONSTRAINT rt_est_positive
    CHECK (est_minutes >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE weekly_routine_tasks ADD CONSTRAINT wrt_est_positive
    CHECK (est_minutes >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE project_tasks ADD CONSTRAINT pt_est_positive
    CHECK (est_minutes >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE subtasks ADD CONSTRAINT sub_est_positive
    CHECK (est_minutes >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- elapsed_seconds >= 0
DO $$ BEGIN
  ALTER TABLE project_tasks ADD CONSTRAINT pt_elapsed_positive
    CHECK (elapsed_seconds >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE subtasks ADD CONSTRAINT sub_elapsed_positive
    CHECK (elapsed_seconds >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE projects ADD CONSTRAINT proj_elapsed_positive
    CHECK (elapsed_seconds >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 3. Trigram indexes for search ─────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_projects_title_trgm
  ON projects USING GIN (title gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_project_tasks_name_trgm
  ON project_tasks USING GIN (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_project_tasks_notes_trgm
  ON project_tasks USING GIN (notes gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_routine_tasks_text_trgm
  ON routine_tasks USING GIN (text gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_deadlines_label_trgm
  ON deadlines USING GIN (label gin_trgm_ops);

-- ── 4. Batch reorder RPC ──────────────────────────────────────
-- SECURITY DEFINER bypasses RLS for performance, but we verify:
-- 1. The caller IS the user they claim to be (auth.uid() check)
-- 2. Only allowed tables can be targeted
-- 3. The WHERE clause includes user_id = p_user_id
-- NOTE: When shared projects land, the user_id check in the WHERE
-- clause will need to become a membership check instead.
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
    'routine_tasks', 'weekly_routine_tasks', 'project_tasks',
    'subtasks', 'week_tasks', 'projects', 'quick_tasks'
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

-- Special version for subtasks (keyed on task_id, not user_id for the update)
CREATE OR REPLACE FUNCTION reorder_subtasks(
  p_ids UUID[],
  p_user_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  i INT;
BEGIN
  -- Verify caller is who they claim to be
  IF auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'Unauthorized: caller does not match p_user_id';
  END IF;

  FOR i IN 1..array_length(p_ids, 1) LOOP
    UPDATE subtasks SET sort_order = i - 1
    WHERE id = p_ids[i] AND user_id = p_user_id;
  END LOOP;
END;
$$;

-- ── 5. Activity log cleanup (keep last 500 per user) ──────────
CREATE OR REPLACE FUNCTION cleanup_activity_log(p_user_id UUID, p_keep INT DEFAULT 500)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  deleted_count INT;
BEGIN
  -- Verify caller is who they claim to be
  IF auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'Unauthorized: caller does not match p_user_id';
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

-- ── 6. Fix storage policies ───────────────────────────────────
-- Drop existing overly-permissive policies
DROP POLICY IF EXISTS "Users can upload task files" ON storage.objects;
DROP POLICY IF EXISTS "Users can view task files" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete own task files" ON storage.objects;

-- Recreate with proper scoping
-- Upload: only into your own folder (userId/...)
CREATE POLICY "Users upload own task files"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'task-files'
  AND auth.role() = 'authenticated'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- View: public (files are referenced by URL in the app)
CREATE POLICY "Anyone can view task files"
ON storage.objects FOR SELECT
USING (bucket_id = 'task-files');

-- Delete: only your own folder
CREATE POLICY "Users delete own task files"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'task-files'
  AND auth.role() = 'authenticated'
  AND (storage.foldername(name))[1] = auth.uid()::text
);
