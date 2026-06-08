-- ============================================================
-- Storage Security — bucket RLS policies + cleanup jobs
--
-- Supabase Storage uses RLS on the storage.objects table.
-- Bucket creation/configuration (size limits, MIME types)
-- must be done in the Supabase Dashboard; see README for steps.
--
-- Run AFTER: rls-policies.sql, security-hardening.sql
-- Idempotent — safe to re-run.
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- BUCKET: avatars  (public read)
-- Path convention: {user_id}/{filename}
-- ─────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "avatars: public read"    ON storage.objects;
DROP POLICY IF EXISTS "avatars: owner upload"   ON storage.objects;
DROP POLICY IF EXISTS "avatars: owner delete"   ON storage.objects;
DROP POLICY IF EXISTS "avatars: owner update"   ON storage.objects;

CREATE POLICY "avatars: public read" ON storage.objects
  FOR SELECT USING (bucket_id = 'avatars');

CREATE POLICY "avatars: owner upload" ON storage.objects
  FOR INSERT WITH CHECK (false);

CREATE POLICY "avatars: owner update" ON storage.objects
  FOR UPDATE USING (false) WITH CHECK (false);

CREATE POLICY "avatars: owner delete" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'avatars'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR public.is_admin()
    )
  );


-- ─────────────────────────────────────────────────────────────
-- BUCKET: post-photos  (public read)
-- Path convention: {user_id}/{post_id}/{filename}
-- ─────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "post-photos: public read"   ON storage.objects;
DROP POLICY IF EXISTS "post-photos: owner upload"  ON storage.objects;
DROP POLICY IF EXISTS "post-photos: owner delete"  ON storage.objects;
DROP POLICY IF EXISTS "post-photos: admin delete"  ON storage.objects;

CREATE POLICY "post-photos: public read" ON storage.objects
  FOR SELECT USING (bucket_id = 'post-photos');

CREATE POLICY "post-photos: owner upload" ON storage.objects
  FOR INSERT WITH CHECK (false);

CREATE POLICY "post-photos: owner delete" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'post-photos'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR public.is_admin()
    )
  );


-- ─────────────────────────────────────────────────────────────
-- BUCKET: score-proofs  (PRIVATE — signed URLs only)
-- Path convention: {user_id}/{score_id}/{filename}
-- ─────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "score-proofs: no public read"   ON storage.objects;
DROP POLICY IF EXISTS "score-proofs: owner upload"     ON storage.objects;
DROP POLICY IF EXISTS "score-proofs: owner read"       ON storage.objects;
DROP POLICY IF EXISTS "score-proofs: venue admin read" ON storage.objects;
DROP POLICY IF EXISTS "score-proofs: admin read"       ON storage.objects;
DROP POLICY IF EXISTS "score-proofs: admin delete"     ON storage.objects;
DROP POLICY IF EXISTS "score-proofs: owner delete"     ON storage.objects;
DROP POLICY IF EXISTS "score-proofs: delete"           ON storage.objects;

-- Owner can upload to their own folder
CREATE POLICY "score-proofs: owner upload" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'score-proofs'
    AND auth.uid() IS NOT NULL
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Owner can read their own proofs (for signed URL generation)
CREATE POLICY "score-proofs: owner read" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'score-proofs'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Platform admins and venue admins can read any proof
-- (needed to generate signed URL for score review)
CREATE POLICY "score-proofs: admin read" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'score-proofs'
    AND public.is_admin()
  );

-- Owner or admin can delete
CREATE POLICY "score-proofs: delete" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'score-proofs'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR public.is_admin()
    )
  );


-- ─────────────────────────────────────────────────────────────
-- BUCKET: message-media  (private — participants only)
-- Path convention: {conversation_id}/{sender_user_id}/{filename}
-- ─────────────────────────────────────────────────────────────

-- -----------------------------------------------------------------------------
-- BUCKET: media-quarantine  (PRIVATE - public media before moderation)
-- Path convention: {user_id}/{target_bucket}/{filename}
-- -----------------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public)
VALUES ('media-quarantine', 'media-quarantine', false)
ON CONFLICT (id) DO UPDATE SET public = false;

DROP POLICY IF EXISTS "media-quarantine: owner upload" ON storage.objects;
DROP POLICY IF EXISTS "media-quarantine: owner read"   ON storage.objects;
DROP POLICY IF EXISTS "media-quarantine: owner delete" ON storage.objects;

CREATE POLICY "media-quarantine: owner upload" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'media-quarantine'
    AND auth.uid() IS NOT NULL
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "media-quarantine: owner read" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'media-quarantine'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "media-quarantine: owner delete" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'media-quarantine'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "message-media: participant read"  ON storage.objects;
DROP POLICY IF EXISTS "message-media: sender upload"     ON storage.objects;
DROP POLICY IF EXISTS "message-media: sender delete"     ON storage.objects;

