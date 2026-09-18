BEGIN;

-- Venues are public directory entries; only MFA-verified platform admins may edit them.
ALTER TABLE public.venues ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.venues FROM anon, authenticated;
GRANT SELECT ON public.venues TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.venues TO authenticated;
CREATE POLICY venues_public_read ON public.venues FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY venues_admin_write ON public.venues FOR ALL TO authenticated
  USING ((SELECT public.is_platform_admin()) AND (SELECT auth.jwt()->>'aal') = 'aal2')
  WITH CHECK ((SELECT public.is_platform_admin()) AND (SELECT auth.jwt()->>'aal') = 'aal2');

-- Pin the remaining legacy function search paths discovered from production.
DO $$
DECLARE fn regprocedure;
BEGIN
  FOR fn IN SELECT oid::regprocedure FROM pg_proc
    WHERE pronamespace='public'::regnamespace AND proname IN (
      'all_title_keys','check_email_available','get_email_by_username','get_username_by_email',
      'rpc_team_kick','rpc_team_ban','rpc_team_unban','rpc_trivia_join',
      'skeeball_current_week','rpc_trivia_submit_answer'
    )
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = public, extensions, pg_temp', fn);
  END LOOP;
END;
$$;

COMMIT;
