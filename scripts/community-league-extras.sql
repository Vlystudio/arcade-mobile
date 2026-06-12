-- ============================================================
-- Community & league extras (one migration):
--  1. Reports v2: forum posts/comments + user profiles become
--     reportable; standard categories added (spam, harassment,
--     impersonation, false_information)
--  2. user_blocks: block/unblock users
--  3. saved_posts: bookmarks
--  4. post_reactions: emoji reactions on feed posts
--  5. forum_polls + votes
--  6. League ops: RSVP, sub requests, score disputes,
--     profiles.sub_available
--  7. pickem_picks + leaderboard RPC
--  8. venue_events + RSVPs
--  9. app_announcements + admin broadcast RPC
-- 10. rpc_skeeball_hall_of_fame
-- 11. rpc_public_standings (anon-readable, for the public site)
-- ============================================================

-- ── 1. Reports v2 ───────────────────────────────────────────
ALTER TABLE content_reports DROP CONSTRAINT IF EXISTS content_reports_content_type_check;
ALTER TABLE content_reports ADD CONSTRAINT content_reports_content_type_check
  CHECK (content_type IN ('post', 'comment', 'forum_post', 'forum_comment', 'profile'));

ALTER TABLE content_reports DROP CONSTRAINT IF EXISTS content_reports_reason_check;
ALTER TABLE content_reports ADD CONSTRAINT content_reports_reason_check
  CHECK (reason IN (
    'inappropriate_picture', 'inappropriate_text', 'racism', 'violence', 'nudity',
    'spam', 'harassment', 'impersonation', 'false_information', 'other'
  ));

