-- ============================================================
-- Security Hardening 2 — OWASP MASVS / Top 10 / API Top 10
-- Run in Supabase SQL Editor AFTER deploying all code changes.
-- Every statement is idempotent (CREATE OR REPLACE / IF NOT EXISTS).
-- ============================================================


-- ── A1: MFA enforcement helper ───────────────────────────────
-- PERFORM public.require_mfa(); is the first call inside every
-- rpc_admin_* function (see rpc-admin-actions.sql).
CREATE OR REPLACE FUNCTION public.require_mfa()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  IF (auth.jwt() ->> 'aal') IS DISTINCT FROM 'aal2' THEN
    RAISE EXCEPTION 'MFA verification required for this action.'
      USING ERRCODE = 'P0003';
  END IF;
END; $$;

REVOKE ALL ON FUNCTION public.require_mfa() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.require_mfa() TO authenticated;


-- ── A3: Score proof — path column + attach RPC ───────────────
-- Stores the storage path (not a URL) so admins can generate
-- short-lived signed URLs at review time.
ALTER TABLE scores ADD COLUMN IF NOT EXISTS proof_storage_path text;

CREATE OR REPLACE FUNCTION public.rpc_attach_score_proof(
  p_score_id     uuid,
  p_storage_path text
) RETURNS json LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN json_build_object('error', 'unauthenticated');
  END IF;

  -- Path must begin with caller's UID to prevent traversal to other users' folders
  IF p_storage_path IS NULL OR NOT (p_storage_path LIKE (v_uid::text || '/%')) THEN
    RETURN json_build_object('error', 'forbidden',
      'message', 'Storage path must start with your user ID.');
  END IF;

  -- Only the score owner can attach proof, and only while status = pending
  UPDATE scores
     SET proof_storage_path = p_storage_path
   WHERE id      = p_score_id
     AND user_id = v_uid
     AND status  = 'pending';

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'not_found_or_not_pending',
      'message', 'Score not found, not owned by you, or already reviewed.');
  END IF;

  RETURN json_build_object('ok', true);
END; $$;

