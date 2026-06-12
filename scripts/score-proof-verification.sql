-- ============================================================
-- AI Score-Proof Verification (conservative / deny-only launch)
--
--   1. game_reference_photos — one admin-managed reference shot of each
--      machine's score display, stored in the private game-references
--      bucket. Games WITHOUT a reference keep pure manual review.
--   2. scores gains AI verdict columns (verdict, confidence, the score
--      the model read off the display, reasoning, checked-at).
--   3. ai_verification_config — mode switch: 'deny_only' now (the AI can
--      only auto-DENY blatant mismatches and annotate everything else
--      for the human queue); flip to 'full_auto' later to allow
--      auto-approval of high-confidence matches.
--   4. rpc_admin_get_score_review_queue updated to surface the AI fields.
--      ⚠ Supersedes the copy in security-hardening-3.sql — keep in sync.
--
-- The verify-score-proof Edge Function (service role) performs the
-- actual vision check; clients never see reference photos or verdict
-- internals beyond their own score row.
--
-- Run AFTER: security-hardening-3.sql, storage-security.sql
-- Idempotent — safe to re-run.
-- ============================================================


-- ── 1. Reference photos ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.game_reference_photos (
  game_id      uuid PRIMARY KEY REFERENCES public.games(id) ON DELETE CASCADE,
  storage_path text NOT NULL,           -- path inside the game-references bucket
  uploaded_by  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  notes        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.game_reference_photos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "game_refs_admin_read"   ON public.game_reference_photos;
DROP POLICY IF EXISTS "game_refs_admin_write"  ON public.game_reference_photos;
DROP POLICY IF EXISTS "game_refs_admin_update" ON public.game_reference_photos;
DROP POLICY IF EXISTS "game_refs_admin_delete" ON public.game_reference_photos;
CREATE POLICY "game_refs_admin_read" ON public.game_reference_photos
  FOR SELECT TO authenticated USING (public.is_admin());
CREATE POLICY "game_refs_admin_write" ON public.game_reference_photos
  FOR INSERT TO authenticated WITH CHECK (public.is_admin());
CREATE POLICY "game_refs_admin_update" ON public.game_reference_photos
  FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "game_refs_admin_delete" ON public.game_reference_photos
  FOR DELETE TO authenticated USING (public.is_admin());


-- ── 2. Private bucket for reference photos ───────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('game-references', 'game-references', false)
ON CONFLICT (id) DO UPDATE SET public = false;

DROP POLICY IF EXISTS "game-references: admin read"   ON storage.objects;
DROP POLICY IF EXISTS "game-references: admin write"  ON storage.objects;
DROP POLICY IF EXISTS "game-references: admin delete" ON storage.objects;

CREATE POLICY "game-references: admin read" ON storage.objects
  FOR SELECT USING (bucket_id = 'game-references' AND public.is_admin());
CREATE POLICY "game-references: admin write" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'game-references' AND public.is_admin());
CREATE POLICY "game-references: admin delete" ON storage.objects
  FOR DELETE USING (bucket_id = 'game-references' AND public.is_admin());


-- ── 3. AI verdict columns on scores ──────────────────────────
ALTER TABLE public.scores
  ADD COLUMN IF NOT EXISTS ai_verdict     text CHECK (ai_verdict IS NULL OR ai_verdict IN
    ('auto_denied', 'looks_good', 'needs_review', 'no_reference', 'error')),
  ADD COLUMN IF NOT EXISTS ai_confidence  numeric,
  ADD COLUMN IF NOT EXISTS ai_read_score  bigint,
  ADD COLUMN IF NOT EXISTS ai_reasoning   text,
  ADD COLUMN IF NOT EXISTS ai_checked_at  timestamptz;


-- ── 4. Mode switch ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ai_verification_config (
  id         int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  mode       text NOT NULL DEFAULT 'deny_only' CHECK (mode IN ('off', 'deny_only', 'full_auto')),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.ai_verification_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.ai_verification_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ai_verification_config_admin_read" ON public.ai_verification_config;
CREATE POLICY "ai_verification_config_admin_read" ON public.ai_verification_config
  FOR SELECT TO authenticated USING (public.is_admin());

CREATE OR REPLACE FUNCTION public.rpc_admin_set_ai_verification_mode(p_mode text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.require_mfa();
  IF NOT public.is_admin() THEN
    INSERT INTO security_events (event_type, severity, user_id, details)
    VALUES ('admin_access_denied', 'warn', auth.uid(),
      jsonb_build_object('rpc', 'rpc_admin_set_ai_verification_mode'))
    ON CONFLICT DO NOTHING;
    RETURN json_build_object('error', 'unauthorized');
  END IF;
  IF p_mode NOT IN ('off', 'deny_only', 'full_auto') THEN
    RETURN json_build_object('error', 'invalid_mode');
  END IF;
  UPDATE ai_verification_config SET mode = p_mode, updated_at = now() WHERE id = 1;
  INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'ai_verification_mode', 'config', '1', jsonb_build_object('mode', p_mode));
  RETURN json_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_admin_set_ai_verification_mode(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_admin_set_ai_verification_mode(text) TO authenticated;


-- ── 5. Review queue surfaces AI fields ───────────────────────
-- ⚠ SOURCE OF TRUTH for rpc_admin_get_score_review_queue from this point —
-- supersedes the definition in security-hardening-3.sql (same auth logic,
-- adds the ai_* columns). Keep auth behavior in sync if it changes there.
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
        s.created_at,
        s.ai_verdict,
        s.ai_confidence,
        s.ai_read_score,
        s.ai_reasoning
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
