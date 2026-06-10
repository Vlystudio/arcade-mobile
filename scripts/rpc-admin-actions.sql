-- ============================================================
-- Admin action RPCs — SECURITY DEFINER wrappers
-- Run in Supabase SQL Editor after rls-policies.sql,
-- security-hardening-2.sql (require_mfa must exist first), and
-- security-hardening-3.sql (venue_id columns must exist first).
--
-- Every function:
--   1. PERFORM public.require_mfa()          — AAL2 session required
--   2. Verify caller via is_admin() or can_manage_venue(venue_id)
--   3. On denial  → INSERT INTO security_events
--   4. On success → INSERT INTO admin_audit_log
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

  SELECT venue_id INTO v_score_venue_id FROM scores WHERE id = p_score_id;

  IF NOT (public.is_admin() OR public.is_venue_admin(v_score_venue_id)) THEN
    INSERT INTO security_events (event_type, severity, user_id, details)
    VALUES ('admin_access_denied', 'warn', auth.uid(),
      jsonb_build_object('rpc', 'rpc_admin_review_score', 'score_id', p_score_id))
    ON CONFLICT DO NOTHING;
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
-- Venue-scoped: platform admin OR venue admin of the request's venue.
CREATE OR REPLACE FUNCTION public.rpc_admin_approve_tournament(
  p_request_id uuid
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req      record;
  v_tourn_id uuid;
BEGIN
  PERFORM public.require_mfa();

  SELECT * INTO v_req FROM tournament_requests WHERE id = p_request_id;
  IF NOT FOUND THEN
    RETURN json_build_object('error', 'not_found');
  END IF;

  IF NOT (public.is_admin() OR
          (v_req.venue_id IS NOT NULL AND public.can_manage_venue(v_req.venue_id))) THEN
    INSERT INTO security_events (event_type, severity, user_id, details)
    VALUES ('admin_access_denied', 'warn', auth.uid(),
      jsonb_build_object('rpc', 'rpc_admin_approve_tournament', 'request_id', p_request_id))
    ON CONFLICT DO NOTHING;
    RETURN json_build_object('error', 'unauthorized', 'message', 'Admin only.');
  END IF;

  IF v_req.status <> 'pending' THEN
    RETURN json_build_object('error', 'already_processed', 'message', 'Request is not pending.');
  END IF;

  UPDATE tournament_requests SET status = 'approved' WHERE id = p_request_id;

  INSERT INTO tournaments (
    title, description, game_type, proposed_date,
    max_teams, is_official, status, created_by, venue_id
  ) VALUES (
    v_req.title, v_req.description, v_req.game_type, v_req.proposed_date,
    COALESCE(v_req.max_teams, 8), false, 'upcoming', v_req.user_id, v_req.venue_id
  )
  RETURNING id INTO v_tourn_id;

  INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'approve_tournament_request', 'tournament_request', p_request_id::text,
          jsonb_build_object('tournament_id', v_tourn_id, 'title', v_req.title));

  RETURN json_build_object('ok', true, 'tournament_id', v_tourn_id);
END;
$$;


-- ── Tournament request: deny ──────────────────────────────────
-- Venue-scoped: platform admin OR venue admin of the request's venue.
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
  v_title    text;
  v_venue_id uuid;
BEGIN
  PERFORM public.require_mfa();

  SELECT title, venue_id INTO v_title, v_venue_id
    FROM tournament_requests WHERE id = p_request_id;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'not_found');
  END IF;

  IF NOT (public.is_admin() OR
          (v_venue_id IS NOT NULL AND public.can_manage_venue(v_venue_id))) THEN
    INSERT INTO security_events (event_type, severity, user_id, details)
    VALUES ('admin_access_denied', 'warn', auth.uid(),
      jsonb_build_object('rpc', 'rpc_admin_deny_tournament', 'request_id', p_request_id))
    ON CONFLICT DO NOTHING;
    RETURN json_build_object('error', 'unauthorized', 'message', 'Admin only.');
  END IF;

  UPDATE tournament_requests
     SET status = 'denied', admin_note = NULLIF(trim(COALESCE(p_note, '')), '')
   WHERE id = p_request_id AND status = 'pending'
   RETURNING title INTO v_title;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'already_processed');
  END IF;

  INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'deny_tournament_request', 'tournament_request', p_request_id::text,
          jsonb_build_object('title', v_title, 'note', p_note));

  RETURN json_build_object('ok', true);
