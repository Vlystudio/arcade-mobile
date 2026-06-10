-- ============================================================
-- Security Cleanup — Production Hardening Pass
--
-- Run AFTER: security-hardening-3.sql, qr-token-hardening.sql,
--            storage-security.sql, security-events.sql
-- Idempotent — safe to re-run.
--
-- Fixes applied:
--   1. rpc_check_in     — remove legacy lane_qr_token fallback
--   2. rpc_admin_generate_lane_qr_token — stop writing raw token
--                          to deprecated lanes.lane_qr_token column
--   3. lanes.lane_qr_token — mark deprecated via column comment
--   4. check_ins RLS    — harden direct-insert block policy
--   5. rpc_admin_get_storage_cleanup_queue — add MFA + admin check
--   6. rpc_admin_mark_storage_cleaned      — fix broken auth + add MFA
-- ============================================================


-- ── 1. rpc_check_in: hash-only, no legacy fallback ────────────
-- ⚠ SOURCE OF TRUTH for public.rpc_check_in (run order 19, last script in
-- the documented run order). The legacy Path B that read lanes.lane_qr_token
-- in plain text is removed. Any token not present in lane_qr_tokens is
-- rejected. Do not redefine rpc_check_in in any earlier script — see the
-- comments in scripts/rpc-check-in.sql and scripts/security-hardening-2.sql.
CREATE OR REPLACE FUNCTION public.rpc_check_in(p_token text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id    uuid;
  v_lqt        record;
  v_game       record;
  v_ci_id      uuid;
  v_cutoff     timestamptz;
  v_token_hash text;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN json_build_object('error', 'not_authenticated',
      'message', 'You must be logged in to check in.');
  END IF;

  v_token_hash := public.hash_lane_token(p_token);

  -- Hash-only lookup — legacy lane_qr_token fallback removed.
  SELECT lqt.*, l.id AS lane_id, l.lane_number, l.game_id, l.venue_id, l.status AS lane_status
    INTO v_lqt
    FROM lane_qr_tokens lqt
    JOIN lanes           l ON l.id = lqt.lane_id
   WHERE lqt.token_hash = v_token_hash
   LIMIT 1;

  IF NOT FOUND THEN
    INSERT INTO security_events (event_type, severity, user_id, details)
    VALUES ('qr_token_invalid', 'warn', v_user_id,
      jsonb_build_object('token_suffix', right(p_token, 8)))
    ON CONFLICT DO NOTHING;
    RETURN json_build_object('error', 'lane_not_found',
      'message', 'This QR code does not match any lane. Ask staff to scan the current code.');
  END IF;

  -- Validate token state
  IF v_lqt.revoked_at IS NOT NULL THEN
    INSERT INTO security_events (event_type, severity, user_id, details)
    VALUES ('qr_token_revoked', 'warn', v_user_id,
      jsonb_build_object('token_suffix', right(p_token, 8), 'lane_id', v_lqt.lane_id))
    ON CONFLICT DO NOTHING;
    RETURN json_build_object('error', 'token_revoked',
      'message', 'This QR code has been revoked. Ask staff for a new one.');
  END IF;

  IF v_lqt.expires_at < now() THEN
    INSERT INTO security_events (event_type, severity, user_id, details)
    VALUES ('qr_token_expired', 'warn', v_user_id,
      jsonb_build_object('token_suffix', right(p_token, 8), 'lane_id', v_lqt.lane_id))
    ON CONFLICT DO NOTHING;
    RETURN json_build_object('error', 'token_expired',
      'message', 'This QR code has expired. Ask staff to regenerate it.');
  END IF;

  -- Skee-Ball uses manual lane selection — QR check-in disabled
  SELECT g.name, g.type INTO v_game
    FROM games g WHERE g.id = v_lqt.game_id;

  IF v_game.type = 'skeeball' THEN
    RETURN json_build_object(
      'error',   'qr_disabled',
      'message', 'Skee-Ball lanes don''t use QR check-in. Choose your lane from the Games screen.'
    );
  END IF;

  IF v_lqt.lane_status IS NOT NULL AND v_lqt.lane_status = 'inactive' THEN
    RETURN json_build_object('error', 'lane_inactive',
      'message', 'This lane is currently inactive.');
  END IF;

  -- Prevent duplicate active check-ins
  IF EXISTS (
    SELECT 1 FROM check_ins
     WHERE user_id = v_user_id AND status = 'active'
  ) THEN
    RETURN json_build_object('error', 'already_active',
      'message', 'You already have an active session. End it before scanning a new lane.');
  END IF;

  -- 30-minute cooldown per lane
  v_cutoff := now() - interval '30 minutes';
  IF EXISTS (
    SELECT 1 FROM check_ins
     WHERE user_id    = v_user_id
       AND lane_id    = v_lqt.lane_id
       AND created_at > v_cutoff
  ) THEN
    INSERT INTO security_events (event_type, severity, user_id, details)
    VALUES ('qr_checkin_rate_limited', 'info', v_user_id,
      jsonb_build_object('lane_id', v_lqt.lane_id))
    ON CONFLICT DO NOTHING;
    RETURN json_build_object('error', 'rate_limited',
      'message', 'You checked into this lane recently. Wait 30 minutes before scanning again.');
  END IF;

  INSERT INTO check_ins (user_id, lane_id, venue_id, status)
  VALUES (v_user_id, v_lqt.lane_id, v_lqt.venue_id, 'active')
  RETURNING id INTO v_ci_id;

  RETURN json_build_object(
    'check_in_id',  v_ci_id,
    'lane_id',      v_lqt.lane_id,
    'lane_number',  v_lqt.lane_number,
    'game_id',      v_lqt.game_id,
    'game_name',    COALESCE(v_game.name, 'Game'),
    'game_type',    COALESCE(v_game.type, 'arcade'),
    'venue_id',     v_lqt.venue_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_check_in(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_check_in(text) TO authenticated;


-- ── 2. rpc_admin_generate_lane_qr_token: stop writing raw token ─
-- Raw token no longer written to lanes.lane_qr_token.
CREATE OR REPLACE FUNCTION public.rpc_admin_generate_lane_qr_token(
  p_lane_id    uuid,
  p_ttl_hours  int DEFAULT 720  -- 30 days
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_raw_token  text;
  v_hash       text;
  v_venue_id   uuid;
  v_lane_num   int;
  v_expires_at timestamptz;
BEGIN
  PERFORM public.require_mfa();

  SELECT venue_id, lane_number
    INTO v_venue_id, v_lane_num
    FROM lanes
   WHERE id = p_lane_id;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'lane_not_found');
  END IF;

  IF NOT (public.is_admin() OR public.is_venue_admin(v_venue_id)) THEN
    RETURN json_build_object('error', 'unauthorized',
      'message', 'You do not have admin rights for this venue.');
  END IF;

  -- Revoke all existing active tokens for this lane
  UPDATE lane_qr_tokens
     SET revoked_at = now()
   WHERE lane_id    = p_lane_id
     AND revoked_at IS NULL;

  v_raw_token  := gen_random_uuid()::text;
  v_hash       := public.hash_lane_token(v_raw_token);
  v_expires_at := now() + (p_ttl_hours || ' hours')::interval;

  INSERT INTO lane_qr_tokens (lane_id, venue_id, token_hash, expires_at, created_by)
  VALUES (p_lane_id, v_venue_id, v_hash, v_expires_at, auth.uid());

  -- lanes.lane_qr_token is DEPRECATED — not written to.
  -- All token validation goes through lane_qr_tokens.token_hash only.

  INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (
    auth.uid(), 'generate_lane_qr_token', 'lane', p_lane_id::text,
    jsonb_build_object(
      'venue_id',     v_venue_id,
      'lane_number',  v_lane_num,
      'ttl_hours',    p_ttl_hours,
      'expires_at',   v_expires_at
    )
  );

  RETURN json_build_object(
    'ok',           true,
    'raw_token',    v_raw_token,
    'token_suffix', right(v_raw_token, 8),
    'expires_at',   v_expires_at,
    'ttl_hours',    p_ttl_hours,
    'lane_id',      p_lane_id,
    'lane_number',  v_lane_num,
    'note',         'Encode raw_token into QR as: https://your-site/scan?lane_token=<raw_token>'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_admin_generate_lane_qr_token(uuid, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_admin_generate_lane_qr_token(uuid, int) TO authenticated;


-- ── 3. Deprecate lanes.lane_qr_token ────────────────────────────
COMMENT ON COLUMN lanes.lane_qr_token IS
  'DEPRECATED — no longer written to. Use lane_qr_tokens.token_hash instead. '
  'Column retained for schema compatibility only. Remove in a future migration '
  'once confirmed no legacy clients depend on it.';


-- ── 4. check_ins: harden RLS against direct inserts ─────────────
-- rpc_check_in is the only permitted write path.
DROP POLICY IF EXISTS "No direct insert check_ins" ON check_ins;
CREATE POLICY "No direct insert check_ins" ON check_ins
  FOR INSERT WITH CHECK (false);

DROP POLICY IF EXISTS "Users read own check_ins" ON check_ins;
CREATE POLICY "Users read own check_ins" ON check_ins
  FOR SELECT USING (user_id = auth.uid() OR public.is_admin());


-- ── 5. rpc_admin_get_storage_cleanup_queue: add MFA + admin check
-- ⚠ SOURCE OF TRUTH for rpc_admin_get_storage_cleanup_queue and
-- rpc_admin_mark_storage_cleaned (run order 19, last script). An identical
-- copy also exists in scripts/storage-security.sql (run order 15) because
-- that script is what creates the storage_cleanup_queue table and must leave
-- it with working, MFA-gated RPCs on a fresh database run. Both copies are
-- kept in sync intentionally (CREATE OR REPLACE with the same body is a
-- no-op regardless of run order) — if you change the auth/logging logic,
-- update both files.
CREATE OR REPLACE FUNCTION public.rpc_admin_get_storage_cleanup_queue(p_limit int DEFAULT 100)
RETURNS TABLE (id uuid, bucket text, path text, reason text, created_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.require_mfa();

  IF NOT public.is_admin() THEN
    INSERT INTO security_events (event_type, severity, user_id, details)
    VALUES ('admin_access_denied', 'warn', auth.uid(),
      jsonb_build_object('rpc', 'rpc_admin_get_storage_cleanup_queue'))
    ON CONFLICT DO NOTHING;
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
    SELECT scq.id, scq.bucket, scq.path, scq.reason, scq.created_at
      FROM storage_cleanup_queue scq
     WHERE scq.processed_at IS NULL
     ORDER BY scq.created_at
     LIMIT p_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_admin_get_storage_cleanup_queue(int) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.rpc_admin_get_storage_cleanup_queue(int) TO authenticated;


-- ── 6. rpc_admin_mark_storage_cleaned: fix auth + add MFA ────────
-- Previous version checked is_admin() in the WHERE clause, which silently
-- skipped rows instead of raising an error for unauthorized callers.
CREATE OR REPLACE FUNCTION public.rpc_admin_mark_storage_cleaned(p_ids uuid[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.require_mfa();

  IF NOT public.is_admin() THEN
    INSERT INTO security_events (event_type, severity, user_id, details)
    VALUES ('admin_access_denied', 'warn', auth.uid(),
      jsonb_build_object('rpc', 'rpc_admin_mark_storage_cleaned'))
    ON CONFLICT DO NOTHING;
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = 'P0001';
  END IF;

  UPDATE storage_cleanup_queue
     SET processed_at = now()
   WHERE id = ANY(p_ids);
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_admin_mark_storage_cleaned(uuid[]) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.rpc_admin_mark_storage_cleaned(uuid[]) TO authenticated;
