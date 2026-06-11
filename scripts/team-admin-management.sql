-- ============================================================
-- Admin team management: import teams, assign members/captains,
-- and resolve "request to join" requests on the admin's behalf.
--
-- Pattern (matches scripts/rpc-admin-actions.sql):
--   1. PERFORM public.require_mfa()
--   2. is_admin() OR (venue_id IS NOT NULL AND can_manage_venue(venue_id))
--   3. On denial -> security_events('admin_access_denied') + error/exception
--   4. On success (write RPCs) -> admin_audit_log
--
-- All functions: SECURITY DEFINER, search_path = public.
-- ============================================================


-- ── Bulk-import / create teams ───────────────────────────────
-- p_venue_id NULL => platform-admin only (unassigned/imported teams).
-- p_venue_id set  => platform admin OR that venue's admin.
CREATE OR REPLACE FUNCTION public.rpc_admin_bulk_create_teams(
  p_names    text[],
  p_venue_id uuid DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name     text;
  v_created  text[] := '{}';
  v_skipped  text[] := '{}';
BEGIN
  PERFORM public.require_mfa();

  IF NOT (public.is_admin() OR
          (p_venue_id IS NOT NULL AND public.can_manage_venue(p_venue_id))) THEN
    INSERT INTO security_events (event_type, severity, user_id, details)
    VALUES ('admin_access_denied', 'warn', auth.uid(),
      jsonb_build_object('rpc', 'rpc_admin_bulk_create_teams', 'venue_id', p_venue_id))
    ON CONFLICT DO NOTHING;
    RETURN json_build_object('error', 'unauthorized', 'message', 'Admin only.');
  END IF;

  FOREACH v_name IN ARRAY p_names LOOP
    v_name := trim(v_name);
    IF v_name = '' THEN
      CONTINUE;
    ELSIF length(v_name) < 2 OR length(v_name) > 40 THEN
      v_skipped := array_append(v_skipped, v_name);
    ELSE
      INSERT INTO teams (name, venue_id, captain_user_id)
      VALUES (v_name, p_venue_id, NULL);
      v_created := array_append(v_created, v_name);
    END IF;
  END LOOP;

  IF array_length(v_created, 1) > 0 THEN
    INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details)
    VALUES (auth.uid(), 'bulk_create_teams', 'team', NULL,
            jsonb_build_object('names', v_created, 'venue_id', p_venue_id));
  END IF;

  RETURN json_build_object('ok', true, 'created', v_created, 'skipped', v_skipped);
END;
$$;


-- ── Assign a user to a team (admin override) ─────────────────
-- Adds to team_members and clears any matching pending join request.
CREATE OR REPLACE FUNCTION public.rpc_admin_assign_team_member(
  p_team_id uuid,
  p_user_id uuid
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_venue_id uuid;
BEGIN
  PERFORM public.require_mfa();

  SELECT venue_id INTO v_venue_id FROM teams WHERE id = p_team_id;
  IF NOT FOUND THEN
    RETURN json_build_object('error', 'not_found');
  END IF;

  IF NOT (public.is_admin() OR
          (v_venue_id IS NOT NULL AND public.can_manage_venue(v_venue_id))) THEN
    INSERT INTO security_events (event_type, severity, user_id, details)
    VALUES ('admin_access_denied', 'warn', auth.uid(),
      jsonb_build_object('rpc', 'rpc_admin_assign_team_member', 'team_id', p_team_id, 'target_user', p_user_id))
    ON CONFLICT DO NOTHING;
    RETURN json_build_object('error', 'unauthorized', 'message', 'Admin only.');
  END IF;

  INSERT INTO team_members (team_id, user_id, role)
  VALUES (p_team_id, p_user_id, 'player')
  ON CONFLICT (team_id, user_id) DO NOTHING;

  UPDATE team_requests
     SET status = 'approved'
   WHERE team_id = p_team_id AND user_id = p_user_id
     AND direction = 'request' AND status = 'pending';

  INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'assign_team_member', 'team', p_team_id::text,
          jsonb_build_object('user_id', p_user_id));

  RETURN json_build_object('ok', true);
END;
$$;