CREATE POLICY "message-media: sender upload" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'message-media'
    AND auth.uid() IS NOT NULL
    -- Second folder segment must be caller's user ID
    AND (storage.foldername(name))[2] = auth.uid()::text
    -- First segment must be a conversation the caller participates in
    AND EXISTS (
      SELECT 1 FROM conversations
       WHERE id = ((storage.foldername(name))[1])::uuid
         AND (participant_1 = auth.uid() OR participant_2 = auth.uid())
    )
  );

CREATE POLICY "message-media: participant read" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'message-media'
    AND (
      EXISTS (
        SELECT 1 FROM conversations
         WHERE id = ((storage.foldername(name))[1])::uuid
           AND (participant_1 = auth.uid() OR participant_2 = auth.uid())
      )
      OR public.is_admin()
    )
  );

CREATE POLICY "message-media: sender delete" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'message-media'
    AND (
      (storage.foldername(name))[2] = auth.uid()::text
      OR public.is_admin()
    )
  );


-- ─────────────────────────────────────────────────────────────
-- BUCKET: team-photos  (public read)
-- Path convention: {team_id}/{filename}
-- ─────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "team-photos: public read"    ON storage.objects;
DROP POLICY IF EXISTS "team-photos: member upload"  ON storage.objects;
DROP POLICY IF EXISTS "team-photos: member delete"  ON storage.objects;

CREATE POLICY "team-photos: public read" ON storage.objects
  FOR SELECT USING (bucket_id = 'team-photos');

-- Public team photos are published by the moderation service role only.
CREATE POLICY "team-photos: member upload" ON storage.objects
  FOR INSERT WITH CHECK (false);

CREATE POLICY "team-photos: member delete" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'team-photos'
    AND (
      EXISTS (
        SELECT 1 FROM team_members
         WHERE team_id = ((storage.foldername(name))[1])::uuid
           AND user_id = auth.uid()
      )
      OR public.is_admin()
    )
  );


-- ─────────────────────────────────────────────────────────────
-- Cleanup: delete orphaned score proofs when score is denied
-- ─────────────────────────────────────────────────────────────
-- Stores paths to clean up asynchronously via a background job
-- or the admin dashboard.  Direct storage deletion from a trigger
-- requires pg_net or a Supabase Webhook; we log the paths here
-- and the delete-account Edge Function handles them at account deletion.

CREATE TABLE IF NOT EXISTS storage_cleanup_queue (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket       text        NOT NULL,
  path         text        NOT NULL,
  reason       text,         -- 'score_denied' | 'account_deleted' | 'moderation_flagged'
  created_at   timestamptz DEFAULT now(),
  processed_at timestamptz
);

ALTER TABLE storage_cleanup_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "No direct access storage_cleanup_queue" ON storage_cleanup_queue;
CREATE POLICY "No direct access storage_cleanup_queue" ON storage_cleanup_queue
  FOR ALL USING (false);

-- Trigger: when a score is denied, queue its proof for deletion
CREATE OR REPLACE FUNCTION public.queue_score_proof_cleanup()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'denied'
     AND OLD.status <> 'denied'
     AND NEW.proof_storage_path IS NOT NULL THEN
    INSERT INTO storage_cleanup_queue (bucket, path, reason)
    VALUES ('score-proofs', NEW.proof_storage_path, 'score_denied');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trig_queue_score_proof_cleanup ON scores;
CREATE TRIGGER trig_queue_score_proof_cleanup
  AFTER UPDATE ON scores
  FOR EACH ROW EXECUTE FUNCTION public.queue_score_proof_cleanup();

-- Trigger: when a post is deleted, queue its photo for deletion
CREATE OR REPLACE FUNCTION public.queue_post_photo_cleanup()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.photo_url IS NOT NULL THEN
    -- Extract path from URL (everything after /post-photos/)
    INSERT INTO storage_cleanup_queue (bucket, path, reason)
    VALUES (
      'post-photos',
      regexp_replace(OLD.photo_url, '^.*/post-photos/', ''),
      'post_deleted'
    );
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trig_queue_post_photo_cleanup ON posts;
CREATE TRIGGER trig_queue_post_photo_cleanup
  AFTER DELETE ON posts
  FOR EACH ROW EXECUTE FUNCTION public.queue_post_photo_cleanup();


-- ─────────────────────────────────────────────────────────────
-- RPC: process storage cleanup queue (admin only)
-- Admins call this to flush the cleanup queue.
-- In production this is called by a scheduled Edge Function.
-- ─────────────────────────────────────────────────────────────
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
