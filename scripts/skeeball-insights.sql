-- ============================================================
-- Skee-Ball player insights, head-to-head, and weekly awards
--
-- - rpc_skeeball_player_insights: lane averages, clutch rating
--   (first vs final ball), consistency (stddev), hundo stats and
--   streaks, personal records, league percentile, derived badges.
--   Stats follow the player across teams.
-- - rpc_skeeball_head_to_head: team-vs-team record from shared
--   league matches (wins/losses, avg margin).
-- - rpc_skeeball_weekly_awards: Player of the Week (top weekly
--   avg) and Most Improved for the latest completed week.
-- - Service-role grants on team stats/history RPCs so the AI
--   recap endpoint can read the same aggregates.
-- ============================================================

-- ── Player insights ──
CREATE OR REPLACE FUNCTION public.rpc_skeeball_player_insights(
  p_user_id uuid,
  p_start date DEFAULT NULL,
  p_end date DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_lanes json;
  v_clutch json;
  v_consistency json;
  v_hundos json;
  v_records json;
  v_percentile int;
  v_badges json;
  v_games int;
BEGIN
  -- player game totals (any team)
  DROP TABLE IF EXISTS _pi_games;
  CREATE TEMP TABLE _pi_games ON COMMIT DROP AS
  SELECT ss.id AS session_id, ss.week_of, ss.lane_number, ss.created_at,
         SUM(bs.score)::int AS game_score,
         COUNT(*)::int AS balls
    FROM skeeball_sessions ss
    JOIN skeeball_ball_scores bs
      ON bs.session_id = ss.id AND bs.player_user_id = p_user_id
   WHERE ss.status = 'completed'
     AND (p_start IS NULL OR ss.week_of >= p_start)
     AND (p_end IS NULL OR ss.week_of <= p_end)
   GROUP BY ss.id, ss.week_of, ss.lane_number, ss.created_at;

  SELECT COUNT(*)::int INTO v_games FROM _pi_games;
  IF v_games = 0 THEN
    DROP TABLE IF EXISTS _pi_games;
    RETURN json_build_object('ok', true, 'games', 0);
  END IF;

  -- Lane averages
  SELECT json_agg(json_build_object('lane_number', lane_number, 'games', games, 'avg', avg)
                  ORDER BY avg DESC)
    INTO v_lanes
    FROM (
      SELECT lane_number, COUNT(*)::int AS games, ROUND(AVG(game_score))::int AS avg
        FROM _pi_games
       GROUP BY lane_number
    ) l;

  -- Clutch: player's first ball vs final ball of each game
  SELECT json_build_object(
           'first_avg', ROUND(AVG(score) FILTER (WHERE ball_rank = 1))::int,
           'last_avg', ROUND(AVG(score) FILTER (WHERE ball_rank = max_rank))::int
         )
    INTO v_clutch
    FROM (
      SELECT bs.score,
             RANK() OVER (PARTITION BY bs.session_id ORDER BY bs.ball_number) AS ball_rank,
             COUNT(*) OVER (PARTITION BY bs.session_id) AS max_rank
        FROM skeeball_ball_scores bs
        JOIN _pi_games g ON g.session_id = bs.session_id
       WHERE bs.player_user_id = p_user_id
    ) b;

  -- Consistency: stddev of game scores
  SELECT json_build_object(
           'stddev', COALESCE(ROUND(STDDEV_POP(game_score))::int, 0),
           'avg', ROUND(AVG(game_score))::int
         )
    INTO v_consistency
    FROM _pi_games;

  -- Hundos: count, rate, best consecutive streak, most in one game
  SELECT json_build_object(
           'count', COALESCE(SUM(CASE WHEN score = 100 THEN 1 ELSE 0 END), 0)::int,
           'total_balls', COUNT(*)::int,
           'rate_pct', CASE WHEN COUNT(*) > 0
             THEN ROUND(100.0 * SUM(CASE WHEN score = 100 THEN 1 ELSE 0 END) / COUNT(*))::int
             ELSE 0 END,
           'pct_40_plus', CASE WHEN COUNT(*) > 0
             THEN ROUND(100.0 * SUM(CASE WHEN score >= 40 THEN 1 ELSE 0 END) / COUNT(*))::int
             ELSE 0 END,
           'best_streak', COALESCE((
             SELECT MAX(cnt)::int FROM (
               SELECT COUNT(*) AS cnt FROM (
                 SELECT rn - ROW_NUMBER() OVER (ORDER BY rn) AS grp
                   FROM (
                     SELECT ROW_NUMBER() OVER (ORDER BY g2.week_of, g2.created_at, b2.ball_number) AS rn,
                            b2.score
                       FROM skeeball_ball_scores b2
                       JOIN _pi_games g2 ON g2.session_id = b2.session_id
                      WHERE b2.player_user_id = p_user_id
                   ) seq
                  WHERE seq.score = 100
               ) grouped
               GROUP BY grp
             ) streaks
           ), 0),
           'max_in_game', COALESCE((
             SELECT MAX(c)::int FROM (
               SELECT COUNT(*) AS c FROM skeeball_ball_scores b3
                 JOIN _pi_games g3 ON g3.session_id = b3.session_id
                WHERE b3.player_user_id = p_user_id AND b3.score = 100
                GROUP BY b3.session_id
             ) per_game
           ), 0)
         )
    INTO v_hundos
    FROM skeeball_ball_scores bs
    JOIN _pi_games g ON g.session_id = bs.session_id
   WHERE bs.player_user_id = p_user_id;

  -- Records
  SELECT json_build_object(
           'best_game', MAX(game_score)::int,
           'best_week_avg', (
             SELECT MAX(wavg)::int FROM (
               SELECT ROUND(AVG(game_score)) AS wavg FROM _pi_games GROUP BY week_of
             ) w
           ),
           'best_week_of', (
             SELECT week_of FROM _pi_games GROUP BY week_of
              ORDER BY AVG(game_score) DESC, week_of LIMIT 1
           )
         )
    INTO v_records
    FROM _pi_games;

  -- League percentile among players with 3+ games in the window
  SELECT ROUND(100.0 * COUNT(*) FILTER (WHERE pavg <= myavg) / NULLIF(COUNT(*), 0))::int
    INTO v_percentile
    FROM (
      SELECT bs.player_user_id,
             AVG(per_game.game_score) AS pavg
        FROM (
          SELECT b.session_id, b.player_user_id, SUM(b.score) AS game_score
            FROM skeeball_ball_scores b
            JOIN skeeball_sessions s ON s.id = b.session_id
           WHERE s.status = 'completed'
             AND (p_start IS NULL OR s.week_of >= p_start)
             AND (p_end IS NULL OR s.week_of <= p_end)
           GROUP BY b.session_id, b.player_user_id
        ) per_game
        JOIN skeeball_ball_scores bs
          ON bs.session_id = per_game.session_id AND bs.player_user_id = per_game.player_user_id
       GROUP BY bs.player_user_id
      HAVING COUNT(DISTINCT per_game.session_id) >= 3
    ) ranks
    CROSS JOIN (SELECT AVG(game_score) AS myavg FROM _pi_games) me;

  -- Derived badges (no state to maintain)
  SELECT json_agg(badge) INTO v_badges FROM (
    SELECT 'first_hundo' AS badge WHERE (v_hundos->>'count')::int >= 1
    UNION ALL SELECT 'hundo_hat_trick' WHERE (v_hundos->>'max_in_game')::int >= 3
    UNION ALL SELECT 'club_120' WHERE (v_records->>'best_game')::int >= 120
    UNION ALL SELECT 'club_150' WHERE (v_records->>'best_game')::int >= 150
    UNION ALL SELECT 'sharpshooter' WHERE (v_hundos->>'pct_40_plus')::int >= 50
    UNION ALL SELECT 'iron_player' WHERE v_games >= 16
    UNION ALL SELECT 'hot_streak' WHERE (v_hundos->>'best_streak')::int >= 2
  ) b;

  DROP TABLE IF EXISTS _pi_games;

  RETURN json_build_object(
    'ok', true,
    'games', v_games,
    'lanes', COALESCE(v_lanes, '[]'::json),
    'clutch', v_clutch,
    'consistency', v_consistency,
    'hundos', v_hundos,
    'records', v_records,
    'percentile', v_percentile,
    'badges', COALESCE(v_badges, '[]'::json)
  );
END;
$$;

-- ── Head-to-head: team vs team across shared league matches ──
CREATE OR REPLACE FUNCTION public.rpc_skeeball_head_to_head(
  p_team_id uuid,
  p_opponent_id uuid,
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
  v_result json;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN json_build_object('error', 'not_authenticated');
  END IF;

  WITH mine AS (
    SELECT ss.league_match_id, ss.week_of, ss.placement,
           (SELECT COALESCE(SUM(score), 0)::int FROM skeeball_ball_scores b WHERE b.session_id = ss.id)
             + ss.score_adjustment AS score
      FROM skeeball_sessions ss
     WHERE ss.team_id = p_team_id AND ss.status = 'completed' AND ss.league_match_id IS NOT NULL
       AND (p_start IS NULL OR ss.week_of >= p_start)
       AND (p_end IS NULL OR ss.week_of <= p_end)
  ),
  theirs AS (
    SELECT ss.league_match_id, ss.placement,
           (SELECT COALESCE(SUM(score), 0)::int FROM skeeball_ball_scores b WHERE b.session_id = ss.id)
             + ss.score_adjustment AS score
      FROM skeeball_sessions ss
     WHERE ss.team_id = p_opponent_id AND ss.status = 'completed' AND ss.league_match_id IS NOT NULL
  ),
  shared AS (
    SELECT m.week_of, m.placement AS my_place, t.placement AS their_place,
           m.score AS my_score, t.score AS their_score
      FROM mine m
      JOIN theirs t ON t.league_match_id = m.league_match_id
     WHERE m.placement IS NOT NULL AND t.placement IS NOT NULL
  )
  SELECT json_build_object(
           'meetings', COUNT(*)::int,
           'wins', COUNT(*) FILTER (WHERE my_place < their_place)::int,
           'losses', COUNT(*) FILTER (WHERE my_place > their_place)::int,
           'avg_margin', COALESCE(ROUND(AVG(my_score - their_score))::int, 0),
           'last_week', MAX(week_of)
         )
    INTO v_result
    FROM shared;

  RETURN (jsonb_build_object('ok', true) || v_result::jsonb)::json;
END;
$$;

-- ── Weekly awards: Player of the Week + Most Improved ──
CREATE OR REPLACE FUNCTION public.rpc_skeeball_weekly_awards(
  p_start date DEFAULT NULL,
  p_end date DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_week date;
  v_top json;
  v_improved json;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN json_build_object('error', 'not_authenticated');
  END IF;

  DROP TABLE IF EXISTS _wa_games;
  CREATE TEMP TABLE _wa_games ON COMMIT DROP AS
  SELECT s.week_of, b.player_user_id, b.session_id, SUM(b.score)::int AS game_score
    FROM skeeball_ball_scores b
    JOIN skeeball_sessions s ON s.id = b.session_id
   WHERE s.status = 'completed'
     AND (p_start IS NULL OR s.week_of >= p_start)
     AND (p_end IS NULL OR s.week_of <= p_end)
   GROUP BY s.week_of, b.player_user_id, b.session_id;

  SELECT MAX(week_of) INTO v_week FROM _wa_games;
  IF v_week IS NULL THEN
    DROP TABLE IF EXISTS _wa_games;
    RETURN json_build_object('ok', true, 'week_of', NULL);
  END IF;

  -- Player of the Week: highest weekly average (this week)
  SELECT json_build_object(
           'user_id', w.player_user_id,
           'username', COALESCE(p.username, 'Unknown'),
           'avatar_url', p.avatar_url,
           'avg', w.avg, 'games', w.games
         )
    INTO v_top
    FROM (
      SELECT player_user_id, ROUND(AVG(game_score))::int AS avg, COUNT(*)::int AS games
        FROM _wa_games WHERE week_of = v_week
       GROUP BY player_user_id
       ORDER BY AVG(game_score) DESC LIMIT 1
    ) w
    LEFT JOIN profiles p ON p.id = w.player_user_id;

  -- Most Improved: biggest avg jump vs their previous played week
  SELECT json_build_object(
           'user_id', mi.player_user_id,
           'username', COALESCE(p.username, 'Unknown'),
           'avatar_url', p.avatar_url,
           'delta_pct', mi.delta_pct, 'avg', mi.this_avg
         )
    INTO v_improved
    FROM (
      SELECT cur.player_user_id,
             ROUND(AVG(cur.game_score))::int AS this_avg,
             ROUND(100.0 * (AVG(cur.game_score) - prev.prev_avg) / NULLIF(prev.prev_avg, 0))::int AS delta_pct
        FROM _wa_games cur
        JOIN LATERAL (
          SELECT AVG(g.game_score) AS prev_avg
            FROM _wa_games g
           WHERE g.player_user_id = cur.player_user_id AND g.week_of < v_week
           GROUP BY g.week_of
           ORDER BY g.week_of DESC LIMIT 1
        ) prev ON true
       WHERE cur.week_of = v_week
       GROUP BY cur.player_user_id, prev.prev_avg
      HAVING AVG(cur.game_score) > prev.prev_avg
       ORDER BY (AVG(cur.game_score) - prev.prev_avg) / NULLIF(prev.prev_avg, 0) DESC
       LIMIT 1
    ) mi
    LEFT JOIN profiles p ON p.id = mi.player_user_id;

  DROP TABLE IF EXISTS _wa_games;

  RETURN json_build_object('ok', true, 'week_of', v_week, 'top', v_top, 'most_improved', v_improved);
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_skeeball_player_insights(uuid, date, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_skeeball_head_to_head(uuid, uuid, date, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_skeeball_weekly_awards(date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_skeeball_player_insights(uuid, date, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_skeeball_head_to_head(uuid, uuid, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_skeeball_weekly_awards(date, date) TO authenticated;
