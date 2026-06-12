-- ============================================================
-- Skee-Ball league: configurable round size + finalize fixes
--
-- League rule: N teams play per round (admin sets N per week,
-- default 4), each shooting 9 balls. When ALL N teams have
-- completed, placements are awarded automatically:
-- 1st = N pts, 2nd = N-1, ... last = 1.  (4 teams → 4/3/2/1)
--
-- Fixes over the original version:
--  1. Auto-finalize waits for the full round (expected_teams) —
--     it no longer closes early when only the first 2 teams to
--     check in have finished.
--  2. Round size is admin-configurable per week via
--     rpc_admin_skeeball_set_week_teams; check-in auto-groups
--     sessions into rounds of that size.
--  3. Check-in slot counting includes completed sessions, so a
--     team finishing early no longer frees its slot for a 5th
--     team to join the same round.
--  4. Admin score_adjustment is included in ranking totals.
--  5. Ties share the better placement and its points (RANK()).
--  6. rpc_admin_skeeball_force_finalize closes out a short round
--     (fewer teams showed up); unfinished sessions are abandoned
--     so lanes free up.
-- ============================================================

ALTER TABLE public.skeeball_league_matches
  ADD COLUMN IF NOT EXISTS expected_teams int NOT NULL DEFAULT 4;

-- ── Admin: set how many teams play per round this week ──────
CREATE OR REPLACE FUNCTION public.rpc_admin_skeeball_set_week_teams(
  p_expected_teams int,
  p_week_of date DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_week date := COALESCE(p_week_of, public.skeeball_current_week());
  v_updated int;
BEGIN
  IF NOT public.is_admin() THEN
    RETURN json_build_object('error', 'unauthorized');
  END IF;

  IF p_expected_teams < 2 OR p_expected_teams > 8 THEN
    RETURN json_build_object('error', 'invalid', 'message', 'Teams per round must be between 2 and 8.');
  END IF;

  UPDATE skeeball_league_matches
     SET expected_teams = p_expected_teams
   WHERE week_of = v_week
     AND COALESCE(status, 'active') != 'completed';
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  -- No open match yet this week: create one so check-ins pick it up
  IF v_updated = 0 THEN
    INSERT INTO skeeball_league_matches (week_of, status, expected_teams)
    VALUES (v_week, 'active', p_expected_teams);
    v_updated := 1;
  END IF;

  INSERT INTO admin_audit_log (admin_id, action, target_id, details)
  VALUES (v_uid, 'skeeball_set_week_teams', v_week::text,
    json_build_object('expected_teams', p_expected_teams, 'matches_updated', v_updated)::text);

  RETURN json_build_object('ok', true, 'week_of', v_week, 'expected_teams', p_expected_teams);
END;
$$;

-- ── Finalize: rank + award points when the round is complete ─
DROP FUNCTION IF EXISTS public.rpc_skeeball_finalize_match(uuid);
DROP FUNCTION IF EXISTS public.rpc_skeeball_finalize_match(uuid, boolean);

CREATE OR REPLACE FUNCTION public.rpc_skeeball_finalize_match(
  p_match_id uuid,
  p_force boolean DEFAULT false
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_expected int;
  v_total int;
  v_completed int;
  v_rec record;
BEGIN
  SELECT COALESCE(expected_teams, 4) INTO v_expected
    FROM skeeball_league_matches WHERE id = p_match_id;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'message', 'Match not found');
  END IF;

  SELECT COUNT(*) INTO v_total
    FROM skeeball_sessions
   WHERE league_match_id = p_match_id AND status != 'abandoned';

  SELECT COUNT(*) INTO v_completed
    FROM skeeball_sessions
   WHERE league_match_id = p_match_id AND status = 'completed';

  IF p_force THEN
    -- Admin override: close out a short round (needs at least 2 finished teams)
    IF v_completed < 2 THEN
      RETURN json_build_object('ok', false, 'message', 'Need at least 2 completed sessions to finalize.');
    END IF;
  ELSE
    -- Wait until the full round has checked in AND completed. Prevents early
    -- finalization when the first teams finish before the rest have started.
    IF v_total < v_expected OR v_completed < v_total THEN
      RETURN json_build_object('ok', false, 'message',
        'Round not complete yet (' || v_completed || '/' || GREATEST(v_total, v_expected) || ' teams finished)');
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM skeeball_sessions
     WHERE league_match_id = p_match_id AND placement IS NOT NULL LIMIT 1
  ) THEN
    RETURN json_build_object('ok', true, 'message', 'Already finalized');
  END IF;

  -- Rank completed sessions by total score (admin adjustments included).
  -- Points scale with round size: 1st = N, down to 1. Ties share the
  -- better placement and its points.
  FOR v_rec IN
    SELECT ranked.id, ranked.rnk
    FROM (
      SELECT ss.id,
             RANK() OVER (ORDER BY COALESCE(SUM(bs.score), 0) + ss.score_adjustment DESC) AS rnk
        FROM skeeball_sessions ss
        LEFT JOIN skeeball_ball_scores bs ON bs.session_id = ss.id
       WHERE ss.league_match_id = p_match_id AND ss.status = 'completed'
       GROUP BY ss.id, ss.score_adjustment
    ) ranked
  LOOP
    UPDATE skeeball_sessions
       SET placement = v_rec.rnk,
           league_points = GREATEST(v_completed - v_rec.rnk + 1, 1)
     WHERE id = v_rec.id;
  END LOOP;

  -- Force-finalize: clear out sessions that never finished so lanes free up
  IF p_force THEN
    UPDATE skeeball_sessions
       SET status = 'abandoned', last_activity_at = now()
     WHERE league_match_id = p_match_id AND status = 'active';
  END IF;

  UPDATE skeeball_league_matches SET status = 'completed' WHERE id = p_match_id;

  RETURN json_build_object('ok', true, 'teams_ranked', v_completed);