CREATE OR REPLACE FUNCTION public.rpc_report_content(
  p_content_type text,
  p_content_id   uuid,
  p_reason       text,
  p_details      text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_post_id  uuid;
  v_owner_id uuid;
  v_details  text;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN json_build_object('error', 'not_authenticated');
  END IF;

  IF p_content_type NOT IN ('post', 'comment', 'forum_post', 'forum_comment', 'profile') THEN
    RETURN json_build_object('error', 'invalid_content_type');
  END IF;

  IF p_reason NOT IN (
    'inappropriate_picture', 'inappropriate_text', 'racism', 'violence', 'nudity',
    'spam', 'harassment', 'impersonation', 'false_information', 'other'
  ) THEN
    RETURN json_build_object('error', 'invalid_reason');
  END IF;

  v_details := NULLIF(TRIM(LEFT(COALESCE(p_details, ''), 500)), '');

  IF p_content_type = 'post' THEN
    SELECT id, user_id INTO v_post_id, v_owner_id FROM posts WHERE id = p_content_id;
  ELSIF p_content_type = 'comment' THEN
    SELECT post_id, user_id INTO v_post_id, v_owner_id FROM post_comments WHERE id = p_content_id;
  ELSIF p_content_type = 'forum_post' THEN
    SELECT id, user_id INTO v_post_id, v_owner_id FROM forum_posts WHERE id = p_content_id;
    v_post_id := NULL; -- post_id FK is feed-posts only
  ELSIF p_content_type = 'forum_comment' THEN
    SELECT id, user_id INTO v_post_id, v_owner_id FROM forum_post_comments WHERE id = p_content_id;
    v_post_id := NULL;
  ELSE -- profile
    SELECT id, id INTO v_post_id, v_owner_id FROM profiles WHERE id = p_content_id;
    v_post_id := NULL;
  END IF;

  IF v_owner_id IS NULL THEN
    RETURN json_build_object('error', 'not_found');
  END IF;

  IF v_owner_id = auth.uid() THEN
    RETURN json_build_object('error', 'cannot_report_own_content');
  END IF;

  INSERT INTO content_reports (reporter_id, content_type, content_id, post_id, reason, details)
  VALUES (auth.uid(), p_content_type, p_content_id, v_post_id, p_reason, v_details)
  ON CONFLICT (reporter_id, content_type, content_id)
  DO UPDATE SET
    reason      = EXCLUDED.reason,
    details     = EXCLUDED.details,
    status      = 'pending',
    reviewed_by = NULL,
    reviewed_at = NULL,
    created_at  = now();

  RETURN json_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_admin_get_content_reports(
  p_status text DEFAULT 'pending'
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.require_mfa();

  IF NOT public.is_arcade_official() THEN
    INSERT INTO security_events (event_type, severity, user_id, details)
    VALUES ('admin_access_denied', 'warn', auth.uid(),
      jsonb_build_object('rpc', 'rpc_admin_get_content_reports'))
    ON CONFLICT DO NOTHING;
    RETURN json_build_object('error', 'unauthorized');
  END IF;

  IF p_status NOT IN ('pending', 'dismissed', 'actioned') THEN
    RETURN json_build_object('error', 'invalid_status');
  END IF;

  RETURN (
    SELECT COALESCE(json_agg(row_to_json(q)), '[]'::json)
    FROM (
      SELECT
        cr.id,
        cr.content_type,
        cr.content_id,
        cr.post_id,
        cr.reason,
        cr.details,
        cr.status,
        cr.created_at,
        reporter.username AS reporter_username,
        -- Owner + preview resolved per content type
        CASE cr.content_type
          WHEN 'post'          THEN (SELECT pr.username FROM posts x JOIN profiles pr ON pr.id = x.user_id WHERE x.id = cr.content_id)
          WHEN 'comment'       THEN (SELECT pr.username FROM post_comments x JOIN profiles pr ON pr.id = x.user_id WHERE x.id = cr.content_id)
          WHEN 'forum_post'    THEN (SELECT pr.username FROM forum_posts x JOIN profiles pr ON pr.id = x.user_id WHERE x.id = cr.content_id)
          WHEN 'forum_comment' THEN (SELECT pr.username FROM forum_post_comments x JOIN profiles pr ON pr.id = x.user_id WHERE x.id = cr.content_id)
          WHEN 'profile'       THEN (SELECT pr.username FROM profiles pr WHERE pr.id = cr.content_id)
        END AS owner_username,
        CASE cr.content_type
          WHEN 'post'          THEN (SELECT LEFT(COALESCE(x.content, ''), 280) FROM posts x WHERE x.id = cr.content_id)
          WHEN 'comment'       THEN (SELECT LEFT(x.content, 280) FROM post_comments x WHERE x.id = cr.content_id)
          WHEN 'forum_post'    THEN (SELECT LEFT(x.content, 280) FROM forum_posts x WHERE x.id = cr.content_id)
          WHEN 'forum_comment' THEN (SELECT LEFT(x.content, 280) FROM forum_post_comments x WHERE x.id = cr.content_id)
          WHEN 'profile'       THEN (SELECT LEFT(COALESCE(pr.bio, '(profile)'), 280) FROM profiles pr WHERE pr.id = cr.content_id)
        END AS content_preview,
        CASE cr.content_type
          WHEN 'post' THEN (SELECT x.photo_url FROM posts x WHERE x.id = cr.content_id)
        END AS photo_url
      FROM content_reports cr
      LEFT JOIN profiles reporter ON reporter.id = cr.reporter_id
      WHERE cr.status = p_status
      ORDER BY cr.created_at ASC
      LIMIT 200
    ) q
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_admin_resolve_content_report(
  p_report_id uuid,
  p_action    text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_report content_reports%ROWTYPE;
  v_new_status text;
BEGIN
  PERFORM public.require_mfa();

  IF NOT public.is_arcade_official() THEN
    INSERT INTO security_events (event_type, severity, user_id, details)
    VALUES ('admin_access_denied', 'warn', auth.uid(),
      jsonb_build_object('rpc', 'rpc_admin_resolve_content_report', 'report_id', p_report_id))
    ON CONFLICT DO NOTHING;
    RETURN json_build_object('error', 'unauthorized');
  END IF;

  IF p_action NOT IN ('dismiss', 'remove_content', 'mark_actioned') THEN
    RETURN json_build_object('error', 'invalid_action');
  END IF;

  SELECT * INTO v_report FROM content_reports WHERE id = p_report_id;
  IF v_report.id IS NULL THEN
    RETURN json_build_object('error', 'not_found');
  END IF;

  IF p_action = 'remove_content' THEN
    IF v_report.content_type = 'post' THEN
      DELETE FROM posts WHERE id = v_report.content_id;
    ELSIF v_report.content_type = 'comment' THEN
      DELETE FROM post_comments WHERE id = v_report.content_id;
    ELSIF v_report.content_type = 'forum_post' THEN
      DELETE FROM forum_posts WHERE id = v_report.content_id;
    ELSIF v_report.content_type = 'forum_comment' THEN
      DELETE FROM forum_post_comments WHERE id = v_report.content_id;
    ELSE
      -- Profiles are never deleted from a report; treat as actioned
      NULL;
    END IF;
    v_new_status := 'actioned';
  ELSIF p_action = 'mark_actioned' THEN
    v_new_status := 'actioned';
  ELSE
    v_new_status := 'dismissed';
  END IF;

  UPDATE content_reports
  SET status = v_new_status, reviewed_by = auth.uid(), reviewed_at = now()
  WHERE id = p_report_id;

  IF p_action = 'remove_content' THEN
    UPDATE content_reports
    SET status = 'actioned', reviewed_by = auth.uid(), reviewed_at = now()
    WHERE content_type = v_report.content_type
      AND content_id = v_report.content_id
      AND status = 'pending';
  END IF;

  INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'content_report_resolved', v_report.content_type, v_report.content_id::text,
          jsonb_build_object('report_id', p_report_id, 'action', p_action));

  RETURN json_build_object('ok', true);
END;
$$;

-- ── 2. Blocks ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_blocks (
  blocker_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  blocked_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id != blocked_id)
);
ALTER TABLE public.user_blocks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "blocks_own_select" ON public.user_blocks;
CREATE POLICY "blocks_own_select" ON public.user_blocks FOR SELECT TO authenticated USING (blocker_id = auth.uid());
DROP POLICY IF EXISTS "blocks_own_insert" ON public.user_blocks;
CREATE POLICY "blocks_own_insert" ON public.user_blocks FOR INSERT TO authenticated WITH CHECK (blocker_id = auth.uid());
DROP POLICY IF EXISTS "blocks_own_delete" ON public.user_blocks;
CREATE POLICY "blocks_own_delete" ON public.user_blocks FOR DELETE TO authenticated USING (blocker_id = auth.uid());

-- ── 3. Saved posts ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.saved_posts (
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, post_id)
);
ALTER TABLE public.saved_posts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "saved_own_all_select" ON public.saved_posts;
CREATE POLICY "saved_own_all_select" ON public.saved_posts FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS "saved_own_all_insert" ON public.saved_posts;
CREATE POLICY "saved_own_all_insert" ON public.saved_posts FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "saved_own_all_delete" ON public.saved_posts;
CREATE POLICY "saved_own_all_delete" ON public.saved_posts FOR DELETE TO authenticated USING (user_id = auth.uid());

-- ── 4. Emoji reactions (one per user per post) ──────────────
CREATE TABLE IF NOT EXISTS public.post_reactions (
  post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  emoji text NOT NULL CHECK (emoji IN ('👍', '❤️', '😂', '🔥', '🎯', '😮')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);
ALTER TABLE public.post_reactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "reactions_select" ON public.post_reactions;
CREATE POLICY "reactions_select" ON public.post_reactions FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "reactions_own_insert" ON public.post_reactions;
CREATE POLICY "reactions_own_insert" ON public.post_reactions FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "reactions_own_update" ON public.post_reactions;
CREATE POLICY "reactions_own_update" ON public.post_reactions FOR UPDATE TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS "reactions_own_delete" ON public.post_reactions;
CREATE POLICY "reactions_own_delete" ON public.post_reactions FOR DELETE TO authenticated USING (user_id = auth.uid());

-- ── 5. Forum polls ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.forum_polls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL UNIQUE REFERENCES forum_posts(id) ON DELETE CASCADE,
  options jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (jsonb_array_length(options) BETWEEN 2 AND 4)
);
ALTER TABLE public.forum_polls ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "polls_select" ON public.forum_polls;
CREATE POLICY "polls_select" ON public.forum_polls FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "polls_insert_own_post" ON public.forum_polls;
CREATE POLICY "polls_insert_own_post" ON public.forum_polls FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM forum_posts fp WHERE fp.id = post_id AND fp.user_id = auth.uid()));

