-- Allow admin to add players without accounts (guests) to First Friday bracket
-- Run in Supabase SQL Editor AFTER ff-bracket-seed-fix.sql

-- ── 1. Schema changes ─────────────────────────────────────────────────────────

-- Allow NULL user_id in registrations (guests have no account)
ALTER TABLE tournament_registrations ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE tournament_registrations ADD COLUMN IF NOT EXISTS guest_name text;

-- Drop FK on bracket slots/scores so generated UUIDs work for guests
-- (PostgreSQL FK constraint names vary; drop by common patterns, ignore errors)
DO $$
BEGIN
  BEGIN ALTER TABLE ff_bracket_slots  DROP CONSTRAINT ff_bracket_slots_user_id_fkey;  EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE ff_bracket_scores DROP CONSTRAINT ff_bracket_scores_user_id_fkey; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE ff_bracket_slots  ALTER COLUMN user_id DROP NOT NULL; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE ff_bracket_scores ALTER COLUMN user_id DROP NOT NULL; EXCEPTION WHEN OTHERS THEN NULL; END;
END $$;

-- Add username to tournament_placements so guest names persist after the event
ALTER TABLE tournament_placements ADD COLUMN IF NOT EXISTS username text;

-- Drop FK on tournament_placements.user_id so generated guest UUIDs work
DO $$
BEGIN
  BEGIN ALTER TABLE tournament_placements DROP CONSTRAINT tournament_placements_user_id_fkey; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE tournament_placements ALTER COLUMN user_id DROP NOT NULL; EXCEPTION WHEN OTHERS THEN NULL; END;
END $$;

-- ── 2. rpc_admin_add_ff_guest ─────────────────────────────────────────────────
-- Venue-scoped: platform admin OR venue admin of the tournament's venue.
CREATE OR REPLACE FUNCTION public.rpc_admin_add_ff_guest(
  p_tournament_id uuid,
  p_guest_name    text
) RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_count    int;
  v_venue_id uuid;
BEGIN
  PERFORM public.require_mfa();

  SELECT venue_id INTO v_venue_id
    FROM tournaments
   WHERE id = p_tournament_id AND is_individual = true AND game_type = 'Skee-Ball';

  IF NOT FOUND THEN RETURN json_build_object('error','not_ff_tournament'); END IF;

  IF NOT (public.is_admin() OR
          (v_venue_id IS NOT NULL AND public.can_manage_venue(v_venue_id))) THEN
    INSERT INTO security_events (event_type, severity, user_id, details)
    VALUES ('admin_access_denied', 'warn', auth.uid(),
      jsonb_build_object('rpc', 'rpc_admin_add_ff_guest', 'tournament_id', p_tournament_id))
    ON CONFLICT DO NOTHING;
    RETURN json_build_object('error','unauthorized');
  END IF;

  IF EXISTS (SELECT 1 FROM ff_bracket_rounds WHERE tournament_id = p_tournament_id) THEN
    RETURN json_build_object('error','bracket_already_generated');
  END IF;

  SELECT COUNT(*) INTO v_count FROM tournament_registrations
  WHERE tournament_id = p_tournament_id AND status = 'accepted';

  IF v_count >= 32 THEN RETURN json_build_object('error','tournament_full'); END IF;

  IF trim(p_guest_name) = '' OR trim(p_guest_name) IS NULL THEN
    RETURN json_build_object('error','name_required');
  END IF;

  INSERT INTO tournament_registrations (tournament_id, user_id, guest_name, status)
  VALUES (p_tournament_id, NULL, trim(p_guest_name), 'accepted');

  INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'add_ff_guest', 'tournament', p_tournament_id::text,
          jsonb_build_object('guest_name', trim(p_guest_name)));

  RETURN json_build_object('ok', true);
