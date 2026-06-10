-- ============================================================
-- First Friday Skee-Ball: QR-based sign-up system
-- Run after rls-policies.sql and rpc-admin-actions.sql
-- ============================================================

-- ── Extend tournaments table ─────────────────────────────────
ALTER TABLE tournaments
  ADD COLUMN IF NOT EXISTS signup_qr_token     uuid         DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS signup_qr_active    boolean      NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS signup_qr_issued_at timestamptz,
  ADD COLUMN IF NOT EXISTS max_players         integer      DEFAULT 20;

-- ── Admin: generate (or regenerate) a signup QR token ────────
-- Requires AAL2. Returns the raw token once so the client
-- can build the deep-link URL for display.
-- Venue-scoped: platform admin OR venue admin of the tournament's venue.
CREATE OR REPLACE FUNCTION public.rpc_admin_generate_ff_signup_qr(
  p_tournament_id uuid
) RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token    uuid := gen_random_uuid();
  v_title    text;
  v_venue_id uuid;
BEGIN
  PERFORM public.require_mfa();

  SELECT title, venue_id INTO v_title, v_venue_id
    FROM tournaments
   WHERE id = p_tournament_id AND is_individual = true;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'not_found');
  END IF;

  IF NOT (public.is_admin() OR
          (v_venue_id IS NOT NULL AND public.can_manage_venue(v_venue_id))) THEN
    INSERT INTO security_events (event_type, severity, user_id, details)
    VALUES ('admin_access_denied', 'warn', auth.uid(),
      jsonb_build_object('rpc', 'rpc_admin_generate_ff_signup_qr', 'tournament_id', p_tournament_id))
    ON CONFLICT DO NOTHING;
    RETURN json_build_object('error', 'unauthorized');
  END IF;

  UPDATE tournaments
     SET signup_qr_token     = v_token,
         signup_qr_active    = true,
         signup_qr_issued_at = now()
   WHERE id = p_tournament_id;

  INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'generate_ff_qr', 'tournament', p_tournament_id::text,
          jsonb_build_object('title', v_title));

  RETURN json_build_object('ok', true, 'token', v_token);
END;
$$;

-- ── Admin: lock / revoke the active QR ───────────────────────
-- Venue-scoped: platform admin OR venue admin of the tournament's venue.
CREATE OR REPLACE FUNCTION public.rpc_admin_revoke_ff_signup_qr(
  p_tournament_id uuid
) RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_venue_id uuid;
BEGIN
  PERFORM public.require_mfa();

  SELECT venue_id INTO v_venue_id FROM tournaments WHERE id = p_tournament_id;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'not_found');
  END IF;

  IF NOT (public.is_admin() OR
          (v_venue_id IS NOT NULL AND public.can_manage_venue(v_venue_id))) THEN
    INSERT INTO security_events (event_type, severity, user_id, details)
    VALUES ('admin_access_denied', 'warn', auth.uid(),
      jsonb_build_object('rpc', 'rpc_admin_revoke_ff_signup_qr', 'tournament_id', p_tournament_id))
    ON CONFLICT DO NOTHING;
    RETURN json_build_object('error', 'unauthorized');
  END IF;

  UPDATE tournaments
     SET signup_qr_active = false
   WHERE id = p_tournament_id;

  INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'revoke_ff_qr', 'tournament', p_tournament_id::text, '{}');

  RETURN json_build_object('ok', true);
END;
$$;

-- ── Player: scan QR to register ──────────────────────────────
-- No MFA required — regular authenticated users call this.
-- Auto-locks the QR when the 20-player cap is reached.
CREATE OR REPLACE FUNCTION public.rpc_ff_qr_signup(
  p_token uuid
) RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tourn_id uuid;
  v_max      integer;
  v_count    integer;
  v_already  boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN json_build_object('error', 'not_authenticated');
  END IF;

  SELECT id, COALESCE(max_players, 20)
    INTO v_tourn_id, v_max
    FROM tournaments
   WHERE signup_qr_token = p_token
     AND signup_qr_active = true
     AND status IN ('upcoming', 'active');

  IF NOT FOUND THEN
    RETURN json_build_object(
      'error', 'invalid_or_inactive',
      'message', 'This QR code is no longer active.'
    );
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM tournament_registrations
     WHERE tournament_id = v_tourn_id AND user_id = auth.uid()
  ) INTO v_already;

  IF v_already THEN
    RETURN json_build_object(
      'error', 'already_registered',
      'message', 'You are already signed up for this tournament.'
    );
  END IF;

  SELECT COUNT(*) INTO v_count
    FROM tournament_registrations
   WHERE tournament_id = v_tourn_id AND status = 'accepted';

  IF v_count >= v_max THEN
    UPDATE tournaments SET signup_qr_active = false WHERE id = v_tourn_id;
    RETURN json_build_object(
      'error', 'full',
      'message', 'This tournament is full (20 players). The QR has been closed.'
    );
  END IF;

  INSERT INTO tournament_registrations (tournament_id, user_id, status)
  VALUES (v_tourn_id, auth.uid(), 'accepted')
  ON CONFLICT (tournament_id, user_id) DO NOTHING;

  SELECT COUNT(*) INTO v_count
    FROM tournament_registrations
   WHERE tournament_id = v_tourn_id AND status = 'accepted';

  IF v_count >= v_max THEN
    UPDATE tournaments SET signup_qr_active = false WHERE id = v_tourn_id;
  END IF;

  RETURN json_build_object(
    'ok',               true,
    'players_registered', v_count,
    'max_players',      v_max,
    'is_full',          v_count >= v_max
  );
END;
$$;

-- ── Permissions ───────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.rpc_admin_generate_ff_signup_qr(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_admin_revoke_ff_signup_qr(uuid)   FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_ff_qr_signup(uuid)                FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.rpc_admin_generate_ff_signup_qr(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_revoke_ff_signup_qr(uuid)   TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_ff_qr_signup(uuid)                TO authenticated;