CREATE TABLE IF NOT EXISTS public.forum_poll_votes (
  poll_id uuid NOT NULL REFERENCES forum_polls(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  option_idx int NOT NULL CHECK (option_idx >= 0 AND option_idx <= 3),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (poll_id, user_id)
);
ALTER TABLE public.forum_poll_votes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "poll_votes_select" ON public.forum_poll_votes;
CREATE POLICY "poll_votes_select" ON public.forum_poll_votes FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "poll_votes_own_insert" ON public.forum_poll_votes;
CREATE POLICY "poll_votes_own_insert" ON public.forum_poll_votes FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "poll_votes_own_update" ON public.forum_poll_votes;
CREATE POLICY "poll_votes_own_update" ON public.forum_poll_votes FOR UPDATE TO authenticated USING (user_id = auth.uid());

-- ── 6. League ops: RSVP, subs, disputes ─────────────────────
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS sub_available boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.league_rsvps (
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  week_of date NOT NULL,
  status text NOT NULL CHECK (status IN ('in', 'out')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, week_of)
);
ALTER TABLE public.league_rsvps ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "rsvps_select" ON public.league_rsvps;
CREATE POLICY "rsvps_select" ON public.league_rsvps FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "rsvps_own_insert" ON public.league_rsvps;
CREATE POLICY "rsvps_own_insert" ON public.league_rsvps FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "rsvps_own_update" ON public.league_rsvps;
CREATE POLICY "rsvps_own_update" ON public.league_rsvps FOR UPDATE TO authenticated USING (user_id = auth.uid());

CREATE TABLE IF NOT EXISTS public.sub_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  week_of date NOT NULL,
  note text CHECK (note IS NULL OR char_length(note) <= 300),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'filled', 'cancelled')),
  requested_by uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  filled_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.sub_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "subs_select" ON public.sub_requests;
