-- Rank-points scoring system for First Friday bracket
-- Run in Supabase SQL Editor
--
-- Each game converts raw Skee-Ball scores to rank points:
--   Game 1 (4 players): 1st=4pts  2nd=3pts  3rd=2pts  4th=1pt  → lowest eliminated
--   Game 2 (3 players): 1st=3pts  2nd=2pts  3rd=1pt
--     → player with lowest TOTAL rank points (Game 1 + Game 2) eliminated
-- Fixes the "more than one row returned by subquery" bug at the same time.

ALTER TABLE ff_bracket_scores ADD COLUMN IF NOT EXISTS rank_points int;

-- ⚠ SUPERSEDED by scripts/ff-guest-player.sql, the SOURCE OF TRUTH for
-- rpc_ff_submit_game_scores (run last). This definition lacks
-- require_mfa()/venue-scoping/audit logging — kept only for fresh-bootstrap
-- ordering (the rank_points column add above is still needed).
CREATE OR REPLACE FUNCTION public.rpc_ff_submit_game_scores(
  p_game_id uuid,
  p_scores  jsonb
) RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tid         uuid;
  v_gid         uuid;
  v_rid         uuid;
  v_rnum        int;
  v_gnum        int;
  v_entry       jsonb;
  v_loser       uuid;
  v_left        int;
  v_next_rid    uuid;
  v_new_gid     uuid;
  v_users       uuid[];
  v_names       text[];
  v_n           int;
  v_g           int;
  v_i           int;
  v_num_players int;
  v_game1_id    uuid;
