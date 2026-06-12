-- ============================================================
-- RLS policy dedupe — removes EXACT duplicate policies only.
--
-- Several tables accumulated multiple SELECT/DELETE policies with
-- identical command, USING expression, WITH CHECK, and role list
-- (left behind by successive migration passes). Permissive policies
-- are OR-ed, so dropping an exact duplicate changes nothing about
-- who can do what — it only removes noise from the policy list.
--
-- Verified identical via pg_policy (qual/with-check/roles) before
-- writing this script. Do NOT add drops here for policies that are
-- merely similar — only byte-identical duplicates belong in this file.
--
-- Idempotent — safe to re-run.
-- ============================================================

-- posts: duplicate of "Authenticated users can read posts" (USING true, authenticated)
DROP POLICY IF EXISTS "read posts" ON public.posts;

-- posts: duplicate of "Admins and officials can delete any post" (USING is_arcade_official())
DROP POLICY IF EXISTS "Admins can delete any post" ON public.posts;

-- profiles: duplicate of "Users can read profiles" (USING true, authenticated).
-- NOTE: this does NOT change the (known, beta-era) permissive read on
-- profiles — see README "Security Model" Production TODO for the plan to
-- drop the permissive read entirely after beta.
DROP POLICY IF EXISTS "profiles readable" ON public.profiles;

-- teams: duplicate of "Authenticated users can read teams" (USING true, authenticated)
DROP POLICY IF EXISTS "read teams" ON public.teams;

-- team_members: duplicates of "Authenticated users can read team members" (USING true, authenticated)
DROP POLICY IF EXISTS "read team members" ON public.team_members;
DROP POLICY IF EXISTS "Anyone can view team members" ON public.team_members;
