-- ============================================================
-- Migration: Add file attachments to tasks and subtasks
-- Run this in the Supabase SQL Editor AFTER the initial schema
-- ============================================================

-- Add file columns to project_tasks
ALTER TABLE project_tasks ADD COLUMN IF NOT EXISTS file_url TEXT;
ALTER TABLE project_tasks ADD COLUMN IF NOT EXISTS file_name TEXT;

-- Add file columns to subtasks
ALTER TABLE subtasks ADD COLUMN IF NOT EXISTS file_url TEXT;
ALTER TABLE subtasks ADD COLUMN IF NOT EXISTS file_name TEXT;

-- ============================================================
-- Storage bucket setup
-- ============================================================
-- Also create the storage bucket manually:
-- 1. Go to Supabase Dashboard → Storage
-- 2. Click "New bucket"
-- 3. Name: "task-files"
-- 4. Toggle "Public bucket" ON (so files are accessible via URL)
-- 5. Click "Create bucket"
--
-- Then add this storage policy (paste in SQL Editor):

INSERT INTO storage.buckets (id, name, public)
VALUES ('task-files', 'task-files', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Users can upload task files"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'task-files'
  AND auth.role() = 'authenticated'
);

CREATE POLICY "Users can view task files"
ON storage.objects FOR SELECT
USING (bucket_id = 'task-files');

CREATE POLICY "Users can delete own task files"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'task-files'
  AND auth.role() = 'authenticated'
);