-- ── Remove a user from a team (admin override) ───────────────
CREATE OR REPLACE FUNCTION public.rpc_admin_remove_team_member(
  p_team_id uuid,
  p_user_id uuid
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_venue_id   uuid;
  v_captain_id uuid;
BEGIN
  PERFORM public.require_mfa();

  SELECT venue_id, captain_user_id INTO v_venue_id, v_captain_id FROM teams WHERE id = p_team_id;
  IF NOT FOUND THEN
    RETURN json_build_object('error', 'not_found');
  END IF;

  IF NOT (public.is_admin() OR
          (v_venue_id IS NOT NULL AND public.can_manage_venue(v_venue_id))) THEN
    INSERT INTO security_events (event_type, severity, user_id, details)
    VALUES ('admin_access_denied', 'warn', auth.uid(),
      jsonb_build_object('rpc', 'rpc_admin_remove_team_member', 'team_id', p_team_id, 'target_user', p_user_id))
    ON CONFLICT DO NOTHING;
    RETURN json_build_object('error', 'unauthorized', 'message', 'Admin only.');
  END IF;

  DELETE FROM team_members WHERE team_id = p_team_id AND user_id = p_user_id;

  IF v_captain_id = p_user_id THEN
    UPDATE teams SET captain_user_id = NULL WHERE id = p_team_id;
  END IF;

  INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'remove_team_member', 'team', p_team_id::text,
          jsonb_build_object('user_id', p_user_id));

  RETURN json_build_object('ok', true);
END;
$$;


-- ── Set (or change) a team's captain ─────────────────────────
-- Target user must already be a member of the team.
CREATE OR REPLACE FUNCTION public.rpc_admin_set_team_captain(
  p_team_id uuid,
  p_user_id uuid
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_venue_id   uuid;
  v_old_captain uuid;
BEGIN
  PERFORM public.require_mfa();

  SELECT venue_id, captain_user_id INTO v_venue_id, v_old_captain FROM teams WHERE id = p_team_id;
  IF NOT FOUND THEN
    RETURN json_build_object('error', 'not_found');
  END IF;

  IF NOT (public.is_admin() OR
          (v_venue_id IS NOT NULL AND public.can_manage_venue(v_venue_id))) THEN
    INSERT INTO security_events (event_type, severity, user_id, details)
    VALUES ('admin_access_denied', 'warn', auth.uid(),
      jsonb_build_object('rpc', 'rpc_admin_set_team_captain', 'team_id', p_team_id, 'target_user', p_user_id))
    ON CONFLICT DO NOTHING;
    RETURN json_build_object('error', 'unauthorized', 'message', 'Admin only.');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM team_members WHERE team_id = p_team_id AND user_id = p_user_id) THEN
    RETURN json_build_object('error', 'not_member', 'message', 'User must be a team member first.');
  END IF;

  IF v_old_captain IS NOT NULL AND v_old_captain <> p_user_id THEN
    UPDATE team_members SET role = 'player' WHERE team_id = p_team_id AND user_id = v_old_captain;
  END IF;

  UPDATE teams SET captain_user_id = p_user_id WHERE id = p_team_id;
  UPDATE team_members SET role = 'captain' WHERE team_id = p_team_id AND user_id = p_user_id;

  INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'set_team_captain', 'team', p_team_id::text,
          jsonb_build_object('user_id', p_user_id, 'previous_captain', v_old_captain));

  RETURN json_build_object('ok', true);
END;
$$;


