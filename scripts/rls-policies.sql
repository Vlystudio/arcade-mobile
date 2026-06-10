-- ============================================================
-- ArcadeTracker: Complete Row Level Security Policies
-- Run AFTER seed-games.sql and seed-admin-policies.sql
-- ============================================================

-- ──────────────────────────────────────────────────────────
-- Helper functions (supplements seed-admin-policies.sql)
-- ──────────────────────────────────────────────────────────

-- is_admin() should already exist from seed-admin-policies.sql
-- Add is_arcade_official() if not present
CREATE OR REPLACE FUNCTION public.is_arcade_official()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT is_arcade_official OR is_admin FROM profiles WHERE id = auth.uid()),
    false
  );
$$;

-- ──────────────────────────────────────────────────────────
-- Enable RLS on all tables
-- ──────────────────────────────────────────────────────────
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE follows ENABLE ROW LEVEL SECURITY;
ALTER TABLE scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE games ENABLE ROW LEVEL SECURITY;
ALTER TABLE lanes ENABLE ROW LEVEL SECURITY;
ALTER TABLE check_ins ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE tournaments ENABLE ROW LEVEL SECURITY;
ALTER TABLE tournament_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE tournament_registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE tournament_placements ENABLE ROW LEVEL SECURITY;
ALTER TABLE trivia_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE trivia_teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE trivia_team_members ENABLE ROW LEVEL SECURITY;

-- ──────────────────────────────────────────────────────────
-- PROFILES
-- ──────────────────────────────────────────────────────────

-- Any authenticated user can read profiles (needed for search, leaderboard, etc.)
DROP POLICY IF EXISTS "Authenticated users can read all profiles" ON profiles;
CREATE POLICY "Authenticated users can read all profiles" ON profiles
  FOR SELECT USING (auth.role() = 'authenticated');

-- Users can insert their own profile row (created on signup)
DROP POLICY IF EXISTS "Users can insert own profile" ON profiles;
CREATE POLICY "Users can insert own profile" ON profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

-- Users can update their own profile — but CANNOT promote themselves to admin/official
DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
CREATE POLICY "Users can update own profile" ON profiles
  FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (
    auth.uid() = id
    AND is_admin     IS NOT DISTINCT FROM (SELECT is_admin     FROM profiles WHERE id = auth.uid())
    AND is_arcade_official IS NOT DISTINCT FROM (SELECT is_arcade_official FROM profiles WHERE id = auth.uid())
  );

-- Admins can update any profile (promoting/demoting admin roles)
DROP POLICY IF EXISTS "Admins can update any profile" ON profiles;
CREATE POLICY "Admins can update any profile" ON profiles
  FOR UPDATE USING (public.is_admin());

-- ──────────────────────────────────────────────────────────
-- POSTS
-- ──────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Auth users can read posts" ON posts;
CREATE POLICY "Auth users can read posts" ON posts
  FOR SELECT USING (auth.role() = 'authenticated');

-- Only arcade officials can insert announcements; anyone can post regular posts
DROP POLICY IF EXISTS "Users can insert own posts" ON posts;
CREATE POLICY "Users can insert own posts" ON posts
  FOR INSERT WITH CHECK (
    auth.uid() = user_id
    AND (post_type = 'post' OR public.is_arcade_official())
  );

DROP POLICY IF EXISTS "Users can update own posts" ON posts;
CREATE POLICY "Users can update own posts" ON posts
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (
    auth.uid() = user_id
    AND (post_type = 'post' OR public.is_arcade_official())
  );

DROP POLICY IF EXISTS "Users can delete own posts" ON posts;
CREATE POLICY "Users can delete own posts" ON posts
  FOR DELETE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admins and officials can delete any post" ON posts;
CREATE POLICY "Admins and officials can delete any post" ON posts
  FOR DELETE USING (public.is_arcade_official());

-- ──────────────────────────────────────────────────────────
-- POST LIKES
-- ──────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Auth users can read likes" ON post_likes;
CREATE POLICY "Auth users can read likes" ON post_likes
  FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Users can like posts" ON post_likes;
CREATE POLICY "Users can like posts" ON post_likes
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can unlike posts" ON post_likes;
CREATE POLICY "Users can unlike posts" ON post_likes
  FOR DELETE USING (auth.uid() = user_id);

-- ──────────────────────────────────────────────────────────
-- FOLLOWS
-- ──────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Auth users can read follows" ON follows;
CREATE POLICY "Auth users can read follows" ON follows
  FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Users can follow others" ON follows;
CREATE POLICY "Users can follow others" ON follows
  FOR INSERT WITH CHECK (auth.uid() = follower_id AND follower_id <> following_id);

DROP POLICY IF EXISTS "Users can unfollow" ON follows;
CREATE POLICY "Users can unfollow" ON follows
  FOR DELETE USING (auth.uid() = follower_id);

-- ──────────────────────────────────────────────────────────
-- SCORES
-- ──────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Auth users can read scores" ON scores;
CREATE POLICY "Auth users can read scores" ON scores
  FOR SELECT USING (auth.role() = 'authenticated');

