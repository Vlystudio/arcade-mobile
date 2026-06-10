-- ============================================================
-- Security hardening — P2 through P9
-- Run AFTER: rls-policies.sql, rpc-admin-actions.sql,
--            rls-security-patches.sql, venue-migration.sql
-- All statements are idempotent (safe to re-run).
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- P7: Admin audit log (dependency for P3 RPCs below)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id    uuid        REFERENCES profiles(id) ON DELETE SET NULL,
  action      text        NOT NULL,
  target_type text,
  target_id   text,
  details     jsonb,
  created_at  timestamptz DEFAULT now()
);

ALTER TABLE admin_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can read audit log"  ON admin_audit_log;
CREATE POLICY "Admins can read audit log" ON admin_audit_log
  FOR SELECT USING (public.is_admin());

DROP POLICY IF EXISTS "System writes to audit log" ON admin_audit_log;
CREATE POLICY "System writes to audit log" ON admin_audit_log
  FOR INSERT WITH CHECK (public.is_admin());

CREATE INDEX IF NOT EXISTS idx_audit_log_admin_id   ON admin_audit_log (admin_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON admin_audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_action     ON admin_audit_log (action);

-- ────────────────────────────────────────────────────────────
-- P5: Rate-limit infrastructure
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rate_limit_log (
  id         bigserial   PRIMARY KEY,
  user_id    uuid        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  action     text        NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE rate_limit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "No direct access to rate_limit_log" ON rate_limit_log;
CREATE POLICY "No direct access to rate_limit_log" ON rate_limit_log
  FOR ALL USING (false);

CREATE INDEX IF NOT EXISTS idx_rate_limit_user_action_time
  ON rate_limit_log (user_id, action, created_at DESC);

-- Returns void; raises P0001 if limit exceeded, then logs the action.
CREATE OR REPLACE FUNCTION public.check_and_log_rate_limit(
  p_action         text,
  p_window_seconds int,
  p_max_count      int
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT COUNT(*) INTO v_count
    FROM rate_limit_log
   WHERE user_id    = auth.uid()
     AND action     = p_action
     AND created_at > now() - (p_window_seconds || ' seconds')::interval;

  IF v_count >= p_max_count THEN
    RAISE EXCEPTION 'Rate limit exceeded — too many % actions. Try again later.', p_action
      USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO rate_limit_log (user_id, action)
  VALUES (auth.uid(), p_action);

  -- Probabilistic cleanup: ~1% of calls purge entries older than 24 h
  IF random() < 0.01 THEN
    DELETE FROM rate_limit_log
     WHERE created_at < now() - interval '24 hours';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.check_and_log_rate_limit(text, int, int) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.check_and_log_rate_limit(text, int, int) TO authenticated;

-- Trigger functions for tables still using direct inserts -----

-- Posts: max 10 per hour per user
CREATE OR REPLACE FUNCTION public.rate_limit_post()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.check_and_log_rate_limit('post', 3600, 10);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_post_rate_limit ON posts;
CREATE TRIGGER enforce_post_rate_limit
  BEFORE INSERT ON posts
  FOR EACH ROW EXECUTE FUNCTION public.rate_limit_post();

-- Messages (DMs): max 60 per minute per user
CREATE OR REPLACE FUNCTION public.rate_limit_message()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.check_and_log_rate_limit('message', 60, 60);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_message_rate_limit ON messages;
CREATE TRIGGER enforce_message_rate_limit
  BEFORE INSERT ON messages
  FOR EACH ROW EXECUTE FUNCTION public.rate_limit_message();

-- Team messages: max 60 per minute per user
CREATE OR REPLACE FUNCTION public.rate_limit_team_message()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.check_and_log_rate_limit('team_message', 60, 60);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_team_message_rate_limit ON team_messages;
CREATE TRIGGER enforce_team_message_rate_limit
  BEFORE INSERT ON team_messages
  FOR EACH ROW EXECUTE FUNCTION public.rate_limit_team_message();

-- Forums: max 5 per hour per user
CREATE OR REPLACE FUNCTION public.rate_limit_forum()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.check_and_log_rate_limit('forum', 3600, 5);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_forum_rate_limit ON forums;
CREATE TRIGGER enforce_forum_rate_limit
  BEFORE INSERT ON forums
  FOR EACH ROW EXECUTE FUNCTION public.rate_limit_forum();

-- Team join requests: max 10 per day per user
CREATE OR REPLACE FUNCTION public.rate_limit_team_request()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.check_and_log_rate_limit('team_request', 86400, 10);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_team_request_rate_limit ON team_requests;
CREATE TRIGGER enforce_team_request_rate_limit
  BEFORE INSERT ON team_requests
  FOR EACH ROW EXECUTE FUNCTION public.rate_limit_team_request();

-- ────────────────────────────────────────────────────────────
-- P6: DB constraints and performance indexes
-- ────────────────────────────────────────────────────────────

-- Scores: must be non-negative (no upper cap — pinball/arcade can exceed 9M)
ALTER TABLE scores
  DROP CONSTRAINT IF EXISTS scores_score_range,
  ADD  CONSTRAINT scores_score_range CHECK (score >= 0);

-- Profiles: username format (3-32 chars, letters/digits/underscores only)
ALTER TABLE profiles
  DROP CONSTRAINT IF EXISTS profiles_username_format,
  ADD  CONSTRAINT profiles_username_format
    CHECK (
      length(username) BETWEEN 3 AND 32
      AND username ~ '^[A-Za-z0-9_]+$'
    );

-- Posts: cap content at 2 000 characters
ALTER TABLE posts
  DROP CONSTRAINT IF EXISTS posts_content_length,
  ADD  CONSTRAINT posts_content_length CHECK (length(content) <= 2000);

-- Forums: cap title at 200 chars, content at 5 000 chars
ALTER TABLE forums
  DROP CONSTRAINT IF EXISTS forums_title_length,
  ADD  CONSTRAINT forums_title_length   CHECK (length(title)   <= 200);
ALTER TABLE forums
  DROP CONSTRAINT IF EXISTS forums_content_length,
  ADD  CONSTRAINT forums_content_length CHECK (length(content) <= 5000);

-- Performance indexes ------------------------------------------

CREATE INDEX IF NOT EXISTS idx_scores_user_status
  ON scores (user_id, status);

CREATE INDEX IF NOT EXISTS idx_scores_game_id
  ON scores (game_id);

CREATE INDEX IF NOT EXISTS idx_scores_status_created
  ON scores (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_messages_conv_created
  ON messages (conversation_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_posts_user_created
  ON posts (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_posts_created
  ON posts (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_forums_status_created
  ON forums (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_team_members_user
  ON team_members (user_id);

CREATE INDEX IF NOT EXISTS idx_friendships_user
  ON friendships (user_id);

CREATE INDEX IF NOT EXISTS idx_check_ins_user_status
  ON check_ins (user_id, status);

-- ────────────────────────────────────────────────────────────
-- P2: venue_admins table + is_venue_admin() helper
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS venue_admins (
  venue_id   uuid NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  granted_by uuid          REFERENCES profiles(id) ON DELETE SET NULL,
  granted_at timestamptz   DEFAULT now(),
  PRIMARY KEY (venue_id, user_id)
);

ALTER TABLE venue_admins ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read venue_admins"   ON venue_admins;
CREATE POLICY "Admins read venue_admins" ON venue_admins
  FOR SELECT USING (public.is_admin());

DROP POLICY IF EXISTS "Admins manage venue_admins" ON venue_admins;
CREATE POLICY "Admins manage venue_admins" ON venue_admins
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- Returns true for global admins OR explicit venue-admin entries
CREATE OR REPLACE FUNCTION public.is_venue_admin(p_venue_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.is_admin()
    OR EXISTS (
      SELECT 1 FROM venue_admins
       WHERE venue_id = p_venue_id
         AND user_id  = auth.uid()
    );
$$;

REVOKE ALL ON FUNCTION public.is_venue_admin(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.is_venue_admin(uuid) TO authenticated;

-- ────────────────────────────────────────────────────────────
-- P3: rpc_admin_update_forum_status (replaces direct UPDATE)
--
-- ⚠ SOURCE OF TRUTH: scripts/venue-role-hardening.sql (run order 12, "10.
-- Update forum admin RPC to accept venue admins") defines the production
-- rpc_admin_update_forum_status — it runs after this script (order 9) and
-- adds require_mfa(), venue-admin scoping (server-side venue_id lookup), and
-- security_events logging on denial, which this version lacks. CREATE OR
-- REPLACE means that later definition wins on a fresh full run. Do not
-- redefine rpc_admin_update_forum_status in a script that runs after order
-- 12 without keeping it in sync.
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_admin_update_forum_status(
  p_forum_id uuid,
  p_status   text   -- 'approved' | 'rejected'
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_forum record;
BEGIN
  IF NOT public.is_admin() THEN
    RETURN json_build_object('error', 'unauthorized', 'message', 'Admin only.');
  END IF;

  IF p_status NOT IN ('approved', 'rejected') THEN
    RETURN json_build_object('error', 'invalid_status',
      'message', 'Status must be approved or rejected.');
  END IF;

  SELECT id, title INTO v_forum FROM forums WHERE id = p_forum_id;
  IF NOT FOUND THEN
    RETURN json_build_object('error', 'not_found');
  END IF;

  UPDATE forums SET status = p_status WHERE id = p_forum_id;

  INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (
    auth.uid(), 'forum_status_update', 'forum', p_forum_id::text,
    json_build_object('new_status', p_status, 'title', v_forum.title)::jsonb
  );

  RETURN json_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_admin_update_forum_status(uuid, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.rpc_admin_update_forum_status(uuid, text) TO authenticated;

-- ────────────────────────────────────────────────────────────
-- P3: rpc_submit_score (validates & inserts score server-side)
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_submit_score(
  p_game_id     uuid,
  p_lane_id     uuid,
  p_check_in_id uuid,
  p_venue_id    uuid,
  p_score       integer,
  p_frame_data  jsonb DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_score_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN json_build_object('error', 'unauthenticated');
  END IF;

  IF p_score < 0 THEN
    RETURN json_build_object('error', 'invalid_score',
      'message', 'Score cannot be negative.');
  END IF;

  -- Validate check_in ownership when provided
  IF p_check_in_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM check_ins
       WHERE id      = p_check_in_id
         AND user_id = auth.uid()
    ) THEN
      RETURN json_build_object('error', 'invalid_check_in',
        'message', 'Check-in does not belong to this user.');
    END IF;
  END IF;

  -- Rate limit: 20 score submissions per hour
  PERFORM public.check_and_log_rate_limit('score_submit', 3600, 20);

  INSERT INTO scores (
    user_id, game_id, lane_id, check_in_id, venue_id,
    score, frame_data, status
  ) VALUES (
    auth.uid(), p_game_id, p_lane_id, p_check_in_id, p_venue_id,
    p_score, p_frame_data, 'pending'
  )
  RETURNING id INTO v_score_id;

  RETURN json_build_object('ok', true, 'score_id', v_score_id);
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_submit_score(uuid, uuid, uuid, uuid, integer, jsonb) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.rpc_submit_score(uuid, uuid, uuid, uuid, integer, jsonb) TO authenticated;

-- ────────────────────────────────────────────────────────────
-- P9: public_profiles view + role-escalation guard trigger
-- ────────────────────────────────────────────────────────────

-- Safe public view — no role flags, no email, no sensitive admin data
CREATE OR REPLACE VIEW public.public_profiles AS
  SELECT
    id,
    username,
    avatar_url,
    bio,
    created_at
  FROM profiles
  WHERE id IS NOT NULL;

-- Role-escalation guard: non-admins cannot change is_admin,
-- is_arcade_official, or role on any profile row.
CREATE OR REPLACE FUNCTION public.guard_role_escalation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    IF NEW.is_admin IS DISTINCT FROM OLD.is_admin THEN
      RAISE EXCEPTION 'Not authorized to change is_admin';
    END IF;
    IF NEW.is_arcade_official IS DISTINCT FROM OLD.is_arcade_official THEN
      RAISE EXCEPTION 'Not authorized to change is_arcade_official';
    END IF;
    -- Guard the role column if it exists on profiles
    IF TG_TABLE_NAME = 'profiles' AND
       to_jsonb(NEW) ? 'role' AND
       (to_jsonb(NEW)->>'role') IS DISTINCT FROM (to_jsonb(OLD)->>'role') THEN
      RAISE EXCEPTION 'Not authorized to change role';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_role_escalation_trigger ON profiles;
CREATE TRIGGER guard_role_escalation_trigger
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_role_escalation();

-- ────────────────────────────────────────────────────────────
-- Phase 1 tables: team preferences, schedule, announcements,
-- and team chat (run if not already applied)
-- ────────────────────────────────────────────────────────────

ALTER TABLE teams
  ADD COLUMN IF NOT EXISTS slot_pref_1 text,
  ADD COLUMN IF NOT EXISTS slot_pref_2 text;

CREATE TABLE IF NOT EXISTS team_schedule (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id      uuid        NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  week_label   text        NOT NULL,
  slot         text        NOT NULL,
  created_at   timestamptz DEFAULT now(),
  UNIQUE (team_id, week_label)
);

ALTER TABLE team_schedule ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Auth users can read team_schedule" ON team_schedule;
CREATE POLICY "Auth users can read team_schedule" ON team_schedule
  FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Admins manage team_schedule" ON team_schedule;
CREATE POLICY "Admins manage team_schedule" ON team_schedule
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE TABLE IF NOT EXISTS team_announcements (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id    uuid        NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id    uuid        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  content    text        NOT NULL CHECK (length(content) <= 1000),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE team_announcements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Team members can read announcements" ON team_announcements;
CREATE POLICY "Team members can read announcements" ON team_announcements
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM team_members
       WHERE team_id = team_announcements.team_id
         AND user_id = auth.uid()
    ) OR public.is_admin()
  );

DROP POLICY IF EXISTS "Captain or admin can post announcements" ON team_announcements;
CREATE POLICY "Captain or admin can post announcements" ON team_announcements
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
    AND (
      public.is_admin()
      OR EXISTS (
        SELECT 1 FROM team_members
         WHERE team_id = team_announcements.team_id
           AND user_id = auth.uid()
           AND role    = 'captain'
      )
      OR EXISTS (
        SELECT 1 FROM teams
         WHERE id              = team_announcements.team_id
           AND captain_user_id = auth.uid()
      )
    )
  );

CREATE TABLE IF NOT EXISTS team_messages (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id    uuid        NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id    uuid        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  content    text        NOT NULL CHECK (length(content) <= 2000),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE team_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Team members can read team messages" ON team_messages;
CREATE POLICY "Team members can read team messages" ON team_messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM team_members
       WHERE team_id = team_messages.team_id
         AND user_id = auth.uid()
    ) OR public.is_admin()
  );

DROP POLICY IF EXISTS "Team members can send messages" ON team_messages;
CREATE POLICY "Team members can send messages" ON team_messages
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM team_members
       WHERE team_id = team_messages.team_id
         AND user_id = auth.uid()
    )
  );

-- Enable realtime for team_messages
ALTER PUBLICATION supabase_realtime ADD TABLE team_messages;

-- ────────────────────────────────────────────────────────────
-- P4: Additional storage bucket hardening (avatars, team-photos,
--     message-media — supplement rls-security-patches.sql)
-- ────────────────────────────────────────────────────────────

-- avatars: public read, owner write/delete only
INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Users upload own avatar"  ON storage.objects;
CREATE POLICY "Users upload own avatar" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'avatars'
    AND auth.role() = 'authenticated'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "Public read avatars"      ON storage.objects;
CREATE POLICY "Public read avatars" ON storage.objects
  FOR SELECT USING (bucket_id = 'avatars');

DROP POLICY IF EXISTS "Users delete own avatar"  ON storage.objects;
CREATE POLICY "Users delete own avatar" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'avatars'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- message-media: sender can upload, conversation participants can read
INSERT INTO storage.buckets (id, name, public)
VALUES ('message-media', 'message-media', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Users upload own message media" ON storage.objects;
CREATE POLICY "Users upload own message media" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'message-media'
    AND auth.role() = 'authenticated'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "Users read own message media"   ON storage.objects;
CREATE POLICY "Users read own message media" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'message-media'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

DROP POLICY IF EXISTS "Users delete own message media" ON storage.objects;
CREATE POLICY "Users delete own message media" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'message-media'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- team-photos: public read, team members upload/delete
INSERT INTO storage.buckets (id, name, public)
VALUES ('team-photos', 'team-photos', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Team members upload team photos" ON storage.objects;
CREATE POLICY "Team members upload team photos" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'team-photos'
    AND auth.role() = 'authenticated'
  );

DROP POLICY IF EXISTS "Public read team photos"         ON storage.objects;
CREATE POLICY "Public read team photos" ON storage.objects
  FOR SELECT USING (bucket_id = 'team-photos');

DROP POLICY IF EXISTS "Users delete own team photos"    ON storage.objects;
CREATE POLICY "Users delete own team photos" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'team-photos'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );
