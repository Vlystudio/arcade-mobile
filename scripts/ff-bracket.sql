-- First Friday Skee-Ball: editable times + full bracket engine
-- Run in Supabase SQL Editor

-- ─── 1. Editable sign-up / start times on tournaments ─────────────────────────
ALTER TABLE tournaments
  ADD COLUMN IF NOT EXISTS ff_signup_time text DEFAULT '7:30 PM',
  ADD COLUMN IF NOT EXISTS ff_start_time  text DEFAULT '8:00 PM';

-- ─── 2. Bracket tables ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ff_bracket_rounds (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id uuid        NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  round_number  int         NOT NULL,   -- 1=R32  2=Top16  3=Final8  4=Final4
  round_name    text        NOT NULL,
  status        text        NOT NULL DEFAULT 'pending',
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tournament_id, round_number)
);

CREATE TABLE IF NOT EXISTS ff_bracket_groups (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id      uuid        NOT NULL REFERENCES ff_bracket_rounds(id) ON DELETE CASCADE,
  tournament_id uuid        NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  group_number  int         NOT NULL,
  status        text        NOT NULL DEFAULT 'game1',
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (round_id, group_number)
);

CREATE TABLE IF NOT EXISTS ff_bracket_slots (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id        uuid        NOT NULL REFERENCES ff_bracket_groups(id) ON DELETE CASCADE,
  tournament_id   uuid        NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  user_id         uuid        NOT NULL REFERENCES auth.users(id),
  username        text        NOT NULL,
  seed            int         NOT NULL,
  status          text        NOT NULL DEFAULT 'active',  -- active | eliminated | advanced
  eliminated_game int,
  final_rank      int,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ff_bracket_games (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id      uuid        NOT NULL REFERENCES ff_bracket_groups(id) ON DELETE CASCADE,
  tournament_id uuid        NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  game_number   int         NOT NULL,
  status        text        NOT NULL DEFAULT 'pending',   -- pending | completed
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (group_id, game_number)
);

CREATE TABLE IF NOT EXISTS ff_bracket_scores (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id       uuid        NOT NULL REFERENCES ff_bracket_games(id) ON DELETE CASCADE,
  tournament_id uuid        NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  user_id       uuid        NOT NULL REFERENCES auth.users(id),
  username      text        NOT NULL,
  score         int         NOT NULL,
  rank_in_game  int,
  is_eliminated boolean     NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (game_id, user_id)
);

-- RLS: anyone authenticated can read bracket data (it's public info)
ALTER TABLE ff_bracket_rounds  ENABLE ROW LEVEL SECURITY;
ALTER TABLE ff_bracket_groups  ENABLE ROW LEVEL SECURITY;
ALTER TABLE ff_bracket_slots   ENABLE ROW LEVEL SECURITY;
ALTER TABLE ff_bracket_games   ENABLE ROW LEVEL SECURITY;
ALTER TABLE ff_bracket_scores  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Auth read bracket rounds"  ON ff_bracket_rounds;
DROP POLICY IF EXISTS "Auth read bracket groups"  ON ff_bracket_groups;
DROP POLICY IF EXISTS "Auth read bracket slots"   ON ff_bracket_slots;
DROP POLICY IF EXISTS "Auth read bracket games"   ON ff_bracket_games;
DROP POLICY IF EXISTS "Auth read bracket scores"  ON ff_bracket_scores;

CREATE POLICY "Auth read bracket rounds"  ON ff_bracket_rounds  FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Auth read bracket groups"  ON ff_bracket_groups  FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Auth read bracket slots"   ON ff_bracket_slots   FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Auth read bracket games"   ON ff_bracket_games   FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Auth read bracket scores"  ON ff_bracket_scores  FOR SELECT USING (auth.role() = 'authenticated');

-- ─── 3. Update rpc_admin_update_tournament (add time params) ──────────────────
DROP FUNCTION IF EXISTS public.rpc_admin_update_tournament(uuid, text, text, timestamptz, int);

-- ⚠ This 7-arg overload (with p_signup_time/p_start_time) is the one called by
-- the app (src/app/admin.tsx handleEditTournament). A separate 5-arg overload
-- of rpc_admin_update_tournament exists in scripts/rpc-admin-tournament-edit.sql
-- — Postgres treats these as distinct functions since the argument lists
-- differ. Keep both hardened (require_mfa + venue-scoped + audit log) if
-- either is changed.
CREATE OR REPLACE FUNCTION public.rpc_admin_update_tournament(
  p_tournament_id uuid,
  p_title         text        DEFAULT NULL,
  p_game_type     text        DEFAULT NULL,
  p_proposed_date timestamptz DEFAULT NULL,
  p_max_players   int         DEFAULT NULL,
  p_signup_time   text        DEFAULT NULL,
  p_start_time    text        DEFAULT NULL
)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_title    text;
  v_venue_id uuid;
BEGIN
  PERFORM public.require_mfa();

  SELECT title, venue_id INTO v_title, v_venue_id
    FROM tournaments WHERE id = p_tournament_id;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'tournament_not_found');
  END IF;

  IF NOT (public.is_admin() OR
          (v_venue_id IS NOT NULL AND public.can_manage_venue(v_venue_id))) THEN
    INSERT INTO security_events (event_type, severity, user_id, details)
    VALUES ('admin_access_denied', 'warn', auth.uid(),
      jsonb_build_object('rpc', 'rpc_admin_update_tournament', 'tournament_id', p_tournament_id))
    ON CONFLICT DO NOTHING;
    RETURN json_build_object('error', 'unauthorized');
  END IF;

  UPDATE tournaments SET
    title          = COALESCE(NULLIF(trim(p_title), ''),        title),
    game_type      = COALESCE(NULLIF(trim(p_game_type), ''),    game_type),
    proposed_date  = COALESCE(p_proposed_date,                  proposed_date),
    max_players    = COALESCE(p_max_players,                    max_players),
    ff_signup_time = COALESCE(NULLIF(trim(p_signup_time), ''),  ff_signup_time),
    ff_start_time  = COALESCE(NULLIF(trim(p_start_time), ''),   ff_start_time)
  WHERE id = p_tournament_id;

  INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'update_tournament', 'tournament', p_tournament_id::text,
          jsonb_build_object('title', v_title));

  RETURN json_build_object('ok', true);
END;
$$;
REVOKE ALL ON FUNCTION public.rpc_admin_update_tournament(uuid, text, text, timestamptz, int, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_admin_update_tournament(uuid, text, text, timestamptz, int, text, text) TO authenticated;

-- ─── 4. rpc_ff_generate_bracket ───────────────────────────────────────────────
-- ⚠ SUPERSEDED by scripts/ff-guest-player.sql, the SOURCE OF TRUTH for
-- rpc_ff_generate_bracket (run last — adds guest-player support). This
-- definition is venue-scoped + hardened but lacks guest support — kept only
-- for fresh-bootstrap ordering.
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

  -- Shuffle players
  WITH shuffled AS (
    SELECT r.user_id, COALESCE(p.username, au.email, 'Player') AS uname,
           ROW_NUMBER() OVER (ORDER BY random()) AS rn
    FROM tournament_registrations r
    LEFT JOIN profiles   p  ON p.id  = r.user_id
    LEFT JOIN auth.users au ON au.id = r.user_id
    WHERE r.tournament_id = p_tournament_id AND r.status = 'accepted'
  )
  SELECT array_agg(user_id ORDER BY rn),
         array_agg(uname   ORDER BY rn)
  INTO   v_users, v_names FROM shuffled;

  -- Round 1 (in_progress) + placeholder rounds 2-4
  INSERT INTO ff_bracket_rounds (tournament_id, round_number, round_name, status)
  VALUES
    (p_tournament_id, 1, 'Round of 32', 'in_progress'),
    (p_tournament_id, 2, 'Top 16',      'pending'),
    (p_tournament_id, 3, 'Final 8',     'pending'),
    (p_tournament_id, 4, 'Final 4',     'pending')
  RETURNING id INTO v_rid;  -- captures only last insert; get round 1 below

  SELECT id INTO v_rid FROM ff_bracket_rounds
  WHERE tournament_id = p_tournament_id AND round_number = 1;

  -- 8 groups of 4
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
END;
$$;
GRANT EXECUTE ON FUNCTION public.rpc_ff_generate_bracket(uuid) TO authenticated;

-- ─── 5. rpc_ff_submit_game_scores ─────────────────────────────────────────────
-- p_scores: [{"user_id":"...", "score":12345}, ...]
-- Venue-scoped: platform admin OR venue admin of the tournament's venue.
--
-- ⚠ SUPERSEDED by scripts/ff-guest-player.sql, the SOURCE OF TRUTH for
-- rpc_ff_submit_game_scores (latest bracket-format logic + guest support, run
-- last). This definition is kept so a fresh database run has a working,
-- hardened rpc_ff_submit_game_scores immediately after this script runs. If
-- you change the auth/logging logic here, update ff-guest-player.sql too.
CREATE OR REPLACE FUNCTION public.rpc_ff_submit_game_scores(
  p_game_id uuid,
  p_scores  jsonb
) RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tid        uuid;
  v_gid        uuid;
  v_rid        uuid;
  v_rnum       int;
  v_gnum       int;
  v_entry      jsonb;
  v_loser      uuid;
  v_left       int;
  v_next_rid   uuid;
  v_new_gid    uuid;
  v_users      uuid[];
  v_names      text[];
  v_n          int;
  v_g          int;
  v_i          int;
  v_venue_id   uuid;
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

  -- Upsert scores
  FOR v_entry IN SELECT * FROM jsonb_array_elements(p_scores) LOOP
    INSERT INTO ff_bracket_scores (game_id, tournament_id, user_id, username, score)
    SELECT p_game_id, v_tid,
           (v_entry->>'user_id')::uuid,
           COALESCE((SELECT username FROM ff_bracket_slots
                     WHERE group_id = v_gid AND user_id = (v_entry->>'user_id')::uuid), 'Player'),
           (v_entry->>'score')::int
    ON CONFLICT (game_id, user_id) DO UPDATE SET score = EXCLUDED.score;
  END LOOP;

  -- Rank 1=best
  WITH rk AS (
    SELECT user_id, RANK() OVER (ORDER BY score DESC) AS r
    FROM ff_bracket_scores WHERE game_id = p_game_id
  )
  UPDATE ff_bracket_scores s SET rank_in_game = r.r, is_eliminated = false
  FROM rk r WHERE s.game_id = p_game_id AND s.user_id = r.user_id;

  UPDATE ff_bracket_games SET status = 'completed' WHERE id = p_game_id;

  -- ── Final 4: ranks = placements, no round advancement ─────────────────────
  IF v_rnum = 4 THEN
    UPDATE ff_bracket_slots s
    SET    status = 'advanced', final_rank = sc.rank_in_game
    FROM   ff_bracket_scores sc
    WHERE  s.group_id = v_gid AND s.user_id = sc.user_id AND sc.game_id = p_game_id;

    UPDATE ff_bracket_groups SET status = 'completed' WHERE id = v_gid;
    UPDATE ff_bracket_rounds SET status = 'completed' WHERE id = v_rid;
    UPDATE tournaments SET status = 'completed' WHERE id = v_tid;

    -- Auto-save placements
    INSERT INTO tournament_placements (tournament_id, placement, user_id)
    SELECT v_tid, s.final_rank, s.user_id
    FROM   ff_bracket_slots s
    JOIN   ff_bracket_groups g ON g.id = s.group_id
    WHERE  g.round_id = v_rid
    ON CONFLICT DO NOTHING;

    RETURN json_build_object('ok', true, 'tournament_complete', true);
  END IF;

  -- ── Regular round: eliminate lowest scorer ────────────────────────────────
  SELECT user_id INTO v_loser
  FROM   ff_bracket_scores
  WHERE  game_id = p_game_id
  ORDER  BY score ASC, user_id ASC LIMIT 1;  -- user_id tiebreak

  UPDATE ff_bracket_scores SET is_eliminated = true
  WHERE  game_id = p_game_id AND user_id = v_loser;
  UPDATE ff_bracket_slots  SET status = 'eliminated', eliminated_game = v_gnum
  WHERE  group_id = v_gid AND user_id = v_loser;

  -- After Game 1: game 2 is next
  IF v_gnum = 1 THEN
    UPDATE ff_bracket_groups SET status = 'game2' WHERE id = v_gid;
    RETURN json_build_object('ok', true, 'next', 'game2');
  END IF;

  -- After Game 2: advance remaining 2 players
  UPDATE ff_bracket_slots SET status = 'advanced'
  WHERE  group_id = v_gid AND status = 'active';
  UPDATE ff_bracket_groups SET status = 'completed' WHERE id = v_gid;

  -- Any groups left in this round?
  SELECT COUNT(*) INTO v_left FROM ff_bracket_groups
  WHERE round_id = v_rid AND status <> 'completed';
  IF v_left > 0 THEN
    RETURN json_build_object('ok', true, 'groups_left', v_left);
  END IF;

  -- ── Round complete: seed next round ───────────────────────────────────────
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

-- ─── 6. rpc_ff_get_bracket ────────────────────────────────────────────────────
-- ⚠ SUPERSEDED by scripts/ff-bracket-scoring.sql, which redefines this
-- function to also expose `rank_points` per score row. Read-only (no admin
-- check needed either way) — kept here for fresh-bootstrap ordering.
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
                      'user_id',        s.user_id,
                      'username',       s.username,
                      'seed',           s.seed,
                      'status',         s.status,
                      'eliminated_game',s.eliminated_game,
                      'final_rank',     s.final_rank
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
