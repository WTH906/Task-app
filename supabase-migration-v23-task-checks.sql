-- ============================================================
-- Comfy Board — migration v23
-- Per-period completion for recurring project tasks.
--
-- Run AFTER v21.
-- (v22 is reserved for the skill-tree standalone, so the numbers don't
-- collide if you ever fold it in.)
--
-- Safe to run twice.
--
-- ── What this changes ───────────────────────────────────────────────
--
-- A recurring task had a SINGLE `progress` value. Tick "Weekly invoicing"
-- and it reads 100% forever — there was no way to say "done this week, not
-- yet done next week", which is the whole point of a repeating task. It
-- also meant every recurring task was permanently counted as finished by
-- the stats queries.
--
-- Completion now lives per period, exactly like the routine tables
-- (routine_checks, weekly_routine_checks, monthly_routine_checks,
-- yearly_routine_checks). When the period rolls over the task is simply
-- unchecked again. That is the "refresh".
--
-- ── What this deliberately does NOT change ──────────────────────────
--
-- The materialised occurrences in `week_tasks` stay exactly where they
-- are. They are what puts a repeating task on the calendar on the right
-- days, and that path is tested and working. The split is now:
--
--   project_task_checks  →  WAS THIS PERIOD DONE.  Canonical.
--   week_tasks           →  WHERE IT APPEARS.      Scheduling; its `done`
--                           flag is a cached mirror of the check.
--
-- Both are written by one function (setTaskCheck in lib/recurrence.ts) and
-- by nothing else, so they can't drift apart the way the old hand-synced
-- call sites did.
-- ============================================================


-- ------------------------------------------------------------
-- 1. The check table
--
-- period_key uses the same shapes the routine tables already use, produced
-- by the helpers in lib/recurrence.ts:
--   daily    '2026-08-19'
--   weekly   '2026-W34'    (ISO week)
--   monthly  '2026-08'
--   yearly   '2026'
--
-- One row per COMPLETION, not per occurrence: a daily task you have done
-- twice is two rows, not ninety.
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS project_task_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  task_id UUID NOT NULL REFERENCES project_tasks(id) ON DELETE CASCADE,
  period_key TEXT NOT NULL,
  checked_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (user_id, task_id, period_key)
);

-- The read path is "all checks for these task ids, for me".
CREATE INDEX IF NOT EXISTS idx_ptc_user_task
  ON project_task_checks (user_id, task_id);

CREATE INDEX IF NOT EXISTS idx_ptc_task_period
  ON project_task_checks (task_id, period_key);

ALTER TABLE project_task_checks ENABLE ROW LEVEL SECURITY;

-- WITH CHECK matters as much as USING here: without it a client could
-- write a row carrying somebody else's user_id.
DROP POLICY IF EXISTS "Users own project_task_checks" ON project_task_checks;
CREATE POLICY "Users own project_task_checks" ON project_task_checks
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);


-- ------------------------------------------------------------
-- 2. Carry existing completions across
--
-- Every materialised occurrence that was already ticked becomes a check for
-- the period its date falls in. Nothing is lost: if you completed the
-- weekly invoicing in week 31, that stays true, and the streak counts it.
--
-- to_char's IYYY/IW are ISO year and ISO week, which is what getWeekKey()
-- in lib/utils.ts produces. Note IYYY, not YYYY — for a date in the first
-- days of January the ISO year can be the previous calendar year, and
-- mixing the two would produce a key like '2027-W53' that never matches.
--
-- DISTINCT ON collapses the several occurrences a weekly or monthly task
-- can have inside one period down to a single check.
--
-- ⚠ ONE CAVEAT WORTH KNOWING BEFORE YOU RUN THIS.
--
-- Under the old model, ticking a repeating task in the PROJECT TAB set
-- done = true on every occurrence up to today in one go. Ticking a single
-- day in the planner set only that day. Both look identical in the data, so
-- the backfill cannot tell them apart — which means a task you completed
-- once from the project tab can arrive with a long "streak" it didn't earn.
--
-- Individually-ticked planner days are the common case and they carry
-- across correctly, so the backfill is worth having. If a streak looks wrong
-- afterwards, this trims a task back to its most recent period:
--
--   DELETE FROM project_task_checks c
--   WHERE c.task_id = '<task-uuid>'
--     AND c.period_key < (SELECT max(period_key)
--                         FROM project_task_checks WHERE task_id = c.task_id);
--
-- Nothing else depends on the history, so trimming is safe.
-- ------------------------------------------------------------

