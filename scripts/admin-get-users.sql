-- rpc_admin_get_users
-- Returns ALL auth users joined with their profile (if any).
-- Falls back to auth.email when username is null (user never completed profile setup).
-- Requires caller to be admin or higher.

CREATE OR REPLACE FUNCTION public.rpc_admin_get_users()
RETURNS TABLE (
  id         uuid,
  username   text,
  avatar_url text,
  role       text,
  email      text
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
    au.email::text
  FROM auth.users au
  LEFT JOIN public.profiles p ON p.id = au.id
  ORDER BY LOWER(COALESCE(p.username, au.email, ''));
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_admin_get_users() TO authenticated;
