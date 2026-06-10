-- Complete bracket rewrite with correct format:
--   Round of 32 : 8 groups × 4 players, 2 games per group, 1 eliminated per game → 16 advance
--   Top 16      : 4 groups × 4 players, 1 game,  bottom 2 eliminated → 8 advance
--   Final 8     : 2 groups × 4 players, 1 game,  bottom 2 eliminated → 4 advance
--   Final 4     : 1 group  × 4 players, 1 game,  ranks = placements
-- Run in Supabase SQL Editor
--
-- ⚠ SUPERSEDED by scripts/ff-guest-player.sql, the SOURCE OF TRUTH for
-- rpc_ff_submit_game_scores (chronologically newer — adds guest-player
-- support + the player_seed-based scoring used by this round structure). This
-- definition is hardened (require_mfa + venue-scoped + audit log) and kept
-- only for fresh-bootstrap ordering — ff-guest-player.sql must run after this
-- file. If you change the auth/logging logic here, update
-- ff-guest-player.sql too.

-- ── rpc_ff_submit_game_scores ─────────────────────────────────────────────────
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
  v_loser_uid   uuid;
  v_loser_slot  uuid;
  v_left        int;
  v_next_rid    uuid;
  v_new_gid     uuid;
  v_users       uuid[];
  v_names       text[];
  v_n           int;
  v_g           int;
  v_i           int;
  v_num_players int;
  v_venue_id    uuid;
