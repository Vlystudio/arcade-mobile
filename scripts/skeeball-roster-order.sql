-- ============================================================
-- Skee-Ball roster swap — large-roster support (4–8 players)
--
-- A game is always 9 balls / 3 shooters, but rosters can be bigger.
-- The Shooting Order panel now shows the full roster: the trio in the
-- session plus the bench. Before the first ball is recorded, a team
-- member can swap a bench player into the lineup.
--
-- Run AFTER: skeeball-qr-lane-checkin.sql
-- Idempotent — safe to re-run.
-- ============================================================

CREATE OR REPLACE FUNCTION public.rpc_skeeball_swap_session_player(
  p_session_id  uuid,
  p_out_user_id uuid,
  p_in_user_id  uuid
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
  IF v_uid IS NULL THEN RETURN json_build_object('error', 'not_authenticated'); END IF;

  SELECT * INTO v_session FROM skeeball_sessions
   WHERE id = p_session_id AND status = 'active';
  IF NOT FOUND THEN
    RETURN json_build_object('error', 'not_found', 'message', 'Session is no longer active.');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM team_members WHERE team_id = v_session.team_id AND user_id = v_uid) THEN
    RETURN json_build_object('error', 'not_team_member', 'message', 'Only team members can edit the lineup.');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM team_members WHERE team_id = v_session.team_id AND user_id = p_in_user_id) THEN
    RETURN json_build_object('error', 'invalid', 'message', 'That player is not on this team.');
  END IF;
  IF EXISTS (SELECT 1 FROM skeeball_session_players WHERE session_id = p_session_id AND player_user_id = p_in_user_id) THEN
    RETURN json_build_object('error', 'invalid', 'message', 'That player is already in the lineup.');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM skeeball_session_players WHERE session_id = p_session_id AND player_user_id = p_out_user_id) THEN
    RETURN json_build_object('error', 'invalid', 'message', 'The player being swapped out is not in the lineup.');
  END IF;
  -- Lineup is locked once any ball has been recorded
  IF EXISTS (SELECT 1 FROM skeeball_ball_scores WHERE session_id = p_session_id) THEN
    RETURN json_build_object('error', 'locked', 'message', 'Balls are already recorded — the lineup is locked for this game.');
  END IF;

  UPDATE skeeball_session_players
     SET player_user_id = p_in_user_id
   WHERE session_id = p_session_id AND player_user_id = p_out_user_id;

  RETURN json_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_skeeball_swap_session_player(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_skeeball_swap_session_player(uuid, uuid, uuid) TO authenticated;
