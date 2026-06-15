-- ============================================================
-- Lane QR tokens: support non-expiring codes
--
-- Printed lane check-in QR codes stay mounted on the lanes, so they should
-- only become invalid when an admin reissues them (which already revokes
-- the previous token). p_ttl_hours = NULL or <= 0 now mints a token with
-- expires_at = 'infinity', i.e. it never expires on a timer. A positive
-- p_ttl_hours still produces a normal expiring token (used elsewhere, e.g.
-- arcade lane rotation). Validation already treats expires_at < now() as
-- expired, and 'infinity' < now() is always false — no other changes needed.
--
-- Run AFTER: security-cleanup.sql (source of truth for this function)
-- Idempotent — safe to re-run.
-- ============================================================

CREATE OR REPLACE FUNCTION public.rpc_admin_generate_lane_qr_token(
  p_lane_id   uuid,
  p_ttl_hours integer DEFAULT NULL  -- NULL/<=0 = never expires (printed lane codes)
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_raw_token  text;
  v_hash       text;
  v_venue_id   uuid;
  v_lane_num   int;
  v_expires_at timestamptz;
BEGIN
  PERFORM public.require_mfa();

  SELECT venue_id, lane_number INTO v_venue_id, v_lane_num
    FROM lanes WHERE id = p_lane_id;
  IF NOT FOUND THEN
    RETURN json_build_object('error', 'lane_not_found');
  END IF;

  IF NOT (public.is_admin() OR public.is_venue_admin(v_venue_id)) THEN
    RETURN json_build_object('error', 'unauthorized',
      'message', 'You do not have admin rights for this venue.');
  END IF;

  -- Reissuing revokes the lane's previous active tokens (old printed codes stop working).
  UPDATE lane_qr_tokens
     SET revoked_at = now()
   WHERE lane_id = p_lane_id AND revoked_at IS NULL;

  v_raw_token := gen_random_uuid()::text;
  v_hash      := public.hash_lane_token(v_raw_token);
  v_expires_at := CASE
    WHEN p_ttl_hours IS NULL OR p_ttl_hours <= 0 THEN 'infinity'::timestamptz
    ELSE now() + (p_ttl_hours || ' hours')::interval
  END;

  INSERT INTO lane_qr_tokens (lane_id, venue_id, token_hash, expires_at, created_by)
  VALUES (p_lane_id, v_venue_id, v_hash, v_expires_at, auth.uid());

  INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (
    auth.uid(), 'generate_lane_qr_token', 'lane', p_lane_id::text,
    jsonb_build_object(
      'venue_id', v_venue_id, 'lane_number', v_lane_num,
      'ttl_hours', p_ttl_hours, 'expires_at', v_expires_at,
      'never_expires', (v_expires_at = 'infinity'::timestamptz)
    )
  );

  RETURN json_build_object(
    'ok', true,
    'raw_token', v_raw_token,
    'token_fingerprint', public.qr_token_fingerprint(v_raw_token),
    'expires_at', v_expires_at,
    'never_expires', (v_expires_at = 'infinity'::timestamptz),
    'ttl_hours', p_ttl_hours,
    'lane_id', p_lane_id,
    'lane_number', v_lane_num
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.rpc_admin_generate_lane_qr_token(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_admin_generate_lane_qr_token(uuid, integer) TO authenticated;
