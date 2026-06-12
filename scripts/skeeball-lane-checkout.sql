-- ============================================================
-- Skee-Ball lane checkout / admin kick
--
--   1. rpc_skeeball_cancel_session — a team member can check their team
--      OUT of a lane they accidentally checked into, as long as no balls
--      have been recorded yet (otherwise: finish the game or ask an admin).
--   2. rpc_admin_skeeball_kick_session — admins can clear any active lane
--      regardless of recorded balls (MFA + audit-logged).
--
-- Both mark the session 'abandoned'; the existing status trigger frees the
-- lane (status -> 'available') and abandoned sessions are already excluded
-- from match finalization.
--
-- Run AFTER: skeeball-qr-lane-checkin.sql, skeeball-finalize-fix.sql
-- Idempotent — safe to re-run.
-- ============================================================

CREATE OR REPLACE FUNCTION public.rpc_skeeball_cancel_session(p_session_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_session record;
BEGIN
  IF v_uid IS NULL THEN
    RETURN json_build_object('error', 'not_authenticated');
  END IF;

  SELECT * INTO v_session
    FROM skeeball_sessions
   WHERE id = p_session_id AND status = 'active';
  IF NOT FOUND THEN
    RETURN json_build_object('error', 'not_found',
      'message', 'No active check-in found — it may already be finished.');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM team_members
     WHERE team_id = v_session.team_id AND user_id = v_uid
  ) THEN
    RETURN json_build_object('error', 'not_team_member',
      'message', 'Only members of this team can check it out of a lane.');
  END IF;

  -- Accidental check-ins have no recorded balls. Once scoring started,
  -- self-checkout would throw away live game data — admins only.
  IF EXISTS (SELECT 1 FROM skeeball_ball_scores WHERE session_id = p_session_id) THEN
    RETURN json_build_object('error', 'has_scores',
      'message', 'Balls have already been recorded for this game. Finish the game, or ask an admin to clear the lane.');
  END IF;

  UPDATE skeeball_sessions
     SET status = 'abandoned', last_activity_at = now()
   WHERE id = p_session_id;

  RETURN json_build_object('ok', true, 'lane_number', v_session.lane_number);
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_skeeball_cancel_session(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_skeeball_cancel_session(uuid) TO authenticated;


CREATE OR REPLACE FUNCTION public.rpc_admin_skeeball_kick_session(p_session_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session record;
BEGIN
  PERFORM public.require_mfa();
  IF NOT public.is_admin() THEN
    INSERT INTO security_events (event_type, severity, user_id, details)
    VALUES ('admin_access_denied', 'warn', auth.uid(),
      jsonb_build_object('rpc', 'rpc_admin_skeeball_kick_session'))
    ON CONFLICT DO NOTHING;
    RETURN json_build_object('error', 'unauthorized');
  END IF;

  SELECT * INTO v_session
    FROM skeeball_sessions
   WHERE id = p_session_id AND status = 'active';
  IF NOT FOUND THEN
    RETURN json_build_object('error', 'not_found',
      'message', 'That session is no longer active.');
  END IF;

  UPDATE skeeball_sessions
     SET status = 'abandoned', last_activity_at = now()
   WHERE id = p_session_id;

  INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'skeeball_kick_session', 'skeeball_session', p_session_id::text,
          jsonb_build_object('team_id', v_session.team_id, 'lane_number', v_session.lane_number,
                             'week_of', v_session.week_of));

  RETURN json_build_object('ok', true, 'lane_number', v_session.lane_number);
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_admin_skeeball_kick_session(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_admin_skeeball_kick_session(uuid) TO authenticated;
