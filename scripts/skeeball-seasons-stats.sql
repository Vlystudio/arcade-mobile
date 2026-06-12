-- ============================================================
-- Skee-Ball League: 8-week seasons + player/team stat tracking
--
-- - skeeball_seasons: 8-week windows (week 1 Monday .. week 8
--   Monday). Admins start a new season, which completes the
--   previous one. Matches map to seasons by week_of range.
-- - profiles.show_skeeball_stats: whether the league stats card
--   shows on the user's profile. League/team views are public
--   to all registered users regardless.
-- - rpc_skeeball_player_stats: per-week + total games, averages,
--   best/worst, and ring breakdown (10/20/30/40/50/100 counts).
-- - rpc_skeeball_team_stats: team weekly performance, league
--   points, placements, and per-member summaries (avg, best,
--   best/worst week, weekly series).
-- - rpc_skeeball_standings: season-scoped team standings.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.skeeball_seasons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  start_week date NOT NULL,
  end_week date NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed')),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.skeeball_seasons ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "skeeball_seasons_read" ON public.skeeball_seasons;
CREATE POLICY "skeeball_seasons_read" ON public.skeeball_seasons
  FOR SELECT TO authenticated USING (true);

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS show_skeeball_stats boolean NOT NULL DEFAULT true;

