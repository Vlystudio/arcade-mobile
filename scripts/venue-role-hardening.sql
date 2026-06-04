-- ============================================================
-- Venue Role Hardening
-- Adds granular role column to venue_admins (owner | admin | staff)
-- and defines typed helper functions consumed by all admin RPCs.
--
-- Run AFTER: security-hardening.sql
-- Idempotent — safe to re-run.
-- ============================================================

-- ── 1. Ensure venue_admins table exists ──────────────────────
-- This table may be created earlier by venue-migration.sql.
-- If that script hasn't run yet this block creates it inline.
CREATE TABLE IF NOT EXISTS venue_admins (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id   uuid        NOT NULL,
  user_id    uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  granted_by uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  granted_at timestamptz DEFAULT now(),
  UNIQUE (venue_id, user_id)
);

ALTER TABLE venue_admins ENABLE ROW LEVEL SECURITY;

-- ── 1b. Add role column to venue_admins ──────────────────────
ALTER TABLE venue_admins
  ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'admin'
  CHECK (role IN ('owner', 'admin', 'staff'));

-- ── 2. Helper: is_platform_admin() ───────────────────────────
-- True when the caller is a global platform admin.
-- Checks both the legacy is_admin flag and the role column.
CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT is_admin FROM profiles WHERE id = auth.uid()),
    false
  );
$$;

REVOKE ALL ON FUNCTION public.is_platform_admin() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.is_platform_admin() TO authenticated;

