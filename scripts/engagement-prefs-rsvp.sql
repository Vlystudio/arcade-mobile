-- ============================================================
-- Engagement QoL: notification preferences + Monday RSVP
--
--  • profiles.notif_prefs jsonb — per-category mute switches. A missing key
--    or true means "send"; false means muted. Categories used by the push
--    sender (api/push/league.ts): 'league' (night reminders + round results)
--    and 'subs' (sub requests / filled).
--  • rpc_set_league_rsvp / rpc_my_team_rsvps — one-tap "you in Monday?" RSVP
--    on top of the existing league_rsvps table (PK user_id, week_of).
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS notif_prefs jsonb NOT NULL DEFAULT '{}'::jsonb;


-- ── RSVP: set the caller's status for the current league week ──
CREATE OR REPLACE FUNCTION public.rpc_set_league_rsvp(p_status text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_team uuid;
  v_week date := date_trunc('week', current_date)::date;  -- Monday of this week
BEGIN
  IF v_uid IS NULL THEN RETURN json_build_object('error','not_authenticated'); END IF;
  IF p_status NOT IN ('in','out','maybe') THEN RETURN json_build_object('error','bad_status'); END IF;

  SELECT team_id INTO v_team FROM team_members WHERE user_id = v_uid LIMIT 1;
  IF v_team IS NULL THEN RETURN json_build_object('error','no_team','message','Join a team first.'); END IF;

  INSERT INTO league_rsvps (user_id, team_id, week_of, status, updated_at)
  VALUES (v_uid, v_team, v_week, p_status, now())
  ON CONFLICT (user_id, week_of)
    DO UPDATE SET status = EXCLUDED.status, team_id = EXCLUDED.team_id, updated_at = now();

  RETURN json_build_object('ok', true, 'status', p_status, 'week_of', v_week);
END; $$;
REVOKE ALL ON FUNCTION public.rpc_set_league_rsvp(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_set_league_rsvp(text) TO authenticated;


-- ── RSVP: the caller's team roster + this week's responses ──
CREATE OR REPLACE FUNCTION public.rpc_my_team_rsvps()
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_team uuid;
  v_week date := date_trunc('week', current_date)::date;
BEGIN
  IF v_uid IS NULL THEN RETURN json_build_object('error','not_authenticated'); END IF;
  SELECT team_id INTO v_team FROM team_members WHERE user_id = v_uid LIMIT 1;
  IF v_team IS NULL THEN RETURN json_build_object('has_team', false); END IF;

  RETURN json_build_object(
    'has_team',  true,
    'week_of',   v_week,
    'team_name', (SELECT name FROM teams WHERE id = v_team),
    'my_status', (SELECT status FROM league_rsvps WHERE user_id = v_uid AND week_of = v_week),
    'members', (
      SELECT COALESCE(json_agg(json_build_object(
        'user_id', m.user_id, 'username', p.username, 'avatar_url', p.avatar_url,
        'status', r.status) ORDER BY (r.status = 'in') DESC, p.username), '[]'::json)
      FROM team_members m
      JOIN profiles p ON p.id = m.user_id
      LEFT JOIN league_rsvps r ON r.user_id = m.user_id AND r.week_of = v_week
      WHERE m.team_id = v_team
    ),
    'counts', (
      SELECT json_build_object(
        'in',    count(*) FILTER (WHERE r.status = 'in'),
        'out',   count(*) FILTER (WHERE r.status = 'out'),
        'maybe', count(*) FILTER (WHERE r.status = 'maybe'),
        'total', count(*)
      )
      FROM team_members m
      LEFT JOIN league_rsvps r ON r.user_id = m.user_id AND r.week_of = v_week
      WHERE m.team_id = v_team
    )
  );
END; $$;
REVOKE ALL ON FUNCTION public.rpc_my_team_rsvps() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_my_team_rsvps() TO authenticated;
