-- ============================================================
-- Skee-Ball QR Lane Check-in
-- Run AFTER: seed-games.sql, venue-migration.sql,
--            qr-token-hardening.sql, skeeball-rls-fix.sql
--
-- Adds the Skee-Ball-specific QR flow without changing the
-- existing league placement / points finalization function.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Ensure the app-facing Skee-Ball tables have the columns used by the QR flow.
CREATE TABLE IF NOT EXISTS public.skeeball_league_matches (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  week_of    date NOT NULL,
  status     text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.skeeball_sessions (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id                  uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  lane_number              int NOT NULL,
  week_of                  date NOT NULL,
  created_by               uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  status                   text NOT NULL DEFAULT 'active',
  last_activity_at         timestamptz NOT NULL DEFAULT now(),
  completed_at             timestamptz,
  league_match_id          uuid REFERENCES public.skeeball_league_matches(id) ON DELETE SET NULL,
  placement                int,
  league_points            int,
  league_points_adjustment int NOT NULL DEFAULT 0,
  score_adjustment         int NOT NULL DEFAULT 0,
  created_at               timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.skeeball_session_players (
  session_id     uuid NOT NULL REFERENCES public.skeeball_sessions(id) ON DELETE CASCADE,
  player_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, player_user_id)
);

CREATE TABLE IF NOT EXISTS public.skeeball_ball_scores (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id     uuid NOT NULL REFERENCES public.skeeball_sessions(id) ON DELETE CASCADE,
  player_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  ball_number    int NOT NULL,
  score          int NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, player_user_id, ball_number)
);

