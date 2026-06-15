-- ============================================================
-- Profile pronouns + earnable Titles
--
--  • profiles.pronouns        — user-chosen, displayed publicly.
--  • profiles.equipped_title  — the title key the user displays. A trigger
--    enforces that it's one they've actually earned (or NULL to un-equip),
--    so it can be set with a plain profile update yet can't be faked.
--
-- Titles are mostly COMPUTED live (no storage to drift):
--   signature ring  → smooth_roller (40), monarch_50 (50), centurion (100),
--                     steady_hand (30), on_the_board (20), warming_up (10)
--   tournament 1st  → tournament_champion
--   season winner   → season_champion (current member of the top-points team
--                     in any completed season)
-- Only beta_founder is a stored grant (a time-bound cohort): granted to every
-- existing user now and to new signups while app_config.beta_open = true.
--
-- Run AFTER: skeeball-seasons-stats.sql, security-hardening-2.sql (view)
-- Idempotent — safe to re-run.
-- ============================================================

-- ── 1. Columns ───────────────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS pronouns       text,
  ADD COLUMN IF NOT EXISTS equipped_title text;


-- ── 2. Stored grants (beta cohort + room for future manual grants) ──
CREATE TABLE IF NOT EXISTS public.user_titles (
  user_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title_key  text NOT NULL,
  source     text,
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, title_key)
);
ALTER TABLE public.user_titles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "user_titles_own_read" ON public.user_titles;
CREATE POLICY "user_titles_own_read" ON public.user_titles
  FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_admin());
-- writes only via SECURITY DEFINER paths


