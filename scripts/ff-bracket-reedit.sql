-- Allow re-editing already-submitted game scores
-- Replaces rpc_ff_submit_game_scores from ff-bracket-scoring.sql
-- Run in Supabase SQL Editor
--
-- ⚠ SUPERSEDED by scripts/ff-guest-player.sql, the SOURCE OF TRUTH for
-- rpc_ff_submit_game_scores (run last). This definition lacks
-- require_mfa()/venue-scoping/audit logging — kept only for fresh-bootstrap
-- ordering.
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

  -- ── Undo previous submission if re-editing a completed game ─────────────────
  IF EXISTS (SELECT 1 FROM ff_bracket_games WHERE id = p_game_id AND status = 'completed') THEN
    IF v_gnum = 1 THEN
      -- Clear game 2 scores and reset it to pending
      DELETE FROM ff_bracket_scores
      WHERE game_id = (SELECT id FROM ff_bracket_games WHERE group_id = v_gid AND game_number = 2);
      UPDATE ff_bracket_games SET status = 'pending'
      WHERE group_id = v_gid AND game_number = 2;
      -- Reset all slots back to active
      UPDATE ff_bracket_slots SET status = 'active', eliminated_game = NULL
      WHERE group_id = v_gid;
      -- Reset group back to game1
      UPDATE ff_bracket_groups SET status = 'game1' WHERE id = v_gid;
    ELSIF v_gnum = 2 THEN
      -- Un-advance winners and un-eliminate the game-2 loser
      UPDATE ff_bracket_slots
      SET status = 'active', eliminated_game = NULL
      WHERE group_id = v_gid AND (status = 'advanced' OR eliminated_game = 2);
      -- Reset group back to game2
      UPDATE ff_bracket_groups SET status = 'game2' WHERE id = v_gid;
    END IF;
    -- Reset round to in_progress if it had been marked completed
    UPDATE ff_bracket_rounds SET status = 'in_progress'
    WHERE id = v_rid AND status = 'completed';
    -- Delete old scores for this game so they can be replaced
    DELETE FROM ff_bracket_scores WHERE game_id = p_game_id;
    UPDATE ff_bracket_games SET status = 'pending' WHERE id = p_game_id;
  END IF;

  -- ── Upsert raw scores ────────────────────────────────────────────────────────
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

  -- ── Final 4: one game, rank_in_game = tournament placement ──────────────────
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

  -- ── Game 1: eliminate last place ─────────────────────────────────────────────
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

  -- ── Game 2: eliminate lowest TOTAL rank_points (G1 + G2) ────────────────────
  SELECT id INTO v_game1_id
  FROM   ff_bracket_games WHERE group_id = v_gid AND game_number = 1;

  SELECT user_id INTO v_loser
  FROM (
    SELECT
      s.user_id,
      SUM(s.rank_points)                                               AS total_pts,
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

  UPDATE ff_bracket_slots SET status = 'advanced'
  WHERE  group_id = v_gid AND status = 'active';
  UPDATE ff_bracket_groups SET status = 'completed' WHERE id = v_gid;

  SELECT COUNT(*) INTO v_left FROM ff_bracket_groups
  WHERE round_id = v_rid AND status <> 'completed';
  IF v_left > 0 THEN
    RETURN json_build_object('ok', true, 'groups_left', v_left);
  END IF;

  -- ── Round complete: seed next round ──────────────────────────────────────────
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
      INSERT INTO ff_bracket_games (group_id, tournament_id, game_number, status)
      VALUES (v_new_gid, v_tid, 1, 'pending');
    END IF;
  END LOOP;

  UPDATE ff_bracket_rounds SET status = 'in_progress' WHERE id = v_next_rid;
  RETURN json_build_object('ok', true, 'round_complete', true, 'next_round', v_rnum + 1);
END;
$$;
GRANT EXECUTE ON FUNCTION public.rpc_ff_submit_game_scores(uuid, jsonb) TO authenticated;
