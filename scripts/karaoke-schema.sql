-- ============================================================
-- Karaoke Queue Schema
-- Run in Supabase SQL Editor
-- ============================================================

CREATE TABLE IF NOT EXISTS public.karaoke_queue (
  id              uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  video_id        text        NOT NULL,
  title           text        NOT NULL,
  channel         text        NOT NULL DEFAULT '',
  thumbnail_url   text,
  requested_by    uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  requester_name  text        NOT NULL DEFAULT 'Guest',
  status          text        NOT NULL DEFAULT 'queued'
                                CHECK (status IN ('queued', 'playing', 'played', 'skipped')),
  created_at      timestamptz DEFAULT now()
);

-- Enable Realtime for live queue updates (idempotent — ALTER PUBLICATION ADD
-- TABLE errors if the table is already a member, so guard with a check)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND schemaname = 'public'
       AND tablename = 'karaoke_queue'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.karaoke_queue;
  END IF;
END;
$$;

-- RLS
ALTER TABLE public.karaoke_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "karaoke_select"       ON public.karaoke_queue;
DROP POLICY IF EXISTS "karaoke_insert_auth"  ON public.karaoke_queue;
DROP POLICY IF EXISTS "karaoke_insert_anon"  ON public.karaoke_queue;

-- Anyone (guest or logged-in) can view the queue
CREATE POLICY "karaoke_select" ON public.karaoke_queue
  FOR SELECT USING (true);

-- Authenticated users can add songs (their own row)
CREATE POLICY "karaoke_insert_auth" ON public.karaoke_queue
  FOR INSERT TO authenticated
  WITH CHECK (requested_by = auth.uid());

-- Unauthenticated guests can add songs (requested_by must be NULL)
CREATE POLICY "karaoke_insert_anon" ON public.karaoke_queue
  FOR INSERT TO anon
  WITH CHECK (requested_by IS NULL);

-- ── rpc_karaoke_next ──────────────────────────────────────────
-- Advances the queue. Pass p_current_id to mark it as played.
-- Returns the now-playing song, or {empty: true} when queue is empty.
-- No auth required — called from the venue display kiosk.
CREATE OR REPLACE FUNCTION public.rpc_karaoke_next(
  p_current_id uuid DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_next record;
BEGIN
  -- Mark the current song as played
  IF p_current_id IS NOT NULL THEN
    UPDATE karaoke_queue
       SET status = 'played'
     WHERE id = p_current_id
       AND status IN ('playing', 'queued');
  END IF;

  -- Return any song already marked playing (idempotent restart safety)
  SELECT id, video_id, title, channel, thumbnail_url, requester_name
    INTO v_next
    FROM karaoke_queue
   WHERE status = 'playing'
   LIMIT 1;

  IF NOT FOUND THEN
    -- Pick the next queued song (FIFO)
    SELECT id, video_id, title, channel, thumbnail_url, requester_name
      INTO v_next
      FROM karaoke_queue
     WHERE status = 'queued'
     ORDER BY created_at ASC
     LIMIT 1;

    IF NOT FOUND THEN
      RETURN json_build_object('ok', true, 'empty', true);
    END IF;

    UPDATE karaoke_queue SET status = 'playing' WHERE id = v_next.id;
  END IF;

  RETURN json_build_object(
    'ok',            true,
    'empty',         false,
    'id',            v_next.id,
    'video_id',      v_next.video_id,
    'title',         v_next.title,
    'channel',       v_next.channel,
    'thumbnail_url', v_next.thumbnail_url,
    'requester_name', v_next.requester_name
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_karaoke_next(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_karaoke_next(uuid) TO authenticated, anon;

-- ── rpc_karaoke_skip ─────────────────────────────────────────
-- Admin: skip a queued or playing song.
-- karaoke_queue is a single platform-wide queue (no venue_id) —
-- platform-admin-only.
CREATE OR REPLACE FUNCTION public.rpc_karaoke_skip(p_song_id uuid)
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
      jsonb_build_object('rpc', 'rpc_karaoke_skip', 'song_id', p_song_id))
    ON CONFLICT DO NOTHING;
    RETURN json_build_object('error', 'unauthorized');
  END IF;

  UPDATE karaoke_queue SET status = 'skipped' WHERE id = p_song_id;
  IF NOT FOUND THEN
    RETURN json_build_object('error', 'not_found');
  END IF;

  INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'karaoke_skip', 'karaoke_queue', p_song_id::text, '{}');

  RETURN json_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_karaoke_skip(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_karaoke_skip(uuid) TO authenticated;

-- ── rpc_karaoke_remove ───────────────────────────────────────
-- Admin: hard-delete a song from the queue. Platform-admin-only (see above).
CREATE OR REPLACE FUNCTION public.rpc_karaoke_remove(p_song_id uuid)
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
      jsonb_build_object('rpc', 'rpc_karaoke_remove', 'song_id', p_song_id))
    ON CONFLICT DO NOTHING;
    RETURN json_build_object('error', 'unauthorized');
  END IF;

  DELETE FROM karaoke_queue WHERE id = p_song_id;

  INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'karaoke_remove', 'karaoke_queue', p_song_id::text, '{}');

  RETURN json_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_karaoke_remove(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_karaoke_remove(uuid) TO authenticated;

-- ── rpc_karaoke_clear_history ────────────────────────────────
-- Admin: remove all played / skipped entries. Platform-admin-only (see above).
CREATE OR REPLACE FUNCTION public.rpc_karaoke_clear_history()
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
      jsonb_build_object('rpc', 'rpc_karaoke_clear_history'))
    ON CONFLICT DO NOTHING;
    RETURN json_build_object('error', 'unauthorized');
  END IF;

  DELETE FROM karaoke_queue WHERE status IN ('played', 'skipped');

  INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'karaoke_clear_history', 'karaoke_queue', NULL, '{}');

  RETURN json_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_karaoke_clear_history() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_karaoke_clear_history() TO authenticated;