-- ── Admin: start a new 8-week season (completes the active one) ──
CREATE OR REPLACE FUNCTION public.rpc_admin_skeeball_start_season(p_name text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_name text := btrim(COALESCE(p_name, ''));
  v_start date := public.skeeball_current_week();
  v_season record;
BEGIN
  IF NOT public.is_admin() THEN
    RETURN json_build_object('error', 'unauthorized');
  END IF;

  IF char_length(v_name) < 2 OR char_length(v_name) > 60 THEN
    RETURN json_build_object('error', 'invalid', 'message', 'Season name must be 2-60 characters.');
  END IF;

  UPDATE skeeball_seasons SET status = 'completed' WHERE status = 'active';

  INSERT INTO skeeball_seasons (name, start_week, end_week, status, created_by)
  VALUES (v_name, v_start, v_start + 49, 'active', v_uid)
  RETURNING * INTO v_season;

  INSERT INTO admin_audit_log (admin_id, action, target_id, details)
  VALUES (v_uid, 'skeeball_start_season', v_season.id::text,
    json_build_object('name', v_name, 'start_week', v_start, 'end_week', v_start + 49)::text);

  RETURN json_build_object(
    'ok', true,
    'id', v_season.id,
    'name', v_season.name,
    'start_week', v_season.start_week,
    'end_week', v_season.end_week
  );
END;
$$;

-- ── Player stats: weekly series + totals + ring breakdown ──
CREATE OR REPLACE FUNCTION public.rpc_skeeball_player_stats(
  p_user_id uuid,
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
  v_totals json;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN json_build_object('error', 'not_authenticated');
  END IF;

  WITH games AS (
    SELECT ss.id AS session_id, ss.week_of,
           SUM(bs.score)::int AS game_score,
           COUNT(*)::int AS balls
      FROM skeeball_sessions ss
      JOIN skeeball_ball_scores bs
        ON bs.session_id = ss.id AND bs.player_user_id = p_user_id
     WHERE ss.status = 'completed'
       AND (p_start IS NULL OR ss.week_of >= p_start)
       AND (p_end IS NULL OR ss.week_of <= p_end)
     GROUP BY ss.id, ss.week_of
  ),
  ball_rows AS (
    SELECT ss.week_of, bs.score AS ring
      FROM skeeball_sessions ss
      JOIN skeeball_ball_scores bs
        ON bs.session_id = ss.id AND bs.player_user_id = p_user_id
     WHERE ss.status = 'completed'
       AND (p_start IS NULL OR ss.week_of >= p_start)
       AND (p_end IS NULL OR ss.week_of <= p_end)
  ),
  week_agg AS (
    SELECT week_of,
           COUNT(*)::int AS games,
           ROUND(AVG(game_score))::int AS avg,
           MAX(game_score)::int AS best,
           MIN(game_score)::int AS worst,
           SUM(balls)::int AS balls
      FROM games
     GROUP BY week_of
  )
  SELECT
    COALESCE((SELECT json_agg(json_build_object(
        'week_of', w.week_of,
        'games', w.games,
        'avg', w.avg,
        'best', w.best,
        'worst', w.worst,
        'balls', w.balls,
        'rings', COALESCE((SELECT json_object_agg(r.ring, r.cnt)
                  FROM (SELECT ring, COUNT(*)::int AS cnt
                          FROM ball_rows br WHERE br.week_of = w.week_of
                         GROUP BY ring) r), '{}'::json)
      ) ORDER BY w.week_of) FROM week_agg w), '[]'::json),
    json_build_object(
      'games', COALESCE((SELECT COUNT(*) FROM games), 0),
      'avg', (SELECT ROUND(AVG(game_score))::int FROM games),
      'best', (SELECT MAX(game_score)::int FROM games),
      'worst', (SELECT MIN(game_score)::int FROM games),
      'balls', COALESCE((SELECT SUM(balls)::int FROM games), 0),
      'rings', COALESCE((SELECT json_object_agg(r.ring, r.cnt)
                FROM (SELECT ring, COUNT(*)::int AS cnt FROM ball_rows GROUP BY ring) r), '{}'::json)
    )
  INTO v_weeks, v_totals;

  RETURN json_build_object('ok', true, 'weeks', v_weeks, 'totals', v_totals);
END;
$$;

-- ── Team stats: weekly performance + per-member summaries ──
CREATE OR REPLACE FUNCTION public.rpc_skeeball_team_stats(
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
  v_members json;
  v_points int;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN json_build_object('error', 'not_authenticated');
  END IF;

  WITH sess AS (
    SELECT ss.id, ss.week_of, ss.placement,
           COALESCE(ss.league_points, 0) + ss.league_points_adjustment AS pts,
           (SELECT COALESCE(SUM(score), 0)::int FROM skeeball_ball_scores b WHERE b.session_id = ss.id)
             + ss.score_adjustment AS team_score
      FROM skeeball_sessions ss
     WHERE ss.team_id = p_team_id
       AND ss.status = 'completed'
       AND (p_start IS NULL OR ss.week_of >= p_start)
       AND (p_end IS NULL OR ss.week_of <= p_end)
  ),
  week_agg AS (
    SELECT week_of,
           COUNT(*)::int AS games,
           ROUND(AVG(team_score))::int AS avg,
           MAX(team_score)::int AS best,
           SUM(pts)::int AS points,
           MIN(placement)::int AS best_placement
      FROM sess
     GROUP BY week_of
  ),
  member_games AS (
    SELECT ss.week_of, bs.player_user_id, ss.id AS session_id,
           SUM(bs.score)::int AS game_score,
           COUNT(*)::int AS balls
      FROM skeeball_sessions ss
      JOIN skeeball_ball_scores bs ON bs.session_id = ss.id
     WHERE ss.team_id = p_team_id
       AND ss.status = 'completed'
       AND (p_start IS NULL OR ss.week_of >= p_start)
       AND (p_end IS NULL OR ss.week_of <= p_end)
     GROUP BY ss.week_of, bs.player_user_id, ss.id
  ),
  member_weeks AS (
    SELECT player_user_id, week_of,
           COUNT(*)::int AS games,
           ROUND(AVG(game_score))::int AS avg,
           MAX(game_score)::int AS best
      FROM member_games
     GROUP BY player_user_id, week_of
  ),
  member_summary AS (
    SELECT player_user_id,
           COUNT(*)::int AS games,
           ROUND(AVG(game_score))::int AS avg,
           MAX(game_score)::int AS best,
           SUM(balls)::int AS balls
      FROM member_games
     GROUP BY player_user_id
  )
  SELECT
    COALESCE((SELECT json_agg(json_build_object(
        'week_of', w.week_of,
        'games', w.games,
        'avg', w.avg,
        'best', w.best,
        'points', w.points,
        'best_placement', w.best_placement
      ) ORDER BY w.week_of) FROM week_agg w), '[]'::json),
    COALESCE((SELECT json_agg(json_build_object(
        'user_id', ms.player_user_id,
        'username', COALESCE(p.username, 'Unknown'),
        'avatar_url', p.avatar_url,
        'games', ms.games,
        'avg', ms.avg,
        'best', ms.best,
        'balls', ms.balls,
        'best_week', (SELECT mw.week_of FROM member_weeks mw
                       WHERE mw.player_user_id = ms.player_user_id
                       ORDER BY mw.avg DESC, mw.week_of LIMIT 1),
        'worst_week', (SELECT mw.week_of FROM member_weeks mw
                        WHERE mw.player_user_id = ms.player_user_id
                        ORDER BY mw.avg ASC, mw.week_of LIMIT 1),
        'weeks', (SELECT json_agg(json_build_object(
                    'week_of', mw.week_of, 'avg', mw.avg, 'games', mw.games, 'best', mw.best
                  ) ORDER BY mw.week_of)
                  FROM member_weeks mw WHERE mw.player_user_id = ms.player_user_id)
      ) ORDER BY ms.avg DESC)
      FROM member_summary ms
      LEFT JOIN profiles p ON p.id = ms.player_user_id), '[]'::json),
    COALESCE((SELECT SUM(pts)::int FROM sess), 0)
  INTO v_weeks, v_members, v_points;

  RETURN json_build_object('ok', true, 'weeks', v_weeks, 'members', v_members, 'season_points', v_points);
END;
$$;

-- ── Season-scoped standings (Leagues tab) ──
CREATE OR REPLACE FUNCTION public.rpc_skeeball_standings(
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
  v_rows json;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN json_build_object('error', 'not_authenticated');
  END IF;

  WITH sess AS (
    SELECT ss.team_id, ss.placement,
           COALESCE(ss.league_points, 0) + ss.league_points_adjustment AS pts,
           (SELECT COALESCE(SUM(score), 0)::int FROM skeeball_ball_scores b WHERE b.session_id = ss.id)
             + ss.score_adjustment AS game_score
      FROM skeeball_sessions ss
     WHERE ss.status = 'completed'
       AND (p_start IS NULL OR ss.week_of >= p_start)
       AND (p_end IS NULL OR ss.week_of <= p_end)
  )
  SELECT COALESCE(json_agg(row_json ORDER BY total_points DESC, avg_score DESC), '[]'::json)
    INTO v_rows
    FROM (
      SELECT json_build_object(
               'team_id', s.team_id,
               'team_name', COALESCE(t.name, 'Unknown'),
               'matches_played', COUNT(*)::int,
               'gold', COUNT(*) FILTER (WHERE s.placement = 1)::int,
               'silver', COUNT(*) FILTER (WHERE s.placement = 2)::int,
               'bronze', COUNT(*) FILTER (WHERE s.placement = 3)::int,
               'total_points', COALESCE(SUM(s.pts), 0)::int,
               'avg_score', ROUND(AVG(s.game_score))::int,
               'best_score', MAX(s.game_score)::int
             ) AS row_json,
             COALESCE(SUM(s.pts), 0) AS total_points,
             AVG(s.game_score) AS avg_score
        FROM sess s
        JOIN teams t ON t.id = s.team_id
       GROUP BY s.team_id, t.name
    ) ranked;

  RETURN json_build_object('ok', true, 'standings', v_rows);
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_admin_skeeball_start_season(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_skeeball_player_stats(uuid, date, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_skeeball_team_stats(uuid, date, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_skeeball_standings(date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_admin_skeeball_start_season(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_skeeball_player_stats(uuid, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_skeeball_team_stats(uuid, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_skeeball_standings(date, date) TO authenticated;
