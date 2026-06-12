-- Comments on forum posts
CREATE TABLE IF NOT EXISTS forum_post_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES forum_posts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT forum_post_comments_content_len
    CHECK (char_length(btrim(content)) BETWEEN 1 AND 1000)
);

CREATE INDEX IF NOT EXISTS idx_forum_post_comments_post
  ON forum_post_comments (post_id, created_at);

ALTER TABLE forum_post_comments ENABLE ROW LEVEL SECURITY;

-- Any signed-in user can read comments
DROP POLICY IF EXISTS "comments_select" ON forum_post_comments;
CREATE POLICY "comments_select" ON forum_post_comments
  FOR SELECT TO authenticated USING (true);

-- Users can only comment as themselves
DROP POLICY IF EXISTS "comments_insert_own" ON forum_post_comments;
CREATE POLICY "comments_insert_own" ON forum_post_comments
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

-- Users can delete their own comments; admins can delete any
DROP POLICY IF EXISTS "comments_delete" ON forum_post_comments;
CREATE POLICY "comments_delete" ON forum_post_comments
  FOR DELETE TO authenticated USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND role IN ('admin', 'owner', 'architect')
    )
  );
