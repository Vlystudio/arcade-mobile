-- ============================================================
-- Karaoke Queue — Rate Limiting & Spam Prevention
--
-- Run AFTER: karaoke-schema.sql
-- Idempotent — safe to re-run.
--
-- Changes:
--   1. Drop permissive direct-insert RLS policies
--   2. Block all direct inserts via RLS (defense-in-depth)
--   3. rpc_karaoke_add — the only insert path, enforces:
--        • Input validation (length, non-empty)
--        • Duplicate: same video_id can't be queued/playing twice
--        • Authenticated: rate limit 3 requests / 10 min via
--          check_and_log_rate_limit; max 3 songs queued at once
--        • Anonymous: global guest-queue cap of 5 concurrent songs
-- ============================================================


-- ── 1 & 2. Replace permissive insert policies with a hard block ──
-- rpc_karaoke_add is SECURITY DEFINER and bypasses RLS, so it
-- can still insert. All other paths (direct client insert) are denied.

DROP POLICY IF EXISTS "karaoke_insert_auth" ON public.karaoke_queue;
DROP POLICY IF EXISTS "karaoke_insert_anon" ON public.karaoke_queue;
DROP POLICY IF EXISTS "karaoke_no_direct_insert" ON public.karaoke_queue;

CREATE POLICY "karaoke_no_direct_insert" ON public.karaoke_queue
  FOR INSERT WITH CHECK (false);


-- ── 3. rpc_karaoke_add ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_karaoke_add(
  p_video_id       text,
  p_title          text,
  p_channel        text    DEFAULT '',
  p_thumbnail_url  text    DEFAULT NULL,
  p_requester_name text    DEFAULT 'Guest'
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_queued  int;
  v_name    text := trim(p_requester_name);
BEGIN

  -- ── Input validation ──────────────────────────────────────────
  IF p_video_id IS NULL OR trim(p_video_id) = '' THEN
    RETURN json_build_object('error', 'invalid',
      'message', 'Invalid video ID.');
  END IF;

  IF v_name = '' THEN
    RETURN json_build_object('error', 'invalid',
      'message', 'Enter your name so people know who requested it.');
  END IF;

  IF length(p_title) > 300 THEN
    RETURN json_build_object('error', 'invalid',
      'message', 'Song title is too long.');
  END IF;

  -- ── Duplicate check ──────────────────────────────────────────
  IF EXISTS (
    SELECT 1 FROM karaoke_queue
     WHERE video_id = p_video_id
       AND status IN ('queued', 'playing')
  ) THEN
    RETURN json_build_object('error', 'duplicate',
      'message', 'That song is already in the queue.');
  END IF;

  -- ── Authenticated user path ───────────────────────────────────
  IF v_user_id IS NOT NULL THEN

    -- Rate limit: max 3 requests per 10 minutes
    BEGIN
      PERFORM public.check_and_log_rate_limit('karaoke_request', 600, 3);
    EXCEPTION WHEN OTHERS THEN
      RETURN json_build_object('error', 'rate_limited',
        'message', 'You''re adding songs too fast. Wait a few minutes before requesting again.');
    END;

    -- Queue cap: no more than 3 of your songs waiting at once
    SELECT COUNT(*) INTO v_queued
      FROM karaoke_queue
     WHERE requested_by = v_user_id
       AND status = 'queued';

    IF v_queued >= 3 THEN
      RETURN json_build_object('error', 'queue_cap',
        'message', 'You already have 3 songs in the queue. Wait for one to play before adding more.');
    END IF;

    INSERT INTO karaoke_queue
      (video_id, title, channel, thumbnail_url, requested_by, requester_name)
    VALUES
      (p_video_id, p_title, coalesce(p_channel, ''), p_thumbnail_url, v_user_id, v_name);

  -- ── Anonymous (guest) path ────────────────────────────────────
  ELSE

    -- Global cap on concurrent anonymous requests
    SELECT COUNT(*) INTO v_queued
      FROM karaoke_queue
     WHERE requested_by IS NULL
       AND status = 'queued';

    IF v_queued >= 5 THEN
      RETURN json_build_object('error', 'queue_cap',
        'message', 'The guest request limit is full. Sign in to add more songs.');
    END IF;

    INSERT INTO karaoke_queue
      (video_id, title, channel, thumbnail_url, requested_by, requester_name)
    VALUES
      (p_video_id, p_title, coalesce(p_channel, ''), p_thumbnail_url, NULL, v_name);

  END IF;

  RETURN json_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_karaoke_add(text, text, text, text, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.rpc_karaoke_add(text, text, text, text, text) TO authenticated, anon;
