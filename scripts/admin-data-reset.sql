-- ============================================================
-- Owner/Architect data-reset tools — for a clean launch (no beta data carryover)
--
--   rpc_admin_reset_team_data(team, delete_team)   — wipe one team's gameplay
--   rpc_admin_delete_season_data(season)           — wipe one season's gameplay
--   rpc_admin_reset_all_league_data(delete_teams)  — wipe ALL league/season data
--
-- All three are gated to OWNER/ARCHITECT only (not regular admins) and require
-- MFA (require_mfa()). Every call is written to admin_audit_log; denied attempts
-- go to security_events. Destructive — meant to be run intentionally before
-- go-live so every user starts fresh.
--
-- Cascade notes (verified against the live schema):
--   • Deleting skeeball_sessions cascades skeeball_ball_scores,
--     skeeball_session_players and score_disputes (all ON DELETE CASCADE).
--   • Deleting a team is blocked by matches.(team_a_id|team_b_id) and
--     league_teams.team_id (NO ACTION) → delete those first.
--     skeeball_league_standings.team_id has no FK → delete explicitly.
--   • A season maps to gameplay by week_of range; matches/league_teams are
--     season-scoped via season_id; skeeball_league_matches is week-keyed and
--     is blocked by sessions, so delete sessions before league_matches.
--
-- Idempotent — safe to re-run.
-- ============================================================


-- ── Shared gate: owner/architect + MFA ───────────────────────
CREATE OR REPLACE FUNCTION public.is_owner_or_architect()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('owner','architect'));
$$;
REVOKE ALL ON FUNCTION public.is_owner_or_architect() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_owner_or_architect() TO authenticated;


-- ── 1. Reset (or delete) one team ────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_admin_reset_team_data(
  p_team_id     uuid,
  p_delete_team boolean DEFAULT false
)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_name     text;
  v_sessions int;
  v_balls    int;
BEGIN
  PERFORM public.require_mfa();
  IF NOT public.is_owner_or_architect() THEN
    INSERT INTO security_events (event_type, severity, user_id, details)
    VALUES ('admin_access_denied','warn',auth.uid(),
      jsonb_build_object('rpc','rpc_admin_reset_team_data','team_id',p_team_id))
    ON CONFLICT DO NOTHING;
    RETURN json_build_object('error','unauthorized','message','Owner or architect only.');
  END IF;

  SELECT name INTO v_name FROM teams WHERE id = p_team_id;
  IF NOT FOUND THEN RETURN json_build_object('error','not_found'); END IF;

  SELECT count(*) INTO v_sessions FROM skeeball_sessions WHERE team_id = p_team_id;
  SELECT count(*) INTO v_balls
    FROM skeeball_ball_scores bs
    JOIN skeeball_sessions s ON s.id = bs.session_id
   WHERE s.team_id = p_team_id;

  -- Competitive/gameplay data (NO-ACTION blockers first, then sessions cascade).
  -- skeeball_league_standings is a computed VIEW over sessions — it recomputes
  -- automatically once the sessions below are gone, so it isn't deleted here.
  DELETE FROM matches       WHERE team_a_id = p_team_id OR team_b_id = p_team_id;
  DELETE FROM league_teams  WHERE team_id = p_team_id;
  DELETE FROM league_rsvps  WHERE team_id = p_team_id;
  DELETE FROM sub_requests  WHERE team_id = p_team_id;
  DELETE FROM skeeball_sessions WHERE team_id = p_team_id;

  IF p_delete_team THEN
    -- cascades team_members, team_messages, team_announcements, team_bans,
    -- team_requests, team_schedule, etc.
    DELETE FROM teams WHERE id = p_team_id;
  END IF;

  INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(),
          CASE WHEN p_delete_team THEN 'delete_team_full' ELSE 'reset_team_data' END,
          'team', p_team_id::text,
          jsonb_build_object('team_name',v_name,'sessions_deleted',v_sessions,
                             'balls_deleted',v_balls,'team_deleted',p_delete_team));

  RETURN json_build_object('ok',true,'team_name',v_name,'sessions_deleted',v_sessions,
                           'balls_deleted',v_balls,'team_deleted',p_delete_team);
