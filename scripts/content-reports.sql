-- ============================================================
-- Content reporting (user-facing "report/flag" feature)
-- Run after rls-policies.sql, security-hardening-2.sql
-- (require_mfa must exist), and seed-admin-policies.sql
-- (is_admin must exist).
--
-- Lets users flag posts and comments as: inappropriate_picture,
-- inappropriate_text, racism, violence, nudity, or other.
-- Reviewed by arcade officials/admins via SECURITY DEFINER RPCs
-- following the same conventions as rpc-admin-actions.sql:
--   1. PERFORM public.require_mfa()
--   2. Verify caller via is_arcade_official()
--   3. On denial  → INSERT INTO security_events
--   4. On success → INSERT INTO admin_audit_log
-- ============================================================

CREATE TABLE IF NOT EXISTS content_reports (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id  uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  content_type text NOT NULL CHECK (content_type IN ('post', 'comment')),
  content_id   uuid NOT NULL,
  post_id      uuid REFERENCES posts(id) ON DELETE CASCADE,
  reason       text NOT NULL CHECK (reason IN (
    'inappropriate_picture', 'inappropriate_text', 'racism', 'violence', 'nudity', 'other'
  )),
  details      text CHECK (details IS NULL OR char_length(details) <= 500),
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'dismissed', 'actioned'
  )),
  reviewed_by  uuid REFERENCES profiles(id),
  reviewed_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (reporter_id, content_type, content_id)
);

CREATE INDEX IF NOT EXISTS idx_content_reports_status ON content_reports (status, created_at);
CREATE INDEX IF NOT EXISTS idx_content_reports_post_id ON content_reports (post_id);

ALTER TABLE content_reports ENABLE ROW LEVEL SECURITY;

-- Users can see their own report history (e.g. "you've already reported this").
-- All inserts/updates go through the SECURITY DEFINER RPCs below.
DROP POLICY IF EXISTS "Users can view own reports" ON content_reports;
CREATE POLICY "Users can view own reports" ON content_reports
  FOR SELECT USING (auth.uid() = reporter_id);