CREATE POLICY "subs_select" ON public.sub_requests FOR SELECT TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public.rpc_request_sub(
  p_team_id uuid,
  p_week_of date,
  p_note text DEFAULT NULL
)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RETURN json_build_object('error', 'not_authenticated'); END IF;
  IF NOT EXISTS (SELECT 1 FROM team_members WHERE team_id = p_team_id AND user_id = auth.uid()) THEN
    RETURN json_build_object('error', 'unauthorized', 'message', 'Only team members can request a sub.');
  END IF;
  IF EXISTS (SELECT 1 FROM sub_requests WHERE team_id = p_team_id AND week_of = p_week_of AND status = 'open') THEN
    RETURN json_build_object('error', 'exists', 'message', 'Your team already has an open sub request for that week.');
  END IF;
  INSERT INTO sub_requests (team_id, week_of, note, requested_by)
  VALUES (p_team_id, p_week_of, NULLIF(TRIM(LEFT(COALESCE(p_note, ''), 300)), ''), auth.uid())
  RETURNING id INTO v_id;
  RETURN json_build_object('ok', true, 'id', v_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_claim_sub(p_request_id uuid)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_req sub_requests%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RETURN json_build_object('error', 'not_authenticated'); END IF;
  -- Atomic claim: only one volunteer can flip open → filled
  UPDATE sub_requests SET status = 'filled', filled_by = auth.uid()
   WHERE id = p_request_id AND status = 'open'
   RETURNING * INTO v_req;
  IF v_req.id IS NULL THEN
    RETURN json_build_object('error', 'unavailable', 'message', 'This sub spot was already filled or cancelled.');
  END IF;
  IF EXISTS (SELECT 1 FROM team_members WHERE team_id = v_req.team_id AND user_id = auth.uid()) THEN
    -- A teammate can't sub for their own team; revert
    UPDATE sub_requests SET status = 'open', filled_by = NULL WHERE id = p_request_id;
    RETURN json_build_object('error', 'own_team', 'message', 'You are already on this team.');
  END IF;
  RETURN json_build_object('ok', true, 'team_id', v_req.team_id, 'week_of', v_req.week_of);
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_cancel_sub(p_request_id uuid)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN json_build_object('error', 'not_authenticated'); END IF;
  UPDATE sub_requests SET status = 'cancelled'
   WHERE id = p_request_id AND status IN ('open', 'filled')
     AND (requested_by = auth.uid()
          OR EXISTS (SELECT 1 FROM team_members tm WHERE tm.team_id = sub_requests.team_id AND tm.user_id = auth.uid()));
  IF NOT FOUND THEN
    RETURN json_build_object('error', 'not_found');
  END IF;
  RETURN json_build_object('ok', true);
END;
$$;

CREATE TABLE IF NOT EXISTS public.score_disputes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES skeeball_sessions(id) ON DELETE CASCADE,
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  raised_by uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 5 AND 500),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
  admin_note text,
  resolved_by uuid REFERENCES profiles(id),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.score_disputes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "disputes_select" ON public.score_disputes;
