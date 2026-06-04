-- ============================================================
-- Admin action RPCs — SECURITY DEFINER wrappers
-- Run in Supabase SQL Editor after rls-policies.sql and
-- security-hardening-2.sql (require_mfa must exist first).
--
-- All functions:
--   1. Call require_mfa() — enforces AAL2 session for admin actions
--   2. Verify is_admin() server-side
--   3. Write to admin_audit_log on success
-- ============================================================

-- ── Score review ─────────────────────────────────────────────
-- Accepts platform admins AND venue admins for the score's venue.
CREATE OR REPLACE FUNCTION public.rpc_admin_review_score(
  p_score_id uuid,
  p_status   text        -- 'approved' | 'denied'
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_score_venue_id uuid;
BEGIN
  PERFORM public.require_mfa();

  -- Allow platform admin OR venue admin of the score's venue
  SELECT venue_id INTO v_score_venue_id FROM scores WHERE id = p_score_id;

  IF NOT (public.is_admin() OR public.is_venue_admin(v_score_venue_id)) THEN
    RETURN json_build_object('error', 'unauthorized', 'message', 'Admin only.');
  END IF;

  IF p_status NOT IN ('approved', 'denied') THEN
    RETURN json_build_object('error', 'invalid_status');
  END IF;

  UPDATE scores SET status = p_status WHERE id = p_score_id;
  IF NOT FOUND THEN
    RETURN json_build_object('error', 'not_found');
  END IF;

  INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'score_review', 'score', p_score_id::text,
          jsonb_build_object('new_status', p_status));

  RETURN json_build_object('ok', true);
END;
$$;

-- ── Tournament request: approve (atomic request update + tournament insert) ──
CREATE OR REPLACE FUNCTION public.rpc_admin_approve_tournament(
  p_request_id uuid
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req     record;
  v_tourn_id uuid;
BEGIN
  PERFORM public.require_mfa();

  IF NOT public.is_admin() THEN
    RETURN json_build_object('error', 'unauthorized', 'message', 'Admin only.');
  END IF;

  SELECT * INTO v_req FROM tournament_requests WHERE id = p_request_id;
  IF NOT FOUND THEN
    RETURN json_build_object('error', 'not_found');
  END IF;
  IF v_req.status <> 'pending' THEN
    RETURN json_build_object('error', 'already_processed', 'message', 'Request is not pending.');
  END IF;

  UPDATE tournament_requests SET status = 'approved' WHERE id = p_request_id;

  INSERT INTO tournaments (
    title, description, game_type, proposed_date,
    max_teams, is_official, status, created_by
  ) VALUES (
    v_req.title, v_req.description, v_req.game_type, v_req.proposed_date,
    COALESCE(v_req.max_teams, 8), false, 'upcoming', v_req.user_id
  )
  RETURNING id INTO v_tourn_id;

  INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'approve_tournament_request', 'tournament_request', p_request_id::text,
          jsonb_build_object('tournament_id', v_tourn_id, 'title', v_req.title));

  RETURN json_build_object('ok', true, 'tournament_id', v_tourn_id);
END;
$$;

-- ── Tournament request: deny ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_admin_deny_tournament(
  p_request_id uuid,
  p_note       text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_title text;
BEGIN
  PERFORM public.require_mfa();

  IF NOT public.is_admin() THEN
    RETURN json_build_object('error', 'unauthorized', 'message', 'Admin only.');
  END IF;

  UPDATE tournament_requests
     SET status = 'denied', admin_note = NULLIF(trim(COALESCE(p_note, '')), '')
   WHERE id = p_request_id AND status = 'pending'
   RETURNING title INTO v_title;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'not_found_or_already_processed');
  END IF;

  INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'deny_tournament_request', 'tournament_request', p_request_id::text,
          jsonb_build_object('title', v_title, 'note', p_note));

  RETURN json_build_object('ok', true);
END;
$$;

-- ── Tournament: set status ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_admin_set_tournament_status(
  p_tournament_id uuid,
  p_status        text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_title text;
BEGIN
  PERFORM public.require_mfa();

  IF NOT public.is_admin() THEN
    RETURN json_build_object('error', 'unauthorized', 'message', 'Admin only.');
  END IF;

  IF p_status NOT IN ('upcoming', 'active', 'completed', 'cancelled') THEN
    RETURN json_build_object('error', 'invalid_status');
  END IF;

  UPDATE tournaments SET status = p_status WHERE id = p_tournament_id
  RETURNING title INTO v_title;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'not_found');
  END IF;

  INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'set_tournament_status', 'tournament', p_tournament_id::text,
          jsonb_build_object('new_status', p_status, 'title', v_title));

  RETURN json_build_object('ok', true);