-- ── rpc_report_content ──────────────────────────────────────
-- User-facing: file or update a report against a post/comment.
CREATE OR REPLACE FUNCTION public.rpc_report_content(
  p_content_type text,
  p_content_id   uuid,
  p_reason       text,
  p_details      text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_post_id  uuid;
  v_owner_id uuid;
  v_details  text;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN json_build_object('error', 'not_authenticated');
  END IF;

  IF p_content_type NOT IN ('post', 'comment') THEN
    RETURN json_build_object('error', 'invalid_content_type');
  END IF;

  IF p_reason NOT IN ('inappropriate_picture', 'inappropriate_text', 'racism', 'violence', 'nudity', 'other') THEN
    RETURN json_build_object('error', 'invalid_reason');
  END IF;

  v_details := NULLIF(TRIM(LEFT(COALESCE(p_details, ''), 500)), '');

  IF p_content_type = 'post' THEN
    SELECT id, user_id INTO v_post_id, v_owner_id FROM posts WHERE id = p_content_id;
  ELSE
    SELECT post_id, user_id INTO v_post_id, v_owner_id FROM post_comments WHERE id = p_content_id;
  END IF;

  IF v_post_id IS NULL THEN
    RETURN json_build_object('error', 'not_found');
  END IF;

  IF v_owner_id = auth.uid() THEN
    RETURN json_build_object('error', 'cannot_report_own_content');
  END IF;

  INSERT INTO content_reports (reporter_id, content_type, content_id, post_id, reason, details)
  VALUES (auth.uid(), p_content_type, p_content_id, v_post_id, p_reason, v_details)
  ON CONFLICT (reporter_id, content_type, content_id)
  DO UPDATE SET
    reason      = EXCLUDED.reason,
    details     = EXCLUDED.details,
    status      = 'pending',
    reviewed_by = NULL,
    reviewed_at = NULL,
    created_at  = now();

  RETURN json_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_report_content(text, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_report_content(text, uuid, text, text) TO authenticated;


-- ── rpc_admin_get_content_reports ───────────────────────────
-- Admin/official review queue.
CREATE OR REPLACE FUNCTION public.rpc_admin_get_content_reports(
  p_status text DEFAULT 'pending'
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.require_mfa();

  IF NOT public.is_arcade_official() THEN
    INSERT INTO security_events (event_type, severity, user_id, details)
    VALUES ('admin_access_denied', 'warn', auth.uid(),
      jsonb_build_object('rpc', 'rpc_admin_get_content_reports'))
    ON CONFLICT DO NOTHING;
    RETURN json_build_object('error', 'unauthorized');
  END IF;

  IF p_status NOT IN ('pending', 'dismissed', 'actioned') THEN
    RETURN json_build_object('error', 'invalid_status');
  END IF;

  RETURN (
    SELECT COALESCE(json_agg(row_to_json(q)), '[]'::json)
    FROM (
      SELECT
        cr.id,
        cr.content_type,
        cr.content_id,
        cr.post_id,
        cr.reason,
        cr.details,
        cr.status,
        cr.created_at,
        reporter.username   AS reporter_username,
        owner.id            AS post_owner_id,
        owner.username      AS post_owner_username,
        p.content           AS post_content,
        p.photo_url         AS post_photo_url,
        c.content           AS comment_content
      FROM content_reports cr
      LEFT JOIN profiles reporter ON reporter.id = cr.reporter_id
      LEFT JOIN posts p ON p.id = cr.post_id
      LEFT JOIN profiles owner ON owner.id = p.user_id
      LEFT JOIN post_comments c ON c.id = cr.content_id AND cr.content_type = 'comment'
      WHERE cr.status = p_status
      ORDER BY cr.created_at ASC
      LIMIT 200
    ) q
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_admin_get_content_reports(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_admin_get_content_reports(text) TO authenticated;


-- ── rpc_admin_resolve_content_report ────────────────────────
-- p_action: 'dismiss' (no action), 'remove_content' (delete the
-- post/comment and auto-resolve other pending reports against it),
-- or 'mark_actioned' (record that action was taken elsewhere,
-- e.g. the user was warned, without deleting the content).
CREATE OR REPLACE FUNCTION public.rpc_admin_resolve_content_report(
  p_report_id uuid,
  p_action    text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_report content_reports%ROWTYPE;
  v_new_status text;
BEGIN
  PERFORM public.require_mfa();

  IF NOT public.is_arcade_official() THEN
    INSERT INTO security_events (event_type, severity, user_id, details)
    VALUES ('admin_access_denied', 'warn', auth.uid(),
      jsonb_build_object('rpc', 'rpc_admin_resolve_content_report', 'report_id', p_report_id))
    ON CONFLICT DO NOTHING;
    RETURN json_build_object('error', 'unauthorized');
  END IF;

  IF p_action NOT IN ('dismiss', 'remove_content', 'mark_actioned') THEN
    RETURN json_build_object('error', 'invalid_action');
  END IF;

  SELECT * INTO v_report FROM content_reports WHERE id = p_report_id;
  IF v_report.id IS NULL THEN
    RETURN json_build_object('error', 'not_found');
  END IF;

  IF p_action = 'remove_content' THEN
    IF v_report.content_type = 'post' THEN
      DELETE FROM posts WHERE id = v_report.content_id;
    ELSE
      DELETE FROM post_comments WHERE id = v_report.content_id;
    END IF;
    v_new_status := 'actioned';
  ELSIF p_action = 'mark_actioned' THEN
    v_new_status := 'actioned';
  ELSE
    v_new_status := 'dismissed';
  END IF;

  UPDATE content_reports
  SET status = v_new_status, reviewed_by = auth.uid(), reviewed_at = now()
  WHERE id = p_report_id;

  IF p_action = 'remove_content' THEN
    UPDATE content_reports
    SET status = 'actioned', reviewed_by = auth.uid(), reviewed_at = now()
    WHERE content_type = v_report.content_type
      AND content_id = v_report.content_id
      AND status = 'pending';
  END IF;

  INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'content_report_resolved', v_report.content_type, v_report.content_id::text,
          jsonb_build_object('report_id', p_report_id, 'action', p_action));

  RETURN json_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_admin_resolve_content_report(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_admin_resolve_content_report(uuid, text) TO authenticated;