CREATE POLICY "disputes_select" ON public.score_disputes FOR SELECT TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public.rpc_raise_score_dispute(
  p_session_id uuid,
  p_reason text
)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_sess skeeball_sessions%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RETURN json_build_object('error', 'not_authenticated'); END IF;
  SELECT * INTO v_sess FROM skeeball_sessions WHERE id = p_session_id;
  IF v_sess.id IS NULL OR v_sess.status != 'completed' THEN
    RETURN json_build_object('error', 'invalid', 'message', 'Only completed games can be disputed.');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM team_members WHERE team_id = v_sess.team_id AND user_id = auth.uid()) THEN
    RETURN json_build_object('error', 'unauthorized', 'message', 'Only team members can dispute their score.');
  END IF;
  IF v_sess.completed_at < now() - interval '7 days' THEN
    RETURN json_build_object('error', 'too_late', 'message', 'Disputes must be raised within 7 days of the game.');
  END IF;
  IF EXISTS (SELECT 1 FROM score_disputes WHERE session_id = p_session_id AND status = 'open') THEN
    RETURN json_build_object('error', 'exists', 'message', 'A dispute is already open for this game.');
  END IF;
  IF char_length(TRIM(COALESCE(p_reason, ''))) < 5 THEN
    RETURN json_build_object('error', 'invalid', 'message', 'Please describe what was entered incorrectly.');
  END IF;
  INSERT INTO score_disputes (session_id, team_id, raised_by, reason)
  VALUES (p_session_id, v_sess.team_id, auth.uid(), TRIM(LEFT(p_reason, 500)));
  RETURN json_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_admin_resolve_dispute(
  p_dispute_id uuid,
  p_action text,
  p_note text DEFAULT NULL
)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RETURN json_build_object('error', 'unauthorized');
  END IF;
  IF p_action NOT IN ('resolved', 'dismissed') THEN
    RETURN json_build_object('error', 'invalid_action');
  END IF;
  UPDATE score_disputes
     SET status = p_action, admin_note = NULLIF(TRIM(LEFT(COALESCE(p_note, ''), 500)), ''),
         resolved_by = auth.uid(), resolved_at = now()
   WHERE id = p_dispute_id AND status = 'open';
  IF NOT FOUND THEN RETURN json_build_object('error', 'not_found'); END IF;
  INSERT INTO admin_audit_log (admin_id, action, target_id, details)
  VALUES (auth.uid(), 'score_dispute_resolved', p_dispute_id::text,
          json_build_object('action', p_action, 'note', p_note)::text);
  RETURN json_build_object('ok', true);
END;
$$;

-- ── 7. Pick'em ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.pickem_picks (
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  week_of date NOT NULL,
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, week_of)
);
ALTER TABLE public.pickem_picks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "picks_select" ON public.pickem_picks;
CREATE POLICY "picks_select" ON public.pickem_picks FOR SELECT TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public.rpc_make_pick(p_team_id uuid)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_week date := public.skeeball_current_week();
BEGIN
  IF auth.uid() IS NULL THEN RETURN json_build_object('error', 'not_authenticated'); END IF;
  -- Picks lock the moment the first team finishes a game that week
  IF EXISTS (SELECT 1 FROM skeeball_sessions WHERE week_of = v_week AND status = 'completed') THEN
    RETURN json_build_object('error', 'locked', 'message', 'Picks are locked — this week''s games already started.');
  END IF;
  INSERT INTO pickem_picks (user_id, week_of, team_id)
  VALUES (auth.uid(), v_week, p_team_id)
  ON CONFLICT (user_id, week_of) DO UPDATE SET team_id = EXCLUDED.team_id, created_at = now();
  RETURN json_build_object('ok', true, 'week_of', v_week);
END;
$$;

-- Correct pick = team with the highest game score that week (ties all count)
CREATE OR REPLACE FUNCTION public.rpc_pickem_leaderboard(
  p_start date DEFAULT NULL,
  p_end date DEFAULT NULL
)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rows json;
BEGIN
  IF auth.uid() IS NULL THEN RETURN json_build_object('error', 'not_authenticated'); END IF;

  WITH team_weeks AS (
    SELECT ss.week_of, ss.team_id,
           MAX((SELECT COALESCE(SUM(score), 0) FROM skeeball_ball_scores b WHERE b.session_id = ss.id)
               + ss.score_adjustment) AS best_score
      FROM skeeball_sessions ss
     WHERE ss.status = 'completed' AND ss.league_match_id IS NOT NULL
       AND (p_start IS NULL OR ss.week_of >= p_start)
       AND (p_end IS NULL OR ss.week_of <= p_end)
     GROUP BY ss.week_of, ss.team_id
  ),
  winners AS (
    SELECT week_of, team_id
      FROM (SELECT week_of, team_id,
                   RANK() OVER (PARTITION BY week_of ORDER BY best_score DESC) AS rnk
              FROM team_weeks) r
     WHERE rnk = 1
  ),
  scored AS (
    SELECT pp.user_id,
           COUNT(*)::int AS picks,
           COUNT(*) FILTER (WHERE EXISTS (
             SELECT 1 FROM winners w WHERE w.week_of = pp.week_of AND w.team_id = pp.team_id
           ))::int AS correct
      FROM pickem_picks pp
     WHERE EXISTS (SELECT 1 FROM team_weeks tw WHERE tw.week_of = pp.week_of)
       AND (p_start IS NULL OR pp.week_of >= p_start)
       AND (p_end IS NULL OR pp.week_of <= p_end)
     GROUP BY pp.user_id
  )
  SELECT json_agg(json_build_object(
           'user_id', s.user_id,
           'username', COALESCE(pr.username, 'Unknown'),
           'avatar_url', pr.avatar_url,
           'picks', s.picks,
           'correct', s.correct
         ) ORDER BY s.correct DESC, s.picks ASC)
    INTO v_rows
    FROM scored s
    LEFT JOIN profiles pr ON pr.id = s.user_id;

  RETURN json_build_object('ok', true, 'leaderboard', COALESCE(v_rows, '[]'::json));
