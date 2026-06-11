-- Bug reports table + storage bucket
-- Run on: prod (ahtynqcogyqhcrvqdsmi), staging (nyhpfvivyhsbvgfrmact)

-- Table
CREATE TABLE IF NOT EXISTS bug_reports (
  id             uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid         REFERENCES profiles(id) ON DELETE SET NULL,
  route          text,
  error_message  text         NOT NULL,
  description    text,
  screenshot_url text,
  device_info    text,
  created_at     timestamptz  NOT NULL DEFAULT now()
);

ALTER TABLE bug_reports ENABLE ROW LEVEL SECURITY;

-- Anyone (authenticated or not) can insert
DROP POLICY IF EXISTS "insert_bug_reports" ON bug_reports;
CREATE POLICY "insert_bug_reports" ON bug_reports
  FOR INSERT WITH CHECK (true);

-- Admins/owners can read
DROP POLICY IF EXISTS "admin_read_bug_reports" ON bug_reports;
CREATE POLICY "admin_read_bug_reports" ON bug_reports
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('admin', 'owner', 'architect')
    )
  );

-- Storage bucket (public so screenshot URLs work directly in admin view)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'bug-reports',
  'bug-reports',
  true,
  5242880,  -- 5 MB per screenshot
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO NOTHING;

-- Anyone can upload to bug-reports bucket (unauthenticated bug reports are valid)
DROP POLICY IF EXISTS "upload_bug_screenshots" ON storage.objects;
CREATE POLICY "upload_bug_screenshots" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'bug-reports');

-- Public read (bucket is public, but explicit policy for clarity)
DROP POLICY IF EXISTS "public_read_bug_screenshots" ON storage.objects;
CREATE POLICY "public_read_bug_screenshots" ON storage.objects
  FOR SELECT USING (bucket_id = 'bug-reports');
