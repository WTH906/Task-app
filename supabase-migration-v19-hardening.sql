-- ============================================================
-- Comfy Board — migration v19
-- Schema hardening: policy gaps, column types, missing indexes.
--
-- Run AFTER v18. Safe to re-run.
--
-- Nothing here changes application behaviour; it closes correctness gaps
-- found while auditing the full migration history (v1–v18).
-- ============================================================


-- ------------------------------------------------------------
-- 1. UPDATE policies missing WITH CHECK
--
-- `FOR UPDATE USING (user_id = auth.uid())` only gates which rows you may
-- update — it does NOT constrain what you may set them to. Without a
-- WITH CHECK clause a user can update their own row and rewrite user_id to
-- someone else's id, handing them the row (and, for quick_tasks/roadmap_data,
-- injecting content into another account's UI).
--
-- The tables created in the base schema already use
-- `FOR ALL USING (...) WITH CHECK (...)`; these are the per-verb ones from
-- v3 and v8 that were never given the second half.
-- ------------------------------------------------------------

DROP POLICY IF EXISTS "wrt_update" ON weekly_routine_tasks;
CREATE POLICY "wrt_update" ON weekly_routine_tasks FOR UPDATE
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "mrt_update" ON monthly_routine_tasks;
CREATE POLICY "mrt_update" ON monthly_routine_tasks FOR UPDATE
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "qt_update" ON quick_tasks;
CREATE POLICY "qt_update" ON quick_tasks FOR UPDATE
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "rd_update" ON roadmap_data;
CREATE POLICY "rd_update" ON roadmap_data FOR UPDATE
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "qt_insert" ON quick_tasks;
CREATE POLICY "qt_insert" ON quick_tasks FOR INSERT
  WITH CHECK (user_id = auth.uid());


-- ------------------------------------------------------------
-- 2. Missing UPDATE policies on the routine check tables
--
-- weekly_routine_checks and monthly_routine_checks were given SELECT,
-- INSERT and DELETE but no UPDATE. Today the app only inserts and deletes,
-- so this is latent rather than broken — but the day someone adds an
-- "uncheck without deleting" path it will fail silently under RLS.
-- ------------------------------------------------------------

DROP POLICY IF EXISTS "wrc_update" ON weekly_routine_checks;
CREATE POLICY "wrc_update" ON weekly_routine_checks FOR UPDATE
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "mrc_update" ON monthly_routine_checks;
CREATE POLICY "mrc_update" ON monthly_routine_checks FOR UPDATE
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());


-- ------------------------------------------------------------
-- 3. Date columns stored as TEXT
--
-- Every other date in the schema is a DATE. These three drifted to TEXT,
-- so they accept "not a date", sort lexically, and can't be used in date
-- arithmetic. PostgREST still returns DATE as a "YYYY-MM-DD" string, so no
-- application code changes.
--
-- Non-parseable values are nulled first so the ALTER can't fail on junk.
-- ------------------------------------------------------------

-- Guarded on the CURRENT column type: once converted these columns are DATE,
-- and the regex cleanup below would fail with "operator does not exist:
-- date !~ unknown" on a second run.
DO $$
DECLARE t TEXT;
BEGIN
  SELECT data_type INTO t FROM information_schema.columns
   WHERE table_name = 'week_tasks' AND column_name = 'rescheduled_to';
  IF t IN ('text', 'character varying') THEN
    UPDATE week_tasks SET rescheduled_to = NULL
      WHERE rescheduled_to IS NOT NULL
        AND rescheduled_to !~ '^\d{4}-\d{2}-\d{2}$';
    ALTER TABLE week_tasks
      ALTER COLUMN rescheduled_to TYPE DATE USING rescheduled_to::DATE;
  END IF;

  SELECT data_type INTO t FROM information_schema.columns
   WHERE table_name = 'projects' AND column_name = 'start_date';
  IF t IN ('text', 'character varying') THEN
    UPDATE projects SET start_date = NULL
      WHERE start_date IS NOT NULL
        AND start_date !~ '^\d{4}-\d{2}-\d{2}$';
    ALTER TABLE projects
      ALTER COLUMN start_date TYPE DATE USING start_date::DATE;
  END IF;

  SELECT data_type INTO t FROM information_schema.columns
   WHERE table_name = 'time_logs' AND column_name = 'date_key';
  IF t IN ('text', 'character varying') THEN
    DELETE FROM time_logs
      WHERE date_key IS NULL OR date_key !~ '^\d{4}-\d{2}-\d{2}$';
    ALTER TABLE time_logs
      ALTER COLUMN date_key TYPE DATE USING date_key::DATE;
  END IF;
END $$;


-- ------------------------------------------------------------
-- 4. FK consistency on monitored_tasks
--
-- task_id cascades on delete but subtask_id was SET NULL, so deleting a
-- monitored subtask silently converted the entry into a monitored *parent
-- task* pointing at a name that no longer exists.
-- ------------------------------------------------------------

DO $$
DECLARE con TEXT;
BEGIN
  SELECT conname INTO con
  FROM pg_constraint
  WHERE conrelid = 'monitored_tasks'::regclass
    AND contype = 'f'
    AND conkey = ARRAY[(
      SELECT attnum FROM pg_attribute
      WHERE attrelid = 'monitored_tasks'::regclass AND attname = 'subtask_id'
    )]::smallint[];

  IF con IS NOT NULL THEN
    EXECUTE format('ALTER TABLE monitored_tasks DROP CONSTRAINT %I', con);
  END IF;
END $$;

ALTER TABLE monitored_tasks
  ADD CONSTRAINT monitored_tasks_subtask_id_fkey
  FOREIGN KEY (subtask_id) REFERENCES subtasks(id) ON DELETE CASCADE;


-- ------------------------------------------------------------
-- 5. Missing indexes for pages that sort by them
-- ------------------------------------------------------------

-- /deadlines orders by target_datetime; there was no index on it.
CREATE INDEX IF NOT EXISTS idx_deadlines_user_target
  ON deadlines (user_id, target_datetime);

-- Stats groups time_logs by day within a bounded range.
CREATE INDEX IF NOT EXISTS idx_time_logs_user_date_range
  ON time_logs (user_id, date_key DESC);

-- The planner filters out rescheduled rows on every load.
CREATE INDEX IF NOT EXISTS idx_week_tasks_active
  ON week_tasks (user_id, date_key)
  WHERE rescheduled_to IS NULL;


-- ------------------------------------------------------------
-- 6. updated_at maintenance
--
-- roadmap_data and user_settings both carry updated_at, but nothing ever
-- sets it except the application remembering to. Make the database own it.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_roadmap_data_updated_at ON roadmap_data;
CREATE TRIGGER trg_roadmap_data_updated_at
  BEFORE UPDATE ON roadmap_data
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_user_settings_updated_at ON user_settings;
CREATE TRIGGER trg_user_settings_updated_at
  BEFORE UPDATE ON user_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ------------------------------------------------------------
-- 7. Settings that are declared but never used
--
-- v9 created user_settings to "replace localStorage feature flags", but the
-- app still reads every one of them from localStorage, so preferences don't
-- follow you between browsers or devices. Adding the two columns that are
-- still missing so the migration to DB-backed settings is a pure code change.
-- (See the production-readiness doc, "Settings" section.)
-- ------------------------------------------------------------

ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS yearly_routine_enabled BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS theme TEXT DEFAULT 'purple';
