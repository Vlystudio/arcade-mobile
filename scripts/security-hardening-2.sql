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
  v_path   text;
  v_exists boolean;
BEGIN
  SELECT proof_storage_path INTO v_path
    FROM scores
   WHERE id = p_score_id
     AND (user_id = auth.uid() OR public.is_admin());

  IF v_path IS NULL THEN
    -- Distinguish "not found" from "found but unauthorized" only for logging;
    -- the return value is NULL either way so we don't leak existence info.
    SELECT EXISTS (SELECT 1 FROM scores WHERE id = p_score_id) INTO v_exists;
    IF v_exists THEN
      INSERT INTO security_events (event_type, severity, user_id, details)
      VALUES ('score_proof_access_denied', 'warn', auth.uid(),
        jsonb_build_object('score_id', p_score_id))
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;

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

-- rpc_check_in is NOT defined in this script.
--
-- ⚠ SOURCE OF TRUTH: scripts/security-cleanup.sql (run order 19) defines the
-- production rpc_check_in (hash-only lookup against lane_qr_tokens, with
-- expiry/revocation/invalid-token logging to security_events). An earlier
-- version of this script defined an insecure rpc_check_in here that matched
-- on plaintext lanes.lane_qr_token = p_token — that definition has been
-- removed. Do NOT re-add a rpc_check_in definition to this file; doing so
-- would silently downgrade check-in security if this script is ever re-run
-- after security-cleanup.sql.
--
-- The qr_token_expires_at / qr_token_issued_at columns above are retained
-- because qr-token-hardening.sql's lane_qr_tokens backfill migration uses
-- them as a fallback expiry value for legacy rows.


-- rpc_admin_rotate_lane_token is NOT defined in this script.
--
-- ⚠ SOURCE OF TRUTH: scripts/security-hardening-3.sql (run order 18) defines
-- the production rpc_admin_rotate_lane_token (venue-admin scoped, delegates
-- to rpc_admin_generate_lane_qr_token for hashed-token rotation). An earlier
-- version of this script defined a platform-admin-only rotate function here
-- that wrote a raw token directly to the deprecated lanes.lane_qr_token
-- column without creating a lane_qr_tokens entry — that definition has been
-- removed. Do NOT re-add it here.


-- ── A6: Score upper bound ─────────────────────────────────────
-- Superseded by scripts/score-bigint-migration.sql (run order 24),
-- which migrates scores.score to bigint and raises this to 100B.
-- Kept here for historical/idempotent re-run purposes only.
ALTER TABLE scores DROP CONSTRAINT IF EXISTS scores_score_range;
ALTER TABLE scores ADD CONSTRAINT scores_score_range
  CHECK (score >= 0 AND score <= 9999999999);

-- Rebuild rpc_submit_score with upper-bound check
-- Superseded by scripts/score-bigint-migration.sql (run order 24) —
-- that script is the source of truth for rpc_submit_score (p_score bigint).
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
-- ⚠ SOURCE OF TRUTH for public.public_profiles.
-- Users with is_private = true are only visible to themselves.
-- Exposes ONLY public display fields: no email, phone, role, admin flags,
-- billing IDs, or private settings (is_private itself is filter-only).
-- DROP + CREATE because CREATE OR REPLACE VIEW cannot remove columns.
DROP VIEW IF EXISTS public.public_profiles;
CREATE VIEW public.public_profiles AS
  SELECT
    id,
    username,
    avatar_url,
    bio,
    online_status,
    created_at,
    featured_game_id
  FROM profiles
  WHERE (NOT COALESCE(is_private, false)) OR id = auth.uid();

-- anon needs read for the public landing page / standings surfaces;
-- rows remain privacy-filtered either way.
GRANT SELECT ON public.public_profiles TO anon, authenticated;
