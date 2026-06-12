-- ============================================================
-- Skee-Ball: shooting-order tracking + weekly schedule history
--
-- - skeeball_session_players.shoot_position (1..3): who shoots
--   first/second/third in a round. Backfilled from lineup order
--   for historical sessions; teams set it explicitly in the
--   tracker going forward.
-- - rpc_skeeball_set_lineup_order: session players reorder the
--   lineup while the session is active (before/while shooting).
-- - rpc_skeeball_position_stats: per-player performance broken
--   down by shooting position — powers the lineup optimizer and
--   the AI coach (service role allowed for the coach endpoint).
-- - team_schedule.week_of: real date for the scheduled week so
--   player-facing schedule views can join cleanly to matches.
-- - rpc_skeeball_team_week_history: per-week slot, opponents,
--   own placement/points/score for a season window.
-- ============================================================

ALTER TABLE public.skeeball_session_players
  ADD COLUMN IF NOT EXISTS shoot_position int,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

-- Backfill: lineup insert order approximates the shooting order
-- (creator first, then captain, then remaining members)
WITH ranked AS (
  SELECT session_id, player_user_id,
         ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY created_at, player_user_id) AS pos
    FROM public.skeeball_session_players
)
UPDATE public.skeeball_session_players sp
   SET shoot_position = ranked.pos
  FROM ranked
 WHERE sp.session_id = ranked.session_id
   AND sp.player_user_id = ranked.player_user_id
   AND sp.shoot_position IS NULL;

ALTER TABLE public.team_schedule
  ADD COLUMN IF NOT EXISTS week_of date;

-- ── Players reorder their lineup while the session is active ──
CREATE OR REPLACE FUNCTION public.rpc_skeeball_set_lineup_order(
  p_session_id uuid,
  p_ordered_user_ids uuid[]
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_count int;
  i int;
BEGIN
  IF v_uid IS NULL THEN
    RETURN json_build_object('error', 'not_authenticated');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM skeeball_session_players
     WHERE session_id = p_session_id AND player_user_id = v_uid
  ) THEN
    RETURN json_build_object('error', 'unauthorized', 'message', 'Only session players can set the order.');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM skeeball_sessions WHERE id = p_session_id AND status = 'active'
  ) THEN
    RETURN json_build_object('error', 'invalid', 'message', 'Session is no longer active.');
  END IF;

  SELECT COUNT(*) INTO v_count FROM skeeball_session_players WHERE session_id = p_session_id;
  IF array_length(p_ordered_user_ids, 1) IS DISTINCT FROM v_count THEN
    RETURN json_build_object('error', 'invalid', 'message', 'Order must include every session player exactly once.');
  END IF;

  FOR i IN 1..array_length(p_ordered_user_ids, 1) LOOP
    UPDATE skeeball_session_players
       SET shoot_position = i
     WHERE session_id = p_session_id
       AND player_user_id = p_ordered_user_ids[i];
    IF NOT FOUND THEN
      RETURN json_build_object('error', 'invalid', 'message', 'Order contains a player not in this session.');
    END IF;
  END LOOP;

  RETURN json_build_object('ok', true);
END;
$$;

