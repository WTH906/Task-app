-- ============================================================
-- Comfy Board — migration v24
-- Time blocks: scheduling a planner entry between two hours.
--
-- Run AFTER v23.
-- Safe to run twice.
--
-- ── What this is for ────────────────────────────────────────────────
--
-- The pipeline is: create a task in a project → give it a date and it
-- appears on the calendar → optionally pin it to a precise time on that
-- day. The hour grid on the day page then shows the day laid out.
--
-- Only the last step is new. `date_key` already answers "which day"; this
-- adds "and when, within it".
--
-- ── Why it lives on week_tasks, not project_tasks ───────────────────
--
-- A time is a property of the PLACEMENT, not of the task. Putting it here
-- buys two things for free:
--
--   * quick-capture and hand-typed planner entries can be scheduled too,
--     without belonging to a project
--   * a repeating task can have one occurrence moved without affecting
--     the others — "just today's standup is at 11:00" needs no special
--     case, because the planner row already IS the occurrence
--
-- ── Why minutes-from-midnight and not TIME or TIMESTAMPTZ ───────────
--
-- A local day is always 0–1440 in wall-clock terms, including the days
-- clocks change. A TIMESTAMPTZ would drag UTC conversion into a value
-- that has no business knowing about timezones, which is the shape of
-- every date bug this codebase has had. An INT is also what the grid
-- needs for layout arithmetic, so nothing has to convert on render.
--
-- 0 = 00:00, 540 = 09:00, 1440 = midnight at the END of the day.
-- ============================================================


-- ------------------------------------------------------------
-- 1. The columns
--
-- Both NULL = unscheduled, which is every existing row and stays the
-- default. Nothing about the current planner changes until someone sets
-- a time.
-- ------------------------------------------------------------

ALTER TABLE week_tasks ADD COLUMN IF NOT EXISTS start_minute INTEGER;
ALTER TABLE week_tasks ADD COLUMN IF NOT EXISTS end_minute   INTEGER;


-- ------------------------------------------------------------
-- 2. Keep the pair honest
--
-- The invariant is: either both are NULL, or both are set with a
-- positive duration inside a single day. A half-set pair would render as
-- a block with no height, or one that runs off the bottom of the grid.
--
-- Enforced in the database rather than only in the client because the
-- planner writes these from four different screens, and a constraint is
-- the one thing all four cannot forget.
--
-- Dropped first so re-running picks up any change to the rule.
-- ------------------------------------------------------------

ALTER TABLE week_tasks DROP CONSTRAINT IF EXISTS week_tasks_block_valid;

ALTER TABLE week_tasks ADD CONSTRAINT week_tasks_block_valid CHECK (
  (start_minute IS NULL AND end_minute IS NULL)
  OR (
    start_minute IS NOT NULL AND end_minute IS NOT NULL
    AND start_minute >= 0
    AND end_minute   <= 1440
    AND end_minute   >  start_minute
  )
);


-- ------------------------------------------------------------
-- 3. Index
--
-- The day view's query is "this user's rows for this date, in time
-- order". Partial, because the overwhelming majority of rows are
-- unscheduled and there is no reason to carry them in this index.
-- ------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_week_tasks_day_block
  ON week_tasks (user_id, date_key, start_minute)
  WHERE start_minute IS NOT NULL;


-- ------------------------------------------------------------
-- 4. Nothing is backfilled, on purpose
--
-- There is no honest way to guess what time an existing task was meant
-- to happen. `est_minutes` says how long the work takes, not when you
-- intended to do it, and inventing 09:00 for everything would fill the
-- first hour of every past day with blocks nobody asked for.
--
-- Existing rows stay unscheduled and behave exactly as they do now.
-- ------------------------------------------------------------


-- ------------------------------------------------------------
-- 5. Sanity check
--
-- Run on its own afterwards to see what's scheduled.
-- ------------------------------------------------------------

-- SELECT date_key, text,
--        to_char((start_minute || ' minutes')::interval, 'HH24:MI') AS starts,
--        to_char((end_minute   || ' minutes')::interval, 'HH24:MI') AS ends,
--        end_minute - start_minute AS minutes
-- FROM week_tasks
-- WHERE start_minute IS NOT NULL
-- ORDER BY date_key, start_minute;