REVOKE ALL ON FUNCTION public.rpc_attach_score_proof(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_attach_score_proof(uuid, text) TO authenticated;


-- ── A4: Score proof — signed-URL getter ──────────────────────
-- Returns the storage path only (after ownership check).
-- Client then calls:
--   supabase.storage.from('score-proofs').createSignedUrl(path, 3600)
CREATE OR REPLACE FUNCTION public.rpc_get_score_proof_url(p_score_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_path text;
BEGIN
  SELECT proof_storage_path INTO v_path
    FROM scores
   WHERE id = p_score_id
     AND (user_id = auth.uid() OR public.is_admin());

  RETURN v_path;  -- NULL if not found or caller is not authorized
END; $$;

REVOKE ALL ON FUNCTION public.rpc_get_score_proof_url(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_get_score_proof_url(uuid) TO authenticated;


-- ── A5: QR token expiry ───────────────────────────────────────
ALTER TABLE lanes
  ADD COLUMN IF NOT EXISTS qr_token_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS qr_token_issued_at  timestamptz;

-- Backfill existing rows: 90-day TTL from now
UPDATE lanes
   SET qr_token_expires_at = now() + interval '90 days',
       qr_token_issued_at  = now()
 WHERE qr_token_expires_at IS NULL;

-- Rebuild rpc_check_in with QR expiry guard
CREATE OR REPLACE FUNCTION public.rpc_check_in(p_token text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_user_id  uuid;
  v_lane     record;
  v_game     record;
  v_ci_id    uuid;
  v_cutoff   timestamptz;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN json_build_object('error', 'not_authenticated',
      'message', 'You must be logged in.');
  END IF;

  SELECT l.id, l.lane_number, l.game_id, l.venue_id, l.status,
         l.qr_token_expires_at
    INTO v_lane
    FROM lanes l
   WHERE l.lane_qr_token = p_token
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'lane_not_found',
      'message', 'This QR code does not match any lane.');
  END IF;

  -- QR token expiry check
  IF v_lane.qr_token_expires_at IS NOT NULL
     AND v_lane.qr_token_expires_at < now() THEN
    RETURN json_build_object('error', 'token_expired',
      'message', 'This QR code has expired. Ask staff to regenerate it.');
  END IF;

  -- Prevent duplicate active sessions
  IF EXISTS (
    SELECT 1 FROM check_ins
     WHERE user_id = v_user_id AND status = 'active'
  ) THEN
    RETURN json_build_object('error', 'already_active',
      'message', 'You already have an active session. End it before scanning a new lane.');
  END IF;

  -- 30-minute cooldown per lane
  v_cutoff := NOW() - INTERVAL '30 minutes';
  IF EXISTS (
    SELECT 1 FROM check_ins
     WHERE user_id = v_user_id
       AND lane_id  = v_lane.id
       AND created_at > v_cutoff
  ) THEN
    RETURN json_build_object('error', 'rate_limited',
      'message', 'You checked into this lane recently. Wait 30 minutes before scanning again.');
  END IF;

  SELECT g.name, g.type INTO v_game
    FROM games g WHERE g.id = v_lane.game_id;

  INSERT INTO check_ins (user_id, lane_id, venue_id, status)
  VALUES (v_user_id, v_lane.id, v_lane.venue_id, 'active')
  RETURNING id INTO v_ci_id;

  RETURN json_build_object(
    'check_in_id',  v_ci_id,
    'lane_id',      v_lane.id,
    'lane_number',  v_lane.lane_number,
    'game_id',      v_lane.game_id,
    'game_name',    COALESCE(v_game.name, 'Game'),
    'game_type',    COALESCE(v_game.type, 'arcade'),
    'venue_id',     v_lane.venue_id
  );
END; $$;

REVOKE ALL ON FUNCTION public.rpc_check_in(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_check_in(text) TO authenticated;

-- Admin-triggered QR token rotation (90-day TTL; generates new UUID token)
CREATE OR REPLACE FUNCTION public.rpc_admin_rotate_lane_token(p_lane_id uuid)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_new_token text := gen_random_uuid()::text;
BEGIN
  PERFORM public.require_mfa();

  IF NOT public.is_admin() THEN
    RETURN json_build_object('error', 'unauthorized');
  END IF;

  UPDATE lanes
     SET lane_qr_token       = v_new_token,
         qr_token_issued_at  = now(),
         qr_token_expires_at = now() + interval '90 days'
   WHERE id = p_lane_id;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'not_found');
  END IF;

  INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'rotate_lane_token', 'lane', p_lane_id::text,
          jsonb_build_object('new_token', v_new_token));

  RETURN json_build_object('ok', true, 'new_token', v_new_token);
END; $$;

REVOKE ALL ON FUNCTION public.rpc_admin_rotate_lane_token(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_admin_rotate_lane_token(uuid) TO authenticated;


-- ── A6: Score upper bound ─────────────────────────────────────
ALTER TABLE scores DROP CONSTRAINT IF EXISTS scores_score_range;
ALTER TABLE scores ADD CONSTRAINT scores_score_range
  CHECK (score >= 0 AND score <= 9999999999);

-- Rebuild rpc_submit_score with upper-bound check
CREATE OR REPLACE FUNCTION public.rpc_submit_score(
  p_game_id     uuid,
  p_lane_id     uuid,
  p_check_in_id uuid,
  p_venue_id    uuid,
  p_score       integer,
  p_frame_data  jsonb DEFAULT NULL
) RETURNS json LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_score_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN json_build_object('error', 'unauthenticated');
  END IF;

  IF p_score < 0 OR p_score > 9999999999 THEN
    RETURN json_build_object('error', 'invalid_score',
      'message', 'Score must be between 0 and 9,999,999,999.');
  END IF;

  IF p_check_in_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM check_ins
       WHERE id      = p_check_in_id
         AND user_id = auth.uid()
    ) THEN
      RETURN json_build_object('error', 'invalid_check_in',
        'message', 'Check-in does not belong to this user.');
    END IF;
  END IF;

  PERFORM public.check_and_log_rate_limit('score_submit', 3600, 20);

  INSERT INTO scores (
    user_id, game_id, lane_id, check_in_id, venue_id,
    score, frame_data, status
  ) VALUES (
    auth.uid(), p_game_id, p_lane_id, p_check_in_id, p_venue_id,
    p_score, p_frame_data, 'pending'
  )
  RETURNING id INTO v_score_id;

  RETURN json_build_object('ok', true, 'score_id', v_score_id);
END; $$;

REVOKE ALL ON FUNCTION public.rpc_submit_score(uuid, uuid, uuid, uuid, integer, jsonb) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.rpc_submit_score(uuid, uuid, uuid, uuid, integer, jsonb) TO authenticated;


-- ── A8: public_profiles view — privacy filter ─────────────────
-- Users with is_private = true are only visible to themselves.
CREATE OR REPLACE VIEW public.public_profiles AS
  SELECT
    id,
    username,
    avatar_url,
    bio,
    role,
    online_status,
    created_at,
    featured_game_id,
    is_private
  FROM profiles
  WHERE (NOT COALESCE(is_private, false)) OR id = auth.uid();

GRANT SELECT ON public.public_profiles TO authenticated;
