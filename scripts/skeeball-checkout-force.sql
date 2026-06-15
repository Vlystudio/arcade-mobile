-- ============================================================
-- Skee-Ball self-checkout: optional force flag
--
-- rpc_skeeball_cancel_session gains p_force. Default (false) keeps the
-- existing behavior: refuses if balls were already recorded in the DB.
-- With p_force = true, a team member may abandon their own active session
-- even after balls were recorded — used by the tracker's Back button when
-- the player confirms they want to discard an in-progress game and free the
-- lane. Either way the session is marked 'abandoned' (never finalized), so
-- nothing is stored to the leaderboard/standings.
--
-- Run AFTER: skeeball-lane-checkout.sql
-- Idempotent — safe to re-run.
-- ============================================================

CREATE OR REPLACE FUNCTION public.rpc_skeeball_cancel_session(
  p_session_id uuid,
  p_force      boolean DEFAULT false
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_session record;
BEGIN
  IF v_uid IS NULL THEN
    RETURN json_build_object('error', 'not_authenticated');
  END IF;

  SELECT * INTO v_session
    FROM skeeball_sessions
   WHERE id = p_session_id AND status = 'active';
  IF NOT FOUND THEN
    RETURN json_build_object('error', 'not_found',
      'message', 'No active check-in found — it may already be finished.');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM team_members
     WHERE team_id = v_session.team_id AND user_id = v_uid
  ) THEN
    RETURN json_build_object('error', 'not_team_member',
      'message', 'Only members of this team can check it out of a lane.');
  END IF;

  -- Without force: refuse if balls were already recorded (DB). With force:
  -- the player has confirmed they want to discard the game and free the lane.
  IF NOT p_force AND EXISTS (SELECT 1 FROM skeeball_ball_scores WHERE session_id = p_session_id) THEN
    RETURN json_build_object('error', 'has_scores',
      'message', 'Balls have already been recorded for this game. Finish the game, or ask an admin to clear the lane.');
  END IF;

  UPDATE skeeball_sessions
     SET status = 'abandoned', last_activity_at = now()
   WHERE id = p_session_id;

  RETURN json_build_object('ok', true, 'lane_number', v_session.lane_number);
END;
$$;

-- Drop the original 1-arg overload created by skeeball-lane-checkout.sql.
-- Keeping both made PostgREST ambiguous for single-arg calls
-- ("could not choose the best candidate function"). The 2-arg version with
-- p_force DEFAULT false serves callers passing either one or two args.
DROP FUNCTION IF EXISTS public.rpc_skeeball_cancel_session(uuid);

REVOKE ALL ON FUNCTION public.rpc_skeeball_cancel_session(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_skeeball_cancel_session(uuid, boolean) TO authenticated;
