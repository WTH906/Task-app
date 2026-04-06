-- ============================================================
-- Migration v3: Project deadline
-- Run in Supabase SQL Editor
-- ============================================================

ALTER TABLE projects ADD COLUMN IF NOT EXISTS deadline DATE;
