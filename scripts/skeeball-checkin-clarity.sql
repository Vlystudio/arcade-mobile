-- ============================================================
-- Skee-Ball check-in clarity: explain the "already checked in" case
--
-- A team can only hold one active lane at a time. Previously, scanning a
-- DIFFERENT lane while already checked in silently returned the existing
-- lane, which looks like "every QR goes to the same lane." This adds a
-- lane_mismatch flag + a clear message so the app can tell the user they're
-- already on lane X and must check out before switching.
--
-- Only the already_active branch changes; all other behavior is identical.
--
-- Run AFTER: skeeball-finalize-fix.sql (or whichever defines start_qr_session)
-- Idempotent — safe to re-run.
-- ============================================================

CREATE OR REPLACE FUNCTION public.rpc_skeeball_start_qr_session(p_token text, p_team_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_lane record;
  v_team record;
  v_existing record;
  v_match_id uuid;
  v_session_id uuid;
  v_week date := public.skeeball_current_week();
  v_active_count int;
BEGIN
  IF v_uid IS NULL THEN
    RETURN json_build_object('error', 'not_authenticated', 'message', 'You must be logged in.');
  END IF;

  SELECT * INTO v_lane FROM public.skeeball_lane_from_token(p_token) LIMIT 1;
  IF v_lane.token_error IS NOT NULL THEN
    RETURN json_build_object('error', v_lane.token_error, 'message', 'This QR code is not available for Skee-Ball check-in.');
  END IF;

  IF v_lane.lane_status = 'inactive' THEN
    RETURN json_build_object('error', 'lane_inactive', 'message', 'This lane is currently inactive.');
  END IF;

  SELECT id, name INTO v_team FROM public.teams WHERE id = p_team_id;
  IF NOT FOUND THEN
    RETURN json_build_object('error', 'team_not_found', 'message', 'Team not found.');
  END IF;

  IF EXISTS (SELECT 1 FROM public.team_bans WHERE team_id = p_team_id AND user_id = v_uid) THEN
    RETURN json_build_object('error', 'banned', 'message', 'You cannot check in for this team.');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.team_members WHERE team_id = p_team_id AND user_id = v_uid) THEN
    RETURN json_build_object('error', 'not_team_member', 'message', 'Only team members can check in.');
  END IF;

  SELECT id, lane_number, league_match_id INTO v_existing
    FROM public.skeeball_sessions
   WHERE team_id = p_team_id AND status = 'active'
   LIMIT 1;

  IF FOUND THEN
    RETURN json_build_object(
      'ok', true,
      'already_active', true,
      'lane_mismatch', (v_existing.lane_number IS DISTINCT FROM v_lane.lane_number),
      'scanned_lane_number', v_lane.lane_number,
      'session_id', v_existing.id,
      'lane_number', v_existing.lane_number,
      'league_match_id', v_existing.league_match_id,
      'team_id', p_team_id,
      'team_name', v_team.name,
      'message', CASE WHEN v_existing.lane_number IS DISTINCT FROM v_lane.lane_number
        THEN v_team.name || ' is already checked in on Lane ' || v_existing.lane_number
             || '. Check out of that lane before switching to Lane ' || v_lane.lane_number || '.'
        ELSE NULL END
    );
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.skeeball_sessions
     WHERE lane_number = v_lane.lane_number AND status = 'active'
  ) THEN
    RETURN json_build_object('error', 'lane_occupied', 'message', 'Lane ' || v_lane.lane_number || ' is already checked in.');
  END IF;

  SELECT m.id INTO v_match_id
    FROM public.skeeball_league_matches m
   WHERE m.week_of = v_week
     AND COALESCE(m.status, 'active') IN ('active', 'open', 'in_progress')
   ORDER BY m.created_at DESC
   LIMIT 1;

  IF FOUND THEN
    SELECT COUNT(*) INTO v_active_count
      FROM public.skeeball_sessions
     WHERE league_match_id = v_match_id AND status = 'active';
  END IF;

  IF v_match_id IS NULL OR COALESCE(v_active_count, 0) >= 4 THEN
    INSERT INTO public.skeeball_league_matches (week_of, status)
    VALUES (v_week, 'active')
    RETURNING id INTO v_match_id;
  END IF;

  INSERT INTO public.skeeball_sessions (
    team_id, lane_number, week_of, created_by, status, last_activity_at, league_match_id
  ) VALUES (
    p_team_id, v_lane.lane_number, v_week, v_uid, 'active', now(), v_match_id
  )
  RETURNING id INTO v_session_id;

  INSERT INTO public.skeeball_session_players (session_id, player_user_id)
  SELECT v_session_id, user_id
  FROM (
    SELECT tm.user_id,
           CASE WHEN tm.user_id = v_uid THEN 0 WHEN tm.role = 'captain' THEN 1 ELSE 2 END AS sort_group
      FROM public.team_members tm
     WHERE tm.team_id = p_team_id
     ORDER BY sort_group, tm.user_id ASC
     LIMIT 3
  ) lineup
  ON CONFLICT DO NOTHING;

  UPDATE public.lanes SET status = 'occupied' WHERE id = v_lane.lane_id;

  RETURN json_build_object(
    'ok', true,
    'session_id', v_session_id,
    'lane_id', v_lane.lane_id,
    'lane_number', v_lane.lane_number,
    'game_id', v_lane.game_id,
    'game_name', v_lane.game_name,
    'venue_id', v_lane.venue_id,
    'league_match_id', v_match_id,
    'team_id', p_team_id,
    'team_name', v_team.name
  );
EXCEPTION WHEN unique_violation THEN
  RETURN json_build_object('error', 'lane_occupied', 'message', 'That lane or team was just checked in. Refresh and try again.');
END;
$function$;

REVOKE ALL ON FUNCTION public.rpc_skeeball_start_qr_session(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_skeeball_start_qr_session(text, uuid) TO authenticated;
