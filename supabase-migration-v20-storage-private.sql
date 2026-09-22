-- ============================================================
-- Comfy Board — migration v20
-- Lock down the task-files storage bucket.
--
-- ⚠ RUN THIS ONLY TOGETHER WITH THE UPDATED components/FileAttachment.tsx.
--    The old component stored absolute public URLs and rendered them in an
--    <a href>. Once the bucket is private those URLs return 400. The updated
--    component stores the object PATH and mints a short-lived signed URL when
--    the user clicks — it also keeps working for legacy rows that still hold
--    an absolute URL, but those specific files become unreadable until
--    re-uploaded (see the backfill note at the bottom).
--
-- WHY: the bucket was created with public = true, and the SELECT policy is
--
--     CREATE POLICY "Anyone can view task files"
--       ON storage.objects FOR SELECT USING (bucket_id = 'task-files');
--
-- with no auth check at all. That is not "obscure URL" protection — it means
-- anyone holding the public anon key (which ships in the browser bundle of
-- every deployment) can LIST the bucket and download every file every user has
-- ever attached to a task: contracts, invoices, screenshots, anything.
-- ============================================================


-- 1. Make the bucket private. Public URLs stop resolving immediately.
UPDATE storage.buckets SET public = false WHERE id = 'task-files';


-- 2. Replace the wide-open read policy with an owner-scoped one.
--    Files are stored under "<user_id>/<file>", so the first path segment is
--    the owner. Signed URLs are minted server-side by Supabase after this
--    policy passes, so the app keeps working through createSignedUrl().
DROP POLICY IF EXISTS "Anyone can view task files" ON storage.objects;
DROP POLICY IF EXISTS "Users can view task files" ON storage.objects;
DROP POLICY IF EXISTS "Users read own task files" ON storage.objects;

CREATE POLICY "Users read own task files"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'task-files'
  AND auth.role() = 'authenticated'
  AND (storage.foldername(name))[1] = auth.uid()::text
);


-- 3. Re-assert the write policies (v5 already scoped these correctly; this is
--    idempotent belt-and-braces in case an older, wider version is still live).
DROP POLICY IF EXISTS "Users can upload task files" ON storage.objects;
DROP POLICY IF EXISTS "Users upload own task files" ON storage.objects;
CREATE POLICY "Users upload own task files"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'task-files'
  AND auth.role() = 'authenticated'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

DROP POLICY IF EXISTS "Users can delete own task files" ON storage.objects;
DROP POLICY IF EXISTS "Users delete own task files" ON storage.objects;
CREATE POLICY "Users delete own task files"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'task-files'
  AND auth.role() = 'authenticated'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- UPDATE was never granted, so overwriting someone else's object was already
-- impossible — but upload() with upsert:true needs it for your own files.
DROP POLICY IF EXISTS "Users update own task files" ON storage.objects;
CREATE POLICY "Users update own task files"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'task-files'
  AND auth.role() = 'authenticated'
  AND (storage.foldername(name))[1] = auth.uid()::text
)
WITH CHECK (
  bucket_id = 'task-files'
  AND auth.role() = 'authenticated'
  AND (storage.foldername(name))[1] = auth.uid()::text
);


-- ------------------------------------------------------------
-- 4. Backfill: convert stored public URLs to bare object paths.
--
-- The new component treats a value starting with http(s):// as legacy and
-- opens it directly — which will now fail. Rewriting them to paths makes the
-- signed-URL path apply to historical attachments too.
--
-- Verify the extracted paths look right before committing:
--
--   SELECT file_url, split_part(file_url, '/task-files/', 2)
--   FROM project_tasks WHERE file_url LIKE 'http%';
-- ------------------------------------------------------------

UPDATE project_tasks
SET file_url = split_part(file_url, '/task-files/', 2)
WHERE file_url LIKE 'http%/task-files/%';

UPDATE subtasks
SET file_url = split_part(file_url, '/task-files/', 2)
WHERE file_url LIKE 'http%/task-files/%';
