-- ============================================================
-- Migration v16: Yearly routine tasks
-- ============================================================
CREATE TABLE IF NOT EXISTS yearly_routine_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  est_minutes INT DEFAULT 0,
  month_from INT DEFAULT NULL,  -- 1-12 (Jan-Dec), NULL = anytime
  month_to INT DEFAULT NULL,    -- 1-12, NULL = anytime
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_yearly_routine_user ON yearly_routine_tasks(user_id, sort_order);

ALTER TABLE yearly_routine_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users own yearly_routine_tasks" ON yearly_routine_tasks
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Yearly routine check state (per-year completion tracking)
CREATE TABLE IF NOT EXISTS yearly_routine_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  task_id UUID NOT NULL REFERENCES yearly_routine_tasks(id) ON DELETE CASCADE,
  year INT NOT NULL,
  checked BOOLEAN DEFAULT false,
  checked_at TIMESTAMPTZ DEFAULT NULL,
  UNIQUE(user_id, task_id, year)
);

ALTER TABLE yearly_routine_checks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users own yearly_routine_checks" ON yearly_routine_checks
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
