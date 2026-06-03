-- Admin RLS policies
-- Run this in the Supabase SQL Editor AFTER seed-games.sql

-- 1. Add is_admin column
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_admin boolean DEFAULT false;

-- 2. Security definer function — checks is_admin without triggering RLS recursion
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT is_admin FROM profiles WHERE id = auth.uid()),
    false
  );
$$;

-- 3. Profiles: own-profile read (simple, no recursion)
DROP POLICY IF EXISTS "Users can read own profile" ON profiles;
CREATE POLICY "Users can read own profile" ON profiles FOR SELECT USING (auth.uid() = id);

-- 4. Profiles: admins can read all
DROP POLICY IF EXISTS "Admins can read all profiles" ON profiles;
CREATE POLICY "Admins can read all profiles" ON profiles FOR SELECT USING (public.is_admin());

-- 5. Scores: admins can read all
DROP POLICY IF EXISTS "Admins can read all scores" ON scores;
CREATE POLICY "Admins can read all scores" ON scores FOR SELECT USING (public.is_admin());

-- 6. Scores: admins can update any
DROP POLICY IF EXISTS "Admins can update any score" ON scores;
CREATE POLICY "Admins can update any score" ON scores FOR UPDATE USING (public.is_admin());

-- 7. Grant yourself admin (run separately after finding your UUID)
-- UPDATE profiles SET is_admin = true
-- WHERE id = (SELECT id FROM auth.users WHERE email = 'your@email.com');
