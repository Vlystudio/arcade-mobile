-- ============================================================
-- Security Hardening 3 — Venue-Scoped Admin Authorization
-- Run AFTER: security-hardening-2.sql, qr-token-hardening.sql
-- Idempotent — safe to re-run.
-- ============================================================


-- ── Schema additions ─────────────────────────────────────────
-- venue_id on tournament_requests and tournaments enables venue-scoped
-- admin authorization for tournament lifecycle RPCs.
ALTER TABLE tournament_requests ADD COLUMN IF NOT EXISTS venue_id uuid REFERENCES venues(id) ON DELETE SET NULL;
ALTER TABLE tournaments         ADD COLUMN IF NOT EXISTS venue_id uuid REFERENCES venues(id) ON DELETE SET NULL;
ALTER TABLE teams               ADD COLUMN IF NOT EXISTS venue_id uuid REFERENCES venues(id) ON DELETE SET NULL;

-- New users start with private profiles; existing users keep their current value.
ALTER TABLE profiles ALTER COLUMN is_private SET DEFAULT true;


-- ── rpc_admin_get_score_review_queue ─────────────────────────
-- Returns the admin score-review queue filtered by venue.
-- Requires MFA + platform-admin OR venue-admin of p_venue_id.
-- p_venue_id NULL means "all venues" — only platform admins may do this.
CREATE OR REPLACE FUNCTION public.rpc_admin_get_score_review_queue(
  p_venue_id uuid DEFAULT NULL,
  p_status   text DEFAULT 'pending'
) RETURNS json LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  PERFORM public.require_mfa();

  IF NOT (public.is_admin() OR (p_venue_id IS NOT NULL AND public.is_venue_admin(p_venue_id))) THEN
    INSERT INTO security_events (event_type, severity, user_id, details)
    VALUES ('admin_access_denied', 'warn', auth.uid(),
      jsonb_build_object('rpc', 'rpc_admin_get_score_review_queue', 'venue_id', p_venue_id))
    ON CONFLICT DO NOTHING;
    RETURN json_build_object('error', 'unauthorized');
  END IF;

  IF p_status NOT IN ('pending', 'approved', 'denied') THEN
    RETURN json_build_object('error', 'invalid_status');
  END IF;

  RETURN (
    SELECT COALESCE(json_agg(row_to_json(q)), '[]'::json)
    FROM (
      SELECT
        s.id,
        s.user_id,
        p.username,
        p.avatar_url,
        g.name  AS game_name,
        s.score,
        s.photo_url,
        s.proof_storage_path,
        s.venue_id,
        s.created_at
      FROM scores s
      LEFT JOIN profiles p ON p.id = s.user_id
      LEFT JOIN games    g ON g.id = s.game_id
      WHERE s.status = p_status
        AND (
          public.is_admin()
          OR (p_venue_id IS NOT NULL AND s.venue_id = p_venue_id)
        )
      ORDER BY
        CASE WHEN p_status = 'pending' THEN s.created_at END ASC,
        CASE WHEN p_status <> 'pending' THEN s.created_at END DESC
    ) q
  );
END; $$;

REVOKE ALL ON FUNCTION public.rpc_admin_get_score_review_queue(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_admin_get_score_review_queue(uuid, text) TO authenticated;


-- ── rpc_admin_create_score_proof_signed_url ──────────────────
-- Returns proof_storage_path after MFA + admin auth check.
-- Client then calls:
--   supabase.storage.from('score-proofs').createSignedUrl(path, 3600)
-- Keeping signed-URL generation on the client avoids storing
-- short-lived tokens in the DB and leverages Supabase Storage auth.
CREATE OR REPLACE FUNCTION public.rpc_admin_create_score_proof_signed_url(
  p_score_id uuid
) RETURNS json LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_score record;
BEGIN
  PERFORM public.require_mfa();

  SELECT id, proof_storage_path, venue_id INTO v_score
    FROM scores WHERE id = p_score_id;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'not_found');
  END IF;

  IF NOT (public.is_admin() OR public.is_venue_admin(v_score.venue_id)) THEN
    INSERT INTO security_events (event_type, severity, user_id, details)
    VALUES ('admin_access_denied', 'warn', auth.uid(),
      jsonb_build_object('rpc', 'rpc_admin_create_score_proof_signed_url', 'score_id', p_score_id))
    ON CONFLICT DO NOTHING;
    RETURN json_build_object('error', 'unauthorized');
  END IF;

  IF v_score.proof_storage_path IS NULL THEN
    RETURN json_build_object('error', 'no_proof',
      'message', 'This score has no attached proof.');
  END IF;

  RETURN json_build_object('ok', true, 'path', v_score.proof_storage_path);
END; $$;

REVOKE ALL ON FUNCTION public.rpc_admin_create_score_proof_signed_url(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_admin_create_score_proof_signed_url(uuid) TO authenticated;


-- ── Fix rpc_admin_rotate_lane_token ──────────────────────────
-- ⚠ SOURCE OF TRUTH for public.rpc_admin_rotate_lane_token (run order 18).
-- The security-hardening-2.sql version only updated lanes.lane_qr_token
-- (legacy column) without writing to lane_qr_tokens, and that definition has
-- since been removed from security-hardening-2.sql. Do not redefine
-- rpc_admin_rotate_lane_token in any earlier script.
-- This version delegates to rpc_admin_generate_lane_qr_token which
-- handles the full hashed-token flow and is also venue-admin scoped.
CREATE OR REPLACE FUNCTION public.rpc_admin_rotate_lane_token(p_lane_id uuid)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_venue_id uuid;
BEGIN
  PERFORM public.require_mfa();

  SELECT venue_id INTO v_venue_id FROM lanes WHERE id = p_lane_id;
  IF NOT FOUND THEN
    RETURN json_build_object('error', 'not_found');
  END IF;

  IF NOT (public.is_admin() OR public.is_venue_admin(v_venue_id)) THEN
    INSERT INTO security_events (event_type, severity, user_id, details)
    VALUES ('admin_access_denied', 'warn', auth.uid(),
      jsonb_build_object('rpc', 'rpc_admin_rotate_lane_token', 'lane_id', p_lane_id))
    ON CONFLICT DO NOTHING;
    RETURN json_build_object('error', 'unauthorized');
  END IF;

  -- Delegate to the full generate RPC (handles lane_qr_tokens + audit log)
  RETURN public.rpc_admin_generate_lane_qr_token(p_lane_id, 720);
END; $$;

REVOKE ALL ON FUNCTION public.rpc_admin_rotate_lane_token(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_admin_rotate_lane_token(uuid) TO authenticated;
