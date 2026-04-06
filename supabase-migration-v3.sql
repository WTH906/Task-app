-- ============================================================
-- Migration v3: Project deadline + Subtask timer
-- Run in Supabase SQL Editor
-- ============================================================

ALTER TABLE projects ADD COLUMN IF NOT EXISTS deadline DATE;
ALTER TABLE subtasks ADD COLUMN IF NOT EXISTS elapsed_seconds REAL DEFAULT 0;