END;
$$;

-- ── 8. Venue events ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.venue_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (char_length(title) BETWEEN 2 AND 80),
  description text CHECK (description IS NULL OR char_length(description) <= 500),
  event_type text NOT NULL DEFAULT 'event',
  starts_at timestamptz NOT NULL,
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.venue_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "events_select" ON public.venue_events;
CREATE POLICY "events_select" ON public.venue_events FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "events_admin_insert" ON public.venue_events;
CREATE POLICY "events_admin_insert" ON public.venue_events FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'owner', 'architect')));
DROP POLICY IF EXISTS "events_admin_delete" ON public.venue_events;
CREATE POLICY "events_admin_delete" ON public.venue_events FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'owner', 'architect')));

CREATE TABLE IF NOT EXISTS public.event_rsvps (
  event_id uuid NOT NULL REFERENCES venue_events(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, user_id)
);
ALTER TABLE public.event_rsvps ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "event_rsvps_select" ON public.event_rsvps;
CREATE POLICY "event_rsvps_select" ON public.event_rsvps FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "event_rsvps_own_insert" ON public.event_rsvps;
CREATE POLICY "event_rsvps_own_insert" ON public.event_rsvps FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "event_rsvps_own_delete" ON public.event_rsvps;
CREATE POLICY "event_rsvps_own_delete" ON public.event_rsvps FOR DELETE TO authenticated USING (user_id = auth.uid());

-- ── 9. Broadcast announcements ──────────────────────────────
CREATE TABLE IF NOT EXISTS public.app_announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (char_length(title) BETWEEN 2 AND 80),
  body text NOT NULL CHECK (char_length(body) BETWEEN 2 AND 300),
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
ALTER TABLE public.app_announcements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "announcements_select" ON public.app_announcements;
CREATE POLICY "announcements_select" ON public.app_announcements FOR SELECT TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public.rpc_admin_broadcast(
  p_title text,
  p_body text,
  p_days int DEFAULT 3
)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT public.is_admin() THEN
    RETURN json_build_object('error', 'unauthorized');
  END IF;
  INSERT INTO app_announcements (title, body, created_by, expires_at)
  VALUES (TRIM(p_title), TRIM(p_body), auth.uid(), now() + make_interval(days => GREATEST(LEAST(p_days, 30), 1)))
  RETURNING id INTO v_id;
  INSERT INTO admin_audit_log (admin_id, action, target_id, details)
  VALUES (auth.uid(), 'broadcast_announcement', v_id::text, json_build_object('title', p_title)::text);
  RETURN json_build_object('ok', true, 'id', v_id);
END;
$$;

-- ── 10. Hall of Fame ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_skeeball_hall_of_fame()
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_highest json; v_best_week json; v_hundos json; v_streak json;
  v_team_game json; v_team_points json;