ALTER TABLE public.skeeball_sessions
  ADD COLUMN IF NOT EXISTS last_activity_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS league_match_id uuid REFERENCES public.skeeball_league_matches(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS placement int,
  ADD COLUMN IF NOT EXISTS league_points int,
  ADD COLUMN IF NOT EXISTS league_points_adjustment int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS score_adjustment int NOT NULL DEFAULT 0;

ALTER TABLE public.skeeball_league_matches
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';

ALTER TABLE public.skeeball_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.skeeball_session_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.skeeball_league_matches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "skeeball_sessions_read" ON public.skeeball_sessions;
CREATE POLICY "skeeball_sessions_read" ON public.skeeball_sessions
  FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "skeeball_session_players_read" ON public.skeeball_session_players;
CREATE POLICY "skeeball_session_players_read" ON public.skeeball_session_players
  FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "skeeball_league_matches_read" ON public.skeeball_league_matches;
CREATE POLICY "skeeball_league_matches_read" ON public.skeeball_league_matches
  FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "skeeball_sessions_no_direct_insert" ON public.skeeball_sessions;
CREATE POLICY "skeeball_sessions_no_direct_insert" ON public.skeeball_sessions
  FOR INSERT WITH CHECK (false);

DROP POLICY IF EXISTS "skeeball_session_players_no_direct_insert" ON public.skeeball_session_players;
CREATE POLICY "skeeball_session_players_no_direct_insert" ON public.skeeball_session_players
  FOR INSERT WITH CHECK (false);

CREATE UNIQUE INDEX IF NOT EXISTS idx_skeeball_one_active_lane
  ON public.skeeball_sessions (lane_number)
  WHERE status = 'active';

CREATE UNIQUE INDEX IF NOT EXISTS idx_skeeball_one_active_team
  ON public.skeeball_sessions (team_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_skeeball_sessions_match_status
  ON public.skeeball_sessions (league_match_id, status);

CREATE OR REPLACE FUNCTION public.skeeball_current_week()
RETURNS date LANGUAGE sql STABLE AS $$
  SELECT (current_date - (((extract(dow from current_date)::int + 6) % 7))::int)::date;
$$;

CREATE OR REPLACE FUNCTION public.skeeball_lane_from_token(p_token text)
RETURNS TABLE (
  lane_id uuid,
  lane_number int,
  game_id uuid,
  game_name text,
  game_type text,
  venue_id uuid,
  lane_status text,
  token_error text
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_token_hash text;
  v_lqt record;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN QUERY SELECT NULL::uuid, NULL::int, NULL::uuid, NULL::text, NULL::text, NULL::uuid, NULL::text, 'not_authenticated'::text;
    RETURN;
  END IF;

  v_token_hash := public.hash_lane_token(p_token);

  SELECT * INTO v_lqt
    FROM public.lane_qr_tokens
   WHERE token_hash = v_token_hash
   LIMIT 1;

  IF NOT FOUND THEN
    INSERT INTO public.security_events (event_type, severity, user_id, details)
    VALUES ('skeeball_qr_invalid', 'warn', auth.uid(), jsonb_build_object('token_fingerprint', public.qr_token_fingerprint(p_token)))
    ON CONFLICT DO NOTHING;
    RETURN QUERY SELECT NULL::uuid, NULL::int, NULL::uuid, NULL::text, NULL::text, NULL::uuid, NULL::text, 'lane_not_found'::text;
    RETURN;
  END IF;

  IF v_lqt.revoked_at IS NOT NULL THEN
    RETURN QUERY SELECT NULL::uuid, NULL::int, NULL::uuid, NULL::text, NULL::text, NULL::uuid, NULL::text, 'token_revoked'::text;
    RETURN;
  END IF;

  IF v_lqt.expires_at < now() THEN
    RETURN QUERY SELECT NULL::uuid, NULL::int, NULL::uuid, NULL::text, NULL::text, NULL::uuid, NULL::text, 'token_expired'::text;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT l.id, l.lane_number, g.id, g.name, g.type, l.venue_id, l.status, NULL::text
    FROM public.lanes l
    JOIN public.games g ON g.id = l.game_id
   WHERE l.id = v_lqt.lane_id
     AND g.type = 'skeeball'
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN QUERY SELECT NULL::uuid, NULL::int, NULL::uuid, NULL::text, NULL::text, NULL::uuid, NULL::text, 'not_skeeball'::text;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_skeeball_preview_lane_qr(p_token text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_lane record;
  v_active record;
BEGIN
  SELECT * INTO v_lane FROM public.skeeball_lane_from_token(p_token) LIMIT 1;

  IF v_lane.token_error IS NOT NULL THEN
    RETURN json_build_object('error', v_lane.token_error, 'message', 'This QR code is not available for Skee-Ball check-in.');
  END IF;

  IF v_lane.lane_status = 'inactive' THEN
    RETURN json_build_object('error', 'lane_inactive', 'message', 'This lane is currently inactive.');
  END IF;

  SELECT s.id, s.team_id, t.name AS team_name INTO v_active
    FROM public.skeeball_sessions s
    LEFT JOIN public.teams t ON t.id = s.team_id
   WHERE s.lane_number = v_lane.lane_number
     AND s.status = 'active'
   LIMIT 1;

  IF FOUND THEN
    RETURN json_build_object(
      'error', 'lane_occupied',
      'message', 'Lane ' || v_lane.lane_number || ' is already checked in.',
      'team_name', v_active.team_name
    );
  END IF;

  RETURN json_build_object(
    'ok', true,
    'lane_id', v_lane.lane_id,
    'lane_number', v_lane.lane_number,
    'game_id', v_lane.game_id,
    'game_name', v_lane.game_name,
    'venue_id', v_lane.venue_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_skeeball_start_qr_session(
  p_token   text,
  p_team_id uuid
) RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_lane record;
  v_team record;
  v_existing record;
  v_match_id uuid;
  v_session_id uuid;
  v_week date := public.skeeball_current_week();
  v_active_count int;
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

  SELECT m.id INTO v_match_id
    FROM public.skeeball_league_matches m
   WHERE m.week_of = v_week
     AND COALESCE(m.status, 'active') IN ('active', 'open', 'in_progress')
   ORDER BY m.created_at DESC
   LIMIT 1;

  IF FOUND THEN
    SELECT COUNT(*) INTO v_active_count
      FROM public.skeeball_sessions
     WHERE league_match_id = v_match_id
       AND status = 'active';
  END IF;

  IF v_match_id IS NULL OR COALESCE(v_active_count, 0) >= 4 THEN
    INSERT INTO public.skeeball_league_matches (week_of, status)
    VALUES (v_week, 'active')
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

CREATE OR REPLACE FUNCTION public.rpc_skeeball_complete_session(p_session_id uuid)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_session record;
  v_lane record;
  v_game_id uuid;
  v_ball_count int;
  v_finalize json;
BEGIN
  IF v_uid IS NULL THEN
    RETURN json_build_object('error', 'not_authenticated');
  END IF;

  SELECT s.* INTO v_session
    FROM public.skeeball_sessions s
   WHERE s.id = p_session_id;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'not_found');
  END IF;

  IF v_session.status <> 'active' THEN
    RETURN json_build_object('ok', true, 'already_completed', true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.team_members
     WHERE team_id = v_session.team_id AND user_id = v_uid
  ) THEN
    RETURN json_build_object('error', 'unauthorized', 'message', 'Only a team member can finalize this game.');
  END IF;

  SELECT COUNT(*) INTO v_ball_count
    FROM public.skeeball_ball_scores
   WHERE session_id = p_session_id;

  IF v_ball_count <> 9 THEN
    RETURN json_build_object('error', 'incomplete', 'message', 'Enter all 9 balls before finalizing.');
  END IF;

  SELECT l.id AS lane_id, l.venue_id INTO v_lane
    FROM public.lanes l
    JOIN public.games g ON g.id = l.game_id
   WHERE g.type = 'skeeball'
     AND l.lane_number = v_session.lane_number
   LIMIT 1;

  SELECT id INTO v_game_id FROM public.games WHERE type = 'skeeball' LIMIT 1;

  UPDATE public.skeeball_sessions
     SET status = 'completed',
         completed_at = now(),
         last_activity_at = now()
   WHERE id = p_session_id
     AND status = 'active';

  IF v_game_id IS NOT NULL THEN
    INSERT INTO public.scores (user_id, game_id, lane_id, venue_id, score, frame_data, status)
    SELECT
      sp.player_user_id,
      v_game_id,
      v_lane.lane_id,
      v_lane.venue_id,
      COALESCE(SUM(bs.score), 0)::int,
      jsonb_build_object('source', 'skeeball_league_qr', 'session_id', p_session_id),
      'pending'
    FROM public.skeeball_session_players sp
    LEFT JOIN public.skeeball_ball_scores bs
      ON bs.session_id = sp.session_id
     AND bs.player_user_id = sp.player_user_id
    WHERE sp.session_id = p_session_id
    GROUP BY sp.player_user_id;
  END IF;

  IF v_session.league_match_id IS NOT NULL THEN
    BEGIN
      EXECUTE 'SELECT public.rpc_skeeball_finalize_match($1)' INTO v_finalize USING v_session.league_match_id;
    EXCEPTION WHEN undefined_function THEN
      v_finalize := json_build_object('ok', false, 'skipped', 'finalize_function_missing');
    END;
  END IF;

  SELECT placement, league_points INTO v_session
    FROM public.skeeball_sessions
   WHERE id = p_session_id;

  RETURN json_build_object(
    'ok', true,
    'placement', v_session.placement,
    'league_points', v_session.league_points,
    'finalize', COALESCE(v_finalize, '{}'::json)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_skeeball_lane_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_lane_id uuid;
BEGIN
  SELECT l.id INTO v_lane_id
    FROM public.lanes l
    JOIN public.games g ON g.id = l.game_id
   WHERE g.type = 'skeeball'
     AND l.lane_number = COALESCE(NEW.lane_number, OLD.lane_number)
   LIMIT 1;

  IF v_lane_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'INSERT' AND NEW.status = 'active' THEN
    UPDATE public.lanes SET status = 'occupied' WHERE id = v_lane_id;
  ELSIF TG_OP = 'UPDATE' AND OLD.status = 'active' AND NEW.status <> 'active' THEN
    UPDATE public.lanes SET status = 'available' WHERE id = v_lane_id;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS sync_skeeball_lane_status_trigger ON public.skeeball_sessions;
CREATE TRIGGER sync_skeeball_lane_status_trigger
  AFTER INSERT OR UPDATE OF status ON public.skeeball_sessions
  FOR EACH ROW EXECUTE FUNCTION public.sync_skeeball_lane_status();

REVOKE ALL ON FUNCTION public.rpc_skeeball_preview_lane_qr(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_skeeball_start_qr_session(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_skeeball_complete_session(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_skeeball_preview_lane_qr(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_skeeball_start_qr_session(text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_skeeball_complete_session(uuid) TO authenticated;