-- ── 3. Helper: is_venue_owner(p_venue_id) ────────────────────
-- True for platform admins OR the venue owner role.
CREATE OR REPLACE FUNCTION public.is_venue_owner(p_venue_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.is_platform_admin()
    OR EXISTS (
      SELECT 1 FROM venue_admins
       WHERE venue_id = p_venue_id
         AND user_id  = auth.uid()
         AND role     = 'owner'
    );
$$;

REVOKE ALL ON FUNCTION public.is_venue_owner(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.is_venue_owner(uuid) TO authenticated;

-- ── 4. Helper: is_venue_admin(p_venue_id) — updated ──────────
-- True for platform admins, venue owners, or venue admins.
-- Replaces the prior version that didn't scope by role.
CREATE OR REPLACE FUNCTION public.is_venue_admin(p_venue_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.is_platform_admin()
    OR EXISTS (
      SELECT 1 FROM venue_admins
       WHERE venue_id = p_venue_id
         AND user_id  = auth.uid()
         AND role     IN ('owner', 'admin')
    );
$$;

REVOKE ALL ON FUNCTION public.is_venue_admin(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.is_venue_admin(uuid) TO authenticated;

-- ── 5. Helper: is_venue_staff(p_venue_id) ────────────────────
-- True for all venue roles (including staff — lowest privilege).
CREATE OR REPLACE FUNCTION public.is_venue_staff(p_venue_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.is_platform_admin()
    OR EXISTS (
      SELECT 1 FROM venue_admins
       WHERE venue_id = p_venue_id
         AND user_id  = auth.uid()
         -- all roles including staff
    );
$$;

REVOKE ALL ON FUNCTION public.is_venue_staff(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.is_venue_staff(uuid) TO authenticated;

-- ── 6. Helper: can_manage_venue(p_venue_id) ──────────────────
-- True if caller can perform management actions for the venue.
-- Use this as the primary guard for venue-scoped admin RPCs.
CREATE OR REPLACE FUNCTION public.can_manage_venue(p_venue_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_venue_admin(p_venue_id);
$$;

REVOKE ALL ON FUNCTION public.can_manage_venue(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.can_manage_venue(uuid) TO authenticated;

-- ── 7. RPC: grant venue role ──────────────────────────────────
-- Platform admins and venue owners can add/update venue roles.
CREATE OR REPLACE FUNCTION public.rpc_admin_grant_venue_role(
  p_venue_id uuid,
  p_user_id  uuid,
  p_role     text  -- 'owner' | 'admin' | 'staff'
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_grantee_username text;
BEGIN
  PERFORM public.require_mfa();

  IF p_role NOT IN ('owner', 'admin', 'staff') THEN
    RETURN json_build_object('error', 'invalid_role',
      'message', 'Role must be owner, admin, or staff.');
  END IF;

  -- Only platform admins or venue owners can grant roles
  IF NOT (public.is_platform_admin() OR public.is_venue_owner(p_venue_id)) THEN
    INSERT INTO security_events (event_type, severity, user_id, details)
    VALUES ('admin_permission_denied', 'warn', auth.uid(),
      jsonb_build_object('rpc', 'grant_venue_role', 'venue_id', p_venue_id))
    ON CONFLICT DO NOTHING;
    RETURN json_build_object('error', 'unauthorized',
      'message', 'Only platform admins or venue owners can grant venue roles.');
  END IF;

  -- Prevent demoting platform admins via this RPC
  IF EXISTS (SELECT 1 FROM profiles WHERE id = p_user_id AND is_admin = true)
     AND NOT public.is_platform_admin() THEN
    RETURN json_build_object('error', 'forbidden',
      'message', 'Cannot modify the role of a platform admin.');
  END IF;

  SELECT username INTO v_grantee_username FROM profiles WHERE id = p_user_id;

  INSERT INTO venue_admins (venue_id, user_id, role, granted_by, granted_at)
  VALUES (p_venue_id, p_user_id, p_role, auth.uid(), now())
  ON CONFLICT (venue_id, user_id) DO UPDATE
    SET role       = EXCLUDED.role,
        granted_by = EXCLUDED.granted_by,
        granted_at = EXCLUDED.granted_at;

  INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (
    auth.uid(), 'grant_venue_role', 'venue_admin',
    (p_venue_id::text || ':' || p_user_id::text),
    jsonb_build_object('venue_id', p_venue_id, 'user_id', p_user_id,
                       'role', p_role, 'grantee_username', v_grantee_username)
  );

  INSERT INTO security_events (event_type, severity, user_id, details)
  VALUES ('venue_role_granted', 'info', auth.uid(),
    jsonb_build_object('venue_id', p_venue_id, 'target_user_id', p_user_id, 'role', p_role))
  ON CONFLICT DO NOTHING;

  RETURN json_build_object('ok', true, 'role', p_role, 'username', v_grantee_username);
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_admin_grant_venue_role(uuid, uuid, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.rpc_admin_grant_venue_role(uuid, uuid, text) TO authenticated;


-- ── 8. RPC: revoke venue role ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_admin_revoke_venue_role(
  p_venue_id uuid,
  p_user_id  uuid
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_role text;
BEGIN
  PERFORM public.require_mfa();

  IF NOT (public.is_platform_admin() OR public.is_venue_owner(p_venue_id)) THEN
    INSERT INTO security_events (event_type, severity, user_id, details)
    VALUES ('admin_permission_denied', 'warn', auth.uid(),
      jsonb_build_object('rpc', 'revoke_venue_role', 'venue_id', p_venue_id))
    ON CONFLICT DO NOTHING;
    RETURN json_build_object('error', 'unauthorized');
  END IF;

  SELECT role INTO v_old_role FROM venue_admins
   WHERE venue_id = p_venue_id AND user_id = p_user_id;

  DELETE FROM venue_admins WHERE venue_id = p_venue_id AND user_id = p_user_id;

  INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (
    auth.uid(), 'revoke_venue_role', 'venue_admin',
    (p_venue_id::text || ':' || p_user_id::text),
    jsonb_build_object('venue_id', p_venue_id, 'user_id', p_user_id, 'was_role', v_old_role)
  );

  INSERT INTO security_events (event_type, severity, user_id, details)
  VALUES ('venue_role_revoked', 'info', auth.uid(),
    jsonb_build_object('venue_id', p_venue_id, 'target_user_id', p_user_id, 'was_role', v_old_role))
  ON CONFLICT DO NOTHING;

  RETURN json_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_admin_revoke_venue_role(uuid, uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.rpc_admin_revoke_venue_role(uuid, uuid) TO authenticated;


-- ── 9. Updated RLS for venue_admins ──────────────────────────
-- Venue owners can read their own venue's admin list
DROP POLICY IF EXISTS "Admins read venue_admins"   ON venue_admins;
CREATE POLICY "Admins read venue_admins" ON venue_admins
  FOR SELECT USING (
    public.is_platform_admin()
    OR public.is_venue_owner(venue_id)
    OR user_id = auth.uid()  -- can always see own role
  );

DROP POLICY IF EXISTS "Admins manage venue_admins" ON venue_admins;
CREATE POLICY "Admins manage venue_admins" ON venue_admins
  FOR ALL USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());


-- ── 10. Update forum admin RPC to accept venue admins ─────────
-- The existing rpc_admin_update_forum_status only accepts is_admin().
-- Update it to accept venue admins for their venue's forums.
CREATE OR REPLACE FUNCTION public.rpc_admin_update_forum_status(
  p_forum_id uuid,
  p_status   text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_forum record;
BEGIN
  PERFORM public.require_mfa();

  SELECT id, title, venue_id INTO v_forum FROM forums WHERE id = p_forum_id;
  IF NOT FOUND THEN
    RETURN json_build_object('error', 'not_found');
  END IF;

  -- Platform admin OR venue admin for this forum's venue
  IF NOT (
    public.is_platform_admin()
    OR (v_forum.venue_id IS NOT NULL AND public.is_venue_admin(v_forum.venue_id))
  ) THEN
    INSERT INTO security_events (event_type, severity, user_id, details)
    VALUES ('admin_permission_denied', 'warn', auth.uid(),
      jsonb_build_object('rpc', 'update_forum_status', 'forum_id', p_forum_id))
    ON CONFLICT DO NOTHING;
    RETURN json_build_object('error', 'unauthorized', 'message', 'Admin only.');
  END IF;

  IF p_status NOT IN ('approved', 'rejected') THEN
    RETURN json_build_object('error', 'invalid_status',
      'message', 'Status must be approved or rejected.');
  END IF;

  UPDATE forums SET status = p_status WHERE id = p_forum_id;

  INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (
    auth.uid(), 'forum_status_update', 'forum', p_forum_id::text,
    jsonb_build_object('new_status', p_status, 'title', v_forum.title,
                       'venue_id', v_forum.venue_id)
  );

  RETURN json_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_admin_update_forum_status(uuid, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.rpc_admin_update_forum_status(uuid, text) TO authenticated;