END;
$$;

-- ── Tournament: save placements + mark completed (atomic) ────
CREATE OR REPLACE FUNCTION public.rpc_admin_save_placements(
  p_tournament_id uuid,
  p_placements    jsonb  -- [{"place": 1, "username": "alice"}, ...]
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry   jsonb;
  v_uid     uuid;
  v_uname   text;
  v_warnings text[] := '{}';
  v_title   text;
BEGIN
  PERFORM public.require_mfa();

  IF NOT public.is_admin() THEN
    RETURN json_build_object('error', 'unauthorized', 'message', 'Admin only.');
  END IF;

  FOR v_entry IN SELECT * FROM jsonb_array_elements(p_placements)
  LOOP
    v_uname := trim(COALESCE(v_entry->>'username', ''));
    CONTINUE WHEN v_uname = '';

    SELECT id INTO v_uid
      FROM profiles
     WHERE lower(username) = lower(v_uname)
     LIMIT 1;

    IF v_uid IS NULL THEN
      v_warnings := array_append(v_warnings, 'User not found: ' || v_uname);
      CONTINUE;
    END IF;

    INSERT INTO tournament_placements (tournament_id, user_id, placement)
    VALUES (p_tournament_id, v_uid, (v_entry->>'place')::int)
    ON CONFLICT (tournament_id, user_id)
    DO UPDATE SET placement = EXCLUDED.placement;
  END LOOP;

  UPDATE tournaments SET status = 'completed' WHERE id = p_tournament_id
  RETURNING title INTO v_title;

  INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'save_tournament_placements', 'tournament', p_tournament_id::text,
          jsonb_build_object('title', v_title, 'placement_count', jsonb_array_length(p_placements)));

  RETURN json_build_object(
    'ok',       true,
    'warnings', v_warnings
  );
END;
$$;

-- ── Team: delete atomically (members → requests → team) ──────
CREATE OR REPLACE FUNCTION public.rpc_admin_delete_team(p_team_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_team_name text;
BEGIN
  PERFORM public.require_mfa();

  IF NOT public.is_admin() THEN
    RETURN json_build_object('error', 'unauthorized', 'message', 'Admin only.');
  END IF;

  SELECT name INTO v_team_name FROM teams WHERE id = p_team_id;

  DELETE FROM team_members  WHERE team_id = p_team_id;
  DELETE FROM team_requests WHERE team_id = p_team_id;
  DELETE FROM teams         WHERE id      = p_team_id;

  INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'delete_team', 'team', p_team_id::text,
          jsonb_build_object('team_name', v_team_name));

  RETURN json_build_object('ok', true);
END;
$$;

-- ── Create First Friday tournament ───────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_admin_create_first_friday(
  p_date  timestamptz,
  p_label text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  PERFORM public.require_mfa();

  IF NOT public.is_admin() THEN
    RETURN json_build_object('error', 'unauthorized', 'message', 'Admin only.');
  END IF;

  INSERT INTO tournaments (
    title, game_type, proposed_date,
    is_official, is_individual, signup_type, status
  ) VALUES (
    'First Friday Skee-Ball — ' || p_label,
    'Skee-Ball', p_date,
    true, true, 'in_person', 'upcoming'
  )
  RETURNING id INTO v_id;

  INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'create_first_friday', 'tournament', v_id::text,
          jsonb_build_object('label', p_label, 'date', p_date));

  RETURN json_build_object('ok', true, 'tournament_id', v_id);
END;
$$;

-- Grant execute to authenticated users (is_admin() + require_mfa() check is inside each function)
REVOKE ALL ON FUNCTION public.rpc_admin_review_score(uuid, text)         FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_admin_approve_tournament(uuid)          FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_admin_deny_tournament(uuid, text)       FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_admin_set_tournament_status(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_admin_save_placements(uuid, jsonb)      FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_admin_delete_team(uuid)                 FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_admin_create_first_friday(timestamptz, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.rpc_admin_review_score(uuid, text)         TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_approve_tournament(uuid)          TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_deny_tournament(uuid, text)       TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_set_tournament_status(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_save_placements(uuid, jsonb)      TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_delete_team(uuid)                 TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_create_first_friday(timestamptz, text) TO authenticated;
