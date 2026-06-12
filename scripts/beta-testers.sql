-- ============================================================
-- Beta Tester Program
--
--   1. profiles.is_beta_tester — separate flag (does not touch the
--      role ladder), self-assignment blocked by guard_role_escalation.
--   2. Admins toggle it via rpc_admin_set_beta_tester (MFA + audit).
--   3. beta_reports — structured QA reports (category, severity, steps
--      to reproduce, auto-captured device/app context, screenshot),
--      submit/list RPCs gated to beta testers, admin triage RPCs with
--      status workflow (open → triaged/in_progress → fixed/wont_fix/duplicate).
--
-- Run AFTER: security-hardening.sql, content-moderation.sql,
--            rate-limit-log-fix.sql
-- Idempotent — safe to re-run.
-- ============================================================


-- ── 1. Flag column ───────────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_beta_tester boolean NOT NULL DEFAULT false;


-- ── 2. Extend the role-escalation guard ──────────────────────
-- Supersedes the definition in security-hardening.sql (P9) by adding the
-- is_beta_tester check. Keep the two in sync if the base logic changes.
CREATE OR REPLACE FUNCTION public.guard_role_escalation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    IF NEW.is_admin IS DISTINCT FROM OLD.is_admin THEN
      RAISE EXCEPTION 'Not authorized to change is_admin';
    END IF;
    IF NEW.is_arcade_official IS DISTINCT FROM OLD.is_arcade_official THEN
      RAISE EXCEPTION 'Not authorized to change is_arcade_official';
    END IF;
    IF TG_TABLE_NAME = 'profiles' AND
       to_jsonb(NEW) ? 'is_beta_tester' AND
       (to_jsonb(NEW)->>'is_beta_tester') IS DISTINCT FROM (to_jsonb(OLD)->>'is_beta_tester') THEN
      RAISE EXCEPTION 'Not authorized to change is_beta_tester';
    END IF;
    -- Guard the role column if it exists on profiles
    IF TG_TABLE_NAME = 'profiles' AND
       to_jsonb(NEW) ? 'role' AND
       (to_jsonb(NEW)->>'role') IS DISTINCT FROM (to_jsonb(OLD)->>'role') THEN
      RAISE EXCEPTION 'Not authorized to change role';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;


