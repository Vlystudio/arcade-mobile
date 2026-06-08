-- ============================================================
-- Security Events — structured audit log for security-relevant
-- events that need alerting or dashboard visibility.
--
-- Run BEFORE: qr-token-hardening.sql, venue-role-hardening.sql
-- Run AFTER:  security-hardening.sql
-- Idempotent — safe to re-run.
-- ============================================================

-- ── 1. Table ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS security_events (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type  text        NOT NULL,   -- see event catalogue below
  severity    text        NOT NULL DEFAULT 'info'
              CHECK (severity IN ('info', 'warn', 'critical')),
  user_id     uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  ip_address  text,
  details     jsonb,
  created_at  timestamptz DEFAULT now()
);

-- ── Event type catalogue ──────────────────────────────────────
-- qr_token_invalid         — unrecognised QR token scanned
-- qr_token_expired         — expired QR token scanned
-- qr_token_revoked         — revoked QR token scanned
-- admin_permission_denied  — caller failed admin/venue-admin check
-- moderation_service_down  — AWS/OpenAI unavailable in production
-- rate_limit_hit           — DB-level rate limit exceeded
-- payment_validation_fail  — Square catalog validation rejected item
-- score_submission_spike   — unusually high score submission rate
-- role_escalation_attempt  — user tried to set is_admin/role directly
-- venue_role_granted       — venue admin/owner/staff added
-- venue_role_revoked       — venue admin/owner/staff removed
-- account_deleted          — self-requested account deletion
-- suspicious_login         — multiple failed MFA attempts (future)
-- login_failed               — auth failed login (wrong password / no account)
-- mfa_failed                 — MFA code rejected
-- mfa_disabled               — 2FA removed from account
-- password_reset_requested   — password reset email triggered
-- storage_upload_spike       — >10 uploads in 5 min from same user
-- suspicious_score_spike     — >5 score submissions in 10 min (above rate limit)
-- payment_webhook_invalid_sig — Square webhook received invalid HMAC signature
-- payment_webhook_replay     — duplicate Square event_id (replay attempt)
-- moderation_flagged         — image or text flagged by moderation service

CREATE INDEX IF NOT EXISTS idx_sec_events_type       ON security_events (event_type);
CREATE INDEX IF NOT EXISTS idx_sec_events_severity   ON security_events (severity);
CREATE INDEX IF NOT EXISTS idx_sec_events_user_id    ON security_events (user_id);
CREATE INDEX IF NOT EXISTS idx_sec_events_created_at ON security_events (created_at DESC);

ALTER TABLE security_events ENABLE ROW LEVEL SECURITY;

-- Only platform admins can read security events
DROP POLICY IF EXISTS "Admins read security_events" ON security_events;
CREATE POLICY "Admins read security_events" ON security_events
  FOR SELECT USING (public.is_admin());

-- No direct inserts — all writes via SECURITY DEFINER RPC
DROP POLICY IF EXISTS "No direct write security_events" ON security_events;
CREATE POLICY "No direct write security_events" ON security_events
  FOR ALL USING (false);


