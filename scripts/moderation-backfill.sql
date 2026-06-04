-- ============================================================
-- Content Moderation Backfill
-- Scans all existing user content against moderation_patterns.
--
-- PART 1 (read-only): shows a count of what will be affected.
-- PART 2 (destructive): applies the cleanup.
--
-- Run PART 1 first, review the output, then run PART 2.
-- ============================================================


-- ── PART 1: Preview ──────────────────────────────────────────
-- Safe to run at any time — makes no changes.

SELECT
  tbl,
  category,
  severity,
  count(*) AS affected_rows,
  CASE
    WHEN severity >= 2 THEN 'will be deleted / cleared'
    ELSE                    'will be flagged only (spam)'
  END AS action
FROM (
  SELECT 'post_comments' AS tbl, content AS txt
  FROM post_comments WHERE content IS NOT NULL

  UNION ALL
  SELECT 'posts (content)', content
  FROM posts WHERE content IS NOT NULL

  UNION ALL
  SELECT 'profiles (bio)', bio
  FROM profiles WHERE bio IS NOT NULL

  UNION ALL
  SELECT 'team_messages', content
  FROM team_messages WHERE content IS NOT NULL

  UNION ALL
  SELECT 'team_announcements', content
  FROM team_announcements WHERE content IS NOT NULL

  UNION ALL
  SELECT 'forums', coalesce(title, '') || ' ' || coalesce(description, '')
  FROM forums
) raw
CROSS JOIN LATERAL (
  SELECT category, severity
  FROM moderation_patterns
  WHERE active AND lower(raw.txt) ~* pattern
  ORDER BY severity DESC, id ASC
  LIMIT 1
) match
GROUP BY tbl, category, severity
ORDER BY severity DESC, tbl;


-- ── PART 2: Cleanup ──────────────────────────────────────────
-- Run only after reviewing PART 1.
-- Each block is independent — run them all at once or one at a time.

-- post_comments: delete rows with severity >= 2
DELETE FROM post_comments
WHERE content IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM moderation_patterns
    WHERE active
      AND severity >= 2
      AND lower(post_comments.content) ~* pattern
  );

-- posts: clear content text (keep the row — it may have a photo/score)
UPDATE posts
SET content = NULL
WHERE content IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM moderation_patterns
    WHERE active
      AND severity >= 2
      AND lower(posts.content) ~* pattern
  );

-- profiles: clear bio (never delete the profile)
UPDATE profiles
SET bio = NULL
WHERE bio IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM moderation_patterns
    WHERE active
      AND severity >= 2
      AND lower(profiles.bio) ~* pattern
  );

-- team_messages: delete flagged messages
DELETE FROM team_messages
WHERE content IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM moderation_patterns
    WHERE active
      AND severity >= 2
      AND lower(team_messages.content) ~* pattern
  );

-- team_announcements: delete flagged announcements
DELETE FROM team_announcements
WHERE content IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM moderation_patterns
    WHERE active
      AND severity >= 2
      AND lower(team_announcements.content) ~* pattern
  );

-- forums: flag for admin review (do not auto-delete approved forums)
UPDATE forums
SET
  auto_flagged  = true,
  flag_category = (
    SELECT category FROM moderation_patterns
    WHERE active
      AND lower(coalesce(forums.title, '') || ' ' || coalesce(forums.description, '')) ~* pattern
    ORDER BY severity DESC, id ASC
    LIMIT 1
  )
WHERE
  auto_flagged = false
  AND EXISTS (
    SELECT 1 FROM moderation_patterns
    WHERE active
      AND lower(coalesce(forums.title, '') || ' ' || coalesce(forums.description, '')) ~* pattern
  );
