-- Input validation hardening.
-- Adds NOT VALID constraints so new/updated rows are enforced while existing
-- legacy rows can be cleaned up before VALIDATE CONSTRAINT is run.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'posts_content_len') THEN
    ALTER TABLE public.posts
      ADD CONSTRAINT posts_content_len
      CHECK (content IS NULL OR char_length(btrim(content)) BETWEEN 1 AND 1000)
      NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'post_comments_content_len') THEN
    ALTER TABLE public.post_comments
      ADD CONSTRAINT post_comments_content_len
      CHECK (char_length(btrim(content)) BETWEEN 1 AND 500)
      NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'forums_title_desc_len') THEN
    ALTER TABLE public.forums
      ADD CONSTRAINT forums_title_desc_len
      CHECK (
        char_length(btrim(title)) BETWEEN 3 AND 80
        AND (description IS NULL OR char_length(btrim(description)) <= 500)
      )
      NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'forum_posts_content_len') THEN
    ALTER TABLE public.forum_posts
      ADD CONSTRAINT forum_posts_content_len
      CHECK (char_length(btrim(content)) BETWEEN 1 AND 2000)
      NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'teams_name_len') THEN
    ALTER TABLE public.teams
      ADD CONSTRAINT teams_name_len
      CHECK (char_length(btrim(name)) BETWEEN 2 AND 40)
      NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tournament_requests_text_len') THEN
    ALTER TABLE public.tournament_requests
      ADD CONSTRAINT tournament_requests_text_len
      CHECK (
        char_length(btrim(title)) BETWEEN 3 AND 80
        AND (description IS NULL OR char_length(btrim(description)) <= 1000)
      )
      NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'messages_content_len') THEN
    ALTER TABLE public.messages
      ADD CONSTRAINT messages_content_len
      CHECK (content IS NULL OR char_length(btrim(content)) <= 2000)
      NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'team_messages_content_len') THEN
    ALTER TABLE public.team_messages
      ADD CONSTRAINT team_messages_content_len
      CHECK (char_length(btrim(content)) BETWEEN 1 AND 2000)
      NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'team_announcements_content_len') THEN
    ALTER TABLE public.team_announcements
      ADD CONSTRAINT team_announcements_content_len
      CHECK (char_length(btrim(content)) BETWEEN 1 AND 2000)
      NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'support_messages_content_len') THEN
    ALTER TABLE public.support_messages
      ADD CONSTRAINT support_messages_content_len
      CHECK (char_length(btrim(content)) BETWEEN 1 AND 2000)
      NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'scores_value_bounds') THEN
    ALTER TABLE public.scores
      ADD CONSTRAINT scores_value_bounds
      CHECK (score BETWEEN 0 AND 999999999)
      NOT VALID;
  END IF;
END $$;
