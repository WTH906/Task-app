-- ============================================================
-- Comfy Board — migration v21
-- Feature toggles, onboarding state, and removal of the "[Project]"
-- prefix baked into planner rows.
--
-- Run AFTER v19 (it references yearly_routine_enabled, added there).
-- Safe to run twice.
-- ============================================================


-- ------------------------------------------------------------
-- 1. Settings that actually live in the database
--
-- v9 created user_settings to "replace localStorage feature flags", but the
-- app kept reading every flag from localStorage — so preferences never
-- followed you between browsers or devices. These two columns are what the
-- feature picker needs.
-- ------------------------------------------------------------

ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS features JSONB DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS onboarded_at TIMESTAMPTZ DEFAULT NULL;

COMMENT ON COLUMN user_settings.features IS
  'Feature toggle map, e.g. {"contacts":true,"workClock":false}. Missing keys fall back to the defaults in lib/features.ts';
COMMENT ON COLUMN user_settings.onboarded_at IS
  'When the first-run guide was completed or skipped. NULL = show it.';


-- ------------------------------------------------------------
-- 2. Existing accounts keep everything they had
--
-- IMPORTANT: the code defaults most features to OFF, because that's the right
-- starting point for someone opening the app for the first time. It is NOT
-- the right thing to do to an existing user — every one of these features was
-- unconditionally available before this migration, so defaulting them off
-- would silently strip five nav entries plus the per-task attachment and
-- calendar buttons out from under them.
--
-- So every account that exists right now is written a COMPLETE map with the
-- old behaviour preserved, and marked as already onboarded. Only genuinely
-- new accounts (no row here) fall through to the minimal code defaults and
-- see the first-run guide.
--
-- Note this INSERTs rather than only UPDATEs: user_settings rows were created
-- lazily — in practice only by clocking in — so most users have no row at all
-- and an UPDATE would miss them entirely.
-- ------------------------------------------------------------

INSERT INTO user_settings (user_id, features, onboarded_at, updated_at)
SELECT
  u.id,
  jsonb_build_object(
    -- Core
    'projects', true, 'planner', true, 'taskList', true, 'quickCapture', true,
    -- Routines: daily and weekly were always visible; monthly/yearly were
    -- behind the existing localStorage flags, so carry those across.
    'dailyRoutine',   true,
    'weeklyRoutine',  true,
    'monthlyRoutine', COALESCE(s.monthly_routine_enabled, false),
    'yearlyRoutine',  COALESCE(s.yearly_routine_enabled, false),
    -- Everything below was unconditional before today.
    'timers', true, 'deadlines', true, 'stats', true,
    'workClock', true, 'monitoring', true,
    'contacts', true, 'attachments', true, 'gcal', true,
    'templates', true, 'roadmap', true, 'retro', true
  ),
  now(),
  now()
FROM auth.users u
LEFT JOIN user_settings s ON s.user_id = u.id
ON CONFLICT (user_id) DO UPDATE
  SET features     = COALESCE(user_settings.features, EXCLUDED.features),
      onboarded_at = COALESCE(user_settings.onboarded_at, EXCLUDED.onboarded_at);
-- COALESCE on both sides makes this idempotent: a second run leaves an
-- already-populated map and an already-set timestamp untouched.


-- ------------------------------------------------------------
-- 3. Drop the "[Project]" prefix from planner rows
--
-- week_tasks.text stored a RENDERED string — "[Partnerships] Draft the
-- agreement" — which had two costs:
--
--   * At seven columns wide, the prefix ate roughly 40% of the available
--     line width on every project-linked row, wrapping short task names
--     onto three lines.
--   * It was the app's second source of truth for which project a task
--     belongs to. Renaming a project, or dragging a task to a different
--     one, left the old name baked into the string — so the planner
--     coloured it wrong and counted it under the wrong tag in stats.
--
-- The project is now resolved through week_tasks.project_id and rendered as
-- a coloured left border. The "↳" subtask marker comes from
-- week_tasks.subtask_id rather than from the text.
--
-- The match is anchored on the row's ACTUAL project title rather than "any
-- leading [...]". A blanket regexp_replace would mangle a task legitimately
-- named "[DRAFT] proposal", and — because the header promises this file is
-- re-runnable — would strip a second bracket on the next run. Matching the
-- real title makes it both safe and naturally idempotent: once the prefix is
-- gone, nothing matches.
-- ------------------------------------------------------------

-- Subtask rows: "[Project] ↳ Name" → "Name"
UPDATE week_tasks w
SET text = substring(w.text FROM char_length('[' || p.title || '] ↳ ') + 1)
FROM projects p
WHERE w.project_id = p.id
  AND w.subtask_id IS NOT NULL
  AND w.text LIKE '[' || p.title || '] ↳ %';

-- Main task rows: "[Project] Name" → "Name"
UPDATE week_tasks w
SET text = substring(w.text FROM char_length('[' || p.title || '] ') + 1)
FROM projects p
WHERE w.project_id = p.id
  AND w.text LIKE '[' || p.title || '] %'
  AND w.text NOT LIKE '[' || p.title || '] ↳ %';

-- A row whose project was renamed after the prefix was written still carries
-- the OLD name, so the two statements above can't match it. Fall back to
-- stripping a leading bracket only when what's inside it matches some project
-- title of this user's — never an arbitrary "[...]".
UPDATE week_tasks w
SET text = regexp_replace(w.text, '^\[[^\]]*\]\s*(↳\s*)?', '')
WHERE w.project_id IS NOT NULL
  AND w.text ~ '^\[[^\]]*\]'
  AND EXISTS (
    SELECT 1 FROM projects p
    WHERE p.user_id = w.user_id
      AND w.text LIKE '[' || p.title || ']%'
  );

-- Guard against a task whose name was ONLY the prefix.
UPDATE week_tasks SET text = '(untitled)'
WHERE project_id IS NOT NULL AND btrim(text) = '';

-- NOTE: `deadlines.label` deliberately KEEPS its "[Project] Name" prefix.
-- That page is full-width, has no project_id column to join through, and the
-- label is also what gets exported to Google Calendar.
