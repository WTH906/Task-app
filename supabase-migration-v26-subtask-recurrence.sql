-- v26: Add recurrence to subtasks
-- Mirrors project_tasks.recurrence (null | daily | weekly | monthly | yearly)

ALTER TABLE subtasks
  ADD COLUMN IF NOT EXISTS recurrence TEXT DEFAULT NULL;

COMMENT ON COLUMN subtasks.recurrence IS 'null | daily | weekly | monthly | yearly';