END; $$;
REVOKE ALL ON FUNCTION public.rpc_admin_add_ff_guest(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_admin_add_ff_guest(uuid, text) TO authenticated;

-- ── 3. rpc_admin_remove_ff_guest ─────────────────────────────────────────────
-- Venue-scoped: platform admin OR venue admin of the tournament's venue.
CREATE OR REPLACE FUNCTION public.rpc_admin_remove_ff_guest(
  p_reg_id uuid
) RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tournament_id uuid;
  v_guest_name    text;
  v_venue_id      uuid;
BEGIN
  PERFORM public.require_mfa();

  SELECT tr.tournament_id, tr.guest_name, t.venue_id
    INTO v_tournament_id, v_guest_name, v_venue_id
    FROM tournament_registrations tr
    LEFT JOIN tournaments t ON t.id = tr.tournament_id
   WHERE tr.id = p_reg_id AND tr.user_id IS NULL;  -- only guest rows have NULL user_id

  IF NOT FOUND THEN RETURN json_build_object('error','not_found'); END IF;

  IF NOT (public.is_admin() OR
          (v_venue_id IS NOT NULL AND public.can_manage_venue(v_venue_id))) THEN
    INSERT INTO security_events (event_type, severity, user_id, details)
    VALUES ('admin_access_denied', 'warn', auth.uid(),
      jsonb_build_object('rpc', 'rpc_admin_remove_ff_guest', 'reg_id', p_reg_id))
    ON CONFLICT DO NOTHING;
    RETURN json_build_object('error','unauthorized');
  END IF;

  DELETE FROM tournament_registrations WHERE id = p_reg_id;

  INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'remove_ff_guest', 'tournament', v_tournament_id::text,
          jsonb_build_object('reg_id', p_reg_id, 'guest_name', v_guest_name));

  RETURN json_build_object('ok', true);
END; $$;
REVOKE ALL ON FUNCTION public.rpc_admin_remove_ff_guest(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_admin_remove_ff_guest(uuid) TO authenticated;

-- ── 4. Update rpc_ff_generate_bracket to handle guests ───────────────────────
-- ⚠ SOURCE OF TRUTH for public.rpc_ff_generate_bracket (chronologically the
-- newest definition — see scripts/ff-bracket.sql for the earlier, superseded
-- definition). Venue-scoped: platform admin OR venue admin of the
-- tournament's venue. Run this file LAST among the ff-bracket-*.sql /
-- ff-guest-player.sql scripts.
CREATE OR REPLACE FUNCTION public.rpc_ff_generate_bracket(p_tournament_id uuid)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_count    int;
  v_users    uuid[];
  v_names    text[];
  v_rid      uuid;
  v_gid      uuid;
  v_g        int;
  v_i        int;
  v_venue_id uuid;
BEGIN
  PERFORM public.require_mfa();

  SELECT venue_id INTO v_venue_id FROM tournaments WHERE id = p_tournament_id;
  IF NOT FOUND THEN RETURN json_build_object('error','tournament_not_found'); END IF;

  IF NOT (public.is_admin() OR
          (v_venue_id IS NOT NULL AND public.can_manage_venue(v_venue_id))) THEN
    INSERT INTO security_events (event_type, severity, user_id, details)
    VALUES ('admin_access_denied', 'warn', auth.uid(),
      jsonb_build_object('rpc', 'rpc_ff_generate_bracket', 'tournament_id', p_tournament_id))
    ON CONFLICT DO NOTHING;
    RETURN json_build_object('error','unauthorized');
  END IF;

  SELECT COUNT(*) INTO v_count FROM tournament_registrations
  WHERE tournament_id = p_tournament_id AND status = 'accepted';
  IF v_count <> 32 THEN
    RETURN json_build_object('error','need_32_players','count',v_count);
  END IF;
  IF EXISTS (SELECT 1 FROM ff_bracket_rounds WHERE tournament_id = p_tournament_id) THEN
    RETURN json_build_object('error','bracket_already_exists');
  END IF;

  -- Shuffle players; guests get gen_random_uuid() as their slot user_id
  WITH shuffled AS (
    SELECT
      COALESCE(r.user_id, gen_random_uuid()) AS slot_uid,
      COALESCE(r.guest_name, p.username, au.email, 'Player') AS uname,
      ROW_NUMBER() OVER (ORDER BY random()) AS rn
    FROM tournament_registrations r
    LEFT JOIN profiles   p  ON p.id  = r.user_id
    LEFT JOIN auth.users au ON au.id = r.user_id
    WHERE r.tournament_id = p_tournament_id AND r.status = 'accepted'
  )
  SELECT array_agg(slot_uid ORDER BY rn),
         array_agg(uname    ORDER BY rn)
  INTO   v_users, v_names FROM shuffled;

  -- Round 1 (in_progress) + placeholder rounds 2-4
  INSERT INTO ff_bracket_rounds (tournament_id, round_number, round_name, status)
  VALUES
    (p_tournament_id, 1, 'Round of 32', 'in_progress'),
    (p_tournament_id, 2, 'Top 16',      'pending'),
    (p_tournament_id, 3, 'Final 8',     'pending'),
    (p_tournament_id, 4, 'Final 4',     'pending');

  SELECT id INTO v_rid FROM ff_bracket_rounds
  WHERE tournament_id = p_tournament_id AND round_number = 1;

  FOR v_g IN 1..8 LOOP
    INSERT INTO ff_bracket_groups (round_id, tournament_id, group_number, status)
    VALUES (v_rid, p_tournament_id, v_g, 'game1')
    RETURNING id INTO v_gid;

    FOR v_i IN 1..4 LOOP
      INSERT INTO ff_bracket_slots (group_id, tournament_id, user_id, username, seed)
      VALUES (v_gid, p_tournament_id, v_users[(v_g-1)*4+v_i], v_names[(v_g-1)*4+v_i], v_i);
    END LOOP;

    INSERT INTO ff_bracket_games (group_id, tournament_id, game_number, status)
    VALUES (v_gid, p_tournament_id, 1, 'pending'),
           (v_gid, p_tournament_id, 2, 'pending');
  END LOOP;

  UPDATE tournaments SET status = 'active' WHERE id = p_tournament_id;

  INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'ff_generate_bracket', 'tournament', p_tournament_id::text, '{}');

  RETURN json_build_object('ok', true);