-- New scores always start as pending — users cannot self-approve
DROP POLICY IF EXISTS "Users can submit own scores" ON scores;
CREATE POLICY "Users can submit own scores" ON scores
  FOR INSERT WITH CHECK (auth.uid() = user_id AND status = 'pending');

-- Users can update their own pending scores (e.g., attach photo before review)
DROP POLICY IF EXISTS "Users can update own pending scores" ON scores;
CREATE POLICY "Users can update own pending scores" ON scores
  FOR UPDATE
  USING (auth.uid() = user_id AND status = 'pending')
  WITH CHECK (auth.uid() = user_id AND status = 'pending');

-- Only admins can approve or deny scores
DROP POLICY IF EXISTS "Admins can review scores" ON scores;
CREATE POLICY "Admins can review scores" ON scores
  FOR UPDATE USING (public.is_admin());

-- ──────────────────────────────────────────────────────────
-- GAMES (catalog — read-only for users)
-- ──────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Auth users can read games" ON games;
CREATE POLICY "Auth users can read games" ON games
  FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Admins can manage games" ON games;
CREATE POLICY "Admins can manage games" ON games
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ──────────────────────────────────────────────────────────
-- LANES
-- ──────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Auth users can read lanes" ON lanes;
CREATE POLICY "Auth users can read lanes" ON lanes
  FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Admins can manage lanes" ON lanes;
CREATE POLICY "Admins can manage lanes" ON lanes
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ──────────────────────────────────────────────────────────
-- CHECK-INS
-- ──────────────────────────────────────────────────────────

-- Users can read their own check-ins; admins can read all
DROP POLICY IF EXISTS "Users can read own check-ins" ON check_ins;
CREATE POLICY "Users can read own check-ins" ON check_ins
  FOR SELECT USING (auth.uid() = user_id OR public.is_admin());

-- Enforce single active check-in per user at the DB level
DROP POLICY IF EXISTS "Users can insert own check-ins" ON check_ins;
CREATE POLICY "Users can insert own check-ins" ON check_ins
  FOR INSERT WITH CHECK (
    auth.uid() = user_id
    AND NOT EXISTS (
      SELECT 1 FROM check_ins
      WHERE user_id = auth.uid() AND status = 'active'
    )
  );

DROP POLICY IF EXISTS "Users can update own check-ins" ON check_ins;
CREATE POLICY "Users can update own check-ins" ON check_ins
  FOR UPDATE USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ──────────────────────────────────────────────────────────
-- TEAMS
-- ──────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Auth users can read teams" ON teams;
CREATE POLICY "Auth users can read teams" ON teams
  FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Users can create teams" ON teams;
CREATE POLICY "Users can create teams" ON teams
  FOR INSERT WITH CHECK (auth.uid() = captain_user_id);

DROP POLICY IF EXISTS "Captains can update their team" ON teams;
CREATE POLICY "Captains can update their team" ON teams
  FOR UPDATE USING (auth.uid() = captain_user_id);

DROP POLICY IF EXISTS "Captains or admins can delete teams" ON teams;
CREATE POLICY "Captains or admins can delete teams" ON teams
  FOR DELETE USING (auth.uid() = captain_user_id OR public.is_admin());

-- TEAM MEMBERS
DROP POLICY IF EXISTS "Auth users can read team members" ON team_members;
CREATE POLICY "Auth users can read team members" ON team_members
  FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Users can join teams" ON team_members;
CREATE POLICY "Users can join teams" ON team_members
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can leave teams or captains can remove" ON team_members;
CREATE POLICY "Users can leave teams or captains can remove" ON team_members
  FOR DELETE USING (
    auth.uid() = user_id
    OR public.is_admin()
    OR auth.uid() = (SELECT captain_user_id FROM teams WHERE id = team_id)
  );

-- ──────────────────────────────────────────────────────────
-- TOURNAMENTS
-- ──────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Auth users can read tournaments" ON tournaments;
CREATE POLICY "Auth users can read tournaments" ON tournaments
  FOR SELECT USING (auth.role() = 'authenticated');

-- Only admins can create tournaments (community requests go through tournament_requests)
DROP POLICY IF EXISTS "Admins can insert tournaments" ON tournaments;
CREATE POLICY "Admins can insert tournaments" ON tournaments
  FOR INSERT WITH CHECK (public.is_admin());

-- Admins can update anything; owners can only update announcement and cancel
DROP POLICY IF EXISTS "Admins can update any tournament" ON tournaments;
CREATE POLICY "Admins can update any tournament" ON tournaments
  FOR UPDATE USING (public.is_admin());

DROP POLICY IF EXISTS "Owners can update announcement or cancel" ON tournaments;
CREATE POLICY "Owners can update announcement or cancel" ON tournaments
  FOR UPDATE
  USING (auth.uid() = created_by AND status IN ('upcoming', 'active'))
  WITH CHECK (auth.uid() = created_by AND status IN ('upcoming', 'active', 'cancelled'));

