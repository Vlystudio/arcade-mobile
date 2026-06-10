-- ============================================================
-- Support, Feedback & Terms Acceptance
--
-- Creates:
--   • profiles.tos_accepted_version column
--   • feedback_submissions table
--   • support_tickets table
--   • support_messages table
--
-- Run AFTER: security-hardening.sql, security-hardening-2.sql
-- Idempotent — safe to re-run.
-- ============================================================

-- ── 1. ToS version tracking on profiles ───────────────────────
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS tos_accepted_version text;

-- RPC: user accepts current ToS version
CREATE OR REPLACE FUNCTION public.rpc_accept_tos(p_version text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN json_build_object('error', 'not_authenticated');
  END IF;

  UPDATE profiles
     SET tos_accepted_version = p_version
   WHERE id = auth.uid();

  RETURN json_build_object('ok', true, 'version', p_version);
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_accept_tos(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.rpc_accept_tos(text) TO authenticated;


-- ── 2. Feedback submissions ────────────────────────────────────
CREATE TABLE IF NOT EXISTS feedback_submissions (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  category    text        NOT NULL
              CHECK (category IN ('bug', 'feature', 'general', 'other')),
  rating      int         CHECK (rating >= 1 AND rating <= 5),
  message     text        NOT NULL,
  app_version text,
  status      text        NOT NULL DEFAULT 'new'
              CHECK (status IN ('new', 'reviewed', 'resolved')),
  created_at  timestamptz DEFAULT now()
);

ALTER TABLE feedback_submissions ENABLE ROW LEVEL SECURITY;

-- Users can submit feedback; admins can read all
DROP POLICY IF EXISTS "Users submit feedback" ON feedback_submissions;
CREATE POLICY "Users submit feedback" ON feedback_submissions
  FOR INSERT WITH CHECK (
    auth.uid() IS NOT NULL
    AND user_id = auth.uid()
  );

DROP POLICY IF EXISTS "Admins read feedback" ON feedback_submissions;
CREATE POLICY "Admins read feedback" ON feedback_submissions
  FOR SELECT USING (public.is_admin());

DROP POLICY IF EXISTS "Admins update feedback status" ON feedback_submissions;
CREATE POLICY "Admins update feedback status" ON feedback_submissions
  FOR UPDATE USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- RPC: submit feedback
CREATE OR REPLACE FUNCTION public.rpc_submit_feedback(
  p_category    text,
  p_message     text,
  p_rating      int DEFAULT NULL,
  p_app_version text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN json_build_object('error', 'not_authenticated');
  END IF;

  IF p_category NOT IN ('bug', 'feature', 'general', 'other') THEN
    RETURN json_build_object('error', 'invalid_category');
  END IF;

  IF length(trim(p_message)) < 10 THEN
    RETURN json_build_object('error', 'message_too_short',
      'message', 'Please provide at least 10 characters of feedback.');
  END IF;

  IF length(p_message) > 2000 THEN
    RETURN json_build_object('error', 'message_too_long',
      'message', 'Feedback must be under 2000 characters.');
  END IF;

  INSERT INTO feedback_submissions (user_id, category, rating, message, app_version)
  VALUES (auth.uid(), p_category, p_rating, trim(p_message), p_app_version);

  RETURN json_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_submit_feedback(text, text, int, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.rpc_submit_feedback(text, text, int, text) TO authenticated;


-- ── 3. Support tickets ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS support_tickets (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status      text        NOT NULL DEFAULT 'open'
              CHECK (status IN ('open', 'resolved', 'closed')),
  email_sent  boolean     NOT NULL DEFAULT false,
  resolved_at timestamptz,
  resolved_by uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_support_tickets_user    ON support_tickets (user_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_status  ON support_tickets (status);

ALTER TABLE support_tickets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "User reads own ticket" ON support_tickets;
CREATE POLICY "User reads own ticket" ON support_tickets
  FOR SELECT USING (
    user_id = auth.uid()
    OR public.is_admin()
    OR EXISTS (
      SELECT 1 FROM profiles
       WHERE id = auth.uid()
         AND role IN ('owner', 'architect')
    )
  );

DROP POLICY IF EXISTS "System creates ticket" ON support_tickets;
CREATE POLICY "System creates ticket" ON support_tickets
  FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Admin updates ticket" ON support_tickets;
CREATE POLICY "Admin updates ticket" ON support_tickets
  FOR UPDATE USING (
    public.is_admin()
    OR EXISTS (
      SELECT 1 FROM profiles
       WHERE id = auth.uid()
         AND role IN ('owner', 'architect')
    )
  );


-- ── 4. Support messages ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS support_messages (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id       uuid        NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  sender_id       uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content         text        NOT NULL,
  is_admin_msg    boolean     NOT NULL DEFAULT false,
  is_read         boolean     NOT NULL DEFAULT false,
  created_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_support_msgs_ticket ON support_messages (ticket_id, created_at);

ALTER TABLE support_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read support messages" ON support_messages;
CREATE POLICY "Read support messages" ON support_messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM support_tickets
       WHERE id = ticket_id
         AND user_id = auth.uid()
    )
    OR public.is_admin()
    OR EXISTS (
      SELECT 1 FROM profiles
       WHERE id = auth.uid()
         AND role IN ('owner', 'architect')
    )
  );

DROP POLICY IF EXISTS "Insert support message" ON support_messages;
CREATE POLICY "Insert support message" ON support_messages
  FOR INSERT WITH CHECK (
    sender_id = auth.uid()
    AND (
      EXISTS (
        SELECT 1 FROM support_tickets
         WHERE id = ticket_id
           AND user_id = auth.uid()
      )
      OR public.is_admin()
      OR EXISTS (
        SELECT 1 FROM profiles
         WHERE id = auth.uid()
           AND role IN ('owner', 'architect')
      )
    )
  );


-- ── 5. RPC: send support message ──────────────────────────────
-- Creates a ticket if the user has no open one.
-- Returns { ticket_id, admin_online: bool, message_id }
CREATE OR REPLACE FUNCTION public.rpc_send_support_message(p_content text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id   uuid;
  v_ticket_id uuid;
  v_msg_id    uuid;
  v_admin_online boolean;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN json_build_object('error', 'not_authenticated');
  END IF;

  IF length(trim(p_content)) < 1 THEN
    RETURN json_build_object('error', 'empty_message');
  END IF;

  IF length(p_content) > 4000 THEN
    RETURN json_build_object('error', 'message_too_long');
  END IF;

  -- Get or create an open ticket for this user
  SELECT id INTO v_ticket_id
    FROM support_tickets
   WHERE user_id = v_user_id
     AND status = 'open'
   ORDER BY created_at DESC
   LIMIT 1;

  IF NOT FOUND THEN
    INSERT INTO support_tickets (user_id)
    VALUES (v_user_id)
    RETURNING id INTO v_ticket_id;
  END IF;

  -- Insert the message
  INSERT INTO support_messages (ticket_id, sender_id, content, is_admin_msg)
  VALUES (v_ticket_id, v_user_id, trim(p_content), false)
  RETURNING id INTO v_msg_id;

  -- Check if any staff is online
  SELECT EXISTS (
    SELECT 1 FROM profiles
     WHERE online_status = 'online'
       AND (
         is_admin = true
         OR role IN ('owner', 'architect')
       )
  ) INTO v_admin_online;

  RETURN json_build_object(
    'ok',           true,
    'ticket_id',    v_ticket_id,
    'message_id',   v_msg_id,
    'admin_online', v_admin_online
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_send_support_message(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.rpc_send_support_message(text) TO authenticated;


-- ── 6. RPC: admin reply to support ticket ─────────────────────
CREATE OR REPLACE FUNCTION public.rpc_admin_reply_support(
  p_ticket_id uuid,
  p_content   text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN json_build_object('error', 'not_authenticated');
  END IF;

  PERFORM public.require_mfa();

  -- Only admins, owners, and architects can reply
  IF NOT (
    public.is_admin()
    OR EXISTS (SELECT 1 FROM profiles WHERE id = v_uid AND role IN ('owner', 'architect'))
  ) THEN
    INSERT INTO security_events (event_type, severity, user_id, details)
    VALUES ('admin_access_denied', 'warn', v_uid,
      jsonb_build_object('rpc', 'rpc_admin_reply_support', 'ticket_id', p_ticket_id))
    ON CONFLICT DO NOTHING;
    RETURN json_build_object('error', 'unauthorized');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM support_tickets WHERE id = p_ticket_id) THEN
    RETURN json_build_object('error', 'ticket_not_found');
  END IF;

  INSERT INTO support_messages (ticket_id, sender_id, content, is_admin_msg)
  VALUES (p_ticket_id, v_uid, trim(p_content), true);

  -- Re-open ticket if it was resolved
  UPDATE support_tickets
     SET status = 'open'
   WHERE id = p_ticket_id
     AND status != 'open';

  INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (v_uid, 'support_reply', 'support_ticket', p_ticket_id::text, '{}');

  RETURN json_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_admin_reply_support(uuid, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.rpc_admin_reply_support(uuid, text) TO authenticated;


-- ── 7. RPC: close support ticket ──────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_resolve_support_ticket(p_ticket_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN json_build_object('error', 'not_authenticated');
  END IF;

  -- Owner of ticket or staff can resolve
  IF NOT (
    EXISTS (SELECT 1 FROM support_tickets WHERE id = p_ticket_id AND user_id = v_uid)
    OR public.is_admin()
    OR EXISTS (SELECT 1 FROM profiles WHERE id = v_uid AND role IN ('owner', 'architect'))
  ) THEN
    RETURN json_build_object('error', 'unauthorized');
  END IF;

  UPDATE support_tickets
     SET status = 'resolved',
         resolved_at = now(),
         resolved_by = v_uid
   WHERE id = p_ticket_id;

  RETURN json_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_resolve_support_ticket(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.rpc_resolve_support_ticket(uuid) TO authenticated;
