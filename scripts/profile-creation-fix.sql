-- ============================================================
-- Profile Creation Fix — repair silent profile-row loss on signup
--
-- Run AFTER: security-events.sql (order 11)
-- Idempotent — safe to re-run.
--
-- Root cause: public.handle_new_user() (AFTER INSERT trigger on
-- auth.users) wraps its INSERT INTO public.profiles in a blanket
-- "EXCEPTION WHEN OTHERS THEN RETURN NEW", which silently swallows
-- ANY error — including a unique_violation on profiles_username_key
-- when two signups race on the same default username. The result:
-- the auth.users row is created but the profiles row never is.
--
-- Every important table (teams, scores, check_ins, team_members,
-- forum_posts, friendships, tournaments, ...) has a foreign key to
-- profiles(id), so an account missing its profiles row gets foreign
-- key violations on team creation, score submission, check-in, etc.
-- Production currently has 10 of 21 auth.users with no profiles row.
--
-- Fixes applied:
--   1. Backfill profiles for existing auth.users rows missing one.
--   2. Harden handle_new_user(): retry username collisions with a
--      guaranteed-unique UUID-based username, and log any other
--      failure to security_events instead of swallowing it silently.
-- ============================================================


-- ── 1. Backfill missing profiles ──────────────────────────────
-- Use a UUID-derived username for every backfilled row — guaranteed
-- unique (id is the table's primary key), avoiding any risk of this
-- single statement hitting profiles_username_key itself.
INSERT INTO public.profiles (id, username)
SELECT u.id, 'user_' || replace(u.id::text, '-', '')
FROM auth.users u
LEFT JOIN public.profiles p ON p.id = u.id
WHERE p.id IS NULL
ON CONFLICT (id) DO NOTHING;


-- ── 2. Harden handle_new_user() ───────────────────────────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  desired_username text;
  final_username text;
BEGIN
  desired_username := COALESCE(
    NEW.raw_user_meta_data->>'username',
    NEW.raw_user_meta_data->>'full_name',
    'user_' || substr(NEW.id::text, 1, 8)
  );

  IF EXISTS (SELECT 1 FROM public.profiles WHERE lower(username) = lower(desired_username)) THEN
    final_username := 'user_' || replace(NEW.id::text, '-', '');
  ELSE
    final_username := desired_username;
  END IF;

  BEGIN
    INSERT INTO public.profiles (id, username)
    VALUES (NEW.id, final_username)
    ON CONFLICT (id) DO UPDATE
      SET username = EXCLUDED.username
      WHERE profiles.username IS NULL OR profiles.username = '';
  EXCEPTION WHEN unique_violation OR SQLSTATE 'P0002' THEN
    -- Either lost a race against a concurrent signup for the same username,
    -- or the content-moderation trigger rejected the chosen username
    -- (P0002). Retry with a guaranteed-unique, moderation-safe,
    -- UUID-derived username — the account must always get a profiles row;
    -- the user can pick a different display name afterwards.
    INSERT INTO public.profiles (id, username)
    VALUES (NEW.id, 'user_' || replace(NEW.id::text, '-', ''))
    ON CONFLICT (id) DO UPDATE
      SET username = EXCLUDED.username
      WHERE profiles.username IS NULL OR profiles.username = '';
  END;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never block account creation, but make unexpected failures visible
  -- instead of silently leaving the account without a profiles row.
  BEGIN
    INSERT INTO public.security_events (event_type, severity, user_id, details)
    VALUES ('profile_creation_failed', 'critical', NEW.id,
      jsonb_build_object('error', SQLERRM));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RETURN NEW;
END;
$function$;
