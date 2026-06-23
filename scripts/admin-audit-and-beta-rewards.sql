-- ============================================================
-- Owner/Architect admin tools:
--   rpc_admin_get_audit_log     — read the admin action log + security events
--   rpc_admin_grant_title_to_beta — grant a title to the whole beta cohort
--
-- Both gated to owner/architect (is_owner_or_architect). The grant also
-- requires MFA and is itself audit-logged. Idempotent.
-- ============================================================

-- ── Audit-log viewer (read-only; owner/architect) ──
CREATE OR REPLACE FUNCTION public.rpc_admin_get_audit_log(p_limit int DEFAULT 80)
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_limit int := least(greatest(coalesce(p_limit, 80), 1), 200);
BEGIN
  IF NOT public.is_owner_or_architect() THEN
    RETURN json_build_object('error','unauthorized');
  END IF;

  RETURN json_build_object(
    'actions', (
      SELECT COALESCE(json_agg(row_to_json(a) ORDER BY a.created_at DESC), '[]'::json)
      FROM (
        SELECT al.created_at, al.action, al.target_type, al.target_id, al.details,
               p.username AS admin_username
          FROM admin_audit_log al
          LEFT JOIN profiles p ON p.id = al.admin_id
         ORDER BY al.created_at DESC
         LIMIT v_limit
      ) a
    ),
    'events', (
      SELECT COALESCE(json_agg(row_to_json(e) ORDER BY e.created_at DESC), '[]'::json)
      FROM (
        SELECT se.created_at, se.event_type, se.severity, se.details,
               p.username AS username
          FROM security_events se
          LEFT JOIN profiles p ON p.id = se.user_id
         ORDER BY se.created_at DESC
         LIMIT v_limit
      ) e
    )
  );
END; $$;
REVOKE ALL ON FUNCTION public.rpc_admin_get_audit_log(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_admin_get_audit_log(int) TO authenticated;


-- ── Grant a title to every beta-cohort member (owner/architect + MFA) ──
-- The beta cohort is everyone holding the stored 'beta_founder' grant. Use
-- this to hand out the eventual beta-tester rewards. The title must exist in
-- the catalog (all_title_keys) so it renders.
CREATE OR REPLACE FUNCTION public.rpc_admin_grant_title_to_beta(p_title_key text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_granted int;
BEGIN
  PERFORM public.require_mfa();
  IF NOT public.is_owner_or_architect() THEN
    INSERT INTO security_events (event_type, severity, user_id, details)
    VALUES ('admin_access_denied','warn',auth.uid(),
      jsonb_build_object('rpc','rpc_admin_grant_title_to_beta','title',p_title_key))
    ON CONFLICT DO NOTHING;
    RETURN json_build_object('error','unauthorized','message','Owner or architect only.');
  END IF;

  IF p_title_key IS NULL OR NOT (p_title_key = ANY(public.all_title_keys())) THEN
    RETURN json_build_object('error','unknown_title','message','That title is not in the catalog.');
  END IF;

  WITH ins AS (
    INSERT INTO user_titles (user_id, title_key, source)
    SELECT user_id, p_title_key, 'beta_reward'
      FROM user_titles WHERE title_key = 'beta_founder'
    ON CONFLICT (user_id, title_key) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_granted FROM ins;

  INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(),'grant_title_to_beta','title',p_title_key,
          jsonb_build_object('granted', v_granted));

  RETURN json_build_object('ok', true, 'title_key', p_title_key, 'granted', v_granted);
END; $$;
REVOKE ALL ON FUNCTION public.rpc_admin_grant_title_to_beta(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_admin_grant_title_to_beta(text) TO authenticated;