END;
$$;

-- ── Admin-only wrapper to close out a short round ────────────
CREATE OR REPLACE FUNCTION public.rpc_admin_skeeball_force_finalize(p_match_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_result json;
BEGIN
  IF NOT public.is_admin() THEN
    RETURN json_build_object('error', 'unauthorized');
  END IF;

  v_result := public.rpc_skeeball_finalize_match(p_match_id, true);

  INSERT INTO admin_audit_log (admin_id, action, target_id, details)
  VALUES (v_uid, 'skeeball_force_finalize', p_match_id::text, v_result::text);

  RETURN v_result;
END;
$$;

-- ── Check-in: group sessions into rounds of expected_teams ───
CREATE OR REPLACE FUNCTION public.rpc_skeeball_start_qr_session(
  p_token   text,
  p_team_id uuid
) RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_lane record;
  v_team record;
  v_existing record;
  v_match record;
  v_match_id uuid;
  v_expected int := 4;
  v_session_id uuid;
  v_week date := public.skeeball_current_week();
  v_session_count int;
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

  IF EXISTS (
    SELECT 1 FROM public.team_bans
     WHERE team_id = p_team_id AND user_id = v_uid
  ) THEN
    RETURN json_build_object('error', 'banned', 'message', 'You cannot check in for this team.');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.team_members
     WHERE team_id = p_team_id AND user_id = v_uid
  ) THEN
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
      'session_id', v_existing.id,
      'lane_number', v_existing.lane_number,
      'league_match_id', v_existing.league_match_id,
      'team_id', p_team_id,
      'team_name', v_team.name
    );
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.skeeball_sessions
     WHERE lane_number = v_lane.lane_number AND status = 'active'
  ) THEN
    RETURN json_build_object('error', 'lane_occupied', 'message', 'Lane ' || v_lane.lane_number || ' is already checked in.');
  END IF;

  -- Latest open match this week, with its round size
  SELECT m.id, COALESCE(m.expected_teams, 4) AS expected_teams INTO v_match
    FROM public.skeeball_league_matches m
   WHERE m.week_of = v_week
     AND COALESCE(m.status, 'active') IN ('active', 'open', 'in_progress')
   ORDER BY m.created_at DESC
   LIMIT 1;

  IF FOUND THEN
    v_match_id := v_match.id;
    v_expected := v_match.expected_teams;

    -- Count all non-abandoned sessions: a completed session still owns its
    -- round slot (previously only active sessions counted, letting extra
    -- teams join a round after someone finished early).
    SELECT COUNT(*) INTO v_session_count
      FROM public.skeeball_sessions
     WHERE league_match_id = v_match_id
       AND status != 'abandoned';

    IF v_session_count >= v_expected THEN
      v_match_id := NULL; -- round is full, start the next one
    END IF;
  ELSE
    -- Inherit this week's configured round size for the new match
    SELECT COALESCE(m.expected_teams, 4) INTO v_expected
      FROM public.skeeball_league_matches m
     WHERE m.week_of = v_week
     ORDER BY m.created_at DESC
     LIMIT 1;
    v_expected := COALESCE(v_expected, 4);
  END IF;

  IF v_match_id IS NULL THEN
    INSERT INTO public.skeeball_league_matches (week_of, status, expected_teams)
    VALUES (v_week, 'active', v_expected)
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
$$;

REVOKE ALL ON FUNCTION public.rpc_skeeball_finalize_match(uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_admin_skeeball_force_finalize(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_admin_skeeball_set_week_teams(int, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_skeeball_start_qr_session(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_skeeball_finalize_match(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_skeeball_force_finalize(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_skeeball_set_week_teams(int, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_skeeball_start_qr_session(text, uuid) TO authenticated;