END;
$$;


-- ── Tournament: set status ────────────────────────────────────
-- Venue-scoped: platform admin OR venue admin of the tournament's venue.
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
  v_title    text;
  v_venue_id uuid;
BEGIN
  PERFORM public.require_mfa();

  SELECT title, venue_id INTO v_title, v_venue_id
    FROM tournaments WHERE id = p_tournament_id;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'not_found');
  END IF;

  IF NOT (public.is_admin() OR
          (v_venue_id IS NOT NULL AND public.can_manage_venue(v_venue_id))) THEN
    INSERT INTO security_events (event_type, severity, user_id, details)
    VALUES ('admin_access_denied', 'warn', auth.uid(),
      jsonb_build_object('rpc', 'rpc_admin_set_tournament_status', 'tournament_id', p_tournament_id))
    ON CONFLICT DO NOTHING;
    RETURN json_build_object('error', 'unauthorized', 'message', 'Admin only.');
  END IF;

  IF p_status NOT IN ('upcoming', 'active', 'completed', 'cancelled') THEN
    RETURN json_build_object('error', 'invalid_status');
  END IF;

  UPDATE tournaments SET status = p_status WHERE id = p_tournament_id;

  INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'set_tournament_status', 'tournament', p_tournament_id::text,
          jsonb_build_object('new_status', p_status, 'title', v_title));

  RETURN json_build_object('ok', true);
END;
$$;


-- ── Tournament: save placements + mark completed (atomic) ─────
-- Venue-scoped: platform admin OR venue admin of the tournament's venue.
--
-- ⚠ SOURCE OF TRUTH: scripts/rls-security-patches.sql (run order 7, "L2:
-- rpc_admin_save_placements") defines the production rpc_admin_save_placements
-- — it runs after this script and adds a guard that placements can only be
-- saved for 'upcoming'/'active' tournaments. CREATE OR REPLACE means that
-- definition wins on a fresh full run. Keep both definitions in sync if you
-- change the auth/logging logic here.
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
  v_entry    jsonb;
  v_uid      uuid;
  v_uname    text;
  v_warnings text[] := '{}';
  v_title    text;
  v_venue_id uuid;
BEGIN
  PERFORM public.require_mfa();

  SELECT title, venue_id INTO v_title, v_venue_id
    FROM tournaments WHERE id = p_tournament_id;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'not_found');
  END IF;

  IF NOT (public.is_admin() OR
          (v_venue_id IS NOT NULL AND public.can_manage_venue(v_venue_id))) THEN
    INSERT INTO security_events (event_type, severity, user_id, details)
    VALUES ('admin_access_denied', 'warn', auth.uid(),
      jsonb_build_object('rpc', 'rpc_admin_save_placements', 'tournament_id', p_tournament_id))
    ON CONFLICT DO NOTHING;
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

  UPDATE tournaments SET status = 'completed' WHERE id = p_tournament_id;

  INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'save_tournament_placements', 'tournament', p_tournament_id::text,
          jsonb_build_object('title', v_title, 'placement_count', jsonb_array_length(p_placements)));

  RETURN json_build_object('ok', true, 'warnings', v_warnings);
END;
$$;


-- ── Team: delete atomically (members → requests → team) ───────
-- Venue-scoped: platform admin OR venue admin of the team's venue.
CREATE OR REPLACE FUNCTION public.rpc_admin_delete_team(p_team_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_team_name text;
  v_venue_id  uuid;
BEGIN
  PERFORM public.require_mfa();

  SELECT name, venue_id INTO v_team_name, v_venue_id FROM teams WHERE id = p_team_id;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'not_found');
  END IF;

  IF NOT (public.is_admin() OR
          (v_venue_id IS NOT NULL AND public.can_manage_venue(v_venue_id))) THEN
    INSERT INTO security_events (event_type, severity, user_id, details)
    VALUES ('admin_access_denied', 'warn', auth.uid(),
      jsonb_build_object('rpc', 'rpc_admin_delete_team', 'team_id', p_team_id))
    ON CONFLICT DO NOTHING;
    RETURN json_build_object('error', 'unauthorized', 'message', 'Admin only.');
  END IF;

  DELETE FROM team_members  WHERE team_id = p_team_id;
  DELETE FROM team_requests WHERE team_id = p_team_id;
  DELETE FROM teams         WHERE id      = p_team_id;

  INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'delete_team', 'team', p_team_id::text,
          jsonb_build_object('team_name', v_team_name));

  RETURN json_build_object('ok', true);