BEGIN
  IF auth.uid() IS NULL THEN RETURN json_build_object('error', 'not_authenticated'); END IF;

  DROP TABLE IF EXISTS _hof_games;
  CREATE TEMP TABLE _hof_games ON COMMIT DROP AS
  SELECT ss.id AS session_id, ss.week_of, ss.team_id, ss.created_at,
         bs.player_user_id, SUM(bs.score)::int AS game_score
    FROM skeeball_sessions ss
    JOIN skeeball_ball_scores bs ON bs.session_id = ss.id
   WHERE ss.status = 'completed'
   GROUP BY ss.id, ss.week_of, ss.team_id, ss.created_at, bs.player_user_id;

  -- Highest single game
  SELECT json_build_object('username', pr.username, 'avatar_url', pr.avatar_url, 'value', g.game_score, 'week_of', g.week_of)
    INTO v_highest
    FROM _hof_games g JOIN profiles pr ON pr.id = g.player_user_id
   ORDER BY g.game_score DESC, g.week_of LIMIT 1;

  -- Best week average (min 2 games that week)
  SELECT json_build_object('username', pr.username, 'avatar_url', pr.avatar_url, 'value', w.avg, 'week_of', w.week_of)
    INTO v_best_week
    FROM (SELECT player_user_id, week_of, ROUND(AVG(game_score))::int AS avg, COUNT(*) AS games
            FROM _hof_games GROUP BY player_user_id, week_of HAVING COUNT(*) >= 2) w
    JOIN profiles pr ON pr.id = w.player_user_id
   ORDER BY w.avg DESC, w.week_of LIMIT 1;

  -- Most career hundos
  SELECT json_build_object('username', pr.username, 'avatar_url', pr.avatar_url, 'value', h.cnt)
    INTO v_hundos
    FROM (SELECT bs.player_user_id, COUNT(*)::int AS cnt
            FROM skeeball_ball_scores bs
            JOIN skeeball_sessions ss ON ss.id = bs.session_id AND ss.status = 'completed'
           WHERE bs.score = 100 GROUP BY bs.player_user_id) h
    JOIN profiles pr ON pr.id = h.player_user_id
   ORDER BY h.cnt DESC LIMIT 1;

  -- Longest hundo streak (consecutive balls, per player)
  SELECT json_build_object('username', pr.username, 'avatar_url', pr.avatar_url, 'value', s.best)
    INTO v_streak
    FROM (
      SELECT player_user_id, MAX(cnt)::int AS best FROM (
        SELECT player_user_id, COUNT(*) AS cnt FROM (
          SELECT bs.player_user_id,
                 ROW_NUMBER() OVER (PARTITION BY bs.player_user_id ORDER BY ss.week_of, ss.created_at, bs.ball_number)
                 - ROW_NUMBER() OVER (PARTITION BY bs.player_user_id, (bs.score = 100) ORDER BY ss.week_of, ss.created_at, bs.ball_number) AS grp,
                 bs.score
            FROM skeeball_ball_scores bs
            JOIN skeeball_sessions ss ON ss.id = bs.session_id AND ss.status = 'completed'
        ) seq
        WHERE seq.score = 100
        GROUP BY player_user_id, grp
      ) runs
      GROUP BY player_user_id
    ) s
    JOIN profiles pr ON pr.id = s.player_user_id
   ORDER BY s.best DESC LIMIT 1;

  -- Highest team game (9-ball total)
  SELECT json_build_object('team_name', t.name, 'value', tg.total, 'week_of', tg.week_of)
    INTO v_team_game
    FROM (SELECT session_id, team_id, week_of, SUM(game_score)::int AS total
            FROM _hof_games GROUP BY session_id, team_id, week_of) tg
    JOIN teams t ON t.id = tg.team_id
   ORDER BY tg.total DESC, tg.week_of LIMIT 1;

  -- Most all-time league points
  SELECT json_build_object('team_name', t.name, 'value', p.pts)
    INTO v_team_points
    FROM (SELECT team_id, SUM(COALESCE(league_points, 0) + league_points_adjustment)::int AS pts
            FROM skeeball_sessions WHERE status = 'completed' GROUP BY team_id) p
    JOIN teams t ON t.id = p.team_id
   ORDER BY p.pts DESC LIMIT 1;

  DROP TABLE IF EXISTS _hof_games;

  RETURN json_build_object(
    'ok', true,
    'highest_game', v_highest,
    'best_week_avg', v_best_week,
    'most_hundos', v_hundos,
    'longest_streak', v_streak,
    'team_highest_game', v_team_game,
    'team_most_points', v_team_points
  );
END;
$$;

-- ── 11. Public standings (anon-readable, for the public site) ─
CREATE OR REPLACE FUNCTION public.rpc_public_standings()
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_season skeeball_seasons%ROWTYPE;
  v_rows json;