END; $$;
REVOKE ALL ON FUNCTION public.rpc_admin_reset_team_data(uuid,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_admin_reset_team_data(uuid,boolean) TO authenticated;


-- ── 2. Delete one season's data ──────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_admin_delete_season_data(p_season_id uuid)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_name     text;
  v_start    date;
  v_end      date;
  v_sessions int;
  v_balls    int;
BEGIN
  PERFORM public.require_mfa();
  IF NOT public.is_owner_or_architect() THEN
    INSERT INTO security_events (event_type, severity, user_id, details)
    VALUES ('admin_access_denied','warn',auth.uid(),
      jsonb_build_object('rpc','rpc_admin_delete_season_data','season_id',p_season_id))
    ON CONFLICT DO NOTHING;
    RETURN json_build_object('error','unauthorized','message','Owner or architect only.');
  END IF;

  SELECT name, start_week, end_week INTO v_name, v_start, v_end
    FROM skeeball_seasons WHERE id = p_season_id;
  IF NOT FOUND THEN RETURN json_build_object('error','not_found'); END IF;

  SELECT count(*) INTO v_sessions FROM skeeball_sessions WHERE week_of BETWEEN v_start AND v_end;
  SELECT count(*) INTO v_balls
    FROM skeeball_ball_scores bs
    JOIN skeeball_sessions s ON s.id = bs.session_id
   WHERE s.week_of BETWEEN v_start AND v_end;

  DELETE FROM matches               WHERE season_id = p_season_id;
  DELETE FROM league_teams          WHERE season_id = p_season_id;
  DELETE FROM skeeball_sessions     WHERE week_of BETWEEN v_start AND v_end;  -- cascade
  DELETE FROM skeeball_league_matches WHERE week_of BETWEEN v_start AND v_end;
  DELETE FROM skeeball_seasons      WHERE id = p_season_id;

  INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(),'delete_season_data','season',p_season_id::text,
          jsonb_build_object('name',v_name,'start_week',v_start,'end_week',v_end,
                             'sessions_deleted',v_sessions,'balls_deleted',v_balls));

  RETURN json_build_object('ok',true,'name',v_name,'sessions_deleted',v_sessions,'balls_deleted',v_balls);
END; $$;
REVOKE ALL ON FUNCTION public.rpc_admin_delete_season_data(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_admin_delete_season_data(uuid) TO authenticated;


-- ── 3. Nuke ALL league/season data (the launch wipe) ─────────
-- Wipes every season, session, ball score, standing and league match across
-- all teams. p_delete_teams = true also removes the teams + rosters; default
-- keeps teams/members and only clears their gameplay so everyone starts fresh.
CREATE OR REPLACE FUNCTION public.rpc_admin_reset_all_league_data(p_delete_teams boolean DEFAULT false)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_sessions int;
  v_balls    int;
  v_seasons  int;
BEGIN
  PERFORM public.require_mfa();
  IF NOT public.is_owner_or_architect() THEN
    INSERT INTO security_events (event_type, severity, user_id, details)
    VALUES ('admin_access_denied','warn',auth.uid(),
      jsonb_build_object('rpc','rpc_admin_reset_all_league_data'))
    ON CONFLICT DO NOTHING;
    RETURN json_build_object('error','unauthorized','message','Owner or architect only.');
  END IF;

  SELECT count(*) INTO v_sessions FROM skeeball_sessions;
  SELECT count(*) INTO v_balls    FROM skeeball_ball_scores;
  SELECT count(*) INTO v_seasons  FROM skeeball_seasons;

  -- skeeball_league_standings is a computed VIEW — recomputes once sessions go.
  DELETE FROM matches                 WHERE true;
  DELETE FROM league_teams            WHERE true;
  DELETE FROM league_rsvps            WHERE true;
  DELETE FROM sub_requests            WHERE true;
  DELETE FROM skeeball_sessions       WHERE true;  -- cascade ball_scores/session_players/score_disputes
  DELETE FROM skeeball_league_matches WHERE true;
  DELETE FROM skeeball_seasons        WHERE true;

  IF p_delete_teams THEN
    DELETE FROM teams WHERE true;  -- cascade members/messages/announcements/bans/requests/schedule
  END IF;

  INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(),'reset_all_league_data','global','*',
          jsonb_build_object('sessions_deleted',v_sessions,'balls_deleted',v_balls,
                             'seasons_deleted',v_seasons,'teams_deleted',p_delete_teams));

  RETURN json_build_object('ok',true,'sessions_deleted',v_sessions,'balls_deleted',v_balls,
                           'seasons_deleted',v_seasons,'teams_deleted',p_delete_teams);
END; $$;
REVOKE ALL ON FUNCTION public.rpc_admin_reset_all_league_data(boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_admin_reset_all_league_data(boolean) TO authenticated;