-- ── Per-player stats by shooting position ──
-- Position history FOLLOWS THE PLAYER, not the team: the team id only
-- selects the current roster, then each player's stats aggregate across
-- every league session they've ever played (any team) in the window.
-- NULL auth.uid() is allowed so the server-side AI coach endpoint
-- (service role) can read the same aggregates; anon cannot execute.
CREATE OR REPLACE FUNCTION public.rpc_skeeball_position_stats(
  p_team_id uuid,
  p_start date DEFAULT NULL,
  p_end date DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_players json;
BEGIN
  WITH roster AS (
    SELECT tm.user_id FROM team_members tm WHERE tm.team_id = p_team_id
  ),
  member_games AS (
    SELECT ss.id AS session_id, ss.week_of, bs.player_user_id,
           sp.shoot_position,
           SUM(bs.score)::int AS game_score
      FROM skeeball_sessions ss
      JOIN skeeball_ball_scores bs ON bs.session_id = ss.id
      JOIN skeeball_session_players sp
        ON sp.session_id = ss.id AND sp.player_user_id = bs.player_user_id
      JOIN roster r ON r.user_id = bs.player_user_id
     WHERE ss.status = 'completed'
       AND (p_start IS NULL OR ss.week_of >= p_start)
       AND (p_end IS NULL OR ss.week_of <= p_end)
     GROUP BY ss.id, ss.week_of, bs.player_user_id, sp.shoot_position
  ),
  pos_agg AS (
    SELECT player_user_id, shoot_position,
           COUNT(*)::int AS games,
           ROUND(AVG(game_score))::int AS avg,
           MAX(game_score)::int AS best
      FROM member_games
     WHERE shoot_position IS NOT NULL
     GROUP BY player_user_id, shoot_position
  ),
  players AS (
    SELECT player_user_id,
           COUNT(*)::int AS games,
           ROUND(AVG(game_score))::int AS overall_avg
      FROM member_games
     GROUP BY player_user_id
  )
  SELECT json_agg(json_build_object(
      'user_id', pl.player_user_id,
      'username', COALESCE(pr.username, 'Unknown'),
      'games', pl.games,
      'overall_avg', pl.overall_avg,
      'positions', COALESCE((
        SELECT json_object_agg(pa.shoot_position, json_build_object(
                 'games', pa.games, 'avg', pa.avg, 'best', pa.best))
          FROM pos_agg pa WHERE pa.player_user_id = pl.player_user_id
      ), '{}'::json)
    ) ORDER BY pl.overall_avg DESC)
    INTO v_players
    FROM players pl
    LEFT JOIN profiles pr ON pr.id = pl.player_user_id;

  RETURN json_build_object('ok', true, 'players', COALESCE(v_players, '[]'::json));
END;
$$;

-- ── Weekly history: slot, opponents, own result per week ──
CREATE OR REPLACE FUNCTION public.rpc_skeeball_team_week_history(
  p_team_id uuid,
  p_start date DEFAULT NULL,
  p_end date DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_weeks json;
  v_upcoming json;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN json_build_object('error', 'not_authenticated');
  END IF;

  -- Past/played weeks: from this team's completed league sessions
  WITH own AS (
    SELECT ss.id, ss.week_of, ss.league_match_id, ss.placement,
           COALESCE(ss.league_points, 0) + ss.league_points_adjustment AS points,
           (SELECT COALESCE(SUM(score), 0)::int FROM skeeball_ball_scores b WHERE b.session_id = ss.id)
             + ss.score_adjustment AS game_score
      FROM skeeball_sessions ss
     WHERE ss.team_id = p_team_id
       AND ss.status = 'completed'
       AND ss.league_match_id IS NOT NULL
       AND (p_start IS NULL OR ss.week_of >= p_start)
       AND (p_end IS NULL OR ss.week_of <= p_end)
  )
  SELECT json_agg(json_build_object(
      'week_of', o.week_of,
      'placement', o.placement,
      'points', o.points,
      'game_score', o.game_score,
      'slot_time', (
        SELECT ts.slot_time FROM team_schedule ts
         WHERE ts.team_id = p_team_id AND ts.week_of = o.week_of
         LIMIT 1
      ),
      'opponents', COALESCE((
        SELECT json_agg(json_build_object(
                 'team_id', os.team_id,
                 'team_name', COALESCE(t.name, 'Unknown'),
                 'placement', os.placement,
                 'game_score', (SELECT COALESCE(SUM(score), 0)::int FROM skeeball_ball_scores b WHERE b.session_id = os.id)
                   + os.score_adjustment
               ) ORDER BY os.placement NULLS LAST)
          FROM skeeball_sessions os
          JOIN teams t ON t.id = os.team_id
         WHERE os.league_match_id = o.league_match_id
           AND os.team_id != p_team_id
           AND os.status = 'completed'
      ), '[]'::json)
    ) ORDER BY o.week_of)
    INTO v_weeks
    FROM own o;

  -- Upcoming: latest schedule entry for a week with no completed session yet
  SELECT json_build_object('week_of', ts.week_of, 'slot_time', ts.slot_time, 'week_label', ts.week_label)
    INTO v_upcoming
    FROM team_schedule ts
   WHERE ts.team_id = p_team_id
     AND ts.week_of IS NOT NULL
     AND ts.week_of >= public.skeeball_current_week()
     AND NOT EXISTS (
       SELECT 1 FROM skeeball_sessions ss
        WHERE ss.team_id = p_team_id AND ss.week_of = ts.week_of AND ss.status = 'completed'
     )
   ORDER BY ts.week_of
   LIMIT 1;

  RETURN json_build_object(
    'ok', true,
    'weeks', COALESCE(v_weeks, '[]'::json),
    'upcoming', v_upcoming
  );
END;
$$;

-- ── Check-in: record the initial lineup order as shoot_position ──
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

  SELECT m.id, COALESCE(m.expected_teams, 4) AS expected_teams INTO v_match
    FROM public.skeeball_league_matches m
   WHERE m.week_of = v_week
     AND COALESCE(m.status, 'active') IN ('active', 'open', 'in_progress')
   ORDER BY m.created_at DESC
   LIMIT 1;

  IF FOUND THEN
    v_match_id := v_match.id;
    v_expected := v_match.expected_teams;

    SELECT COUNT(*) INTO v_session_count
      FROM public.skeeball_sessions
     WHERE league_match_id = v_match_id
       AND status != 'abandoned';

    IF v_session_count >= v_expected THEN
      v_match_id := NULL;
    END IF;
  ELSE
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

  INSERT INTO public.skeeball_session_players (session_id, player_user_id, shoot_position)
  SELECT v_session_id, user_id, ROW_NUMBER() OVER (ORDER BY sort_group, user_id)
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

REVOKE ALL ON FUNCTION public.rpc_skeeball_set_lineup_order(uuid, uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_skeeball_position_stats(uuid, date, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_skeeball_team_week_history(uuid, date, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_skeeball_start_qr_session(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_skeeball_set_lineup_order(uuid, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_skeeball_position_stats(uuid, date, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_skeeball_team_week_history(uuid, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_skeeball_start_qr_session(text, uuid) TO authenticated;