-- ── List a team's members (for the admin "Manage Team" modal) ─
CREATE OR REPLACE FUNCTION public.rpc_admin_get_team_members(p_team_id uuid)
RETURNS TABLE (
  user_id    uuid,
  username   text,
  avatar_url text,
  role       text,
  joined_at  timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_venue_id uuid;
BEGIN
  PERFORM public.require_mfa();

  SELECT venue_id INTO v_venue_id FROM teams WHERE id = p_team_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT (public.is_admin() OR
          (v_venue_id IS NOT NULL AND public.can_manage_venue(v_venue_id))) THEN
    INSERT INTO security_events (event_type, severity, user_id, details)
    VALUES ('admin_access_denied', 'warn', auth.uid(),
      jsonb_build_object('rpc', 'rpc_admin_get_team_members', 'team_id', p_team_id))
    ON CONFLICT DO NOTHING;
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
  SELECT tm.user_id, p.username, p.avatar_url, tm.role, tm.created_at
  FROM team_members tm
  JOIN profiles p ON p.id = tm.user_id
  WHERE tm.team_id = p_team_id
  ORDER BY (tm.role = 'captain') DESC, LOWER(p.username);
END;
$$;


-- ── List pending "request to join" requests for a team ───────
CREATE OR REPLACE FUNCTION public.rpc_admin_get_team_join_requests(p_team_id uuid)
RETURNS TABLE (
  request_id uuid,
  team_id    uuid,
  user_id    uuid,
  username   text,
  avatar_url text,
  message    text,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_venue_id uuid;
BEGIN
  PERFORM public.require_mfa();

  SELECT venue_id INTO v_venue_id FROM teams WHERE id = p_team_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT (public.is_admin() OR
          (v_venue_id IS NOT NULL AND public.can_manage_venue(v_venue_id))) THEN
    INSERT INTO security_events (event_type, severity, user_id, details)
    VALUES ('admin_access_denied', 'warn', auth.uid(),
      jsonb_build_object('rpc', 'rpc_admin_get_team_join_requests', 'team_id', p_team_id))
    ON CONFLICT DO NOTHING;
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
  SELECT tr.id, tr.team_id, tr.user_id, p.username, p.avatar_url, tr.message, tr.created_at
  FROM team_requests tr
  LEFT JOIN profiles p ON p.id = tr.user_id
  WHERE tr.team_id = p_team_id AND tr.direction = 'request' AND tr.status = 'pending'
  ORDER BY tr.created_at ASC;
END;
$$;


-- ── Approve or deny a pending "request to join" ──────────────
CREATE OR REPLACE FUNCTION public.rpc_admin_resolve_team_request(
  p_request_id uuid,
  p_action     text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_team_id  uuid;
  v_user_id  uuid;
  v_venue_id uuid;
BEGIN
  PERFORM public.require_mfa();

  IF p_action NOT IN ('approve', 'deny') THEN
    RETURN json_build_object('error', 'invalid_action');
  END IF;

  SELECT tr.team_id, tr.user_id, t.venue_id
    INTO v_team_id, v_user_id, v_venue_id
    FROM team_requests tr
    JOIN teams t ON t.id = tr.team_id
   WHERE tr.id = p_request_id;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'not_found');
  END IF;

  IF NOT (public.is_admin() OR
          (v_venue_id IS NOT NULL AND public.can_manage_venue(v_venue_id))) THEN
    INSERT INTO security_events (event_type, severity, user_id, details)
    VALUES ('admin_access_denied', 'warn', auth.uid(),
      jsonb_build_object('rpc', 'rpc_admin_resolve_team_request', 'request_id', p_request_id))
    ON CONFLICT DO NOTHING;
    RETURN json_build_object('error', 'unauthorized', 'message', 'Admin only.');
  END IF;

  IF p_action = 'approve' THEN
    INSERT INTO team_members (team_id, user_id, role)
    VALUES (v_team_id, v_user_id, 'player')
    ON CONFLICT (team_id, user_id) DO NOTHING;
    UPDATE team_requests SET status = 'approved' WHERE id = p_request_id;
  ELSE
    UPDATE team_requests SET status = 'denied' WHERE id = p_request_id;
  END IF;

  INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'resolve_team_request', 'team', v_team_id::text,
          jsonb_build_object('request_id', p_request_id, 'user_id', v_user_id, 'action', p_action));

  RETURN json_build_object('ok', true);
END;
$$;


-- ── Grants ────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.rpc_admin_bulk_create_teams(text[], uuid)      FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_admin_assign_team_member(uuid, uuid)       FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_admin_remove_team_member(uuid, uuid)       FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_admin_set_team_captain(uuid, uuid)         FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_admin_get_team_members(uuid)               FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_admin_get_team_join_requests(uuid)         FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_admin_resolve_team_request(uuid, text)     FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.rpc_admin_bulk_create_teams(text[], uuid)   TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_assign_team_member(uuid, uuid)    TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_remove_team_member(uuid, uuid)    TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_set_team_captain(uuid, uuid)      TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_get_team_members(uuid)            TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_get_team_join_requests(uuid)      TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_resolve_team_request(uuid, text)  TO authenticated;