-- ── 2. log_security_event() — callable from any RPC ──────────
CREATE OR REPLACE FUNCTION public.log_security_event(
  p_event_type text,
  p_severity   text DEFAULT 'info',
  p_details    jsonb DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO security_events (event_type, severity, user_id, details)
  VALUES (
    p_event_type,
    p_severity,
    auth.uid(),
    p_details
  );
EXCEPTION WHEN OTHERS THEN
  -- Never let audit logging break the calling RPC
  NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.log_security_event(text, text, jsonb) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.log_security_event(text, text, jsonb) TO authenticated;
-- Also grant to anon so unauthenticated invalid QR scans can be logged
GRANT  EXECUTE ON FUNCTION public.log_security_event(text, text, jsonb) TO anon;


-- ── 3. Admin view RPC ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_admin_get_security_events(
  p_severity  text DEFAULT NULL,  -- filter by severity
  p_type      text DEFAULT NULL,  -- filter by event_type prefix
  p_limit     int  DEFAULT 100,
  p_offset    int  DEFAULT 0
)
RETURNS TABLE (
  id         uuid,
  event_type text,
  severity   text,
  user_id    uuid,
  username   text,
  details    jsonb,
  created_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    se.id,
    se.event_type,
    se.severity,
    se.user_id,
    p.username,
    se.details,
    se.created_at
  FROM security_events se
  LEFT JOIN profiles p ON p.id = se.user_id
  WHERE
    public.is_admin()
    AND (p_severity IS NULL OR se.severity = p_severity)
    AND (p_type     IS NULL OR se.event_type LIKE p_type || '%')
  ORDER BY se.created_at DESC
  LIMIT  LEAST(p_limit, 500)
  OFFSET p_offset;
$$;

REVOKE ALL ON FUNCTION public.rpc_admin_get_security_events(text, text, int, int) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.rpc_admin_get_security_events(text, text, int, int) TO authenticated;


-- ── 4. Log rate-limit hits from the DB rate limiter ──────────
-- Enhance check_and_log_rate_limit to record security events
CREATE OR REPLACE FUNCTION public.check_and_log_rate_limit(
  p_action         text,
  p_window_seconds int,
  p_max_count      int
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT COUNT(*) INTO v_count
    FROM rate_limit_log
   WHERE user_id    = auth.uid()
     AND action     = p_action
     AND created_at > now() - (p_window_seconds || ' seconds')::interval;

  IF v_count >= p_max_count THEN
    -- Log to security events
    INSERT INTO security_events (event_type, severity, user_id, details)
    VALUES (
      'rate_limit_hit', 'warn', auth.uid(),
      jsonb_build_object('action', p_action, 'count', v_count, 'max', p_max_count)
    );
    RAISE EXCEPTION 'Rate limit exceeded — too many % actions. Try again later.', p_action
      USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO rate_limit_log (user_id, action)
  VALUES (auth.uid(), p_action);

  IF random() < 0.01 THEN
    DELETE FROM rate_limit_log WHERE created_at < now() - interval '24 hours';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.check_and_log_rate_limit(text, int, int) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.check_and_log_rate_limit(text, int, int) TO authenticated;


-- ── 5. Log role-escalation attempts ──────────────────────────
CREATE OR REPLACE FUNCTION public.guard_role_escalation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    IF NEW.is_admin IS DISTINCT FROM OLD.is_admin THEN
      INSERT INTO security_events (event_type, severity, user_id, details)
      VALUES ('role_escalation_attempt', 'critical', auth.uid(),
        jsonb_build_object('field', 'is_admin', 'target_id', OLD.id));
      RAISE EXCEPTION 'Not authorized to change is_admin';
    END IF;
    IF NEW.is_arcade_official IS DISTINCT FROM OLD.is_arcade_official THEN
      INSERT INTO security_events (event_type, severity, user_id, details)
      VALUES ('role_escalation_attempt', 'warn', auth.uid(),
        jsonb_build_object('field', 'is_arcade_official', 'target_id', OLD.id));
      RAISE EXCEPTION 'Not authorized to change is_arcade_official';
    END IF;
    IF TG_TABLE_NAME = 'profiles' AND
       NEW::jsonb ? 'role' AND
       (NEW::jsonb->>'role') IS DISTINCT FROM (OLD::jsonb->>'role') THEN
      INSERT INTO security_events (event_type, severity, user_id, details)
      VALUES ('role_escalation_attempt', 'critical', auth.uid(),
        jsonb_build_object('field', 'role', 'target_id', OLD.id,
                           'attempted_role', NEW::jsonb->>'role'));
      RAISE EXCEPTION 'Not authorized to change role';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_role_escalation_trigger ON profiles;
CREATE TRIGGER guard_role_escalation_trigger
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_role_escalation();


-- ── 6. Log payment webhook security events ────────────────────
-- Called from api/square/webhook.ts via supabase.rpc()
-- when signature validation fails or a replay is detected.
CREATE OR REPLACE FUNCTION public.log_payment_security_event(
  p_event_type text,
  p_details    jsonb DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO security_events (event_type, severity, details)
  VALUES (
    p_event_type,
    CASE p_event_type
      WHEN 'payment_webhook_invalid_sig' THEN 'critical'
      WHEN 'payment_webhook_replay'      THEN 'warn'
      ELSE 'warn'
    END,
    p_details
  );
EXCEPTION WHEN OTHERS THEN
  NULL;
END;
$$;

-- This function is called by the server-side API route (service role), not by users.
-- Do NOT grant to authenticated or anon.
REVOKE ALL ON FUNCTION public.log_payment_security_event(text, jsonb) FROM PUBLIC;