END;
$$;


-- ── Remove a player from any tournament ──────────────────────
-- Venue-scoped: platform admin OR venue admin of the tournament's venue.
CREATE OR REPLACE FUNCTION public.rpc_admin_remove_tournament_player(
  p_reg_id uuid
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tourn_id   uuid;
  v_user_id    uuid;
  v_guest_name text;
  v_label      text;
  v_venue_id   uuid;
BEGIN
  PERFORM public.require_mfa();

  SELECT tr.tournament_id, tr.user_id, tr.guest_name, t.venue_id
    INTO v_tourn_id, v_user_id, v_guest_name, v_venue_id
    FROM tournament_registrations tr
    LEFT JOIN tournaments t ON t.id = tr.tournament_id
   WHERE tr.id = p_reg_id;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'not_found');
  END IF;

  IF NOT (public.is_admin() OR
          (v_venue_id IS NOT NULL AND public.can_manage_venue(v_venue_id))) THEN
    INSERT INTO security_events (event_type, severity, user_id, details)
    VALUES ('admin_access_denied', 'warn', auth.uid(),
      jsonb_build_object('rpc', 'rpc_admin_remove_tournament_player', 'reg_id', p_reg_id))
    ON CONFLICT DO NOTHING;
    RETURN json_build_object('error', 'unauthorized', 'message', 'Admin only.');
  END IF;

  DELETE FROM tournament_registrations WHERE id = p_reg_id;

  v_label := COALESCE(v_guest_name,
               (SELECT username FROM profiles WHERE id = v_user_id),
               v_user_id::text,
               'unknown');

  INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'remove_tournament_player', 'tournament', v_tourn_id::text,
          jsonb_build_object('reg_id', p_reg_id, 'player', v_label));

  RETURN json_build_object('ok', true);
END;
$$;


-- ── Create First Friday tournament ───────────────────────────
-- Platform admins: can create for any venue (p_venue_id optional).
-- Venue admins: must supply p_venue_id matching their venue.
DROP FUNCTION IF EXISTS public.rpc_admin_create_first_friday(timestamptz, text);

CREATE OR REPLACE FUNCTION public.rpc_admin_create_first_friday(
  p_date     timestamptz,
  p_label    text,
  p_venue_id uuid DEFAULT NULL
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

  IF NOT (public.is_admin() OR
          (p_venue_id IS NOT NULL AND public.can_manage_venue(p_venue_id))) THEN
    INSERT INTO security_events (event_type, severity, user_id, details)
    VALUES ('admin_access_denied', 'warn', auth.uid(),
      jsonb_build_object('rpc', 'rpc_admin_create_first_friday', 'venue_id', p_venue_id))
    ON CONFLICT DO NOTHING;
    RETURN json_build_object('error', 'unauthorized', 'message', 'Admin only.');
  END IF;

  INSERT INTO tournaments (
    title, game_type, proposed_date,
    is_official, is_individual, signup_type, status, max_players, venue_id
  ) VALUES (
    'First Friday Skee-Ball — ' || p_label,
    'Skee-Ball', p_date,
    true, true, 'in_person', 'upcoming', 32, p_venue_id
  )
  RETURNING id INTO v_id;

  INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'create_first_friday', 'tournament', v_id::text,
          jsonb_build_object('label', p_label, 'date', p_date, 'venue_id', p_venue_id));

  RETURN json_build_object('ok', true, 'tournament_id', v_id);
END;
$$;


-- ── Grants ────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.rpc_admin_review_score(uuid, text)                      FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_admin_approve_tournament(uuid)                       FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_admin_deny_tournament(uuid, text)                    FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_admin_set_tournament_status(uuid, text)              FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_admin_save_placements(uuid, jsonb)                   FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_admin_delete_team(uuid)                              FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_admin_remove_tournament_player(uuid)                 FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_admin_create_first_friday(timestamptz, text, uuid)   FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.rpc_admin_review_score(uuid, text)                    TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_approve_tournament(uuid)                    TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_deny_tournament(uuid, text)                 TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_set_tournament_status(uuid, text)           TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_save_placements(uuid, jsonb)                TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_delete_team(uuid)                           TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_remove_tournament_player(uuid)              TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_create_first_friday(timestamptz, text, uuid) TO authenticated;
