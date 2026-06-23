-- ============================================================
-- rpc_my_skeeball_night — a shareable "My Night" recap for the caller.
--
-- Aggregates the player's own ball scores for one league night (defaults to
-- the most recent week they actually played) into a single summary: total
-- points, best single game, signature ring, per-ring breakdown, rank among
-- everyone who played that night, whether it was a personal best, and their
-- current weeks-in-a-row streak.
--
-- Read-only; SECURITY DEFINER so the rank/standings math sees all players'
-- scores without exposing rows. Returns { has_data:false } when the player
-- has no scores for the requested/most-recent night.
-- ============================================================
CREATE OR REPLACE FUNCTION public.rpc_my_skeeball_night(p_week_of date DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_week   date;
  v_result json;
BEGIN
  IF v_uid IS NULL THEN RETURN json_build_object('error','not_authenticated'); END IF;

  -- target night: explicit week, else the player's most recent played week
  SELECT COALESCE(p_week_of, max(s.week_of)) INTO v_week
    FROM skeeball_sessions s
    JOIN skeeball_ball_scores bs ON bs.session_id = s.id
   WHERE bs.player_user_id = v_uid
     AND (p_week_of IS NULL OR s.week_of = p_week_of);

  IF v_week IS NULL THEN
    RETURN json_build_object('has_data', false);
  END IF;

  WITH my_balls AS (
    SELECT bs.score, s.id AS session_id, s.team_id, s.placement
      FROM skeeball_sessions s
      JOIN skeeball_ball_scores bs ON bs.session_id = s.id
     WHERE bs.player_user_id = v_uid AND s.week_of = v_week
  ),
  per_game AS (
    SELECT session_id, sum(score) AS game_total FROM my_balls GROUP BY session_id
  ),
  ring_counts AS (
    SELECT score, count(*) AS n FROM my_balls GROUP BY score
  ),
  -- everyone's nightly total, to rank the caller
  night_totals AS (
    SELECT bs.player_user_id, sum(bs.score) AS total
      FROM skeeball_sessions s
      JOIN skeeball_ball_scores bs ON bs.session_id = s.id
     WHERE s.week_of = v_week
     GROUP BY bs.player_user_id
  ),
  -- career best single game strictly BEFORE this week (for PB detection)
  prior_best AS (
    SELECT COALESCE(max(g.t), 0) AS best
      FROM (
        SELECT sum(bs.score) AS t
          FROM skeeball_sessions s
          JOIN skeeball_ball_scores bs ON bs.session_id = s.id
         WHERE bs.player_user_id = v_uid AND s.week_of < v_week
         GROUP BY s.id
      ) g
  ),
  -- weeks-in-a-row streak ending at v_week (weekly islands trick)
  played_weeks AS (
    SELECT DISTINCT s.week_of,
           s.week_of - (((row_number() OVER (ORDER BY s.week_of DESC)) - 1) * 7)::int AS grp
      FROM skeeball_sessions s
      JOIN skeeball_ball_scores bs ON bs.session_id = s.id
     WHERE bs.player_user_id = v_uid AND s.week_of <= v_week
  )
  SELECT json_build_object(
    'has_data',    true,
    'week_of',     v_week,
    'total_pts',   (SELECT COALESCE(sum(score),0) FROM my_balls),
    'balls',       (SELECT count(*) FROM my_balls),
    'games',       (SELECT count(*) FROM per_game),
    'best_game',   (SELECT COALESCE(max(game_total),0) FROM per_game),
    'best_ring',   (SELECT score FROM ring_counts ORDER BY n DESC, score DESC LIMIT 1),
    'ring_counts', (SELECT COALESCE(json_object_agg(score, n), '{}'::json) FROM ring_counts),
    'team_name',   (SELECT t.name FROM teams t WHERE t.id = (SELECT team_id FROM my_balls LIMIT 1)),
    'team_placement', (SELECT min(placement) FROM my_balls WHERE placement IS NOT NULL),
    'rank',        (SELECT 1 + count(*) FROM night_totals WHERE total > (SELECT total FROM night_totals WHERE player_user_id = v_uid)),
    'players',     (SELECT count(*) FROM night_totals),
    'is_pb',       (SELECT (SELECT COALESCE(max(game_total),0) FROM per_game) > (SELECT best FROM prior_best)),
    'streak',      (SELECT count(*) FROM played_weeks WHERE grp = (SELECT grp FROM played_weeks ORDER BY week_of DESC LIMIT 1))
  ) INTO v_result;

  RETURN v_result;
END; $$;

REVOKE ALL ON FUNCTION public.rpc_my_skeeball_night(date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_my_skeeball_night(date) TO authenticated;
