-- Admin RPCs for editing and deleting tournaments.
-- Uses SECURITY DEFINER so they bypass RLS (consistent with all other admin RPCs).
-- Both functions require MFA, venue-scoped authorization, and write to admin_audit_log.

CREATE OR REPLACE FUNCTION public.rpc_admin_update_tournament(
  p_tournament_id uuid,
  p_title         text        DEFAULT NULL,
  p_game_type     text        DEFAULT NULL,
  p_proposed_date timestamptz DEFAULT NULL,
  p_max_players   int         DEFAULT NULL
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
    title         = COALESCE(NULLIF(trim(p_title), ''),  title),
    game_type     = CASE WHEN p_title IS NOT NULL THEN NULLIF(trim(p_game_type), '') ELSE game_type END,
    proposed_date = COALESCE(p_proposed_date, proposed_date),
    max_players   = COALESCE(p_max_players,   max_players)
  WHERE id = p_tournament_id;

  INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'update_tournament', 'tournament', p_tournament_id::text,
          jsonb_build_object('title', v_title));

  RETURN json_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_admin_delete_tournament(
  p_tournament_id uuid
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
    RETURN json_build_object('error', 'tournament_not_found');
  END IF;

  IF NOT (public.is_admin() OR
          (v_venue_id IS NOT NULL AND public.can_manage_venue(v_venue_id))) THEN
    INSERT INTO security_events (event_type, severity, user_id, details)
    VALUES ('admin_access_denied', 'warn', auth.uid(),
      jsonb_build_object('rpc', 'rpc_admin_delete_tournament', 'tournament_id', p_tournament_id))
    ON CONFLICT DO NOTHING;
    RETURN json_build_object('error', 'unauthorized');
  END IF;

  DELETE FROM tournaments WHERE id = p_tournament_id;

  INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'delete_tournament', 'tournament', p_tournament_id::text,
          jsonb_build_object('title', v_title));

  RETURN json_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_admin_update_tournament(uuid, text, text, timestamptz, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_admin_delete_tournament(uuid)                               FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.rpc_admin_update_tournament(uuid, text, text, timestamptz, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_delete_tournament(uuid)                               TO authenticated;