INSERT INTO project_task_checks (user_id, task_id, period_key, checked_at)
SELECT DISTINCT ON (w.user_id, w.project_task_id, k.period_key)
  w.user_id,
  w.project_task_id,
  k.period_key,
  COALESCE(w.created_at, now())
FROM week_tasks w
JOIN project_tasks pt ON pt.id = w.project_task_id
CROSS JOIN LATERAL (
  SELECT CASE pt.recurrence
    WHEN 'daily'   THEN to_char(w.date_key, 'YYYY-MM-DD')
    WHEN 'weekly'  THEN to_char(w.date_key, 'IYYY-"W"IW')
    WHEN 'monthly' THEN to_char(w.date_key, 'YYYY-MM')
    WHEN 'yearly'  THEN to_char(w.date_key, 'YYYY')
  END AS period_key
) k
WHERE w.done = true
  AND w.subtask_id IS NULL
  AND pt.recurrence IS NOT NULL
  AND k.period_key IS NOT NULL
  -- week_tasks.user_id is nullable in the original schema; project_task_checks
  -- .user_id is NOT NULL. One legacy row with a null owner would abort this
  -- INSERT and leave the migration half-applied.
  AND w.user_id IS NOT NULL
ON CONFLICT (user_id, task_id, period_key) DO NOTHING;


-- 2b. Recurring tasks that were finished but have no planner rows at all.
--
-- A task can be at progress = 100 with nothing in week_tasks: archived (the
-- mirrors were deleted with it), or given a recurrence but never scheduled.
-- Step 3 below zeroes its progress, so without this its completion would
-- simply vanish. Credit it to the period its own date_key falls in, or to
-- today if it has none.

INSERT INTO project_task_checks (user_id, task_id, period_key, checked_at)
SELECT pt.user_id, pt.id, k.period_key, now()
FROM project_tasks pt
CROSS JOIN LATERAL (
  SELECT CASE pt.recurrence
    WHEN 'daily'   THEN to_char(COALESCE(pt.date_key, CURRENT_DATE), 'YYYY-MM-DD')
    WHEN 'weekly'  THEN to_char(COALESCE(pt.date_key, CURRENT_DATE), 'IYYY-"W"IW')
    WHEN 'monthly' THEN to_char(COALESCE(pt.date_key, CURRENT_DATE), 'YYYY-MM')
    WHEN 'yearly'  THEN to_char(COALESCE(pt.date_key, CURRENT_DATE), 'YYYY')
  END AS period_key
) k
WHERE pt.recurrence IS NOT NULL
  AND pt.progress >= 100
  AND k.period_key IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM project_task_checks c WHERE c.task_id = pt.id
  )
ON CONFLICT (user_id, task_id, period_key) DO NOTHING;


-- ------------------------------------------------------------
-- 3. `progress` no longer means anything on a recurring task
--
-- Completion is per period now. A task left at 100% under the old model
-- would otherwise render as permanently finished and keep inflating the
-- stats. Reset it once.
--
-- Only the 100% rows are touched, so a recurring task you had part-way
-- through keeps whatever partial progress it had — and it is bounded to
-- recurring tasks, so nothing one-off is affected.
--
-- Re-running is harmless: after the first run there is nothing left at 100.
-- ------------------------------------------------------------

UPDATE project_tasks
SET progress = 0
WHERE recurrence IS NOT NULL AND progress >= 100;


-- ------------------------------------------------------------
-- 4. Sanity check
--
-- Run this on its own afterwards if you want to see what moved.
-- ------------------------------------------------------------

-- SELECT pt.name, pt.recurrence, count(c.id) AS periods_completed
-- FROM project_tasks pt
-- LEFT JOIN project_task_checks c ON c.task_id = pt.id
-- WHERE pt.recurrence IS NOT NULL
-- GROUP BY pt.id, pt.name, pt.recurrence
-- ORDER BY periods_completed DESC;
