-- ============================================================
-- Skeeball Ball Scores — RLS + Secure Submit RPC
--
-- Problem: skeeball_ball_scores had no permissive INSERT policy,
-- so direct client inserts (upsert) were blocked by RLS.
--
-- Fix:
--   1. Block all direct inserts via RLS (defense-in-depth)
--   2. rpc_skeeball_submit_balls — only write path, enforces:
--        • Caller must be authenticated
--        • Caller must be a player in the session
--        • Session must be active
--        • Each score must be a valid skee-ball ring value
-- ============================================================

-- Ensure RLS is enabled
ALTER TABLE public.skeeball_ball_scores ENABLE ROW LEVEL SECURITY;

-- Drop any old permissive policies
DROP POLICY IF EXISTS "skeeball_ball_scores_insert"   ON public.skeeball_ball_scores;
DROP POLICY IF EXISTS "skeeball_ball_scores_update"   ON public.skeeball_ball_scores;
DROP POLICY IF EXISTS "skeeball_ball_scores_no_write" ON public.skeeball_ball_scores;

-- SELECT: anyone can read (scores are not sensitive)
DROP POLICY IF EXISTS "skeeball_ball_scores_read" ON public.skeeball_ball_scores;
CREATE POLICY "skeeball_ball_scores_read" ON public.skeeball_ball_scores
  FOR SELECT USING (true);

-- Block all direct INSERT/UPDATE — only the RPC below can write
CREATE POLICY "skeeball_ball_scores_no_write" ON public.skeeball_ball_scores
  FOR INSERT WITH CHECK (false);


-- ── rpc_skeeball_submit_balls ──────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_skeeball_submit_balls(
  p_session_id uuid,
  p_balls      jsonb   -- [{player_user_id, ball_number, score}, ...]
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_ball jsonb;
  v_score int;
BEGIN
  -- Must be authenticated
  IF v_uid IS NULL THEN
    RETURN json_build_object('error', 'unauthorized',
      'message', 'Login required.');
  END IF;

  -- Caller must be a player in this session (scorekeeper rule)
  IF NOT EXISTS (
    SELECT 1 FROM skeeball_session_players
    WHERE session_id = p_session_id AND player_user_id = v_uid
  ) THEN
    RETURN json_build_object('error', 'unauthorized',
      'message', 'You are not in this session.');
  END IF;

  -- Session must still be active
  IF NOT EXISTS (
    SELECT 1 FROM skeeball_sessions
    WHERE id = p_session_id AND status = 'active'
  ) THEN
    RETURN json_build_object('error', 'invalid',
      'message', 'Session is no longer active.');
  END IF;

  -- Upsert each ball score
  FOR v_ball IN SELECT * FROM jsonb_array_elements(p_balls)
  LOOP
    v_score := (v_ball->>'score')::int;

    -- Only valid skee-ball ring values allowed
    IF v_score NOT IN (10, 20, 30, 40, 50, 100) THEN
      RETURN json_build_object('error', 'invalid',
        'message', 'Invalid ring value: ' || v_score::text);
    END IF;

    INSERT INTO skeeball_ball_scores
      (session_id, player_user_id, ball_number, score)
    VALUES (
      p_session_id,
      (v_ball->>'player_user_id')::uuid,
      (v_ball->>'ball_number')::int,
      v_score
    )
    ON CONFLICT (session_id, player_user_id, ball_number)
    DO UPDATE SET score = EXCLUDED.score;
  END LOOP;

  -- Bump last_activity_at so inactivity timer resets
  UPDATE skeeball_sessions
  SET last_activity_at = now()
  WHERE id = p_session_id;

  RETURN json_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_skeeball_submit_balls(uuid, jsonb) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.rpc_skeeball_submit_balls(uuid, jsonb) TO authenticated;