BEGIN
  SELECT * INTO v_season FROM skeeball_seasons WHERE status = 'active' ORDER BY start_week DESC LIMIT 1;

  WITH sess AS (
    SELECT ss.team_id,
           COALESCE(ss.league_points, 0) + ss.league_points_adjustment AS pts,
           ss.placement
      FROM skeeball_sessions ss
     WHERE ss.status = 'completed'
       AND (v_season.id IS NULL OR (ss.week_of >= v_season.start_week AND ss.week_of <= v_season.end_week))
  )
  SELECT json_agg(row_json) INTO v_rows FROM (
    SELECT json_build_object(
             'team_name', t.name,
             'matches_played', COUNT(*)::int,
             'gold', COUNT(*) FILTER (WHERE s.placement = 1)::int,
             'total_points', COALESCE(SUM(s.pts), 0)::int
           ) AS row_json,
           COALESCE(SUM(s.pts), 0) AS total
      FROM sess s JOIN teams t ON t.id = s.team_id
     GROUP BY t.name ORDER BY total DESC LIMIT 20
  ) ranked;

  RETURN json_build_object(
    'ok', true,
    'season_name', v_season.name,
    'standings', COALESCE(v_rows, '[]'::json)
  );
END;
$$;

-- ── Grants ──────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.rpc_request_sub(uuid, date, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_claim_sub(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_cancel_sub(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_raise_score_dispute(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_admin_resolve_dispute(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_make_pick(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_pickem_leaderboard(date, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_admin_broadcast(text, text, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_skeeball_hall_of_fame() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_public_standings() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_request_sub(uuid, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_claim_sub(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_cancel_sub(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_raise_score_dispute(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_resolve_dispute(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_make_pick(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_pickem_leaderboard(date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_broadcast(text, text, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_skeeball_hall_of_fame() TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_public_standings() TO anon, authenticated;


-- ── Week history now includes the session id (score disputes) ─
CREATE OR REPLACE FUNCTION public.rpc_skeeball_team_week_history(
  p_team_id uuid,
  p_start date DEFAULT NULL,
  p_end date DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_weeks json;
  v_upcoming json;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN json_build_object('error', 'not_authenticated');
  END IF;

  WITH own AS (
    SELECT ss.id, ss.week_of, ss.league_match_id, ss.placement,
           COALESCE(ss.league_points, 0) + ss.league_points_adjustment AS points,
           (SELECT COALESCE(SUM(score), 0)::int FROM skeeball_ball_scores b WHERE b.session_id = ss.id)
             + ss.score_adjustment AS game_score
      FROM skeeball_sessions ss
     WHERE ss.team_id = p_team_id
       AND ss.status = 'completed'
       AND ss.league_match_id IS NOT NULL
       AND (p_start IS NULL OR ss.week_of >= p_start)
       AND (p_end IS NULL OR ss.week_of <= p_end)
  )
  SELECT json_agg(json_build_object(
      'session_id', o.id,
      'week_of', o.week_of,
      'placement', o.placement,
      'points', o.points,
      'game_score', o.game_score,
      'slot_time', (
        SELECT ts.slot_time FROM team_schedule ts
         WHERE ts.team_id = p_team_id AND ts.week_of = o.week_of
         LIMIT 1
      ),
      'opponents', COALESCE((
        SELECT json_agg(json_build_object(
                 'team_id', os.team_id,
                 'team_name', COALESCE(t.name, 'Unknown'),
                 'placement', os.placement,
                 'game_score', (SELECT COALESCE(SUM(score), 0)::int FROM skeeball_ball_scores b WHERE b.session_id = os.id)
                   + os.score_adjustment
               ) ORDER BY os.placement NULLS LAST)
          FROM skeeball_sessions os
          JOIN teams t ON t.id = os.team_id
         WHERE os.league_match_id = o.league_match_id
           AND os.team_id != p_team_id
           AND os.status = 'completed'
      ), '[]'::json)
    ) ORDER BY o.week_of)
    INTO v_weeks
    FROM own o;

  SELECT json_build_object('week_of', ts.week_of, 'slot_time', ts.slot_time, 'week_label', ts.week_label)
    INTO v_upcoming
    FROM team_schedule ts
   WHERE ts.team_id = p_team_id
     AND ts.week_of IS NOT NULL
     AND ts.week_of >= public.skeeball_current_week()
     AND NOT EXISTS (
       SELECT 1 FROM skeeball_sessions ss
        WHERE ss.team_id = p_team_id AND ss.week_of = ts.week_of AND ss.status = 'completed'
     )
   ORDER BY ts.week_of
   LIMIT 1;

  RETURN json_build_object(
    'ok', true,
    'weeks', COALESCE(v_weeks, '[]'::json),
    'upcoming', v_upcoming
  );
END;
$$;