END; $$;
GRANT EXECUTE ON FUNCTION public.rpc_ff_generate_bracket(uuid) TO authenticated;

-- ── 5. Update rpc_ff_submit_game_scores to handle guests + save username ──────
-- Full replacement incorporating: player_seed fix + v2 round structure + guest support
--
-- ⚠ SOURCE OF TRUTH for public.rpc_ff_submit_game_scores. This is the latest
-- bracket-format logic (chronologically newest of the ff-bracket-*.sql /
-- ff-guest-player.sql variants — see scripts/ff-bracket.sql,
-- ff-bracket-scoring.sql, ff-bracket-reedit.sql, ff-bracket-fix.sql,
-- ff-bracket-v2.sql, all of which define earlier iterations of this function
-- and are superseded). Run this file LAST among the ff-bracket-*.sql /
-- ff-guest-player.sql scripts. Adds require_mfa() + venue-scoped admin check
-- + security_events/admin_audit_log logging — keep these in sync if any
-- earlier-iteration file is ever revived.
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
  v_loser_seed  int;
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
      DELETE FROM ff_bracket_scores
      WHERE game_id = (SELECT id FROM ff_bracket_games WHERE group_id = v_gid AND game_number = 2);
      UPDATE ff_bracket_games SET status = 'pending'
      WHERE group_id = v_gid AND game_number = 2;
      UPDATE ff_bracket_slots SET status = 'active', eliminated_game = NULL WHERE group_id = v_gid;
      UPDATE ff_bracket_groups SET status = 'game1' WHERE id = v_gid;
    ELSIF v_gnum = 2 THEN
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
    INSERT INTO ff_bracket_scores (game_id, tournament_id, user_id, username, score, player_seed)
    SELECT p_game_id, v_tid,
           NULLIF((v_entry->>'user_id'), '')::uuid,
           COALESCE(
             (SELECT username FROM ff_bracket_slots
              WHERE group_id = v_gid AND seed = (v_entry->>'seed')::int LIMIT 1),
             'Player'
           ),
           (v_entry->>'score')::int,
           (v_entry->>'seed')::int
    ON CONFLICT (game_id, user_id, player_seed) DO UPDATE SET score = EXCLUDED.score;
  END LOOP;

  SELECT COUNT(*) INTO v_num_players FROM ff_bracket_scores WHERE game_id = p_game_id;

  -- Rank for display
  WITH rk AS (
    SELECT player_seed, RANK() OVER (ORDER BY score DESC) AS r
    FROM ff_bracket_scores WHERE game_id = p_game_id
  )
  UPDATE ff_bracket_scores s
  SET rank_in_game  = r.r,
      rank_points   = v_num_players - r.r + 1,
      is_eliminated = false
  FROM rk r
  WHERE s.game_id = p_game_id AND s.player_seed = r.player_seed;

  UPDATE ff_bracket_games SET status = 'completed' WHERE id = p_game_id;

  -- ── Final 4: 1 game, rank = placement ────────────────────────────────────────
  IF v_rnum = 4 THEN
    UPDATE ff_bracket_slots s
    SET    status = 'advanced', final_rank = sc.rank_in_game
    FROM   ff_bracket_scores sc
    WHERE  s.group_id = v_gid AND s.player_seed = sc.player_seed AND sc.game_id = p_game_id;
    UPDATE ff_bracket_groups SET status = 'completed' WHERE id = v_gid;
    UPDATE ff_bracket_rounds SET status = 'completed' WHERE id = v_rid;
    UPDATE tournaments        SET status = 'completed' WHERE id = v_tid;
    INSERT INTO tournament_placements (tournament_id, placement, user_id, username)
    SELECT v_tid, s.final_rank, s.user_id, s.username
    FROM   ff_bracket_slots s JOIN ff_bracket_groups g ON g.id = s.group_id
    WHERE  g.round_id = v_rid
    ON CONFLICT DO NOTHING;
    RETURN json_build_object('ok', true, 'tournament_complete', true);
  END IF;

  -- ── Round of 32: 2 games per group, 1 eliminated per game ────────────────────
  IF v_rnum = 1 THEN
    SELECT sc.user_id, sc.player_seed INTO v_loser_uid, v_loser_seed
    FROM   ff_bracket_scores sc
    WHERE  sc.game_id = p_game_id
    ORDER  BY sc.score ASC, sc.player_seed ASC LIMIT 1;

    SELECT id INTO v_loser_slot
    FROM   ff_bracket_slots
    WHERE  group_id = v_gid AND seed = v_loser_seed AND status = 'active'
    ORDER  BY id LIMIT 1;

    UPDATE ff_bracket_scores SET is_eliminated = true
    WHERE  game_id = p_game_id AND player_seed = v_loser_seed;
    UPDATE ff_bracket_slots SET status = 'eliminated', eliminated_game = v_gnum
    WHERE  id = v_loser_slot;

    IF v_gnum = 1 THEN
      UPDATE ff_bracket_groups SET status = 'game2' WHERE id = v_gid;
      RETURN json_build_object('ok', true, 'next', 'game2');
    END IF;

    UPDATE ff_bracket_slots SET status = 'advanced' WHERE group_id = v_gid AND status = 'active';
    UPDATE ff_bracket_groups SET status = 'completed' WHERE id = v_gid;
  END IF;

  -- ── Top 16 / Final 8: 1 game per group, bottom 2 eliminated, top 2 advance ───
  IF v_rnum IN (2, 3) THEN
    FOR v_i IN 1..2 LOOP
      SELECT sc.user_id, sc.player_seed INTO v_loser_uid, v_loser_seed
      FROM   ff_bracket_scores sc
      JOIN   ff_bracket_slots  sl ON sl.group_id = v_gid AND sl.seed = sc.player_seed AND sl.status = 'active'
      WHERE  sc.game_id = p_game_id
      ORDER  BY sc.score ASC, sc.player_seed ASC LIMIT 1;

      SELECT id INTO v_loser_slot
      FROM   ff_bracket_slots
      WHERE  group_id = v_gid AND seed = v_loser_seed AND status = 'active'
      ORDER  BY id LIMIT 1;

      UPDATE ff_bracket_slots SET status = 'eliminated', eliminated_game = 1
      WHERE  id = v_loser_slot;
    END LOOP;

    UPDATE ff_bracket_scores SET is_eliminated = true
    WHERE  game_id = p_game_id
      AND  player_seed IN (
             SELECT seed FROM ff_bracket_slots
             WHERE group_id = v_gid AND eliminated_game = 1
           );

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

    INSERT INTO ff_bracket_games (group_id, tournament_id, game_number, status)
    VALUES (v_new_gid, v_tid, 1, 'pending');
  END LOOP;

  UPDATE ff_bracket_rounds SET status = 'in_progress' WHERE id = v_next_rid;
  RETURN json_build_object('ok', true, 'round_complete', true, 'next_round', v_rnum + 1);
END; $$;
GRANT EXECUTE ON FUNCTION public.rpc_ff_submit_game_scores(uuid, jsonb) TO authenticated;

-- ── 6. rpc_ff_get_guest_players — list guests for a tournament ────────────────
CREATE OR REPLACE FUNCTION public.rpc_ff_get_guest_players(p_tournament_id uuid)
RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT json_build_object(
    'guests', COALESCE(
      (SELECT json_agg(json_build_object('id', id, 'guest_name', guest_name) ORDER BY created_at)
       FROM tournament_registrations
       WHERE tournament_id = p_tournament_id AND user_id IS NULL AND status = 'accepted'),
      '[]'::json
    )
  );
$$;
GRANT EXECUTE ON FUNCTION public.rpc_ff_get_guest_players(uuid) TO authenticated;