-- ── 3. Admin RPC: grant/revoke the beta tester badge ─────────
CREATE OR REPLACE FUNCTION public.rpc_admin_set_beta_tester(
  p_user_id uuid,
  p_enabled boolean
)
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
      jsonb_build_object('rpc', 'rpc_admin_set_beta_tester'))
    ON CONFLICT DO NOTHING;
    RETURN json_build_object('error', 'unauthorized');
  END IF;

  UPDATE profiles SET is_beta_tester = p_enabled WHERE id = p_user_id;
  IF NOT FOUND THEN RETURN json_build_object('error', 'not_found'); END IF;

  INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'set_beta_tester', 'user', p_user_id::text,
          jsonb_build_object('enabled', p_enabled));

  RETURN json_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_admin_set_beta_tester(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_admin_set_beta_tester(uuid, boolean) TO authenticated;


-- ── 4. Beta reports table ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.beta_reports (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  category    text NOT NULL CHECK (category IN
                ('bug', 'glitch', 'visual', 'performance', 'crash', 'site_breaking', 'suggestion')),
  severity    text NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  title       text NOT NULL CHECK (length(title) BETWEEN 3 AND 120),
  description text NOT NULL CHECK (length(description) BETWEEN 3 AND 4000),
  steps       text CHECK (steps IS NULL OR length(steps) <= 4000),
  route       text,
  platform    text,
  app_version text,
  device_info text,
  screenshot_url text,
  status      text NOT NULL DEFAULT 'open' CHECK (status IN
                ('open', 'triaged', 'in_progress', 'fixed', 'wont_fix', 'duplicate')),
  admin_note  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_beta_reports_status ON public.beta_reports (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_beta_reports_user   ON public.beta_reports (user_id, created_at DESC);

ALTER TABLE public.beta_reports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "beta_reports_own_read" ON public.beta_reports;
CREATE POLICY "beta_reports_own_read" ON public.beta_reports
  FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_admin());
-- all writes via SECURITY DEFINER RPCs


-- ── 5. RPC: submit a beta report ─────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_beta_submit_report(
  p_category    text,
  p_severity    text,
  p_title       text,
  p_description text,
  p_steps       text DEFAULT NULL,
  p_route       text DEFAULT NULL,
  p_platform    text DEFAULT NULL,
  p_app_version text DEFAULT NULL,
  p_device_info text DEFAULT NULL,
  p_screenshot_url text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_id  uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN json_build_object('error', 'not_authenticated');
  END IF;
  IF NOT COALESCE((SELECT is_beta_tester FROM profiles WHERE id = v_uid), false) THEN
    RETURN json_build_object('error', 'not_beta_tester',
      'message', 'The enhanced feedback tool is for beta testers. Ask an admin for access.');
  END IF;
  IF p_category NOT IN ('bug','glitch','visual','performance','crash','site_breaking','suggestion')
     OR p_severity NOT IN ('low','medium','high','critical') THEN
    RETURN json_build_object('error', 'invalid', 'message', 'Invalid category or severity.');
  END IF;
  IF length(trim(COALESCE(p_title, ''))) < 3 OR length(trim(COALESCE(p_description, ''))) < 3 THEN
    RETURN json_build_object('error', 'invalid',
      'message', 'Give the report a short title and describe what happened.');
  END IF;

  -- generous limit — beta testers reporting a lot is the whole point
  BEGIN
    PERFORM public.check_and_log_rate_limit('beta_report', 3600, 30);
  EXCEPTION WHEN OTHERS THEN
    RETURN json_build_object('error', 'rate_limited',
      'message', 'That''s a lot of reports in an hour — take a breather and try again soon.');
  END;

  INSERT INTO beta_reports
    (user_id, category, severity, title, description, steps,
     route, platform, app_version, device_info, screenshot_url)
  VALUES
    (v_uid, p_category, p_severity, left(trim(p_title), 120), left(trim(p_description), 4000),
     NULLIF(left(trim(COALESCE(p_steps, '')), 4000), ''),
     left(p_route, 200), left(p_platform, 40), left(p_app_version, 60),
     left(p_device_info, 200), p_screenshot_url)
  RETURNING id INTO v_id;

  RETURN json_build_object('ok', true, 'id', v_id);
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_beta_submit_report(text, text, text, text, text, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_beta_submit_report(text, text, text, text, text, text, text, text, text, text) TO authenticated;


-- ── 6. Admin RPCs: triage ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_admin_get_beta_reports(p_status text DEFAULT NULL)
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
      jsonb_build_object('rpc', 'rpc_admin_get_beta_reports'))
    ON CONFLICT DO NOTHING;
    RETURN json_build_object('error', 'unauthorized');
  END IF;

  RETURN (
    SELECT COALESCE(json_agg(row_to_json(q)), '[]'::json)
    FROM (
      SELECT br.*, p.username
        FROM beta_reports br
        LEFT JOIN profiles p ON p.id = br.user_id
       WHERE p_status IS NULL OR br.status = p_status
       ORDER BY
         CASE br.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
         br.created_at DESC
       LIMIT 200
    ) q
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_admin_update_beta_report(
  p_id         uuid,
  p_status     text,
  p_admin_note text DEFAULT NULL
)
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
      jsonb_build_object('rpc', 'rpc_admin_update_beta_report'))
    ON CONFLICT DO NOTHING;
    RETURN json_build_object('error', 'unauthorized');
  END IF;
  IF p_status NOT IN ('open','triaged','in_progress','fixed','wont_fix','duplicate') THEN
    RETURN json_build_object('error', 'invalid_status');
  END IF;

  UPDATE beta_reports
     SET status = p_status,
         admin_note = COALESCE(left(p_admin_note, 1000), admin_note),
         updated_at = now()
   WHERE id = p_id;
  IF NOT FOUND THEN RETURN json_build_object('error', 'not_found'); END IF;

  INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'beta_report_update', 'beta_report', p_id::text,
          jsonb_build_object('status', p_status));

  RETURN json_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_admin_get_beta_reports(text)                  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_admin_update_beta_report(uuid, text, text)    FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_admin_get_beta_reports(text)               TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_update_beta_report(uuid, text, text) TO authenticated;


-- ── 7. Expose the flag to the users-admin list ───────────────
-- (rpc_admin_get_users gains is_beta_tester; replaces admin-get-users.sql
--  definition — keep in sync.)
DROP FUNCTION IF EXISTS public.rpc_admin_get_users();
CREATE OR REPLACE FUNCTION public.rpc_admin_get_users()
RETURNS TABLE (
  id             uuid,
  username       text,
  avatar_url     text,
  role           text,
  email          text,
  is_beta_tester boolean
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.require_mfa();

  IF NOT public.is_admin() THEN
    INSERT INTO security_events (event_type, severity, user_id, details)
    VALUES ('admin_access_denied', 'warn', auth.uid(),
      jsonb_build_object('rpc', 'rpc_admin_get_users'))
    ON CONFLICT DO NOTHING;
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
  SELECT
    au.id,
    p.username,
    p.avatar_url,
    COALESCE(p.role, 'user') AS role,
    au.email::text,
    COALESCE(p.is_beta_tester, false) AS is_beta_tester
  FROM auth.users au
  LEFT JOIN public.profiles p ON p.id = au.id
  ORDER BY LOWER(COALESCE(p.username, au.email, ''));
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_admin_get_users() TO authenticated;