BEGIN
  IF NOT public.is_admin() THEN RETURN json_build_object('error','unauthorized'); END IF;

  SELECT gm.tournament_id, gm.group_id, gm.game_number,
         bg.round_id, br.round_number
  INTO   v_tid, v_gid, v_gnum, v_rid, v_rnum
  FROM   ff_bracket_games  gm
  JOIN   ff_bracket_groups bg ON bg.id = gm.group_id
  JOIN   ff_bracket_rounds br ON br.id = bg.round_id
  WHERE  gm.id = p_game_id;
  IF NOT FOUND THEN RETURN json_build_object('error','game_not_found'); END IF;

  -- Upsert raw scores (LIMIT 1 on subquery fixes the multi-row bug)
  FOR v_entry IN SELECT * FROM jsonb_array_elements(p_scores) LOOP
    INSERT INTO ff_bracket_scores (game_id, tournament_id, user_id, username, score)
    SELECT p_game_id, v_tid,
           (v_entry->>'user_id')::uuid,
           COALESCE(
             (SELECT username FROM ff_bracket_slots
              WHERE group_id = v_gid AND user_id = (v_entry->>'user_id')::uuid LIMIT 1),
             'Player'
           ),
           (v_entry->>'score')::int
    ON CONFLICT (game_id, user_id) DO UPDATE SET score = EXCLUDED.score;
  END LOOP;

  -- Count players in this game
  SELECT COUNT(*) INTO v_num_players FROM ff_bracket_scores WHERE game_id = p_game_id;

  -- Rank players (1=best) and compute rank_points = num_players - rank + 1
  -- e.g. 4 players: 1st→4pts, 2nd→3pts, 3rd→2pts, 4th→1pt
  WITH rk AS (
    SELECT user_id,
           RANK() OVER (ORDER BY score DESC) AS r
    FROM ff_bracket_scores WHERE game_id = p_game_id
  )
  UPDATE ff_bracket_scores s
  SET rank_in_game  = r.r,
      rank_points   = v_num_players - r.r + 1,
      is_eliminated = false
  FROM rk r
  WHERE s.game_id = p_game_id AND s.user_id = r.user_id;

  UPDATE ff_bracket_games SET status = 'completed' WHERE id = p_game_id;

  -- ── Final 4: one game, rank_in_game = tournament placement ────────────────
  IF v_rnum = 4 THEN
    UPDATE ff_bracket_slots s
    SET    status = 'advanced', final_rank = sc.rank_in_game
    FROM   ff_bracket_scores sc
    WHERE  s.group_id = v_gid AND s.user_id = sc.user_id AND sc.game_id = p_game_id;

    UPDATE ff_bracket_groups SET status = 'completed' WHERE id = v_gid;
    UPDATE ff_bracket_rounds SET status = 'completed' WHERE id = v_rid;
    UPDATE tournaments        SET status = 'completed' WHERE id = v_tid;

    INSERT INTO tournament_placements (tournament_id, placement, user_id)
    SELECT v_tid, s.final_rank, s.user_id
    FROM   ff_bracket_slots  s
    JOIN   ff_bracket_groups g ON g.id = s.group_id
    WHERE  g.round_id = v_rid
    ON CONFLICT DO NOTHING;

    RETURN json_build_object('ok', true, 'tournament_complete', true);
  END IF;

  -- ── Game 1: eliminate player with lowest rank_points this game (last place) ─
  IF v_gnum = 1 THEN
    SELECT user_id INTO v_loser
    FROM   ff_bracket_scores
    WHERE  game_id = p_game_id
    ORDER  BY rank_points ASC, score ASC, user_id ASC
    LIMIT  1;

    UPDATE ff_bracket_scores SET is_eliminated = true
    WHERE  game_id = p_game_id AND user_id = v_loser;
    UPDATE ff_bracket_slots  SET status = 'eliminated', eliminated_game = 1
    WHERE  group_id = v_gid AND user_id = v_loser;

    UPDATE ff_bracket_groups SET status = 'game2' WHERE id = v_gid;
    RETURN json_build_object('ok', true, 'next', 'game2');
  END IF;

  -- ── Game 2: eliminate player with lowest TOTAL rank_points (G1 + G2) ────────
  -- Tiebreaker: lower Game 2 raw score also goes out
  SELECT id INTO v_game1_id
  FROM   ff_bracket_games WHERE group_id = v_gid AND game_number = 1;

  SELECT user_id INTO v_loser
  FROM (
    SELECT
      s.user_id,
      SUM(s.rank_points)                                          AS total_pts,
      MAX(CASE WHEN s.game_id = p_game_id THEN s.score ELSE NULL END) AS game2_score
    FROM   ff_bracket_scores s
    WHERE  s.game_id IN (v_game1_id, p_game_id)
      AND  NOT s.is_eliminated
    GROUP  BY s.user_id
    ORDER  BY total_pts ASC, game2_score ASC, s.user_id ASC
    LIMIT  1
  ) sub;

  UPDATE ff_bracket_scores SET is_eliminated = true
  WHERE  game_id = p_game_id AND user_id = v_loser;
  UPDATE ff_bracket_slots  SET status = 'eliminated', eliminated_game = 2
  WHERE  group_id = v_gid AND user_id = v_loser;

  -- Remaining active players advance
  UPDATE ff_bracket_slots SET status = 'advanced'
  WHERE  group_id = v_gid AND status = 'active';
  UPDATE ff_bracket_groups SET status = 'completed' WHERE id = v_gid;

  -- Any groups left in this round?
  SELECT COUNT(*) INTO v_left FROM ff_bracket_groups
  WHERE round_id = v_rid AND status <> 'completed';
  IF v_left > 0 THEN
    RETURN json_build_object('ok', true, 'groups_left', v_left);
  END IF;

  -- ── Round complete: shuffle advanced players into next round ──────────────
  UPDATE ff_bracket_rounds SET status = 'completed' WHERE id = v_rid;

  SELECT id INTO v_next_rid FROM ff_bracket_rounds
  WHERE tournament_id = v_tid AND round_number = v_rnum + 1;

  WITH adv AS (
    SELECT s.user_id, s.username,
           ROW_NUMBER() OVER (ORDER BY random()) AS rn
    FROM   ff_bracket_slots  s
    JOIN   ff_bracket_groups g ON g.id = s.group_id
    WHERE  g.round_id = v_rid AND s.status = 'advanced'
  )
  SELECT array_agg(user_id ORDER BY rn),
         array_agg(username ORDER BY rn)
  INTO   v_users, v_names FROM adv;

  v_n := array_length(v_users, 1) / 4;

  FOR v_g IN 1..v_n LOOP
    INSERT INTO ff_bracket_groups (round_id, tournament_id, group_number, status)
    VALUES (v_next_rid, v_tid, v_g, 'game1')
    RETURNING id INTO v_new_gid;

    FOR v_i IN 1..4 LOOP
      INSERT INTO ff_bracket_slots (group_id, tournament_id, user_id, username, seed)
      VALUES (v_new_gid, v_tid, v_users[(v_g-1)*4+v_i], v_names[(v_g-1)*4+v_i], v_i);
    END LOOP;

    IF v_rnum + 1 < 4 THEN
      INSERT INTO ff_bracket_games (group_id, tournament_id, game_number, status)
      VALUES (v_new_gid, v_tid, 1, 'pending'), (v_new_gid, v_tid, 2, 'pending');
    ELSE
      -- Final 4: single game
      INSERT INTO ff_bracket_games (group_id, tournament_id, game_number, status)
      VALUES (v_new_gid, v_tid, 1, 'pending');
    END IF;
  END LOOP;

  UPDATE ff_bracket_rounds SET status = 'in_progress' WHERE id = v_next_rid;
  RETURN json_build_object('ok', true, 'round_complete', true, 'next_round', v_rnum + 1);