CREATE TABLE IF NOT EXISTS public.app_config (
  id        int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  beta_open boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.app_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "app_config_read" ON public.app_config;
CREATE POLICY "app_config_read" ON public.app_config FOR SELECT TO authenticated USING (true);


-- ── 3. Backfill the beta cohort + auto-grant new signups while open ──
INSERT INTO public.user_titles (user_id, title_key, source)
SELECT id, 'beta_founder', 'beta'
  FROM public.profiles
ON CONFLICT (user_id, title_key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.grant_beta_founder()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF COALESCE((SELECT beta_open FROM app_config WHERE id = 1), false) THEN
    INSERT INTO user_titles (user_id, title_key, source)
    VALUES (NEW.id, 'beta_founder', 'beta')
    ON CONFLICT (user_id, title_key) DO NOTHING;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trig_grant_beta_founder ON public.profiles;
CREATE TRIGGER trig_grant_beta_founder
  AFTER INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.grant_beta_founder();


-- ── 4. Earned-title computation ──────────────────────────────
CREATE OR REPLACE FUNCTION public.user_earned_title_keys(p_uid uuid)
RETURNS text[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_keys text[] := '{}';
  v_balls int;
  v_sig int;
BEGIN
  -- stored grants (beta_founder, any future manual grants)
  SELECT COALESCE(array_agg(title_key), '{}') INTO v_keys
    FROM user_titles WHERE user_id = p_uid;

  -- signature ring (needs a minimum sample to mean anything)
  SELECT count(*) INTO v_balls FROM skeeball_ball_scores WHERE player_user_id = p_uid;
  IF v_balls >= 20 THEN
    SELECT score INTO v_sig
      FROM skeeball_ball_scores
     WHERE player_user_id = p_uid
     GROUP BY score
     ORDER BY count(*) DESC, score DESC
     LIMIT 1;
    v_keys := v_keys || CASE v_sig
      WHEN 100 THEN 'centurion'
      WHEN 50  THEN 'monarch_50'
      WHEN 40  THEN 'smooth_roller'
      WHEN 30  THEN 'steady_hand'
      WHEN 20  THEN 'on_the_board'
      WHEN 10  THEN 'warming_up'
      ELSE NULL END;
  END IF;

  -- tournament champion (any 1st place)
  IF EXISTS (SELECT 1 FROM tournament_placements WHERE user_id = p_uid AND placement = 1) THEN
    v_keys := v_keys || 'tournament_champion';
  END IF;

  -- season champion: current member of the top-points team in any completed season
  IF EXISTS (
    SELECT 1 FROM skeeball_seasons s
     WHERE s.status = 'completed'
       AND EXISTS (
         SELECT 1 FROM team_members tm
          WHERE tm.user_id = p_uid
            AND tm.team_id = (
              SELECT ss.team_id FROM skeeball_sessions ss
               WHERE ss.week_of BETWEEN s.start_week AND s.end_week
                 AND ss.status = 'completed'
               GROUP BY ss.team_id
               ORDER BY SUM(COALESCE(ss.league_points,0) + COALESCE(ss.league_points_adjustment,0)) DESC
               LIMIT 1
            )
       )
  ) THEN
    v_keys := v_keys || 'season_champion';
  END IF;

  -- drop nulls/dupes
  SELECT COALESCE(array_agg(DISTINCT k), '{}') INTO v_keys
    FROM unnest(v_keys) k WHERE k IS NOT NULL;
  RETURN v_keys;
END; $$;

REVOKE ALL ON FUNCTION public.user_earned_title_keys(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_earned_title_keys(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.rpc_get_my_titles()
RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(to_json(public.user_earned_title_keys(auth.uid())), '[]'::json);
$$;
REVOKE ALL ON FUNCTION public.rpc_get_my_titles() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_get_my_titles() TO authenticated;


-- ── 5. Enforce equipped_title is earned (or NULL) on any profile update ──
CREATE OR REPLACE FUNCTION public.enforce_equipped_title()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.equipped_title IS NOT NULL
     AND NEW.equipped_title IS DISTINCT FROM OLD.equipped_title THEN
    IF NOT (NEW.equipped_title = ANY(public.user_earned_title_keys(NEW.id))) THEN
      RAISE EXCEPTION 'You have not earned that title.' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trig_enforce_equipped_title ON public.profiles;
CREATE TRIGGER trig_enforce_equipped_title
  BEFORE UPDATE OF equipped_title ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.enforce_equipped_title();


-- ── 6. Admin: close the beta cohort (stop auto-granting new signups) ──
CREATE OR REPLACE FUNCTION public.rpc_admin_set_beta_open(p_open boolean)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.require_mfa();
  IF NOT public.is_admin() THEN
    RETURN json_build_object('error', 'unauthorized');
  END IF;
  UPDATE app_config SET beta_open = p_open, updated_at = now() WHERE id = 1;
  INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'set_beta_open', 'app_config', '1', jsonb_build_object('beta_open', p_open));
  RETURN json_build_object('ok', true, 'beta_open', p_open);
END; $$;
REVOKE ALL ON FUNCTION public.rpc_admin_set_beta_open(boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_admin_set_beta_open(boolean) TO authenticated;


-- ── 7. Expose pronouns + equipped_title on the public view ──
-- (Identity fields are always visible; pronouns/title are public display.)
DROP VIEW IF EXISTS public.public_profiles;
CREATE VIEW public.public_profiles AS
  SELECT
    id,
    username,
    avatar_url,
    pronouns,
    equipped_title,
    CASE WHEN (NOT COALESCE(is_private, false)) OR id = auth.uid() THEN bio END AS bio,
    CASE WHEN (NOT COALESCE(is_private, false)) OR id = auth.uid() THEN online_status END AS online_status,
    created_at,
    CASE WHEN (NOT COALESCE(is_private, false)) OR id = auth.uid() THEN featured_game_id END AS featured_game_id,
    CASE WHEN role IN ('admin', 'owner', 'architect') THEN role END AS badge_role,
    COALESCE(is_beta_tester, false) AS is_beta_tester
  FROM profiles;
GRANT SELECT ON public.public_profiles TO anon, authenticated;


-- ── 8. Expose pronouns + equipped_title on the profile-page RPC ──
-- Redefines rpc_get_public_profile (from profiles-lockdown.sql) to also
-- return the two public display fields. pronouns/equipped_title are always
-- visible (public display), like username/avatar; the privacy-gated detail
-- fields keep their existing v_can_see gating.
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
    'pronouns',       v_p.pronouns,
    'equipped_title', v_p.equipped_title,
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