-- TOURNAMENT REQUESTS
DROP POLICY IF EXISTS "Users can read own requests or admins all" ON tournament_requests;
CREATE POLICY "Users can read own requests or admins all" ON tournament_requests
  FOR SELECT USING (auth.uid() = user_id OR public.is_admin());

DROP POLICY IF EXISTS "Users can submit tournament requests" ON tournament_requests;
CREATE POLICY "Users can submit tournament requests" ON tournament_requests
  FOR INSERT WITH CHECK (auth.uid() = user_id AND status = 'pending');

DROP POLICY IF EXISTS "Admins can update tournament requests" ON tournament_requests;
CREATE POLICY "Admins can update tournament requests" ON tournament_requests
  FOR UPDATE USING (public.is_admin());

-- TOURNAMENT REGISTRATIONS
-- Readable by: the registered user, the tournament owner, and admins
DROP POLICY IF EXISTS "Users can read relevant registrations" ON tournament_registrations;
CREATE POLICY "Users can read relevant registrations" ON tournament_registrations
  FOR SELECT USING (
    auth.uid() = user_id
    OR public.is_admin()
    OR auth.uid() = (SELECT created_by FROM tournaments WHERE id = tournament_id)
  );

DROP POLICY IF EXISTS "Users can register for tournaments" ON tournament_registrations;
CREATE POLICY "Users can register for tournaments" ON tournament_registrations
  FOR INSERT WITH CHECK (
    auth.uid() = user_id
    AND status IN ('pending', 'accepted')
  );

DROP POLICY IF EXISTS "Users can withdraw their registration" ON tournament_registrations;
CREATE POLICY "Users can withdraw their registration" ON tournament_registrations
  FOR DELETE USING (auth.uid() = user_id);

-- Owners can accept/deny; admins can do anything
DROP POLICY IF EXISTS "Owners and admins can update registration status" ON tournament_registrations;
CREATE POLICY "Owners and admins can update registration status" ON tournament_registrations
  FOR UPDATE USING (
    public.is_admin()
    OR auth.uid() = (SELECT created_by FROM tournaments WHERE id = tournament_id)
  );

-- TOURNAMENT PLACEMENTS
DROP POLICY IF EXISTS "Auth users can read placements" ON tournament_placements;
CREATE POLICY "Auth users can read placements" ON tournament_placements
  FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Admins can manage placements" ON tournament_placements;
CREATE POLICY "Admins can manage placements" ON tournament_placements
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ──────────────────────────────────────────────────────────
-- TRIVIA
-- ──────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Auth users can read trivia events" ON trivia_events;
CREATE POLICY "Auth users can read trivia events" ON trivia_events
  FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Admins can manage trivia events" ON trivia_events;
CREATE POLICY "Admins can manage trivia events" ON trivia_events
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Auth users can read trivia teams" ON trivia_teams;
CREATE POLICY "Auth users can read trivia teams" ON trivia_teams
  FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Users can create trivia teams" ON trivia_teams;
CREATE POLICY "Users can create trivia teams" ON trivia_teams
  FOR INSERT WITH CHECK (auth.uid() = captain_user_id);

DROP POLICY IF EXISTS "Captains can update trivia teams" ON trivia_teams;
CREATE POLICY "Captains can update trivia teams" ON trivia_teams
  FOR UPDATE USING (auth.uid() = captain_user_id);

DROP POLICY IF EXISTS "Captains or admins can delete trivia teams" ON trivia_teams;
CREATE POLICY "Captains or admins can delete trivia teams" ON trivia_teams
  FOR DELETE USING (auth.uid() = captain_user_id OR public.is_admin());

DROP POLICY IF EXISTS "Auth users can read trivia members" ON trivia_team_members;
CREATE POLICY "Auth users can read trivia members" ON trivia_team_members
  FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Users can join trivia teams" ON trivia_team_members;
CREATE POLICY "Users can join trivia teams" ON trivia_team_members
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can leave or captains can remove" ON trivia_team_members;
CREATE POLICY "Users can leave or captains can remove" ON trivia_team_members
  FOR DELETE USING (
    auth.uid() = user_id
    OR public.is_admin()
    OR auth.uid() = (SELECT captain_user_id FROM trivia_teams WHERE id = trivia_team_id)
  );

-- ──────────────────────────────────────────────────────────
-- Storage: post-photos bucket policy (run in Supabase dashboard Storage tab)
-- ──────────────────────────────────────────────────────────
-- Policy: authenticated users can upload to their own folder (user_id/*)
-- Policy: anyone can read (public bucket)
-- Set via Supabase dashboard → Storage → post-photos → Policies:
--   INSERT: bucket_id = 'post-photos' AND auth.uid()::text = (storage.foldername(name))[1]
--   SELECT: bucket_id = 'post-photos'   (public read)
--   DELETE: bucket_id = 'post-photos' AND auth.uid()::text = (storage.foldername(name))[1]
