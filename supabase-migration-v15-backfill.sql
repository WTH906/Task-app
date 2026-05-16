-- Backfill NULL monitoring values to false (migration v14 added DEFAULT false but existing rows got NULL)
UPDATE project_tasks SET monitoring = false WHERE monitoring IS NULL;
UPDATE subtasks SET monitoring = false WHERE monitoring IS NULL;