END;
$$;
GRANT EXECUTE ON FUNCTION public.rpc_ff_submit_game_scores(uuid, jsonb) TO authenticated;

-- Update get_bracket to expose rank_points in score rows
--
-- ⚠ SOURCE OF TRUTH for public.rpc_ff_get_bracket (adds `rank_points` to each
-- score row vs. the original definition in scripts/ff-bracket.sql). Read-only
-- — no admin check needed.
CREATE OR REPLACE FUNCTION public.rpc_ff_get_bracket(p_tournament_id uuid)
RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT json_build_object(
    'rounds', (
      SELECT json_agg(
        json_build_object(
          'id',           r.id,
          'round_number', r.round_number,
          'round_name',   r.round_name,
          'status',       r.status,
          'groups', (
            SELECT json_agg(
              json_build_object(
                'id',           g.id,
                'group_number', g.group_number,
                'status',       g.status,
                'slots', (
                  SELECT json_agg(
                    json_build_object(
                      'user_id',         s.user_id,
                      'username',        s.username,
                      'seed',            s.seed,
                      'status',          s.status,
                      'eliminated_game', s.eliminated_game,
                      'final_rank',      s.final_rank
                    ) ORDER BY s.seed
                  ) FROM ff_bracket_slots s WHERE s.group_id = g.id
                ),
                'games', (
                  SELECT json_agg(
                    json_build_object(
                      'id',          gm.id,
                      'game_number', gm.game_number,
                      'status',      gm.status,
                      'scores', (
                        SELECT json_agg(
                          json_build_object(
                            'user_id',      sc.user_id,
                            'username',     sc.username,
                            'score',        sc.score,
                            'rank_in_game', sc.rank_in_game,
                            'rank_points',  sc.rank_points,
                            'is_eliminated',sc.is_eliminated
                          ) ORDER BY sc.rank_in_game
                        ) FROM ff_bracket_scores sc WHERE sc.game_id = gm.id
                      )
                    ) ORDER BY gm.game_number
                  ) FROM ff_bracket_games gm WHERE gm.group_id = g.id
                )
              ) ORDER BY g.group_number
            ) FROM ff_bracket_groups g WHERE g.round_id = r.id
          )
        ) ORDER BY r.round_number
      ) FROM ff_bracket_rounds r WHERE r.tournament_id = p_tournament_id
    )
  );
$$;
GRANT EXECUTE ON FUNCTION public.rpc_ff_get_bracket(uuid) TO authenticated;
