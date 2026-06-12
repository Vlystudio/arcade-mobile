-- ============================================================
-- Profiles read lockdown (production hardening)
--
-- Drops the beta-era permissive SELECT policies on profiles
-- ("Users can read profiles" / "Authenticated users can read all
-- profiles", both effectively USING (true)). After this script:
--   • users read their OWN row,
--   • admins (is_admin) read all rows,
--   • everyone else goes through public_profiles (sanitized view) or
--     rpc_get_public_profile below (adds privacy-aware detail gating
--     with the friendship check done server-side).
--
-- Run AFTER: security-hardening-2.sql (A8 view), beta-testers.sql
-- Idempotent — safe to re-run.
-- ============================================================

-- ── 1. Profile-page RPC: one sanitized read for viewing any user ──
CREATE OR REPLACE FUNCTION public.rpc_get_public_profile(p_user_id uuid)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_p       record;
  v_friends boolean;
  v_can_see boolean;
BEGIN
  IF v_uid IS NULL THEN RETURN json_build_object('error', 'not_authenticated'); END IF;

  SELECT * INTO v_p FROM profiles WHERE id = p_user_id;
  IF NOT FOUND THEN RETURN json_build_object('error', 'not_found'); END IF;

  v_friends := EXISTS (
    SELECT 1 FROM friendships
     WHERE status = 'accepted'
       AND ((requester_id = v_uid AND addressee_id = p_user_id)
         OR (requester_id = p_user_id AND addressee_id = v_uid))
  );
  v_can_see := (NOT COALESCE(v_p.is_private, false)) OR v_friends
               OR p_user_id = v_uid OR public.is_admin();

  RETURN json_build_object(
    'id',             v_p.id,
    'username',       v_p.username,
    'avatar_url',     v_p.avatar_url,
    'badge_role',     CASE WHEN v_p.role IN ('admin','owner','architect') THEN v_p.role END,
    'is_beta_tester', COALESCE(v_p.is_beta_tester, false),
    'can_see_stats',  v_can_see,
    'bio',            CASE WHEN v_can_see THEN v_p.bio END,
    'featured_game_id', CASE WHEN v_can_see THEN v_p.featured_game_id END,
    'show_skeeball_stats', CASE WHEN v_can_see THEN COALESCE(v_p.show_skeeball_stats, true) ELSE false END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_get_public_profile(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_get_public_profile(uuid) TO authenticated;


-- ── 2. Drop the permissive read policies ──────────────────────
-- ("profiles readable" was already removed by policy-dedupe.sql.)
DROP POLICY IF EXISTS "Users can read profiles" ON public.profiles;
DROP POLICY IF EXISTS "Authenticated users can read all profiles" ON public.profiles;
-- Remaining read policies (kept):
--   "Users can read own profile"   USING (auth.uid() = id)
--   "Admins can read all profiles" USING (is_admin())