BEGIN
  PERFORM public.require_mfa();

  SELECT gm.tournament_id, gm.group_id, gm.game_number,
         bg.round_id, br.round_number
  INTO   v_tid, v_gid, v_gnum, v_rid, v_rnum
  FROM   ff_bracket_games  gm
  JOIN   ff_bracket_groups bg ON bg.id = gm.group_id
  JOIN   ff_bracket_rounds br ON br.id = bg.round_id
  WHERE  gm.id = p_game_id;
  IF NOT FOUND THEN RETURN json_build_object('error','game_not_found'); END IF;

  SELECT venue_id INTO v_venue_id FROM tournaments WHERE id = v_tid;

  IF NOT (public.is_admin() OR
          (v_venue_id IS NOT NULL AND public.can_manage_venue(v_venue_id))) THEN
    INSERT INTO security_events (event_type, severity, user_id, details)
    VALUES ('admin_access_denied', 'warn', auth.uid(),
      jsonb_build_object('rpc', 'rpc_ff_submit_game_scores', 'game_id', p_game_id, 'tournament_id', v_tid))
    ON CONFLICT DO NOTHING;
    RETURN json_build_object('error','unauthorized');
  END IF;

  INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'ff_submit_game_scores', 'tournament', v_tid::text,
          jsonb_build_object('game_id', p_game_id));

  -- ── Undo previous submission when re-editing ────────────────────────────────
  IF EXISTS (SELECT 1 FROM ff_bracket_games WHERE id = p_game_id AND status = 'completed') THEN
    IF v_gnum = 1 THEN
      -- Also clear game 2 if it exists (R32 only — no-op for rounds 2-4)
      DELETE FROM ff_bracket_scores
      WHERE game_id = (SELECT id FROM ff_bracket_games WHERE group_id = v_gid AND game_number = 2);
      UPDATE ff_bracket_games SET status = 'pending'
      WHERE group_id = v_gid AND game_number = 2;
      UPDATE ff_bracket_slots SET status = 'active', eliminated_game = NULL WHERE group_id = v_gid;
      UPDATE ff_bracket_groups SET status = 'game1' WHERE id = v_gid;
    ELSIF v_gnum = 2 THEN
      -- R32 game-2 re-edit: un-advance and un-eliminate game-2 results only
      UPDATE ff_bracket_slots
      SET status = 'active', eliminated_game = NULL
      WHERE group_id = v_gid AND (status = 'advanced' OR eliminated_game = 2);
      UPDATE ff_bracket_groups SET status = 'game2' WHERE id = v_gid;
    END IF;
    UPDATE ff_bracket_rounds SET status = 'in_progress'
    WHERE id = v_rid AND status = 'completed';
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

  SELECT COUNT(*) INTO v_num_players FROM ff_bracket_scores WHERE game_id = p_game_id;

  -- Rank for display (rank_points shown in bracket viewer)
  WITH rk AS (
    SELECT user_id, RANK() OVER (ORDER BY score DESC) AS r
    FROM ff_bracket_scores WHERE game_id = p_game_id
  )
  UPDATE ff_bracket_scores s
  SET rank_in_game  = r.r,
      rank_points   = v_num_players - r.r + 1,
      is_eliminated = false
  FROM rk r
  WHERE s.game_id = p_game_id AND s.user_id = r.user_id;

  UPDATE ff_bracket_games SET status = 'completed' WHERE id = p_game_id;

  -- ── Final 4: 1 game, rank = placement ────────────────────────────────────────
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
    FROM   ff_bracket_slots s JOIN ff_bracket_groups g ON g.id = s.group_id
    WHERE  g.round_id = v_rid
    ON CONFLICT DO NOTHING;
    RETURN json_build_object('ok', true, 'tournament_complete', true);
  END IF;

  -- ── Round of 32: 2 games per group, 1 eliminated per game ────────────────────
  IF v_rnum = 1 THEN
    -- Find the lowest scorer's specific slot (LIMIT 1 by slot ID avoids multi-slot bug)
    SELECT user_id INTO v_loser_uid
    FROM   ff_bracket_scores WHERE game_id = p_game_id
    ORDER  BY score ASC, user_id ASC LIMIT 1;

    SELECT id INTO v_loser_slot
    FROM   ff_bracket_slots
    WHERE  group_id = v_gid AND user_id = v_loser_uid AND status = 'active'
    ORDER  BY seed ASC LIMIT 1;

    UPDATE ff_bracket_scores SET is_eliminated = true
    WHERE  game_id = p_game_id AND user_id = v_loser_uid
      AND  rank_in_game = (SELECT MAX(rank_in_game) FROM ff_bracket_scores
                           WHERE game_id = p_game_id AND user_id = v_loser_uid);
    UPDATE ff_bracket_slots SET status = 'eliminated', eliminated_game = v_gnum
    WHERE  id = v_loser_slot;

    IF v_gnum = 1 THEN
      UPDATE ff_bracket_groups SET status = 'game2' WHERE id = v_gid;
      RETURN json_build_object('ok', true, 'next', 'game2');
    END IF;

    -- Game 2 done: remaining 2 advance
    UPDATE ff_bracket_slots SET status = 'advanced' WHERE group_id = v_gid AND status = 'active';
    UPDATE ff_bracket_groups SET status = 'completed' WHERE id = v_gid;
  END IF;

  -- ── Top 16 / Final 8: 1 game per group, bottom 2 eliminated, top 2 advance ───
  IF v_rnum IN (2, 3) THEN
    -- Eliminate the 2 lowest scorers one at a time (slot-ID targeting is safe with shared user_ids)
    FOR v_i IN 1..2 LOOP
      SELECT sc.user_id INTO v_loser_uid
      FROM   ff_bracket_scores sc
      JOIN   ff_bracket_slots  sl
             ON sl.group_id = v_gid AND sl.user_id = sc.user_id AND sl.status = 'active'
      WHERE  sc.game_id = p_game_id
      ORDER  BY sc.score ASC, sc.user_id ASC
      LIMIT  1;

      SELECT id INTO v_loser_slot
      FROM   ff_bracket_slots
      WHERE  group_id = v_gid AND user_id = v_loser_uid AND status = 'active'
      ORDER  BY seed ASC LIMIT 1;

      UPDATE ff_bracket_slots SET status = 'eliminated', eliminated_game = 1
      WHERE  id = v_loser_slot;
    END LOOP;

    -- Mark score rows for display
    UPDATE ff_bracket_scores SET is_eliminated = true
    WHERE  game_id = p_game_id
      AND  user_id IN (
             SELECT user_id FROM ff_bracket_slots
             WHERE group_id = v_gid AND eliminated_game = 1
           );

    -- Top 2 advance
    UPDATE ff_bracket_slots SET status = 'advanced' WHERE group_id = v_gid AND status = 'active';
    UPDATE ff_bracket_groups SET status = 'completed' WHERE id = v_gid;
  END IF;

  -- ── Check if the whole round is now complete ──────────────────────────────────
  SELECT COUNT(*) INTO v_left FROM ff_bracket_groups
  WHERE round_id = v_rid AND status <> 'completed';
  IF v_left > 0 THEN
    RETURN json_build_object('ok', true, 'groups_left', v_left);
  END IF;

  -- ── Seed the next round ───────────────────────────────────────────────────────
  -- Rounds 2, 3, 4 always get exactly 1 game per group
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
  SELECT array_agg(user_id ORDER BY rn), array_agg(username ORDER BY rn)
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

    -- 1 game for all seeded rounds (2 = Top 16, 3 = Final 8, 4 = Final 4)
    INSERT INTO ff_bracket_games (group_id, tournament_id, game_number, status)
    VALUES (v_new_gid, v_tid, 1, 'pending');
  END LOOP;

  UPDATE ff_bracket_rounds SET status = 'in_progress' WHERE id = v_next_rid;
  RETURN json_build_object('ok', true, 'round_complete', true, 'next_round', v_rnum + 1);
END;
$$;
GRANT EXECUTE ON FUNCTION public.rpc_ff_submit_game_scores(uuid, jsonb) TO authenticated;
