-- Production public schema snapshot before the review security migration.
-- Requires the Supabase managed schemas/extensions; contains no application rows.
--
-- PostgreSQL database dump
--


-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: all_title_keys(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.all_title_keys() RETURNS text[]
    LANGUAGE sql IMMUTABLE
    AS $$
  SELECT ARRAY[
    'beta_founder',
    'centurion', 'monarch_50', 'smooth_roller', 'steady_hand', 'on_the_board', 'warming_up',
    'tournament_champion', 'season_champion',
    'the_creator', 'the_house', 'arcade_warden', 'vanguard'
  ];
$$;


--
-- Name: can_manage_venue(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_manage_venue(p_venue_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT public.is_venue_admin(p_venue_id);
$$;


--
-- Name: check_and_log_rate_limit(text, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_and_log_rate_limit(p_action text, p_window_seconds integer, p_max_count integer) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
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
    -- Log to security events
    INSERT INTO security_events (event_type, severity, user_id, details)
    VALUES (
      'rate_limit_hit', 'warn', auth.uid(),
      jsonb_build_object('action', p_action, 'count', v_count, 'max', p_max_count)
    );
    RAISE EXCEPTION 'Rate limit exceeded — too many % actions. Try again later.', p_action
      USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO rate_limit_log (user_id, action)
  VALUES (auth.uid(), p_action);

  IF random() < 0.01 THEN
    DELETE FROM rate_limit_log WHERE created_at < now() - interval '24 hours';
  END IF;
END;
$$;


--
-- Name: check_content_moderation(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_content_moderation(p_text text) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_row moderation_patterns%ROWTYPE;
BEGIN
  IF p_text IS NULL OR length(trim(p_text)) = 0 THEN
    RETURN NULL;
  END IF;

  -- Check against active patterns, highest severity first.
  -- case_sensitive patterns (e.g. ALL-CAPS detection) match the original
  -- text with ~; everything else matches lower(text) with ~* as before.
  SELECT * INTO v_row
    FROM moderation_patterns
   WHERE active = true
     AND (
       (case_sensitive AND p_text ~ pattern)
       OR (NOT case_sensitive AND lower(p_text) ~* pattern)
     )
   ORDER BY severity DESC, id ASC
   LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'flagged',   true,
      'category',  v_row.category,
      'severity',  v_row.severity,
      'pattern_id', v_row.id
    );
  END IF;

  RETURN NULL;
END;
$$;


--
-- Name: check_email_available(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_email_available(p_email text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM auth.users WHERE lower(email) = lower(p_email)
  );
$$;


--
-- Name: check_username_available(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_username_available(p_username text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE lower(username) = lower(p_username)
  );
$$;


--
-- Name: enforce_content_moderation(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_content_moderation() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
DECLARE
  v_result jsonb;
  v_fields text[];
  v_field  text;
  v_value  text;
BEGIN
  -- Determine which text columns to check based on table
  CASE TG_TABLE_NAME
    WHEN 'posts'              THEN v_fields := ARRAY['content'];
    WHEN 'team_messages'      THEN v_fields := ARRAY['content'];
    WHEN 'team_announcements' THEN v_fields := ARRAY['content'];
    WHEN 'profiles'           THEN v_fields := ARRAY['username', 'bio'];
    ELSE v_fields := ARRAY[]::text[];
  END CASE;

  FOREACH v_field IN ARRAY v_fields
  LOOP
    EXECUTE format('SELECT ($1).%I::text', v_field) INTO v_value USING NEW;
    v_result := public.check_content_moderation(v_value);

    IF v_result IS NOT NULL THEN
      IF (v_result->>'category') = 'hate_speech' THEN
        RAISE EXCEPTION 'Your message contains language that is not allowed on this platform. Please revise and try again.'
          USING ERRCODE = 'P0002';
      ELSIF (v_result->>'category') = 'profanity' THEN
        RAISE EXCEPTION 'Your message contains inappropriate language. Please keep it clean!'
          USING ERRCODE = 'P0002';
      ELSE
        RAISE EXCEPTION 'Your message was flagged as spam. Please try again.'
          USING ERRCODE = 'P0002';
      END IF;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$_$;


--
-- Name: enforce_equipped_title(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_equipped_title() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.equipped_title IS NOT NULL
     AND NEW.equipped_title IS DISTINCT FROM OLD.equipped_title THEN
    IF NOT (NEW.equipped_title = ANY(public.user_earned_title_keys(NEW.id))) THEN
      RAISE EXCEPTION 'You have not earned that title.' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END; $$;


--
-- Name: enforce_team_creation_payment(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_team_creation_payment() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  -- Only enforced while a paid season is active
  IF NOT EXISTS (
    SELECT 1 FROM seasons
     WHERE status = 'active' AND registration_required = true
  ) THEN
    RETURN NEW;
  END IF;

  -- Service role (no JWT) and admins bypass — admin tools create teams
  -- for assignments and imports
  IF auth.uid() IS NULL OR public.is_admin() THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM team_registrations tr
      JOIN seasons s ON s.id = tr.season_id
     WHERE tr.user_id = auth.uid()
       AND tr.status = 'paid'
       AND tr.registration_type = 'team'
       AND s.status = 'active'
       AND s.registration_required = true
  ) THEN
    RAISE EXCEPTION 'A paid team registration is required to create a team this season.'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: fantasy_full_mode(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fantasy_full_mode() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT
    (SELECT full_mode_enabled FROM fantasy_config WHERE id = 1)
    OR (SELECT count(*) FROM skeeball_seasons
         WHERE status = 'completed' AND counts_for_fantasy)
       >= (SELECT seasons_required FROM fantasy_config WHERE id = 1);
$$;


--
-- Name: fantasy_line_multiplier(uuid, integer, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fantasy_line_multiplier(p_team_id uuid, p_line integer, p_pick text) RETURNS numeric
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_weeks int;
  v_hits  int;
  v_p     numeric;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE wk_pts > p_line)
    INTO v_weeks, v_hits
    FROM (
      SELECT week_of,
             SUM(COALESCE(league_points, 0) + COALESCE(league_points_adjustment, 0)) AS wk_pts
        FROM skeeball_sessions
       WHERE team_id = p_team_id AND status = 'completed'
       GROUP BY week_of
    ) w;

  v_p := (v_hits + 1.0) / (v_weeks + 2.0);          -- P(over)
  IF p_pick = 'under' THEN v_p := 1.0 - v_p; END IF;
  v_p := LEAST(GREATEST(v_p, 0.05), 0.95);

  RETURN ROUND(LEAST(GREATEST(0.92 / v_p, 1.15), 8.0), 2);
END;
$$;


--
-- Name: fantasy_settle_pending(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fantasy_settle_pending() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_now_week date := public.skeeball_current_week();
  v_pred     record;
  v_pts      int;
  v_week     date;
BEGIN
  -- one settler at a time; others skip instead of waiting
  IF NOT pg_try_advisory_xact_lock(hashtext('fantasy_settle')) THEN
    RETURN;
  END IF;

  FOR v_pred IN
    SELECT * FROM fantasy_predictions
     WHERE status = 'pending' AND week_of < v_now_week
     ORDER BY week_of
  LOOP
    v_pts := public.fantasy_team_week_points(v_pred.team_id, v_pred.week_of);

    IF v_pts IS NULL THEN
      UPDATE fantasy_predictions
         SET status = 'void', payout = stake, settled_at = now()
       WHERE id = v_pred.id;
      UPDATE fantasy_wallets
         SET balance = balance + v_pred.stake, updated_at = now()
       WHERE user_id = v_pred.user_id;

    ELSIF (v_pred.pick = 'over'  AND v_pts > v_pred.line)
       OR (v_pred.pick = 'under' AND v_pts <= v_pred.line) THEN
      UPDATE fantasy_predictions
         SET status = 'won',
             result_points = v_pts,
             payout = ROUND(v_pred.stake * v_pred.multiplier)::int,
             settled_at = now()
       WHERE id = v_pred.id;
      UPDATE fantasy_wallets
         SET balance = balance + ROUND(v_pred.stake * v_pred.multiplier)::int,
             lifetime_earned = lifetime_earned
               + ROUND(v_pred.stake * v_pred.multiplier)::int - v_pred.stake,
             updated_at = now()
       WHERE user_id = v_pred.user_id;

    ELSE
      UPDATE fantasy_predictions
         SET status = 'lost', result_points = v_pts, payout = 0, settled_at = now()
       WHERE id = v_pred.id;
    END IF;
  END LOOP;

  -- Weekly top-predictor bonus for any fully-settled past week not yet awarded
  FOR v_week IN
    SELECT DISTINCT p.week_of
      FROM fantasy_predictions p
     WHERE p.week_of < v_now_week
       AND p.status IN ('won', 'lost')
       AND NOT EXISTS (SELECT 1 FROM fantasy_week_bonuses b WHERE b.week_of = p.week_of)
       AND NOT EXISTS (SELECT 1 FROM fantasy_predictions q
                        WHERE q.week_of = p.week_of AND q.status = 'pending')
  LOOP
    WITH nets AS (
      SELECT user_id, SUM(payout - stake) AS net
        FROM fantasy_predictions
       WHERE week_of = v_week AND status IN ('won', 'lost')
       GROUP BY user_id
    ), winners AS (
      SELECT user_id FROM nets
       WHERE net > 0 AND net = (SELECT max(net) FROM nets)
    ), award AS (
      UPDATE fantasy_wallets w
         SET balance = balance + 25, lifetime_earned = lifetime_earned + 25, updated_at = now()
        FROM winners
       WHERE w.user_id = winners.user_id
       RETURNING w.user_id
    )
    INSERT INTO fantasy_week_bonuses (week_of, awarded_to)
    SELECT v_week, COALESCE(array_agg(user_id), '{}')
      FROM award;
  END LOOP;
END;
$$;


--
-- Name: fantasy_team_week_points(uuid, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fantasy_team_week_points(p_team_id uuid, p_week date) RETURNS integer
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT CASE WHEN count(*) = 0 THEN NULL
              ELSE COALESCE(SUM(COALESCE(league_points, 0) + COALESCE(league_points_adjustment, 0)), 0)::int
         END
  FROM skeeball_sessions
  WHERE team_id = p_team_id AND week_of = p_week AND status = 'completed';
$$;


--
-- Name: fantasy_week_locked(date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fantasy_week_locked(p_week date) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM skeeball_sessions
     WHERE week_of = p_week AND status = 'completed'
  );
$$;


--
-- Name: flag_forum_content(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.flag_forum_content() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_result jsonb;
  v_combined text;
BEGIN
  v_combined := coalesce(NEW.title, '') || ' ' || coalesce(NEW.description, '');
  v_result   := public.check_content_moderation(v_combined);

  IF v_result IS NOT NULL THEN
    NEW.auto_flagged  := true;
    NEW.flag_category := v_result->>'category';
  ELSE
    NEW.auto_flagged  := false;
    NEW.flag_category := NULL;
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: get_email_by_username(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_email_by_username(p_username text) RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    AS $$
  SELECT u.email
  FROM auth.users u
  JOIN public.profiles p ON p.id = u.id
  WHERE lower(p.username) = lower(p_username)
  LIMIT 1;
$$;


--
-- Name: get_username_by_email(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_username_by_email(p_email text) RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    AS $$
  SELECT p.username
  FROM public.profiles p
  JOIN auth.users u ON u.id = p.id
  WHERE lower(u.email) = lower(p_email)
  LIMIT 1;
$$;


--
-- Name: grant_beta_founder(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.grant_beta_founder() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF COALESCE((SELECT beta_open FROM app_config WHERE id = 1), false) THEN
    INSERT INTO user_titles (user_id, title_key, source)
    VALUES (NEW.id, 'beta_founder', 'beta')
    ON CONFLICT (user_id, title_key) DO NOTHING;
  END IF;
  RETURN NEW;
END; $$;


--
-- Name: guard_role_escalation(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.guard_role_escalation() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NOT public.is_admin() THEN
    IF NEW.is_admin IS DISTINCT FROM OLD.is_admin THEN
      RAISE EXCEPTION 'Not authorized to change is_admin';
    END IF;
    IF NEW.is_arcade_official IS DISTINCT FROM OLD.is_arcade_official THEN
      RAISE EXCEPTION 'Not authorized to change is_arcade_official';
    END IF;
    IF TG_TABLE_NAME = 'profiles' AND
       to_jsonb(NEW) ? 'is_beta_tester' AND
       (to_jsonb(NEW)->>'is_beta_tester') IS DISTINCT FROM (to_jsonb(OLD)->>'is_beta_tester') THEN
      RAISE EXCEPTION 'Not authorized to change is_beta_tester';
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


--
-- Name: handle_new_user(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;


--
-- Name: hash_lane_token(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.hash_lane_token(p_raw text) RETURNS text
    LANGUAGE sql IMMUTABLE SECURITY DEFINER
    SET search_path TO 'public', 'extensions'
    AS $$
  SELECT encode(digest(p_raw::bytea, 'sha256'), 'hex');
$$;


--
-- Name: is_admin(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_admin() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT COALESCE(
    (SELECT is_admin FROM profiles WHERE id = auth.uid()),
    false
  );
$$;


--
-- Name: is_arcade_official(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_arcade_official() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT COALESCE(
    (SELECT is_arcade_official OR is_admin FROM profiles WHERE id = auth.uid()),
    false
  );
$$;


--
-- Name: is_owner_or_architect(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_owner_or_architect() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('owner','architect'));
$$;


--
-- Name: is_platform_admin(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_platform_admin() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT COALESCE(
    (SELECT is_admin FROM profiles WHERE id = auth.uid()),
    false
  );
$$;


--
-- Name: is_venue_admin(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_venue_admin(p_venue_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT
    public.is_platform_admin()
    OR EXISTS (
      SELECT 1 FROM venue_admins
       WHERE venue_id = p_venue_id
         AND user_id  = auth.uid()
         AND role     IN ('owner', 'admin')
    );
$$;


--
-- Name: is_venue_owner(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_venue_owner(p_venue_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT
    public.is_platform_admin()
    OR EXISTS (
      SELECT 1 FROM venue_admins
       WHERE venue_id = p_venue_id
         AND user_id  = auth.uid()
         AND role     = 'owner'
    );
$$;


--
-- Name: is_venue_staff(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_venue_staff(p_venue_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT
    public.is_platform_admin()
    OR EXISTS (
      SELECT 1 FROM venue_admins
       WHERE venue_id = p_venue_id
         AND user_id  = auth.uid()
         -- all roles including staff
    );
$$;


--
-- Name: log_payment_security_event(text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.log_payment_security_event(p_event_type text, p_details jsonb DEFAULT NULL::jsonb) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  INSERT INTO security_events (event_type, severity, details)
  VALUES (
    p_event_type,
    CASE p_event_type
      WHEN 'payment_webhook_invalid_sig' THEN 'critical'
      WHEN 'payment_webhook_replay'      THEN 'warn'
      ELSE 'warn'
    END,
    p_details
  );
EXCEPTION WHEN OTHERS THEN
  NULL;
END;
$$;


--
-- Name: log_security_event(text, text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.log_security_event(p_event_type text, p_severity text DEFAULT 'info'::text, p_details jsonb DEFAULT NULL::jsonb) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  INSERT INTO security_events (event_type, severity, user_id, details)
  VALUES (
    p_event_type,
    p_severity,
    auth.uid(),
    p_details
  );
EXCEPTION WHEN OTHERS THEN
  -- Never let audit logging break the calling RPC
  NULL;
END;
$$;


--
-- Name: qr_token_fingerprint(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.qr_token_fingerprint(p_raw text) RETURNS text
    LANGUAGE sql IMMUTABLE SECURITY DEFINER
    SET search_path TO 'public', 'extensions'
    AS $$
  SELECT left(encode(digest(coalesce(p_raw, '')::bytea, 'sha256'), 'hex'), 12);
$$;


--
-- Name: queue_post_photo_cleanup(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.queue_post_photo_cleanup() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF OLD.photo_url IS NOT NULL THEN
    -- Extract path from URL (everything after /post-photos/)
    INSERT INTO storage_cleanup_queue (bucket, path, reason)
    VALUES (
      'post-photos',
      regexp_replace(OLD.photo_url, '^.*/post-photos/', ''),
      'post_deleted'
    );
  END IF;
  RETURN OLD;
END;
$$;


--
-- Name: queue_score_proof_cleanup(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.queue_score_proof_cleanup() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.status = 'denied'
     AND OLD.status <> 'denied'
     AND NEW.proof_storage_path IS NOT NULL THEN
    INSERT INTO storage_cleanup_queue (bucket, path, reason)
    VALUES ('score-proofs', NEW.proof_storage_path, 'score_denied');
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: require_mfa(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.require_mfa() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF (auth.jwt() ->> 'aal') IS DISTINCT FROM 'aal2' THEN
    RAISE EXCEPTION 'MFA verification required for this action.'
      USING ERRCODE = 'P0003';
  END IF;
END; $$;


--
-- Name: rpc_accept_tos(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_accept_tos(p_version text) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN json_build_object('error', 'not_authenticated');
  END IF;

  UPDATE profiles
     SET tos_accepted_version = p_version
   WHERE id = auth.uid();

  RETURN json_build_object('ok', true, 'version', p_version);
END;
$$;


--
-- Name: rpc_admin_add_ff_guest(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_admin_add_ff_guest(p_tournament_id uuid, p_guest_name text) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_count    int;
  v_venue_id uuid;
BEGIN
  PERFORM public.require_mfa();

  SELECT venue_id INTO v_venue_id
    FROM tournaments
   WHERE id = p_tournament_id AND is_individual = true AND game_type = 'Skee-Ball';

  IF NOT FOUND THEN RETURN json_build_object('error','not_ff_tournament'); END IF;

  IF NOT (public.is_admin() OR
          (v_venue_id IS NOT NULL AND public.can_manage_venue(v_venue_id))) THEN
    INSERT INTO security_events (event_type, severity, user_id, details)
    VALUES ('admin_access_denied', 'warn', auth.uid(),
      jsonb_build_object('rpc', 'rpc_admin_add_ff_guest', 'tournament_id', p_tournament_id))
    ON CONFLICT DO NOTHING;
    RETURN json_build_object('error','unauthorized');
  END IF;

  IF EXISTS (SELECT 1 FROM ff_bracket_rounds WHERE tournament_id = p_tournament_id) THEN
    RETURN json_build_object('error','bracket_already_generated');
  END IF;

  SELECT COUNT(*) INTO v_count FROM tournament_registrations
  WHERE tournament_id = p_tournament_id AND status = 'accepted';

  IF v_count >= 32 THEN RETURN json_build_object('error','tournament_full'); END IF;

  IF trim(p_guest_name) = '' OR trim(p_guest_name) IS NULL THEN
    RETURN json_build_object('error','name_required');
  END IF;

  INSERT INTO tournament_registrations (tournament_id, user_id, guest_name, status)
  VALUES (p_tournament_id, NULL, trim(p_guest_name), 'accepted');

  INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'add_ff_guest', 'tournament', p_tournament_id::text,
          jsonb_build_object('guest_name', trim(p_guest_name)));

  RETURN json_build_object('ok', true);
END; $$;


--
-- Name: rpc_admin_adjust_skeeball_session(uuid, integer, integer, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_admin_adjust_skeeball_session(p_session_id uuid, p_league_points_adjustment integer, p_score_adjustment integer, p_note text DEFAULT NULL::text) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF NOT public.is_admin() THEN
    RETURN json_build_object('error','unauthorized');
  END IF;
  UPDATE skeeball_sessions
  SET league_points_adjustment = p_league_points_adjustment,
      score_adjustment = p_score_adjustment
  WHERE id = p_session_id;
  INSERT INTO admin_audit_log (admin_id, action, target_id, details)
  VALUES (v_uid, 'skeeball_adjustment', p_session_id::text,
    json_build_object('lp_adj', p_league_points_adjustment, 'score_adj', p_score_adjustment, 'note', p_note)::text);
  RETURN json_build_object('ok', true);
END;$$;


--
-- Name: rpc_admin_approve_tournament(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_admin_approve_tournament(p_request_id uuid) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_req      record;
  v_tourn_id uuid;
BEGIN
  PERFORM public.require_mfa();

  SELECT * INTO v_req FROM tournament_requests WHERE id = p_request_id;
  IF NOT FOUND THEN
    RETURN json_build_object('error', 'not_found');
  END IF;

  IF NOT (public.is_admin() OR
          (v_req.venue_id IS NOT NULL AND public.can_manage_venue(v_req.venue_id))) THEN
    INSERT INTO security_events (event_type, severity, user_id, details)
    VALUES ('admin_access_denied', 'warn', auth.uid(),
      jsonb_build_object('rpc', 'rpc_admin_approve_tournament', 'request_id', p_request_id))
    ON CONFLICT DO NOTHING;
    RETURN json_build_object('error', 'unauthorized', 'message', 'Admin only.');
  END IF;

  IF v_req.status <> 'pending' THEN
    RETURN json_build_object('error', 'already_processed', 'message', 'Request is not pending.');
  END IF;

  UPDATE tournament_requests SET status = 'approved' WHERE id = p_request_id;

  INSERT INTO tournaments (
    title, description, game_type, proposed_date,
    max_teams, is_official, status, created_by, venue_id
  ) VALUES (
    v_req.title, v_req.description, v_req.game_type, v_req.proposed_date,
    COALESCE(v_req.max_teams, 8), false, 'upcoming', v_req.user_id, v_req.venue_id
  )
  RETURNING id INTO v_tourn_id;

  INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'approve_tournament_request', 'tournament_request', p_request_id::text,
          jsonb_build_object('tournament_id', v_tourn_id, 'title', v_req.title));

  RETURN json_build_object('ok', true, 'tournament_id', v_tourn_id);
END;
$$;


--
-- Name: rpc_admin_assign_team_member(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_admin_assign_team_member(p_team_id uuid, p_user_id uuid) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_venue_id uuid;
BEGIN
  PERFORM public.require_mfa();

  SELECT venue_id INTO v_venue_id FROM teams WHERE id = p_team_id;
  IF NOT FOUND THEN
    RETURN json_build_object('error', 'not_found');
  END IF;

  IF NOT (public.is_admin() OR
          (v_venue_id IS NOT NULL AND public.can_manage_venue(v_venue_id))) THEN
    INSERT INTO security_events (event_type, severity, user_id, details)
    VALUES ('admin_access_denied', 'warn', auth.uid(),
      jsonb_build_object('rpc', 'rpc_admin_assign_team_member', 'team_id', p_team_id, 'target_user', p_user_id))
    ON CONFLICT DO NOTHING;
    RETURN json_build_object('error', 'unauthorized', 'message', 'Admin only.');
  END IF;

  INSERT INTO team_members (team_id, user_id, role)
  VALUES (p_team_id, p_user_id, 'player')
  ON CONFLICT (team_id, user_id) DO NOTHING;

  UPDATE team_requests
     SET status = 'approved'
   WHERE team_id = p_team_id AND user_id = p_user_id
     AND direction = 'request' AND status = 'pending';

  INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'assign_team_member', 'team', p_team_id::text,
          jsonb_build_object('user_id', p_user_id));

  RETURN json_build_object('ok', true);
END;
$$;


--
-- Name: rpc_admin_broadcast(text, text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_admin_broadcast(p_title text, p_body text, p_days integer DEFAULT 3) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: rpc_admin_bulk_create_teams(text[], uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_admin_bulk_create_teams(p_names text[], p_venue_id uuid DEFAULT NULL::uuid) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_name     text;
  v_created  text[] := '{}';
  v_skipped  text[] := '{}';
BEGIN
  PERFORM public.require_mfa();

  IF NOT (public.is_admin() OR
          (p_venue_id IS NOT NULL AND public.can_manage_venue(p_venue_id))) THEN
    INSERT INTO security_events (event_type, severity, user_id, details)
    VALUES ('admin_access_denied', 'warn', auth.uid(),
      jsonb_build_object('rpc', 'rpc_admin_bulk_create_teams', 'venue_id', p_venue_id))
    ON CONFLICT DO NOTHING;
    RETURN json_build_object('error', 'unauthorized', 'message', 'Admin only.');
  END IF;

  FOREACH v_name IN ARRAY p_names LOOP
    v_name := trim(v_name);
    IF v_name = '' THEN
      CONTINUE;
    ELSIF length(v_name) < 2 OR length(v_name) > 40 THEN
      v_skipped := array_append(v_skipped, v_name);
    ELSE
      INSERT INTO teams (name, venue_id, captain_user_id)
      VALUES (v_name, p_venue_id, NULL);
      v_created := array_append(v_created, v_name);
    END IF;
  END LOOP;

  IF array_length(v_created, 1) > 0 THEN
    INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details)
    VALUES (auth.uid(), 'bulk_create_teams', 'team', NULL,
            jsonb_build_object('names', v_created, 'venue_id', p_venue_id));
  END IF;

  RETURN json_build_object('ok', true, 'created', v_created, 'skipped', v_skipped);
END;
$$;


--
-- Name: rpc_admin_create_first_friday(timestamp with time zone, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_admin_create_first_friday(p_date timestamp with time zone, p_label text, p_venue_id uuid DEFAULT NULL::uuid) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_id uuid;
BEGIN
  PERFORM public.require_mfa();

  IF NOT (public.is_admin() OR
          (p_venue_id IS NOT NULL AND public.can_manage_venue(p_venue_id))) THEN
    INSERT INTO security_events (event_type, severity, user_id, details)
    VALUES ('admin_access_denied', 'warn', auth.uid(),
      jsonb_build_object('rpc', 'rpc_admin_create_first_friday', 'venue_id', p_venue_id))
    ON CONFLICT DO NOTHING;
    RETURN json_build_object('error', 'unauthorized', 'message', 'Admin only.');
  END IF;

  INSERT INTO tournaments (
    title, game_type, proposed_date,
    is_official, is_individual, signup_type, status, max_players, venue_id
  ) VALUES (
    'First Friday Skee-Ball — ' || p_label,
    'Skee-Ball', p_date,
    true, true, 'in_person', 'upcoming', 32, p_venue_id
  )
  RETURNING id INTO v_id;

  INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'create_first_friday', 'tournament', v_id::text,
          jsonb_build_object('label', p_label, 'date', p_date, 'venue_id', p_venue_id));

  RETURN json_build_object('ok', true, 'tournament_id', v_id);
END;
$$;


--
-- Name: rpc_admin_create_score_proof_signed_url(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_admin_create_score_proof_signed_url(p_score_id uuid) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_score record;
BEGIN
  PERFORM public.require_mfa();

  SELECT id, proof_storage_path, venue_id INTO v_score
    FROM scores WHERE id = p_score_id;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'not_found');
  END IF;

  IF NOT (public.is_admin() OR public.is_venue_admin(v_score.venue_id)) THEN
    INSERT INTO security_events (event_type, severity, user_id, details)
    VALUES ('admin_access_denied', 'warn', auth.uid(),
      jsonb_build_object('rpc', 'rpc_admin_create_score_proof_signed_url', 'score_id', p_score_id))
    ON CONFLICT DO NOTHING;
    RETURN json_build_object('error', 'unauthorized');
  END IF;

  IF v_score.proof_storage_path IS NULL THEN
    RETURN json_build_object('error', 'no_proof',
      'message', 'This score has no attached proof.');
  END IF;

  RETURN json_build_object('ok', true, 'path', v_score.proof_storage_path);
END; $$;


--
-- Name: rpc_admin_delete_season_data(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_admin_delete_season_data(p_season_id uuid) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_name     text;
  v_start    date;
  v_end      date;
  v_sessions int;
  v_balls    int;
BEGIN
  PERFORM public.require_mfa();
  IF NOT public.is_owner_or_architect() THEN
    INSERT INTO security_events (event_type, severity, user_id, details)
    VALUES ('admin_access_denied','warn',auth.uid(),
      jsonb_build_object('rpc','rpc_admin_delete_season_data','season_id',p_season_id))
    ON CONFLICT DO NOTHING;
    RETURN json_build_object('error','unauthorized','message','Owner or architect only.');
  END IF;

  SELECT name, start_week, end_week INTO v_name, v_start, v_end
    FROM skeeball_seasons WHERE id = p_season_id;
  IF NOT FOUND THEN RETURN json_build_object('error','not_found'); END IF;

  SELECT count(*) INTO v_sessions FROM skeeball_sessions WHERE week_of BETWEEN v_start AND v_end;
  SELECT count(*) INTO v_balls
    FROM skeeball_ball_scores bs
    JOIN skeeball_sessions s ON s.id = bs.session_id
   WHERE s.week_of BETWEEN v_start AND v_end;

  DELETE FROM matches               WHERE season_id = p_season_id;
  DELETE FROM league_teams          WHERE season_id = p_season_id;
  DELETE FROM skeeball_sessions     WHERE week_of BETWEEN v_start AND v_end;  -- cascade
  DELETE FROM skeeball_league_matches WHERE week_of BETWEEN v_start AND v_end;
  DELETE FROM skeeball_seasons      WHERE id = p_season_id;

  INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(),'delete_season_data','season',p_season_id::text,
          jsonb_build_object('name',v_name,'start_week',v_start,'end_week',v_end,
                             'sessions_deleted',v_sessions,'balls_deleted',v_balls));

  RETURN json_build_object('ok',true,'name',v_name,'sessions_deleted',v_sessions,'balls_deleted',v_balls);
END; $$;


--
-- Name: rpc_admin_delete_team(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_admin_delete_team(p_team_id uuid) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_team_name text;
  v_venue_id  uuid;
BEGIN
  PERFORM public.require_mfa();

  SELECT name, venue_id INTO v_team_name, v_venue_id FROM teams WHERE id = p_team_id;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'not_found');
  END IF;

  IF NOT (public.is_admin() OR
          (v_venue_id IS NOT NULL AND public.can_manage_venue(v_venue_id))) THEN
    INSERT INTO security_events (event_type, severity, user_id, details)
    VALUES ('admin_access_denied', 'warn', auth.uid(),
      jsonb_build_object('rpc', 'rpc_admin_delete_team', 'team_id', p_team_id))
    ON CONFLICT DO NOTHING;
    RETURN json_build_object('error', 'unauthorized', 'message', 'Admin only.');
  END IF;

  DELETE FROM team_members  WHERE team_id = p_team_id;
  DELETE FROM team_requests WHERE team_id = p_team_id;
  DELETE FROM teams         WHERE id      = p_team_id;

  INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'delete_team', 'team', p_team_id::text,
          jsonb_build_object('team_name', v_team_name));

  RETURN json_build_object('ok', true);
END;
$$;


--
-- Name: rpc_admin_delete_tournament(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_admin_delete_tournament(p_tournament_id uuid) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_title    text;
  v_venue_id uuid;
BEGIN
  PERFORM public.require_mfa();

  SELECT title, venue_id INTO v_title, v_venue_id
    FROM tournaments WHERE id = p_tournament_id;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'tournament_not_found');
  END IF;

  IF NOT (public.is_admin() OR
          (v_venue_id IS NOT NULL AND public.can_manage_venue(v_venue_id))) THEN
    INSERT INTO security_events (event_type, severity, user_id, details)
    VALUES ('admin_access_denied', 'warn', auth.uid(),
      jsonb_build_object('rpc', 'rpc_admin_delete_tournament', 'tournament_id', p_tournament_id))
    ON CONFLICT DO NOTHING;
    RETURN json_build_object('error', 'unauthorized');
  END IF;

  DELETE FROM tournaments WHERE id = p_tournament_id;

  INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'delete_tournament', 'tournament', p_tournament_id::text,
          jsonb_build_object('title', v_title));

  RETURN json_build_object('ok', true);
END;
$$;


--
-- Name: rpc_admin_deny_tournament(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_admin_deny_tournament(p_request_id uuid, p_note text DEFAULT NULL::text) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_title    text;
  v_venue_id uuid;
BEGIN
  PERFORM public.require_mfa();

  SELECT title, venue_id INTO v_title, v_venue_id
    FROM tournament_requests WHERE id = p_request_id;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'not_found');
  END IF;

  IF NOT (public.is_admin() OR
          (v_venue_id IS NOT NULL AND public.can_manage_venue(v_venue_id))) THEN
    INSERT INTO security_events (event_type, severity, user_id, details)
    VALUES ('admin_access_denied', 'warn', auth.uid(),
      jsonb_build_object('rpc', 'rpc_admin_deny_tournament', 'request_id', p_request_id))
    ON CONFLICT DO NOTHING;
    RETURN json_build_object('error', 'unauthorized', 'message', 'Admin only.');
  END IF;

  UPDATE tournament_requests
     SET status = 'denied', admin_note = NULLIF(trim(COALESCE(p_note, '')), '')
   WHERE id = p_request_id AND status = 'pending'
   RETURNING title INTO v_title;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'already_processed');
  END IF;

  INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'deny_tournament_request', 'tournament_request', p_request_id::text,
          jsonb_build_object('title', v_title, 'note', p_note));

  RETURN json_build_object('ok', true);
END;
$$;


--
-- Name: rpc_admin_fantasy_set_full_mode(boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_admin_fantasy_set_full_mode(p_enabled boolean) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  PERFORM public.require_mfa();
  IF NOT public.is_admin() THEN
    INSERT INTO security_events (event_type, severity, user_id, details)
    VALUES ('admin_access_denied', 'warn', auth.uid(),
      jsonb_build_object('rpc', 'rpc_admin_fantasy_set_full_mode'))
    ON CONFLICT DO NOTHING;
    RETURN json_build_object('error', 'unauthorized');
  END IF;

  UPDATE fantasy_config SET full_mode_enabled = p_enabled, updated_at = now() WHERE id = 1;

  INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'fantasy_set_full_mode', 'fantasy_config', '1',
          jsonb_build_object('enabled', p_enabled));
  RETURN json_build_object('ok', true);
END;
$$;


--
-- Name: rpc_admin_fantasy_set_season_counts(uuid, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_admin_fantasy_set_season_counts(p_season_id uuid, p_counts boolean) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  PERFORM public.require_mfa();
  IF NOT public.is_admin() THEN
    INSERT INTO security_events (event_type, severity, user_id, details)
    VALUES ('admin_access_denied', 'warn', auth.uid(),
      jsonb_build_object('rpc', 'rpc_admin_fantasy_set_season_counts'))
    ON CONFLICT DO NOTHING;
    RETURN json_build_object('error', 'unauthorized');
  END IF;

  UPDATE skeeball_seasons SET counts_for_fantasy = p_counts WHERE id = p_season_id;
  IF NOT FOUND THEN RETURN json_build_object('error', 'not_found'); END IF;

  INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'fantasy_set_season_counts', 'skeeball_season', p_season_id::text,
          jsonb_build_object('counts_for_fantasy', p_counts));
  RETURN json_build_object('ok', true);
END;
$$;


--
-- Name: rpc_admin_generate_ff_signup_qr(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_admin_generate_ff_signup_qr(p_tournament_id uuid) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_token    uuid := gen_random_uuid();
  v_title    text;
  v_venue_id uuid;
BEGIN
  PERFORM public.require_mfa();

  SELECT title, venue_id INTO v_title, v_venue_id
    FROM tournaments
   WHERE id = p_tournament_id AND is_individual = true;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'not_found');
  END IF;

  IF NOT (public.is_admin() OR
          (v_venue_id IS NOT NULL AND public.can_manage_venue(v_venue_id))) THEN
    INSERT INTO security_events (event_type, severity, user_id, details)
    VALUES ('admin_access_denied', 'warn', auth.uid(),
      jsonb_build_object('rpc', 'rpc_admin_generate_ff_signup_qr', 'tournament_id', p_tournament_id))
    ON CONFLICT DO NOTHING;
    RETURN json_build_object('error', 'unauthorized');
  END IF;

  UPDATE tournaments
     SET signup_qr_token     = v_token,
         signup_qr_active    = true,
         signup_qr_issued_at = now()
   WHERE id = p_tournament_id;

  INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'generate_ff_qr', 'tournament', p_tournament_id::text,
          jsonb_build_object('title', v_title));

  RETURN json_build_object('ok', true, 'token', v_token);
END;
$$;


--
-- Name: rpc_admin_generate_lane_qr_token(uuid, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_admin_generate_lane_qr_token(p_lane_id uuid, p_ttl_hours integer DEFAULT NULL::integer) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_raw_token  text;
  v_hash       text;
  v_venue_id   uuid;
  v_lane_num   int;
  v_expires_at timestamptz;
BEGIN
  PERFORM public.require_mfa();

  SELECT venue_id, lane_number INTO v_venue_id, v_lane_num
    FROM lanes WHERE id = p_lane_id;
  IF NOT FOUND THEN
    RETURN json_build_object('error', 'lane_not_found');
  END IF;

  IF NOT (public.is_admin() OR public.is_venue_admin(v_venue_id)) THEN
    RETURN json_build_object('error', 'unauthorized',
      'message', 'You do not have admin rights for this venue.');
  END IF;

  -- Reissuing revokes the lane's previous active tokens (old printed codes stop working).
  UPDATE lane_qr_tokens
     SET revoked_at = now()
   WHERE lane_id = p_lane_id AND revoked_at IS NULL;

  v_raw_token := gen_random_uuid()::text;
  v_hash      := public.hash_lane_token(v_raw_token);
  v_expires_at := CASE
    WHEN p_ttl_hours IS NULL OR p_ttl_hours <= 0 THEN 'infinity'::timestamptz
    ELSE now() + (p_ttl_hours || ' hours')::interval
  END;

  INSERT INTO lane_qr_tokens (lane_id, venue_id, token_hash, expires_at, created_by)
  VALUES (p_lane_id, v_venue_id, v_hash, v_expires_at, auth.uid());

  INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (
    auth.uid(), 'generate_lane_qr_token', 'lane', p_lane_id::text,
    jsonb_build_object(
      'venue_id', v_venue_id, 'lane_number', v_lane_num,
      'ttl_hours', p_ttl_hours, 'expires_at', v_expires_at,
      'never_expires', (v_expires_at = 'infinity'::timestamptz)
    )
  );

  RETURN json_build_object(
    'ok', true,
    'raw_token', v_raw_token,
    'token_fingerprint', public.qr_token_fingerprint(v_raw_token),
    'expires_at', v_expires_at,
    'never_expires', (v_expires_at = 'infinity'::timestamptz),
    'ttl_hours', p_ttl_hours,
    'lane_id', p_lane_id,
    'lane_number', v_lane_num
  );
END;
$$;


--
-- Name: rpc_admin_get_audit_log(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_admin_get_audit_log(p_limit integer DEFAULT 80) RETURNS json
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_limit int := least(greatest(coalesce(p_limit, 80), 1), 200);
BEGIN
  IF NOT public.is_owner_or_architect() THEN
    RETURN json_build_object('error','unauthorized');
  END IF;

  RETURN json_build_object(
    'actions', (
      SELECT COALESCE(json_agg(row_to_json(a) ORDER BY a.created_at DESC), '[]'::json)
      FROM (
        SELECT al.created_at, al.action, al.target_type, al.target_id, al.details,
               p.username AS admin_username
          FROM admin_audit_log al
          LEFT JOIN profiles p ON p.id = al.admin_id
         ORDER BY al.created_at DESC
         LIMIT v_limit
      ) a
    ),
    'events', (
      SELECT COALESCE(json_agg(row_to_json(e) ORDER BY e.created_at DESC), '[]'::json)
      FROM (
        SELECT se.created_at, se.event_type, se.severity, se.details,
               p.username AS username
          FROM security_events se
          LEFT JOIN profiles p ON p.id = se.user_id
         ORDER BY se.created_at DESC
         LIMIT v_limit
      ) e
    )
  );
END; $$;


--
-- Name: rpc_admin_get_beta_reports(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_admin_get_beta_reports(p_status text DEFAULT NULL::text) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  PERFORM public.require_mfa();
  IF NOT public.is_admin() THEN
    INSERT INTO security_events (event_type, severity, user_id, details)
    VALUES ('admin_access_denied', 'warn', auth.uid(),
      jsonb_build_object('rpc', 'rpc_admin_get_beta_reports'))
    ON CONFLICT DO NOTHING;
    RETURN json_build_object('error', 'unauthorized');
  END IF;

  RETURN (
    SELECT COALESCE(json_agg(row_to_json(q)), '[]'::json)
    FROM (
      SELECT br.*, p.username
        FROM beta_reports br
        LEFT JOIN profiles p ON p.id = br.user_id
       WHERE p_status IS NULL OR br.status = p_status
       ORDER BY
         CASE br.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
         br.created_at DESC
       LIMIT 200
    ) q
  );
END;
$$;


--
-- Name: rpc_admin_get_content_reports(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_admin_get_content_reports(p_status text DEFAULT 'pending'::text) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
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


--
-- Name: rpc_admin_get_score_review_queue(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_admin_get_score_review_queue(p_venue_id uuid DEFAULT NULL::uuid, p_status text DEFAULT 'pending'::text) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  PERFORM public.require_mfa();

  IF NOT (public.is_admin() OR (p_venue_id IS NOT NULL AND public.is_venue_admin(p_venue_id))) THEN
    INSERT INTO security_events (event_type, severity, user_id, details)
    VALUES ('admin_access_denied', 'warn', auth.uid(),
      jsonb_build_object('rpc', 'rpc_admin_get_score_review_queue', 'venue_id', p_venue_id))
    ON CONFLICT DO NOTHING;
    RETURN json_build_object('error', 'unauthorized');
  END IF;

  IF p_status NOT IN ('pending', 'approved', 'denied') THEN
    RETURN json_build_object('error', 'invalid_status');
  END IF;

  RETURN (
    SELECT COALESCE(json_agg(row_to_json(q)), '[]'::json)
    FROM (
      SELECT
        s.id,
        s.user_id,
        p.username,
        p.avatar_url,
        g.name  AS game_name,
        s.score,
        s.photo_url,
        s.proof_storage_path,
        s.venue_id,
        s.created_at,
        s.ai_verdict,
        s.ai_confidence,
        s.ai_read_score,
        s.ai_reasoning
      FROM scores s
      LEFT JOIN profiles p ON p.id = s.user_id
      LEFT JOIN games    g ON g.id = s.game_id
      WHERE s.status = p_status
        AND (
          public.is_admin()
          OR (p_venue_id IS NOT NULL AND s.venue_id = p_venue_id)
        )
      ORDER BY
        CASE WHEN p_status = 'pending' THEN s.created_at END ASC,
        CASE WHEN p_status <> 'pending' THEN s.created_at END DESC
    ) q
  );
END; $$;


--
-- Name: rpc_admin_get_security_events(text, text, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_admin_get_security_events(p_severity text DEFAULT NULL::text, p_type text DEFAULT NULL::text, p_limit integer DEFAULT 100, p_offset integer DEFAULT 0) RETURNS TABLE(id uuid, event_type text, severity text, user_id uuid, username text, details jsonb, created_at timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  PERFORM public.require_mfa();

  IF NOT public.is_admin() THEN
    INSERT INTO security_events (event_type, severity, user_id, details)
    VALUES ('admin_access_denied', 'warn', auth.uid(),
      jsonb_build_object('rpc', 'rpc_admin_get_security_events'))
    ON CONFLICT DO NOTHING;
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
  SELECT
    se.id,
    se.event_type,
    se.severity,
    se.user_id,
    p.username,
    se.details,
    se.created_at
  FROM security_events se
  LEFT JOIN profiles p ON p.id = se.user_id
  WHERE
    (p_severity IS NULL OR se.severity = p_severity)
    AND (p_type     IS NULL OR se.event_type LIKE p_type || '%')
  ORDER BY se.created_at DESC
  LIMIT  LEAST(p_limit, 500)
  OFFSET p_offset;
END;
$$;


--
-- Name: rpc_admin_get_storage_cleanup_queue(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_admin_get_storage_cleanup_queue(p_limit integer DEFAULT 100) RETURNS TABLE(id uuid, bucket text, path text, reason text, created_at timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  PERFORM public.require_mfa();

  IF NOT public.is_admin() THEN
    INSERT INTO security_events (event_type, severity, user_id, details)
    VALUES ('admin_access_denied', 'warn', auth.uid(),
      jsonb_build_object('rpc', 'rpc_admin_get_storage_cleanup_queue'))
    ON CONFLICT DO NOTHING;
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
    SELECT scq.id, scq.bucket, scq.path, scq.reason, scq.created_at
      FROM storage_cleanup_queue scq
     WHERE scq.processed_at IS NULL
     ORDER BY scq.created_at
     LIMIT p_limit;
END;
$$;


--
-- Name: rpc_admin_get_team_join_requests(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_admin_get_team_join_requests(p_team_id uuid) RETURNS TABLE(request_id uuid, team_id uuid, user_id uuid, username text, avatar_url text, message text, created_at timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_venue_id uuid;
BEGIN
  PERFORM public.require_mfa();

  SELECT venue_id INTO v_venue_id FROM teams WHERE id = p_team_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT (public.is_admin() OR
          (v_venue_id IS NOT NULL AND public.can_manage_venue(v_venue_id))) THEN
    INSERT INTO security_events (event_type, severity, user_id, details)
    VALUES ('admin_access_denied', 'warn', auth.uid(),
      jsonb_build_object('rpc', 'rpc_admin_get_team_join_requests', 'team_id', p_team_id))
    ON CONFLICT DO NOTHING;
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
  SELECT tr.id, tr.team_id, tr.user_id, p.username, p.avatar_url, tr.message, tr.created_at
  FROM team_requests tr
  LEFT JOIN profiles p ON p.id = tr.user_id
  WHERE tr.team_id = p_team_id AND tr.direction = 'request' AND tr.status = 'pending'
  ORDER BY tr.created_at ASC;
END;
$$;


--
-- Name: rpc_admin_get_team_members(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_admin_get_team_members(p_team_id uuid) RETURNS TABLE(user_id uuid, username text, avatar_url text, role text, joined_at timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_venue_id uuid;
BEGIN
  PERFORM public.require_mfa();

  SELECT venue_id INTO v_venue_id FROM teams WHERE id = p_team_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT (public.is_admin() OR
          (v_venue_id IS NOT NULL AND public.can_manage_venue(v_venue_id))) THEN
    INSERT INTO security_events (event_type, severity, user_id, details)
    VALUES ('admin_access_denied', 'warn', auth.uid(),
      jsonb_build_object('rpc', 'rpc_admin_get_team_members', 'team_id', p_team_id))
    ON CONFLICT DO NOTHING;
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
  SELECT tm.user_id, p.username, p.avatar_url, tm.role, tm.created_at
  FROM team_members tm
  JOIN profiles p ON p.id = tm.user_id
  WHERE tm.team_id = p_team_id
  ORDER BY (tm.role = 'captain') DESC, LOWER(p.username);
END;
$$;


--
-- Name: rpc_admin_get_users(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_admin_get_users() RETURNS TABLE(id uuid, username text, avatar_url text, role text, email text, is_beta_tester boolean)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  PERFORM public.require_mfa();

  IF NOT public.is_admin() THEN
    INSERT INTO security_events (event_type, severity, user_id, details)
    VALUES ('admin_access_denied', 'warn', auth.uid(),
      jsonb_build_object('rpc', 'rpc_admin_get_users'))
    ON CONFLICT DO NOTHING;
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
  SELECT
    au.id,
    p.username,
    p.avatar_url,
    COALESCE(p.role, 'user') AS role,
    au.email::text,
    COALESCE(p.is_beta_tester, false) AS is_beta_tester
  FROM auth.users au
  LEFT JOIN public.profiles p ON p.id = au.id
  ORDER BY LOWER(COALESCE(p.username, au.email, ''));
END;
$$;


--
-- Name: rpc_admin_grant_title_to_beta(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_admin_grant_title_to_beta(p_title_key text) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_granted int;
BEGIN
  PERFORM public.require_mfa();
  IF NOT public.is_owner_or_architect() THEN
    INSERT INTO security_events (event_type, severity, user_id, details)
    VALUES ('admin_access_denied','warn',auth.uid(),
      jsonb_build_object('rpc','rpc_admin_grant_title_to_beta','title',p_title_key))
    ON CONFLICT DO NOTHING;
    RETURN json_build_object('error','unauthorized','message','Owner or architect only.');
  END IF;

  IF p_title_key IS NULL OR NOT (p_title_key = ANY(public.all_title_keys())) THEN
    RETURN json_build_object('error','unknown_title','message','That title is not in the catalog.');
  END IF;

  WITH ins AS (
    INSERT INTO user_titles (user_id, title_key, source)
    SELECT user_id, p_title_key, 'beta_reward'
      FROM user_titles WHERE title_key = 'beta_founder'
    ON CONFLICT (user_id, title_key) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_granted FROM ins;

  INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(),'grant_title_to_beta','title',p_title_key,
          jsonb_build_object('granted', v_granted));

  RETURN json_build_object('ok', true, 'title_key', p_title_key, 'granted', v_granted);
END; $$;


--
-- Name: rpc_admin_grant_venue_role(uuid, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_admin_grant_venue_role(p_venue_id uuid, p_user_id uuid, p_role text) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_grantee_username text;
BEGIN
  PERFORM public.require_mfa();

  IF p_role NOT IN ('owner', 'admin', 'staff') THEN
    RETURN json_build_object('error', 'invalid_role',
      'message', 'Role must be owner, admin, or staff.');
  END IF;

  -- Only platform admins or venue owners can grant roles
  IF NOT (public.is_platform_admin() OR public.is_venue_owner(p_venue_id)) THEN
    INSERT INTO security_events (event_type, severity, user_id, details)
    VALUES ('admin_permission_denied', 'warn', auth.uid(),
      jsonb_build_object('rpc', 'grant_venue_role', 'venue_id', p_venue_id))
    ON CONFLICT DO NOTHING;
    RETURN json_build_object('error', 'unauthorized',
      'message', 'Only platform admins or venue owners can grant venue roles.');
  END IF;

  -- Prevent demoting platform admins via this RPC
  IF EXISTS (SELECT 1 FROM profiles WHERE id = p_user_id AND is_admin = true)
     AND NOT public.is_platform_admin() THEN
    RETURN json_build_object('error', 'forbidden',
      'message', 'Cannot modify the role of a platform admin.');
  END IF;

  SELECT username INTO v_grantee_username FROM profiles WHERE id = p_user_id;

  INSERT INTO venue_admins (venue_id, user_id, role, granted_by, granted_at)
  VALUES (p_venue_id, p_user_id, p_role, auth.uid(), now())
  ON CONFLICT (venue_id, user_id) DO UPDATE
    SET role       = EXCLUDED.role,
        granted_by = EXCLUDED.granted_by,
        granted_at = EXCLUDED.granted_at;

  INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (
    auth.uid(), 'grant_venue_role', 'venue_admin',
    (p_venue_id::text || ':' || p_user_id::text),
    jsonb_build_object('venue_id', p_venue_id, 'user_id', p_user_id,
                       'role', p_role, 'grantee_username', v_grantee_username)
  );

  INSERT INTO security_events (event_type, severity, user_id, details)
  VALUES ('venue_role_granted', 'info', auth.uid(),
    jsonb_build_object('venue_id', p_venue_id, 'target_user_id', p_user_id, 'role', p_role))
  ON CONFLICT DO NOTHING;

  RETURN json_build_object('ok', true, 'role', p_role, 'username', v_grantee_username);
END;
$$;


--
-- Name: rpc_admin_mark_storage_cleaned(uuid[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_admin_mark_storage_cleaned(p_ids uuid[]) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  PERFORM public.require_mfa();

  IF NOT public.is_admin() THEN
    INSERT INTO security_events (event_type, severity, user_id, details)
    VALUES ('admin_access_denied', 'warn', auth.uid(),
      jsonb_build_object('rpc', 'rpc_admin_mark_storage_cleaned'))
    ON CONFLICT DO NOTHING;
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = 'P0001';
  END IF;

  UPDATE storage_cleanup_queue
     SET processed_at = now()
   WHERE id = ANY(p_ids);
END;
$$;


--
-- Name: rpc_admin_remove_ff_guest(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_admin_remove_ff_guest(p_reg_id uuid) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_tournament_id uuid;
  v_guest_name    text;
  v_venue_id      uuid;
BEGIN
  PERFORM public.require_mfa();

  SELECT tr.tournament_id, tr.guest_name, t.venue_id
    INTO v_tournament_id, v_guest_name, v_venue_id
    FROM tournament_registrations tr
    LEFT JOIN tournaments t ON t.id = tr.tournament_id
   WHERE tr.id = p_reg_id AND tr.user_id IS NULL;  -- only guest rows have NULL user_id

  IF NOT FOUND THEN RETURN json_build_object('error','not_found'); END IF;

  IF NOT (public.is_admin() OR
          (v_venue_id IS NOT NULL AND public.can_manage_venue(v_venue_id))) THEN
    INSERT INTO security_events (event_type, severity, user_id, details)
    VALUES ('admin_access_denied', 'warn', auth.uid(),
      jsonb_build_object('rpc', 'rpc_admin_remove_ff_guest', 'reg_id', p_reg_id))
    ON CONFLICT DO NOTHING;
    RETURN json_build_object('error','unauthorized');
  END IF;

  DELETE FROM tournament_registrations WHERE id = p_reg_id;

  INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'remove_ff_guest', 'tournament', v_tournament_id::text,
          jsonb_build_object('reg_id', p_reg_id, 'guest_name', v_guest_name));

  RETURN json_build_object('ok', true);
END; $$;


--
-- Name: rpc_admin_remove_team_member(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_admin_remove_team_member(p_team_id uuid, p_user_id uuid) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_venue_id   uuid;
  v_captain_id uuid;
BEGIN
  PERFORM public.require_mfa();

  SELECT venue_id, captain_user_id INTO v_venue_id, v_captain_id FROM teams WHERE id = p_team_id;
  IF NOT FOUND THEN
    RETURN json_build_object('error', 'not_found');
  END IF;

  IF NOT (public.is_admin() OR
          (v_venue_id IS NOT NULL AND public.can_manage_venue(v_venue_id))) THEN
    INSERT INTO security_events (event_type, severity, user_id, details)
    VALUES ('admin_access_denied', 'warn', auth.uid(),
      jsonb_build_object('rpc', 'rpc_admin_remove_team_member', 'team_id', p_team_id, 'target_user', p_user_id))
    ON CONFLICT DO NOTHING;
    RETURN json_build_object('error', 'unauthorized', 'message', 'Admin only.');
  END IF;

  DELETE FROM team_members WHERE team_id = p_team_id AND user_id = p_user_id;

  IF v_captain_id = p_user_id THEN
    UPDATE teams SET captain_user_id = NULL WHERE id = p_team_id;
  END IF;

  INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'remove_team_member', 'team', p_team_id::text,
          jsonb_build_object('user_id', p_user_id));

  RETURN json_build_object('ok', true);
END;
$$;


--
-- Name: rpc_admin_remove_tournament_player(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_admin_remove_tournament_player(p_reg_id uuid) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_tourn_id   uuid;
  v_user_id    uuid;
  v_guest_name text;
  v_label      text;
  v_venue_id   uuid;
BEGIN
  PERFORM public.require_mfa();

  SELECT tr.tournament_id, tr.user_id, tr.guest_name, t.venue_id
    INTO v_tourn_id, v_user_id, v_guest_name, v_venue_id
    FROM tournament_registrations tr
    LEFT JOIN tournaments t ON t.id = tr.tournament_id
   WHERE tr.id = p_reg_id;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'not_found');
  END IF;

  IF NOT (public.is_admin() OR
          (v_venue_id IS NOT NULL AND public.can_manage_venue(v_venue_id))) THEN
    INSERT INTO security_events (event_type, severity, user_id, details)
    VALUES ('admin_access_denied', 'warn', auth.uid(),
      jsonb_build_object('rpc', 'rpc_admin_remove_tournament_player', 'reg_id', p_reg_id))
    ON CONFLICT DO NOTHING;
    RETURN json_build_object('error', 'unauthorized', 'message', 'Admin only.');
  END IF;

  DELETE FROM tournament_registrations WHERE id = p_reg_id;

  v_label := COALESCE(v_guest_name,
               (SELECT username FROM profiles WHERE id = v_user_id),
               v_user_id::text,
               'unknown');

  INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'remove_tournament_player', 'tournament', v_tourn_id::text,
          jsonb_build_object('reg_id', p_reg_id, 'player', v_label));

  RETURN json_build_object('ok', true);
END;
$$;


--
-- Name: rpc_admin_reply_support(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_admin_reply_support(p_ticket_id uuid, p_content text) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_uid uuid;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN json_build_object('error', 'not_authenticated');
  END IF;

  PERFORM public.require_mfa();

  -- Only admins, owners, and architects can reply
  IF NOT (
    public.is_admin()
    OR EXISTS (SELECT 1 FROM profiles WHERE id = v_uid AND role IN ('owner', 'architect'))
  ) THEN
    INSERT INTO security_events (event_type, severity, user_id, details)
    VALUES ('admin_access_denied', 'warn', v_uid,
      jsonb_build_object('rpc', 'rpc_admin_reply_support', 'ticket_id', p_ticket_id))
    ON CONFLICT DO NOTHING;
    RETURN json_build_object('error', 'unauthorized');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM support_tickets WHERE id = p_ticket_id) THEN
    RETURN json_build_object('error', 'ticket_not_found');
  END IF;

  INSERT INTO support_messages (ticket_id, sender_id, content, is_admin_msg)
  VALUES (p_ticket_id, v_uid, trim(p_content), true);

  -- Re-open ticket if it was resolved
  UPDATE support_tickets
     SET status = 'open'
   WHERE id = p_ticket_id
     AND status != 'open';

  INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (v_uid, 'support_reply', 'support_ticket', p_ticket_id::text, '{}');

  RETURN json_build_object('ok', true);
END;
$$;


--
-- Name: rpc_admin_reset_all_league_data(boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_admin_reset_all_league_data(p_delete_teams boolean DEFAULT false) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_sessions int;
  v_balls    int;
  v_seasons  int;
BEGIN
  PERFORM public.require_mfa();
  IF NOT public.is_owner_or_architect() THEN
    INSERT INTO security_events (event_type, severity, user_id, details)
    VALUES ('admin_access_denied','warn',auth.uid(),
      jsonb_build_object('rpc','rpc_admin_reset_all_league_data'))
    ON CONFLICT DO NOTHING;
    RETURN json_build_object('error','unauthorized','message','Owner or architect only.');
  END IF;

  SELECT count(*) INTO v_sessions FROM skeeball_sessions;
  SELECT count(*) INTO v_balls    FROM skeeball_ball_scores;
  SELECT count(*) INTO v_seasons  FROM skeeball_seasons;

  -- skeeball_league_standings is a computed VIEW — recomputes once sessions go.
  DELETE FROM matches                 WHERE true;
  DELETE FROM league_teams            WHERE true;
  DELETE FROM league_rsvps            WHERE true;
  DELETE FROM sub_requests            WHERE true;
  DELETE FROM skeeball_sessions       WHERE true;  -- cascade ball_scores/session_players/score_disputes
  DELETE FROM skeeball_league_matches WHERE true;
  DELETE FROM skeeball_seasons        WHERE true;

  IF p_delete_teams THEN
    DELETE FROM teams WHERE true;  -- cascade members/messages/announcements/bans/requests/schedule
  END IF;

  INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(),'reset_all_league_data','global','*',
          jsonb_build_object('sessions_deleted',v_sessions,'balls_deleted',v_balls,
                             'seasons_deleted',v_seasons,'teams_deleted',p_delete_teams));

  RETURN json_build_object('ok',true,'sessions_deleted',v_sessions,'balls_deleted',v_balls,
                           'seasons_deleted',v_seasons,'teams_deleted',p_delete_teams);
END; $$;


--
-- Name: rpc_admin_reset_team_data(uuid, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_admin_reset_team_data(p_team_id uuid, p_delete_team boolean DEFAULT false) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_name     text;
  v_sessions int;
  v_balls    int;
BEGIN
  PERFORM public.require_mfa();
  IF NOT public.is_owner_or_architect() THEN
    INSERT INTO security_events (event_type, severity, user_id, details)
    VALUES ('admin_access_denied','warn',auth.uid(),
      jsonb_build_object('rpc','rpc_admin_reset_team_data','team_id',p_team_id))
    ON CONFLICT DO NOTHING;
    RETURN json_build_object('error','unauthorized','message','Owner or architect only.');
  END IF;

  SELECT name INTO v_name FROM teams WHERE id = p_team_id;
  IF NOT FOUND THEN RETURN json_build_object('error','not_found'); END IF;

  SELECT count(*) INTO v_sessions FROM skeeball_sessions WHERE team_id = p_team_id;
  SELECT count(*) INTO v_balls
    FROM skeeball_ball_scores bs
    JOIN skeeball_sessions s ON s.id = bs.session_id
   WHERE s.team_id = p_team_id;

  -- Competitive/gameplay data (NO-ACTION blockers first, then sessions cascade).
  -- skeeball_league_standings is a computed VIEW over sessions — it recomputes
  -- automatically once the sessions below are gone, so it isn't deleted here.
  DELETE FROM matches       WHERE team_a_id = p_team_id OR team_b_id = p_team_id;
  DELETE FROM league_teams  WHERE team_id = p_team_id;
  DELETE FROM league_rsvps  WHERE team_id = p_team_id;
  DELETE FROM sub_requests  WHERE team_id = p_team_id;
  DELETE FROM skeeball_sessions WHERE team_id = p_team_id;

  IF p_delete_team THEN
    -- cascades team_members, team_messages, team_announcements, team_bans,
    -- team_requests, team_schedule, etc.
    DELETE FROM teams WHERE id = p_team_id;
  END IF;

  INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(),
          CASE WHEN p_delete_team THEN 'delete_team_full' ELSE 'reset_team_data' END,
          'team', p_team_id::text,
          jsonb_build_object('team_name',v_name,'sessions_deleted',v_sessions,
                             'balls_deleted',v_balls,'team_deleted',p_delete_team));

  RETURN json_build_object('ok',true,'team_name',v_name,'sessions_deleted',v_sessions,
                           'balls_deleted',v_balls,'team_deleted',p_delete_team);
END; $$;


--
-- Name: rpc_admin_resolve_content_report(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_admin_resolve_content_report(p_report_id uuid, p_action text) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
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


--
-- Name: rpc_admin_resolve_dispute(uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_admin_resolve_dispute(p_dispute_id uuid, p_action text, p_note text DEFAULT NULL::text) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: rpc_admin_resolve_team_request(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_admin_resolve_team_request(p_request_id uuid, p_action text) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_team_id  uuid;
  v_user_id  uuid;
  v_venue_id uuid;
BEGIN
  PERFORM public.require_mfa();

  IF p_action NOT IN ('approve', 'deny') THEN
    RETURN json_build_object('error', 'invalid_action');
  END IF;

  SELECT tr.team_id, tr.user_id, t.venue_id
    INTO v_team_id, v_user_id, v_venue_id
    FROM team_requests tr
    JOIN teams t ON t.id = tr.team_id
   WHERE tr.id = p_request_id;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'not_found');
  END IF;

  IF NOT (public.is_admin() OR
          (v_venue_id IS NOT NULL AND public.can_manage_venue(v_venue_id))) THEN
    INSERT INTO security_events (event_type, severity, user_id, details)
    VALUES ('admin_access_denied', 'warn', auth.uid(),
      jsonb_build_object('rpc', 'rpc_admin_resolve_team_request', 'request_id', p_request_id))
    ON CONFLICT DO NOTHING;
    RETURN json_build_object('error', 'unauthorized', 'message', 'Admin only.');
  END IF;

  IF p_action = 'approve' THEN
    INSERT INTO team_members (team_id, user_id, role)
    VALUES (v_team_id, v_user_id, 'player')
    ON CONFLICT (team_id, user_id) DO NOTHING;
    UPDATE team_requests SET status = 'approved' WHERE id = p_request_id;
  ELSE
    UPDATE team_requests SET status = 'denied' WHERE id = p_request_id;
  END IF;

  INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'resolve_team_request', 'team', v_team_id::text,
          jsonb_build_object('request_id', p_request_id, 'user_id', v_user_id, 'action', p_action));

  RETURN json_build_object('ok', true);
END;
$$;


--
-- Name: rpc_admin_review_score(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_admin_review_score(p_score_id uuid, p_status text) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_score_venue_id uuid;
BEGIN
  PERFORM public.require_mfa();

  SELECT venue_id INTO v_score_venue_id FROM scores WHERE id = p_score_id;

  IF NOT (public.is_admin() OR public.is_venue_admin(v_score_venue_id)) THEN
    INSERT INTO security_events (event_type, severity, user_id, details)
    VALUES ('admin_access_denied', 'warn', auth.uid(),
      jsonb_build_object('rpc', 'rpc_admin_review_score', 'score_id', p_score_id))
    ON CONFLICT DO NOTHING;
    RETURN json_build_object('error', 'unauthorized', 'message', 'Admin only.');
  END IF;

  IF p_status NOT IN ('approved', 'denied') THEN
    RETURN json_build_object('error', 'invalid_status');
  END IF;

  UPDATE scores SET status = p_status WHERE id = p_score_id;
  IF NOT FOUND THEN
    RETURN json_build_object('error', 'not_found');
  END IF;

  INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'score_review', 'score', p_score_id::text,
          jsonb_build_object('new_status', p_status));

  RETURN json_build_object('ok', true);
END;
$$;


--
-- Name: rpc_admin_revoke_ff_signup_qr(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_admin_revoke_ff_signup_qr(p_tournament_id uuid) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_venue_id uuid;
BEGIN
  PERFORM public.require_mfa();

  SELECT venue_id INTO v_venue_id FROM tournaments WHERE id = p_tournament_id;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'not_found');
  END IF;

  IF NOT (public.is_admin() OR
          (v_venue_id IS NOT NULL AND public.can_manage_venue(v_venue_id))) THEN
    INSERT INTO security_events (event_type, severity, user_id, details)
    VALUES ('admin_access_denied', 'warn', auth.uid(),
      jsonb_build_object('rpc', 'rpc_admin_revoke_ff_signup_qr', 'tournament_id', p_tournament_id))
    ON CONFLICT DO NOTHING;
    RETURN json_build_object('error', 'unauthorized');
  END IF;

  UPDATE tournaments
     SET signup_qr_active = false
   WHERE id = p_tournament_id;

  INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'revoke_ff_qr', 'tournament', p_tournament_id::text, '{}');

  RETURN json_build_object('ok', true);
END;
$$;


--
-- Name: rpc_admin_revoke_venue_role(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_admin_revoke_venue_role(p_venue_id uuid, p_user_id uuid) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_old_role text;
BEGIN
  PERFORM public.require_mfa();

  IF NOT (public.is_platform_admin() OR public.is_venue_owner(p_venue_id)) THEN
    INSERT INTO security_events (event_type, severity, user_id, details)
    VALUES ('admin_permission_denied', 'warn', auth.uid(),
      jsonb_build_object('rpc', 'revoke_venue_role', 'venue_id', p_venue_id))
    ON CONFLICT DO NOTHING;
    RETURN json_build_object('error', 'unauthorized');
  END IF;

  SELECT role INTO v_old_role FROM venue_admins
   WHERE venue_id = p_venue_id AND user_id = p_user_id;

  DELETE FROM venue_admins WHERE venue_id = p_venue_id AND user_id = p_user_id;

  INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (
    auth.uid(), 'revoke_venue_role', 'venue_admin',
    (p_venue_id::text || ':' || p_user_id::text),
    jsonb_build_object('venue_id', p_venue_id, 'user_id', p_user_id, 'was_role', v_old_role)
  );

  INSERT INTO security_events (event_type, severity, user_id, details)
  VALUES ('venue_role_revoked', 'info', auth.uid(),
    jsonb_build_object('venue_id', p_venue_id, 'target_user_id', p_user_id, 'was_role', v_old_role))
  ON CONFLICT DO NOTHING;

  RETURN json_build_object('ok', true);
END;
$$;


--
-- Name: rpc_admin_rotate_lane_token(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_admin_rotate_lane_token(p_lane_id uuid) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_venue_id uuid;
BEGIN
  PERFORM public.require_mfa();

  SELECT venue_id INTO v_venue_id FROM lanes WHERE id = p_lane_id;
  IF NOT FOUND THEN
    RETURN json_build_object('error', 'not_found');
  END IF;

  IF NOT (public.is_admin() OR public.is_venue_admin(v_venue_id)) THEN
    INSERT INTO security_events (event_type, severity, user_id, details)
    VALUES ('admin_access_denied', 'warn', auth.uid(),
      jsonb_build_object('rpc', 'rpc_admin_rotate_lane_token', 'lane_id', p_lane_id))
    ON CONFLICT DO NOTHING;
    RETURN json_build_object('error', 'unauthorized');
  END IF;

  -- Delegate to the full generate RPC (handles lane_qr_tokens + audit log)
  RETURN public.rpc_admin_generate_lane_qr_token(p_lane_id, 720);
END; $$;


--
-- Name: rpc_admin_save_placements(uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_admin_save_placements(p_tournament_id uuid, p_placements jsonb) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_entry    jsonb;
  v_uid      uuid;
  v_uname    text;
  v_status   text;
  v_title    text;
  v_venue_id uuid;
  v_warnings text[] := '{}';
BEGIN
  PERFORM public.require_mfa();

  SELECT title, status, venue_id INTO v_title, v_status, v_venue_id
    FROM tournaments WHERE id = p_tournament_id;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'not_found');
  END IF;

  IF NOT (public.is_admin() OR
          (v_venue_id IS NOT NULL AND public.can_manage_venue(v_venue_id))) THEN
    INSERT INTO security_events (event_type, severity, user_id, details)
    VALUES ('admin_access_denied', 'warn', auth.uid(),
      jsonb_build_object('rpc', 'rpc_admin_save_placements', 'tournament_id', p_tournament_id))
    ON CONFLICT DO NOTHING;
    RETURN json_build_object('error', 'unauthorized', 'message', 'Admin only.');
  END IF;

  IF v_status NOT IN ('upcoming', 'active') THEN
    RETURN json_build_object('error', 'invalid_status',
      'message', 'Results can only be saved for upcoming or active tournaments.');
  END IF;

  FOR v_entry IN SELECT * FROM jsonb_array_elements(p_placements)
  LOOP
    v_uname := trim(COALESCE(v_entry->>'username', ''));
    CONTINUE WHEN v_uname = '';

    SELECT id INTO v_uid
      FROM profiles
     WHERE lower(username) = lower(v_uname)
     LIMIT 1;

    IF v_uid IS NULL THEN
      v_warnings := array_append(v_warnings, 'User not found: ' || v_uname);
      CONTINUE;
    END IF;

    INSERT INTO tournament_placements (tournament_id, user_id, placement)
    VALUES (p_tournament_id, v_uid, (v_entry->>'place')::int)
    ON CONFLICT (tournament_id, user_id)
    DO UPDATE SET placement = EXCLUDED.placement;
  END LOOP;

  UPDATE tournaments SET status = 'completed' WHERE id = p_tournament_id;

  INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'save_tournament_placements', 'tournament', p_tournament_id::text,
          jsonb_build_object('title', v_title, 'placement_count', jsonb_array_length(p_placements)));

  RETURN json_build_object('ok', true, 'warnings', v_warnings);
END;
$$;


--
-- Name: rpc_admin_set_ai_verification_mode(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_admin_set_ai_verification_mode(p_mode text) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  PERFORM public.require_mfa();
  IF NOT public.is_admin() THEN
    INSERT INTO security_events (event_type, severity, user_id, details)
    VALUES ('admin_access_denied', 'warn', auth.uid(),
      jsonb_build_object('rpc', 'rpc_admin_set_ai_verification_mode'))
    ON CONFLICT DO NOTHING;
    RETURN json_build_object('error', 'unauthorized');
  END IF;
  IF p_mode NOT IN ('off', 'deny_only', 'full_auto') THEN
    RETURN json_build_object('error', 'invalid_mode');
  END IF;
  UPDATE ai_verification_config SET mode = p_mode, updated_at = now() WHERE id = 1;
  INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'ai_verification_mode', 'config', '1', jsonb_build_object('mode', p_mode));
  RETURN json_build_object('ok', true);
END;
$$;


--
-- Name: rpc_admin_set_beta_open(boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_admin_set_beta_open(p_open boolean) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: rpc_admin_set_beta_tester(uuid, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_admin_set_beta_tester(p_user_id uuid, p_enabled boolean) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  PERFORM public.require_mfa();
  IF NOT public.is_admin() THEN
    INSERT INTO security_events (event_type, severity, user_id, details)
    VALUES ('admin_access_denied', 'warn', auth.uid(),
      jsonb_build_object('rpc', 'rpc_admin_set_beta_tester'))
    ON CONFLICT DO NOTHING;
    RETURN json_build_object('error', 'unauthorized');
  END IF;

  UPDATE profiles SET is_beta_tester = p_enabled WHERE id = p_user_id;
  IF NOT FOUND THEN RETURN json_build_object('error', 'not_found'); END IF;

  INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'set_beta_tester', 'user', p_user_id::text,
          jsonb_build_object('enabled', p_enabled));

  RETURN json_build_object('ok', true);
END;
$$;


--
-- Name: rpc_admin_set_team_captain(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_admin_set_team_captain(p_team_id uuid, p_user_id uuid) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_venue_id   uuid;
  v_old_captain uuid;
BEGIN
  PERFORM public.require_mfa();

  SELECT venue_id, captain_user_id INTO v_venue_id, v_old_captain FROM teams WHERE id = p_team_id;
  IF NOT FOUND THEN
    RETURN json_build_object('error', 'not_found');
  END IF;

  IF NOT (public.is_admin() OR
          (v_venue_id IS NOT NULL AND public.can_manage_venue(v_venue_id))) THEN
    INSERT INTO security_events (event_type, severity, user_id, details)
    VALUES ('admin_access_denied', 'warn', auth.uid(),
      jsonb_build_object('rpc', 'rpc_admin_set_team_captain', 'team_id', p_team_id, 'target_user', p_user_id))
    ON CONFLICT DO NOTHING;
    RETURN json_build_object('error', 'unauthorized', 'message', 'Admin only.');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM team_members WHERE team_id = p_team_id AND user_id = p_user_id) THEN
    RETURN json_build_object('error', 'not_member', 'message', 'User must be a team member first.');
  END IF;

  IF v_old_captain IS NOT NULL AND v_old_captain <> p_user_id THEN
    UPDATE team_members SET role = 'player' WHERE team_id = p_team_id AND user_id = v_old_captain;
  END IF;

  UPDATE teams SET captain_user_id = p_user_id WHERE id = p_team_id;
  UPDATE team_members SET role = 'captain' WHERE team_id = p_team_id AND user_id = p_user_id;

  INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'set_team_captain', 'team', p_team_id::text,
          jsonb_build_object('user_id', p_user_id, 'previous_captain', v_old_captain));

  RETURN json_build_object('ok', true);
END;
$$;


--
-- Name: rpc_admin_set_tournament_status(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_admin_set_tournament_status(p_tournament_id uuid, p_status text) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_title    text;
  v_venue_id uuid;
BEGIN
  PERFORM public.require_mfa();

  SELECT title, venue_id INTO v_title, v_venue_id
    FROM tournaments WHERE id = p_tournament_id;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'not_found');
  END IF;

  IF NOT (public.is_admin() OR
          (v_venue_id IS NOT NULL AND public.can_manage_venue(v_venue_id))) THEN
    INSERT INTO security_events (event_type, severity, user_id, details)
    VALUES ('admin_access_denied', 'warn', auth.uid(),
      jsonb_build_object('rpc', 'rpc_admin_set_tournament_status', 'tournament_id', p_tournament_id))
    ON CONFLICT DO NOTHING;
    RETURN json_build_object('error', 'unauthorized', 'message', 'Admin only.');
  END IF;

  IF p_status NOT IN ('upcoming', 'active', 'completed', 'cancelled') THEN
    RETURN json_build_object('error', 'invalid_status');
  END IF;

  UPDATE tournaments SET status = p_status WHERE id = p_tournament_id;

  INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'set_tournament_status', 'tournament', p_tournament_id::text,
          jsonb_build_object('new_status', p_status, 'title', v_title));

  RETURN json_build_object('ok', true);
END;
$$;


--
-- Name: rpc_admin_skeeball_force_finalize(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_admin_skeeball_force_finalize(p_match_id uuid) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_result json;
BEGIN
  IF NOT public.is_admin() THEN
    RETURN json_build_object('error', 'unauthorized');
  END IF;

  v_result := public.rpc_skeeball_finalize_match(p_match_id, true);

  INSERT INTO admin_audit_log (admin_id, action, target_id, details)
  VALUES (v_uid, 'skeeball_force_finalize', p_match_id::text, v_result::text);

  RETURN v_result;
END;
$$;


--
-- Name: rpc_admin_skeeball_kick_session(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_admin_skeeball_kick_session(p_session_id uuid) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_session record;
BEGIN
  PERFORM public.require_mfa();
  IF NOT public.is_admin() THEN
    INSERT INTO security_events (event_type, severity, user_id, details)
    VALUES ('admin_access_denied', 'warn', auth.uid(),
      jsonb_build_object('rpc', 'rpc_admin_skeeball_kick_session'))
    ON CONFLICT DO NOTHING;
    RETURN json_build_object('error', 'unauthorized');
  END IF;

  SELECT * INTO v_session
    FROM skeeball_sessions
   WHERE id = p_session_id AND status = 'active';
  IF NOT FOUND THEN
    RETURN json_build_object('error', 'not_found',
      'message', 'That session is no longer active.');
  END IF;

  UPDATE skeeball_sessions
     SET status = 'abandoned', last_activity_at = now()
   WHERE id = p_session_id;

  INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'skeeball_kick_session', 'skeeball_session', p_session_id::text,
          jsonb_build_object('team_id', v_session.team_id, 'lane_number', v_session.lane_number,
                             'week_of', v_session.week_of));

  RETURN json_build_object('ok', true, 'lane_number', v_session.lane_number);
END;
$$;


--
-- Name: rpc_admin_skeeball_set_match_order(uuid, uuid[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_admin_skeeball_set_match_order(p_match_id uuid, p_ordered_session_ids uuid[]) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_completed int;
  v_provided  int := array_length(p_ordered_session_ids, 1);
  v_belong    int;
  v_sid       uuid;
  v_idx       int := 0;
BEGIN
  IF NOT public.is_admin() THEN
    RETURN json_build_object('error', 'unauthorized');
  END IF;

  SELECT COUNT(*) INTO v_completed
    FROM skeeball_sessions
   WHERE league_match_id = p_match_id AND status = 'completed';

  IF v_completed = 0 THEN
    RETURN json_build_object('error', 'not_found', 'message', 'No completed sessions for this round.');
  END IF;

  -- Every provided id must be a completed session of THIS match, and the
  -- list must cover all of them exactly once.
  SELECT COUNT(*) INTO v_belong
    FROM skeeball_sessions
   WHERE id = ANY(p_ordered_session_ids)
     AND league_match_id = p_match_id
     AND status = 'completed';

  IF v_provided IS DISTINCT FROM v_completed
     OR v_belong IS DISTINCT FROM v_completed
     OR (SELECT COUNT(DISTINCT x) FROM unnest(p_ordered_session_ids) x) <> v_completed THEN
    RETURN json_build_object('error', 'invalid',
      'message', 'Provide every completed team in this round exactly once, in finishing order.');
  END IF;

  FOREACH v_sid IN ARRAY p_ordered_session_ids LOOP
    v_idx := v_idx + 1;
    UPDATE skeeball_sessions
       SET placement     = v_idx,
           league_points = GREATEST(v_completed - v_idx + 1, 1)
     WHERE id = v_sid;
  END LOOP;

  -- Make sure the parent match is marked complete (no-op if already).
  UPDATE skeeball_league_matches SET status = 'completed' WHERE id = p_match_id;

  INSERT INTO admin_audit_log (admin_id, action, target_id, details)
  VALUES (v_uid, 'skeeball_set_match_order', p_match_id::text,
    jsonb_build_object('order', to_jsonb(p_ordered_session_ids), 'teams', v_completed));

  RETURN json_build_object('ok', true, 'teams', v_completed);
END;
$$;


--
-- Name: rpc_admin_skeeball_set_scoring_mode(text, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_admin_skeeball_set_scoring_mode(p_mode text, p_week_of date DEFAULT NULL::date) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_week    date := COALESCE(p_week_of, public.skeeball_current_week());
  v_value   text;
  v_updated int;
BEGIN
  IF NOT public.is_admin() THEN
    RETURN json_build_object('error', 'unauthorized');
  END IF;
  IF p_mode NOT IN ('total', 'hundos', 'auto') THEN
    RETURN json_build_object('error', 'invalid', 'message', 'Mode must be total, hundos, or auto.');
  END IF;

  v_value := CASE WHEN p_mode = 'auto' THEN NULL ELSE p_mode END;

  UPDATE skeeball_league_matches
     SET scoring_mode = v_value
   WHERE week_of = v_week
     AND COALESCE(status, 'active') != 'completed';
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated = 0 THEN
    INSERT INTO skeeball_league_matches (week_of, status, expected_teams, scoring_mode)
    VALUES (v_week, 'active', 4, v_value);
    v_updated := 1;
  END IF;

  INSERT INTO admin_audit_log (admin_id, action, target_id, details)
  VALUES (v_uid, 'skeeball_set_scoring_mode', v_week::text,
    jsonb_build_object('mode', p_mode, 'matches_updated', v_updated));

  RETURN json_build_object('ok', true, 'week_of', v_week, 'mode', p_mode);
END;
$$;


--
-- Name: rpc_admin_skeeball_set_week_teams(integer, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_admin_skeeball_set_week_teams(p_expected_teams integer, p_week_of date DEFAULT NULL::date) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_week date := COALESCE(p_week_of, public.skeeball_current_week());
  v_updated int;
BEGIN
  IF NOT public.is_admin() THEN
    RETURN json_build_object('error', 'unauthorized');
  END IF;

  IF p_expected_teams < 2 OR p_expected_teams > 8 THEN
    RETURN json_build_object('error', 'invalid', 'message', 'Teams per round must be between 2 and 8.');
  END IF;

  UPDATE skeeball_league_matches
     SET expected_teams = p_expected_teams
   WHERE week_of = v_week
     AND COALESCE(status, 'active') != 'completed';
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  -- No open match yet this week: create one so check-ins pick it up
  IF v_updated = 0 THEN
    INSERT INTO skeeball_league_matches (week_of, status, expected_teams)
    VALUES (v_week, 'active', p_expected_teams);
    v_updated := 1;
  END IF;

  INSERT INTO admin_audit_log (admin_id, action, target_id, details)
  VALUES (v_uid, 'skeeball_set_week_teams', v_week::text,
    json_build_object('expected_teams', p_expected_teams, 'matches_updated', v_updated)::text);

  RETURN json_build_object('ok', true, 'week_of', v_week, 'expected_teams', p_expected_teams);
END;
$$;


--
-- Name: rpc_admin_skeeball_start_season(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_admin_skeeball_start_season(p_name text) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_name text := btrim(COALESCE(p_name, ''));
  v_start date := public.skeeball_current_week();
  v_season record;
BEGIN
  IF NOT public.is_admin() THEN
    RETURN json_build_object('error', 'unauthorized');
  END IF;

  IF char_length(v_name) < 2 OR char_length(v_name) > 60 THEN
    RETURN json_build_object('error', 'invalid', 'message', 'Season name must be 2-60 characters.');
  END IF;

  UPDATE skeeball_seasons SET status = 'completed' WHERE status = 'active';

  INSERT INTO skeeball_seasons (name, start_week, end_week, status, created_by)
  VALUES (v_name, v_start, v_start + 49, 'active', v_uid)
  RETURNING * INTO v_season;

  INSERT INTO admin_audit_log (admin_id, action, target_id, details)
  VALUES (v_uid, 'skeeball_start_season', v_season.id::text,
    json_build_object('name', v_name, 'start_week', v_start, 'end_week', v_start + 49)::text);

  RETURN json_build_object(
    'ok', true,
    'id', v_season.id,
    'name', v_season.name,
    'start_week', v_season.start_week,
    'end_week', v_season.end_week
  );
END;
$$;


--
-- Name: rpc_admin_trivia_create_game(text, integer, boolean, integer, uuid[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_admin_trivia_create_game(p_title text, p_max_participants integer, p_allow_teams boolean, p_min_team_size integer, p_question_ids uuid[]) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_game_id uuid;
  i         int;
BEGIN
  PERFORM public.require_mfa();

  IF NOT public.is_admin() THEN
    INSERT INTO security_events (event_type, severity, user_id, details)
    VALUES ('admin_access_denied', 'warn', auth.uid(),
      jsonb_build_object('rpc', 'rpc_admin_trivia_create_game'))
    ON CONFLICT DO NOTHING;
    RETURN json_build_object('error','unauthorized');
  END IF;

  INSERT INTO public.trivia_games(title, max_participants, allow_teams, min_team_size, created_by)
  VALUES (p_title, p_max_participants, p_allow_teams, p_min_team_size, auth.uid())
  RETURNING id INTO v_game_id;

  FOR i IN 1..array_length(p_question_ids, 1) LOOP
    INSERT INTO public.trivia_game_questions(game_id, question_id, question_order)
    VALUES (v_game_id, p_question_ids[i], i);
  END LOOP;

  INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'trivia_create_game', 'trivia_game', v_game_id::text,
          jsonb_build_object('title', p_title, 'question_count', array_length(p_question_ids, 1)));

  RETURN json_build_object('ok', true, 'game_id', v_game_id);
END; $$;


--
-- Name: rpc_admin_trivia_delete_game(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_admin_trivia_delete_game(p_game_id uuid) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  PERFORM public.require_mfa();

  IF NOT public.is_admin() THEN
    INSERT INTO security_events (event_type, severity, user_id, details)
    VALUES ('admin_access_denied', 'warn', auth.uid(),
      jsonb_build_object('rpc', 'rpc_admin_trivia_delete_game', 'game_id', p_game_id))
    ON CONFLICT DO NOTHING;
    RETURN json_build_object('error','unauthorized');
  END IF;

  DELETE FROM public.trivia_games WHERE id = p_game_id;

  INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'trivia_delete_game', 'trivia_game', p_game_id::text, '{}');

  RETURN json_build_object('ok', true);
END; $$;


--
-- Name: rpc_admin_trivia_end_game(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_admin_trivia_end_game(p_game_id uuid) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  PERFORM public.require_mfa();

  IF NOT public.is_admin() THEN
    INSERT INTO security_events (event_type, severity, user_id, details)
    VALUES ('admin_access_denied', 'warn', auth.uid(),
      jsonb_build_object('rpc', 'rpc_admin_trivia_end_game', 'game_id', p_game_id))
    ON CONFLICT DO NOTHING;
    RETURN json_build_object('error','unauthorized');
  END IF;

  UPDATE public.trivia_games SET status = 'finished', ended_at = now() WHERE id = p_game_id;

  INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'trivia_end_game', 'trivia_game', p_game_id::text, '{}');

  RETURN json_build_object('ok', true);
END; $$;


--
-- Name: rpc_admin_trivia_grade(uuid, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_admin_trivia_grade(p_answer_id uuid, p_is_correct boolean) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_ans record;
  v_pts int;
BEGIN
  PERFORM public.require_mfa();

  IF NOT public.is_admin() THEN
    INSERT INTO security_events (event_type, severity, user_id, details)
    VALUES ('admin_access_denied', 'warn', auth.uid(),
      jsonb_build_object('rpc', 'rpc_admin_trivia_grade', 'answer_id', p_answer_id))
    ON CONFLICT DO NOTHING;
    RETURN json_build_object('error','unauthorized');
  END IF;

  SELECT a.*, q.points INTO v_ans
  FROM public.trivia_answers a
  JOIN public.trivia_questions q ON q.id = a.question_id
  WHERE a.id = p_answer_id;
  IF NOT FOUND THEN RETURN json_build_object('error','not_found'); END IF;

  v_pts := CASE WHEN p_is_correct THEN v_ans.points ELSE 0 END;
  UPDATE public.trivia_answers SET is_correct = p_is_correct, points_awarded = v_pts WHERE id = p_answer_id;
  IF p_is_correct THEN
    UPDATE public.trivia_participants SET score = score + v_pts WHERE id = v_ans.participant_id;
  END IF;
  RETURN json_build_object('ok', true);
END; $$;


--
-- Name: rpc_admin_trivia_next_question(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_admin_trivia_next_question(p_game_id uuid) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_game    record;
  v_next_qid uuid;
  v_next_idx int;
BEGIN
  PERFORM public.require_mfa();

  IF NOT public.is_admin() THEN
    INSERT INTO security_events (event_type, severity, user_id, details)
    VALUES ('admin_access_denied', 'warn', auth.uid(),
      jsonb_build_object('rpc', 'rpc_admin_trivia_next_question', 'game_id', p_game_id))
    ON CONFLICT DO NOTHING;
    RETURN json_build_object('error','unauthorized');
  END IF;

  SELECT * INTO v_game FROM public.trivia_games WHERE id = p_game_id AND status = 'active';
  IF NOT FOUND THEN RETURN json_build_object('error','game_not_active'); END IF;

  v_next_idx := v_game.current_question_index + 1;
  SELECT question_id INTO v_next_qid FROM public.trivia_game_questions
  WHERE game_id = p_game_id AND question_order = v_next_idx;

  IF NOT FOUND THEN
    -- No more questions — end game
    UPDATE public.trivia_games SET status = 'finished', ended_at = now() WHERE id = p_game_id;
    RETURN json_build_object('ok', true, 'finished', true);
  END IF;

  UPDATE public.trivia_games
  SET current_question_index = v_next_idx, current_question_id = v_next_qid
  WHERE id = p_game_id;

  RETURN json_build_object('ok', true, 'finished', false, 'question_id', v_next_qid);
END; $$;


--
-- Name: rpc_admin_trivia_start_game(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_admin_trivia_start_game(p_game_id uuid) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE v_first_qid uuid;
BEGIN
  PERFORM public.require_mfa();

  IF NOT public.is_admin() THEN
    INSERT INTO security_events (event_type, severity, user_id, details)
    VALUES ('admin_access_denied', 'warn', auth.uid(),
      jsonb_build_object('rpc', 'rpc_admin_trivia_start_game', 'game_id', p_game_id))
    ON CONFLICT DO NOTHING;
    RETURN json_build_object('error','unauthorized');
  END IF;

  SELECT question_id INTO v_first_qid FROM public.trivia_game_questions
  WHERE game_id = p_game_id AND question_order = 1;
  IF NOT FOUND THEN RETURN json_build_object('error','no_questions'); END IF;

  UPDATE public.trivia_games
  SET status = 'active', current_question_index = 1,
      current_question_id = v_first_qid, started_at = now()
  WHERE id = p_game_id AND status = 'lobby';

  INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'trivia_start_game', 'trivia_game', p_game_id::text, '{}');

  RETURN json_build_object('ok', true, 'question_id', v_first_qid);
END; $$;


--
-- Name: rpc_admin_update_beta_report(uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_admin_update_beta_report(p_id uuid, p_status text, p_admin_note text DEFAULT NULL::text) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  PERFORM public.require_mfa();
  IF NOT public.is_admin() THEN
    INSERT INTO security_events (event_type, severity, user_id, details)
    VALUES ('admin_access_denied', 'warn', auth.uid(),
      jsonb_build_object('rpc', 'rpc_admin_update_beta_report'))
    ON CONFLICT DO NOTHING;
    RETURN json_build_object('error', 'unauthorized');
  END IF;
  IF p_status NOT IN ('open','triaged','in_progress','fixed','wont_fix','duplicate') THEN
    RETURN json_build_object('error', 'invalid_status');
  END IF;

  UPDATE beta_reports
     SET status = p_status,
         admin_note = COALESCE(left(p_admin_note, 1000), admin_note),
         updated_at = now()
   WHERE id = p_id;
  IF NOT FOUND THEN RETURN json_build_object('error', 'not_found'); END IF;

  INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'beta_report_update', 'beta_report', p_id::text,
          jsonb_build_object('status', p_status));

  RETURN json_build_object('ok', true);
END;
$$;


--
-- Name: rpc_admin_update_forum_status(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_admin_update_forum_status(p_forum_id uuid, p_status text) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_forum record;
BEGIN
  PERFORM public.require_mfa();

  SELECT id, title, venue_id INTO v_forum FROM forums WHERE id = p_forum_id;
  IF NOT FOUND THEN
    RETURN json_build_object('error', 'not_found');
  END IF;

  -- Platform admin OR venue admin for this forum's venue
  IF NOT (
    public.is_platform_admin()
    OR (v_forum.venue_id IS NOT NULL AND public.is_venue_admin(v_forum.venue_id))
  ) THEN
    INSERT INTO security_events (event_type, severity, user_id, details)
    VALUES ('admin_permission_denied', 'warn', auth.uid(),
      jsonb_build_object('rpc', 'update_forum_status', 'forum_id', p_forum_id))
    ON CONFLICT DO NOTHING;
    RETURN json_build_object('error', 'unauthorized', 'message', 'Admin only.');
  END IF;

  IF p_status NOT IN ('approved', 'rejected') THEN
    RETURN json_build_object('error', 'invalid_status',
      'message', 'Status must be approved or rejected.');
  END IF;

  UPDATE forums SET status = p_status WHERE id = p_forum_id;

  INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (
    auth.uid(), 'forum_status_update', 'forum', p_forum_id::text,
    jsonb_build_object('new_status', p_status, 'title', v_forum.title,
                       'venue_id', v_forum.venue_id)
  );

  RETURN json_build_object('ok', true);
END;
$$;


--
-- Name: rpc_admin_update_tournament(uuid, text, text, timestamp with time zone, integer, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_admin_update_tournament(p_tournament_id uuid, p_title text DEFAULT NULL::text, p_game_type text DEFAULT NULL::text, p_proposed_date timestamp with time zone DEFAULT NULL::timestamp with time zone, p_max_players integer DEFAULT NULL::integer, p_signup_time text DEFAULT NULL::text, p_start_time text DEFAULT NULL::text) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_title    text;
  v_venue_id uuid;
BEGIN
  PERFORM public.require_mfa();

  SELECT title, venue_id INTO v_title, v_venue_id
    FROM tournaments WHERE id = p_tournament_id;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'tournament_not_found');
  END IF;

  IF NOT (public.is_admin() OR
          (v_venue_id IS NOT NULL AND public.can_manage_venue(v_venue_id))) THEN
    INSERT INTO security_events (event_type, severity, user_id, details)
    VALUES ('admin_access_denied', 'warn', auth.uid(),
      jsonb_build_object('rpc', 'rpc_admin_update_tournament', 'tournament_id', p_tournament_id))
    ON CONFLICT DO NOTHING;
    RETURN json_build_object('error', 'unauthorized');
  END IF;

  UPDATE tournaments SET
    title          = COALESCE(NULLIF(trim(p_title), ''),        title),
    game_type      = COALESCE(NULLIF(trim(p_game_type), ''),    game_type),
    proposed_date  = COALESCE(p_proposed_date,                  proposed_date),
    max_players    = COALESCE(p_max_players,                    max_players),
    ff_signup_time = COALESCE(NULLIF(trim(p_signup_time), ''),  ff_signup_time),
    ff_start_time  = COALESCE(NULLIF(trim(p_start_time), ''),   ff_start_time)
  WHERE id = p_tournament_id;

  INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'update_tournament', 'tournament', p_tournament_id::text,
          jsonb_build_object('title', v_title));

  RETURN json_build_object('ok', true);
END;
$$;


--
-- Name: rpc_architect_report(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_architect_report() RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
DECLARE
  v_ok boolean;
BEGIN
  SELECT (is_admin OR role IN ('owner','architect')) INTO v_ok
    FROM profiles WHERE id = auth.uid();
  IF NOT COALESCE(v_ok, false) THEN
    RETURN json_build_object('error', 'unauthorized');
  END IF;

  RETURN json_build_object(
    'security', json_build_object(
      'by_type_7d', (
        SELECT COALESCE(json_agg(row_to_json(t) ORDER BY t.n DESC), '[]'::json) FROM (
          SELECT event_type, severity, count(*) AS n
          FROM security_events WHERE created_at > now() - interval '7 days'
          GROUP BY 1, 2 ORDER BY count(*) DESC LIMIT 12
        ) t
      ),
      'recent', (
        SELECT COALESCE(json_agg(row_to_json(e)), '[]'::json) FROM (
          SELECT event_type, severity, details, created_at
          FROM security_events ORDER BY created_at DESC LIMIT 15
        ) e
      )
    ),
    'audit_recent', (
      SELECT COALESCE(json_agg(row_to_json(a)), '[]'::json) FROM (
        SELECT al.action, al.target_type, al.created_at, p.username AS admin_name
        FROM admin_audit_log al LEFT JOIN profiles p ON p.id = al.admin_id
        ORDER BY al.created_at DESC LIMIT 15
      ) a
    ),
    'ai_verification', (
      SELECT json_build_object(
        'auto_denied',  count(*) FILTER (WHERE ai_verdict = 'auto_denied'),
        'looks_good',   count(*) FILTER (WHERE ai_verdict = 'looks_good'),
        'needs_review', count(*) FILTER (WHERE ai_verdict = 'needs_review'),
        'no_reference', count(*) FILTER (WHERE ai_verdict = 'no_reference'),
        'errors',       count(*) FILTER (WHERE ai_verdict = 'error'),
        'disagreements', count(*) FILTER (WHERE ai_verdict = 'looks_good' AND status = 'denied')
      ) FROM scores WHERE ai_checked_at IS NOT NULL
    ),
    'reports', json_build_object(
      'content_pending', (SELECT count(*) FROM content_reports WHERE status = 'pending'),
      'beta_by_status', (
        SELECT COALESCE(json_agg(row_to_json(b)), '[]'::json) FROM (
          SELECT status, count(*) AS n FROM beta_reports GROUP BY 1
        ) b
      )
    ),
    'api_health', json_build_object(
      'karaoke_cache_entries',   (SELECT count(*) FROM karaoke_search_cache),
      'karaoke_cache_hits',      (SELECT COALESCE(SUM(hits), 0) FROM karaoke_search_cache),
      'webhook_events_7d',       (SELECT count(*) FROM square_webhook_events WHERE received_at > now() - interval '7 days'),
      'webhook_bad_sig_7d',      (SELECT count(*) FROM security_events WHERE event_type = 'payment_webhook_invalid_sig' AND created_at > now() - interval '7 days'),
      'rate_limit_trips_24h',    (SELECT count(*) FROM rate_limit_log WHERE created_at > now() - interval '24 hours')
    ),
    'integrity', json_build_object(
      'users_without_profiles', (SELECT count(*) FROM auth.users u LEFT JOIN profiles p ON p.id = u.id WHERE p.id IS NULL),
      'placeholder_usernames',  (SELECT count(*) FROM profiles WHERE username ~ '^user_[0-9a-f]{32}$'),
      'sessions_stuck_active',  (SELECT count(*) FROM skeeball_sessions WHERE status = 'active' AND last_activity_at < now() - interval '24 hours'),
      'scores_pending_7d',      (SELECT count(*) FROM scores WHERE status = 'pending' AND created_at < now() - interval '7 days'),
      'cleanup_queue_depth',    (SELECT count(*) FROM storage_cleanup_queue WHERE processed_at IS NULL)
    )
  );
END; $_$;


--
-- Name: rpc_attach_score_proof(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_attach_score_proof(p_score_id uuid, p_storage_path text) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN json_build_object('error', 'unauthenticated');
  END IF;

  -- Path must begin with caller's UID to prevent traversal to other users' folders
  IF p_storage_path IS NULL OR NOT (p_storage_path LIKE (v_uid::text || '/%')) THEN
    RETURN json_build_object('error', 'forbidden',
      'message', 'Storage path must start with your user ID.');
  END IF;

  -- Only the score owner can attach proof, and only while status = pending
  UPDATE scores
     SET proof_storage_path = p_storage_path
   WHERE id      = p_score_id
     AND user_id = v_uid
     AND status  = 'pending';

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'not_found_or_not_pending',
      'message', 'Score not found, not owned by you, or already reviewed.');
  END IF;

  RETURN json_build_object('ok', true);
END; $$;


--
-- Name: rpc_beta_submit_report(text, text, text, text, text, text, text, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_beta_submit_report(p_category text, p_severity text, p_title text, p_description text, p_steps text DEFAULT NULL::text, p_route text DEFAULT NULL::text, p_platform text DEFAULT NULL::text, p_app_version text DEFAULT NULL::text, p_device_info text DEFAULT NULL::text, p_screenshot_url text DEFAULT NULL::text) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_id  uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN json_build_object('error', 'not_authenticated');
  END IF;
  IF NOT COALESCE((SELECT is_beta_tester FROM profiles WHERE id = v_uid), false) THEN
    RETURN json_build_object('error', 'not_beta_tester',
      'message', 'The enhanced feedback tool is for beta testers. Ask an admin for access.');
  END IF;
  IF p_category NOT IN ('bug','glitch','visual','performance','crash','site_breaking','suggestion')
     OR p_severity NOT IN ('low','medium','high','critical') THEN
    RETURN json_build_object('error', 'invalid', 'message', 'Invalid category or severity.');
  END IF;
  IF length(trim(COALESCE(p_title, ''))) < 3 OR length(trim(COALESCE(p_description, ''))) < 3 THEN
    RETURN json_build_object('error', 'invalid',
      'message', 'Give the report a short title and describe what happened.');
  END IF;

  -- generous limit — beta testers reporting a lot is the whole point
  BEGIN
    PERFORM public.check_and_log_rate_limit('beta_report', 3600, 30);
  EXCEPTION WHEN OTHERS THEN
    RETURN json_build_object('error', 'rate_limited',
      'message', 'That''s a lot of reports in an hour — take a breather and try again soon.');
  END;

  INSERT INTO beta_reports
    (user_id, category, severity, title, description, steps,
     route, platform, app_version, device_info, screenshot_url)
  VALUES
    (v_uid, p_category, p_severity, left(trim(p_title), 120), left(trim(p_description), 4000),
     NULLIF(left(trim(COALESCE(p_steps, '')), 4000), ''),
     left(p_route, 200), left(p_platform, 40), left(p_app_version, 60),
     left(p_device_info, 200), p_screenshot_url)
  RETURNING id INTO v_id;

  RETURN json_build_object('ok', true, 'id', v_id);
END;
$$;


--
-- Name: rpc_cancel_sub(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_cancel_sub(p_request_id uuid) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: rpc_check_in(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_check_in(p_token text) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_user_id    uuid;
  v_lqt        record;
  v_game       record;
  v_ci_id      uuid;
  v_cutoff     timestamptz;
  v_token_hash text;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN json_build_object('error', 'not_authenticated',
      'message', 'You must be logged in to check in.');
  END IF;

  v_token_hash := public.hash_lane_token(p_token);

  -- Hash-only lookup — legacy lane_qr_token fallback removed.
  SELECT lqt.*, l.id AS lane_id, l.lane_number, l.game_id, l.venue_id, l.status AS lane_status
    INTO v_lqt
    FROM lane_qr_tokens lqt
    JOIN lanes           l ON l.id = lqt.lane_id
   WHERE lqt.token_hash = v_token_hash
   LIMIT 1;

  IF NOT FOUND THEN
    INSERT INTO security_events (event_type, severity, user_id, details)
    VALUES ('qr_token_invalid', 'warn', v_user_id,
      jsonb_build_object('token_fingerprint', public.qr_token_fingerprint(p_token)))
    ON CONFLICT DO NOTHING;
    RETURN json_build_object('error', 'lane_not_found',
      'message', 'This QR code does not match any lane. Ask staff to scan the current code.');
  END IF;

  -- Validate token state
  IF v_lqt.revoked_at IS NOT NULL THEN
    INSERT INTO security_events (event_type, severity, user_id, details)
    VALUES ('qr_token_revoked', 'warn', v_user_id,
      jsonb_build_object('token_fingerprint', public.qr_token_fingerprint(p_token), 'lane_id', v_lqt.lane_id))
    ON CONFLICT DO NOTHING;
    RETURN json_build_object('error', 'token_revoked',
      'message', 'This QR code has been revoked. Ask staff for a new one.');
  END IF;

  IF v_lqt.expires_at < now() THEN
    INSERT INTO security_events (event_type, severity, user_id, details)
    VALUES ('qr_token_expired', 'warn', v_user_id,
      jsonb_build_object('token_fingerprint', public.qr_token_fingerprint(p_token), 'lane_id', v_lqt.lane_id))
    ON CONFLICT DO NOTHING;
    RETURN json_build_object('error', 'token_expired',
      'message', 'This QR code has expired. Ask staff to regenerate it.');
  END IF;

  -- Skee-Ball uses manual lane selection — QR check-in disabled
  SELECT g.name, g.type INTO v_game
    FROM games g WHERE g.id = v_lqt.game_id;

  IF v_game.type = 'skeeball' THEN
    RETURN json_build_object(
      'error',   'qr_disabled',
      'message', 'Skee-Ball lanes don''t use QR check-in. Choose your lane from the Games screen.'
    );
  END IF;

  IF v_lqt.lane_status IS NOT NULL AND v_lqt.lane_status = 'inactive' THEN
    RETURN json_build_object('error', 'lane_inactive',
      'message', 'This lane is currently inactive.');
  END IF;

  -- Prevent duplicate active check-ins
  IF EXISTS (
    SELECT 1 FROM check_ins
     WHERE user_id = v_user_id AND status = 'active'
  ) THEN
    RETURN json_build_object('error', 'already_active',
      'message', 'You already have an active session. End it before scanning a new lane.');
  END IF;

  -- 30-minute cooldown per lane
  v_cutoff := now() - interval '30 minutes';
  IF EXISTS (
    SELECT 1 FROM check_ins
     WHERE user_id    = v_user_id
       AND lane_id    = v_lqt.lane_id
       AND created_at > v_cutoff
  ) THEN
    INSERT INTO security_events (event_type, severity, user_id, details)
    VALUES ('qr_checkin_rate_limited', 'info', v_user_id,
      jsonb_build_object('lane_id', v_lqt.lane_id))
    ON CONFLICT DO NOTHING;
    RETURN json_build_object('error', 'rate_limited',
      'message', 'You checked into this lane recently. Wait 30 minutes before scanning again.');
  END IF;

  INSERT INTO check_ins (user_id, lane_id, venue_id, status)
  VALUES (v_user_id, v_lqt.lane_id, v_lqt.venue_id, 'active')
  RETURNING id INTO v_ci_id;

  RETURN json_build_object(
    'check_in_id',  v_ci_id,
    'lane_id',      v_lqt.lane_id,
    'lane_number',  v_lqt.lane_number,
    'game_id',      v_lqt.game_id,
    'game_name',    COALESCE(v_game.name, 'Game'),
    'game_type',    COALESCE(v_game.type, 'arcade'),
    'venue_id',     v_lqt.venue_id
  );
END;
$$;


--
-- Name: rpc_claim_sub(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_claim_sub(p_request_id uuid) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: rpc_fantasy_buy_player(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_fantasy_buy_player(p_player_user_id uuid) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN json_build_object('error', 'not_authenticated'); END IF;
  IF NOT public.fantasy_full_mode() THEN
    RETURN json_build_object('error', 'locked',
      'message', 'The transfer market unlocks with the full fantasy launch — early 2027.');
  END IF;
  -- Full implementation lands with the Phase 2 launch (roster create,
  -- budget check, price lock, transfer log). Hard-gated until then.
  RETURN json_build_object('error', 'coming_soon',
    'message', 'Roster building opens with the full fantasy launch.');
END;
$$;


--
-- Name: rpc_fantasy_cancel_prediction(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_fantasy_cancel_prediction(p_id uuid) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_pred record;
BEGIN
  IF v_uid IS NULL THEN RETURN json_build_object('error', 'not_authenticated'); END IF;

  SELECT * INTO v_pred FROM fantasy_predictions
   WHERE id = p_id AND user_id = v_uid AND status = 'pending';
  IF NOT FOUND THEN
    RETURN json_build_object('error', 'not_found');
  END IF;
  IF v_pred.week_of <> public.skeeball_current_week()
     OR public.fantasy_week_locked(v_pred.week_of) THEN
    RETURN json_build_object('error', 'locked',
      'message', 'Too late — the board is locked.');
  END IF;

  DELETE FROM fantasy_predictions WHERE id = p_id;
  UPDATE fantasy_wallets
     SET balance = balance + v_pred.stake, updated_at = now()
   WHERE user_id = v_uid;

  RETURN json_build_object('ok', true);
END;
$$;


--
-- Name: rpc_fantasy_get_state(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_fantasy_get_state() RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_week     date := public.skeeball_current_week();
  v_stipend  boolean := false;
  v_wallet   record;
  v_board    json;
  v_my_picks json;
  v_history  json;
  v_results  json;
  v_leaders  json;
  v_seasons_done int;
  v_seasons_req  int;
BEGIN
  IF v_uid IS NULL THEN RETURN json_build_object('error', 'not_authenticated'); END IF;

  PERFORM public.fantasy_settle_pending();

  INSERT INTO fantasy_wallets (user_id) VALUES (v_uid) ON CONFLICT (user_id) DO NOTHING;

  -- weekly stipend: +20 once per league week
  UPDATE fantasy_wallets
     SET balance = balance + 20, last_stipend_week = v_week, updated_at = now()
   WHERE user_id = v_uid
     AND (last_stipend_week IS NULL OR last_stipend_week < v_week)
  RETURNING true INTO v_stipend;
  v_stipend := COALESCE(v_stipend, false);

  SELECT * INTO v_wallet FROM fantasy_wallets WHERE user_id = v_uid;

  SELECT count(*) INTO v_seasons_done
    FROM skeeball_seasons WHERE status = 'completed' AND counts_for_fantasy;
  SELECT seasons_required INTO v_seasons_req FROM fantasy_config WHERE id = 1;

  -- Board: every team with league history, with per-line locked odds
  SELECT COALESCE(json_agg(row_to_json(b) ORDER BY b.avg_weekly DESC), '[]'::json)
    INTO v_board
    FROM (
      SELECT
        t.id   AS team_id,
        t.name AS team_name,
        w.weeks_played,
        ROUND(w.avg_weekly, 1) AS avg_weekly,
        w.last_week_pts,
        (w.last_week_pts IS NOT NULL AND w.weeks_played >= 2
          AND w.last_week_pts > w.avg_weekly * 1.25) AS hot,
        (SELECT json_agg(json_build_object(
            'line', l.line,
            'over',  public.fantasy_line_multiplier(t.id, l.line, 'over'),
            'under', public.fantasy_line_multiplier(t.id, l.line, 'under')
          ) ORDER BY l.line)
          FROM (VALUES (15), (20), (25), (30)) AS l(line)) AS lines
      FROM teams t
      JOIN (
        SELECT team_id,
               count(*) AS weeks_played,
               AVG(wk_pts) AS avg_weekly,
               MAX(wk_pts) FILTER (WHERE week_of = v_week - 7) AS last_week_pts
          FROM (
            SELECT team_id, week_of,
                   SUM(COALESCE(league_points, 0) + COALESCE(league_points_adjustment, 0)) AS wk_pts
              FROM skeeball_sessions
             WHERE status = 'completed'
             GROUP BY team_id, week_of
          ) wt
         GROUP BY team_id
      ) w ON w.team_id = t.id
    ) b;

  SELECT COALESCE(json_agg(row_to_json(m) ORDER BY m.created_at), '[]'::json)
    INTO v_my_picks
    FROM (
      SELECT p.id, p.team_id, t.name AS team_name, p.line, p.pick, p.stake,
             p.multiplier, p.status, p.created_at
        FROM fantasy_predictions p
        JOIN teams t ON t.id = p.team_id
       WHERE p.user_id = v_uid AND p.week_of = v_week
    ) m;

  SELECT COALESCE(json_agg(row_to_json(h) ORDER BY h.settled_at DESC), '[]'::json)
    INTO v_history
    FROM (
      SELECT p.week_of, t.name AS team_name, p.line, p.pick, p.stake,
             p.multiplier, p.status, p.result_points, p.payout, p.settled_at
        FROM fantasy_predictions p
        JOIN teams t ON t.id = p.team_id
       WHERE p.user_id = v_uid AND p.status <> 'pending'
       ORDER BY p.settled_at DESC
       LIMIT 25
    ) h;

  SELECT COALESCE(json_agg(row_to_json(r) ORDER BY r.points DESC), '[]'::json)
    INTO v_results
    FROM (
      SELECT t.name AS team_name,
             SUM(COALESCE(s.league_points, 0) + COALESCE(s.league_points_adjustment, 0))::int AS points
        FROM skeeball_sessions s
        JOIN teams t ON t.id = s.team_id
       WHERE s.week_of = v_week - 7 AND s.status = 'completed'
       GROUP BY t.name
    ) r;

  SELECT COALESCE(json_agg(row_to_json(l)), '[]'::json)
    INTO v_leaders
    FROM (
      SELECT COALESCE(pp.username, 'Mystery Player') AS username,
             pp.avatar_url,
             w.lifetime_earned,
             (w.user_id = v_uid) AS is_me
        FROM fantasy_wallets w
        LEFT JOIN public_profiles pp ON pp.id = w.user_id
       WHERE w.lifetime_earned > 0
       ORDER BY w.lifetime_earned DESC
       LIMIT 20
    ) l;

  RETURN json_build_object(
    'week_of',          v_week,
    'locked',           public.fantasy_week_locked(v_week),
    'balance',          v_wallet.balance,
    'lifetime_earned',  v_wallet.lifetime_earned,
    'stipend_granted',  v_stipend,
    'full_mode',        public.fantasy_full_mode(),
    'seasons_done',     v_seasons_done,
    'seasons_required', v_seasons_req,
    'board',            v_board,
    'my_picks',         v_my_picks,
    'history',          v_history,
    'last_week_results', v_results,
    'leaderboard',      v_leaders
  );
END;
$$;


--
-- Name: rpc_fantasy_market(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_fantasy_market() RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_players json;
BEGIN
  IF v_uid IS NULL THEN RETURN json_build_object('error', 'not_authenticated'); END IF;

  SELECT COALESCE(json_agg(row_to_json(p) ORDER BY p.price DESC), '[]'::json)
    INTO v_players
    FROM (
      SELECT
        st.user_id AS player_user_id,
        COALESCE(pp.username, 'Mystery Player') AS username,
        pp.avatar_url,
        st.games,
        ROUND(st.avg_score, 1) AS avg_score,
        -- price: scoring average drives it, volume stabilises it,
        -- tournament podiums add a premium
        LEAST(GREATEST(
          ROUND(st.avg_score * 2 + LEAST(st.games, 50) + COALESCE(tp.podiums, 0) * 25)::int,
        50), 500) AS price,
        (st.recent_avg IS NOT NULL AND st.recent_games >= 3
          AND st.recent_avg > st.avg_score * 1.15) AS hot,
        COALESCE(tp.podiums, 0) AS tournament_podiums
      FROM (
        SELECT s.user_id,
               count(*) AS games,
               AVG(s.score) AS avg_score,
               AVG(s.score) FILTER (WHERE s.created_at > now() - interval '14 days') AS recent_avg,
               count(*) FILTER (WHERE s.created_at > now() - interval '14 days') AS recent_games
          FROM scores s
          JOIN games g ON g.id = s.game_id
         WHERE g.type = 'skeeball' AND s.status = 'approved'
         GROUP BY s.user_id
        HAVING count(*) >= 3
      ) st
      LEFT JOIN (
        SELECT user_id, count(*) AS podiums
          FROM tournament_placements
         WHERE placement <= 3
         GROUP BY user_id
      ) tp ON tp.user_id = st.user_id
      LEFT JOIN public_profiles pp ON pp.id = st.user_id
    ) p;

  RETURN json_build_object(
    'full_mode', public.fantasy_full_mode(),
    'players',   v_players
  );
END;
$$;


--
-- Name: rpc_fantasy_place_prediction(uuid, integer, text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_fantasy_place_prediction(p_team_id uuid, p_line integer, p_pick text, p_stake integer) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_week    date := public.skeeball_current_week();
  v_mult    numeric;
  v_balance int;
  v_count   int;
BEGIN
  IF v_uid IS NULL THEN
    RETURN json_build_object('error', 'not_authenticated');
  END IF;
  IF p_line NOT IN (15, 20, 25, 30) OR p_pick NOT IN ('over', 'under') THEN
    RETURN json_build_object('error', 'invalid', 'message', 'Invalid line or pick.');
  END IF;
  IF p_stake IS NULL OR p_stake < 5 OR p_stake > 50 THEN
    RETURN json_build_object('error', 'invalid', 'message', 'Stake must be 5–50 coins.');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM teams WHERE id = p_team_id) THEN
    RETURN json_build_object('error', 'not_found', 'message', 'Team not found.');
  END IF;
  IF public.fantasy_week_locked(v_week) THEN
    RETURN json_build_object('error', 'locked',
      'message', 'The board is locked — this week''s games already started.');
  END IF;

  INSERT INTO fantasy_wallets (user_id) VALUES (v_uid) ON CONFLICT (user_id) DO NOTHING;

  SELECT count(*) INTO v_count
    FROM fantasy_predictions
   WHERE user_id = v_uid AND week_of = v_week AND status = 'pending';
  IF v_count >= 5 THEN
    RETURN json_build_object('error', 'limit',
      'message', 'Max 5 picks per week. Make them count!');
  END IF;

  SELECT balance INTO v_balance FROM fantasy_wallets WHERE user_id = v_uid FOR UPDATE;
  IF v_balance < p_stake THEN
    RETURN json_build_object('error', 'insufficient',
      'message', 'Not enough coins. Your weekly +20 stipend lands every Monday.');
  END IF;

  v_mult := public.fantasy_line_multiplier(p_team_id, p_line, p_pick);

  BEGIN
    INSERT INTO fantasy_predictions (user_id, week_of, team_id, line, pick, stake, multiplier)
    VALUES (v_uid, v_week, p_team_id, p_line, p_pick, p_stake, v_mult);
  EXCEPTION WHEN unique_violation THEN
    RETURN json_build_object('error', 'duplicate',
      'message', 'You already have a pick on that team at that line this week.');
  END;

  UPDATE fantasy_wallets
     SET balance = balance - p_stake, updated_at = now()
   WHERE user_id = v_uid;

  RETURN json_build_object('ok', true, 'multiplier', v_mult,
    'potential_payout', ROUND(p_stake * v_mult)::int,
    'balance', v_balance - p_stake);
END;
$$;


--
-- Name: rpc_fantasy_sell_player(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_fantasy_sell_player(p_player_user_id uuid) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN json_build_object('error', 'not_authenticated'); END IF;
  IF NOT public.fantasy_full_mode() THEN
    RETURN json_build_object('error', 'locked',
      'message', 'The transfer market unlocks with the full fantasy launch — early 2027.');
  END IF;
  RETURN json_build_object('error', 'coming_soon',
    'message', 'Roster building opens with the full fantasy launch.');
END;
$$;


--
-- Name: rpc_ff_generate_bracket(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_ff_generate_bracket(p_tournament_id uuid) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_count    int;
  v_users    uuid[];
  v_names    text[];
  v_rid      uuid;
  v_gid      uuid;
  v_g        int;
  v_i        int;
  v_venue_id uuid;
BEGIN
  PERFORM public.require_mfa();

  SELECT venue_id INTO v_venue_id FROM tournaments WHERE id = p_tournament_id;
  IF NOT FOUND THEN RETURN json_build_object('error','tournament_not_found'); END IF;

  IF NOT (public.is_admin() OR
          (v_venue_id IS NOT NULL AND public.can_manage_venue(v_venue_id))) THEN
    INSERT INTO security_events (event_type, severity, user_id, details)
    VALUES ('admin_access_denied', 'warn', auth.uid(),
      jsonb_build_object('rpc', 'rpc_ff_generate_bracket', 'tournament_id', p_tournament_id))
    ON CONFLICT DO NOTHING;
    RETURN json_build_object('error','unauthorized');
  END IF;

  SELECT COUNT(*) INTO v_count FROM tournament_registrations
  WHERE tournament_id = p_tournament_id AND status = 'accepted';
  IF v_count <> 32 THEN
    RETURN json_build_object('error','need_32_players','count',v_count);
  END IF;
  IF EXISTS (SELECT 1 FROM ff_bracket_rounds WHERE tournament_id = p_tournament_id) THEN
    RETURN json_build_object('error','bracket_already_exists');
  END IF;

  -- Shuffle players; guests get gen_random_uuid() as their slot user_id
  WITH shuffled AS (
    SELECT
      COALESCE(r.user_id, gen_random_uuid()) AS slot_uid,
      COALESCE(r.guest_name, p.username, au.email, 'Player') AS uname,
      ROW_NUMBER() OVER (ORDER BY random()) AS rn
    FROM tournament_registrations r
    LEFT JOIN profiles   p  ON p.id  = r.user_id
    LEFT JOIN auth.users au ON au.id = r.user_id
    WHERE r.tournament_id = p_tournament_id AND r.status = 'accepted'
  )
  SELECT array_agg(slot_uid ORDER BY rn),
         array_agg(uname    ORDER BY rn)
  INTO   v_users, v_names FROM shuffled;

  -- Round 1 (in_progress) + placeholder rounds 2-4
  INSERT INTO ff_bracket_rounds (tournament_id, round_number, round_name, status)
  VALUES
    (p_tournament_id, 1, 'Round of 32', 'in_progress'),
    (p_tournament_id, 2, 'Top 16',      'pending'),
    (p_tournament_id, 3, 'Final 8',     'pending'),
    (p_tournament_id, 4, 'Final 4',     'pending');

  SELECT id INTO v_rid FROM ff_bracket_rounds
  WHERE tournament_id = p_tournament_id AND round_number = 1;

  FOR v_g IN 1..8 LOOP
    INSERT INTO ff_bracket_groups (round_id, tournament_id, group_number, status)
    VALUES (v_rid, p_tournament_id, v_g, 'game1')
    RETURNING id INTO v_gid;

    FOR v_i IN 1..4 LOOP
      INSERT INTO ff_bracket_slots (group_id, tournament_id, user_id, username, seed)
      VALUES (v_gid, p_tournament_id, v_users[(v_g-1)*4+v_i], v_names[(v_g-1)*4+v_i], v_i);
    END LOOP;

    INSERT INTO ff_bracket_games (group_id, tournament_id, game_number, status)
    VALUES (v_gid, p_tournament_id, 1, 'pending'),
           (v_gid, p_tournament_id, 2, 'pending');
  END LOOP;

  UPDATE tournaments SET status = 'active' WHERE id = p_tournament_id;

  INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'ff_generate_bracket', 'tournament', p_tournament_id::text, '{}');

  RETURN json_build_object('ok', true);
END; $$;


--
-- Name: rpc_ff_get_bracket(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_ff_get_bracket(p_tournament_id uuid) RETURNS json
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT json_build_object(
    'rounds', (
      SELECT json_agg(
        json_build_object(
          'id',           r.id,
          'round_number', r.round_number,
          'round_name',   r.round_name,
          'status',       r.status,
          'groups', (
            SELECT json_agg(
              json_build_object(
                'id',           g.id,
                'group_number', g.group_number,
                'status',       g.status,
                'slots', (
                  SELECT json_agg(
                    json_build_object(
                      'user_id',        s.user_id,
                      'username',       s.username,
                      'seed',           s.seed,
                      'status',         s.status,
                      'eliminated_game',s.eliminated_game,
                      'final_rank',     s.final_rank
                    ) ORDER BY s.seed
                  ) FROM ff_bracket_slots s WHERE s.group_id = g.id
                ),
                'games', (
                  SELECT json_agg(
                    json_build_object(
                      'id',          gm.id,
                      'game_number', gm.game_number,
                      'status',      gm.status,
                      'scores', (
                        SELECT json_agg(
                          json_build_object(
                            'user_id',      sc.user_id,
                            'username',     sc.username,
                            'score',        sc.score,
                            'rank_in_game', sc.rank_in_game,
                            'is_eliminated',sc.is_eliminated
                          ) ORDER BY sc.rank_in_game
                        ) FROM ff_bracket_scores sc WHERE sc.game_id = gm.id
                      )
                    ) ORDER BY gm.game_number
                  ) FROM ff_bracket_games gm WHERE gm.group_id = g.id
                )
              ) ORDER BY g.group_number
            ) FROM ff_bracket_groups g WHERE g.round_id = r.id
          )
        ) ORDER BY r.round_number
      ) FROM ff_bracket_rounds r WHERE r.tournament_id = p_tournament_id
    )
  );
$$;


--
-- Name: rpc_ff_get_guest_players(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_ff_get_guest_players(p_tournament_id uuid) RETURNS json
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT json_build_object(
    'guests', COALESCE(
      (SELECT json_agg(json_build_object('id', id, 'guest_name', guest_name) ORDER BY created_at)
       FROM tournament_registrations
       WHERE tournament_id = p_tournament_id AND user_id IS NULL AND status = 'accepted'),
      '[]'::json
    )
  );
$$;


--
-- Name: rpc_ff_qr_signup(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_ff_qr_signup(p_token uuid) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_tourn_id uuid;
  v_max      integer;
  v_count    integer;
  v_already  boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN json_build_object('error', 'not_authenticated');
  END IF;

  SELECT id, COALESCE(max_players, 20)
    INTO v_tourn_id, v_max
    FROM tournaments
   WHERE signup_qr_token = p_token
     AND signup_qr_active = true
     AND status IN ('upcoming', 'active');

  IF NOT FOUND THEN
    RETURN json_build_object(
      'error', 'invalid_or_inactive',
      'message', 'This QR code is no longer active.'
    );
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM tournament_registrations
     WHERE tournament_id = v_tourn_id AND user_id = auth.uid()
  ) INTO v_already;

  IF v_already THEN
    RETURN json_build_object(
      'error', 'already_registered',
      'message', 'You are already signed up for this tournament.'
    );
  END IF;

  SELECT COUNT(*) INTO v_count
    FROM tournament_registrations
   WHERE tournament_id = v_tourn_id AND status = 'accepted';

  IF v_count >= v_max THEN
    UPDATE tournaments SET signup_qr_active = false WHERE id = v_tourn_id;
    RETURN json_build_object(
      'error', 'full',
      'message', 'This tournament is full (20 players). The QR has been closed.'
    );
  END IF;

  INSERT INTO tournament_registrations (tournament_id, user_id, status)
  VALUES (v_tourn_id, auth.uid(), 'accepted')
  ON CONFLICT (tournament_id, user_id) DO NOTHING;

  SELECT COUNT(*) INTO v_count
    FROM tournament_registrations
   WHERE tournament_id = v_tourn_id AND status = 'accepted';

  IF v_count >= v_max THEN
    UPDATE tournaments SET signup_qr_active = false WHERE id = v_tourn_id;
  END IF;

  RETURN json_build_object(
    'ok',               true,
    'players_registered', v_count,
    'max_players',      v_max,
    'is_full',          v_count >= v_max
  );
END;
$$;


--
-- Name: rpc_ff_submit_game_scores(uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_ff_submit_game_scores(p_game_id uuid, p_scores jsonb) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_tid         uuid;
  v_gid         uuid;
  v_rid         uuid;
  v_rnum        int;
  v_gnum        int;
  v_entry       jsonb;
  v_loser_uid   uuid;
  v_loser_seed  int;
  v_loser_slot  uuid;
  v_left        int;
  v_next_rid    uuid;
  v_new_gid     uuid;
  v_users       uuid[];
  v_names       text[];
  v_n           int;
  v_g           int;
  v_i           int;
  v_num_players int;
  v_venue_id    uuid;
BEGIN
  PERFORM public.require_mfa();

  SELECT gm.tournament_id, gm.group_id, gm.game_number,
         bg.round_id, br.round_number
  INTO   v_tid, v_gid, v_gnum, v_rid, v_rnum
  FROM   ff_bracket_games  gm
  JOIN   ff_bracket_groups bg ON bg.id = gm.group_id
  JOIN   ff_bracket_rounds br ON br.id = bg.round_id
  WHERE  gm.id = p_game_id;
  IF NOT FOUND THEN RETURN json_build_object('error','game_not_found'); END IF;

  SELECT venue_id INTO v_venue_id FROM tournaments WHERE id = v_tid;

  IF NOT (public.is_admin() OR
          (v_venue_id IS NOT NULL AND public.can_manage_venue(v_venue_id))) THEN
    INSERT INTO security_events (event_type, severity, user_id, details)
    VALUES ('admin_access_denied', 'warn', auth.uid(),
      jsonb_build_object('rpc', 'rpc_ff_submit_game_scores', 'game_id', p_game_id, 'tournament_id', v_tid))
    ON CONFLICT DO NOTHING;
    RETURN json_build_object('error','unauthorized');
  END IF;

  INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'ff_submit_game_scores', 'tournament', v_tid::text,
          jsonb_build_object('game_id', p_game_id));

  -- ── Undo previous submission when re-editing ────────────────────────────────
  IF EXISTS (SELECT 1 FROM ff_bracket_games WHERE id = p_game_id AND status = 'completed') THEN
    IF v_gnum = 1 THEN
      DELETE FROM ff_bracket_scores
      WHERE game_id = (SELECT id FROM ff_bracket_games WHERE group_id = v_gid AND game_number = 2);
      UPDATE ff_bracket_games SET status = 'pending'
      WHERE group_id = v_gid AND game_number = 2;
      UPDATE ff_bracket_slots SET status = 'active', eliminated_game = NULL WHERE group_id = v_gid;
      UPDATE ff_bracket_groups SET status = 'game1' WHERE id = v_gid;
    ELSIF v_gnum = 2 THEN
      UPDATE ff_bracket_slots
      SET status = 'active', eliminated_game = NULL
      WHERE group_id = v_gid AND (status = 'advanced' OR eliminated_game = 2);
      UPDATE ff_bracket_groups SET status = 'game2' WHERE id = v_gid;
    END IF;
    UPDATE ff_bracket_rounds SET status = 'in_progress'
    WHERE id = v_rid AND status = 'completed';
    DELETE FROM ff_bracket_scores WHERE game_id = p_game_id;
    UPDATE ff_bracket_games SET status = 'pending' WHERE id = p_game_id;
  END IF;

  -- ── Upsert raw scores ────────────────────────────────────────────────────────
  FOR v_entry IN SELECT * FROM jsonb_array_elements(p_scores) LOOP
    INSERT INTO ff_bracket_scores (game_id, tournament_id, user_id, username, score, player_seed)
    SELECT p_game_id, v_tid,
           NULLIF((v_entry->>'user_id'), '')::uuid,
           COALESCE(
             (SELECT username FROM ff_bracket_slots
              WHERE group_id = v_gid AND seed = (v_entry->>'seed')::int LIMIT 1),
             'Player'
           ),
           (v_entry->>'score')::int,
           (v_entry->>'seed')::int
    ON CONFLICT (game_id, user_id, player_seed) DO UPDATE SET score = EXCLUDED.score;
  END LOOP;

  SELECT COUNT(*) INTO v_num_players FROM ff_bracket_scores WHERE game_id = p_game_id;

  -- Rank for display
  WITH rk AS (
    SELECT player_seed, RANK() OVER (ORDER BY score DESC) AS r
    FROM ff_bracket_scores WHERE game_id = p_game_id
  )
  UPDATE ff_bracket_scores s
  SET rank_in_game  = r.r,
      rank_points   = v_num_players - r.r + 1,
      is_eliminated = false
  FROM rk r
  WHERE s.game_id = p_game_id AND s.player_seed = r.player_seed;

  UPDATE ff_bracket_games SET status = 'completed' WHERE id = p_game_id;

  -- ── Final 4: 1 game, rank = placement ────────────────────────────────────────
  IF v_rnum = 4 THEN
    UPDATE ff_bracket_slots s
    SET    status = 'advanced', final_rank = sc.rank_in_game
    FROM   ff_bracket_scores sc
    WHERE  s.group_id = v_gid AND s.player_seed = sc.player_seed AND sc.game_id = p_game_id;
    UPDATE ff_bracket_groups SET status = 'completed' WHERE id = v_gid;
    UPDATE ff_bracket_rounds SET status = 'completed' WHERE id = v_rid;
    UPDATE tournaments        SET status = 'completed' WHERE id = v_tid;
    INSERT INTO tournament_placements (tournament_id, placement, user_id, username)
    SELECT v_tid, s.final_rank, s.user_id, s.username
    FROM   ff_bracket_slots s JOIN ff_bracket_groups g ON g.id = s.group_id
    WHERE  g.round_id = v_rid
    ON CONFLICT DO NOTHING;
    RETURN json_build_object('ok', true, 'tournament_complete', true);
  END IF;

  -- ── Round of 32: 2 games per group, 1 eliminated per game ────────────────────
  IF v_rnum = 1 THEN
    SELECT sc.user_id, sc.player_seed INTO v_loser_uid, v_loser_seed
    FROM   ff_bracket_scores sc
    WHERE  sc.game_id = p_game_id
    ORDER  BY sc.score ASC, sc.player_seed ASC LIMIT 1;

    SELECT id INTO v_loser_slot
    FROM   ff_bracket_slots
    WHERE  group_id = v_gid AND seed = v_loser_seed AND status = 'active'
    ORDER  BY id LIMIT 1;

    UPDATE ff_bracket_scores SET is_eliminated = true
    WHERE  game_id = p_game_id AND player_seed = v_loser_seed;
    UPDATE ff_bracket_slots SET status = 'eliminated', eliminated_game = v_gnum
    WHERE  id = v_loser_slot;

    IF v_gnum = 1 THEN
      UPDATE ff_bracket_groups SET status = 'game2' WHERE id = v_gid;
      RETURN json_build_object('ok', true, 'next', 'game2');
    END IF;

    UPDATE ff_bracket_slots SET status = 'advanced' WHERE group_id = v_gid AND status = 'active';
    UPDATE ff_bracket_groups SET status = 'completed' WHERE id = v_gid;
  END IF;

  -- ── Top 16 / Final 8: 1 game per group, bottom 2 eliminated, top 2 advance ───
  IF v_rnum IN (2, 3) THEN
    FOR v_i IN 1..2 LOOP
      SELECT sc.user_id, sc.player_seed INTO v_loser_uid, v_loser_seed
      FROM   ff_bracket_scores sc
      JOIN   ff_bracket_slots  sl ON sl.group_id = v_gid AND sl.seed = sc.player_seed AND sl.status = 'active'
      WHERE  sc.game_id = p_game_id
      ORDER  BY sc.score ASC, sc.player_seed ASC LIMIT 1;

      SELECT id INTO v_loser_slot
      FROM   ff_bracket_slots
      WHERE  group_id = v_gid AND seed = v_loser_seed AND status = 'active'
      ORDER  BY id LIMIT 1;

      UPDATE ff_bracket_slots SET status = 'eliminated', eliminated_game = 1
      WHERE  id = v_loser_slot;
    END LOOP;

    UPDATE ff_bracket_scores SET is_eliminated = true
    WHERE  game_id = p_game_id
      AND  player_seed IN (
             SELECT seed FROM ff_bracket_slots
             WHERE group_id = v_gid AND eliminated_game = 1
           );

    UPDATE ff_bracket_slots SET status = 'advanced' WHERE group_id = v_gid AND status = 'active';
    UPDATE ff_bracket_groups SET status = 'completed' WHERE id = v_gid;
  END IF;

  -- ── Check if the whole round is now complete ──────────────────────────────────
  SELECT COUNT(*) INTO v_left FROM ff_bracket_groups
  WHERE round_id = v_rid AND status <> 'completed';
  IF v_left > 0 THEN
    RETURN json_build_object('ok', true, 'groups_left', v_left);
  END IF;

  -- ── Seed the next round ───────────────────────────────────────────────────────
  UPDATE ff_bracket_rounds SET status = 'completed' WHERE id = v_rid;

  SELECT id INTO v_next_rid FROM ff_bracket_rounds
  WHERE tournament_id = v_tid AND round_number = v_rnum + 1;

  WITH adv AS (
    SELECT s.user_id, s.username,
           ROW_NUMBER() OVER (ORDER BY random()) AS rn
    FROM   ff_bracket_slots  s
    JOIN   ff_bracket_groups g ON g.id = s.group_id
    WHERE  g.round_id = v_rid AND s.status = 'advanced'
  )
  SELECT array_agg(user_id ORDER BY rn), array_agg(username ORDER BY rn)
  INTO   v_users, v_names FROM adv;

  v_n := array_length(v_users, 1) / 4;

  FOR v_g IN 1..v_n LOOP
    INSERT INTO ff_bracket_groups (round_id, tournament_id, group_number, status)
    VALUES (v_next_rid, v_tid, v_g, 'game1')
    RETURNING id INTO v_new_gid;

    FOR v_i IN 1..4 LOOP
      INSERT INTO ff_bracket_slots (group_id, tournament_id, user_id, username, seed)
      VALUES (v_new_gid, v_tid, v_users[(v_g-1)*4+v_i], v_names[(v_g-1)*4+v_i], v_i);
    END LOOP;

    INSERT INTO ff_bracket_games (group_id, tournament_id, game_number, status)
    VALUES (v_new_gid, v_tid, 1, 'pending');
  END LOOP;

  UPDATE ff_bracket_rounds SET status = 'in_progress' WHERE id = v_next_rid;
  RETURN json_build_object('ok', true, 'round_complete', true, 'next_round', v_rnum + 1);
END; $$;


--
-- Name: rpc_get_my_titles(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_get_my_titles() RETURNS json
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT COALESCE(to_json(public.user_earned_title_keys(auth.uid())), '[]'::json);
$$;


--
-- Name: rpc_get_public_profile(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_get_public_profile(p_user_id uuid) RETURNS json
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
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


--
-- Name: rpc_get_score_proof_url(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_get_score_proof_url(p_score_id uuid) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_path   text;
  v_exists boolean;
BEGIN
  SELECT proof_storage_path INTO v_path
    FROM scores
   WHERE id = p_score_id
     AND (user_id = auth.uid() OR public.is_admin());

  IF v_path IS NULL THEN
    -- Distinguish "not found" from "found but unauthorized" only for logging;
    -- the return value is NULL either way so we don't leak existence info.
    SELECT EXISTS (SELECT 1 FROM scores WHERE id = p_score_id) INTO v_exists;
    IF v_exists THEN
      INSERT INTO security_events (event_type, severity, user_id, details)
      VALUES ('score_proof_access_denied', 'warn', auth.uid(),
        jsonb_build_object('score_id', p_score_id))
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;

  RETURN v_path;  -- NULL if not found or caller is not authorized
END; $$;


--
-- Name: rpc_karaoke_add(text, text, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_karaoke_add(p_video_id text, p_title text, p_channel text DEFAULT ''::text, p_thumbnail_url text DEFAULT NULL::text, p_requester_name text DEFAULT 'Guest'::text) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_queued  int;
  v_name    text := trim(p_requester_name);
BEGIN

  -- ── Input validation ──────────────────────────────────────────
  IF p_video_id IS NULL OR trim(p_video_id) = '' THEN
    RETURN json_build_object('error', 'invalid',
      'message', 'Invalid video ID.');
  END IF;

  IF v_name = '' THEN
    RETURN json_build_object('error', 'invalid',
      'message', 'Enter your name so people know who requested it.');
  END IF;

  IF length(p_title) > 300 THEN
    RETURN json_build_object('error', 'invalid',
      'message', 'Song title is too long.');
  END IF;

  -- ── Duplicate check ──────────────────────────────────────────
  IF EXISTS (
    SELECT 1 FROM karaoke_queue
     WHERE video_id = p_video_id
       AND status IN ('queued', 'playing')
  ) THEN
    RETURN json_build_object('error', 'duplicate',
      'message', 'That song is already in the queue.');
  END IF;

  -- ── Authenticated user path ───────────────────────────────────
  IF v_user_id IS NOT NULL THEN

    -- Rate limit: max 3 requests per 10 minutes
    BEGIN
      PERFORM public.check_and_log_rate_limit('karaoke_request', 600, 3);
    EXCEPTION WHEN OTHERS THEN
      RETURN json_build_object('error', 'rate_limited',
        'message', 'You''re adding songs too fast. Wait a few minutes before requesting again.');
    END;

    -- Queue cap: no more than 3 of your songs waiting at once
    SELECT COUNT(*) INTO v_queued
      FROM karaoke_queue
     WHERE requested_by = v_user_id
       AND status = 'queued';

    IF v_queued >= 3 THEN
      RETURN json_build_object('error', 'queue_cap',
        'message', 'You already have 3 songs in the queue. Wait for one to play before adding more.');
    END IF;

    INSERT INTO karaoke_queue
      (video_id, title, channel, thumbnail_url, requested_by, requester_name)
    VALUES
      (p_video_id, p_title, coalesce(p_channel, ''), p_thumbnail_url, v_user_id, v_name);

  -- ── Anonymous (guest) path ────────────────────────────────────
  ELSE

    -- Global cap on concurrent anonymous requests
    SELECT COUNT(*) INTO v_queued
      FROM karaoke_queue
     WHERE requested_by IS NULL
       AND status = 'queued';

    IF v_queued >= 5 THEN
      RETURN json_build_object('error', 'queue_cap',
        'message', 'The guest request limit is full. Sign in to add more songs.');
    END IF;

    INSERT INTO karaoke_queue
      (video_id, title, channel, thumbnail_url, requested_by, requester_name)
    VALUES
      (p_video_id, p_title, coalesce(p_channel, ''), p_thumbnail_url, NULL, v_name);

  END IF;

  RETURN json_build_object('ok', true);
END;
$$;


--
-- Name: rpc_karaoke_clear_history(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_karaoke_clear_history() RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  PERFORM public.require_mfa();

  IF NOT public.is_admin() THEN
    INSERT INTO security_events (event_type, severity, user_id, details)
    VALUES ('admin_access_denied', 'warn', auth.uid(),
      jsonb_build_object('rpc', 'rpc_karaoke_clear_history'))
    ON CONFLICT DO NOTHING;
    RETURN json_build_object('error', 'unauthorized');
  END IF;

  DELETE FROM karaoke_queue WHERE status IN ('played', 'skipped');

  INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'karaoke_clear_history', 'karaoke_queue', NULL, '{}');

  RETURN json_build_object('ok', true);
END;
$$;


--
-- Name: rpc_karaoke_next(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_karaoke_next(p_current_id uuid DEFAULT NULL::uuid) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_next record;
BEGIN
  -- Mark the current song as played
  IF p_current_id IS NOT NULL THEN
    UPDATE karaoke_queue
       SET status = 'played'
     WHERE id = p_current_id
       AND status IN ('playing', 'queued');
  END IF;

  -- Return any song already marked playing (idempotent restart safety)
  SELECT id, video_id, title, channel, thumbnail_url, requester_name
    INTO v_next
    FROM karaoke_queue
   WHERE status = 'playing'
   LIMIT 1;

  IF NOT FOUND THEN
    -- Pick the next queued song (FIFO)
    SELECT id, video_id, title, channel, thumbnail_url, requester_name
      INTO v_next
      FROM karaoke_queue
     WHERE status = 'queued'
     ORDER BY created_at ASC
     LIMIT 1;

    IF NOT FOUND THEN
      RETURN json_build_object('ok', true, 'empty', true);
    END IF;

    UPDATE karaoke_queue SET status = 'playing' WHERE id = v_next.id;
  END IF;

  RETURN json_build_object(
    'ok',            true,
    'empty',         false,
    'id',            v_next.id,
    'video_id',      v_next.video_id,
    'title',         v_next.title,
    'channel',       v_next.channel,
    'thumbnail_url', v_next.thumbnail_url,
    'requester_name', v_next.requester_name
  );
END;
$$;


--
-- Name: rpc_karaoke_remove(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_karaoke_remove(p_song_id uuid) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  PERFORM public.require_mfa();

  IF NOT public.is_admin() THEN
    INSERT INTO security_events (event_type, severity, user_id, details)
    VALUES ('admin_access_denied', 'warn', auth.uid(),
      jsonb_build_object('rpc', 'rpc_karaoke_remove', 'song_id', p_song_id))
    ON CONFLICT DO NOTHING;
    RETURN json_build_object('error', 'unauthorized');
  END IF;

  DELETE FROM karaoke_queue WHERE id = p_song_id;

  INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'karaoke_remove', 'karaoke_queue', p_song_id::text, '{}');

  RETURN json_build_object('ok', true);
END;
$$;


--
-- Name: rpc_karaoke_skip(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_karaoke_skip(p_song_id uuid) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  PERFORM public.require_mfa();

  IF NOT public.is_admin() THEN
    INSERT INTO security_events (event_type, severity, user_id, details)
    VALUES ('admin_access_denied', 'warn', auth.uid(),
      jsonb_build_object('rpc', 'rpc_karaoke_skip', 'song_id', p_song_id))
    ON CONFLICT DO NOTHING;
    RETURN json_build_object('error', 'unauthorized');
  END IF;

  UPDATE karaoke_queue SET status = 'skipped' WHERE id = p_song_id;
  IF NOT FOUND THEN
    RETURN json_build_object('error', 'not_found');
  END IF;

  INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'karaoke_skip', 'karaoke_queue', p_song_id::text, '{}');

  RETURN json_build_object('ok', true);
END;
$$;


--
-- Name: rpc_make_pick(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_make_pick(p_team_id uuid) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: rpc_most_played_game(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_most_played_game() RETURNS json
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT json_build_object('id', g.id, 'name', g.name, 'type', g.type)
    FROM scores s
    JOIN games g ON g.id = s.game_id
   WHERE s.status = 'approved'
   GROUP BY g.id, g.name, g.type
   ORDER BY count(*) DESC, max(s.created_at) DESC
   LIMIT 1;
$$;


--
-- Name: rpc_my_skeeball_night(date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_my_skeeball_night(p_week_of date DEFAULT NULL::date) RETURNS json
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_week   date;
  v_result json;
BEGIN
  IF v_uid IS NULL THEN RETURN json_build_object('error','not_authenticated'); END IF;

  -- target night: explicit week, else the player's most recent played week
  SELECT COALESCE(p_week_of, max(s.week_of)) INTO v_week
    FROM skeeball_sessions s
    JOIN skeeball_ball_scores bs ON bs.session_id = s.id
   WHERE bs.player_user_id = v_uid
     AND (p_week_of IS NULL OR s.week_of = p_week_of);

  IF v_week IS NULL THEN
    RETURN json_build_object('has_data', false);
  END IF;

  WITH my_balls AS (
    SELECT bs.score, s.id AS session_id, s.team_id, s.placement
      FROM skeeball_sessions s
      JOIN skeeball_ball_scores bs ON bs.session_id = s.id
     WHERE bs.player_user_id = v_uid AND s.week_of = v_week
  ),
  per_game AS (
    SELECT session_id, sum(score) AS game_total FROM my_balls GROUP BY session_id
  ),
  ring_counts AS (
    SELECT score, count(*) AS n FROM my_balls GROUP BY score
  ),
  -- everyone's nightly total, to rank the caller
  night_totals AS (
    SELECT bs.player_user_id, sum(bs.score) AS total
      FROM skeeball_sessions s
      JOIN skeeball_ball_scores bs ON bs.session_id = s.id
     WHERE s.week_of = v_week
     GROUP BY bs.player_user_id
  ),
  -- career best single game strictly BEFORE this week (for PB detection)
  prior_best AS (
    SELECT COALESCE(max(g.t), 0) AS best
      FROM (
        SELECT sum(bs.score) AS t
          FROM skeeball_sessions s
          JOIN skeeball_ball_scores bs ON bs.session_id = s.id
         WHERE bs.player_user_id = v_uid AND s.week_of < v_week
         GROUP BY s.id
      ) g
  ),
  -- weeks-in-a-row streak ending at v_week (weekly islands trick)
  played_weeks AS (
    SELECT DISTINCT s.week_of,
           s.week_of - (((row_number() OVER (ORDER BY s.week_of DESC)) - 1) * 7)::int AS grp
      FROM skeeball_sessions s
      JOIN skeeball_ball_scores bs ON bs.session_id = s.id
     WHERE bs.player_user_id = v_uid AND s.week_of <= v_week
  )
  SELECT json_build_object(
    'has_data',    true,
    'week_of',     v_week,
    'total_pts',   (SELECT COALESCE(sum(score),0) FROM my_balls),
    'balls',       (SELECT count(*) FROM my_balls),
    'games',       (SELECT count(*) FROM per_game),
    'best_game',   (SELECT COALESCE(max(game_total),0) FROM per_game),
    'best_ring',   (SELECT score FROM ring_counts ORDER BY n DESC, score DESC LIMIT 1),
    'ring_counts', (SELECT COALESCE(json_object_agg(score, n), '{}'::json) FROM ring_counts),
    'team_name',   (SELECT t.name FROM teams t WHERE t.id = (SELECT team_id FROM my_balls LIMIT 1)),
    'team_placement', (SELECT min(placement) FROM my_balls WHERE placement IS NOT NULL),
    'rank',        (SELECT 1 + count(*) FROM night_totals WHERE total > (SELECT total FROM night_totals WHERE player_user_id = v_uid)),
    'players',     (SELECT count(*) FROM night_totals),
    'is_pb',       (SELECT (SELECT COALESCE(max(game_total),0) FROM per_game) > (SELECT best FROM prior_best)),
    'streak',      (SELECT count(*) FROM played_weeks WHERE grp = (SELECT grp FROM played_weeks ORDER BY week_of DESC LIMIT 1))
  ) INTO v_result;

  RETURN v_result;
END; $$;


--
-- Name: rpc_my_team_rsvps(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_my_team_rsvps() RETURNS json
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: rpc_owner_metrics(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_owner_metrics() RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_ok boolean;
BEGIN
  SELECT (is_admin OR role IN ('owner','architect','admin')) INTO v_ok
    FROM profiles WHERE id = auth.uid();
  IF NOT COALESCE(v_ok, false) THEN
    RETURN json_build_object('error', 'unauthorized');
  END IF;

  RETURN json_build_object(
    -- Weekly signup cohorts (8w): how many came back and did anything
    'retention', (
      SELECT COALESCE(json_agg(row_to_json(r) ORDER BY r.week), '[]'::json) FROM (
        SELECT date_trunc('week', p.created_at)::date AS week,
               count(*) AS signups,
               count(*) FILTER (WHERE EXISTS (
                 SELECT 1 FROM check_ins c WHERE c.user_id = p.id
                   AND c.created_at BETWEEN p.created_at + interval '1 day' AND p.created_at + interval '7 days')
                 OR EXISTS (
                 SELECT 1 FROM scores s WHERE s.user_id = p.id
                   AND s.created_at BETWEEN p.created_at + interval '1 day' AND p.created_at + interval '7 days')
               ) AS active_w1
        FROM profiles p
        WHERE p.created_at > now() - interval '8 weeks'
        GROUP BY 1
      ) r
    ),
    -- League-night attendance (8w): distinct players in completed sessions
    'attendance', (
      SELECT COALESCE(json_agg(row_to_json(a) ORDER BY a.week_of), '[]'::json) FROM (
        SELECT ss.week_of, count(DISTINCT sp.player_user_id) AS players,
               count(DISTINCT ss.team_id) AS teams, count(*) AS games
        FROM skeeball_sessions ss
        JOIN skeeball_session_players sp ON sp.session_id = ss.id
        WHERE ss.status = 'completed' AND ss.week_of > current_date - 56
        GROUP BY ss.week_of
      ) a
    ),
    -- Revenue (8w): Square completed payments + paid team registrations
    'revenue', json_build_object(
      'weekly', (
        SELECT COALESCE(json_agg(row_to_json(v) ORDER BY v.week), '[]'::json) FROM (
          SELECT date_trunc('week', updated_at)::date AS week,
                 count(*) AS payments,
                 COALESCE(SUM((raw_event#>>'{data,object,payment,amount_money,amount}')::bigint), 0) AS cents
          FROM square_payment_statuses
          WHERE status = 'COMPLETED' AND updated_at > now() - interval '8 weeks'
          GROUP BY 1
        ) v
      ),
      'registrations_paid', (SELECT count(*) FROM team_registrations WHERE status = 'paid')
    ),
    -- Feature adoption (30d): distinct users per feature vs total actives
    'adoption', (
      WITH actives AS (
        SELECT DISTINCT user_id AS uid FROM scores WHERE created_at > now() - interval '30 days'
        UNION SELECT DISTINCT user_id FROM check_ins WHERE created_at > now() - interval '30 days'
        UNION SELECT DISTINCT user_id FROM posts WHERE created_at > now() - interval '30 days'
      )
      SELECT json_build_object(
        'actives',  (SELECT count(*) FROM actives),
        'karaoke',  (SELECT count(DISTINCT requested_by) FROM karaoke_queue WHERE created_at > now() - interval '30 days' AND requested_by IS NOT NULL),
        'pickem',   (SELECT count(DISTINCT user_id) FROM pickem_picks WHERE created_at > now() - interval '30 days'),
        'fantasy',  (SELECT count(DISTINCT user_id) FROM fantasy_predictions WHERE created_at > now() - interval '30 days'),
        'forums',   (SELECT count(DISTINCT user_id) FROM forum_posts WHERE created_at > now() - interval '30 days'),
        'posts',    (SELECT count(DISTINCT user_id) FROM posts WHERE created_at > now() - interval '30 days'),
        'dms',      (SELECT count(DISTINCT sender_id) FROM messages WHERE created_at > now() - interval '30 days')
      )
    ),
    -- Signup funnel
    'funnel', json_build_object(
      'signups',      (SELECT count(*) FROM profiles),
      'with_avatar',  (SELECT count(*) FROM profiles WHERE avatar_url IS NOT NULL),
      'on_team',      (SELECT count(DISTINCT user_id) FROM team_members),
      'played_game',  (SELECT count(DISTINCT player_user_id) FROM skeeball_session_players sp
                         JOIN skeeball_sessions ss ON ss.id = sp.session_id AND ss.status = 'completed')
    ),
    -- Activity heat (30d): by day-of-week and by hour
    'heat', json_build_object(
      'by_dow', (
        SELECT COALESCE(json_agg(row_to_json(d) ORDER BY d.dow), '[]'::json) FROM (
          SELECT EXTRACT(dow FROM created_at)::int AS dow, count(*) AS n
          FROM (SELECT created_at FROM scores WHERE created_at > now() - interval '30 days'
                UNION ALL SELECT created_at FROM check_ins WHERE created_at > now() - interval '30 days') t
          GROUP BY 1
        ) d
      ),
      'by_hour', (
        SELECT COALESCE(json_agg(row_to_json(h) ORDER BY h.hour), '[]'::json) FROM (
          SELECT EXTRACT(hour FROM created_at)::int AS hour, count(*) AS n
          FROM (SELECT created_at FROM scores WHERE created_at > now() - interval '30 days'
                UNION ALL SELECT created_at FROM check_ins WHERE created_at > now() - interval '30 days') t
          GROUP BY 1
        ) h
      )
    )
  );
END; $$;


--
-- Name: rpc_pickem_leaderboard(date, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_pickem_leaderboard(p_start date DEFAULT NULL::date, p_end date DEFAULT NULL::date) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: rpc_public_score_card(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_public_score_card(p_score_id uuid) RETURNS json
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_s record;
  v_rank int;
BEGIN
  SELECT s.id, s.score, s.created_at, s.game_id, s.user_id,
         g.name AS game_name, g.type AS game_type,
         p.username, p.avatar_url
    INTO v_s
    FROM scores s
    JOIN games g ON g.id = s.game_id
    LEFT JOIN profiles p ON p.id = s.user_id
   WHERE s.id = p_score_id AND s.status = 'approved';
  IF NOT FOUND THEN
    RETURN json_build_object('error', 'not_found');
  END IF;

  SELECT count(*) + 1 INTO v_rank
    FROM scores
   WHERE game_id = v_s.game_id AND status = 'approved' AND score > v_s.score;

  RETURN json_build_object(
    'username',   COALESCE(v_s.username, 'Player'),
    'avatar_url', v_s.avatar_url,
    'game_name',  v_s.game_name,
    'game_type',  v_s.game_type,
    'score',      v_s.score,
    'rank',       v_rank,
    'created_at', v_s.created_at
  );
END;
$$;


--
-- Name: rpc_public_standings(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_public_standings() RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: rpc_raise_score_dispute(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_raise_score_dispute(p_session_id uuid, p_reason text) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: rpc_report_content(text, uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_report_content(p_content_type text, p_content_id uuid, p_reason text, p_details text DEFAULT NULL::text) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
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


--
-- Name: rpc_request_sub(uuid, date, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_request_sub(p_team_id uuid, p_week_of date, p_note text DEFAULT NULL::text) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: rpc_resolve_support_ticket(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_resolve_support_ticket(p_ticket_id uuid) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_uid uuid;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN json_build_object('error', 'not_authenticated');
  END IF;

  -- Owner of ticket or staff can resolve
  IF NOT (
    EXISTS (SELECT 1 FROM support_tickets WHERE id = p_ticket_id AND user_id = v_uid)
    OR public.is_admin()
    OR EXISTS (SELECT 1 FROM profiles WHERE id = v_uid AND role IN ('owner', 'architect'))
  ) THEN
    RETURN json_build_object('error', 'unauthorized');
  END IF;

  UPDATE support_tickets
     SET status = 'resolved',
         resolved_at = now(),
         resolved_by = v_uid
   WHERE id = p_ticket_id;

  RETURN json_build_object('ok', true);
END;
$$;


--
-- Name: rpc_send_support_message(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_send_support_message(p_content text) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_user_id   uuid;
  v_ticket_id uuid;
  v_msg_id    uuid;
  v_admin_online boolean;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN json_build_object('error', 'not_authenticated');
  END IF;

  IF length(trim(p_content)) < 1 THEN
    RETURN json_build_object('error', 'empty_message');
  END IF;

  IF length(p_content) > 4000 THEN
    RETURN json_build_object('error', 'message_too_long');
  END IF;

  -- Get or create an open ticket for this user
  SELECT id INTO v_ticket_id
    FROM support_tickets
   WHERE user_id = v_user_id
     AND status = 'open'
   ORDER BY created_at DESC
   LIMIT 1;

  IF NOT FOUND THEN
    INSERT INTO support_tickets (user_id)
    VALUES (v_user_id)
    RETURNING id INTO v_ticket_id;
  END IF;

  -- Insert the message
  INSERT INTO support_messages (ticket_id, sender_id, content, is_admin_msg)
  VALUES (v_ticket_id, v_user_id, trim(p_content), false)
  RETURNING id INTO v_msg_id;

  -- Check if any staff is online
  SELECT EXISTS (
    SELECT 1 FROM profiles
     WHERE online_status = 'online'
       AND (
         is_admin = true
         OR role IN ('owner', 'architect')
       )
  ) INTO v_admin_online;

  RETURN json_build_object(
    'ok',           true,
    'ticket_id',    v_ticket_id,
    'message_id',   v_msg_id,
    'admin_online', v_admin_online
  );
END;
$$;


--
-- Name: rpc_set_league_rsvp(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_set_league_rsvp(p_status text) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: rpc_skeeball_cancel_session(uuid, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_skeeball_cancel_session(p_session_id uuid, p_force boolean DEFAULT false) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_session record;
BEGIN
  IF v_uid IS NULL THEN
    RETURN json_build_object('error', 'not_authenticated');
  END IF;

  SELECT * INTO v_session
    FROM skeeball_sessions
   WHERE id = p_session_id AND status = 'active';
  IF NOT FOUND THEN
    RETURN json_build_object('error', 'not_found',
      'message', 'No active check-in found — it may already be finished.');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM team_members
     WHERE team_id = v_session.team_id AND user_id = v_uid
  ) THEN
    RETURN json_build_object('error', 'not_team_member',
      'message', 'Only members of this team can check it out of a lane.');
  END IF;

  -- Without force: refuse if balls were already recorded (DB). With force:
  -- the player has confirmed they want to discard the game and free the lane.
  IF NOT p_force AND EXISTS (SELECT 1 FROM skeeball_ball_scores WHERE session_id = p_session_id) THEN
    RETURN json_build_object('error', 'has_scores',
      'message', 'Balls have already been recorded for this game. Finish the game, or ask an admin to clear the lane.');
  END IF;

  UPDATE skeeball_sessions
     SET status = 'abandoned', last_activity_at = now()
   WHERE id = p_session_id;

  RETURN json_build_object('ok', true, 'lane_number', v_session.lane_number);
END;
$$;


--
-- Name: rpc_skeeball_complete_session(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_skeeball_complete_session(p_session_id uuid) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
DECLARE
  v_uid uuid := auth.uid();
  v_session record;
  v_lane record;
  v_game_id uuid;
  v_ball_count int;
  v_finalize json;
BEGIN
  IF v_uid IS NULL THEN
    RETURN json_build_object('error', 'not_authenticated');
  END IF;

  SELECT s.* INTO v_session
    FROM public.skeeball_sessions s
   WHERE s.id = p_session_id;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'not_found');
  END IF;

  IF v_session.status <> 'active' THEN
    RETURN json_build_object('ok', true, 'already_completed', true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.team_members
     WHERE team_id = v_session.team_id AND user_id = v_uid
  ) THEN
    RETURN json_build_object('error', 'unauthorized', 'message', 'Only a team member can finalize this game.');
  END IF;

  SELECT COUNT(*) INTO v_ball_count
    FROM public.skeeball_ball_scores
   WHERE session_id = p_session_id;

  IF v_ball_count <> 9 THEN
    RETURN json_build_object('error', 'incomplete', 'message', 'Enter all 9 balls before finalizing.');
  END IF;

  SELECT l.id AS lane_id, l.venue_id INTO v_lane
    FROM public.lanes l
    JOIN public.games g ON g.id = l.game_id
   WHERE g.type = 'skeeball'
     AND l.lane_number = v_session.lane_number
   LIMIT 1;

  SELECT id INTO v_game_id FROM public.games WHERE type = 'skeeball' LIMIT 1;

  UPDATE public.skeeball_sessions
     SET status = 'completed',
         completed_at = now(),
         last_activity_at = now()
   WHERE id = p_session_id
     AND status = 'active';

  IF v_game_id IS NOT NULL THEN
    INSERT INTO public.scores (user_id, game_id, lane_id, venue_id, score, frame_data, status)
    SELECT
      sp.player_user_id,
      v_game_id,
      v_lane.lane_id,
      v_lane.venue_id,
      COALESCE(SUM(bs.score), 0)::int,
      jsonb_build_object('source', 'skeeball_league_qr', 'session_id', p_session_id),
      'pending'
    FROM public.skeeball_session_players sp
    LEFT JOIN public.skeeball_ball_scores bs
      ON bs.session_id = sp.session_id
     AND bs.player_user_id = sp.player_user_id
    WHERE sp.session_id = p_session_id
    GROUP BY sp.player_user_id;
  END IF;

  IF v_session.league_match_id IS NOT NULL THEN
    BEGIN
      EXECUTE 'SELECT public.rpc_skeeball_finalize_match($1)' INTO v_finalize USING v_session.league_match_id;
    EXCEPTION WHEN undefined_function THEN
      v_finalize := json_build_object('ok', false, 'skipped', 'finalize_function_missing');
    END;
  END IF;

  SELECT placement, league_points INTO v_session
    FROM public.skeeball_sessions
   WHERE id = p_session_id;

  RETURN json_build_object(
    'ok', true,
    'placement', v_session.placement,
    'league_points', v_session.league_points,
    'finalize', COALESCE(v_finalize, '{}'::json)
  );
END;
$_$;


--
-- Name: rpc_skeeball_finalize_match(uuid, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_skeeball_finalize_match(p_match_id uuid, p_force boolean DEFAULT false) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_expected int;
  v_total int;
  v_completed int;
  v_rec record;
  v_week date;
  v_mode text;
BEGIN
  SELECT COALESCE(expected_teams, 4), week_of, scoring_mode
    INTO v_expected, v_week, v_mode
    FROM skeeball_league_matches WHERE id = p_match_id;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'message', 'Match not found');
  END IF;

  -- Resolve NULL=auto: week 7 of its season is Hundo Week.
  IF v_mode IS NULL THEN
    v_mode := CASE WHEN public.skeeball_season_week_number(v_week) = 7 THEN 'hundos' ELSE 'total' END;
  END IF;

  SELECT COUNT(*) INTO v_total
    FROM skeeball_sessions
   WHERE league_match_id = p_match_id AND status != 'abandoned';

  SELECT COUNT(*) INTO v_completed
    FROM skeeball_sessions
   WHERE league_match_id = p_match_id AND status = 'completed';

  IF p_force THEN
    IF v_completed < 2 THEN
      RETURN json_build_object('ok', false, 'message', 'Need at least 2 completed sessions to finalize.');
    END IF;
  ELSE
    IF v_total < v_expected OR v_completed < v_total THEN
      RETURN json_build_object('ok', false, 'message',
        'Round not complete yet (' || v_completed || '/' || GREATEST(v_total, v_expected) || ' teams finished)');
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM skeeball_sessions
     WHERE league_match_id = p_match_id AND placement IS NOT NULL LIMIT 1
  ) THEN
    RETURN json_build_object('ok', true, 'message', 'Already finalized');
  END IF;

  -- Rank completed sessions. Hundo week: most 100s first (tie → total).
  -- Normal: total score (admin adjustments included). Points scale with
  -- round size: 1st = N … 1. Ties share the better placement + points.
  FOR v_rec IN
    SELECT ranked.id, ranked.rnk
    FROM (
      SELECT ss.id,
             RANK() OVER (
               ORDER BY
                 (CASE WHEN v_mode = 'hundos'
                       THEN COUNT(*) FILTER (WHERE bs.score = 100)
                       ELSE 0 END) DESC,
                 (COALESCE(SUM(bs.score), 0) + ss.score_adjustment) DESC
             ) AS rnk
        FROM skeeball_sessions ss
        LEFT JOIN skeeball_ball_scores bs ON bs.session_id = ss.id
       WHERE ss.league_match_id = p_match_id AND ss.status = 'completed'
       GROUP BY ss.id, ss.score_adjustment
    ) ranked
  LOOP
    UPDATE skeeball_sessions
       SET placement = v_rec.rnk,
           league_points = GREATEST(v_completed - v_rec.rnk + 1, 1)
     WHERE id = v_rec.id;
  END LOOP;

  IF p_force THEN
    UPDATE skeeball_sessions
       SET status = 'abandoned', last_activity_at = now()
     WHERE league_match_id = p_match_id AND status = 'active';
  END IF;

  UPDATE skeeball_league_matches SET status = 'completed' WHERE id = p_match_id;

  RETURN json_build_object('ok', true, 'teams_ranked', v_completed, 'scoring_mode', v_mode);
END;
$$;


--
-- Name: rpc_skeeball_get_or_create_match(date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_skeeball_get_or_create_match(p_week_of date) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE v_id uuid;
BEGIN
  SELECT lm.id INTO v_id
  FROM skeeball_league_matches lm
  WHERE lm.week_of = p_week_of AND lm.status = 'in_progress'
    AND (SELECT COUNT(*) FROM skeeball_sessions ss WHERE ss.league_match_id = lm.id AND ss.status != 'abandoned') < 4
  ORDER BY lm.created_at DESC LIMIT 1;
  IF v_id IS NULL THEN
    INSERT INTO skeeball_league_matches (week_of) VALUES (p_week_of) RETURNING id INTO v_id;
  END IF;
  RETURN json_build_object('match_id', v_id);
END;$$;


--
-- Name: rpc_skeeball_hall_of_fame(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_skeeball_hall_of_fame() RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: rpc_skeeball_head_to_head(uuid, uuid, date, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_skeeball_head_to_head(p_team_id uuid, p_opponent_id uuid, p_start date DEFAULT NULL::date, p_end date DEFAULT NULL::date) RETURNS json
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_result json;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN json_build_object('error', 'not_authenticated');
  END IF;

  WITH mine AS (
    SELECT ss.league_match_id, ss.week_of, ss.placement,
           (SELECT COALESCE(SUM(score), 0)::int FROM skeeball_ball_scores b WHERE b.session_id = ss.id)
             + ss.score_adjustment AS score
      FROM skeeball_sessions ss
     WHERE ss.team_id = p_team_id AND ss.status = 'completed' AND ss.league_match_id IS NOT NULL
       AND (p_start IS NULL OR ss.week_of >= p_start)
       AND (p_end IS NULL OR ss.week_of <= p_end)
  ),
  theirs AS (
    SELECT ss.league_match_id, ss.placement,
           (SELECT COALESCE(SUM(score), 0)::int FROM skeeball_ball_scores b WHERE b.session_id = ss.id)
             + ss.score_adjustment AS score
      FROM skeeball_sessions ss
     WHERE ss.team_id = p_opponent_id AND ss.status = 'completed' AND ss.league_match_id IS NOT NULL
  ),
  shared AS (
    SELECT m.week_of, m.placement AS my_place, t.placement AS their_place,
           m.score AS my_score, t.score AS their_score
      FROM mine m
      JOIN theirs t ON t.league_match_id = m.league_match_id
     WHERE m.placement IS NOT NULL AND t.placement IS NOT NULL
  )
  SELECT json_build_object(
           'meetings', COUNT(*)::int,
           'wins', COUNT(*) FILTER (WHERE my_place < their_place)::int,
           'losses', COUNT(*) FILTER (WHERE my_place > their_place)::int,
           'avg_margin', COALESCE(ROUND(AVG(my_score - their_score))::int, 0),
           'last_week', MAX(week_of)
         )
    INTO v_result
    FROM shared;

  RETURN (jsonb_build_object('ok', true) || v_result::jsonb)::json;
END;
$$;


--
-- Name: rpc_skeeball_player_insights(uuid, date, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_skeeball_player_insights(p_user_id uuid, p_start date DEFAULT NULL::date, p_end date DEFAULT NULL::date) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_lanes json;
  v_clutch json;
  v_consistency json;
  v_hundos json;
  v_records json;
  v_percentile int;
  v_badges json;
  v_games int;
BEGIN
  -- player game totals (any team)
  DROP TABLE IF EXISTS _pi_games;
  CREATE TEMP TABLE _pi_games ON COMMIT DROP AS
  SELECT ss.id AS session_id, ss.week_of, ss.lane_number, ss.created_at,
         SUM(bs.score)::int AS game_score,
         COUNT(*)::int AS balls
    FROM skeeball_sessions ss
    JOIN skeeball_ball_scores bs
      ON bs.session_id = ss.id AND bs.player_user_id = p_user_id
   WHERE ss.status = 'completed'
     AND (p_start IS NULL OR ss.week_of >= p_start)
     AND (p_end IS NULL OR ss.week_of <= p_end)
   GROUP BY ss.id, ss.week_of, ss.lane_number, ss.created_at;

  SELECT COUNT(*)::int INTO v_games FROM _pi_games;
  IF v_games = 0 THEN
    DROP TABLE IF EXISTS _pi_games;
    RETURN json_build_object('ok', true, 'games', 0);
  END IF;

  -- Lane averages
  SELECT json_agg(json_build_object('lane_number', lane_number, 'games', games, 'avg', avg)
                  ORDER BY avg DESC)
    INTO v_lanes
    FROM (
      SELECT lane_number, COUNT(*)::int AS games, ROUND(AVG(game_score))::int AS avg
        FROM _pi_games
       GROUP BY lane_number
    ) l;

  -- Clutch: player's first ball vs final ball of each game
  SELECT json_build_object(
           'first_avg', ROUND(AVG(score) FILTER (WHERE ball_rank = 1))::int,
           'last_avg', ROUND(AVG(score) FILTER (WHERE ball_rank = max_rank))::int
         )
    INTO v_clutch
    FROM (
      SELECT bs.score,
             RANK() OVER (PARTITION BY bs.session_id ORDER BY bs.ball_number) AS ball_rank,
             COUNT(*) OVER (PARTITION BY bs.session_id) AS max_rank
        FROM skeeball_ball_scores bs
        JOIN _pi_games g ON g.session_id = bs.session_id
       WHERE bs.player_user_id = p_user_id
    ) b;

  -- Consistency: stddev of game scores
  SELECT json_build_object(
           'stddev', COALESCE(ROUND(STDDEV_POP(game_score))::int, 0),
           'avg', ROUND(AVG(game_score))::int
         )
    INTO v_consistency
    FROM _pi_games;

  -- Hundos: count, rate, best consecutive streak, most in one game
  SELECT json_build_object(
           'count', COALESCE(SUM(CASE WHEN score = 100 THEN 1 ELSE 0 END), 0)::int,
           'total_balls', COUNT(*)::int,
           'rate_pct', CASE WHEN COUNT(*) > 0
             THEN ROUND(100.0 * SUM(CASE WHEN score = 100 THEN 1 ELSE 0 END) / COUNT(*))::int
             ELSE 0 END,
           'pct_40_plus', CASE WHEN COUNT(*) > 0
             THEN ROUND(100.0 * SUM(CASE WHEN score >= 40 THEN 1 ELSE 0 END) / COUNT(*))::int
             ELSE 0 END,
           'best_streak', COALESCE((
             SELECT MAX(cnt)::int FROM (
               SELECT COUNT(*) AS cnt FROM (
                 SELECT rn - ROW_NUMBER() OVER (ORDER BY rn) AS grp
                   FROM (
                     SELECT ROW_NUMBER() OVER (ORDER BY g2.week_of, g2.created_at, b2.ball_number) AS rn,
                            b2.score
                       FROM skeeball_ball_scores b2
                       JOIN _pi_games g2 ON g2.session_id = b2.session_id
                      WHERE b2.player_user_id = p_user_id
                   ) seq
                  WHERE seq.score = 100
               ) grouped
               GROUP BY grp
             ) streaks
           ), 0),
           'max_in_game', COALESCE((
             SELECT MAX(c)::int FROM (
               SELECT COUNT(*) AS c FROM skeeball_ball_scores b3
                 JOIN _pi_games g3 ON g3.session_id = b3.session_id
                WHERE b3.player_user_id = p_user_id AND b3.score = 100
                GROUP BY b3.session_id
             ) per_game
           ), 0)
         )
    INTO v_hundos
    FROM skeeball_ball_scores bs
    JOIN _pi_games g ON g.session_id = bs.session_id
   WHERE bs.player_user_id = p_user_id;

  -- Records
  SELECT json_build_object(
           'best_game', MAX(game_score)::int,
           'best_week_avg', (
             SELECT MAX(wavg)::int FROM (
               SELECT ROUND(AVG(game_score)) AS wavg FROM _pi_games GROUP BY week_of
             ) w
           ),
           'best_week_of', (
             SELECT week_of FROM _pi_games GROUP BY week_of
              ORDER BY AVG(game_score) DESC, week_of LIMIT 1
           )
         )
    INTO v_records
    FROM _pi_games;

  -- League percentile among players with 3+ games in the window
  SELECT ROUND(100.0 * COUNT(*) FILTER (WHERE pavg <= myavg) / NULLIF(COUNT(*), 0))::int
    INTO v_percentile
    FROM (
      SELECT bs.player_user_id,
             AVG(per_game.game_score) AS pavg
        FROM (
          SELECT b.session_id, b.player_user_id, SUM(b.score) AS game_score
            FROM skeeball_ball_scores b
            JOIN skeeball_sessions s ON s.id = b.session_id
           WHERE s.status = 'completed'
             AND (p_start IS NULL OR s.week_of >= p_start)
             AND (p_end IS NULL OR s.week_of <= p_end)
           GROUP BY b.session_id, b.player_user_id
        ) per_game
        JOIN skeeball_ball_scores bs
          ON bs.session_id = per_game.session_id AND bs.player_user_id = per_game.player_user_id
       GROUP BY bs.player_user_id
      HAVING COUNT(DISTINCT per_game.session_id) >= 3
    ) ranks
    CROSS JOIN (SELECT AVG(game_score) AS myavg FROM _pi_games) me;

  -- Derived badges (no state to maintain)
  SELECT json_agg(badge) INTO v_badges FROM (
    SELECT 'first_hundo' AS badge WHERE (v_hundos->>'count')::int >= 1
    UNION ALL SELECT 'hundo_hat_trick' WHERE (v_hundos->>'max_in_game')::int >= 3
    UNION ALL SELECT 'club_120' WHERE (v_records->>'best_game')::int >= 120
    UNION ALL SELECT 'club_150' WHERE (v_records->>'best_game')::int >= 150
    UNION ALL SELECT 'sharpshooter' WHERE (v_hundos->>'pct_40_plus')::int >= 50
    UNION ALL SELECT 'iron_player' WHERE v_games >= 16
    UNION ALL SELECT 'hot_streak' WHERE (v_hundos->>'best_streak')::int >= 2
  ) b;

  DROP TABLE IF EXISTS _pi_games;

  RETURN json_build_object(
    'ok', true,
    'games', v_games,
    'lanes', COALESCE(v_lanes, '[]'::json),
    'clutch', v_clutch,
    'consistency', v_consistency,
    'hundos', v_hundos,
    'records', v_records,
    'percentile', v_percentile,
    'badges', COALESCE(v_badges, '[]'::json)
  );
END;
$$;


--
-- Name: rpc_skeeball_player_stats(uuid, date, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_skeeball_player_stats(p_user_id uuid, p_start date DEFAULT NULL::date, p_end date DEFAULT NULL::date) RETURNS json
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_weeks json;
  v_totals json;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN json_build_object('error', 'not_authenticated');
  END IF;

  WITH games AS (
    SELECT ss.id AS session_id, ss.week_of,
           SUM(bs.score)::int AS game_score,
           COUNT(*)::int AS balls
      FROM skeeball_sessions ss
      JOIN skeeball_ball_scores bs
        ON bs.session_id = ss.id AND bs.player_user_id = p_user_id
     WHERE ss.status = 'completed'
       AND (p_start IS NULL OR ss.week_of >= p_start)
       AND (p_end IS NULL OR ss.week_of <= p_end)
     GROUP BY ss.id, ss.week_of
  ),
  ball_rows AS (
    SELECT ss.week_of, bs.score AS ring
      FROM skeeball_sessions ss
      JOIN skeeball_ball_scores bs
        ON bs.session_id = ss.id AND bs.player_user_id = p_user_id
     WHERE ss.status = 'completed'
       AND (p_start IS NULL OR ss.week_of >= p_start)
       AND (p_end IS NULL OR ss.week_of <= p_end)
  ),
  week_agg AS (
    SELECT week_of,
           COUNT(*)::int AS games,
           ROUND(AVG(game_score))::int AS avg,
           MAX(game_score)::int AS best,
           MIN(game_score)::int AS worst,
           SUM(balls)::int AS balls
      FROM games
     GROUP BY week_of
  )
  SELECT
    COALESCE((SELECT json_agg(json_build_object(
        'week_of', w.week_of,
        'games', w.games,
        'avg', w.avg,
        'best', w.best,
        'worst', w.worst,
        'balls', w.balls,
        'rings', COALESCE((SELECT json_object_agg(r.ring, r.cnt)
                  FROM (SELECT ring, COUNT(*)::int AS cnt
                          FROM ball_rows br WHERE br.week_of = w.week_of
                         GROUP BY ring) r), '{}'::json)
      ) ORDER BY w.week_of) FROM week_agg w), '[]'::json),
    json_build_object(
      'games', COALESCE((SELECT COUNT(*) FROM games), 0),
      'avg', (SELECT ROUND(AVG(game_score))::int FROM games),
      'best', (SELECT MAX(game_score)::int FROM games),
      'worst', (SELECT MIN(game_score)::int FROM games),
      'balls', COALESCE((SELECT SUM(balls)::int FROM games), 0),
      'rings', COALESCE((SELECT json_object_agg(r.ring, r.cnt)
                FROM (SELECT ring, COUNT(*)::int AS cnt FROM ball_rows GROUP BY ring) r), '{}'::json)
    )
  INTO v_weeks, v_totals;

  RETURN json_build_object('ok', true, 'weeks', v_weeks, 'totals', v_totals);
END;
$$;


--
-- Name: rpc_skeeball_position_stats(uuid, date, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_skeeball_position_stats(p_team_id uuid, p_start date DEFAULT NULL::date, p_end date DEFAULT NULL::date) RETURNS json
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_players json;
BEGIN
  WITH roster AS (
    SELECT tm.user_id FROM team_members tm WHERE tm.team_id = p_team_id
  ),
  member_games AS (
    SELECT ss.id AS session_id, ss.week_of, bs.player_user_id,
           sp.shoot_position,
           SUM(bs.score)::int AS game_score
      FROM skeeball_sessions ss
      JOIN skeeball_ball_scores bs ON bs.session_id = ss.id
      JOIN skeeball_session_players sp
        ON sp.session_id = ss.id AND sp.player_user_id = bs.player_user_id
      JOIN roster r ON r.user_id = bs.player_user_id
     WHERE ss.status = 'completed'
       AND (p_start IS NULL OR ss.week_of >= p_start)
       AND (p_end IS NULL OR ss.week_of <= p_end)
     GROUP BY ss.id, ss.week_of, bs.player_user_id, sp.shoot_position
  ),
  pos_agg AS (
    SELECT player_user_id, shoot_position,
           COUNT(*)::int AS games,
           ROUND(AVG(game_score))::int AS avg,
           MAX(game_score)::int AS best
      FROM member_games
     WHERE shoot_position IS NOT NULL
     GROUP BY player_user_id, shoot_position
  ),
  players AS (
    SELECT player_user_id,
           COUNT(*)::int AS games,
           ROUND(AVG(game_score))::int AS overall_avg
      FROM member_games
     GROUP BY player_user_id
  )
  SELECT json_agg(json_build_object(
      'user_id', pl.player_user_id,
      'username', COALESCE(pr.username, 'Unknown'),
      'games', pl.games,
      'overall_avg', pl.overall_avg,
      'positions', COALESCE((
        SELECT json_object_agg(pa.shoot_position, json_build_object(
                 'games', pa.games, 'avg', pa.avg, 'best', pa.best))
          FROM pos_agg pa WHERE pa.player_user_id = pl.player_user_id
      ), '{}'::json)
    ) ORDER BY pl.overall_avg DESC)
    INTO v_players
    FROM players pl
    LEFT JOIN profiles pr ON pr.id = pl.player_user_id;

  RETURN json_build_object('ok', true, 'players', COALESCE(v_players, '[]'::json));
END;
$$;


--
-- Name: rpc_skeeball_preview_lane_qr(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_skeeball_preview_lane_qr(p_token text) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_lane record;
  v_active record;
BEGIN
  SELECT * INTO v_lane FROM public.skeeball_lane_from_token(p_token) LIMIT 1;

  IF v_lane.token_error IS NOT NULL THEN
    RETURN json_build_object('error', v_lane.token_error, 'message', 'This QR code is not available for Skee-Ball check-in.');
  END IF;

  IF v_lane.lane_status = 'inactive' THEN
    RETURN json_build_object('error', 'lane_inactive', 'message', 'This lane is currently inactive.');
  END IF;

  SELECT s.id, s.team_id, t.name AS team_name INTO v_active
    FROM public.skeeball_sessions s
    LEFT JOIN public.teams t ON t.id = s.team_id
   WHERE s.lane_number = v_lane.lane_number
     AND s.status = 'active'
   LIMIT 1;

  IF FOUND THEN
    RETURN json_build_object(
      'error', 'lane_occupied',
      'message', 'Lane ' || v_lane.lane_number || ' is already checked in.',
      'team_name', v_active.team_name
    );
  END IF;

  RETURN json_build_object(
    'ok', true,
    'lane_id', v_lane.lane_id,
    'lane_number', v_lane.lane_number,
    'game_id', v_lane.game_id,
    'game_name', v_lane.game_name,
    'venue_id', v_lane.venue_id
  );
END;
$$;


--
-- Name: rpc_skeeball_set_lineup_order(uuid, uuid[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_skeeball_set_lineup_order(p_session_id uuid, p_ordered_user_ids uuid[]) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_count int;
  i int;
BEGIN
  IF v_uid IS NULL THEN
    RETURN json_build_object('error', 'not_authenticated');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM skeeball_session_players
     WHERE session_id = p_session_id AND player_user_id = v_uid
  ) THEN
    RETURN json_build_object('error', 'unauthorized', 'message', 'Only session players can set the order.');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM skeeball_sessions WHERE id = p_session_id AND status = 'active'
  ) THEN
    RETURN json_build_object('error', 'invalid', 'message', 'Session is no longer active.');
  END IF;

  SELECT COUNT(*) INTO v_count FROM skeeball_session_players WHERE session_id = p_session_id;
  IF array_length(p_ordered_user_ids, 1) IS DISTINCT FROM v_count THEN
    RETURN json_build_object('error', 'invalid', 'message', 'Order must include every session player exactly once.');
  END IF;

  FOR i IN 1..array_length(p_ordered_user_ids, 1) LOOP
    UPDATE skeeball_session_players
       SET shoot_position = i
     WHERE session_id = p_session_id
       AND player_user_id = p_ordered_user_ids[i];
    IF NOT FOUND THEN
      RETURN json_build_object('error', 'invalid', 'message', 'Order contains a player not in this session.');
    END IF;
  END LOOP;

  RETURN json_build_object('ok', true);
END;
$$;


--
-- Name: rpc_skeeball_standings(date, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_skeeball_standings(p_start date DEFAULT NULL::date, p_end date DEFAULT NULL::date) RETURNS json
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_rows json;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN json_build_object('error', 'not_authenticated');
  END IF;

  WITH sess AS (
    SELECT ss.team_id, ss.placement,
           COALESCE(ss.league_points, 0) + ss.league_points_adjustment AS pts,
           (SELECT COALESCE(SUM(score), 0)::int FROM skeeball_ball_scores b WHERE b.session_id = ss.id)
             + ss.score_adjustment AS game_score
      FROM skeeball_sessions ss
     WHERE ss.status = 'completed'
       AND (p_start IS NULL OR ss.week_of >= p_start)
       AND (p_end IS NULL OR ss.week_of <= p_end)
  )
  SELECT COALESCE(json_agg(row_json ORDER BY total_points DESC, avg_score DESC), '[]'::json)
    INTO v_rows
    FROM (
      SELECT json_build_object(
               'team_id', s.team_id,
               'team_name', COALESCE(t.name, 'Unknown'),
               'matches_played', COUNT(*)::int,
               'gold', COUNT(*) FILTER (WHERE s.placement = 1)::int,
               'silver', COUNT(*) FILTER (WHERE s.placement = 2)::int,
               'bronze', COUNT(*) FILTER (WHERE s.placement = 3)::int,
               'total_points', COALESCE(SUM(s.pts), 0)::int,
               'avg_score', ROUND(AVG(s.game_score))::int,
               'best_score', MAX(s.game_score)::int
             ) AS row_json,
             COALESCE(SUM(s.pts), 0) AS total_points,
             AVG(s.game_score) AS avg_score
        FROM sess s
        JOIN teams t ON t.id = s.team_id
       GROUP BY s.team_id, t.name
    ) ranked;

  RETURN json_build_object('ok', true, 'standings', v_rows);
END;
$$;


--
-- Name: rpc_skeeball_start_qr_session(text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_skeeball_start_qr_session(p_token text, p_team_id uuid) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_lane record;
  v_team record;
  v_existing record;
  v_match_id uuid;
  v_session_id uuid;
  v_week date := public.skeeball_current_week();
  v_active_count int;
BEGIN
  IF v_uid IS NULL THEN
    RETURN json_build_object('error', 'not_authenticated', 'message', 'You must be logged in.');
  END IF;

  SELECT * INTO v_lane FROM public.skeeball_lane_from_token(p_token) LIMIT 1;
  IF v_lane.token_error IS NOT NULL THEN
    RETURN json_build_object('error', v_lane.token_error, 'message', 'This QR code is not available for Skee-Ball check-in.');
  END IF;

  IF v_lane.lane_status = 'inactive' THEN
    RETURN json_build_object('error', 'lane_inactive', 'message', 'This lane is currently inactive.');
  END IF;

  SELECT id, name INTO v_team FROM public.teams WHERE id = p_team_id;
  IF NOT FOUND THEN
    RETURN json_build_object('error', 'team_not_found', 'message', 'Team not found.');
  END IF;

  IF EXISTS (SELECT 1 FROM public.team_bans WHERE team_id = p_team_id AND user_id = v_uid) THEN
    RETURN json_build_object('error', 'banned', 'message', 'You cannot check in for this team.');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.team_members WHERE team_id = p_team_id AND user_id = v_uid) THEN
    RETURN json_build_object('error', 'not_team_member', 'message', 'Only team members can check in.');
  END IF;

  SELECT id, lane_number, league_match_id INTO v_existing
    FROM public.skeeball_sessions
   WHERE team_id = p_team_id AND status = 'active'
   LIMIT 1;

  IF FOUND THEN
    RETURN json_build_object(
      'ok', true,
      'already_active', true,
      'lane_mismatch', (v_existing.lane_number IS DISTINCT FROM v_lane.lane_number),
      'scanned_lane_number', v_lane.lane_number,
      'session_id', v_existing.id,
      'lane_number', v_existing.lane_number,
      'league_match_id', v_existing.league_match_id,
      'team_id', p_team_id,
      'team_name', v_team.name,
      'message', CASE WHEN v_existing.lane_number IS DISTINCT FROM v_lane.lane_number
        THEN v_team.name || ' is already checked in on Lane ' || v_existing.lane_number
             || '. Check out of that lane before switching to Lane ' || v_lane.lane_number || '.'
        ELSE NULL END
    );
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.skeeball_sessions
     WHERE lane_number = v_lane.lane_number AND status = 'active'
  ) THEN
    RETURN json_build_object('error', 'lane_occupied', 'message', 'Lane ' || v_lane.lane_number || ' is already checked in.');
  END IF;

  SELECT m.id INTO v_match_id
    FROM public.skeeball_league_matches m
   WHERE m.week_of = v_week
     AND COALESCE(m.status, 'active') IN ('active', 'open', 'in_progress')
   ORDER BY m.created_at DESC
   LIMIT 1;

  IF FOUND THEN
    SELECT COUNT(*) INTO v_active_count
      FROM public.skeeball_sessions
     WHERE league_match_id = v_match_id AND status = 'active';
  END IF;

  IF v_match_id IS NULL OR COALESCE(v_active_count, 0) >= 4 THEN
    INSERT INTO public.skeeball_league_matches (week_of, status)
    VALUES (v_week, 'active')
    RETURNING id INTO v_match_id;
  END IF;

  INSERT INTO public.skeeball_sessions (
    team_id, lane_number, week_of, created_by, status, last_activity_at, league_match_id
  ) VALUES (
    p_team_id, v_lane.lane_number, v_week, v_uid, 'active', now(), v_match_id
  )
  RETURNING id INTO v_session_id;

  INSERT INTO public.skeeball_session_players (session_id, player_user_id)
  SELECT v_session_id, user_id
  FROM (
    SELECT tm.user_id,
           CASE WHEN tm.user_id = v_uid THEN 0 WHEN tm.role = 'captain' THEN 1 ELSE 2 END AS sort_group
      FROM public.team_members tm
     WHERE tm.team_id = p_team_id
     ORDER BY sort_group, tm.user_id ASC
     LIMIT 3
  ) lineup
  ON CONFLICT DO NOTHING;

  UPDATE public.lanes SET status = 'occupied' WHERE id = v_lane.lane_id;

  RETURN json_build_object(
    'ok', true,
    'session_id', v_session_id,
    'lane_id', v_lane.lane_id,
    'lane_number', v_lane.lane_number,
    'game_id', v_lane.game_id,
    'game_name', v_lane.game_name,
    'venue_id', v_lane.venue_id,
    'league_match_id', v_match_id,
    'team_id', p_team_id,
    'team_name', v_team.name
  );
EXCEPTION WHEN unique_violation THEN
  RETURN json_build_object('error', 'lane_occupied', 'message', 'That lane or team was just checked in. Refresh and try again.');
END;
$$;


--
-- Name: rpc_skeeball_submit_balls(uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_skeeball_submit_balls(p_session_id uuid, p_balls jsonb) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_ball jsonb;
  v_score int;
BEGIN
  -- Must be authenticated
  IF v_uid IS NULL THEN
    RETURN json_build_object('error', 'unauthorized',
      'message', 'Login required.');
  END IF;

  -- Caller must be a player in this session (scorekeeper rule)
  IF NOT EXISTS (
    SELECT 1 FROM skeeball_session_players
    WHERE session_id = p_session_id AND player_user_id = v_uid
  ) THEN
    RETURN json_build_object('error', 'unauthorized',
      'message', 'You are not in this session.');
  END IF;

  -- Session must still be active
  IF NOT EXISTS (
    SELECT 1 FROM skeeball_sessions
    WHERE id = p_session_id AND status = 'active'
  ) THEN
    RETURN json_build_object('error', 'invalid',
      'message', 'Session is no longer active.');
  END IF;

  -- Upsert each ball score
  FOR v_ball IN SELECT * FROM jsonb_array_elements(p_balls)
  LOOP
    v_score := (v_ball->>'score')::int;

    -- Only valid skee-ball ring values allowed
    IF v_score NOT IN (10, 20, 30, 40, 50, 100) THEN
      RETURN json_build_object('error', 'invalid',
        'message', 'Invalid ring value: ' || v_score::text);
    END IF;

    INSERT INTO skeeball_ball_scores
      (session_id, player_user_id, ball_number, score)
    VALUES (
      p_session_id,
      (v_ball->>'player_user_id')::uuid,
      (v_ball->>'ball_number')::int,
      v_score
    )
    ON CONFLICT (session_id, player_user_id, ball_number)
    DO UPDATE SET score = EXCLUDED.score;
  END LOOP;

  -- Bump last_activity_at so inactivity timer resets
  UPDATE skeeball_sessions
  SET last_activity_at = now()
  WHERE id = p_session_id;

  RETURN json_build_object('ok', true);
END;
$$;


--
-- Name: rpc_skeeball_swap_session_player(uuid, uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_skeeball_swap_session_player(p_session_id uuid, p_out_user_id uuid, p_in_user_id uuid) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_session record;
BEGIN
  IF v_uid IS NULL THEN RETURN json_build_object('error', 'not_authenticated'); END IF;

  SELECT * INTO v_session FROM skeeball_sessions
   WHERE id = p_session_id AND status = 'active';
  IF NOT FOUND THEN
    RETURN json_build_object('error', 'not_found', 'message', 'Session is no longer active.');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM team_members WHERE team_id = v_session.team_id AND user_id = v_uid) THEN
    RETURN json_build_object('error', 'not_team_member', 'message', 'Only team members can edit the lineup.');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM team_members WHERE team_id = v_session.team_id AND user_id = p_in_user_id) THEN
    RETURN json_build_object('error', 'invalid', 'message', 'That player is not on this team.');
  END IF;
  IF EXISTS (SELECT 1 FROM skeeball_session_players WHERE session_id = p_session_id AND player_user_id = p_in_user_id) THEN
    RETURN json_build_object('error', 'invalid', 'message', 'That player is already in the lineup.');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM skeeball_session_players WHERE session_id = p_session_id AND player_user_id = p_out_user_id) THEN
    RETURN json_build_object('error', 'invalid', 'message', 'The player being swapped out is not in the lineup.');
  END IF;
  -- Lineup is locked once any ball has been recorded
  IF EXISTS (SELECT 1 FROM skeeball_ball_scores WHERE session_id = p_session_id) THEN
    RETURN json_build_object('error', 'locked', 'message', 'Balls are already recorded — the lineup is locked for this game.');
  END IF;

  UPDATE skeeball_session_players
     SET player_user_id = p_in_user_id
   WHERE session_id = p_session_id AND player_user_id = p_out_user_id;

  RETURN json_build_object('ok', true);
END;
$$;


--
-- Name: rpc_skeeball_team_stats(uuid, date, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_skeeball_team_stats(p_team_id uuid, p_start date DEFAULT NULL::date, p_end date DEFAULT NULL::date) RETURNS json
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_weeks json;
  v_members json;
  v_points int;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN json_build_object('error', 'not_authenticated');
  END IF;

  WITH sess AS (
    SELECT ss.id, ss.week_of, ss.placement,
           COALESCE(ss.league_points, 0) + ss.league_points_adjustment AS pts,
           (SELECT COALESCE(SUM(score), 0)::int FROM skeeball_ball_scores b WHERE b.session_id = ss.id)
             + ss.score_adjustment AS team_score
      FROM skeeball_sessions ss
     WHERE ss.team_id = p_team_id
       AND ss.status = 'completed'
       AND (p_start IS NULL OR ss.week_of >= p_start)
       AND (p_end IS NULL OR ss.week_of <= p_end)
  ),
  week_agg AS (
    SELECT week_of,
           COUNT(*)::int AS games,
           ROUND(AVG(team_score))::int AS avg,
           MAX(team_score)::int AS best,
           SUM(pts)::int AS points,
           MIN(placement)::int AS best_placement
      FROM sess
     GROUP BY week_of
  ),
  member_games AS (
    SELECT ss.week_of, bs.player_user_id, ss.id AS session_id,
           SUM(bs.score)::int AS game_score,
           COUNT(*)::int AS balls
      FROM skeeball_sessions ss
      JOIN skeeball_ball_scores bs ON bs.session_id = ss.id
     WHERE ss.team_id = p_team_id
       AND ss.status = 'completed'
       AND (p_start IS NULL OR ss.week_of >= p_start)
       AND (p_end IS NULL OR ss.week_of <= p_end)
     GROUP BY ss.week_of, bs.player_user_id, ss.id
  ),
  member_weeks AS (
    SELECT player_user_id, week_of,
           COUNT(*)::int AS games,
           ROUND(AVG(game_score))::int AS avg,
           MAX(game_score)::int AS best
      FROM member_games
     GROUP BY player_user_id, week_of
  ),
  member_summary AS (
    SELECT player_user_id,
           COUNT(*)::int AS games,
           ROUND(AVG(game_score))::int AS avg,
           MAX(game_score)::int AS best,
           SUM(balls)::int AS balls
      FROM member_games
     GROUP BY player_user_id
  )
  SELECT
    COALESCE((SELECT json_agg(json_build_object(
        'week_of', w.week_of,
        'games', w.games,
        'avg', w.avg,
        'best', w.best,
        'points', w.points,
        'best_placement', w.best_placement
      ) ORDER BY w.week_of) FROM week_agg w), '[]'::json),
    COALESCE((SELECT json_agg(json_build_object(
        'user_id', ms.player_user_id,
        'username', COALESCE(p.username, 'Unknown'),
        'avatar_url', p.avatar_url,
        'games', ms.games,
        'avg', ms.avg,
        'best', ms.best,
        'balls', ms.balls,
        'best_week', (SELECT mw.week_of FROM member_weeks mw
                       WHERE mw.player_user_id = ms.player_user_id
                       ORDER BY mw.avg DESC, mw.week_of LIMIT 1),
        'worst_week', (SELECT mw.week_of FROM member_weeks mw
                        WHERE mw.player_user_id = ms.player_user_id
                        ORDER BY mw.avg ASC, mw.week_of LIMIT 1),
        'weeks', (SELECT json_agg(json_build_object(
                    'week_of', mw.week_of, 'avg', mw.avg, 'games', mw.games, 'best', mw.best
                  ) ORDER BY mw.week_of)
                  FROM member_weeks mw WHERE mw.player_user_id = ms.player_user_id)
      ) ORDER BY ms.avg DESC)
      FROM member_summary ms
      LEFT JOIN profiles p ON p.id = ms.player_user_id), '[]'::json),
    COALESCE((SELECT SUM(pts)::int FROM sess), 0)
  INTO v_weeks, v_members, v_points;

  RETURN json_build_object('ok', true, 'weeks', v_weeks, 'members', v_members, 'season_points', v_points);
END;
$$;


--
-- Name: rpc_skeeball_team_week_history(uuid, date, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_skeeball_team_week_history(p_team_id uuid, p_start date DEFAULT NULL::date, p_end date DEFAULT NULL::date) RETURNS json
    LANGUAGE plpgsql STABLE SECURITY DEFINER
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


--
-- Name: rpc_skeeball_week_scoring_mode(date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_skeeball_week_scoring_mode(p_week_of date DEFAULT NULL::date) RETURNS json
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_week date := COALESCE(p_week_of, public.skeeball_current_week());
  v_mode text;
BEGIN
  SELECT scoring_mode INTO v_mode
    FROM skeeball_league_matches
   WHERE week_of = v_week
   ORDER BY created_at DESC
   LIMIT 1;

  IF v_mode IS NULL THEN
    v_mode := CASE WHEN public.skeeball_season_week_number(v_week) = 7 THEN 'hundos' ELSE 'total' END;
  END IF;

  RETURN json_build_object(
    'week_of', v_week,
    'mode',    v_mode,
    'is_hundo_week', v_mode = 'hundos',
    'week_number', public.skeeball_season_week_number(v_week)
  );
END;
$$;


--
-- Name: rpc_skeeball_weekly_awards(date, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_skeeball_weekly_awards(p_start date DEFAULT NULL::date, p_end date DEFAULT NULL::date) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_week date;
  v_top json;
  v_improved json;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN json_build_object('error', 'not_authenticated');
  END IF;

  DROP TABLE IF EXISTS _wa_games;
  CREATE TEMP TABLE _wa_games ON COMMIT DROP AS
  SELECT s.week_of, b.player_user_id, b.session_id, SUM(b.score)::int AS game_score
    FROM skeeball_ball_scores b
    JOIN skeeball_sessions s ON s.id = b.session_id
   WHERE s.status = 'completed'
     AND (p_start IS NULL OR s.week_of >= p_start)
     AND (p_end IS NULL OR s.week_of <= p_end)
   GROUP BY s.week_of, b.player_user_id, b.session_id;

  SELECT MAX(week_of) INTO v_week FROM _wa_games;
  IF v_week IS NULL THEN
    DROP TABLE IF EXISTS _wa_games;
    RETURN json_build_object('ok', true, 'week_of', NULL);
  END IF;

  -- Player of the Week: highest weekly average (this week)
  SELECT json_build_object(
           'user_id', w.player_user_id,
           'username', COALESCE(p.username, 'Unknown'),
           'avatar_url', p.avatar_url,
           'avg', w.avg, 'games', w.games
         )
    INTO v_top
    FROM (
      SELECT player_user_id, ROUND(AVG(game_score))::int AS avg, COUNT(*)::int AS games
        FROM _wa_games WHERE week_of = v_week
       GROUP BY player_user_id
       ORDER BY AVG(game_score) DESC LIMIT 1
    ) w
    LEFT JOIN profiles p ON p.id = w.player_user_id;

  -- Most Improved: biggest avg jump vs their previous played week
  SELECT json_build_object(
           'user_id', mi.player_user_id,
           'username', COALESCE(p.username, 'Unknown'),
           'avatar_url', p.avatar_url,
           'delta_pct', mi.delta_pct, 'avg', mi.this_avg
         )
    INTO v_improved
    FROM (
      SELECT cur.player_user_id,
             ROUND(AVG(cur.game_score))::int AS this_avg,
             ROUND(100.0 * (AVG(cur.game_score) - prev.prev_avg) / NULLIF(prev.prev_avg, 0))::int AS delta_pct
        FROM _wa_games cur
        JOIN LATERAL (
          SELECT AVG(g.game_score) AS prev_avg
            FROM _wa_games g
           WHERE g.player_user_id = cur.player_user_id AND g.week_of < v_week
           GROUP BY g.week_of
           ORDER BY g.week_of DESC LIMIT 1
        ) prev ON true
       WHERE cur.week_of = v_week
       GROUP BY cur.player_user_id, prev.prev_avg
      HAVING AVG(cur.game_score) > prev.prev_avg
       ORDER BY (AVG(cur.game_score) - prev.prev_avg) / NULLIF(prev.prev_avg, 0) DESC
       LIMIT 1
    ) mi
    LEFT JOIN profiles p ON p.id = mi.player_user_id;

  DROP TABLE IF EXISTS _wa_games;

  RETURN json_build_object('ok', true, 'week_of', v_week, 'top', v_top, 'most_improved', v_improved);
END;
$$;


--
-- Name: rpc_submit_feedback(text, text, integer, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_submit_feedback(p_category text, p_message text, p_rating integer DEFAULT NULL::integer, p_app_version text DEFAULT NULL::text) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN json_build_object('error', 'not_authenticated');
  END IF;

  IF p_category NOT IN ('bug', 'feature', 'general', 'other') THEN
    RETURN json_build_object('error', 'invalid_category');
  END IF;

  IF length(trim(p_message)) < 10 THEN
    RETURN json_build_object('error', 'message_too_short',
      'message', 'Please provide at least 10 characters of feedback.');
  END IF;

  IF length(p_message) > 2000 THEN
    RETURN json_build_object('error', 'message_too_long',
      'message', 'Feedback must be under 2000 characters.');
  END IF;

  INSERT INTO feedback_submissions (user_id, category, rating, message, app_version)
  VALUES (auth.uid(), p_category, p_rating, trim(p_message), p_app_version);

  RETURN json_build_object('ok', true);
END;
$$;


--
-- Name: rpc_submit_score(uuid, uuid, uuid, uuid, bigint, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_submit_score(p_game_id uuid, p_lane_id uuid, p_check_in_id uuid, p_venue_id uuid, p_score bigint, p_frame_data jsonb DEFAULT NULL::jsonb) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_score_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN json_build_object('error', 'unauthenticated');
  END IF;

  IF p_score < 0 OR p_score > 100000000000 THEN
    RETURN json_build_object('error', 'invalid_score',
      'message', 'Score must be between 0 and 100,000,000,000.');
  END IF;

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
END; $$;


--
-- Name: rpc_team_ban(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_team_ban(p_team_id uuid, p_member_id uuid) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.teams WHERE id = p_team_id AND captain_user_id = auth.uid()
  ) THEN
    RETURN json_build_object('error', 'unauthorized');
  END IF;

  IF p_member_id = auth.uid() THEN
    RETURN json_build_object('error', 'cannot_ban_self');
  END IF;

  -- Remove from team
  DELETE FROM public.team_members WHERE team_id = p_team_id AND user_id = p_member_id;

  -- Cancel any open requests/invites
  DELETE FROM public.team_requests WHERE team_id = p_team_id AND user_id = p_member_id;

  -- Insert ban record (idempotent)
  INSERT INTO public.team_bans(team_id, user_id, banned_by)
  VALUES (p_team_id, p_member_id, auth.uid())
  ON CONFLICT (team_id, user_id) DO NOTHING;

  RETURN json_build_object('ok', true);
END; $$;


--
-- Name: rpc_team_kick(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_team_kick(p_team_id uuid, p_member_id uuid) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.teams WHERE id = p_team_id AND captain_user_id = auth.uid()
  ) THEN
    RETURN json_build_object('error', 'unauthorized');
  END IF;

  IF p_member_id = auth.uid() THEN
    RETURN json_build_object('error', 'cannot_kick_self');
  END IF;

  DELETE FROM public.team_members WHERE team_id = p_team_id AND user_id = p_member_id;
  RETURN json_build_object('ok', true);
END; $$;


--
-- Name: rpc_team_unban(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_team_unban(p_team_id uuid, p_member_id uuid) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.teams WHERE id = p_team_id AND captain_user_id = auth.uid()
  ) THEN
    RETURN json_build_object('error', 'unauthorized');
  END IF;

  DELETE FROM public.team_bans WHERE team_id = p_team_id AND user_id = p_member_id;
  RETURN json_build_object('ok', true);
END; $$;


--
-- Name: rpc_trivia_join(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_trivia_join(p_game_id uuid, p_team_id uuid DEFAULT NULL::uuid) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_game    record;
  v_name    text;
  v_count   int;
BEGIN
  SELECT * INTO v_game FROM public.trivia_games WHERE id = p_game_id;
  IF NOT FOUND THEN RETURN json_build_object('error','game_not_found'); END IF;
  IF v_game.status <> 'lobby' THEN RETURN json_build_object('error','game_not_open'); END IF;

  -- Check capacity
  SELECT count(*) INTO v_count FROM public.trivia_participants WHERE game_id = p_game_id;
  IF v_count >= v_game.max_participants THEN RETURN json_build_object('error','game_full'); END IF;

  IF p_team_id IS NOT NULL THEN
    -- Team sign-up: caller must be a member
    IF NOT EXISTS (SELECT 1 FROM public.team_members WHERE team_id = p_team_id AND user_id = auth.uid()) THEN
      RETURN json_build_object('error','not_team_member');
    END IF;
    -- Enforce min team size
    SELECT count(*) INTO v_count FROM public.team_members WHERE team_id = p_team_id;
    IF v_count < v_game.min_team_size THEN
      RETURN json_build_object('error','team_too_small','min',v_game.min_team_size);
    END IF;
    -- Already joined?
    IF EXISTS (SELECT 1 FROM public.trivia_participants WHERE game_id = p_game_id AND team_id = p_team_id) THEN
      RETURN json_build_object('error','already_joined');
    END IF;
    SELECT name INTO v_name FROM public.teams WHERE id = p_team_id;
    INSERT INTO public.trivia_participants(game_id, participant_type, team_id, display_name)
    VALUES (p_game_id, 'team', p_team_id, v_name);
  ELSE
    -- Individual sign-up
    IF EXISTS (SELECT 1 FROM public.trivia_participants WHERE game_id = p_game_id AND user_id = auth.uid()) THEN
      RETURN json_build_object('error','already_joined');
    END IF;
    SELECT username INTO v_name FROM public.profiles WHERE id = auth.uid();
    INSERT INTO public.trivia_participants(game_id, participant_type, user_id, display_name)
    VALUES (p_game_id, 'individual', auth.uid(), coalesce(v_name, 'Player'));
  END IF;

  RETURN json_build_object('ok', true);
END; $$;


--
-- Name: rpc_trivia_submit_answer(uuid, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_trivia_submit_answer(p_game_id uuid, p_question_id uuid, p_answer text) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_game           record;
  v_question       record;
  v_participant_id uuid;
  v_is_correct     boolean := false;
  v_points         int     := 0;
BEGIN
  SELECT * INTO v_game FROM public.trivia_games WHERE id = p_game_id AND status = 'active';
  IF NOT FOUND THEN RETURN json_build_object('error','game_not_active'); END IF;
  IF v_game.current_question_id IS DISTINCT FROM p_question_id THEN
    RETURN json_build_object('error','wrong_question');
  END IF;

  SELECT * INTO v_question FROM public.trivia_questions WHERE id = p_question_id;
  IF NOT FOUND THEN RETURN json_build_object('error','question_not_found'); END IF;

  -- Resolve participant (individual or team)
  SELECT tp.id INTO v_participant_id
  FROM public.trivia_participants tp
  WHERE tp.game_id = p_game_id AND (
    (tp.participant_type = 'individual' AND tp.user_id = auth.uid())
    OR (tp.participant_type = 'team' AND EXISTS (
      SELECT 1 FROM public.team_members tm WHERE tm.team_id = tp.team_id AND tm.user_id = auth.uid()
    ))
  )
  LIMIT 1;

  IF v_participant_id IS NULL THEN RETURN json_build_object('error','not_participating'); END IF;

  IF EXISTS (SELECT 1 FROM public.trivia_answers WHERE question_id = p_question_id AND participant_id = v_participant_id) THEN
    RETURN json_build_object('error','already_answered');
  END IF;

  -- Auto-grade multiple choice
  IF v_question.question_type = 'multiple_choice' THEN
    v_is_correct := lower(trim(p_answer)) = lower(trim(v_question.correct_answer));
    IF v_is_correct THEN
      v_points := v_question.points;
      UPDATE public.trivia_participants SET score = score + v_points WHERE id = v_participant_id;
    END IF;
  END IF;

  INSERT INTO public.trivia_answers(game_id, question_id, participant_id, answer_text, is_correct, points_awarded)
  VALUES (p_game_id, p_question_id, v_participant_id, p_answer,
    CASE WHEN v_question.question_type = 'multiple_choice' THEN v_is_correct ELSE NULL END,
    v_points);

  RETURN json_build_object('ok', true, 'is_correct', v_is_correct, 'points', v_points);
END; $$;


--
-- Name: set_user_role(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_user_role(target_user_id uuid, new_role text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  caller_role text;
  target_role text;
BEGIN
  SELECT role INTO caller_role FROM profiles WHERE id = auth.uid();
  SELECT role INTO target_role FROM profiles WHERE id = target_user_id;
  IF new_role NOT IN ('user', 'admin', 'owner', 'architect') THEN
    RAISE EXCEPTION 'Invalid role';
  END IF;
  IF caller_role NOT IN ('owner', 'architect') THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;
  IF new_role IN ('owner', 'architect') AND caller_role != 'architect' THEN
    RAISE EXCEPTION 'Only architects can assign owner or architect roles';
  END IF;
  IF target_role = 'architect' AND caller_role != 'architect' THEN
    RAISE EXCEPTION 'Cannot modify architect accounts';
  END IF;
  UPDATE profiles SET role = new_role, is_admin = (new_role IN ('admin', 'owner', 'architect'))
    WHERE id = target_user_id;
END;
$$;


--
-- Name: skeeball_current_week(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.skeeball_current_week() RETURNS date
    LANGUAGE sql STABLE
    AS $$
  SELECT (current_date - (((extract(dow from current_date)::int + 6) % 7))::int)::date;
$$;


--
-- Name: skeeball_lane_from_token(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.skeeball_lane_from_token(p_token text) RETURNS TABLE(lane_id uuid, lane_number integer, game_id uuid, game_name text, game_type text, venue_id uuid, lane_status text, token_error text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_token_hash text;
  v_lqt record;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN QUERY SELECT NULL::uuid, NULL::int, NULL::uuid, NULL::text, NULL::text, NULL::uuid, NULL::text, 'not_authenticated'::text;
    RETURN;
  END IF;

  v_token_hash := public.hash_lane_token(p_token);

  SELECT * INTO v_lqt
    FROM public.lane_qr_tokens
   WHERE token_hash = v_token_hash
   LIMIT 1;

  IF NOT FOUND THEN
    INSERT INTO public.security_events (event_type, severity, user_id, details)
    VALUES ('skeeball_qr_invalid', 'warn', auth.uid(), jsonb_build_object('token_fingerprint', public.qr_token_fingerprint(p_token)))
    ON CONFLICT DO NOTHING;
    RETURN QUERY SELECT NULL::uuid, NULL::int, NULL::uuid, NULL::text, NULL::text, NULL::uuid, NULL::text, 'lane_not_found'::text;
    RETURN;
  END IF;

  IF v_lqt.revoked_at IS NOT NULL THEN
    RETURN QUERY SELECT NULL::uuid, NULL::int, NULL::uuid, NULL::text, NULL::text, NULL::uuid, NULL::text, 'token_revoked'::text;
    RETURN;
  END IF;

  IF v_lqt.expires_at < now() THEN
    RETURN QUERY SELECT NULL::uuid, NULL::int, NULL::uuid, NULL::text, NULL::text, NULL::uuid, NULL::text, 'token_expired'::text;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT l.id, l.lane_number, g.id, g.name, g.type, l.venue_id, l.status, NULL::text
    FROM public.lanes l
    JOIN public.games g ON g.id = l.game_id
   WHERE l.id = v_lqt.lane_id
     AND g.type = 'skeeball'
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN QUERY SELECT NULL::uuid, NULL::int, NULL::uuid, NULL::text, NULL::text, NULL::uuid, NULL::text, 'not_skeeball'::text;
  END IF;
END;
$$;


--
-- Name: skeeball_season_week_number(date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.skeeball_season_week_number(p_week date) RETURNS integer
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT (((p_week - s.start_week) / 7) + 1)::int
    FROM skeeball_seasons s
   WHERE p_week BETWEEN s.start_week AND s.end_week
   ORDER BY s.start_week DESC
   LIMIT 1;
$$;


--
-- Name: sync_skeeball_lane_status(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_skeeball_lane_status() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_lane_id uuid;
BEGIN
  SELECT l.id INTO v_lane_id
    FROM public.lanes l
    JOIN public.games g ON g.id = l.game_id
   WHERE g.type = 'skeeball'
     AND l.lane_number = COALESCE(NEW.lane_number, OLD.lane_number)
   LIMIT 1;

  IF v_lane_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'INSERT' AND NEW.status = 'active' THEN
    UPDATE public.lanes SET status = 'occupied' WHERE id = v_lane_id;
  ELSIF TG_OP = 'UPDATE' AND OLD.status = 'active' AND NEW.status <> 'active' THEN
    UPDATE public.lanes SET status = 'available' WHERE id = v_lane_id;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;


--
-- Name: user_earned_title_keys(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.user_earned_title_keys(p_uid uuid) RETURNS text[]
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_keys text[] := '{}';
  v_balls int;
  v_sig int;
  v_role text;
  v_beta boolean;
BEGIN
  SELECT role, COALESCE(is_beta_tester, false) INTO v_role, v_beta
    FROM profiles WHERE id = p_uid;

  -- Architect: god-mode — every title in the catalog is equippable.
  IF v_role = 'architect' THEN
    RETURN public.all_title_keys();
  END IF;

  -- stored grants (beta_founder, any future manual grants)
  SELECT COALESCE(array_agg(title_key), '{}') INTO v_keys
    FROM user_titles WHERE user_id = p_uid;

  -- role flair (computed from current role / beta-tester flag, so it
  -- appears and disappears with the role and can never be self-assigned)
  v_keys := v_keys || CASE v_role
    WHEN 'architect' THEN 'the_creator'
    WHEN 'owner'     THEN 'the_house'
    WHEN 'admin'     THEN 'arcade_warden'
    ELSE NULL END;
  IF v_beta THEN
    v_keys := v_keys || 'vanguard'::text;
  END IF;

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
    v_keys := v_keys || 'tournament_champion'::text;
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
    v_keys := v_keys || 'season_champion'::text;
  END IF;

  -- drop nulls/dupes
  SELECT COALESCE(array_agg(DISTINCT k), '{}') INTO v_keys
    FROM unnest(v_keys) k WHERE k IS NOT NULL;
  RETURN v_keys;
END; $$;


--
-- Name: validate_score_check_in(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.validate_score_check_in() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.check_in_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM check_ins
       WHERE id = NEW.check_in_id AND user_id = NEW.user_id
    ) THEN
      RAISE EXCEPTION 'check_in_id does not belong to this user';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: admin_audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_audit_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    admin_id uuid,
    action text NOT NULL,
    target_type text,
    target_id text,
    details jsonb,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: ai_verification_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_verification_config (
    id integer DEFAULT 1 NOT NULL,
    mode text DEFAULT 'deny_only'::text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ai_verification_config_id_check CHECK ((id = 1)),
    CONSTRAINT ai_verification_config_mode_check CHECK ((mode = ANY (ARRAY['off'::text, 'deny_only'::text, 'full_auto'::text])))
);


--
-- Name: app_announcements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_announcements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text NOT NULL,
    body text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    CONSTRAINT app_announcements_body_check CHECK (((char_length(body) >= 2) AND (char_length(body) <= 300))),
    CONSTRAINT app_announcements_title_check CHECK (((char_length(title) >= 2) AND (char_length(title) <= 80)))
);


--
-- Name: app_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_config (
    id integer DEFAULT 1 NOT NULL,
    beta_open boolean DEFAULT true NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT app_config_id_check CHECK ((id = 1))
);


--
-- Name: beta_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.beta_reports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    category text NOT NULL,
    severity text NOT NULL,
    title text NOT NULL,
    description text NOT NULL,
    steps text,
    route text,
    platform text,
    app_version text,
    device_info text,
    screenshot_url text,
    status text DEFAULT 'open'::text NOT NULL,
    admin_note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT beta_reports_category_check CHECK ((category = ANY (ARRAY['bug'::text, 'glitch'::text, 'visual'::text, 'performance'::text, 'crash'::text, 'site_breaking'::text, 'suggestion'::text]))),
    CONSTRAINT beta_reports_description_check CHECK (((length(description) >= 3) AND (length(description) <= 4000))),
    CONSTRAINT beta_reports_severity_check CHECK ((severity = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text, 'critical'::text]))),
    CONSTRAINT beta_reports_status_check CHECK ((status = ANY (ARRAY['open'::text, 'triaged'::text, 'in_progress'::text, 'fixed'::text, 'wont_fix'::text, 'duplicate'::text]))),
    CONSTRAINT beta_reports_steps_check CHECK (((steps IS NULL) OR (length(steps) <= 4000))),
    CONSTRAINT beta_reports_title_check CHECK (((length(title) >= 3) AND (length(title) <= 120)))
);


--
-- Name: bug_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bug_reports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    route text,
    error_message text NOT NULL,
    description text,
    screenshot_url text,
    device_info text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: check_ins; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.check_ins (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    lane_id uuid,
    status text DEFAULT 'active'::text,
    created_at timestamp with time zone DEFAULT now(),
    venue_id uuid
);


--
-- Name: content_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.content_reports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    reporter_id uuid NOT NULL,
    content_type text NOT NULL,
    content_id uuid NOT NULL,
    post_id uuid,
    reason text NOT NULL,
    details text,
    status text DEFAULT 'pending'::text NOT NULL,
    reviewed_by uuid,
    reviewed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT content_reports_content_type_check CHECK ((content_type = ANY (ARRAY['post'::text, 'comment'::text, 'forum_post'::text, 'forum_comment'::text, 'profile'::text]))),
    CONSTRAINT content_reports_details_check CHECK (((details IS NULL) OR (char_length(details) <= 500))),
    CONSTRAINT content_reports_reason_check CHECK ((reason = ANY (ARRAY['inappropriate_picture'::text, 'inappropriate_text'::text, 'racism'::text, 'violence'::text, 'nudity'::text, 'spam'::text, 'harassment'::text, 'impersonation'::text, 'false_information'::text, 'other'::text]))),
    CONSTRAINT content_reports_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'dismissed'::text, 'actioned'::text])))
);


--
-- Name: conversations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.conversations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    participant_1 uuid NOT NULL,
    participant_2 uuid NOT NULL,
    last_message text,
    last_message_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: event_rsvps; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.event_rsvps (
    event_id uuid NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: fantasy_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fantasy_config (
    id integer DEFAULT 1 NOT NULL,
    full_mode_enabled boolean DEFAULT false NOT NULL,
    seasons_required integer DEFAULT 3 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT fantasy_config_id_check CHECK ((id = 1))
);


--
-- Name: fantasy_predictions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fantasy_predictions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    week_of date NOT NULL,
    team_id uuid NOT NULL,
    line integer NOT NULL,
    pick text NOT NULL,
    stake integer NOT NULL,
    multiplier numeric(5,2) NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    result_points integer,
    payout integer DEFAULT 0 NOT NULL,
    settled_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT fantasy_predictions_line_check CHECK ((line = ANY (ARRAY[15, 20, 25, 30]))),
    CONSTRAINT fantasy_predictions_multiplier_check CHECK ((multiplier >= 1.0)),
    CONSTRAINT fantasy_predictions_pick_check CHECK ((pick = ANY (ARRAY['over'::text, 'under'::text]))),
    CONSTRAINT fantasy_predictions_stake_check CHECK (((stake >= 5) AND (stake <= 50))),
    CONSTRAINT fantasy_predictions_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'won'::text, 'lost'::text, 'void'::text])))
);


--
-- Name: fantasy_roster_players; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fantasy_roster_players (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    roster_id uuid NOT NULL,
    player_user_id uuid NOT NULL,
    price_paid integer NOT NULL,
    acquired_at timestamp with time zone DEFAULT now() NOT NULL,
    sold_at timestamp with time zone,
    sell_price integer
);


--
-- Name: fantasy_rosters; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fantasy_rosters (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    season_id uuid,
    budget integer DEFAULT 1000 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: fantasy_transfers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fantasy_transfers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    roster_id uuid NOT NULL,
    player_user_id uuid NOT NULL,
    action text NOT NULL,
    price integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT fantasy_transfers_action_check CHECK ((action = ANY (ARRAY['buy'::text, 'sell'::text])))
);


--
-- Name: fantasy_wallets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fantasy_wallets (
    user_id uuid NOT NULL,
    balance integer DEFAULT 100 NOT NULL,
    lifetime_earned integer DEFAULT 0 NOT NULL,
    last_stipend_week date,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT fantasy_wallets_balance_check CHECK ((balance >= 0))
);


--
-- Name: fantasy_week_bonuses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fantasy_week_bonuses (
    week_of date NOT NULL,
    awarded_to uuid[] NOT NULL,
    awarded_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: feedback_submissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.feedback_submissions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    category text NOT NULL,
    rating integer,
    message text NOT NULL,
    app_version text,
    status text DEFAULT 'new'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT feedback_submissions_category_check CHECK ((category = ANY (ARRAY['bug'::text, 'feature'::text, 'general'::text, 'other'::text]))),
    CONSTRAINT feedback_submissions_rating_check CHECK (((rating >= 1) AND (rating <= 5))),
    CONSTRAINT feedback_submissions_status_check CHECK ((status = ANY (ARRAY['new'::text, 'reviewed'::text, 'resolved'::text])))
);


--
-- Name: ff_bracket_games; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ff_bracket_games (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    group_id uuid NOT NULL,
    tournament_id uuid NOT NULL,
    game_number integer NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ff_bracket_groups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ff_bracket_groups (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    round_id uuid NOT NULL,
    tournament_id uuid NOT NULL,
    group_number integer NOT NULL,
    status text DEFAULT 'game1'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ff_bracket_rounds; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ff_bracket_rounds (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tournament_id uuid NOT NULL,
    round_number integer NOT NULL,
    round_name text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ff_bracket_scores; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ff_bracket_scores (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    game_id uuid NOT NULL,
    tournament_id uuid NOT NULL,
    user_id uuid,
    username text NOT NULL,
    score integer NOT NULL,
    rank_in_game integer,
    is_eliminated boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    rank_points integer,
    player_seed integer
);


--
-- Name: ff_bracket_slots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ff_bracket_slots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    group_id uuid NOT NULL,
    tournament_id uuid NOT NULL,
    user_id uuid,
    username text NOT NULL,
    seed integer NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    eliminated_game integer,
    final_rank integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: follows; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.follows (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    follower_id uuid NOT NULL,
    following_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: forum_poll_votes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.forum_poll_votes (
    poll_id uuid NOT NULL,
    user_id uuid NOT NULL,
    option_idx integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT forum_poll_votes_option_idx_check CHECK (((option_idx >= 0) AND (option_idx <= 3)))
);


--
-- Name: forum_polls; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.forum_polls (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    post_id uuid NOT NULL,
    options jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT forum_polls_options_check CHECK (((jsonb_array_length(options) >= 2) AND (jsonb_array_length(options) <= 4)))
);


--
-- Name: forum_post_comments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.forum_post_comments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    post_id uuid NOT NULL,
    user_id uuid NOT NULL,
    content text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT forum_post_comments_content_len CHECK (((char_length(btrim(content)) >= 1) AND (char_length(btrim(content)) <= 1000)))
);


--
-- Name: forum_posts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.forum_posts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    forum_id uuid NOT NULL,
    user_id uuid NOT NULL,
    content text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: forums; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.forums (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text NOT NULL,
    description text,
    game_type text,
    creator_id uuid,
    status text DEFAULT 'pending'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    auto_flagged boolean DEFAULT false,
    flag_category text,
    CONSTRAINT forums_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])))
);


--
-- Name: friendships; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.friendships (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    requester_id uuid NOT NULL,
    addressee_id uuid NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT friendships_check CHECK ((requester_id <> addressee_id)),
    CONSTRAINT friendships_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'accepted'::text])))
);


--
-- Name: game_reference_photos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.game_reference_photos (
    game_id uuid NOT NULL,
    storage_path text NOT NULL,
    uploaded_by uuid,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: games; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.games (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text,
    type text,
    description text,
    machines_count integer DEFAULT 1,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: karaoke_queue; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.karaoke_queue (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    video_id text NOT NULL,
    title text NOT NULL,
    channel text DEFAULT ''::text NOT NULL,
    thumbnail_url text,
    requested_by uuid,
    requester_name text DEFAULT 'Guest'::text NOT NULL,
    status text DEFAULT 'queued'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT karaoke_queue_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'playing'::text, 'played'::text, 'skipped'::text])))
);


--
-- Name: karaoke_search_cache; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.karaoke_search_cache (
    query_norm text NOT NULL,
    results jsonb NOT NULL,
    hits integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: lane_qr_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lane_qr_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    lane_id uuid NOT NULL,
    venue_id uuid NOT NULL,
    token_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone,
    revoked_at timestamp with time zone,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: lanes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lanes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    game_id uuid,
    lane_number integer,
    lane_qr_token text,
    status text DEFAULT 'available'::text,
    created_at timestamp with time zone DEFAULT now(),
    qr_token_expires_at timestamp with time zone,
    qr_token_issued_at timestamp with time zone,
    venue_id uuid
);


--
-- Name: COLUMN lanes.lane_qr_token; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.lanes.lane_qr_token IS 'DEPRECATED — no longer written to. Use lane_qr_tokens.token_hash instead. Column retained for schema compatibility only. Remove in a future migration once confirmed no legacy clients depend on it.';


--
-- Name: league_rsvps; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.league_rsvps (
    user_id uuid NOT NULL,
    team_id uuid NOT NULL,
    week_of date NOT NULL,
    status text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT league_rsvps_status_check CHECK ((status = ANY (ARRAY['in'::text, 'out'::text])))
);


--
-- Name: league_teams; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.league_teams (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    season_id uuid,
    team_id uuid,
    wins integer DEFAULT 0,
    losses integer DEFAULT 0,
    points integer DEFAULT 0
);


--
-- Name: matches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.matches (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    season_id uuid,
    week_number integer,
    team_a_id uuid,
    team_b_id uuid,
    scheduled_at timestamp with time zone,
    status text DEFAULT 'scheduled'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: menu_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.menu_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    description text,
    price numeric(8,2) NOT NULL,
    category text NOT NULL,
    ingredients text[] DEFAULT '{}'::text[],
    photo_url text,
    available boolean DEFAULT true,
    location_slug text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    conversation_id uuid NOT NULL,
    sender_id uuid NOT NULL,
    content text NOT NULL,
    read_by_other boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    nonce text,
    encrypted_content text,
    sender_copy text,
    sender_nonce text,
    sender_public_key text,
    image_url text
);


--
-- Name: moderation_patterns; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.moderation_patterns (
    id integer NOT NULL,
    pattern text NOT NULL,
    category text NOT NULL,
    severity integer DEFAULT 2 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    case_sensitive boolean DEFAULT false NOT NULL
);


--
-- Name: moderation_patterns_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.moderation_patterns_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: moderation_patterns_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.moderation_patterns_id_seq OWNED BY public.moderation_patterns.id;


--
-- Name: pickem_picks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pickem_picks (
    user_id uuid NOT NULL,
    week_of date NOT NULL,
    team_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: post_comments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.post_comments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    post_id uuid NOT NULL,
    user_id uuid NOT NULL,
    content text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: post_likes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.post_likes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    post_id uuid NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: post_reactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.post_reactions (
    post_id uuid NOT NULL,
    user_id uuid NOT NULL,
    emoji text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT post_reactions_emoji_check CHECK ((emoji = ANY (ARRAY['👍'::text, '❤️'::text, '😂'::text, '🔥'::text, '🎯'::text, '😮'::text])))
);


--
-- Name: posts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.posts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    content text NOT NULL,
    score_id uuid,
    post_type text DEFAULT 'user'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    photo_url text,
    CONSTRAINT posts_post_type_check CHECK ((post_type = ANY (ARRAY['post'::text, 'score'::text, 'announcement'::text])))
);


--
-- Name: profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profiles (
    id uuid NOT NULL,
    username text NOT NULL,
    display_name text,
    avatar_url text,
    phone text,
    role text DEFAULT 'player'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    bio text,
    is_arcade_staff boolean DEFAULT false,
    is_admin boolean DEFAULT false NOT NULL,
    is_arcade_official boolean DEFAULT false,
    featured_game_id uuid,
    is_private boolean DEFAULT true,
    online_status text DEFAULT 'offline'::text,
    last_seen timestamp with time zone DEFAULT now(),
    tos_accepted_version text,
    show_skeeball_stats boolean DEFAULT true NOT NULL,
    sub_available boolean DEFAULT false NOT NULL,
    onboarding_dismissed boolean DEFAULT false NOT NULL,
    is_beta_tester boolean DEFAULT false NOT NULL,
    pronouns text,
    equipped_title text,
    notif_prefs jsonb DEFAULT '{}'::jsonb NOT NULL
);


--
-- Name: public_profiles; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.public_profiles AS
 SELECT id,
    username,
    avatar_url,
    pronouns,
    equipped_title,
        CASE
            WHEN ((NOT COALESCE(is_private, false)) OR (id = auth.uid())) THEN bio
            ELSE NULL::text
        END AS bio,
        CASE
            WHEN ((NOT COALESCE(is_private, false)) OR (id = auth.uid())) THEN online_status
            ELSE NULL::text
        END AS online_status,
    created_at,
        CASE
            WHEN ((NOT COALESCE(is_private, false)) OR (id = auth.uid())) THEN featured_game_id
            ELSE NULL::uuid
        END AS featured_game_id,
        CASE
            WHEN (role = ANY (ARRAY['admin'::text, 'owner'::text, 'architect'::text])) THEN role
            ELSE NULL::text
        END AS badge_role,
    COALESCE(is_beta_tester, false) AS is_beta_tester
   FROM public.profiles;


--
-- Name: push_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.push_tokens (
    token text NOT NULL,
    user_id uuid NOT NULL,
    platform text DEFAULT 'unknown'::text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: rate_limit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rate_limit_log (
    id bigint NOT NULL,
    user_id uuid NOT NULL,
    action text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: rate_limit_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.rate_limit_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: rate_limit_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.rate_limit_log_id_seq OWNED BY public.rate_limit_log.id;


--
-- Name: saved_posts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.saved_posts (
    user_id uuid NOT NULL,
    post_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: score_corrections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.score_corrections (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    game_id uuid,
    changed_by_user_id uuid,
    old_score integer,
    new_score integer,
    reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: score_disputes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.score_disputes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id uuid NOT NULL,
    team_id uuid NOT NULL,
    raised_by uuid NOT NULL,
    reason text NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    admin_note text,
    resolved_by uuid,
    resolved_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT score_disputes_reason_check CHECK (((char_length(reason) >= 5) AND (char_length(reason) <= 500))),
    CONSTRAINT score_disputes_status_check CHECK ((status = ANY (ARRAY['open'::text, 'resolved'::text, 'dismissed'::text])))
);


--
-- Name: scores; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scores (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    game_id uuid,
    lane_id uuid,
    check_in_id uuid,
    season_id uuid,
    score bigint NOT NULL,
    frame_data jsonb,
    created_at timestamp with time zone DEFAULT now(),
    photo_url text,
    status text DEFAULT 'approved'::text NOT NULL,
    venue_id uuid,
    proof_storage_path text,
    ai_verdict text,
    ai_confidence numeric,
    ai_read_score bigint,
    ai_reasoning text,
    ai_checked_at timestamp with time zone,
    CONSTRAINT scores_ai_verdict_check CHECK (((ai_verdict IS NULL) OR (ai_verdict = ANY (ARRAY['auto_denied'::text, 'looks_good'::text, 'needs_review'::text, 'no_reference'::text, 'error'::text])))),
    CONSTRAINT scores_score_range CHECK (((score >= 0) AND (score <= '100000000000'::bigint)))
);


--
-- Name: seasons; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.seasons (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    start_date date,
    end_date date,
    status text DEFAULT 'draft'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    registration_required boolean DEFAULT false NOT NULL,
    team_fee_cents integer DEFAULT 20000 NOT NULL,
    individual_fee_cents integer DEFAULT 5000 NOT NULL,
    prize_1st_cents integer DEFAULT 50000 NOT NULL,
    prize_2nd_cents integer DEFAULT 25000 NOT NULL,
    prize_3rd_cents integer DEFAULT 10000 NOT NULL,
    prize_4th_cents integer DEFAULT 10000 NOT NULL,
    registration_opens_at timestamp with time zone,
    registration_closes_at timestamp with time zone
);


--
-- Name: security_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.security_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_type text NOT NULL,
    severity text DEFAULT 'info'::text NOT NULL,
    user_id uuid,
    ip_address text,
    details jsonb,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT security_events_severity_check CHECK ((severity = ANY (ARRAY['info'::text, 'warn'::text, 'critical'::text])))
);


--
-- Name: skeeball_ball_scores; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.skeeball_ball_scores (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id uuid NOT NULL,
    player_user_id uuid NOT NULL,
    ball_number integer NOT NULL,
    score integer NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT skeeball_ball_scores_ball_number_check CHECK (((ball_number >= 1) AND (ball_number <= 9))),
    CONSTRAINT skeeball_ball_scores_score_check CHECK ((score >= 0))
);


--
-- Name: skeeball_league_matches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.skeeball_league_matches (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    week_of date NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    expected_teams integer DEFAULT 4 NOT NULL,
    notified_at timestamp with time zone,
    scoring_mode text,
    CONSTRAINT skeeball_league_matches_status_check CHECK ((status = ANY (ARRAY['active'::text, 'open'::text, 'in_progress'::text, 'completed'::text, 'cancelled'::text]))),
    CONSTRAINT skeeball_matches_scoring_mode_chk CHECK (((scoring_mode IS NULL) OR (scoring_mode = ANY (ARRAY['total'::text, 'hundos'::text]))))
);


--
-- Name: skeeball_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.skeeball_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    team_id uuid NOT NULL,
    lane_number integer NOT NULL,
    game_number integer DEFAULT 1 NOT NULL,
    week_of date NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    completed_at timestamp with time zone,
    last_activity_at timestamp with time zone DEFAULT now(),
    league_match_id uuid,
    placement integer,
    league_points integer,
    league_points_adjustment integer DEFAULT 0 NOT NULL,
    score_adjustment integer DEFAULT 0 NOT NULL,
    CONSTRAINT skeeball_sessions_lane_number_check CHECK (((lane_number >= 1) AND (lane_number <= 6))),
    CONSTRAINT skeeball_sessions_league_points_check CHECK (((league_points >= 1) AND (league_points <= 4))),
    CONSTRAINT skeeball_sessions_placement_check CHECK (((placement >= 1) AND (placement <= 4))),
    CONSTRAINT skeeball_sessions_status_check CHECK ((status = ANY (ARRAY['active'::text, 'completed'::text, 'abandoned'::text])))
);


--
-- Name: teams; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.teams (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    season_id uuid,
    name text NOT NULL,
    captain_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    photo_url text,
    slot_pref_1 text,
    slot_pref_2 text,
    venue_id uuid
);


--
-- Name: skeeball_league_standings; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.skeeball_league_standings AS
 SELECT s.team_id,
    t.name AS team_name,
    (sum((COALESCE(s.league_points, 0) + COALESCE(s.league_points_adjustment, 0))))::integer AS total_points,
    (count(s.id))::integer AS matches_played,
    (count(
        CASE
            WHEN (s.placement = 1) THEN 1
            ELSE NULL::integer
        END))::integer AS gold,
    (count(
        CASE
            WHEN (s.placement = 2) THEN 1
            ELSE NULL::integer
        END))::integer AS silver,
    (count(
        CASE
            WHEN (s.placement = 3) THEN 1
            ELSE NULL::integer
        END))::integer AS bronze
   FROM (public.skeeball_sessions s
     JOIN public.teams t ON ((t.id = s.team_id)))
  WHERE ((s.status = 'completed'::text) AND ((s.league_points IS NOT NULL) OR (s.league_points_adjustment <> 0)))
  GROUP BY s.team_id, t.name
  ORDER BY ((sum((COALESCE(s.league_points, 0) + COALESCE(s.league_points_adjustment, 0))))::integer) DESC;


--
-- Name: skeeball_seasons; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.skeeball_seasons (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    start_week date NOT NULL,
    end_week date NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    counts_for_fantasy boolean DEFAULT true NOT NULL,
    CONSTRAINT skeeball_seasons_status_check CHECK ((status = ANY (ARRAY['active'::text, 'completed'::text])))
);


--
-- Name: skeeball_session_players; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.skeeball_session_players (
    session_id uuid NOT NULL,
    player_user_id uuid NOT NULL,
    shoot_position integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: square_payment_statuses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.square_payment_statuses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    square_payment_id text,
    square_order_id text,
    status text,
    event_type text NOT NULL,
    last_event_id text NOT NULL,
    raw_event jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT square_payment_status_identity CHECK (((square_payment_id IS NOT NULL) OR (square_order_id IS NOT NULL)))
);


--
-- Name: square_webhook_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.square_webhook_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_id text NOT NULL,
    event_type text NOT NULL,
    merchant_id text,
    payload jsonb NOT NULL,
    received_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: storage_cleanup_queue; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.storage_cleanup_queue (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    bucket text NOT NULL,
    path text NOT NULL,
    reason text,
    created_at timestamp with time zone DEFAULT now(),
    processed_at timestamp with time zone
);


--
-- Name: sub_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sub_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    team_id uuid NOT NULL,
    week_of date NOT NULL,
    note text,
    status text DEFAULT 'open'::text NOT NULL,
    requested_by uuid NOT NULL,
    filled_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sub_requests_note_check CHECK (((note IS NULL) OR (char_length(note) <= 300))),
    CONSTRAINT sub_requests_status_check CHECK ((status = ANY (ARRAY['open'::text, 'filled'::text, 'cancelled'::text])))
);


--
-- Name: support_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.support_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    ticket_id uuid NOT NULL,
    sender_id uuid NOT NULL,
    content text NOT NULL,
    is_admin_msg boolean DEFAULT false NOT NULL,
    is_read boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: support_tickets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.support_tickets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    email_sent boolean DEFAULT false NOT NULL,
    resolved_at timestamp with time zone,
    resolved_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT support_tickets_status_check CHECK ((status = ANY (ARRAY['open'::text, 'resolved'::text, 'closed'::text])))
);


--
-- Name: team_announcements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.team_announcements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    team_id uuid,
    user_id uuid,
    content text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: team_bans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.team_bans (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    team_id uuid NOT NULL,
    user_id uuid NOT NULL,
    banned_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: team_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.team_members (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    team_id uuid,
    user_id uuid,
    role text DEFAULT 'player'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: team_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.team_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    team_id uuid,
    user_id uuid,
    content text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: team_registrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.team_registrations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    season_id uuid NOT NULL,
    registration_type text NOT NULL,
    status text DEFAULT 'pending_payment'::text NOT NULL,
    team_id uuid,
    square_payment_link_id text,
    square_order_id text,
    checkout_url text,
    paid_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT team_registrations_registration_type_check CHECK ((registration_type = ANY (ARRAY['team'::text, 'individual'::text]))),
    CONSTRAINT team_registrations_status_check CHECK ((status = ANY (ARRAY['pending_payment'::text, 'paid'::text, 'refunded'::text, 'cancelled'::text])))
);


--
-- Name: team_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.team_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    team_id uuid NOT NULL,
    user_id uuid NOT NULL,
    direction text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    message text,
    CONSTRAINT team_requests_direction_check CHECK ((direction = ANY (ARRAY['request'::text, 'invite'::text]))),
    CONSTRAINT team_requests_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'denied'::text])))
);


--
-- Name: team_schedule; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.team_schedule (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    team_id uuid,
    slot_time text NOT NULL,
    week_label text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    week_of date
);


--
-- Name: throws; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.throws (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    game_id uuid,
    throw_number integer NOT NULL,
    score integer NOT NULL,
    source text DEFAULT 'manual'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT throws_score_check CHECK ((score >= 0))
);


--
-- Name: tournament_placements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tournament_placements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tournament_id uuid NOT NULL,
    user_id uuid,
    placement integer NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    username text
);


--
-- Name: tournament_registrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tournament_registrations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tournament_id uuid NOT NULL,
    user_id uuid,
    team_name text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    guest_name text
);


--
-- Name: tournament_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tournament_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    title text NOT NULL,
    description text,
    game_type text,
    proposed_date timestamp with time zone,
    max_teams integer DEFAULT 8 NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    admin_note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    venue_id uuid
);


--
-- Name: tournament_results; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tournament_results (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tournament_id uuid,
    user_id uuid,
    place integer NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: tournaments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tournaments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text NOT NULL,
    description text,
    game_type text,
    proposed_date timestamp with time zone,
    max_teams integer,
    is_official boolean DEFAULT false NOT NULL,
    is_individual boolean DEFAULT false NOT NULL,
    signup_type text DEFAULT 'app'::text NOT NULL,
    status text DEFAULT 'upcoming'::text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    announcement text,
    announcement_updated_at timestamp with time zone,
    signup_qr_token uuid,
    signup_qr_active boolean DEFAULT false NOT NULL,
    signup_qr_issued_at timestamp with time zone,
    max_players integer DEFAULT 20,
    ff_signup_time text DEFAULT '7:30 PM'::text,
    ff_start_time text DEFAULT '8:00 PM'::text,
    venue_id uuid
);


--
-- Name: trivia_answers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trivia_answers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    game_id uuid NOT NULL,
    question_id uuid NOT NULL,
    participant_id uuid NOT NULL,
    answer_text text,
    is_correct boolean,
    points_awarded integer DEFAULT 0 NOT NULL,
    submitted_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: trivia_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trivia_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text NOT NULL,
    description text,
    signup_deadline timestamp with time zone NOT NULL,
    event_date timestamp with time zone,
    status text DEFAULT 'signup'::text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: trivia_game_questions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trivia_game_questions (
    game_id uuid NOT NULL,
    question_id uuid NOT NULL,
    question_order integer NOT NULL
);


--
-- Name: trivia_games; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trivia_games (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text DEFAULT 'Trivia Night'::text NOT NULL,
    status text DEFAULT 'lobby'::text NOT NULL,
    current_question_id uuid,
    current_question_index integer DEFAULT '-1'::integer NOT NULL,
    max_participants integer DEFAULT 20 NOT NULL,
    allow_teams boolean DEFAULT true NOT NULL,
    min_team_size integer DEFAULT 3 NOT NULL,
    signup_token text DEFAULT (gen_random_uuid())::text NOT NULL,
    created_by uuid,
    started_at timestamp with time zone,
    ended_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT trivia_games_status_check CHECK ((status = ANY (ARRAY['lobby'::text, 'active'::text, 'finished'::text])))
);


--
-- Name: trivia_participants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trivia_participants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    game_id uuid NOT NULL,
    participant_type text NOT NULL,
    user_id uuid,
    team_id uuid,
    display_name text NOT NULL,
    score integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT trivia_participants_participant_type_check CHECK ((participant_type = ANY (ARRAY['individual'::text, 'team'::text])))
);


--
-- Name: trivia_questions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trivia_questions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    question text NOT NULL,
    question_type text DEFAULT 'multiple_choice'::text NOT NULL,
    options jsonb DEFAULT '[]'::jsonb,
    correct_answer text NOT NULL,
    points integer DEFAULT 100 NOT NULL,
    category text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT trivia_questions_question_type_check CHECK ((question_type = ANY (ARRAY['multiple_choice'::text, 'text'::text])))
);


--
-- Name: trivia_team_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trivia_team_members (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    trivia_team_id uuid NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: trivia_teams; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trivia_teams (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_id uuid NOT NULL,
    team_name text NOT NULL,
    captain_user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_blocks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_blocks (
    blocker_id uuid NOT NULL,
    blocked_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_blocks_check CHECK ((blocker_id <> blocked_id))
);


--
-- Name: user_public_keys; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_public_keys (
    user_id uuid NOT NULL,
    public_key text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: user_titles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_titles (
    user_id uuid NOT NULL,
    title_key text NOT NULL,
    source text,
    granted_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: venue_admins; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.venue_admins (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    venue_id uuid NOT NULL,
    user_id uuid NOT NULL,
    granted_by uuid,
    granted_at timestamp with time zone DEFAULT now(),
    role text DEFAULT 'admin'::text NOT NULL,
    CONSTRAINT venue_admins_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'admin'::text, 'staff'::text])))
);


--
-- Name: venue_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.venue_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text NOT NULL,
    description text,
    event_type text DEFAULT 'event'::text NOT NULL,
    starts_at timestamp with time zone NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT venue_events_description_check CHECK (((description IS NULL) OR (char_length(description) <= 500))),
    CONSTRAINT venue_events_title_check CHECK (((char_length(title) >= 2) AND (char_length(title) <= 80)))
);


--
-- Name: venues; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.venues (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug text NOT NULL,
    name text NOT NULL,
    address text,
    color text
);


--
-- Name: moderation_patterns id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.moderation_patterns ALTER COLUMN id SET DEFAULT nextval('public.moderation_patterns_id_seq'::regclass);


--
-- Name: rate_limit_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rate_limit_log ALTER COLUMN id SET DEFAULT nextval('public.rate_limit_log_id_seq'::regclass);


--
-- Name: admin_audit_log admin_audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_audit_log
    ADD CONSTRAINT admin_audit_log_pkey PRIMARY KEY (id);


--
-- Name: ai_verification_config ai_verification_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_verification_config
    ADD CONSTRAINT ai_verification_config_pkey PRIMARY KEY (id);


--
-- Name: app_announcements app_announcements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_announcements
    ADD CONSTRAINT app_announcements_pkey PRIMARY KEY (id);


--
-- Name: app_config app_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_config
    ADD CONSTRAINT app_config_pkey PRIMARY KEY (id);


--
-- Name: beta_reports beta_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.beta_reports
    ADD CONSTRAINT beta_reports_pkey PRIMARY KEY (id);


--
-- Name: bug_reports bug_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bug_reports
    ADD CONSTRAINT bug_reports_pkey PRIMARY KEY (id);


--
-- Name: check_ins check_ins_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.check_ins
    ADD CONSTRAINT check_ins_pkey PRIMARY KEY (id);


--
-- Name: content_reports content_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_reports
    ADD CONSTRAINT content_reports_pkey PRIMARY KEY (id);


--
-- Name: content_reports content_reports_reporter_id_content_type_content_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_reports
    ADD CONSTRAINT content_reports_reporter_id_content_type_content_id_key UNIQUE (reporter_id, content_type, content_id);


--
-- Name: conversations conversations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_pkey PRIMARY KEY (id);


--
-- Name: event_rsvps event_rsvps_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_rsvps
    ADD CONSTRAINT event_rsvps_pkey PRIMARY KEY (event_id, user_id);


--
-- Name: fantasy_config fantasy_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fantasy_config
    ADD CONSTRAINT fantasy_config_pkey PRIMARY KEY (id);


--
-- Name: fantasy_predictions fantasy_predictions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fantasy_predictions
    ADD CONSTRAINT fantasy_predictions_pkey PRIMARY KEY (id);


--
-- Name: fantasy_predictions fantasy_predictions_user_id_week_of_team_id_line_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fantasy_predictions
    ADD CONSTRAINT fantasy_predictions_user_id_week_of_team_id_line_key UNIQUE (user_id, week_of, team_id, line);


--
-- Name: fantasy_roster_players fantasy_roster_players_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fantasy_roster_players
    ADD CONSTRAINT fantasy_roster_players_pkey PRIMARY KEY (id);


--
-- Name: fantasy_rosters fantasy_rosters_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fantasy_rosters
    ADD CONSTRAINT fantasy_rosters_pkey PRIMARY KEY (id);


--
-- Name: fantasy_rosters fantasy_rosters_user_id_season_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fantasy_rosters
    ADD CONSTRAINT fantasy_rosters_user_id_season_id_key UNIQUE (user_id, season_id);


--
-- Name: fantasy_transfers fantasy_transfers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fantasy_transfers
    ADD CONSTRAINT fantasy_transfers_pkey PRIMARY KEY (id);


--
-- Name: fantasy_wallets fantasy_wallets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fantasy_wallets
    ADD CONSTRAINT fantasy_wallets_pkey PRIMARY KEY (user_id);


--
-- Name: fantasy_week_bonuses fantasy_week_bonuses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fantasy_week_bonuses
    ADD CONSTRAINT fantasy_week_bonuses_pkey PRIMARY KEY (week_of);


--
-- Name: feedback_submissions feedback_submissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feedback_submissions
    ADD CONSTRAINT feedback_submissions_pkey PRIMARY KEY (id);


--
-- Name: ff_bracket_games ff_bracket_games_group_id_game_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ff_bracket_games
    ADD CONSTRAINT ff_bracket_games_group_id_game_number_key UNIQUE (group_id, game_number);


--
-- Name: ff_bracket_games ff_bracket_games_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ff_bracket_games
    ADD CONSTRAINT ff_bracket_games_pkey PRIMARY KEY (id);


--
-- Name: ff_bracket_groups ff_bracket_groups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ff_bracket_groups
    ADD CONSTRAINT ff_bracket_groups_pkey PRIMARY KEY (id);


--
-- Name: ff_bracket_groups ff_bracket_groups_round_id_group_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ff_bracket_groups
    ADD CONSTRAINT ff_bracket_groups_round_id_group_number_key UNIQUE (round_id, group_number);


--
-- Name: ff_bracket_rounds ff_bracket_rounds_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ff_bracket_rounds
    ADD CONSTRAINT ff_bracket_rounds_pkey PRIMARY KEY (id);


--
-- Name: ff_bracket_rounds ff_bracket_rounds_tournament_id_round_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ff_bracket_rounds
    ADD CONSTRAINT ff_bracket_rounds_tournament_id_round_number_key UNIQUE (tournament_id, round_number);


--
-- Name: ff_bracket_scores ff_bracket_scores_game_user_seed_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ff_bracket_scores
    ADD CONSTRAINT ff_bracket_scores_game_user_seed_key UNIQUE (game_id, user_id, player_seed);


--
-- Name: ff_bracket_scores ff_bracket_scores_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ff_bracket_scores
    ADD CONSTRAINT ff_bracket_scores_pkey PRIMARY KEY (id);


--
-- Name: ff_bracket_slots ff_bracket_slots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ff_bracket_slots
    ADD CONSTRAINT ff_bracket_slots_pkey PRIMARY KEY (id);


--
-- Name: follows follows_follower_id_following_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.follows
    ADD CONSTRAINT follows_follower_id_following_id_key UNIQUE (follower_id, following_id);


--
-- Name: follows follows_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.follows
    ADD CONSTRAINT follows_pkey PRIMARY KEY (id);


--
-- Name: forum_poll_votes forum_poll_votes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.forum_poll_votes
    ADD CONSTRAINT forum_poll_votes_pkey PRIMARY KEY (poll_id, user_id);


--
-- Name: forum_polls forum_polls_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.forum_polls
    ADD CONSTRAINT forum_polls_pkey PRIMARY KEY (id);


--
-- Name: forum_polls forum_polls_post_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.forum_polls
    ADD CONSTRAINT forum_polls_post_id_key UNIQUE (post_id);


--
-- Name: forum_post_comments forum_post_comments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.forum_post_comments
    ADD CONSTRAINT forum_post_comments_pkey PRIMARY KEY (id);


--
-- Name: forum_posts forum_posts_content_len; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.forum_posts
    ADD CONSTRAINT forum_posts_content_len CHECK (((char_length(btrim(content)) >= 1) AND (char_length(btrim(content)) <= 2000))) NOT VALID;


--
-- Name: forum_posts forum_posts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.forum_posts
    ADD CONSTRAINT forum_posts_pkey PRIMARY KEY (id);


--
-- Name: forums forums_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.forums
    ADD CONSTRAINT forums_pkey PRIMARY KEY (id);


--
-- Name: forums forums_title_desc_len; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.forums
    ADD CONSTRAINT forums_title_desc_len CHECK ((((char_length(btrim(title)) >= 3) AND (char_length(btrim(title)) <= 80)) AND ((description IS NULL) OR (char_length(btrim(description)) <= 500)))) NOT VALID;


--
-- Name: friendships friendships_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.friendships
    ADD CONSTRAINT friendships_pkey PRIMARY KEY (id);


--
-- Name: friendships friendships_requester_id_addressee_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.friendships
    ADD CONSTRAINT friendships_requester_id_addressee_id_key UNIQUE (requester_id, addressee_id);


--
-- Name: game_reference_photos game_reference_photos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_reference_photos
    ADD CONSTRAINT game_reference_photos_pkey PRIMARY KEY (game_id);


--
-- Name: games games_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.games
    ADD CONSTRAINT games_pkey PRIMARY KEY (id);


--
-- Name: karaoke_queue karaoke_queue_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.karaoke_queue
    ADD CONSTRAINT karaoke_queue_pkey PRIMARY KEY (id);


--
-- Name: karaoke_search_cache karaoke_search_cache_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.karaoke_search_cache
    ADD CONSTRAINT karaoke_search_cache_pkey PRIMARY KEY (query_norm);


--
-- Name: lane_qr_tokens lane_qr_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lane_qr_tokens
    ADD CONSTRAINT lane_qr_tokens_pkey PRIMARY KEY (id);


--
-- Name: lane_qr_tokens lane_qr_tokens_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lane_qr_tokens
    ADD CONSTRAINT lane_qr_tokens_token_hash_key UNIQUE (token_hash);


--
-- Name: lanes lanes_lane_qr_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lanes
    ADD CONSTRAINT lanes_lane_qr_token_key UNIQUE (lane_qr_token);


--
-- Name: lanes lanes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lanes
    ADD CONSTRAINT lanes_pkey PRIMARY KEY (id);


--
-- Name: league_rsvps league_rsvps_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.league_rsvps
    ADD CONSTRAINT league_rsvps_pkey PRIMARY KEY (user_id, week_of);


--
-- Name: league_teams league_teams_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.league_teams
    ADD CONSTRAINT league_teams_pkey PRIMARY KEY (id);


--
-- Name: league_teams league_teams_season_id_team_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.league_teams
    ADD CONSTRAINT league_teams_season_id_team_id_key UNIQUE (season_id, team_id);


--
-- Name: matches matches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.matches
    ADD CONSTRAINT matches_pkey PRIMARY KEY (id);


--
-- Name: menu_items menu_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.menu_items
    ADD CONSTRAINT menu_items_pkey PRIMARY KEY (id);


--
-- Name: messages messages_content_len; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.messages
    ADD CONSTRAINT messages_content_len CHECK (((content IS NULL) OR (char_length(btrim(content)) <= 2000))) NOT VALID;


--
-- Name: messages messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_pkey PRIMARY KEY (id);


--
-- Name: moderation_patterns moderation_patterns_pattern_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.moderation_patterns
    ADD CONSTRAINT moderation_patterns_pattern_key UNIQUE (pattern);


--
-- Name: moderation_patterns moderation_patterns_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.moderation_patterns
    ADD CONSTRAINT moderation_patterns_pkey PRIMARY KEY (id);


--
-- Name: pickem_picks pickem_picks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pickem_picks
    ADD CONSTRAINT pickem_picks_pkey PRIMARY KEY (user_id, week_of);


--
-- Name: post_comments post_comments_content_len; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.post_comments
    ADD CONSTRAINT post_comments_content_len CHECK (((char_length(btrim(content)) >= 1) AND (char_length(btrim(content)) <= 500))) NOT VALID;


--
-- Name: post_comments post_comments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.post_comments
    ADD CONSTRAINT post_comments_pkey PRIMARY KEY (id);


--
-- Name: post_likes post_likes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.post_likes
    ADD CONSTRAINT post_likes_pkey PRIMARY KEY (id);


--
-- Name: post_likes post_likes_post_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.post_likes
    ADD CONSTRAINT post_likes_post_id_user_id_key UNIQUE (post_id, user_id);


--
-- Name: post_reactions post_reactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.post_reactions
    ADD CONSTRAINT post_reactions_pkey PRIMARY KEY (post_id, user_id);


--
-- Name: posts posts_content_len; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.posts
    ADD CONSTRAINT posts_content_len CHECK (((content IS NULL) OR ((char_length(btrim(content)) >= 1) AND (char_length(btrim(content)) <= 1000)))) NOT VALID;


--
-- Name: posts posts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.posts
    ADD CONSTRAINT posts_pkey PRIMARY KEY (id);


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);


--
-- Name: profiles profiles_username_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_username_key UNIQUE (username);


--
-- Name: push_tokens push_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_tokens
    ADD CONSTRAINT push_tokens_pkey PRIMARY KEY (token);


--
-- Name: rate_limit_log rate_limit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rate_limit_log
    ADD CONSTRAINT rate_limit_log_pkey PRIMARY KEY (id);


--
-- Name: saved_posts saved_posts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.saved_posts
    ADD CONSTRAINT saved_posts_pkey PRIMARY KEY (user_id, post_id);


--
-- Name: score_corrections score_corrections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.score_corrections
    ADD CONSTRAINT score_corrections_pkey PRIMARY KEY (id);


--
-- Name: score_disputes score_disputes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.score_disputes
    ADD CONSTRAINT score_disputes_pkey PRIMARY KEY (id);


--
-- Name: scores scores_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scores
    ADD CONSTRAINT scores_pkey PRIMARY KEY (id);


--
-- Name: seasons seasons_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seasons
    ADD CONSTRAINT seasons_pkey PRIMARY KEY (id);


--
-- Name: security_events security_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.security_events
    ADD CONSTRAINT security_events_pkey PRIMARY KEY (id);


--
-- Name: skeeball_ball_scores skeeball_ball_scores_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skeeball_ball_scores
    ADD CONSTRAINT skeeball_ball_scores_pkey PRIMARY KEY (id);


--
-- Name: skeeball_ball_scores skeeball_ball_scores_session_id_player_user_id_ball_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skeeball_ball_scores
    ADD CONSTRAINT skeeball_ball_scores_session_id_player_user_id_ball_number_key UNIQUE (session_id, player_user_id, ball_number);


--
-- Name: skeeball_league_matches skeeball_league_matches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skeeball_league_matches
    ADD CONSTRAINT skeeball_league_matches_pkey PRIMARY KEY (id);


--
-- Name: skeeball_seasons skeeball_seasons_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skeeball_seasons
    ADD CONSTRAINT skeeball_seasons_pkey PRIMARY KEY (id);


--
-- Name: skeeball_session_players skeeball_session_players_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skeeball_session_players
    ADD CONSTRAINT skeeball_session_players_pkey PRIMARY KEY (session_id, player_user_id);


--
-- Name: skeeball_sessions skeeball_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skeeball_sessions
    ADD CONSTRAINT skeeball_sessions_pkey PRIMARY KEY (id);


--
-- Name: square_payment_statuses square_payment_statuses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.square_payment_statuses
    ADD CONSTRAINT square_payment_statuses_pkey PRIMARY KEY (id);


--
-- Name: square_webhook_events square_webhook_events_event_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.square_webhook_events
    ADD CONSTRAINT square_webhook_events_event_id_key UNIQUE (event_id);


--
-- Name: square_webhook_events square_webhook_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.square_webhook_events
    ADD CONSTRAINT square_webhook_events_pkey PRIMARY KEY (id);


--
-- Name: storage_cleanup_queue storage_cleanup_queue_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.storage_cleanup_queue
    ADD CONSTRAINT storage_cleanup_queue_pkey PRIMARY KEY (id);


--
-- Name: sub_requests sub_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sub_requests
    ADD CONSTRAINT sub_requests_pkey PRIMARY KEY (id);


--
-- Name: support_messages support_messages_content_len; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.support_messages
    ADD CONSTRAINT support_messages_content_len CHECK (((char_length(btrim(content)) >= 1) AND (char_length(btrim(content)) <= 2000))) NOT VALID;


--
-- Name: support_messages support_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_messages
    ADD CONSTRAINT support_messages_pkey PRIMARY KEY (id);


--
-- Name: support_tickets support_tickets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_tickets
    ADD CONSTRAINT support_tickets_pkey PRIMARY KEY (id);


--
-- Name: team_announcements team_announcements_content_len; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.team_announcements
    ADD CONSTRAINT team_announcements_content_len CHECK (((char_length(btrim(content)) >= 1) AND (char_length(btrim(content)) <= 2000))) NOT VALID;


--
-- Name: team_announcements team_announcements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_announcements
    ADD CONSTRAINT team_announcements_pkey PRIMARY KEY (id);


--
-- Name: team_bans team_bans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_bans
    ADD CONSTRAINT team_bans_pkey PRIMARY KEY (id);


--
-- Name: team_bans team_bans_team_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_bans
    ADD CONSTRAINT team_bans_team_id_user_id_key UNIQUE (team_id, user_id);


--
-- Name: team_members team_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_members
    ADD CONSTRAINT team_members_pkey PRIMARY KEY (id);


--
-- Name: team_members team_members_team_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_members
    ADD CONSTRAINT team_members_team_id_user_id_key UNIQUE (team_id, user_id);


--
-- Name: team_messages team_messages_content_len; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.team_messages
    ADD CONSTRAINT team_messages_content_len CHECK (((char_length(btrim(content)) >= 1) AND (char_length(btrim(content)) <= 2000))) NOT VALID;


--
-- Name: team_messages team_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_messages
    ADD CONSTRAINT team_messages_pkey PRIMARY KEY (id);


--
-- Name: team_registrations team_registrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_registrations
    ADD CONSTRAINT team_registrations_pkey PRIMARY KEY (id);


--
-- Name: team_registrations team_registrations_user_id_season_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_registrations
    ADD CONSTRAINT team_registrations_user_id_season_id_key UNIQUE (user_id, season_id);


--
-- Name: team_requests team_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_requests
    ADD CONSTRAINT team_requests_pkey PRIMARY KEY (id);


--
-- Name: team_requests team_requests_team_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_requests
    ADD CONSTRAINT team_requests_team_id_user_id_key UNIQUE (team_id, user_id);


--
-- Name: team_schedule team_schedule_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_schedule
    ADD CONSTRAINT team_schedule_pkey PRIMARY KEY (id);


--
-- Name: teams teams_name_len; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.teams
    ADD CONSTRAINT teams_name_len CHECK (((char_length(btrim(name)) >= 2) AND (char_length(btrim(name)) <= 40))) NOT VALID;


--
-- Name: teams teams_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teams
    ADD CONSTRAINT teams_pkey PRIMARY KEY (id);


--
-- Name: throws throws_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.throws
    ADD CONSTRAINT throws_pkey PRIMARY KEY (id);


--
-- Name: tournament_placements tournament_placements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tournament_placements
    ADD CONSTRAINT tournament_placements_pkey PRIMARY KEY (id);


--
-- Name: tournament_placements tournament_placements_tournament_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tournament_placements
    ADD CONSTRAINT tournament_placements_tournament_id_user_id_key UNIQUE (tournament_id, user_id);


--
-- Name: tournament_registrations tournament_registrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tournament_registrations
    ADD CONSTRAINT tournament_registrations_pkey PRIMARY KEY (id);


--
-- Name: tournament_registrations tournament_registrations_tournament_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tournament_registrations
    ADD CONSTRAINT tournament_registrations_tournament_id_user_id_key UNIQUE (tournament_id, user_id);


--
-- Name: tournament_requests tournament_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tournament_requests
    ADD CONSTRAINT tournament_requests_pkey PRIMARY KEY (id);


--
-- Name: tournament_requests tournament_requests_text_len; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.tournament_requests
    ADD CONSTRAINT tournament_requests_text_len CHECK ((((char_length(btrim(title)) >= 3) AND (char_length(btrim(title)) <= 80)) AND ((description IS NULL) OR (char_length(btrim(description)) <= 1000)))) NOT VALID;


--
-- Name: tournament_results tournament_results_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tournament_results
    ADD CONSTRAINT tournament_results_pkey PRIMARY KEY (id);


--
-- Name: tournament_results tournament_results_tournament_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tournament_results
    ADD CONSTRAINT tournament_results_tournament_id_user_id_key UNIQUE (tournament_id, user_id);


--
-- Name: tournaments tournaments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tournaments
    ADD CONSTRAINT tournaments_pkey PRIMARY KEY (id);


--
-- Name: trivia_answers trivia_answers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trivia_answers
    ADD CONSTRAINT trivia_answers_pkey PRIMARY KEY (id);


--
-- Name: trivia_answers trivia_answers_question_id_participant_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trivia_answers
    ADD CONSTRAINT trivia_answers_question_id_participant_id_key UNIQUE (question_id, participant_id);


--
-- Name: trivia_events trivia_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trivia_events
    ADD CONSTRAINT trivia_events_pkey PRIMARY KEY (id);


--
-- Name: trivia_game_questions trivia_game_questions_game_id_question_order_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trivia_game_questions
    ADD CONSTRAINT trivia_game_questions_game_id_question_order_key UNIQUE (game_id, question_order);


--
-- Name: trivia_game_questions trivia_game_questions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trivia_game_questions
    ADD CONSTRAINT trivia_game_questions_pkey PRIMARY KEY (game_id, question_id);


--
-- Name: trivia_games trivia_games_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trivia_games
    ADD CONSTRAINT trivia_games_pkey PRIMARY KEY (id);


--
-- Name: trivia_games trivia_games_signup_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trivia_games
    ADD CONSTRAINT trivia_games_signup_token_key UNIQUE (signup_token);


--
-- Name: trivia_participants trivia_participants_game_id_team_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trivia_participants
    ADD CONSTRAINT trivia_participants_game_id_team_id_key UNIQUE (game_id, team_id);


--
-- Name: trivia_participants trivia_participants_game_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trivia_participants
    ADD CONSTRAINT trivia_participants_game_id_user_id_key UNIQUE (game_id, user_id);


--
-- Name: trivia_participants trivia_participants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trivia_participants
    ADD CONSTRAINT trivia_participants_pkey PRIMARY KEY (id);


--
-- Name: trivia_questions trivia_questions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trivia_questions
    ADD CONSTRAINT trivia_questions_pkey PRIMARY KEY (id);


--
-- Name: trivia_team_members trivia_team_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trivia_team_members
    ADD CONSTRAINT trivia_team_members_pkey PRIMARY KEY (id);


--
-- Name: trivia_team_members trivia_team_members_trivia_team_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trivia_team_members
    ADD CONSTRAINT trivia_team_members_trivia_team_id_user_id_key UNIQUE (trivia_team_id, user_id);


--
-- Name: trivia_teams trivia_teams_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trivia_teams
    ADD CONSTRAINT trivia_teams_pkey PRIMARY KEY (id);


--
-- Name: user_blocks user_blocks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_blocks
    ADD CONSTRAINT user_blocks_pkey PRIMARY KEY (blocker_id, blocked_id);


--
-- Name: user_public_keys user_public_keys_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_public_keys
    ADD CONSTRAINT user_public_keys_pkey PRIMARY KEY (user_id);


--
-- Name: user_titles user_titles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_titles
    ADD CONSTRAINT user_titles_pkey PRIMARY KEY (user_id, title_key);


--
-- Name: venue_admins venue_admins_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.venue_admins
    ADD CONSTRAINT venue_admins_pkey PRIMARY KEY (id);


--
-- Name: venue_admins venue_admins_venue_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.venue_admins
    ADD CONSTRAINT venue_admins_venue_id_user_id_key UNIQUE (venue_id, user_id);


--
-- Name: venue_events venue_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.venue_events
    ADD CONSTRAINT venue_events_pkey PRIMARY KEY (id);


--
-- Name: venues venues_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.venues
    ADD CONSTRAINT venues_pkey PRIMARY KEY (id);


--
-- Name: venues venues_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.venues
    ADD CONSTRAINT venues_slug_key UNIQUE (slug);


--
-- Name: forum_posts_forum_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX forum_posts_forum_id_idx ON public.forum_posts USING btree (forum_id);


--
-- Name: idx_audit_log_action; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_log_action ON public.admin_audit_log USING btree (action);


--
-- Name: idx_audit_log_admin_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_log_admin_id ON public.admin_audit_log USING btree (admin_id);


--
-- Name: idx_audit_log_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_log_created_at ON public.admin_audit_log USING btree (created_at DESC);


--
-- Name: idx_beta_reports_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_beta_reports_status ON public.beta_reports USING btree (status, created_at DESC);


--
-- Name: idx_beta_reports_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_beta_reports_user ON public.beta_reports USING btree (user_id, created_at DESC);


--
-- Name: idx_content_reports_post_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_content_reports_post_id ON public.content_reports USING btree (post_id);


--
-- Name: idx_content_reports_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_content_reports_status ON public.content_reports USING btree (status, created_at);


--
-- Name: idx_forum_post_comments_post; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_forum_post_comments_post ON public.forum_post_comments USING btree (post_id, created_at);


--
-- Name: idx_fpred_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fpred_user ON public.fantasy_predictions USING btree (user_id, created_at DESC);


--
-- Name: idx_fpred_week_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fpred_week_status ON public.fantasy_predictions USING btree (week_of, status);


--
-- Name: idx_karaoke_search_cache_age; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_karaoke_search_cache_age ON public.karaoke_search_cache USING btree (created_at);


--
-- Name: idx_lqt_expires_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lqt_expires_at ON public.lane_qr_tokens USING btree (expires_at);


--
-- Name: idx_lqt_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lqt_hash ON public.lane_qr_tokens USING btree (token_hash);


--
-- Name: idx_lqt_lane_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lqt_lane_id ON public.lane_qr_tokens USING btree (lane_id);


--
-- Name: idx_push_tokens_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_push_tokens_user ON public.push_tokens USING btree (user_id);


--
-- Name: idx_rate_limit_user_action_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rate_limit_user_action_time ON public.rate_limit_log USING btree (user_id, action, created_at DESC);


--
-- Name: idx_sec_events_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sec_events_created_at ON public.security_events USING btree (created_at DESC);


--
-- Name: idx_sec_events_severity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sec_events_severity ON public.security_events USING btree (severity);


--
-- Name: idx_sec_events_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sec_events_type ON public.security_events USING btree (event_type);


--
-- Name: idx_sec_events_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sec_events_user_id ON public.security_events USING btree (user_id);


--
-- Name: idx_skeeball_one_active_lane; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_skeeball_one_active_lane ON public.skeeball_sessions USING btree (lane_number) WHERE (status = 'active'::text);


--
-- Name: idx_skeeball_one_active_team; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_skeeball_one_active_team ON public.skeeball_sessions USING btree (team_id) WHERE (status = 'active'::text);


--
-- Name: idx_skeeball_sessions_match_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_skeeball_sessions_match_status ON public.skeeball_sessions USING btree (league_match_id, status);


--
-- Name: idx_square_payment_status_order_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_square_payment_status_order_id ON public.square_payment_statuses USING btree (square_order_id) WHERE (square_order_id IS NOT NULL);


--
-- Name: idx_square_payment_status_payment_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_square_payment_status_payment_id ON public.square_payment_statuses USING btree (square_payment_id) WHERE (square_payment_id IS NOT NULL);


--
-- Name: idx_square_webhook_events_received; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_square_webhook_events_received ON public.square_webhook_events USING btree (received_at DESC);


--
-- Name: idx_square_webhook_events_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_square_webhook_events_type ON public.square_webhook_events USING btree (event_type);


--
-- Name: idx_support_msgs_ticket; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_support_msgs_ticket ON public.support_messages USING btree (ticket_id, created_at);


--
-- Name: idx_support_tickets_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_support_tickets_status ON public.support_tickets USING btree (status);


--
-- Name: idx_support_tickets_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_support_tickets_user ON public.support_tickets USING btree (user_id);


--
-- Name: one_active_session_per_lane; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX one_active_session_per_lane ON public.skeeball_sessions USING btree (lane_number) WHERE (status = 'active'::text);


--
-- Name: post_comments_post_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX post_comments_post_id_idx ON public.post_comments USING btree (post_id);


--
-- Name: profiles_username_lower_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX profiles_username_lower_idx ON public.profiles USING btree (lower(username));


--
-- Name: teams enforce_team_creation_payment_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER enforce_team_creation_payment_trigger BEFORE INSERT ON public.teams FOR EACH ROW EXECUTE FUNCTION public.enforce_team_creation_payment();


--
-- Name: forums flag_forum_content; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER flag_forum_content BEFORE INSERT OR UPDATE OF title, description ON public.forums FOR EACH ROW EXECUTE FUNCTION public.flag_forum_content();


--
-- Name: profiles guard_role_escalation_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER guard_role_escalation_trigger BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.guard_role_escalation();


--
-- Name: posts moderate_post_content; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER moderate_post_content BEFORE INSERT OR UPDATE OF content ON public.posts FOR EACH ROW EXECUTE FUNCTION public.enforce_content_moderation();


--
-- Name: profiles moderate_profile; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER moderate_profile BEFORE INSERT OR UPDATE OF username, bio ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.enforce_content_moderation();


--
-- Name: team_announcements moderate_team_announcement; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER moderate_team_announcement BEFORE INSERT OR UPDATE OF content ON public.team_announcements FOR EACH ROW EXECUTE FUNCTION public.enforce_content_moderation();


--
-- Name: team_messages moderate_team_message; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER moderate_team_message BEFORE INSERT OR UPDATE OF content ON public.team_messages FOR EACH ROW EXECUTE FUNCTION public.enforce_content_moderation();


--
-- Name: skeeball_sessions sync_skeeball_lane_status_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER sync_skeeball_lane_status_trigger AFTER INSERT OR UPDATE OF status ON public.skeeball_sessions FOR EACH ROW EXECUTE FUNCTION public.sync_skeeball_lane_status();


--
-- Name: profiles trig_enforce_equipped_title; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trig_enforce_equipped_title BEFORE UPDATE OF equipped_title ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.enforce_equipped_title();


--
-- Name: profiles trig_grant_beta_founder; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trig_grant_beta_founder AFTER INSERT ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.grant_beta_founder();


--
-- Name: posts trig_queue_post_photo_cleanup; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trig_queue_post_photo_cleanup AFTER DELETE ON public.posts FOR EACH ROW EXECUTE FUNCTION public.queue_post_photo_cleanup();


--
-- Name: scores trig_queue_score_proof_cleanup; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trig_queue_score_proof_cleanup AFTER UPDATE ON public.scores FOR EACH ROW EXECUTE FUNCTION public.queue_score_proof_cleanup();


--
-- Name: scores validate_score_check_in_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER validate_score_check_in_trigger BEFORE INSERT ON public.scores FOR EACH ROW EXECUTE FUNCTION public.validate_score_check_in();


--
-- Name: admin_audit_log admin_audit_log_admin_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_audit_log
    ADD CONSTRAINT admin_audit_log_admin_id_fkey FOREIGN KEY (admin_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: app_announcements app_announcements_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_announcements
    ADD CONSTRAINT app_announcements_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: beta_reports beta_reports_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.beta_reports
    ADD CONSTRAINT beta_reports_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: bug_reports bug_reports_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bug_reports
    ADD CONSTRAINT bug_reports_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: check_ins check_ins_lane_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.check_ins
    ADD CONSTRAINT check_ins_lane_id_fkey FOREIGN KEY (lane_id) REFERENCES public.lanes(id);


--
-- Name: check_ins check_ins_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.check_ins
    ADD CONSTRAINT check_ins_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id);


--
-- Name: check_ins check_ins_venue_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.check_ins
    ADD CONSTRAINT check_ins_venue_id_fkey FOREIGN KEY (venue_id) REFERENCES public.venues(id);


--
-- Name: content_reports content_reports_post_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_reports
    ADD CONSTRAINT content_reports_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.posts(id) ON DELETE CASCADE;


--
-- Name: content_reports content_reports_reporter_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_reports
    ADD CONSTRAINT content_reports_reporter_id_fkey FOREIGN KEY (reporter_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: content_reports content_reports_reviewed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_reports
    ADD CONSTRAINT content_reports_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES public.profiles(id);


--
-- Name: conversations conversations_participant_1_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_participant_1_fkey FOREIGN KEY (participant_1) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: conversations conversations_participant_2_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_participant_2_fkey FOREIGN KEY (participant_2) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: event_rsvps event_rsvps_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_rsvps
    ADD CONSTRAINT event_rsvps_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.venue_events(id) ON DELETE CASCADE;


--
-- Name: event_rsvps event_rsvps_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_rsvps
    ADD CONSTRAINT event_rsvps_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: fantasy_predictions fantasy_predictions_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fantasy_predictions
    ADD CONSTRAINT fantasy_predictions_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE;


--
-- Name: fantasy_predictions fantasy_predictions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fantasy_predictions
    ADD CONSTRAINT fantasy_predictions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: fantasy_roster_players fantasy_roster_players_player_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fantasy_roster_players
    ADD CONSTRAINT fantasy_roster_players_player_user_id_fkey FOREIGN KEY (player_user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: fantasy_roster_players fantasy_roster_players_roster_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fantasy_roster_players
    ADD CONSTRAINT fantasy_roster_players_roster_id_fkey FOREIGN KEY (roster_id) REFERENCES public.fantasy_rosters(id) ON DELETE CASCADE;


--
-- Name: fantasy_rosters fantasy_rosters_season_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fantasy_rosters
    ADD CONSTRAINT fantasy_rosters_season_id_fkey FOREIGN KEY (season_id) REFERENCES public.skeeball_seasons(id) ON DELETE SET NULL;


--
-- Name: fantasy_rosters fantasy_rosters_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fantasy_rosters
    ADD CONSTRAINT fantasy_rosters_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: fantasy_transfers fantasy_transfers_player_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fantasy_transfers
    ADD CONSTRAINT fantasy_transfers_player_user_id_fkey FOREIGN KEY (player_user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: fantasy_transfers fantasy_transfers_roster_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fantasy_transfers
    ADD CONSTRAINT fantasy_transfers_roster_id_fkey FOREIGN KEY (roster_id) REFERENCES public.fantasy_rosters(id) ON DELETE CASCADE;


--
-- Name: fantasy_wallets fantasy_wallets_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fantasy_wallets
    ADD CONSTRAINT fantasy_wallets_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: feedback_submissions feedback_submissions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feedback_submissions
    ADD CONSTRAINT feedback_submissions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: ff_bracket_games ff_bracket_games_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ff_bracket_games
    ADD CONSTRAINT ff_bracket_games_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.ff_bracket_groups(id) ON DELETE CASCADE;


--
-- Name: ff_bracket_games ff_bracket_games_tournament_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ff_bracket_games
    ADD CONSTRAINT ff_bracket_games_tournament_id_fkey FOREIGN KEY (tournament_id) REFERENCES public.tournaments(id) ON DELETE CASCADE;


--
-- Name: ff_bracket_groups ff_bracket_groups_round_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ff_bracket_groups
    ADD CONSTRAINT ff_bracket_groups_round_id_fkey FOREIGN KEY (round_id) REFERENCES public.ff_bracket_rounds(id) ON DELETE CASCADE;


--
-- Name: ff_bracket_groups ff_bracket_groups_tournament_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ff_bracket_groups
    ADD CONSTRAINT ff_bracket_groups_tournament_id_fkey FOREIGN KEY (tournament_id) REFERENCES public.tournaments(id) ON DELETE CASCADE;


--
-- Name: ff_bracket_rounds ff_bracket_rounds_tournament_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ff_bracket_rounds
    ADD CONSTRAINT ff_bracket_rounds_tournament_id_fkey FOREIGN KEY (tournament_id) REFERENCES public.tournaments(id) ON DELETE CASCADE;


--
-- Name: ff_bracket_scores ff_bracket_scores_game_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ff_bracket_scores
    ADD CONSTRAINT ff_bracket_scores_game_id_fkey FOREIGN KEY (game_id) REFERENCES public.ff_bracket_games(id) ON DELETE CASCADE;


--
-- Name: ff_bracket_scores ff_bracket_scores_tournament_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ff_bracket_scores
    ADD CONSTRAINT ff_bracket_scores_tournament_id_fkey FOREIGN KEY (tournament_id) REFERENCES public.tournaments(id) ON DELETE CASCADE;


--
-- Name: ff_bracket_slots ff_bracket_slots_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ff_bracket_slots
    ADD CONSTRAINT ff_bracket_slots_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.ff_bracket_groups(id) ON DELETE CASCADE;


--
-- Name: ff_bracket_slots ff_bracket_slots_tournament_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ff_bracket_slots
    ADD CONSTRAINT ff_bracket_slots_tournament_id_fkey FOREIGN KEY (tournament_id) REFERENCES public.tournaments(id) ON DELETE CASCADE;


--
-- Name: follows follows_follower_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.follows
    ADD CONSTRAINT follows_follower_id_fkey FOREIGN KEY (follower_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: follows follows_following_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.follows
    ADD CONSTRAINT follows_following_id_fkey FOREIGN KEY (following_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: forum_poll_votes forum_poll_votes_poll_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.forum_poll_votes
    ADD CONSTRAINT forum_poll_votes_poll_id_fkey FOREIGN KEY (poll_id) REFERENCES public.forum_polls(id) ON DELETE CASCADE;


--
-- Name: forum_poll_votes forum_poll_votes_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.forum_poll_votes
    ADD CONSTRAINT forum_poll_votes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: forum_polls forum_polls_post_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.forum_polls
    ADD CONSTRAINT forum_polls_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.forum_posts(id) ON DELETE CASCADE;


--
-- Name: forum_post_comments forum_post_comments_post_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.forum_post_comments
    ADD CONSTRAINT forum_post_comments_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.forum_posts(id) ON DELETE CASCADE;


--
-- Name: forum_post_comments forum_post_comments_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.forum_post_comments
    ADD CONSTRAINT forum_post_comments_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: forum_posts forum_posts_forum_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.forum_posts
    ADD CONSTRAINT forum_posts_forum_id_fkey FOREIGN KEY (forum_id) REFERENCES public.forums(id) ON DELETE CASCADE;


--
-- Name: forum_posts forum_posts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.forum_posts
    ADD CONSTRAINT forum_posts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: forums forums_creator_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.forums
    ADD CONSTRAINT forums_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: friendships friendships_addressee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.friendships
    ADD CONSTRAINT friendships_addressee_id_fkey FOREIGN KEY (addressee_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: friendships friendships_requester_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.friendships
    ADD CONSTRAINT friendships_requester_id_fkey FOREIGN KEY (requester_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: game_reference_photos game_reference_photos_game_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_reference_photos
    ADD CONSTRAINT game_reference_photos_game_id_fkey FOREIGN KEY (game_id) REFERENCES public.games(id) ON DELETE CASCADE;


--
-- Name: game_reference_photos game_reference_photos_uploaded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_reference_photos
    ADD CONSTRAINT game_reference_photos_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: karaoke_queue karaoke_queue_requested_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.karaoke_queue
    ADD CONSTRAINT karaoke_queue_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: lane_qr_tokens lane_qr_tokens_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lane_qr_tokens
    ADD CONSTRAINT lane_qr_tokens_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: lane_qr_tokens lane_qr_tokens_lane_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lane_qr_tokens
    ADD CONSTRAINT lane_qr_tokens_lane_id_fkey FOREIGN KEY (lane_id) REFERENCES public.lanes(id) ON DELETE CASCADE;


--
-- Name: lane_qr_tokens lane_qr_tokens_venue_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lane_qr_tokens
    ADD CONSTRAINT lane_qr_tokens_venue_id_fkey FOREIGN KEY (venue_id) REFERENCES public.venues(id) ON DELETE CASCADE;


--
-- Name: lanes lanes_game_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lanes
    ADD CONSTRAINT lanes_game_id_fkey FOREIGN KEY (game_id) REFERENCES public.games(id);


--
-- Name: lanes lanes_venue_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lanes
    ADD CONSTRAINT lanes_venue_id_fkey FOREIGN KEY (venue_id) REFERENCES public.venues(id) ON DELETE CASCADE;


--
-- Name: league_rsvps league_rsvps_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.league_rsvps
    ADD CONSTRAINT league_rsvps_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE;


--
-- Name: league_rsvps league_rsvps_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.league_rsvps
    ADD CONSTRAINT league_rsvps_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: league_teams league_teams_season_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.league_teams
    ADD CONSTRAINT league_teams_season_id_fkey FOREIGN KEY (season_id) REFERENCES public.seasons(id);


--
-- Name: league_teams league_teams_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.league_teams
    ADD CONSTRAINT league_teams_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id);


--
-- Name: matches matches_season_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.matches
    ADD CONSTRAINT matches_season_id_fkey FOREIGN KEY (season_id) REFERENCES public.seasons(id) ON DELETE CASCADE;


--
-- Name: matches matches_team_a_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.matches
    ADD CONSTRAINT matches_team_a_id_fkey FOREIGN KEY (team_a_id) REFERENCES public.teams(id);


--
-- Name: matches matches_team_b_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.matches
    ADD CONSTRAINT matches_team_b_id_fkey FOREIGN KEY (team_b_id) REFERENCES public.teams(id);


--
-- Name: messages messages_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;


--
-- Name: messages messages_sender_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: pickem_picks pickem_picks_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pickem_picks
    ADD CONSTRAINT pickem_picks_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE;


--
-- Name: pickem_picks pickem_picks_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pickem_picks
    ADD CONSTRAINT pickem_picks_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: post_comments post_comments_post_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.post_comments
    ADD CONSTRAINT post_comments_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.posts(id) ON DELETE CASCADE;


--
-- Name: post_comments post_comments_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.post_comments
    ADD CONSTRAINT post_comments_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: post_likes post_likes_post_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.post_likes
    ADD CONSTRAINT post_likes_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.posts(id) ON DELETE CASCADE;


--
-- Name: post_likes post_likes_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.post_likes
    ADD CONSTRAINT post_likes_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: post_reactions post_reactions_post_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.post_reactions
    ADD CONSTRAINT post_reactions_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.posts(id) ON DELETE CASCADE;


--
-- Name: post_reactions post_reactions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.post_reactions
    ADD CONSTRAINT post_reactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: posts posts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.posts
    ADD CONSTRAINT posts_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: profiles profiles_featured_game_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_featured_game_id_fkey FOREIGN KEY (featured_game_id) REFERENCES public.games(id);


--
-- Name: profiles profiles_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: push_tokens push_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_tokens
    ADD CONSTRAINT push_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: rate_limit_log rate_limit_log_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rate_limit_log
    ADD CONSTRAINT rate_limit_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: saved_posts saved_posts_post_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.saved_posts
    ADD CONSTRAINT saved_posts_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.posts(id) ON DELETE CASCADE;


--
-- Name: saved_posts saved_posts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.saved_posts
    ADD CONSTRAINT saved_posts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: score_corrections score_corrections_changed_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.score_corrections
    ADD CONSTRAINT score_corrections_changed_by_user_id_fkey FOREIGN KEY (changed_by_user_id) REFERENCES public.profiles(id);


--
-- Name: score_disputes score_disputes_raised_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.score_disputes
    ADD CONSTRAINT score_disputes_raised_by_fkey FOREIGN KEY (raised_by) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: score_disputes score_disputes_resolved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.score_disputes
    ADD CONSTRAINT score_disputes_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES public.profiles(id);


--
-- Name: score_disputes score_disputes_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.score_disputes
    ADD CONSTRAINT score_disputes_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.skeeball_sessions(id) ON DELETE CASCADE;


--
-- Name: score_disputes score_disputes_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.score_disputes
    ADD CONSTRAINT score_disputes_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE;


--
-- Name: scores scores_check_in_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scores
    ADD CONSTRAINT scores_check_in_id_fkey FOREIGN KEY (check_in_id) REFERENCES public.check_ins(id);


--
-- Name: scores scores_game_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scores
    ADD CONSTRAINT scores_game_id_fkey FOREIGN KEY (game_id) REFERENCES public.games(id);


--
-- Name: scores scores_lane_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scores
    ADD CONSTRAINT scores_lane_id_fkey FOREIGN KEY (lane_id) REFERENCES public.lanes(id);


--
-- Name: scores scores_season_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scores
    ADD CONSTRAINT scores_season_id_fkey FOREIGN KEY (season_id) REFERENCES public.seasons(id);


--
-- Name: scores scores_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scores
    ADD CONSTRAINT scores_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id);


--
-- Name: security_events security_events_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.security_events
    ADD CONSTRAINT security_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: skeeball_ball_scores skeeball_ball_scores_player_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skeeball_ball_scores
    ADD CONSTRAINT skeeball_ball_scores_player_user_id_fkey FOREIGN KEY (player_user_id) REFERENCES auth.users(id);


--
-- Name: skeeball_ball_scores skeeball_ball_scores_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skeeball_ball_scores
    ADD CONSTRAINT skeeball_ball_scores_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.skeeball_sessions(id) ON DELETE CASCADE;


--
-- Name: skeeball_seasons skeeball_seasons_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skeeball_seasons
    ADD CONSTRAINT skeeball_seasons_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: skeeball_session_players skeeball_session_players_player_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skeeball_session_players
    ADD CONSTRAINT skeeball_session_players_player_user_id_fkey FOREIGN KEY (player_user_id) REFERENCES auth.users(id);


--
-- Name: skeeball_session_players skeeball_session_players_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skeeball_session_players
    ADD CONSTRAINT skeeball_session_players_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.skeeball_sessions(id) ON DELETE CASCADE;


--
-- Name: skeeball_sessions skeeball_sessions_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skeeball_sessions
    ADD CONSTRAINT skeeball_sessions_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);


--
-- Name: skeeball_sessions skeeball_sessions_league_match_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skeeball_sessions
    ADD CONSTRAINT skeeball_sessions_league_match_id_fkey FOREIGN KEY (league_match_id) REFERENCES public.skeeball_league_matches(id);


--
-- Name: skeeball_sessions skeeball_sessions_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skeeball_sessions
    ADD CONSTRAINT skeeball_sessions_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE;


--
-- Name: sub_requests sub_requests_filled_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sub_requests
    ADD CONSTRAINT sub_requests_filled_by_fkey FOREIGN KEY (filled_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: sub_requests sub_requests_requested_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sub_requests
    ADD CONSTRAINT sub_requests_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: sub_requests sub_requests_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sub_requests
    ADD CONSTRAINT sub_requests_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE;


--
-- Name: support_messages support_messages_sender_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_messages
    ADD CONSTRAINT support_messages_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: support_messages support_messages_ticket_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_messages
    ADD CONSTRAINT support_messages_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES public.support_tickets(id) ON DELETE CASCADE;


--
-- Name: support_tickets support_tickets_resolved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_tickets
    ADD CONSTRAINT support_tickets_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: support_tickets support_tickets_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_tickets
    ADD CONSTRAINT support_tickets_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: team_announcements team_announcements_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_announcements
    ADD CONSTRAINT team_announcements_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE;


--
-- Name: team_announcements team_announcements_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_announcements
    ADD CONSTRAINT team_announcements_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: team_bans team_bans_banned_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_bans
    ADD CONSTRAINT team_bans_banned_by_fkey FOREIGN KEY (banned_by) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: team_bans team_bans_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_bans
    ADD CONSTRAINT team_bans_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE;


--
-- Name: team_bans team_bans_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_bans
    ADD CONSTRAINT team_bans_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: team_members team_members_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_members
    ADD CONSTRAINT team_members_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE;


--
-- Name: team_members team_members_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_members
    ADD CONSTRAINT team_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: team_messages team_messages_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_messages
    ADD CONSTRAINT team_messages_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE;


--
-- Name: team_messages team_messages_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_messages
    ADD CONSTRAINT team_messages_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: team_registrations team_registrations_season_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_registrations
    ADD CONSTRAINT team_registrations_season_id_fkey FOREIGN KEY (season_id) REFERENCES public.seasons(id) ON DELETE CASCADE;


--
-- Name: team_registrations team_registrations_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_registrations
    ADD CONSTRAINT team_registrations_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE SET NULL;


--
-- Name: team_registrations team_registrations_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_registrations
    ADD CONSTRAINT team_registrations_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: team_requests team_requests_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_requests
    ADD CONSTRAINT team_requests_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE;


--
-- Name: team_requests team_requests_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_requests
    ADD CONSTRAINT team_requests_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: team_schedule team_schedule_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_schedule
    ADD CONSTRAINT team_schedule_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE;


--
-- Name: teams teams_captain_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teams
    ADD CONSTRAINT teams_captain_user_id_fkey FOREIGN KEY (captain_user_id) REFERENCES public.profiles(id);


--
-- Name: teams teams_season_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teams
    ADD CONSTRAINT teams_season_id_fkey FOREIGN KEY (season_id) REFERENCES public.seasons(id) ON DELETE CASCADE;


--
-- Name: teams teams_venue_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teams
    ADD CONSTRAINT teams_venue_id_fkey FOREIGN KEY (venue_id) REFERENCES public.venues(id) ON DELETE SET NULL;


--
-- Name: tournament_placements tournament_placements_tournament_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tournament_placements
    ADD CONSTRAINT tournament_placements_tournament_id_fkey FOREIGN KEY (tournament_id) REFERENCES public.tournaments(id) ON DELETE CASCADE;


--
-- Name: tournament_registrations tournament_registrations_tournament_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tournament_registrations
    ADD CONSTRAINT tournament_registrations_tournament_id_fkey FOREIGN KEY (tournament_id) REFERENCES public.tournaments(id) ON DELETE CASCADE;


--
-- Name: tournament_registrations tournament_registrations_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tournament_registrations
    ADD CONSTRAINT tournament_registrations_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: tournament_requests tournament_requests_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tournament_requests
    ADD CONSTRAINT tournament_requests_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: tournament_requests tournament_requests_venue_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tournament_requests
    ADD CONSTRAINT tournament_requests_venue_id_fkey FOREIGN KEY (venue_id) REFERENCES public.venues(id) ON DELETE SET NULL;


--
-- Name: tournament_results tournament_results_tournament_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tournament_results
    ADD CONSTRAINT tournament_results_tournament_id_fkey FOREIGN KEY (tournament_id) REFERENCES public.tournaments(id) ON DELETE CASCADE;


--
-- Name: tournament_results tournament_results_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tournament_results
    ADD CONSTRAINT tournament_results_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: tournaments tournaments_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tournaments
    ADD CONSTRAINT tournaments_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: tournaments tournaments_venue_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tournaments
    ADD CONSTRAINT tournaments_venue_id_fkey FOREIGN KEY (venue_id) REFERENCES public.venues(id) ON DELETE SET NULL;


--
-- Name: trivia_answers trivia_answers_game_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trivia_answers
    ADD CONSTRAINT trivia_answers_game_id_fkey FOREIGN KEY (game_id) REFERENCES public.trivia_games(id) ON DELETE CASCADE;


--
-- Name: trivia_answers trivia_answers_participant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trivia_answers
    ADD CONSTRAINT trivia_answers_participant_id_fkey FOREIGN KEY (participant_id) REFERENCES public.trivia_participants(id) ON DELETE CASCADE;


--
-- Name: trivia_answers trivia_answers_question_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trivia_answers
    ADD CONSTRAINT trivia_answers_question_id_fkey FOREIGN KEY (question_id) REFERENCES public.trivia_questions(id) ON DELETE CASCADE;


--
-- Name: trivia_events trivia_events_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trivia_events
    ADD CONSTRAINT trivia_events_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: trivia_game_questions trivia_game_questions_game_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trivia_game_questions
    ADD CONSTRAINT trivia_game_questions_game_id_fkey FOREIGN KEY (game_id) REFERENCES public.trivia_games(id) ON DELETE CASCADE;


--
-- Name: trivia_game_questions trivia_game_questions_question_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trivia_game_questions
    ADD CONSTRAINT trivia_game_questions_question_id_fkey FOREIGN KEY (question_id) REFERENCES public.trivia_questions(id) ON DELETE CASCADE;


--
-- Name: trivia_games trivia_games_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trivia_games
    ADD CONSTRAINT trivia_games_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: trivia_games trivia_games_current_question_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trivia_games
    ADD CONSTRAINT trivia_games_current_question_id_fkey FOREIGN KEY (current_question_id) REFERENCES public.trivia_questions(id) ON DELETE SET NULL;


--
-- Name: trivia_participants trivia_participants_game_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trivia_participants
    ADD CONSTRAINT trivia_participants_game_id_fkey FOREIGN KEY (game_id) REFERENCES public.trivia_games(id) ON DELETE CASCADE;


--
-- Name: trivia_participants trivia_participants_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trivia_participants
    ADD CONSTRAINT trivia_participants_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE;


--
-- Name: trivia_participants trivia_participants_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trivia_participants
    ADD CONSTRAINT trivia_participants_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: trivia_questions trivia_questions_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trivia_questions
    ADD CONSTRAINT trivia_questions_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: trivia_team_members trivia_team_members_trivia_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trivia_team_members
    ADD CONSTRAINT trivia_team_members_trivia_team_id_fkey FOREIGN KEY (trivia_team_id) REFERENCES public.trivia_teams(id) ON DELETE CASCADE;


--
-- Name: trivia_team_members trivia_team_members_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trivia_team_members
    ADD CONSTRAINT trivia_team_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: trivia_teams trivia_teams_captain_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trivia_teams
    ADD CONSTRAINT trivia_teams_captain_user_id_fkey FOREIGN KEY (captain_user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: trivia_teams trivia_teams_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trivia_teams
    ADD CONSTRAINT trivia_teams_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.trivia_events(id) ON DELETE CASCADE;


--
-- Name: user_blocks user_blocks_blocked_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_blocks
    ADD CONSTRAINT user_blocks_blocked_id_fkey FOREIGN KEY (blocked_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: user_blocks user_blocks_blocker_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_blocks
    ADD CONSTRAINT user_blocks_blocker_id_fkey FOREIGN KEY (blocker_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: user_public_keys user_public_keys_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_public_keys
    ADD CONSTRAINT user_public_keys_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: user_titles user_titles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_titles
    ADD CONSTRAINT user_titles_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: venue_admins venue_admins_granted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.venue_admins
    ADD CONSTRAINT venue_admins_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: venue_admins venue_admins_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.venue_admins
    ADD CONSTRAINT venue_admins_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: venue_events venue_events_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.venue_events
    ADD CONSTRAINT venue_events_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: team_schedule Admin full access on team_schedule; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin full access on team_schedule" ON public.team_schedule USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['admin'::text, 'owner'::text, 'architect'::text]))))));


--
-- Name: forums Admin update forum; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin update forum" ON public.forums FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['admin'::text, 'owner'::text, 'architect'::text]))))));


--
-- Name: support_tickets Admin updates ticket; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin updates ticket" ON public.support_tickets FOR UPDATE USING ((public.is_admin() OR (EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['owner'::text, 'architect'::text])))))));


--
-- Name: posts Admins and officials can delete any post; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins and officials can delete any post" ON public.posts FOR DELETE USING (public.is_arcade_official());


--
-- Name: tournaments Admins can insert tournaments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can insert tournaments" ON public.tournaments FOR INSERT WITH CHECK (public.is_admin());


--
-- Name: games Admins can manage games; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage games" ON public.games USING (public.is_admin()) WITH CHECK (public.is_admin());


--
-- Name: lanes Admins can manage lanes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage lanes" ON public.lanes USING (public.is_admin()) WITH CHECK (public.is_admin());


--
-- Name: tournament_placements Admins can manage placements; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage placements" ON public.tournament_placements USING (public.is_admin()) WITH CHECK (public.is_admin());


--
-- Name: trivia_events Admins can manage trivia events; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage trivia events" ON public.trivia_events USING (public.is_admin()) WITH CHECK (public.is_admin());


--
-- Name: profiles Admins can read all profiles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can read all profiles" ON public.profiles FOR SELECT USING (public.is_admin());


--
-- Name: scores Admins can read all scores; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can read all scores" ON public.scores FOR SELECT USING (public.is_admin());


--
-- Name: admin_audit_log Admins can read audit log; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can read audit log" ON public.admin_audit_log FOR SELECT USING (public.is_admin());


--
-- Name: scores Admins can review scores; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can review scores" ON public.scores FOR UPDATE USING (public.is_admin());


--
-- Name: profiles Admins can update any profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can update any profile" ON public.profiles FOR UPDATE USING (public.is_admin());


--
-- Name: tournaments Admins can update any tournament; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can update any tournament" ON public.tournaments FOR UPDATE USING (public.is_admin());


--
-- Name: tournament_requests Admins can update tournament requests; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can update tournament requests" ON public.tournament_requests FOR UPDATE USING (public.is_admin());


--
-- Name: moderation_patterns Admins manage moderation_patterns; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins manage moderation_patterns" ON public.moderation_patterns USING (public.is_admin()) WITH CHECK (public.is_admin());


--
-- Name: venue_admins Admins manage venue_admins; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins manage venue_admins" ON public.venue_admins USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());


--
-- Name: feedback_submissions Admins read feedback; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins read feedback" ON public.feedback_submissions FOR SELECT USING (public.is_admin());


--
-- Name: lane_qr_tokens Admins read lane_qr_tokens; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins read lane_qr_tokens" ON public.lane_qr_tokens FOR SELECT USING ((public.is_admin() OR public.is_venue_admin(venue_id)));


--
-- Name: security_events Admins read security_events; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins read security_events" ON public.security_events FOR SELECT USING (public.is_admin());


--
-- Name: square_payment_statuses Admins read square payment statuses; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins read square payment statuses" ON public.square_payment_statuses FOR SELECT USING (public.is_admin());


--
-- Name: square_webhook_events Admins read square webhook events; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins read square webhook events" ON public.square_webhook_events FOR SELECT USING (public.is_admin());


--
-- Name: venue_admins Admins read venue_admins; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins read venue_admins" ON public.venue_admins FOR SELECT USING ((public.is_platform_admin() OR public.is_venue_owner(venue_id) OR (user_id = auth.uid())));


--
-- Name: feedback_submissions Admins update feedback status; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins update feedback status" ON public.feedback_submissions FOR UPDATE USING (public.is_admin()) WITH CHECK (public.is_admin());


--
-- Name: menu_items Anyone can read menu items; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone can read menu items" ON public.menu_items FOR SELECT USING (true);


--
-- Name: ff_bracket_games Auth read bracket games; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Auth read bracket games" ON public.ff_bracket_games FOR SELECT USING ((auth.role() = 'authenticated'::text));


--
-- Name: ff_bracket_groups Auth read bracket groups; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Auth read bracket groups" ON public.ff_bracket_groups FOR SELECT USING ((auth.role() = 'authenticated'::text));


--
-- Name: ff_bracket_rounds Auth read bracket rounds; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Auth read bracket rounds" ON public.ff_bracket_rounds FOR SELECT USING ((auth.role() = 'authenticated'::text));


--
-- Name: ff_bracket_scores Auth read bracket scores; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Auth read bracket scores" ON public.ff_bracket_scores FOR SELECT USING ((auth.role() = 'authenticated'::text));


--
-- Name: ff_bracket_slots Auth read bracket slots; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Auth read bracket slots" ON public.ff_bracket_slots FOR SELECT USING ((auth.role() = 'authenticated'::text));


--
-- Name: follows Auth users can read follows; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Auth users can read follows" ON public.follows FOR SELECT USING ((auth.role() = 'authenticated'::text));


--
-- Name: games Auth users can read games; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Auth users can read games" ON public.games FOR SELECT USING ((auth.role() = 'authenticated'::text));


--
-- Name: lanes Auth users can read lanes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Auth users can read lanes" ON public.lanes FOR SELECT USING ((auth.role() = 'authenticated'::text));


--
-- Name: post_likes Auth users can read likes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Auth users can read likes" ON public.post_likes FOR SELECT USING ((auth.role() = 'authenticated'::text));


--
-- Name: tournament_placements Auth users can read placements; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Auth users can read placements" ON public.tournament_placements FOR SELECT USING ((auth.role() = 'authenticated'::text));


--
-- Name: posts Auth users can read posts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Auth users can read posts" ON public.posts FOR SELECT USING ((auth.role() = 'authenticated'::text));


--
-- Name: scores Auth users can read scores; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Auth users can read scores" ON public.scores FOR SELECT USING ((auth.role() = 'authenticated'::text));


--
-- Name: team_members Auth users can read team members; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Auth users can read team members" ON public.team_members FOR SELECT USING ((auth.role() = 'authenticated'::text));


--
-- Name: teams Auth users can read teams; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Auth users can read teams" ON public.teams FOR SELECT USING ((auth.role() = 'authenticated'::text));


--
-- Name: tournaments Auth users can read tournaments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Auth users can read tournaments" ON public.tournaments FOR SELECT USING ((auth.role() = 'authenticated'::text));


--
-- Name: trivia_events Auth users can read trivia events; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Auth users can read trivia events" ON public.trivia_events FOR SELECT USING ((auth.role() = 'authenticated'::text));


--
-- Name: trivia_team_members Auth users can read trivia members; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Auth users can read trivia members" ON public.trivia_team_members FOR SELECT USING ((auth.role() = 'authenticated'::text));


--
-- Name: trivia_teams Auth users can read trivia teams; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Auth users can read trivia teams" ON public.trivia_teams FOR SELECT USING ((auth.role() = 'authenticated'::text));


--
-- Name: moderation_patterns Auth users read moderation_patterns; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Auth users read moderation_patterns" ON public.moderation_patterns FOR SELECT USING ((auth.role() = 'authenticated'::text));


--
-- Name: matches Authenticated users can read matches; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can read matches" ON public.matches FOR SELECT TO authenticated USING (true);


--
-- Name: posts Authenticated users can read posts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can read posts" ON public.posts FOR SELECT TO authenticated USING (true);


--
-- Name: seasons Authenticated users can read seasons; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can read seasons" ON public.seasons FOR SELECT TO authenticated USING (true);


--
-- Name: team_members Authenticated users can read team members; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can read team members" ON public.team_members FOR SELECT TO authenticated USING (true);


--
-- Name: teams Authenticated users can read teams; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can read teams" ON public.teams FOR SELECT TO authenticated USING (true);


--
-- Name: team_announcements Captain can post announcements; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Captain can post announcements" ON public.team_announcements FOR INSERT WITH CHECK (((user_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.team_members
  WHERE ((team_members.team_id = team_announcements.team_id) AND (team_members.user_id = auth.uid()) AND (team_members.role = 'captain'::text))))));


--
-- Name: team_requests Captains and invitees can update requests; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Captains and invitees can update requests" ON public.team_requests FOR UPDATE USING ((((direction = 'request'::text) AND (auth.uid() = ( SELECT teams.captain_user_id
   FROM public.teams
  WHERE (teams.id = team_requests.team_id)))) OR ((direction = 'invite'::text) AND (auth.uid() = user_id)) OR public.is_admin()));


--
-- Name: team_members Captains can add members to their teams; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Captains can add members to their teams" ON public.team_members FOR INSERT TO authenticated WITH CHECK ((team_id IN ( SELECT teams.id
   FROM public.teams
  WHERE (teams.captain_user_id = auth.uid()))));


--
-- Name: team_requests Captains can send invites; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Captains can send invites" ON public.team_requests FOR INSERT WITH CHECK (((auth.uid() = ( SELECT teams.captain_user_id
   FROM public.teams
  WHERE (teams.id = team_requests.team_id))) AND (direction = 'invite'::text) AND (status = 'pending'::text)));


--
-- Name: team_requests Captains can update requests for their teams; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Captains can update requests for their teams" ON public.team_requests FOR UPDATE TO authenticated USING ((team_id IN ( SELECT teams.id
   FROM public.teams
  WHERE (teams.captain_user_id = auth.uid()))));


--
-- Name: teams Captains can update their team; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Captains can update their team" ON public.teams FOR UPDATE USING ((auth.uid() = captain_user_id));


--
-- Name: trivia_teams Captains can update trivia teams; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Captains can update trivia teams" ON public.trivia_teams FOR UPDATE USING ((auth.uid() = captain_user_id));


--
-- Name: team_requests Captains can view requests for their teams; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Captains can view requests for their teams" ON public.team_requests FOR SELECT TO authenticated USING ((team_id IN ( SELECT teams.id
   FROM public.teams
  WHERE (teams.captain_user_id = auth.uid()))));


--
-- Name: teams Captains or admins can delete teams; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Captains or admins can delete teams" ON public.teams FOR DELETE USING (((auth.uid() = captain_user_id) OR public.is_admin()));


--
-- Name: trivia_teams Captains or admins can delete trivia teams; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Captains or admins can delete trivia teams" ON public.trivia_teams FOR DELETE USING (((auth.uid() = captain_user_id) OR public.is_admin()));


--
-- Name: forums Create forum; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Create forum" ON public.forums FOR INSERT WITH CHECK ((auth.uid() = creator_id));


--
-- Name: post_comments Delete own comments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Delete own comments" ON public.post_comments FOR DELETE USING ((auth.uid() = user_id));


--
-- Name: forum_posts Delete own forum post; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Delete own forum post" ON public.forum_posts FOR DELETE USING ((auth.uid() = user_id));


--
-- Name: post_comments Insert own comments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Insert own comments" ON public.post_comments FOR INSERT WITH CHECK ((auth.uid() = user_id));


--
-- Name: support_messages Insert support message; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Insert support message" ON public.support_messages FOR INSERT WITH CHECK (((sender_id = auth.uid()) AND ((EXISTS ( SELECT 1
   FROM public.support_tickets
  WHERE ((support_tickets.id = support_messages.ticket_id) AND (support_tickets.user_id = auth.uid())))) OR public.is_admin() OR (EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['owner'::text, 'architect'::text]))))))));


--
-- Name: storage_cleanup_queue No direct access storage_cleanup_queue; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "No direct access storage_cleanup_queue" ON public.storage_cleanup_queue USING (false);


--
-- Name: rate_limit_log No direct access to rate_limit_log; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "No direct access to rate_limit_log" ON public.rate_limit_log USING (false);


--
-- Name: check_ins No direct insert check_ins; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "No direct insert check_ins" ON public.check_ins FOR INSERT WITH CHECK (false);


--
-- Name: square_payment_statuses No direct square payment status writes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "No direct square payment status writes" ON public.square_payment_statuses USING (false) WITH CHECK (false);


--
-- Name: square_webhook_events No direct square webhook writes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "No direct square webhook writes" ON public.square_webhook_events USING (false) WITH CHECK (false);


--
-- Name: lane_qr_tokens No direct write lane_qr_tokens; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "No direct write lane_qr_tokens" ON public.lane_qr_tokens USING (false);


--
-- Name: security_events No direct write security_events; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "No direct write security_events" ON public.security_events USING (false);


--
-- Name: tournament_registrations Owners and admins can update registration status; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Owners and admins can update registration status" ON public.tournament_registrations FOR UPDATE USING ((public.is_admin() OR (auth.uid() = ( SELECT tournaments.created_by
   FROM public.tournaments
  WHERE (tournaments.id = tournament_registrations.tournament_id)))));


--
-- Name: tournaments Owners can update announcement or cancel; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Owners can update announcement or cancel" ON public.tournaments FOR UPDATE USING (((auth.uid() = created_by) AND (status = ANY (ARRAY['upcoming'::text, 'active'::text])))) WITH CHECK (((auth.uid() = created_by) AND (status = ANY (ARRAY['upcoming'::text, 'active'::text, 'cancelled'::text]))));


--
-- Name: skeeball_ball_scores Players submit own balls; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Players submit own balls" ON public.skeeball_ball_scores FOR INSERT TO authenticated WITH CHECK (((auth.uid() = player_user_id) AND (EXISTS ( SELECT 1
   FROM public.skeeball_session_players
  WHERE ((skeeball_session_players.session_id = skeeball_ball_scores.session_id) AND (skeeball_session_players.player_user_id = auth.uid()))))));


--
-- Name: skeeball_ball_scores Players update own balls; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Players update own balls" ON public.skeeball_ball_scores FOR UPDATE TO authenticated USING ((auth.uid() = player_user_id));


--
-- Name: forum_posts Post in approved forum; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Post in approved forum" ON public.forum_posts FOR INSERT WITH CHECK (((auth.uid() = user_id) AND (EXISTS ( SELECT 1
   FROM public.forums
  WHERE ((forums.id = forum_posts.forum_id) AND (forums.status = 'approved'::text))))));


--
-- Name: forums Read approved forums; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Read approved forums" ON public.forums FOR SELECT USING (((status = 'approved'::text) OR (auth.uid() = creator_id)));


--
-- Name: skeeball_ball_scores Read ball scores; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Read ball scores" ON public.skeeball_ball_scores FOR SELECT TO authenticated USING (true);


--
-- Name: post_comments Read comments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Read comments" ON public.post_comments FOR SELECT USING (true);


--
-- Name: forum_posts Read forum posts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Read forum posts" ON public.forum_posts FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.forums
  WHERE ((forums.id = forum_posts.forum_id) AND (forums.status = 'approved'::text)))));


--
-- Name: skeeball_session_players Read session players; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Read session players" ON public.skeeball_session_players FOR SELECT TO authenticated USING (true);


--
-- Name: skeeball_sessions Read skeeball sessions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Read skeeball sessions" ON public.skeeball_sessions FOR SELECT TO authenticated USING (true);


--
-- Name: support_messages Read support messages; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Read support messages" ON public.support_messages FOR SELECT USING (((EXISTS ( SELECT 1
   FROM public.support_tickets
  WHERE ((support_tickets.id = support_messages.ticket_id) AND (support_tickets.user_id = auth.uid())))) OR public.is_admin() OR (EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['owner'::text, 'architect'::text])))))));


--
-- Name: tournament_results Results are publicly viewable; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Results are publicly viewable" ON public.tournament_results FOR SELECT TO authenticated USING (true);


--
-- Name: support_tickets System creates ticket; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "System creates ticket" ON public.support_tickets FOR INSERT WITH CHECK ((user_id = auth.uid()));


--
-- Name: admin_audit_log System writes to audit log; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "System writes to audit log" ON public.admin_audit_log FOR INSERT WITH CHECK (true);


--
-- Name: skeeball_session_players Team members can add players; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Team members can add players" ON public.skeeball_session_players FOR INSERT TO authenticated WITH CHECK ((EXISTS ( SELECT 1
   FROM (public.skeeball_sessions s
     JOIN public.team_members tm ON ((tm.team_id = s.team_id)))
  WHERE ((s.id = skeeball_session_players.session_id) AND (tm.user_id = auth.uid())))));


--
-- Name: team_schedule Team members can read their slot; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Team members can read their slot" ON public.team_schedule FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.team_members
  WHERE ((team_members.team_id = team_schedule.team_id) AND (team_members.user_id = auth.uid())))));


--
-- Name: skeeball_sessions Team members can start session; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Team members can start session" ON public.skeeball_sessions FOR INSERT TO authenticated WITH CHECK (((auth.uid() = created_by) AND (EXISTS ( SELECT 1
   FROM public.team_members
  WHERE ((team_members.team_id = skeeball_sessions.team_id) AND (team_members.user_id = auth.uid()))))));


--
-- Name: skeeball_sessions Team members can update session; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Team members can update session" ON public.skeeball_sessions FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.team_members
  WHERE ((team_members.team_id = skeeball_sessions.team_id) AND (team_members.user_id = auth.uid())))));


--
-- Name: team_announcements Team members read announcements; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Team members read announcements" ON public.team_announcements FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.team_members
  WHERE ((team_members.team_id = team_announcements.team_id) AND (team_members.user_id = auth.uid())))));


--
-- Name: team_messages Team members read messages; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Team members read messages" ON public.team_messages FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.team_members
  WHERE ((team_members.team_id = team_messages.team_id) AND (team_members.user_id = auth.uid())))));


--
-- Name: team_messages Team members send messages; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Team members send messages" ON public.team_messages FOR INSERT WITH CHECK (((user_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.team_members
  WHERE ((team_members.team_id = team_messages.team_id) AND (team_members.user_id = auth.uid()))))));


--
-- Name: support_tickets User reads own ticket; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "User reads own ticket" ON public.support_tickets FOR SELECT USING (((user_id = auth.uid()) OR public.is_admin() OR (EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['owner'::text, 'architect'::text])))))));


--
-- Name: teams Users can create teams; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can create teams" ON public.teams FOR INSERT WITH CHECK ((auth.uid() = captain_user_id));


--
-- Name: trivia_teams Users can create trivia teams; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can create trivia teams" ON public.trivia_teams FOR INSERT WITH CHECK ((auth.uid() = captain_user_id));


--
-- Name: posts Users can delete own posts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can delete own posts" ON public.posts FOR DELETE USING ((auth.uid() = user_id));


--
-- Name: team_requests Users can delete own team requests; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can delete own team requests" ON public.team_requests FOR DELETE USING (((auth.uid() = user_id) OR (auth.uid() = ( SELECT teams.captain_user_id
   FROM public.teams
  WHERE (teams.id = team_requests.team_id))) OR public.is_admin()));


--
-- Name: follows Users can follow others; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can follow others" ON public.follows FOR INSERT WITH CHECK (((auth.uid() = follower_id) AND (follower_id <> following_id)));


--
-- Name: check_ins Users can insert own check-ins; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert own check-ins" ON public.check_ins FOR INSERT WITH CHECK (((auth.uid() = user_id) AND (NOT (EXISTS ( SELECT 1
   FROM public.check_ins check_ins_1
  WHERE ((check_ins_1.user_id = auth.uid()) AND (check_ins_1.status = 'active'::text)))))));


--
-- Name: posts Users can insert own posts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert own posts" ON public.posts FOR INSERT WITH CHECK (((auth.uid() = user_id) AND ((post_type = 'post'::text) OR public.is_arcade_official())));


--
-- Name: profiles Users can insert own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert own profile" ON public.profiles FOR INSERT WITH CHECK ((auth.uid() = id));


--
-- Name: scores Users can insert their own scores; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert their own scores" ON public.scores FOR INSERT TO authenticated WITH CHECK ((user_id = auth.uid()));


--
-- Name: team_requests Users can insert their own team requests; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert their own team requests" ON public.team_requests FOR INSERT TO authenticated WITH CHECK ((user_id = auth.uid()));


--
-- Name: team_members Users can join teams; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can join teams" ON public.team_members FOR INSERT WITH CHECK ((auth.uid() = user_id));


--
-- Name: trivia_team_members Users can join trivia teams; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can join trivia teams" ON public.trivia_team_members FOR INSERT WITH CHECK ((auth.uid() = user_id));


--
-- Name: trivia_team_members Users can leave or captains can remove; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can leave or captains can remove" ON public.trivia_team_members FOR DELETE USING (((auth.uid() = user_id) OR public.is_admin() OR (auth.uid() = ( SELECT trivia_teams.captain_user_id
   FROM public.trivia_teams
  WHERE (trivia_teams.id = trivia_team_members.trivia_team_id)))));


--
-- Name: team_members Users can leave teams or captains can remove; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can leave teams or captains can remove" ON public.team_members FOR DELETE USING (((auth.uid() = user_id) OR public.is_admin() OR (auth.uid() = ( SELECT teams.captain_user_id
   FROM public.teams
  WHERE (teams.id = team_members.team_id)))));


--
-- Name: post_likes Users can like posts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can like posts" ON public.post_likes FOR INSERT WITH CHECK ((auth.uid() = user_id));


--
-- Name: check_ins Users can read own check-ins; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can read own check-ins" ON public.check_ins FOR SELECT USING (((auth.uid() = user_id) OR public.is_admin()));


--
-- Name: profiles Users can read own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can read own profile" ON public.profiles FOR SELECT USING ((auth.uid() = id));


--
-- Name: tournament_requests Users can read own requests or admins all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can read own requests or admins all" ON public.tournament_requests FOR SELECT USING (((auth.uid() = user_id) OR public.is_admin()));


--
-- Name: tournament_registrations Users can read relevant registrations; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can read relevant registrations" ON public.tournament_registrations FOR SELECT USING (((auth.uid() = user_id) OR public.is_admin() OR (auth.uid() = ( SELECT tournaments.created_by
   FROM public.tournaments
  WHERE (tournaments.id = tournament_registrations.tournament_id)))));


--
-- Name: team_requests Users can read relevant team requests; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can read relevant team requests" ON public.team_requests FOR SELECT USING (((auth.uid() = user_id) OR public.is_admin() OR (auth.uid() = ( SELECT teams.captain_user_id
   FROM public.teams
  WHERE (teams.id = team_requests.team_id)))));


--
-- Name: tournament_registrations Users can register for tournaments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can register for tournaments" ON public.tournament_registrations FOR INSERT WITH CHECK (((auth.uid() = user_id) AND (status = ANY (ARRAY['pending'::text, 'accepted'::text]))));


--
-- Name: team_requests Users can send join requests; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can send join requests" ON public.team_requests FOR INSERT WITH CHECK (((auth.uid() = user_id) AND (direction = 'request'::text) AND (status = 'pending'::text)));


--
-- Name: scores Users can submit own scores; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can submit own scores" ON public.scores FOR INSERT WITH CHECK (((auth.uid() = user_id) AND (status = 'pending'::text)));


--
-- Name: tournament_requests Users can submit tournament requests; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can submit tournament requests" ON public.tournament_requests FOR INSERT WITH CHECK (((auth.uid() = user_id) AND (status = 'pending'::text)));


--
-- Name: follows Users can unfollow; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can unfollow" ON public.follows FOR DELETE USING ((auth.uid() = follower_id));


--
-- Name: post_likes Users can unlike posts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can unlike posts" ON public.post_likes FOR DELETE USING ((auth.uid() = user_id));


--
-- Name: check_ins Users can update own check-ins; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update own check-ins" ON public.check_ins FOR UPDATE USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: scores Users can update own pending scores; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update own pending scores" ON public.scores FOR UPDATE USING (((auth.uid() = user_id) AND (status = 'pending'::text))) WITH CHECK (((auth.uid() = user_id) AND (status = 'pending'::text)));


--
-- Name: posts Users can update own posts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update own posts" ON public.posts FOR UPDATE USING ((auth.uid() = user_id)) WITH CHECK (((auth.uid() = user_id) AND ((post_type = 'post'::text) OR public.is_arcade_official())));


--
-- Name: profiles Users can update own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING ((auth.uid() = id)) WITH CHECK (((auth.uid() = id) AND (NOT (is_admin IS DISTINCT FROM ( SELECT profiles_1.is_admin
   FROM public.profiles profiles_1
  WHERE (profiles_1.id = auth.uid())))) AND (NOT (is_arcade_official IS DISTINCT FROM ( SELECT profiles_1.is_arcade_official
   FROM public.profiles profiles_1
  WHERE (profiles_1.id = auth.uid()))))));


--
-- Name: content_reports Users can view own reports; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own reports" ON public.content_reports FOR SELECT USING ((auth.uid() = reporter_id));


--
-- Name: scores Users can view their own scores; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view their own scores" ON public.scores FOR SELECT TO authenticated USING ((user_id = auth.uid()));


--
-- Name: team_requests Users can view their own team requests; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view their own team requests" ON public.team_requests FOR SELECT TO authenticated USING ((user_id = auth.uid()));


--
-- Name: tournament_registrations Users can withdraw their registration; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can withdraw their registration" ON public.tournament_registrations FOR DELETE USING ((auth.uid() = user_id));


--
-- Name: check_ins Users read own check_ins; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users read own check_ins" ON public.check_ins FOR SELECT USING (((user_id = auth.uid()) OR public.is_admin()));


--
-- Name: feedback_submissions Users submit feedback; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users submit feedback" ON public.feedback_submissions FOR INSERT WITH CHECK (((auth.uid() IS NOT NULL) AND (user_id = auth.uid())));


--
-- Name: friendships accept or decline request; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "accept or decline request" ON public.friendships FOR UPDATE USING ((auth.uid() = addressee_id));


--
-- Name: admin_audit_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;

--
-- Name: bug_reports admin_read_bug_reports; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_read_bug_reports ON public.bug_reports FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['admin'::text, 'owner'::text, 'architect'::text]))))));


--
-- Name: team_registrations admin_registration_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_registration_select ON public.team_registrations FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['admin'::text, 'owner'::text, 'architect'::text]))))));


--
-- Name: team_registrations admin_registration_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_registration_update ON public.team_registrations FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['admin'::text, 'owner'::text, 'architect'::text]))))));


--
-- Name: ai_verification_config; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ai_verification_config ENABLE ROW LEVEL SECURITY;

--
-- Name: ai_verification_config ai_verification_config_admin_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ai_verification_config_admin_read ON public.ai_verification_config FOR SELECT TO authenticated USING (public.is_admin());


--
-- Name: app_announcements announcements_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY announcements_select ON public.app_announcements FOR SELECT TO authenticated USING (true);


--
-- Name: user_public_keys anyone reads public keys; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "anyone reads public keys" ON public.user_public_keys FOR SELECT USING (true);


--
-- Name: app_announcements; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.app_announcements ENABLE ROW LEVEL SECURITY;

--
-- Name: app_config; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;

--
-- Name: app_config app_config_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY app_config_read ON public.app_config FOR SELECT TO authenticated USING (true);


--
-- Name: beta_reports; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.beta_reports ENABLE ROW LEVEL SECURITY;

--
-- Name: beta_reports beta_reports_own_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY beta_reports_own_read ON public.beta_reports FOR SELECT TO authenticated USING (((user_id = auth.uid()) OR public.is_admin()));


--
-- Name: user_blocks blocks_own_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY blocks_own_delete ON public.user_blocks FOR DELETE TO authenticated USING ((blocker_id = auth.uid()));


--
-- Name: user_blocks blocks_own_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY blocks_own_insert ON public.user_blocks FOR INSERT TO authenticated WITH CHECK ((blocker_id = auth.uid()));


--
-- Name: user_blocks blocks_own_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY blocks_own_select ON public.user_blocks FOR SELECT TO authenticated USING ((blocker_id = auth.uid()));


--
-- Name: bug_reports; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.bug_reports ENABLE ROW LEVEL SECURITY;

--
-- Name: teams captain delete team; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "captain delete team" ON public.teams FOR DELETE TO authenticated USING ((auth.uid() = captain_user_id));


--
-- Name: teams captain update team; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "captain update team" ON public.teams FOR UPDATE TO authenticated USING ((auth.uid() = captain_user_id));


--
-- Name: check_ins; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.check_ins ENABLE ROW LEVEL SECURITY;

--
-- Name: forum_post_comments comments_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY comments_delete ON public.forum_post_comments FOR DELETE TO authenticated USING (((user_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['admin'::text, 'owner'::text, 'architect'::text])))))));


--
-- Name: forum_post_comments comments_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY comments_insert_own ON public.forum_post_comments FOR INSERT TO authenticated WITH CHECK ((user_id = auth.uid()));


--
-- Name: forum_post_comments comments_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY comments_select ON public.forum_post_comments FOR SELECT TO authenticated USING (true);


--
-- Name: content_reports; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.content_reports ENABLE ROW LEVEL SECURITY;

--
-- Name: conversations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;

--
-- Name: conversations create conversation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "create conversation" ON public.conversations FOR INSERT TO authenticated WITH CHECK (((auth.uid() = participant_1) OR (auth.uid() = participant_2)));


--
-- Name: posts create post; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "create post" ON public.posts FOR INSERT TO authenticated WITH CHECK ((auth.uid() = user_id));


--
-- Name: team_requests create request; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "create request" ON public.team_requests FOR INSERT TO authenticated WITH CHECK (((auth.uid() = user_id) OR (team_id IN ( SELECT teams.id
   FROM public.teams
  WHERE (teams.captain_user_id = auth.uid())))));


--
-- Name: teams create team; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "create team" ON public.teams FOR INSERT TO authenticated WITH CHECK ((auth.uid() = captain_user_id));


--
-- Name: follows delete own follows; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "delete own follows" ON public.follows FOR DELETE TO authenticated USING ((auth.uid() = follower_id));


--
-- Name: post_likes delete own like; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "delete own like" ON public.post_likes FOR DELETE TO authenticated USING ((auth.uid() = user_id));


--
-- Name: team_members delete own membership; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "delete own membership" ON public.team_members FOR DELETE TO authenticated USING ((auth.uid() = user_id));


--
-- Name: posts delete own post; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "delete own post" ON public.posts FOR DELETE TO authenticated USING ((auth.uid() = user_id));


--
-- Name: team_requests delete request; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "delete request" ON public.team_requests FOR DELETE TO authenticated USING (((auth.uid() = user_id) OR (team_id IN ( SELECT teams.id
   FROM public.teams
  WHERE (teams.captain_user_id = auth.uid())))));


--
-- Name: score_disputes disputes_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY disputes_select ON public.score_disputes FOR SELECT TO authenticated USING (true);


--
-- Name: event_rsvps; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.event_rsvps ENABLE ROW LEVEL SECURITY;

--
-- Name: event_rsvps event_rsvps_own_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY event_rsvps_own_delete ON public.event_rsvps FOR DELETE TO authenticated USING ((user_id = auth.uid()));


--
-- Name: event_rsvps event_rsvps_own_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY event_rsvps_own_insert ON public.event_rsvps FOR INSERT TO authenticated WITH CHECK ((user_id = auth.uid()));


--
-- Name: event_rsvps event_rsvps_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY event_rsvps_select ON public.event_rsvps FOR SELECT TO authenticated USING (true);


--
-- Name: venue_events events_admin_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY events_admin_delete ON public.venue_events FOR DELETE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['admin'::text, 'owner'::text, 'architect'::text]))))));


--
-- Name: venue_events events_admin_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY events_admin_insert ON public.venue_events FOR INSERT TO authenticated WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['admin'::text, 'owner'::text, 'architect'::text]))))));


--
-- Name: venue_events events_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY events_select ON public.venue_events FOR SELECT TO authenticated USING (true);


--
-- Name: fantasy_config; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.fantasy_config ENABLE ROW LEVEL SECURITY;

--
-- Name: fantasy_config fantasy_config_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY fantasy_config_read ON public.fantasy_config FOR SELECT TO authenticated USING (true);


--
-- Name: fantasy_predictions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.fantasy_predictions ENABLE ROW LEVEL SECURITY;

--
-- Name: fantasy_predictions fantasy_predictions_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY fantasy_predictions_own ON public.fantasy_predictions FOR SELECT TO authenticated USING ((user_id = auth.uid()));


--
-- Name: fantasy_roster_players; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.fantasy_roster_players ENABLE ROW LEVEL SECURITY;

--
-- Name: fantasy_roster_players fantasy_roster_players_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY fantasy_roster_players_own ON public.fantasy_roster_players FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.fantasy_rosters r
  WHERE ((r.id = fantasy_roster_players.roster_id) AND (r.user_id = auth.uid())))));


--
-- Name: fantasy_rosters; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.fantasy_rosters ENABLE ROW LEVEL SECURITY;

--
-- Name: fantasy_rosters fantasy_rosters_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY fantasy_rosters_own ON public.fantasy_rosters FOR SELECT TO authenticated USING ((user_id = auth.uid()));


--
-- Name: fantasy_transfers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.fantasy_transfers ENABLE ROW LEVEL SECURITY;

--
-- Name: fantasy_transfers fantasy_transfers_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY fantasy_transfers_own ON public.fantasy_transfers FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.fantasy_rosters r
  WHERE ((r.id = fantasy_transfers.roster_id) AND (r.user_id = auth.uid())))));


--
-- Name: fantasy_wallets; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.fantasy_wallets ENABLE ROW LEVEL SECURITY;

--
-- Name: fantasy_wallets fantasy_wallets_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY fantasy_wallets_own ON public.fantasy_wallets FOR SELECT TO authenticated USING ((user_id = auth.uid()));


--
-- Name: fantasy_week_bonuses; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.fantasy_week_bonuses ENABLE ROW LEVEL SECURITY;

--
-- Name: fantasy_week_bonuses fantasy_week_bonuses_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY fantasy_week_bonuses_read ON public.fantasy_week_bonuses FOR SELECT TO authenticated USING (true);


--
-- Name: feedback_submissions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.feedback_submissions ENABLE ROW LEVEL SECURITY;

--
-- Name: ff_bracket_games; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ff_bracket_games ENABLE ROW LEVEL SECURITY;

--
-- Name: ff_bracket_groups; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ff_bracket_groups ENABLE ROW LEVEL SECURITY;

--
-- Name: ff_bracket_rounds; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ff_bracket_rounds ENABLE ROW LEVEL SECURITY;

--
-- Name: ff_bracket_scores; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ff_bracket_scores ENABLE ROW LEVEL SECURITY;

--
-- Name: ff_bracket_slots; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ff_bracket_slots ENABLE ROW LEVEL SECURITY;

--
-- Name: follows; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.follows ENABLE ROW LEVEL SECURITY;

--
-- Name: forum_poll_votes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.forum_poll_votes ENABLE ROW LEVEL SECURITY;

--
-- Name: forum_polls; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.forum_polls ENABLE ROW LEVEL SECURITY;

--
-- Name: forum_post_comments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.forum_post_comments ENABLE ROW LEVEL SECURITY;

--
-- Name: forum_posts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.forum_posts ENABLE ROW LEVEL SECURITY;

--
-- Name: forums; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.forums ENABLE ROW LEVEL SECURITY;

--
-- Name: friendships; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.friendships ENABLE ROW LEVEL SECURITY;

--
-- Name: game_reference_photos; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.game_reference_photos ENABLE ROW LEVEL SECURITY;

--
-- Name: game_reference_photos game_refs_admin_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY game_refs_admin_delete ON public.game_reference_photos FOR DELETE TO authenticated USING (public.is_admin());


--
-- Name: game_reference_photos game_refs_admin_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY game_refs_admin_read ON public.game_reference_photos FOR SELECT TO authenticated USING (public.is_admin());


--
-- Name: game_reference_photos game_refs_admin_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY game_refs_admin_update ON public.game_reference_photos FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());


--
-- Name: game_reference_photos game_refs_admin_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY game_refs_admin_write ON public.game_reference_photos FOR INSERT TO authenticated WITH CHECK (public.is_admin());


--
-- Name: games; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.games ENABLE ROW LEVEL SECURITY;

--
-- Name: team_members insert own membership; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "insert own membership" ON public.team_members FOR INSERT TO authenticated WITH CHECK ((auth.uid() = user_id));


--
-- Name: bug_reports insert_bug_reports; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY insert_bug_reports ON public.bug_reports FOR INSERT WITH CHECK (true);


--
-- Name: karaoke_queue karaoke_insert_anon; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY karaoke_insert_anon ON public.karaoke_queue FOR INSERT TO anon WITH CHECK ((requested_by IS NULL));


--
-- Name: karaoke_queue karaoke_insert_auth; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY karaoke_insert_auth ON public.karaoke_queue FOR INSERT TO authenticated WITH CHECK ((requested_by = auth.uid()));


--
-- Name: karaoke_queue karaoke_no_direct_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY karaoke_no_direct_insert ON public.karaoke_queue FOR INSERT WITH CHECK (false);


--
-- Name: karaoke_queue; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.karaoke_queue ENABLE ROW LEVEL SECURITY;

--
-- Name: karaoke_search_cache; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.karaoke_search_cache ENABLE ROW LEVEL SECURITY;

--
-- Name: karaoke_search_cache karaoke_search_cache_no_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY karaoke_search_cache_no_access ON public.karaoke_search_cache USING (false);


--
-- Name: karaoke_queue karaoke_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY karaoke_select ON public.karaoke_queue FOR SELECT USING (true);


--
-- Name: lane_qr_tokens; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.lane_qr_tokens ENABLE ROW LEVEL SECURITY;

--
-- Name: lanes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.lanes ENABLE ROW LEVEL SECURITY;

--
-- Name: league_rsvps; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.league_rsvps ENABLE ROW LEVEL SECURITY;

--
-- Name: league_teams; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.league_teams ENABLE ROW LEVEL SECURITY;

--
-- Name: follows manage own follows; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "manage own follows" ON public.follows FOR INSERT TO authenticated WITH CHECK ((auth.uid() = follower_id));


--
-- Name: post_likes manage own likes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "manage own likes" ON public.post_likes FOR INSERT TO authenticated WITH CHECK ((auth.uid() = user_id));


--
-- Name: matches; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.matches ENABLE ROW LEVEL SECURITY;

--
-- Name: menu_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.menu_items ENABLE ROW LEVEL SECURITY;

--
-- Name: messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

--
-- Name: moderation_patterns; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.moderation_patterns ENABLE ROW LEVEL SECURITY;

--
-- Name: user_public_keys owner manages key; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "owner manages key" ON public.user_public_keys USING ((auth.uid() = user_id));


--
-- Name: pickem_picks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pickem_picks ENABLE ROW LEVEL SECURITY;

--
-- Name: pickem_picks picks_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY picks_select ON public.pickem_picks FOR SELECT TO authenticated USING (true);


--
-- Name: tournament_placements placements_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY placements_read ON public.tournament_placements FOR SELECT TO authenticated USING (true);


--
-- Name: tournament_placements placements_upsert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY placements_upsert ON public.tournament_placements FOR UPDATE TO authenticated USING (true);


--
-- Name: tournament_placements placements_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY placements_write ON public.tournament_placements FOR INSERT TO authenticated WITH CHECK (true);


--
-- Name: forum_poll_votes poll_votes_own_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY poll_votes_own_insert ON public.forum_poll_votes FOR INSERT TO authenticated WITH CHECK ((user_id = auth.uid()));


--
-- Name: forum_poll_votes poll_votes_own_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY poll_votes_own_update ON public.forum_poll_votes FOR UPDATE TO authenticated USING ((user_id = auth.uid()));


--
-- Name: forum_poll_votes poll_votes_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY poll_votes_select ON public.forum_poll_votes FOR SELECT TO authenticated USING (true);


--
-- Name: forum_polls polls_insert_own_post; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY polls_insert_own_post ON public.forum_polls FOR INSERT TO authenticated WITH CHECK ((EXISTS ( SELECT 1
   FROM public.forum_posts fp
  WHERE ((fp.id = forum_polls.post_id) AND (fp.user_id = auth.uid())))));


--
-- Name: forum_polls polls_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY polls_select ON public.forum_polls FOR SELECT TO authenticated USING (true);


--
-- Name: post_comments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.post_comments ENABLE ROW LEVEL SECURITY;

--
-- Name: post_likes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.post_likes ENABLE ROW LEVEL SECURITY;

--
-- Name: post_reactions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.post_reactions ENABLE ROW LEVEL SECURITY;

--
-- Name: posts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: push_tokens; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.push_tokens ENABLE ROW LEVEL SECURITY;

--
-- Name: push_tokens push_tokens_own_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY push_tokens_own_delete ON public.push_tokens FOR DELETE TO authenticated USING ((user_id = auth.uid()));


--
-- Name: push_tokens push_tokens_own_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY push_tokens_own_insert ON public.push_tokens FOR INSERT TO authenticated WITH CHECK ((user_id = auth.uid()));


--
-- Name: push_tokens push_tokens_own_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY push_tokens_own_select ON public.push_tokens FOR SELECT TO authenticated USING ((user_id = auth.uid()));


--
-- Name: push_tokens push_tokens_own_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY push_tokens_own_update ON public.push_tokens FOR UPDATE TO authenticated USING ((user_id = auth.uid()));


--
-- Name: rate_limit_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.rate_limit_log ENABLE ROW LEVEL SECURITY;

--
-- Name: post_reactions reactions_own_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY reactions_own_delete ON public.post_reactions FOR DELETE TO authenticated USING ((user_id = auth.uid()));


--
-- Name: post_reactions reactions_own_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY reactions_own_insert ON public.post_reactions FOR INSERT TO authenticated WITH CHECK ((user_id = auth.uid()));


--
-- Name: post_reactions reactions_own_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY reactions_own_update ON public.post_reactions FOR UPDATE TO authenticated USING ((user_id = auth.uid()));


--
-- Name: post_reactions reactions_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY reactions_select ON public.post_reactions FOR SELECT TO authenticated USING (true);


--
-- Name: follows read follows; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "read follows" ON public.follows FOR SELECT TO authenticated USING (true);


--
-- Name: post_likes read likes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "read likes" ON public.post_likes FOR SELECT TO authenticated USING (true);


--
-- Name: messages read messages; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "read messages" ON public.messages FOR SELECT TO authenticated USING ((conversation_id IN ( SELECT conversations.id
   FROM public.conversations
  WHERE ((conversations.participant_1 = auth.uid()) OR (conversations.participant_2 = auth.uid())))));


--
-- Name: conversations read own conversations; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "read own conversations" ON public.conversations FOR SELECT TO authenticated USING (((auth.uid() = participant_1) OR (auth.uid() = participant_2)));


--
-- Name: team_requests read own requests; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "read own requests" ON public.team_requests FOR SELECT TO authenticated USING (((auth.uid() = user_id) OR (team_id IN ( SELECT teams.id
   FROM public.teams
  WHERE (teams.captain_user_id = auth.uid())))));


--
-- Name: friendships remove friendship; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "remove friendship" ON public.friendships FOR DELETE USING (((auth.uid() = requester_id) OR (auth.uid() = addressee_id)));


--
-- Name: league_rsvps rsvps_own_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY rsvps_own_insert ON public.league_rsvps FOR INSERT TO authenticated WITH CHECK ((user_id = auth.uid()));


--
-- Name: league_rsvps rsvps_own_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY rsvps_own_update ON public.league_rsvps FOR UPDATE TO authenticated USING ((user_id = auth.uid()));


--
-- Name: league_rsvps rsvps_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY rsvps_select ON public.league_rsvps FOR SELECT TO authenticated USING (true);


--
-- Name: saved_posts saved_own_all_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY saved_own_all_delete ON public.saved_posts FOR DELETE TO authenticated USING ((user_id = auth.uid()));


--
-- Name: saved_posts saved_own_all_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY saved_own_all_insert ON public.saved_posts FOR INSERT TO authenticated WITH CHECK ((user_id = auth.uid()));


--
-- Name: saved_posts saved_own_all_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY saved_own_all_select ON public.saved_posts FOR SELECT TO authenticated USING ((user_id = auth.uid()));


--
-- Name: saved_posts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.saved_posts ENABLE ROW LEVEL SECURITY;

--
-- Name: score_corrections; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.score_corrections ENABLE ROW LEVEL SECURITY;

--
-- Name: score_disputes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.score_disputes ENABLE ROW LEVEL SECURITY;

--
-- Name: scores; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.scores ENABLE ROW LEVEL SECURITY;

--
-- Name: seasons; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.seasons ENABLE ROW LEVEL SECURITY;

--
-- Name: security_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.security_events ENABLE ROW LEVEL SECURITY;

--
-- Name: friendships send friend request; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "send friend request" ON public.friendships FOR INSERT WITH CHECK ((auth.uid() = requester_id));


--
-- Name: messages send message; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "send message" ON public.messages FOR INSERT TO authenticated WITH CHECK ((auth.uid() = sender_id));


--
-- Name: skeeball_ball_scores; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.skeeball_ball_scores ENABLE ROW LEVEL SECURITY;

--
-- Name: skeeball_ball_scores skeeball_ball_scores_no_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY skeeball_ball_scores_no_write ON public.skeeball_ball_scores FOR INSERT WITH CHECK (false);


--
-- Name: skeeball_ball_scores skeeball_ball_scores_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY skeeball_ball_scores_read ON public.skeeball_ball_scores FOR SELECT USING (true);


--
-- Name: skeeball_league_matches; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.skeeball_league_matches ENABLE ROW LEVEL SECURITY;

--
-- Name: skeeball_league_matches skeeball_league_matches_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY skeeball_league_matches_read ON public.skeeball_league_matches FOR SELECT USING ((auth.role() = 'authenticated'::text));


--
-- Name: skeeball_seasons; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.skeeball_seasons ENABLE ROW LEVEL SECURITY;

--
-- Name: skeeball_seasons skeeball_seasons_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY skeeball_seasons_read ON public.skeeball_seasons FOR SELECT TO authenticated USING (true);


--
-- Name: skeeball_session_players; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.skeeball_session_players ENABLE ROW LEVEL SECURITY;

--
-- Name: skeeball_session_players skeeball_session_players_no_direct_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY skeeball_session_players_no_direct_insert ON public.skeeball_session_players FOR INSERT WITH CHECK (false);


--
-- Name: skeeball_session_players skeeball_session_players_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY skeeball_session_players_read ON public.skeeball_session_players FOR SELECT USING ((auth.role() = 'authenticated'::text));


--
-- Name: skeeball_sessions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.skeeball_sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: skeeball_sessions skeeball_sessions_no_direct_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY skeeball_sessions_no_direct_insert ON public.skeeball_sessions FOR INSERT WITH CHECK (false);


--
-- Name: skeeball_sessions skeeball_sessions_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY skeeball_sessions_read ON public.skeeball_sessions FOR SELECT USING ((auth.role() = 'authenticated'::text));


--
-- Name: skeeball_league_matches slm_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY slm_insert ON public.skeeball_league_matches FOR INSERT WITH CHECK ((auth.uid() IS NOT NULL));


--
-- Name: skeeball_league_matches slm_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY slm_read ON public.skeeball_league_matches FOR SELECT USING (true);


--
-- Name: skeeball_league_matches slm_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY slm_update ON public.skeeball_league_matches FOR UPDATE USING ((auth.uid() IS NOT NULL));


--
-- Name: square_payment_statuses; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.square_payment_statuses ENABLE ROW LEVEL SECURITY;

--
-- Name: square_webhook_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.square_webhook_events ENABLE ROW LEVEL SECURITY;

--
-- Name: storage_cleanup_queue; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.storage_cleanup_queue ENABLE ROW LEVEL SECURITY;

--
-- Name: sub_requests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sub_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: sub_requests subs_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY subs_select ON public.sub_requests FOR SELECT TO authenticated USING (true);


--
-- Name: support_messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.support_messages ENABLE ROW LEVEL SECURITY;

--
-- Name: support_tickets; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;

--
-- Name: team_announcements; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.team_announcements ENABLE ROW LEVEL SECURITY;

--
-- Name: team_bans; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.team_bans ENABLE ROW LEVEL SECURITY;

--
-- Name: team_bans team_bans_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY team_bans_select ON public.team_bans FOR SELECT USING (((user_id = auth.uid()) OR (banned_by = auth.uid())));


--
-- Name: team_members; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;

--
-- Name: team_messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.team_messages ENABLE ROW LEVEL SECURITY;

--
-- Name: team_registrations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.team_registrations ENABLE ROW LEVEL SECURITY;

--
-- Name: team_requests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.team_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: team_schedule; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.team_schedule ENABLE ROW LEVEL SECURITY;

--
-- Name: teams; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;

--
-- Name: throws; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.throws ENABLE ROW LEVEL SECURITY;

--
-- Name: tournament_registrations tourn_reg_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tourn_reg_delete ON public.tournament_registrations FOR DELETE TO authenticated USING ((auth.uid() = user_id));


--
-- Name: tournament_registrations tourn_reg_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tourn_reg_insert ON public.tournament_registrations FOR INSERT TO authenticated WITH CHECK ((auth.uid() = user_id));


--
-- Name: tournament_registrations tourn_reg_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tourn_reg_read ON public.tournament_registrations FOR SELECT TO authenticated USING (true);


--
-- Name: tournament_requests tourn_req_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tourn_req_insert ON public.tournament_requests FOR INSERT TO authenticated WITH CHECK ((auth.uid() = user_id));


--
-- Name: tournament_requests tourn_req_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tourn_req_read ON public.tournament_requests FOR SELECT TO authenticated USING (true);


--
-- Name: tournament_requests tourn_req_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tourn_req_update ON public.tournament_requests FOR UPDATE TO authenticated USING (true);


--
-- Name: tournament_placements; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tournament_placements ENABLE ROW LEVEL SECURITY;

--
-- Name: tournament_registrations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tournament_registrations ENABLE ROW LEVEL SECURITY;

--
-- Name: tournament_requests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tournament_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: tournament_results; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tournament_results ENABLE ROW LEVEL SECURITY;

--
-- Name: tournaments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tournaments ENABLE ROW LEVEL SECURITY;

--
-- Name: tournaments tournaments_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tournaments_delete ON public.tournaments FOR DELETE TO authenticated USING (true);


--
-- Name: tournaments tournaments_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tournaments_insert ON public.tournaments FOR INSERT TO authenticated WITH CHECK (true);


--
-- Name: tournaments tournaments_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tournaments_read ON public.tournaments FOR SELECT TO authenticated USING (true);


--
-- Name: tournaments tournaments_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tournaments_update ON public.tournaments FOR UPDATE TO authenticated USING (true);


--
-- Name: trivia_answers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.trivia_answers ENABLE ROW LEVEL SECURITY;

--
-- Name: trivia_answers trivia_answers_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY trivia_answers_admin ON public.trivia_answers USING (public.is_admin());


--
-- Name: trivia_answers trivia_answers_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY trivia_answers_select ON public.trivia_answers FOR SELECT USING ((public.is_admin() OR (EXISTS ( SELECT 1
   FROM public.trivia_participants tp
  WHERE ((tp.id = trivia_answers.participant_id) AND ((tp.user_id = auth.uid()) OR (EXISTS ( SELECT 1
           FROM public.team_members tm
          WHERE ((tm.team_id = tp.team_id) AND (tm.user_id = auth.uid()))))))))));


--
-- Name: trivia_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.trivia_events ENABLE ROW LEVEL SECURITY;

--
-- Name: trivia_events trivia_events_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY trivia_events_insert ON public.trivia_events FOR INSERT TO authenticated WITH CHECK (true);


--
-- Name: trivia_events trivia_events_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY trivia_events_read ON public.trivia_events FOR SELECT TO authenticated USING (true);


--
-- Name: trivia_events trivia_events_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY trivia_events_update ON public.trivia_events FOR UPDATE TO authenticated USING (true);


--
-- Name: trivia_game_questions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.trivia_game_questions ENABLE ROW LEVEL SECURITY;

--
-- Name: trivia_game_questions trivia_game_questions_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY trivia_game_questions_admin ON public.trivia_game_questions USING (public.is_admin());


--
-- Name: trivia_game_questions trivia_game_questions_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY trivia_game_questions_select ON public.trivia_game_questions FOR SELECT USING ((auth.uid() IS NOT NULL));


--
-- Name: trivia_games; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.trivia_games ENABLE ROW LEVEL SECURITY;

--
-- Name: trivia_games trivia_games_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY trivia_games_admin ON public.trivia_games USING (public.is_admin());


--
-- Name: trivia_games trivia_games_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY trivia_games_select ON public.trivia_games FOR SELECT USING ((auth.uid() IS NOT NULL));


--
-- Name: trivia_team_members trivia_members_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY trivia_members_delete ON public.trivia_team_members FOR DELETE TO authenticated USING ((auth.uid() = user_id));


--
-- Name: trivia_team_members trivia_members_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY trivia_members_insert ON public.trivia_team_members FOR INSERT TO authenticated WITH CHECK (true);


--
-- Name: trivia_team_members trivia_members_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY trivia_members_read ON public.trivia_team_members FOR SELECT TO authenticated USING (true);


--
-- Name: trivia_participants; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.trivia_participants ENABLE ROW LEVEL SECURITY;

--
-- Name: trivia_participants trivia_participants_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY trivia_participants_admin ON public.trivia_participants USING (public.is_admin());


--
-- Name: trivia_participants trivia_participants_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY trivia_participants_select ON public.trivia_participants FOR SELECT USING ((auth.uid() IS NOT NULL));


--
-- Name: trivia_questions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.trivia_questions ENABLE ROW LEVEL SECURITY;

--
-- Name: trivia_questions trivia_questions_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY trivia_questions_admin ON public.trivia_questions USING (public.is_admin());


--
-- Name: trivia_questions trivia_questions_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY trivia_questions_select ON public.trivia_questions FOR SELECT USING ((auth.uid() IS NOT NULL));


--
-- Name: trivia_team_members; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.trivia_team_members ENABLE ROW LEVEL SECURITY;

--
-- Name: trivia_teams; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.trivia_teams ENABLE ROW LEVEL SECURITY;

--
-- Name: trivia_teams trivia_teams_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY trivia_teams_delete ON public.trivia_teams FOR DELETE TO authenticated USING ((auth.uid() = captain_user_id));


--
-- Name: trivia_teams trivia_teams_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY trivia_teams_insert ON public.trivia_teams FOR INSERT TO authenticated WITH CHECK (true);


--
-- Name: trivia_teams trivia_teams_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY trivia_teams_read ON public.trivia_teams FOR SELECT TO authenticated USING (true);


--
-- Name: conversations update conversation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "update conversation" ON public.conversations FOR UPDATE TO authenticated USING (((auth.uid() = participant_1) OR (auth.uid() = participant_2)));


--
-- Name: team_requests update request; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "update request" ON public.team_requests FOR UPDATE TO authenticated USING (((auth.uid() = user_id) OR (team_id IN ( SELECT teams.id
   FROM public.teams
  WHERE (teams.captain_user_id = auth.uid())))));


--
-- Name: user_blocks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_blocks ENABLE ROW LEVEL SECURITY;

--
-- Name: team_registrations user_own_registration_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_own_registration_insert ON public.team_registrations FOR INSERT WITH CHECK ((user_id = auth.uid()));


--
-- Name: team_registrations user_own_registration_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_own_registration_select ON public.team_registrations FOR SELECT USING ((user_id = auth.uid()));


--
-- Name: user_public_keys; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_public_keys ENABLE ROW LEVEL SECURITY;

--
-- Name: user_titles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_titles ENABLE ROW LEVEL SECURITY;

--
-- Name: user_titles user_titles_own_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_titles_own_read ON public.user_titles FOR SELECT TO authenticated USING (((user_id = auth.uid()) OR public.is_admin()));


--
-- Name: profiles users update own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "users update own profile" ON public.profiles FOR UPDATE TO authenticated USING ((auth.uid() = id));


--
-- Name: venue_admins; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.venue_admins ENABLE ROW LEVEL SECURITY;

--
-- Name: venue_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.venue_events ENABLE ROW LEVEL SECURITY;

--
-- Name: friendships view own friendships; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "view own friendships" ON public.friendships FOR SELECT USING (((auth.uid() = requester_id) OR (auth.uid() = addressee_id)));


--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA public TO postgres;
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;


--
-- Name: FUNCTION all_title_keys(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.all_title_keys() FROM PUBLIC;
GRANT ALL ON FUNCTION public.all_title_keys() TO anon;
GRANT ALL ON FUNCTION public.all_title_keys() TO authenticated;
GRANT ALL ON FUNCTION public.all_title_keys() TO service_role;


--
-- Name: FUNCTION can_manage_venue(p_venue_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.can_manage_venue(p_venue_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.can_manage_venue(p_venue_id uuid) TO anon;
GRANT ALL ON FUNCTION public.can_manage_venue(p_venue_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.can_manage_venue(p_venue_id uuid) TO service_role;


--
-- Name: FUNCTION check_and_log_rate_limit(p_action text, p_window_seconds integer, p_max_count integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.check_and_log_rate_limit(p_action text, p_window_seconds integer, p_max_count integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.check_and_log_rate_limit(p_action text, p_window_seconds integer, p_max_count integer) TO anon;
GRANT ALL ON FUNCTION public.check_and_log_rate_limit(p_action text, p_window_seconds integer, p_max_count integer) TO authenticated;
GRANT ALL ON FUNCTION public.check_and_log_rate_limit(p_action text, p_window_seconds integer, p_max_count integer) TO service_role;


--
-- Name: FUNCTION check_content_moderation(p_text text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.check_content_moderation(p_text text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.check_content_moderation(p_text text) TO anon;
GRANT ALL ON FUNCTION public.check_content_moderation(p_text text) TO authenticated;
GRANT ALL ON FUNCTION public.check_content_moderation(p_text text) TO service_role;


--
-- Name: FUNCTION check_email_available(p_email text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.check_email_available(p_email text) TO anon;
GRANT ALL ON FUNCTION public.check_email_available(p_email text) TO authenticated;
GRANT ALL ON FUNCTION public.check_email_available(p_email text) TO service_role;


--
-- Name: FUNCTION check_username_available(p_username text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.check_username_available(p_username text) TO anon;
GRANT ALL ON FUNCTION public.check_username_available(p_username text) TO authenticated;
GRANT ALL ON FUNCTION public.check_username_available(p_username text) TO service_role;


--
-- Name: FUNCTION enforce_content_moderation(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.enforce_content_moderation() TO anon;
GRANT ALL ON FUNCTION public.enforce_content_moderation() TO authenticated;
GRANT ALL ON FUNCTION public.enforce_content_moderation() TO service_role;


--
-- Name: FUNCTION enforce_equipped_title(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.enforce_equipped_title() TO anon;
GRANT ALL ON FUNCTION public.enforce_equipped_title() TO authenticated;
GRANT ALL ON FUNCTION public.enforce_equipped_title() TO service_role;


--
-- Name: FUNCTION enforce_team_creation_payment(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.enforce_team_creation_payment() TO anon;
GRANT ALL ON FUNCTION public.enforce_team_creation_payment() TO authenticated;
GRANT ALL ON FUNCTION public.enforce_team_creation_payment() TO service_role;


--
-- Name: FUNCTION fantasy_full_mode(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.fantasy_full_mode() FROM PUBLIC;
GRANT ALL ON FUNCTION public.fantasy_full_mode() TO anon;
GRANT ALL ON FUNCTION public.fantasy_full_mode() TO authenticated;
GRANT ALL ON FUNCTION public.fantasy_full_mode() TO service_role;


--
-- Name: FUNCTION fantasy_line_multiplier(p_team_id uuid, p_line integer, p_pick text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.fantasy_line_multiplier(p_team_id uuid, p_line integer, p_pick text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.fantasy_line_multiplier(p_team_id uuid, p_line integer, p_pick text) TO anon;
GRANT ALL ON FUNCTION public.fantasy_line_multiplier(p_team_id uuid, p_line integer, p_pick text) TO authenticated;
GRANT ALL ON FUNCTION public.fantasy_line_multiplier(p_team_id uuid, p_line integer, p_pick text) TO service_role;


--
-- Name: FUNCTION fantasy_settle_pending(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.fantasy_settle_pending() FROM PUBLIC;
GRANT ALL ON FUNCTION public.fantasy_settle_pending() TO anon;
GRANT ALL ON FUNCTION public.fantasy_settle_pending() TO authenticated;
GRANT ALL ON FUNCTION public.fantasy_settle_pending() TO service_role;


--
-- Name: FUNCTION fantasy_team_week_points(p_team_id uuid, p_week date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.fantasy_team_week_points(p_team_id uuid, p_week date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.fantasy_team_week_points(p_team_id uuid, p_week date) TO anon;
GRANT ALL ON FUNCTION public.fantasy_team_week_points(p_team_id uuid, p_week date) TO authenticated;
GRANT ALL ON FUNCTION public.fantasy_team_week_points(p_team_id uuid, p_week date) TO service_role;


--
-- Name: FUNCTION fantasy_week_locked(p_week date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.fantasy_week_locked(p_week date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.fantasy_week_locked(p_week date) TO anon;
GRANT ALL ON FUNCTION public.fantasy_week_locked(p_week date) TO authenticated;
GRANT ALL ON FUNCTION public.fantasy_week_locked(p_week date) TO service_role;


--
-- Name: FUNCTION flag_forum_content(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.flag_forum_content() TO anon;
GRANT ALL ON FUNCTION public.flag_forum_content() TO authenticated;
GRANT ALL ON FUNCTION public.flag_forum_content() TO service_role;


--
-- Name: FUNCTION get_email_by_username(p_username text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.get_email_by_username(p_username text) TO anon;
GRANT ALL ON FUNCTION public.get_email_by_username(p_username text) TO authenticated;
GRANT ALL ON FUNCTION public.get_email_by_username(p_username text) TO service_role;


--
-- Name: FUNCTION get_username_by_email(p_email text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.get_username_by_email(p_email text) TO anon;
GRANT ALL ON FUNCTION public.get_username_by_email(p_email text) TO authenticated;
GRANT ALL ON FUNCTION public.get_username_by_email(p_email text) TO service_role;


--
-- Name: FUNCTION grant_beta_founder(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.grant_beta_founder() TO anon;
GRANT ALL ON FUNCTION public.grant_beta_founder() TO authenticated;
GRANT ALL ON FUNCTION public.grant_beta_founder() TO service_role;


--
-- Name: FUNCTION guard_role_escalation(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.guard_role_escalation() TO anon;
GRANT ALL ON FUNCTION public.guard_role_escalation() TO authenticated;
GRANT ALL ON FUNCTION public.guard_role_escalation() TO service_role;


--
-- Name: FUNCTION handle_new_user(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.handle_new_user() TO anon;
GRANT ALL ON FUNCTION public.handle_new_user() TO authenticated;
GRANT ALL ON FUNCTION public.handle_new_user() TO service_role;


--
-- Name: FUNCTION hash_lane_token(p_raw text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.hash_lane_token(p_raw text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.hash_lane_token(p_raw text) TO anon;
GRANT ALL ON FUNCTION public.hash_lane_token(p_raw text) TO authenticated;
GRANT ALL ON FUNCTION public.hash_lane_token(p_raw text) TO service_role;


--
-- Name: FUNCTION is_admin(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.is_admin() TO anon;
GRANT ALL ON FUNCTION public.is_admin() TO authenticated;
GRANT ALL ON FUNCTION public.is_admin() TO service_role;


--
-- Name: FUNCTION is_arcade_official(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.is_arcade_official() TO anon;
GRANT ALL ON FUNCTION public.is_arcade_official() TO authenticated;
GRANT ALL ON FUNCTION public.is_arcade_official() TO service_role;


--
-- Name: FUNCTION is_owner_or_architect(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.is_owner_or_architect() FROM PUBLIC;
GRANT ALL ON FUNCTION public.is_owner_or_architect() TO anon;
GRANT ALL ON FUNCTION public.is_owner_or_architect() TO authenticated;
GRANT ALL ON FUNCTION public.is_owner_or_architect() TO service_role;


--
-- Name: FUNCTION is_platform_admin(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.is_platform_admin() FROM PUBLIC;
GRANT ALL ON FUNCTION public.is_platform_admin() TO anon;
GRANT ALL ON FUNCTION public.is_platform_admin() TO authenticated;
GRANT ALL ON FUNCTION public.is_platform_admin() TO service_role;


--
-- Name: FUNCTION is_venue_admin(p_venue_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.is_venue_admin(p_venue_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.is_venue_admin(p_venue_id uuid) TO anon;
GRANT ALL ON FUNCTION public.is_venue_admin(p_venue_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.is_venue_admin(p_venue_id uuid) TO service_role;


--
-- Name: FUNCTION is_venue_owner(p_venue_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.is_venue_owner(p_venue_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.is_venue_owner(p_venue_id uuid) TO anon;
GRANT ALL ON FUNCTION public.is_venue_owner(p_venue_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.is_venue_owner(p_venue_id uuid) TO service_role;


--
-- Name: FUNCTION is_venue_staff(p_venue_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.is_venue_staff(p_venue_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.is_venue_staff(p_venue_id uuid) TO anon;
GRANT ALL ON FUNCTION public.is_venue_staff(p_venue_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.is_venue_staff(p_venue_id uuid) TO service_role;


--
-- Name: FUNCTION log_payment_security_event(p_event_type text, p_details jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.log_payment_security_event(p_event_type text, p_details jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.log_payment_security_event(p_event_type text, p_details jsonb) TO anon;
GRANT ALL ON FUNCTION public.log_payment_security_event(p_event_type text, p_details jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.log_payment_security_event(p_event_type text, p_details jsonb) TO service_role;


--
-- Name: FUNCTION log_security_event(p_event_type text, p_severity text, p_details jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.log_security_event(p_event_type text, p_severity text, p_details jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.log_security_event(p_event_type text, p_severity text, p_details jsonb) TO anon;
GRANT ALL ON FUNCTION public.log_security_event(p_event_type text, p_severity text, p_details jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.log_security_event(p_event_type text, p_severity text, p_details jsonb) TO service_role;


--
-- Name: FUNCTION qr_token_fingerprint(p_raw text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.qr_token_fingerprint(p_raw text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.qr_token_fingerprint(p_raw text) TO anon;
GRANT ALL ON FUNCTION public.qr_token_fingerprint(p_raw text) TO authenticated;
GRANT ALL ON FUNCTION public.qr_token_fingerprint(p_raw text) TO service_role;


--
-- Name: FUNCTION queue_post_photo_cleanup(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.queue_post_photo_cleanup() TO anon;
GRANT ALL ON FUNCTION public.queue_post_photo_cleanup() TO authenticated;
GRANT ALL ON FUNCTION public.queue_post_photo_cleanup() TO service_role;


--
-- Name: FUNCTION queue_score_proof_cleanup(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.queue_score_proof_cleanup() TO anon;
GRANT ALL ON FUNCTION public.queue_score_proof_cleanup() TO authenticated;
GRANT ALL ON FUNCTION public.queue_score_proof_cleanup() TO service_role;


--
-- Name: FUNCTION require_mfa(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.require_mfa() FROM PUBLIC;
GRANT ALL ON FUNCTION public.require_mfa() TO anon;
GRANT ALL ON FUNCTION public.require_mfa() TO authenticated;
GRANT ALL ON FUNCTION public.require_mfa() TO service_role;


--
-- Name: FUNCTION rpc_accept_tos(p_version text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_accept_tos(p_version text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_accept_tos(p_version text) TO anon;
GRANT ALL ON FUNCTION public.rpc_accept_tos(p_version text) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_accept_tos(p_version text) TO service_role;


--
-- Name: FUNCTION rpc_admin_add_ff_guest(p_tournament_id uuid, p_guest_name text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_admin_add_ff_guest(p_tournament_id uuid, p_guest_name text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_admin_add_ff_guest(p_tournament_id uuid, p_guest_name text) TO anon;
GRANT ALL ON FUNCTION public.rpc_admin_add_ff_guest(p_tournament_id uuid, p_guest_name text) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_admin_add_ff_guest(p_tournament_id uuid, p_guest_name text) TO service_role;


--
-- Name: FUNCTION rpc_admin_adjust_skeeball_session(p_session_id uuid, p_league_points_adjustment integer, p_score_adjustment integer, p_note text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.rpc_admin_adjust_skeeball_session(p_session_id uuid, p_league_points_adjustment integer, p_score_adjustment integer, p_note text) TO anon;
GRANT ALL ON FUNCTION public.rpc_admin_adjust_skeeball_session(p_session_id uuid, p_league_points_adjustment integer, p_score_adjustment integer, p_note text) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_admin_adjust_skeeball_session(p_session_id uuid, p_league_points_adjustment integer, p_score_adjustment integer, p_note text) TO service_role;


--
-- Name: FUNCTION rpc_admin_approve_tournament(p_request_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_admin_approve_tournament(p_request_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_admin_approve_tournament(p_request_id uuid) TO anon;
GRANT ALL ON FUNCTION public.rpc_admin_approve_tournament(p_request_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_admin_approve_tournament(p_request_id uuid) TO service_role;


--
-- Name: FUNCTION rpc_admin_assign_team_member(p_team_id uuid, p_user_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_admin_assign_team_member(p_team_id uuid, p_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_admin_assign_team_member(p_team_id uuid, p_user_id uuid) TO anon;
GRANT ALL ON FUNCTION public.rpc_admin_assign_team_member(p_team_id uuid, p_user_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_admin_assign_team_member(p_team_id uuid, p_user_id uuid) TO service_role;


--
-- Name: FUNCTION rpc_admin_broadcast(p_title text, p_body text, p_days integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_admin_broadcast(p_title text, p_body text, p_days integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_admin_broadcast(p_title text, p_body text, p_days integer) TO anon;
GRANT ALL ON FUNCTION public.rpc_admin_broadcast(p_title text, p_body text, p_days integer) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_admin_broadcast(p_title text, p_body text, p_days integer) TO service_role;


--
-- Name: FUNCTION rpc_admin_bulk_create_teams(p_names text[], p_venue_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_admin_bulk_create_teams(p_names text[], p_venue_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_admin_bulk_create_teams(p_names text[], p_venue_id uuid) TO anon;
GRANT ALL ON FUNCTION public.rpc_admin_bulk_create_teams(p_names text[], p_venue_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_admin_bulk_create_teams(p_names text[], p_venue_id uuid) TO service_role;


--
-- Name: FUNCTION rpc_admin_create_first_friday(p_date timestamp with time zone, p_label text, p_venue_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_admin_create_first_friday(p_date timestamp with time zone, p_label text, p_venue_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_admin_create_first_friday(p_date timestamp with time zone, p_label text, p_venue_id uuid) TO anon;
GRANT ALL ON FUNCTION public.rpc_admin_create_first_friday(p_date timestamp with time zone, p_label text, p_venue_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_admin_create_first_friday(p_date timestamp with time zone, p_label text, p_venue_id uuid) TO service_role;


--
-- Name: FUNCTION rpc_admin_create_score_proof_signed_url(p_score_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_admin_create_score_proof_signed_url(p_score_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_admin_create_score_proof_signed_url(p_score_id uuid) TO anon;
GRANT ALL ON FUNCTION public.rpc_admin_create_score_proof_signed_url(p_score_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_admin_create_score_proof_signed_url(p_score_id uuid) TO service_role;


--
-- Name: FUNCTION rpc_admin_delete_season_data(p_season_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_admin_delete_season_data(p_season_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_admin_delete_season_data(p_season_id uuid) TO anon;
GRANT ALL ON FUNCTION public.rpc_admin_delete_season_data(p_season_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_admin_delete_season_data(p_season_id uuid) TO service_role;


--
-- Name: FUNCTION rpc_admin_delete_team(p_team_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_admin_delete_team(p_team_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_admin_delete_team(p_team_id uuid) TO anon;
GRANT ALL ON FUNCTION public.rpc_admin_delete_team(p_team_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_admin_delete_team(p_team_id uuid) TO service_role;


--
-- Name: FUNCTION rpc_admin_delete_tournament(p_tournament_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_admin_delete_tournament(p_tournament_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_admin_delete_tournament(p_tournament_id uuid) TO anon;
GRANT ALL ON FUNCTION public.rpc_admin_delete_tournament(p_tournament_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_admin_delete_tournament(p_tournament_id uuid) TO service_role;


--
-- Name: FUNCTION rpc_admin_deny_tournament(p_request_id uuid, p_note text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_admin_deny_tournament(p_request_id uuid, p_note text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_admin_deny_tournament(p_request_id uuid, p_note text) TO anon;
GRANT ALL ON FUNCTION public.rpc_admin_deny_tournament(p_request_id uuid, p_note text) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_admin_deny_tournament(p_request_id uuid, p_note text) TO service_role;


--
-- Name: FUNCTION rpc_admin_fantasy_set_full_mode(p_enabled boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_admin_fantasy_set_full_mode(p_enabled boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_admin_fantasy_set_full_mode(p_enabled boolean) TO anon;
GRANT ALL ON FUNCTION public.rpc_admin_fantasy_set_full_mode(p_enabled boolean) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_admin_fantasy_set_full_mode(p_enabled boolean) TO service_role;


--
-- Name: FUNCTION rpc_admin_fantasy_set_season_counts(p_season_id uuid, p_counts boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_admin_fantasy_set_season_counts(p_season_id uuid, p_counts boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_admin_fantasy_set_season_counts(p_season_id uuid, p_counts boolean) TO anon;
GRANT ALL ON FUNCTION public.rpc_admin_fantasy_set_season_counts(p_season_id uuid, p_counts boolean) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_admin_fantasy_set_season_counts(p_season_id uuid, p_counts boolean) TO service_role;


--
-- Name: FUNCTION rpc_admin_generate_ff_signup_qr(p_tournament_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_admin_generate_ff_signup_qr(p_tournament_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_admin_generate_ff_signup_qr(p_tournament_id uuid) TO anon;
GRANT ALL ON FUNCTION public.rpc_admin_generate_ff_signup_qr(p_tournament_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_admin_generate_ff_signup_qr(p_tournament_id uuid) TO service_role;


--
-- Name: FUNCTION rpc_admin_generate_lane_qr_token(p_lane_id uuid, p_ttl_hours integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_admin_generate_lane_qr_token(p_lane_id uuid, p_ttl_hours integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_admin_generate_lane_qr_token(p_lane_id uuid, p_ttl_hours integer) TO anon;
GRANT ALL ON FUNCTION public.rpc_admin_generate_lane_qr_token(p_lane_id uuid, p_ttl_hours integer) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_admin_generate_lane_qr_token(p_lane_id uuid, p_ttl_hours integer) TO service_role;


--
-- Name: FUNCTION rpc_admin_get_audit_log(p_limit integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_admin_get_audit_log(p_limit integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_admin_get_audit_log(p_limit integer) TO anon;
GRANT ALL ON FUNCTION public.rpc_admin_get_audit_log(p_limit integer) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_admin_get_audit_log(p_limit integer) TO service_role;


--
-- Name: FUNCTION rpc_admin_get_beta_reports(p_status text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_admin_get_beta_reports(p_status text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_admin_get_beta_reports(p_status text) TO anon;
GRANT ALL ON FUNCTION public.rpc_admin_get_beta_reports(p_status text) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_admin_get_beta_reports(p_status text) TO service_role;


--
-- Name: FUNCTION rpc_admin_get_content_reports(p_status text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_admin_get_content_reports(p_status text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_admin_get_content_reports(p_status text) TO anon;
GRANT ALL ON FUNCTION public.rpc_admin_get_content_reports(p_status text) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_admin_get_content_reports(p_status text) TO service_role;


--
-- Name: FUNCTION rpc_admin_get_score_review_queue(p_venue_id uuid, p_status text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_admin_get_score_review_queue(p_venue_id uuid, p_status text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_admin_get_score_review_queue(p_venue_id uuid, p_status text) TO anon;
GRANT ALL ON FUNCTION public.rpc_admin_get_score_review_queue(p_venue_id uuid, p_status text) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_admin_get_score_review_queue(p_venue_id uuid, p_status text) TO service_role;


--
-- Name: FUNCTION rpc_admin_get_security_events(p_severity text, p_type text, p_limit integer, p_offset integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_admin_get_security_events(p_severity text, p_type text, p_limit integer, p_offset integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_admin_get_security_events(p_severity text, p_type text, p_limit integer, p_offset integer) TO anon;
GRANT ALL ON FUNCTION public.rpc_admin_get_security_events(p_severity text, p_type text, p_limit integer, p_offset integer) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_admin_get_security_events(p_severity text, p_type text, p_limit integer, p_offset integer) TO service_role;


--
-- Name: FUNCTION rpc_admin_get_storage_cleanup_queue(p_limit integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_admin_get_storage_cleanup_queue(p_limit integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_admin_get_storage_cleanup_queue(p_limit integer) TO anon;
GRANT ALL ON FUNCTION public.rpc_admin_get_storage_cleanup_queue(p_limit integer) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_admin_get_storage_cleanup_queue(p_limit integer) TO service_role;


--
-- Name: FUNCTION rpc_admin_get_team_join_requests(p_team_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_admin_get_team_join_requests(p_team_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_admin_get_team_join_requests(p_team_id uuid) TO anon;
GRANT ALL ON FUNCTION public.rpc_admin_get_team_join_requests(p_team_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_admin_get_team_join_requests(p_team_id uuid) TO service_role;


--
-- Name: FUNCTION rpc_admin_get_team_members(p_team_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_admin_get_team_members(p_team_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_admin_get_team_members(p_team_id uuid) TO anon;
GRANT ALL ON FUNCTION public.rpc_admin_get_team_members(p_team_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_admin_get_team_members(p_team_id uuid) TO service_role;


--
-- Name: FUNCTION rpc_admin_get_users(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.rpc_admin_get_users() TO anon;
GRANT ALL ON FUNCTION public.rpc_admin_get_users() TO authenticated;
GRANT ALL ON FUNCTION public.rpc_admin_get_users() TO service_role;


--
-- Name: FUNCTION rpc_admin_grant_title_to_beta(p_title_key text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_admin_grant_title_to_beta(p_title_key text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_admin_grant_title_to_beta(p_title_key text) TO anon;
GRANT ALL ON FUNCTION public.rpc_admin_grant_title_to_beta(p_title_key text) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_admin_grant_title_to_beta(p_title_key text) TO service_role;


--
-- Name: FUNCTION rpc_admin_grant_venue_role(p_venue_id uuid, p_user_id uuid, p_role text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_admin_grant_venue_role(p_venue_id uuid, p_user_id uuid, p_role text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_admin_grant_venue_role(p_venue_id uuid, p_user_id uuid, p_role text) TO anon;
GRANT ALL ON FUNCTION public.rpc_admin_grant_venue_role(p_venue_id uuid, p_user_id uuid, p_role text) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_admin_grant_venue_role(p_venue_id uuid, p_user_id uuid, p_role text) TO service_role;


--
-- Name: FUNCTION rpc_admin_mark_storage_cleaned(p_ids uuid[]); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_admin_mark_storage_cleaned(p_ids uuid[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_admin_mark_storage_cleaned(p_ids uuid[]) TO anon;
GRANT ALL ON FUNCTION public.rpc_admin_mark_storage_cleaned(p_ids uuid[]) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_admin_mark_storage_cleaned(p_ids uuid[]) TO service_role;


--
-- Name: FUNCTION rpc_admin_remove_ff_guest(p_reg_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_admin_remove_ff_guest(p_reg_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_admin_remove_ff_guest(p_reg_id uuid) TO anon;
GRANT ALL ON FUNCTION public.rpc_admin_remove_ff_guest(p_reg_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_admin_remove_ff_guest(p_reg_id uuid) TO service_role;


--
-- Name: FUNCTION rpc_admin_remove_team_member(p_team_id uuid, p_user_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_admin_remove_team_member(p_team_id uuid, p_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_admin_remove_team_member(p_team_id uuid, p_user_id uuid) TO anon;
GRANT ALL ON FUNCTION public.rpc_admin_remove_team_member(p_team_id uuid, p_user_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_admin_remove_team_member(p_team_id uuid, p_user_id uuid) TO service_role;


--
-- Name: FUNCTION rpc_admin_remove_tournament_player(p_reg_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_admin_remove_tournament_player(p_reg_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_admin_remove_tournament_player(p_reg_id uuid) TO anon;
GRANT ALL ON FUNCTION public.rpc_admin_remove_tournament_player(p_reg_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_admin_remove_tournament_player(p_reg_id uuid) TO service_role;


--
-- Name: FUNCTION rpc_admin_reply_support(p_ticket_id uuid, p_content text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_admin_reply_support(p_ticket_id uuid, p_content text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_admin_reply_support(p_ticket_id uuid, p_content text) TO anon;
GRANT ALL ON FUNCTION public.rpc_admin_reply_support(p_ticket_id uuid, p_content text) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_admin_reply_support(p_ticket_id uuid, p_content text) TO service_role;


--
-- Name: FUNCTION rpc_admin_reset_all_league_data(p_delete_teams boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_admin_reset_all_league_data(p_delete_teams boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_admin_reset_all_league_data(p_delete_teams boolean) TO anon;
GRANT ALL ON FUNCTION public.rpc_admin_reset_all_league_data(p_delete_teams boolean) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_admin_reset_all_league_data(p_delete_teams boolean) TO service_role;


--
-- Name: FUNCTION rpc_admin_reset_team_data(p_team_id uuid, p_delete_team boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_admin_reset_team_data(p_team_id uuid, p_delete_team boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_admin_reset_team_data(p_team_id uuid, p_delete_team boolean) TO anon;
GRANT ALL ON FUNCTION public.rpc_admin_reset_team_data(p_team_id uuid, p_delete_team boolean) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_admin_reset_team_data(p_team_id uuid, p_delete_team boolean) TO service_role;


--
-- Name: FUNCTION rpc_admin_resolve_content_report(p_report_id uuid, p_action text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_admin_resolve_content_report(p_report_id uuid, p_action text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_admin_resolve_content_report(p_report_id uuid, p_action text) TO anon;
GRANT ALL ON FUNCTION public.rpc_admin_resolve_content_report(p_report_id uuid, p_action text) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_admin_resolve_content_report(p_report_id uuid, p_action text) TO service_role;


--
-- Name: FUNCTION rpc_admin_resolve_dispute(p_dispute_id uuid, p_action text, p_note text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_admin_resolve_dispute(p_dispute_id uuid, p_action text, p_note text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_admin_resolve_dispute(p_dispute_id uuid, p_action text, p_note text) TO anon;
GRANT ALL ON FUNCTION public.rpc_admin_resolve_dispute(p_dispute_id uuid, p_action text, p_note text) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_admin_resolve_dispute(p_dispute_id uuid, p_action text, p_note text) TO service_role;


--
-- Name: FUNCTION rpc_admin_resolve_team_request(p_request_id uuid, p_action text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_admin_resolve_team_request(p_request_id uuid, p_action text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_admin_resolve_team_request(p_request_id uuid, p_action text) TO anon;
GRANT ALL ON FUNCTION public.rpc_admin_resolve_team_request(p_request_id uuid, p_action text) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_admin_resolve_team_request(p_request_id uuid, p_action text) TO service_role;


--
-- Name: FUNCTION rpc_admin_review_score(p_score_id uuid, p_status text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_admin_review_score(p_score_id uuid, p_status text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_admin_review_score(p_score_id uuid, p_status text) TO anon;
GRANT ALL ON FUNCTION public.rpc_admin_review_score(p_score_id uuid, p_status text) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_admin_review_score(p_score_id uuid, p_status text) TO service_role;


--
-- Name: FUNCTION rpc_admin_revoke_ff_signup_qr(p_tournament_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_admin_revoke_ff_signup_qr(p_tournament_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_admin_revoke_ff_signup_qr(p_tournament_id uuid) TO anon;
GRANT ALL ON FUNCTION public.rpc_admin_revoke_ff_signup_qr(p_tournament_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_admin_revoke_ff_signup_qr(p_tournament_id uuid) TO service_role;


--
-- Name: FUNCTION rpc_admin_revoke_venue_role(p_venue_id uuid, p_user_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_admin_revoke_venue_role(p_venue_id uuid, p_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_admin_revoke_venue_role(p_venue_id uuid, p_user_id uuid) TO anon;
GRANT ALL ON FUNCTION public.rpc_admin_revoke_venue_role(p_venue_id uuid, p_user_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_admin_revoke_venue_role(p_venue_id uuid, p_user_id uuid) TO service_role;


--
-- Name: FUNCTION rpc_admin_rotate_lane_token(p_lane_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_admin_rotate_lane_token(p_lane_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_admin_rotate_lane_token(p_lane_id uuid) TO anon;
GRANT ALL ON FUNCTION public.rpc_admin_rotate_lane_token(p_lane_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_admin_rotate_lane_token(p_lane_id uuid) TO service_role;


--
-- Name: FUNCTION rpc_admin_save_placements(p_tournament_id uuid, p_placements jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_admin_save_placements(p_tournament_id uuid, p_placements jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_admin_save_placements(p_tournament_id uuid, p_placements jsonb) TO anon;
GRANT ALL ON FUNCTION public.rpc_admin_save_placements(p_tournament_id uuid, p_placements jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_admin_save_placements(p_tournament_id uuid, p_placements jsonb) TO service_role;


--
-- Name: FUNCTION rpc_admin_set_ai_verification_mode(p_mode text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_admin_set_ai_verification_mode(p_mode text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_admin_set_ai_verification_mode(p_mode text) TO anon;
GRANT ALL ON FUNCTION public.rpc_admin_set_ai_verification_mode(p_mode text) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_admin_set_ai_verification_mode(p_mode text) TO service_role;


--
-- Name: FUNCTION rpc_admin_set_beta_open(p_open boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_admin_set_beta_open(p_open boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_admin_set_beta_open(p_open boolean) TO anon;
GRANT ALL ON FUNCTION public.rpc_admin_set_beta_open(p_open boolean) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_admin_set_beta_open(p_open boolean) TO service_role;


--
-- Name: FUNCTION rpc_admin_set_beta_tester(p_user_id uuid, p_enabled boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_admin_set_beta_tester(p_user_id uuid, p_enabled boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_admin_set_beta_tester(p_user_id uuid, p_enabled boolean) TO anon;
GRANT ALL ON FUNCTION public.rpc_admin_set_beta_tester(p_user_id uuid, p_enabled boolean) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_admin_set_beta_tester(p_user_id uuid, p_enabled boolean) TO service_role;


--
-- Name: FUNCTION rpc_admin_set_team_captain(p_team_id uuid, p_user_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_admin_set_team_captain(p_team_id uuid, p_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_admin_set_team_captain(p_team_id uuid, p_user_id uuid) TO anon;
GRANT ALL ON FUNCTION public.rpc_admin_set_team_captain(p_team_id uuid, p_user_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_admin_set_team_captain(p_team_id uuid, p_user_id uuid) TO service_role;


--
-- Name: FUNCTION rpc_admin_set_tournament_status(p_tournament_id uuid, p_status text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_admin_set_tournament_status(p_tournament_id uuid, p_status text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_admin_set_tournament_status(p_tournament_id uuid, p_status text) TO anon;
GRANT ALL ON FUNCTION public.rpc_admin_set_tournament_status(p_tournament_id uuid, p_status text) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_admin_set_tournament_status(p_tournament_id uuid, p_status text) TO service_role;


--
-- Name: FUNCTION rpc_admin_skeeball_force_finalize(p_match_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_admin_skeeball_force_finalize(p_match_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_admin_skeeball_force_finalize(p_match_id uuid) TO anon;
GRANT ALL ON FUNCTION public.rpc_admin_skeeball_force_finalize(p_match_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_admin_skeeball_force_finalize(p_match_id uuid) TO service_role;


--
-- Name: FUNCTION rpc_admin_skeeball_kick_session(p_session_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_admin_skeeball_kick_session(p_session_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_admin_skeeball_kick_session(p_session_id uuid) TO anon;
GRANT ALL ON FUNCTION public.rpc_admin_skeeball_kick_session(p_session_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_admin_skeeball_kick_session(p_session_id uuid) TO service_role;


--
-- Name: FUNCTION rpc_admin_skeeball_set_match_order(p_match_id uuid, p_ordered_session_ids uuid[]); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_admin_skeeball_set_match_order(p_match_id uuid, p_ordered_session_ids uuid[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_admin_skeeball_set_match_order(p_match_id uuid, p_ordered_session_ids uuid[]) TO anon;
GRANT ALL ON FUNCTION public.rpc_admin_skeeball_set_match_order(p_match_id uuid, p_ordered_session_ids uuid[]) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_admin_skeeball_set_match_order(p_match_id uuid, p_ordered_session_ids uuid[]) TO service_role;


--
-- Name: FUNCTION rpc_admin_skeeball_set_scoring_mode(p_mode text, p_week_of date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_admin_skeeball_set_scoring_mode(p_mode text, p_week_of date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_admin_skeeball_set_scoring_mode(p_mode text, p_week_of date) TO anon;
GRANT ALL ON FUNCTION public.rpc_admin_skeeball_set_scoring_mode(p_mode text, p_week_of date) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_admin_skeeball_set_scoring_mode(p_mode text, p_week_of date) TO service_role;


--
-- Name: FUNCTION rpc_admin_skeeball_set_week_teams(p_expected_teams integer, p_week_of date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_admin_skeeball_set_week_teams(p_expected_teams integer, p_week_of date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_admin_skeeball_set_week_teams(p_expected_teams integer, p_week_of date) TO anon;
GRANT ALL ON FUNCTION public.rpc_admin_skeeball_set_week_teams(p_expected_teams integer, p_week_of date) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_admin_skeeball_set_week_teams(p_expected_teams integer, p_week_of date) TO service_role;


--
-- Name: FUNCTION rpc_admin_skeeball_start_season(p_name text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_admin_skeeball_start_season(p_name text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_admin_skeeball_start_season(p_name text) TO anon;
GRANT ALL ON FUNCTION public.rpc_admin_skeeball_start_season(p_name text) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_admin_skeeball_start_season(p_name text) TO service_role;


--
-- Name: FUNCTION rpc_admin_trivia_create_game(p_title text, p_max_participants integer, p_allow_teams boolean, p_min_team_size integer, p_question_ids uuid[]); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_admin_trivia_create_game(p_title text, p_max_participants integer, p_allow_teams boolean, p_min_team_size integer, p_question_ids uuid[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_admin_trivia_create_game(p_title text, p_max_participants integer, p_allow_teams boolean, p_min_team_size integer, p_question_ids uuid[]) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_admin_trivia_create_game(p_title text, p_max_participants integer, p_allow_teams boolean, p_min_team_size integer, p_question_ids uuid[]) TO service_role;


--
-- Name: FUNCTION rpc_admin_trivia_delete_game(p_game_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_admin_trivia_delete_game(p_game_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_admin_trivia_delete_game(p_game_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_admin_trivia_delete_game(p_game_id uuid) TO service_role;


--
-- Name: FUNCTION rpc_admin_trivia_end_game(p_game_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_admin_trivia_end_game(p_game_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_admin_trivia_end_game(p_game_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_admin_trivia_end_game(p_game_id uuid) TO service_role;


--
-- Name: FUNCTION rpc_admin_trivia_grade(p_answer_id uuid, p_is_correct boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_admin_trivia_grade(p_answer_id uuid, p_is_correct boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_admin_trivia_grade(p_answer_id uuid, p_is_correct boolean) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_admin_trivia_grade(p_answer_id uuid, p_is_correct boolean) TO service_role;


--
-- Name: FUNCTION rpc_admin_trivia_next_question(p_game_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_admin_trivia_next_question(p_game_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_admin_trivia_next_question(p_game_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_admin_trivia_next_question(p_game_id uuid) TO service_role;


--
-- Name: FUNCTION rpc_admin_trivia_start_game(p_game_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_admin_trivia_start_game(p_game_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_admin_trivia_start_game(p_game_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_admin_trivia_start_game(p_game_id uuid) TO service_role;


--
-- Name: FUNCTION rpc_admin_update_beta_report(p_id uuid, p_status text, p_admin_note text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_admin_update_beta_report(p_id uuid, p_status text, p_admin_note text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_admin_update_beta_report(p_id uuid, p_status text, p_admin_note text) TO anon;
GRANT ALL ON FUNCTION public.rpc_admin_update_beta_report(p_id uuid, p_status text, p_admin_note text) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_admin_update_beta_report(p_id uuid, p_status text, p_admin_note text) TO service_role;


--
-- Name: FUNCTION rpc_admin_update_forum_status(p_forum_id uuid, p_status text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_admin_update_forum_status(p_forum_id uuid, p_status text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_admin_update_forum_status(p_forum_id uuid, p_status text) TO anon;
GRANT ALL ON FUNCTION public.rpc_admin_update_forum_status(p_forum_id uuid, p_status text) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_admin_update_forum_status(p_forum_id uuid, p_status text) TO service_role;


--
-- Name: FUNCTION rpc_admin_update_tournament(p_tournament_id uuid, p_title text, p_game_type text, p_proposed_date timestamp with time zone, p_max_players integer, p_signup_time text, p_start_time text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_admin_update_tournament(p_tournament_id uuid, p_title text, p_game_type text, p_proposed_date timestamp with time zone, p_max_players integer, p_signup_time text, p_start_time text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_admin_update_tournament(p_tournament_id uuid, p_title text, p_game_type text, p_proposed_date timestamp with time zone, p_max_players integer, p_signup_time text, p_start_time text) TO anon;
GRANT ALL ON FUNCTION public.rpc_admin_update_tournament(p_tournament_id uuid, p_title text, p_game_type text, p_proposed_date timestamp with time zone, p_max_players integer, p_signup_time text, p_start_time text) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_admin_update_tournament(p_tournament_id uuid, p_title text, p_game_type text, p_proposed_date timestamp with time zone, p_max_players integer, p_signup_time text, p_start_time text) TO service_role;


--
-- Name: FUNCTION rpc_architect_report(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_architect_report() FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_architect_report() TO anon;
GRANT ALL ON FUNCTION public.rpc_architect_report() TO authenticated;
GRANT ALL ON FUNCTION public.rpc_architect_report() TO service_role;


--
-- Name: FUNCTION rpc_attach_score_proof(p_score_id uuid, p_storage_path text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_attach_score_proof(p_score_id uuid, p_storage_path text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_attach_score_proof(p_score_id uuid, p_storage_path text) TO anon;
GRANT ALL ON FUNCTION public.rpc_attach_score_proof(p_score_id uuid, p_storage_path text) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_attach_score_proof(p_score_id uuid, p_storage_path text) TO service_role;


--
-- Name: FUNCTION rpc_beta_submit_report(p_category text, p_severity text, p_title text, p_description text, p_steps text, p_route text, p_platform text, p_app_version text, p_device_info text, p_screenshot_url text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_beta_submit_report(p_category text, p_severity text, p_title text, p_description text, p_steps text, p_route text, p_platform text, p_app_version text, p_device_info text, p_screenshot_url text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_beta_submit_report(p_category text, p_severity text, p_title text, p_description text, p_steps text, p_route text, p_platform text, p_app_version text, p_device_info text, p_screenshot_url text) TO anon;
GRANT ALL ON FUNCTION public.rpc_beta_submit_report(p_category text, p_severity text, p_title text, p_description text, p_steps text, p_route text, p_platform text, p_app_version text, p_device_info text, p_screenshot_url text) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_beta_submit_report(p_category text, p_severity text, p_title text, p_description text, p_steps text, p_route text, p_platform text, p_app_version text, p_device_info text, p_screenshot_url text) TO service_role;


--
-- Name: FUNCTION rpc_cancel_sub(p_request_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_cancel_sub(p_request_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_cancel_sub(p_request_id uuid) TO anon;
GRANT ALL ON FUNCTION public.rpc_cancel_sub(p_request_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_cancel_sub(p_request_id uuid) TO service_role;


--
-- Name: FUNCTION rpc_check_in(p_token text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_check_in(p_token text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_check_in(p_token text) TO anon;
GRANT ALL ON FUNCTION public.rpc_check_in(p_token text) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_check_in(p_token text) TO service_role;


--
-- Name: FUNCTION rpc_claim_sub(p_request_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_claim_sub(p_request_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_claim_sub(p_request_id uuid) TO anon;
GRANT ALL ON FUNCTION public.rpc_claim_sub(p_request_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_claim_sub(p_request_id uuid) TO service_role;


--
-- Name: FUNCTION rpc_fantasy_buy_player(p_player_user_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_fantasy_buy_player(p_player_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_fantasy_buy_player(p_player_user_id uuid) TO anon;
GRANT ALL ON FUNCTION public.rpc_fantasy_buy_player(p_player_user_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_fantasy_buy_player(p_player_user_id uuid) TO service_role;


--
-- Name: FUNCTION rpc_fantasy_cancel_prediction(p_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_fantasy_cancel_prediction(p_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_fantasy_cancel_prediction(p_id uuid) TO anon;
GRANT ALL ON FUNCTION public.rpc_fantasy_cancel_prediction(p_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_fantasy_cancel_prediction(p_id uuid) TO service_role;


--
-- Name: FUNCTION rpc_fantasy_get_state(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_fantasy_get_state() FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_fantasy_get_state() TO anon;
GRANT ALL ON FUNCTION public.rpc_fantasy_get_state() TO authenticated;
GRANT ALL ON FUNCTION public.rpc_fantasy_get_state() TO service_role;


--
-- Name: FUNCTION rpc_fantasy_market(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_fantasy_market() FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_fantasy_market() TO anon;
GRANT ALL ON FUNCTION public.rpc_fantasy_market() TO authenticated;
GRANT ALL ON FUNCTION public.rpc_fantasy_market() TO service_role;


--
-- Name: FUNCTION rpc_fantasy_place_prediction(p_team_id uuid, p_line integer, p_pick text, p_stake integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_fantasy_place_prediction(p_team_id uuid, p_line integer, p_pick text, p_stake integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_fantasy_place_prediction(p_team_id uuid, p_line integer, p_pick text, p_stake integer) TO anon;
GRANT ALL ON FUNCTION public.rpc_fantasy_place_prediction(p_team_id uuid, p_line integer, p_pick text, p_stake integer) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_fantasy_place_prediction(p_team_id uuid, p_line integer, p_pick text, p_stake integer) TO service_role;


--
-- Name: FUNCTION rpc_fantasy_sell_player(p_player_user_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_fantasy_sell_player(p_player_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_fantasy_sell_player(p_player_user_id uuid) TO anon;
GRANT ALL ON FUNCTION public.rpc_fantasy_sell_player(p_player_user_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_fantasy_sell_player(p_player_user_id uuid) TO service_role;


--
-- Name: FUNCTION rpc_ff_generate_bracket(p_tournament_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.rpc_ff_generate_bracket(p_tournament_id uuid) TO anon;
GRANT ALL ON FUNCTION public.rpc_ff_generate_bracket(p_tournament_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_ff_generate_bracket(p_tournament_id uuid) TO service_role;


--
-- Name: FUNCTION rpc_ff_get_bracket(p_tournament_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.rpc_ff_get_bracket(p_tournament_id uuid) TO anon;
GRANT ALL ON FUNCTION public.rpc_ff_get_bracket(p_tournament_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_ff_get_bracket(p_tournament_id uuid) TO service_role;


--
-- Name: FUNCTION rpc_ff_get_guest_players(p_tournament_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.rpc_ff_get_guest_players(p_tournament_id uuid) TO anon;
GRANT ALL ON FUNCTION public.rpc_ff_get_guest_players(p_tournament_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_ff_get_guest_players(p_tournament_id uuid) TO service_role;


--
-- Name: FUNCTION rpc_ff_qr_signup(p_token uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_ff_qr_signup(p_token uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_ff_qr_signup(p_token uuid) TO anon;
GRANT ALL ON FUNCTION public.rpc_ff_qr_signup(p_token uuid) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_ff_qr_signup(p_token uuid) TO service_role;


--
-- Name: FUNCTION rpc_ff_submit_game_scores(p_game_id uuid, p_scores jsonb); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.rpc_ff_submit_game_scores(p_game_id uuid, p_scores jsonb) TO anon;
GRANT ALL ON FUNCTION public.rpc_ff_submit_game_scores(p_game_id uuid, p_scores jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_ff_submit_game_scores(p_game_id uuid, p_scores jsonb) TO service_role;


--
-- Name: FUNCTION rpc_get_my_titles(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_get_my_titles() FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_get_my_titles() TO anon;
GRANT ALL ON FUNCTION public.rpc_get_my_titles() TO authenticated;
GRANT ALL ON FUNCTION public.rpc_get_my_titles() TO service_role;


--
-- Name: FUNCTION rpc_get_public_profile(p_user_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_get_public_profile(p_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_get_public_profile(p_user_id uuid) TO anon;
GRANT ALL ON FUNCTION public.rpc_get_public_profile(p_user_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_get_public_profile(p_user_id uuid) TO service_role;


--
-- Name: FUNCTION rpc_get_score_proof_url(p_score_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_get_score_proof_url(p_score_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_get_score_proof_url(p_score_id uuid) TO anon;
GRANT ALL ON FUNCTION public.rpc_get_score_proof_url(p_score_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_get_score_proof_url(p_score_id uuid) TO service_role;


--
-- Name: FUNCTION rpc_karaoke_add(p_video_id text, p_title text, p_channel text, p_thumbnail_url text, p_requester_name text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_karaoke_add(p_video_id text, p_title text, p_channel text, p_thumbnail_url text, p_requester_name text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_karaoke_add(p_video_id text, p_title text, p_channel text, p_thumbnail_url text, p_requester_name text) TO anon;
GRANT ALL ON FUNCTION public.rpc_karaoke_add(p_video_id text, p_title text, p_channel text, p_thumbnail_url text, p_requester_name text) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_karaoke_add(p_video_id text, p_title text, p_channel text, p_thumbnail_url text, p_requester_name text) TO service_role;


--
-- Name: FUNCTION rpc_karaoke_clear_history(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_karaoke_clear_history() FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_karaoke_clear_history() TO anon;
GRANT ALL ON FUNCTION public.rpc_karaoke_clear_history() TO authenticated;
GRANT ALL ON FUNCTION public.rpc_karaoke_clear_history() TO service_role;


--
-- Name: FUNCTION rpc_karaoke_next(p_current_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_karaoke_next(p_current_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_karaoke_next(p_current_id uuid) TO anon;
GRANT ALL ON FUNCTION public.rpc_karaoke_next(p_current_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_karaoke_next(p_current_id uuid) TO service_role;


--
-- Name: FUNCTION rpc_karaoke_remove(p_song_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_karaoke_remove(p_song_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_karaoke_remove(p_song_id uuid) TO anon;
GRANT ALL ON FUNCTION public.rpc_karaoke_remove(p_song_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_karaoke_remove(p_song_id uuid) TO service_role;


--
-- Name: FUNCTION rpc_karaoke_skip(p_song_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_karaoke_skip(p_song_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_karaoke_skip(p_song_id uuid) TO anon;
GRANT ALL ON FUNCTION public.rpc_karaoke_skip(p_song_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_karaoke_skip(p_song_id uuid) TO service_role;


--
-- Name: FUNCTION rpc_make_pick(p_team_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_make_pick(p_team_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_make_pick(p_team_id uuid) TO anon;
GRANT ALL ON FUNCTION public.rpc_make_pick(p_team_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_make_pick(p_team_id uuid) TO service_role;


--
-- Name: FUNCTION rpc_most_played_game(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_most_played_game() FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_most_played_game() TO anon;
GRANT ALL ON FUNCTION public.rpc_most_played_game() TO authenticated;
GRANT ALL ON FUNCTION public.rpc_most_played_game() TO service_role;


--
-- Name: FUNCTION rpc_my_skeeball_night(p_week_of date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_my_skeeball_night(p_week_of date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_my_skeeball_night(p_week_of date) TO anon;
GRANT ALL ON FUNCTION public.rpc_my_skeeball_night(p_week_of date) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_my_skeeball_night(p_week_of date) TO service_role;


--
-- Name: FUNCTION rpc_my_team_rsvps(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_my_team_rsvps() FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_my_team_rsvps() TO anon;
GRANT ALL ON FUNCTION public.rpc_my_team_rsvps() TO authenticated;
GRANT ALL ON FUNCTION public.rpc_my_team_rsvps() TO service_role;


--
-- Name: FUNCTION rpc_owner_metrics(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_owner_metrics() FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_owner_metrics() TO anon;
GRANT ALL ON FUNCTION public.rpc_owner_metrics() TO authenticated;
GRANT ALL ON FUNCTION public.rpc_owner_metrics() TO service_role;


--
-- Name: FUNCTION rpc_pickem_leaderboard(p_start date, p_end date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_pickem_leaderboard(p_start date, p_end date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_pickem_leaderboard(p_start date, p_end date) TO anon;
GRANT ALL ON FUNCTION public.rpc_pickem_leaderboard(p_start date, p_end date) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_pickem_leaderboard(p_start date, p_end date) TO service_role;


--
-- Name: FUNCTION rpc_public_score_card(p_score_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_public_score_card(p_score_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_public_score_card(p_score_id uuid) TO anon;
GRANT ALL ON FUNCTION public.rpc_public_score_card(p_score_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_public_score_card(p_score_id uuid) TO service_role;


--
-- Name: FUNCTION rpc_public_standings(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_public_standings() FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_public_standings() TO anon;
GRANT ALL ON FUNCTION public.rpc_public_standings() TO authenticated;
GRANT ALL ON FUNCTION public.rpc_public_standings() TO service_role;


--
-- Name: FUNCTION rpc_raise_score_dispute(p_session_id uuid, p_reason text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_raise_score_dispute(p_session_id uuid, p_reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_raise_score_dispute(p_session_id uuid, p_reason text) TO anon;
GRANT ALL ON FUNCTION public.rpc_raise_score_dispute(p_session_id uuid, p_reason text) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_raise_score_dispute(p_session_id uuid, p_reason text) TO service_role;


--
-- Name: FUNCTION rpc_report_content(p_content_type text, p_content_id uuid, p_reason text, p_details text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_report_content(p_content_type text, p_content_id uuid, p_reason text, p_details text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_report_content(p_content_type text, p_content_id uuid, p_reason text, p_details text) TO anon;
GRANT ALL ON FUNCTION public.rpc_report_content(p_content_type text, p_content_id uuid, p_reason text, p_details text) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_report_content(p_content_type text, p_content_id uuid, p_reason text, p_details text) TO service_role;


--
-- Name: FUNCTION rpc_request_sub(p_team_id uuid, p_week_of date, p_note text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_request_sub(p_team_id uuid, p_week_of date, p_note text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_request_sub(p_team_id uuid, p_week_of date, p_note text) TO anon;
GRANT ALL ON FUNCTION public.rpc_request_sub(p_team_id uuid, p_week_of date, p_note text) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_request_sub(p_team_id uuid, p_week_of date, p_note text) TO service_role;


--
-- Name: FUNCTION rpc_resolve_support_ticket(p_ticket_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_resolve_support_ticket(p_ticket_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_resolve_support_ticket(p_ticket_id uuid) TO anon;
GRANT ALL ON FUNCTION public.rpc_resolve_support_ticket(p_ticket_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_resolve_support_ticket(p_ticket_id uuid) TO service_role;


--
-- Name: FUNCTION rpc_send_support_message(p_content text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_send_support_message(p_content text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_send_support_message(p_content text) TO anon;
GRANT ALL ON FUNCTION public.rpc_send_support_message(p_content text) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_send_support_message(p_content text) TO service_role;


--
-- Name: FUNCTION rpc_set_league_rsvp(p_status text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_set_league_rsvp(p_status text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_set_league_rsvp(p_status text) TO anon;
GRANT ALL ON FUNCTION public.rpc_set_league_rsvp(p_status text) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_set_league_rsvp(p_status text) TO service_role;


--
-- Name: FUNCTION rpc_skeeball_cancel_session(p_session_id uuid, p_force boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_skeeball_cancel_session(p_session_id uuid, p_force boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_skeeball_cancel_session(p_session_id uuid, p_force boolean) TO anon;
GRANT ALL ON FUNCTION public.rpc_skeeball_cancel_session(p_session_id uuid, p_force boolean) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_skeeball_cancel_session(p_session_id uuid, p_force boolean) TO service_role;


--
-- Name: FUNCTION rpc_skeeball_complete_session(p_session_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_skeeball_complete_session(p_session_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_skeeball_complete_session(p_session_id uuid) TO anon;
GRANT ALL ON FUNCTION public.rpc_skeeball_complete_session(p_session_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_skeeball_complete_session(p_session_id uuid) TO service_role;


--
-- Name: FUNCTION rpc_skeeball_finalize_match(p_match_id uuid, p_force boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_skeeball_finalize_match(p_match_id uuid, p_force boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_skeeball_finalize_match(p_match_id uuid, p_force boolean) TO anon;
GRANT ALL ON FUNCTION public.rpc_skeeball_finalize_match(p_match_id uuid, p_force boolean) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_skeeball_finalize_match(p_match_id uuid, p_force boolean) TO service_role;


--
-- Name: FUNCTION rpc_skeeball_get_or_create_match(p_week_of date); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.rpc_skeeball_get_or_create_match(p_week_of date) TO anon;
GRANT ALL ON FUNCTION public.rpc_skeeball_get_or_create_match(p_week_of date) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_skeeball_get_or_create_match(p_week_of date) TO service_role;


--
-- Name: FUNCTION rpc_skeeball_hall_of_fame(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_skeeball_hall_of_fame() FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_skeeball_hall_of_fame() TO anon;
GRANT ALL ON FUNCTION public.rpc_skeeball_hall_of_fame() TO authenticated;
GRANT ALL ON FUNCTION public.rpc_skeeball_hall_of_fame() TO service_role;


--
-- Name: FUNCTION rpc_skeeball_head_to_head(p_team_id uuid, p_opponent_id uuid, p_start date, p_end date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_skeeball_head_to_head(p_team_id uuid, p_opponent_id uuid, p_start date, p_end date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_skeeball_head_to_head(p_team_id uuid, p_opponent_id uuid, p_start date, p_end date) TO anon;
GRANT ALL ON FUNCTION public.rpc_skeeball_head_to_head(p_team_id uuid, p_opponent_id uuid, p_start date, p_end date) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_skeeball_head_to_head(p_team_id uuid, p_opponent_id uuid, p_start date, p_end date) TO service_role;


--
-- Name: FUNCTION rpc_skeeball_player_insights(p_user_id uuid, p_start date, p_end date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_skeeball_player_insights(p_user_id uuid, p_start date, p_end date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_skeeball_player_insights(p_user_id uuid, p_start date, p_end date) TO anon;
GRANT ALL ON FUNCTION public.rpc_skeeball_player_insights(p_user_id uuid, p_start date, p_end date) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_skeeball_player_insights(p_user_id uuid, p_start date, p_end date) TO service_role;


--
-- Name: FUNCTION rpc_skeeball_player_stats(p_user_id uuid, p_start date, p_end date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_skeeball_player_stats(p_user_id uuid, p_start date, p_end date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_skeeball_player_stats(p_user_id uuid, p_start date, p_end date) TO anon;
GRANT ALL ON FUNCTION public.rpc_skeeball_player_stats(p_user_id uuid, p_start date, p_end date) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_skeeball_player_stats(p_user_id uuid, p_start date, p_end date) TO service_role;


--
-- Name: FUNCTION rpc_skeeball_position_stats(p_team_id uuid, p_start date, p_end date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_skeeball_position_stats(p_team_id uuid, p_start date, p_end date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_skeeball_position_stats(p_team_id uuid, p_start date, p_end date) TO anon;
GRANT ALL ON FUNCTION public.rpc_skeeball_position_stats(p_team_id uuid, p_start date, p_end date) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_skeeball_position_stats(p_team_id uuid, p_start date, p_end date) TO service_role;


--
-- Name: FUNCTION rpc_skeeball_preview_lane_qr(p_token text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_skeeball_preview_lane_qr(p_token text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_skeeball_preview_lane_qr(p_token text) TO anon;
GRANT ALL ON FUNCTION public.rpc_skeeball_preview_lane_qr(p_token text) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_skeeball_preview_lane_qr(p_token text) TO service_role;


--
-- Name: FUNCTION rpc_skeeball_set_lineup_order(p_session_id uuid, p_ordered_user_ids uuid[]); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_skeeball_set_lineup_order(p_session_id uuid, p_ordered_user_ids uuid[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_skeeball_set_lineup_order(p_session_id uuid, p_ordered_user_ids uuid[]) TO anon;
GRANT ALL ON FUNCTION public.rpc_skeeball_set_lineup_order(p_session_id uuid, p_ordered_user_ids uuid[]) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_skeeball_set_lineup_order(p_session_id uuid, p_ordered_user_ids uuid[]) TO service_role;


--
-- Name: FUNCTION rpc_skeeball_standings(p_start date, p_end date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_skeeball_standings(p_start date, p_end date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_skeeball_standings(p_start date, p_end date) TO anon;
GRANT ALL ON FUNCTION public.rpc_skeeball_standings(p_start date, p_end date) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_skeeball_standings(p_start date, p_end date) TO service_role;


--
-- Name: FUNCTION rpc_skeeball_start_qr_session(p_token text, p_team_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_skeeball_start_qr_session(p_token text, p_team_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_skeeball_start_qr_session(p_token text, p_team_id uuid) TO anon;
GRANT ALL ON FUNCTION public.rpc_skeeball_start_qr_session(p_token text, p_team_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_skeeball_start_qr_session(p_token text, p_team_id uuid) TO service_role;


--
-- Name: FUNCTION rpc_skeeball_submit_balls(p_session_id uuid, p_balls jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_skeeball_submit_balls(p_session_id uuid, p_balls jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_skeeball_submit_balls(p_session_id uuid, p_balls jsonb) TO anon;
GRANT ALL ON FUNCTION public.rpc_skeeball_submit_balls(p_session_id uuid, p_balls jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_skeeball_submit_balls(p_session_id uuid, p_balls jsonb) TO service_role;


--
-- Name: FUNCTION rpc_skeeball_swap_session_player(p_session_id uuid, p_out_user_id uuid, p_in_user_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_skeeball_swap_session_player(p_session_id uuid, p_out_user_id uuid, p_in_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_skeeball_swap_session_player(p_session_id uuid, p_out_user_id uuid, p_in_user_id uuid) TO anon;
GRANT ALL ON FUNCTION public.rpc_skeeball_swap_session_player(p_session_id uuid, p_out_user_id uuid, p_in_user_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_skeeball_swap_session_player(p_session_id uuid, p_out_user_id uuid, p_in_user_id uuid) TO service_role;


--
-- Name: FUNCTION rpc_skeeball_team_stats(p_team_id uuid, p_start date, p_end date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_skeeball_team_stats(p_team_id uuid, p_start date, p_end date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_skeeball_team_stats(p_team_id uuid, p_start date, p_end date) TO anon;
GRANT ALL ON FUNCTION public.rpc_skeeball_team_stats(p_team_id uuid, p_start date, p_end date) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_skeeball_team_stats(p_team_id uuid, p_start date, p_end date) TO service_role;


--
-- Name: FUNCTION rpc_skeeball_team_week_history(p_team_id uuid, p_start date, p_end date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_skeeball_team_week_history(p_team_id uuid, p_start date, p_end date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_skeeball_team_week_history(p_team_id uuid, p_start date, p_end date) TO anon;
GRANT ALL ON FUNCTION public.rpc_skeeball_team_week_history(p_team_id uuid, p_start date, p_end date) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_skeeball_team_week_history(p_team_id uuid, p_start date, p_end date) TO service_role;


--
-- Name: FUNCTION rpc_skeeball_week_scoring_mode(p_week_of date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_skeeball_week_scoring_mode(p_week_of date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_skeeball_week_scoring_mode(p_week_of date) TO anon;
GRANT ALL ON FUNCTION public.rpc_skeeball_week_scoring_mode(p_week_of date) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_skeeball_week_scoring_mode(p_week_of date) TO service_role;


--
-- Name: FUNCTION rpc_skeeball_weekly_awards(p_start date, p_end date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_skeeball_weekly_awards(p_start date, p_end date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_skeeball_weekly_awards(p_start date, p_end date) TO anon;
GRANT ALL ON FUNCTION public.rpc_skeeball_weekly_awards(p_start date, p_end date) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_skeeball_weekly_awards(p_start date, p_end date) TO service_role;


--
-- Name: FUNCTION rpc_submit_feedback(p_category text, p_message text, p_rating integer, p_app_version text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_submit_feedback(p_category text, p_message text, p_rating integer, p_app_version text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_submit_feedback(p_category text, p_message text, p_rating integer, p_app_version text) TO anon;
GRANT ALL ON FUNCTION public.rpc_submit_feedback(p_category text, p_message text, p_rating integer, p_app_version text) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_submit_feedback(p_category text, p_message text, p_rating integer, p_app_version text) TO service_role;


--
-- Name: FUNCTION rpc_submit_score(p_game_id uuid, p_lane_id uuid, p_check_in_id uuid, p_venue_id uuid, p_score bigint, p_frame_data jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_submit_score(p_game_id uuid, p_lane_id uuid, p_check_in_id uuid, p_venue_id uuid, p_score bigint, p_frame_data jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_submit_score(p_game_id uuid, p_lane_id uuid, p_check_in_id uuid, p_venue_id uuid, p_score bigint, p_frame_data jsonb) TO anon;
GRANT ALL ON FUNCTION public.rpc_submit_score(p_game_id uuid, p_lane_id uuid, p_check_in_id uuid, p_venue_id uuid, p_score bigint, p_frame_data jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_submit_score(p_game_id uuid, p_lane_id uuid, p_check_in_id uuid, p_venue_id uuid, p_score bigint, p_frame_data jsonb) TO service_role;


--
-- Name: FUNCTION rpc_team_ban(p_team_id uuid, p_member_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_team_ban(p_team_id uuid, p_member_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_team_ban(p_team_id uuid, p_member_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_team_ban(p_team_id uuid, p_member_id uuid) TO service_role;


--
-- Name: FUNCTION rpc_team_kick(p_team_id uuid, p_member_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_team_kick(p_team_id uuid, p_member_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_team_kick(p_team_id uuid, p_member_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_team_kick(p_team_id uuid, p_member_id uuid) TO service_role;


--
-- Name: FUNCTION rpc_team_unban(p_team_id uuid, p_member_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_team_unban(p_team_id uuid, p_member_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_team_unban(p_team_id uuid, p_member_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_team_unban(p_team_id uuid, p_member_id uuid) TO service_role;


--
-- Name: FUNCTION rpc_trivia_join(p_game_id uuid, p_team_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_trivia_join(p_game_id uuid, p_team_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_trivia_join(p_game_id uuid, p_team_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_trivia_join(p_game_id uuid, p_team_id uuid) TO service_role;


--
-- Name: FUNCTION rpc_trivia_submit_answer(p_game_id uuid, p_question_id uuid, p_answer text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_trivia_submit_answer(p_game_id uuid, p_question_id uuid, p_answer text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_trivia_submit_answer(p_game_id uuid, p_question_id uuid, p_answer text) TO authenticated;
GRANT ALL ON FUNCTION public.rpc_trivia_submit_answer(p_game_id uuid, p_question_id uuid, p_answer text) TO service_role;


--
-- Name: FUNCTION set_user_role(target_user_id uuid, new_role text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.set_user_role(target_user_id uuid, new_role text) TO anon;
GRANT ALL ON FUNCTION public.set_user_role(target_user_id uuid, new_role text) TO authenticated;
GRANT ALL ON FUNCTION public.set_user_role(target_user_id uuid, new_role text) TO service_role;


--
-- Name: FUNCTION skeeball_current_week(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.skeeball_current_week() TO anon;
GRANT ALL ON FUNCTION public.skeeball_current_week() TO authenticated;
GRANT ALL ON FUNCTION public.skeeball_current_week() TO service_role;


--
-- Name: FUNCTION skeeball_lane_from_token(p_token text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.skeeball_lane_from_token(p_token text) TO anon;
GRANT ALL ON FUNCTION public.skeeball_lane_from_token(p_token text) TO authenticated;
GRANT ALL ON FUNCTION public.skeeball_lane_from_token(p_token text) TO service_role;


--
-- Name: FUNCTION skeeball_season_week_number(p_week date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.skeeball_season_week_number(p_week date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.skeeball_season_week_number(p_week date) TO anon;
GRANT ALL ON FUNCTION public.skeeball_season_week_number(p_week date) TO authenticated;
GRANT ALL ON FUNCTION public.skeeball_season_week_number(p_week date) TO service_role;


--
-- Name: FUNCTION sync_skeeball_lane_status(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.sync_skeeball_lane_status() TO anon;
GRANT ALL ON FUNCTION public.sync_skeeball_lane_status() TO authenticated;
GRANT ALL ON FUNCTION public.sync_skeeball_lane_status() TO service_role;


--
-- Name: FUNCTION user_earned_title_keys(p_uid uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.user_earned_title_keys(p_uid uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.user_earned_title_keys(p_uid uuid) TO anon;
GRANT ALL ON FUNCTION public.user_earned_title_keys(p_uid uuid) TO authenticated;
GRANT ALL ON FUNCTION public.user_earned_title_keys(p_uid uuid) TO service_role;


--
-- Name: FUNCTION validate_score_check_in(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.validate_score_check_in() TO anon;
GRANT ALL ON FUNCTION public.validate_score_check_in() TO authenticated;
GRANT ALL ON FUNCTION public.validate_score_check_in() TO service_role;


--
-- Name: TABLE admin_audit_log; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.admin_audit_log TO anon;
GRANT ALL ON TABLE public.admin_audit_log TO authenticated;
GRANT ALL ON TABLE public.admin_audit_log TO service_role;


--
-- Name: TABLE ai_verification_config; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.ai_verification_config TO anon;
GRANT ALL ON TABLE public.ai_verification_config TO authenticated;
GRANT ALL ON TABLE public.ai_verification_config TO service_role;


--
-- Name: TABLE app_announcements; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.app_announcements TO anon;
GRANT ALL ON TABLE public.app_announcements TO authenticated;
GRANT ALL ON TABLE public.app_announcements TO service_role;


--
-- Name: TABLE app_config; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.app_config TO anon;
GRANT ALL ON TABLE public.app_config TO authenticated;
GRANT ALL ON TABLE public.app_config TO service_role;


--
-- Name: TABLE beta_reports; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.beta_reports TO anon;
GRANT ALL ON TABLE public.beta_reports TO authenticated;
GRANT ALL ON TABLE public.beta_reports TO service_role;


--
-- Name: TABLE bug_reports; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.bug_reports TO anon;
GRANT ALL ON TABLE public.bug_reports TO authenticated;
GRANT ALL ON TABLE public.bug_reports TO service_role;


--
-- Name: TABLE check_ins; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.check_ins TO anon;
GRANT ALL ON TABLE public.check_ins TO authenticated;
GRANT ALL ON TABLE public.check_ins TO service_role;


--
-- Name: TABLE content_reports; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.content_reports TO anon;
GRANT ALL ON TABLE public.content_reports TO authenticated;
GRANT ALL ON TABLE public.content_reports TO service_role;


--
-- Name: TABLE conversations; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.conversations TO anon;
GRANT ALL ON TABLE public.conversations TO authenticated;
GRANT ALL ON TABLE public.conversations TO service_role;


--
-- Name: TABLE event_rsvps; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.event_rsvps TO anon;
GRANT ALL ON TABLE public.event_rsvps TO authenticated;
GRANT ALL ON TABLE public.event_rsvps TO service_role;


--
-- Name: TABLE fantasy_config; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.fantasy_config TO anon;
GRANT ALL ON TABLE public.fantasy_config TO authenticated;
GRANT ALL ON TABLE public.fantasy_config TO service_role;


--
-- Name: TABLE fantasy_predictions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.fantasy_predictions TO anon;
GRANT ALL ON TABLE public.fantasy_predictions TO authenticated;
GRANT ALL ON TABLE public.fantasy_predictions TO service_role;


--
-- Name: TABLE fantasy_roster_players; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.fantasy_roster_players TO anon;
GRANT ALL ON TABLE public.fantasy_roster_players TO authenticated;
GRANT ALL ON TABLE public.fantasy_roster_players TO service_role;


--
-- Name: TABLE fantasy_rosters; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.fantasy_rosters TO anon;
GRANT ALL ON TABLE public.fantasy_rosters TO authenticated;
GRANT ALL ON TABLE public.fantasy_rosters TO service_role;


--
-- Name: TABLE fantasy_transfers; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.fantasy_transfers TO anon;
GRANT ALL ON TABLE public.fantasy_transfers TO authenticated;
GRANT ALL ON TABLE public.fantasy_transfers TO service_role;


--
-- Name: TABLE fantasy_wallets; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.fantasy_wallets TO anon;
GRANT ALL ON TABLE public.fantasy_wallets TO authenticated;
GRANT ALL ON TABLE public.fantasy_wallets TO service_role;


--
-- Name: TABLE fantasy_week_bonuses; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.fantasy_week_bonuses TO anon;
GRANT ALL ON TABLE public.fantasy_week_bonuses TO authenticated;
GRANT ALL ON TABLE public.fantasy_week_bonuses TO service_role;


--
-- Name: TABLE feedback_submissions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.feedback_submissions TO anon;
GRANT ALL ON TABLE public.feedback_submissions TO authenticated;
GRANT ALL ON TABLE public.feedback_submissions TO service_role;


--
-- Name: TABLE ff_bracket_games; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.ff_bracket_games TO anon;
GRANT ALL ON TABLE public.ff_bracket_games TO authenticated;
GRANT ALL ON TABLE public.ff_bracket_games TO service_role;


--
-- Name: TABLE ff_bracket_groups; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.ff_bracket_groups TO anon;
GRANT ALL ON TABLE public.ff_bracket_groups TO authenticated;
GRANT ALL ON TABLE public.ff_bracket_groups TO service_role;


--
-- Name: TABLE ff_bracket_rounds; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.ff_bracket_rounds TO anon;
GRANT ALL ON TABLE public.ff_bracket_rounds TO authenticated;
GRANT ALL ON TABLE public.ff_bracket_rounds TO service_role;


--
-- Name: TABLE ff_bracket_scores; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.ff_bracket_scores TO anon;
GRANT ALL ON TABLE public.ff_bracket_scores TO authenticated;
GRANT ALL ON TABLE public.ff_bracket_scores TO service_role;


--
-- Name: TABLE ff_bracket_slots; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.ff_bracket_slots TO anon;
GRANT ALL ON TABLE public.ff_bracket_slots TO authenticated;
GRANT ALL ON TABLE public.ff_bracket_slots TO service_role;


--
-- Name: TABLE follows; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.follows TO anon;
GRANT ALL ON TABLE public.follows TO authenticated;
GRANT ALL ON TABLE public.follows TO service_role;


--
-- Name: TABLE forum_poll_votes; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.forum_poll_votes TO anon;
GRANT ALL ON TABLE public.forum_poll_votes TO authenticated;
GRANT ALL ON TABLE public.forum_poll_votes TO service_role;


--
-- Name: TABLE forum_polls; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.forum_polls TO anon;
GRANT ALL ON TABLE public.forum_polls TO authenticated;
GRANT ALL ON TABLE public.forum_polls TO service_role;


--
-- Name: TABLE forum_post_comments; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.forum_post_comments TO anon;
GRANT ALL ON TABLE public.forum_post_comments TO authenticated;
GRANT ALL ON TABLE public.forum_post_comments TO service_role;


--
-- Name: TABLE forum_posts; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.forum_posts TO anon;
GRANT ALL ON TABLE public.forum_posts TO authenticated;
GRANT ALL ON TABLE public.forum_posts TO service_role;


--
-- Name: TABLE forums; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.forums TO anon;
GRANT ALL ON TABLE public.forums TO authenticated;
GRANT ALL ON TABLE public.forums TO service_role;


--
-- Name: TABLE friendships; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.friendships TO anon;
GRANT ALL ON TABLE public.friendships TO authenticated;
GRANT ALL ON TABLE public.friendships TO service_role;


--
-- Name: TABLE game_reference_photos; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.game_reference_photos TO anon;
GRANT ALL ON TABLE public.game_reference_photos TO authenticated;
GRANT ALL ON TABLE public.game_reference_photos TO service_role;


--
-- Name: TABLE games; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.games TO anon;
GRANT ALL ON TABLE public.games TO authenticated;
GRANT ALL ON TABLE public.games TO service_role;


--
-- Name: TABLE karaoke_queue; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.karaoke_queue TO anon;
GRANT ALL ON TABLE public.karaoke_queue TO authenticated;
GRANT ALL ON TABLE public.karaoke_queue TO service_role;


--
-- Name: TABLE karaoke_search_cache; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.karaoke_search_cache TO anon;
GRANT ALL ON TABLE public.karaoke_search_cache TO authenticated;
GRANT ALL ON TABLE public.karaoke_search_cache TO service_role;


--
-- Name: TABLE lane_qr_tokens; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.lane_qr_tokens TO anon;
GRANT ALL ON TABLE public.lane_qr_tokens TO authenticated;
GRANT ALL ON TABLE public.lane_qr_tokens TO service_role;


--
-- Name: TABLE lanes; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.lanes TO anon;
GRANT ALL ON TABLE public.lanes TO authenticated;
GRANT ALL ON TABLE public.lanes TO service_role;


--
-- Name: TABLE league_rsvps; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.league_rsvps TO anon;
GRANT ALL ON TABLE public.league_rsvps TO authenticated;
GRANT ALL ON TABLE public.league_rsvps TO service_role;


--
-- Name: TABLE league_teams; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.league_teams TO anon;
GRANT ALL ON TABLE public.league_teams TO authenticated;
GRANT ALL ON TABLE public.league_teams TO service_role;


--
-- Name: TABLE matches; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.matches TO anon;
GRANT ALL ON TABLE public.matches TO authenticated;
GRANT ALL ON TABLE public.matches TO service_role;


--
-- Name: TABLE menu_items; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.menu_items TO anon;
GRANT ALL ON TABLE public.menu_items TO authenticated;
GRANT ALL ON TABLE public.menu_items TO service_role;


--
-- Name: TABLE messages; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.messages TO anon;
GRANT ALL ON TABLE public.messages TO authenticated;
GRANT ALL ON TABLE public.messages TO service_role;


--
-- Name: TABLE moderation_patterns; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.moderation_patterns TO anon;
GRANT ALL ON TABLE public.moderation_patterns TO authenticated;
GRANT ALL ON TABLE public.moderation_patterns TO service_role;


--
-- Name: SEQUENCE moderation_patterns_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.moderation_patterns_id_seq TO anon;
GRANT ALL ON SEQUENCE public.moderation_patterns_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.moderation_patterns_id_seq TO service_role;


--
-- Name: TABLE pickem_picks; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.pickem_picks TO anon;
GRANT ALL ON TABLE public.pickem_picks TO authenticated;
GRANT ALL ON TABLE public.pickem_picks TO service_role;


--
-- Name: TABLE post_comments; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.post_comments TO anon;
GRANT ALL ON TABLE public.post_comments TO authenticated;
GRANT ALL ON TABLE public.post_comments TO service_role;


--
-- Name: TABLE post_likes; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.post_likes TO anon;
GRANT ALL ON TABLE public.post_likes TO authenticated;
GRANT ALL ON TABLE public.post_likes TO service_role;


--
-- Name: TABLE post_reactions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.post_reactions TO anon;
GRANT ALL ON TABLE public.post_reactions TO authenticated;
GRANT ALL ON TABLE public.post_reactions TO service_role;


--
-- Name: TABLE posts; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.posts TO anon;
GRANT ALL ON TABLE public.posts TO authenticated;
GRANT ALL ON TABLE public.posts TO service_role;


--
-- Name: TABLE profiles; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.profiles TO anon;
GRANT ALL ON TABLE public.profiles TO authenticated;
GRANT ALL ON TABLE public.profiles TO service_role;


--
-- Name: TABLE public_profiles; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.public_profiles TO anon;
GRANT ALL ON TABLE public.public_profiles TO authenticated;
GRANT ALL ON TABLE public.public_profiles TO service_role;


--
-- Name: TABLE push_tokens; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.push_tokens TO anon;
GRANT ALL ON TABLE public.push_tokens TO authenticated;
GRANT ALL ON TABLE public.push_tokens TO service_role;


--
-- Name: TABLE rate_limit_log; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.rate_limit_log TO anon;
GRANT ALL ON TABLE public.rate_limit_log TO authenticated;
GRANT ALL ON TABLE public.rate_limit_log TO service_role;


--
-- Name: SEQUENCE rate_limit_log_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.rate_limit_log_id_seq TO anon;
GRANT ALL ON SEQUENCE public.rate_limit_log_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.rate_limit_log_id_seq TO service_role;


--
-- Name: TABLE saved_posts; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.saved_posts TO anon;
GRANT ALL ON TABLE public.saved_posts TO authenticated;
GRANT ALL ON TABLE public.saved_posts TO service_role;


--
-- Name: TABLE score_corrections; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.score_corrections TO anon;
GRANT ALL ON TABLE public.score_corrections TO authenticated;
GRANT ALL ON TABLE public.score_corrections TO service_role;


--
-- Name: TABLE score_disputes; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.score_disputes TO anon;
GRANT ALL ON TABLE public.score_disputes TO authenticated;
GRANT ALL ON TABLE public.score_disputes TO service_role;


--
-- Name: TABLE scores; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.scores TO anon;
GRANT ALL ON TABLE public.scores TO authenticated;
GRANT ALL ON TABLE public.scores TO service_role;


--
-- Name: TABLE seasons; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.seasons TO anon;
GRANT ALL ON TABLE public.seasons TO authenticated;
GRANT ALL ON TABLE public.seasons TO service_role;


--
-- Name: TABLE security_events; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.security_events TO anon;
GRANT ALL ON TABLE public.security_events TO authenticated;
GRANT ALL ON TABLE public.security_events TO service_role;


--
-- Name: TABLE skeeball_ball_scores; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.skeeball_ball_scores TO anon;
GRANT ALL ON TABLE public.skeeball_ball_scores TO authenticated;
GRANT ALL ON TABLE public.skeeball_ball_scores TO service_role;


--
-- Name: TABLE skeeball_league_matches; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.skeeball_league_matches TO anon;
GRANT ALL ON TABLE public.skeeball_league_matches TO authenticated;
GRANT ALL ON TABLE public.skeeball_league_matches TO service_role;


--
-- Name: TABLE skeeball_sessions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.skeeball_sessions TO anon;
GRANT ALL ON TABLE public.skeeball_sessions TO authenticated;
GRANT ALL ON TABLE public.skeeball_sessions TO service_role;


--
-- Name: TABLE teams; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.teams TO anon;
GRANT ALL ON TABLE public.teams TO authenticated;
GRANT ALL ON TABLE public.teams TO service_role;


--
-- Name: TABLE skeeball_league_standings; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.skeeball_league_standings TO anon;
GRANT ALL ON TABLE public.skeeball_league_standings TO authenticated;
GRANT ALL ON TABLE public.skeeball_league_standings TO service_role;


--
-- Name: TABLE skeeball_seasons; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.skeeball_seasons TO anon;
GRANT ALL ON TABLE public.skeeball_seasons TO authenticated;
GRANT ALL ON TABLE public.skeeball_seasons TO service_role;


--
-- Name: TABLE skeeball_session_players; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.skeeball_session_players TO anon;
GRANT ALL ON TABLE public.skeeball_session_players TO authenticated;
GRANT ALL ON TABLE public.skeeball_session_players TO service_role;


--
-- Name: TABLE square_payment_statuses; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.square_payment_statuses TO anon;
GRANT ALL ON TABLE public.square_payment_statuses TO authenticated;
GRANT ALL ON TABLE public.square_payment_statuses TO service_role;


--
-- Name: TABLE square_webhook_events; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.square_webhook_events TO anon;
GRANT ALL ON TABLE public.square_webhook_events TO authenticated;
GRANT ALL ON TABLE public.square_webhook_events TO service_role;


--
-- Name: TABLE storage_cleanup_queue; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.storage_cleanup_queue TO anon;
GRANT ALL ON TABLE public.storage_cleanup_queue TO authenticated;
GRANT ALL ON TABLE public.storage_cleanup_queue TO service_role;


--
-- Name: TABLE sub_requests; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.sub_requests TO anon;
GRANT ALL ON TABLE public.sub_requests TO authenticated;
GRANT ALL ON TABLE public.sub_requests TO service_role;


--
-- Name: TABLE support_messages; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.support_messages TO anon;
GRANT ALL ON TABLE public.support_messages TO authenticated;
GRANT ALL ON TABLE public.support_messages TO service_role;


--
-- Name: TABLE support_tickets; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.support_tickets TO anon;
GRANT ALL ON TABLE public.support_tickets TO authenticated;
GRANT ALL ON TABLE public.support_tickets TO service_role;


--
-- Name: TABLE team_announcements; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.team_announcements TO anon;
GRANT ALL ON TABLE public.team_announcements TO authenticated;
GRANT ALL ON TABLE public.team_announcements TO service_role;


--
-- Name: TABLE team_bans; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.team_bans TO anon;
GRANT ALL ON TABLE public.team_bans TO authenticated;
GRANT ALL ON TABLE public.team_bans TO service_role;


--
-- Name: TABLE team_members; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.team_members TO anon;
GRANT ALL ON TABLE public.team_members TO authenticated;
GRANT ALL ON TABLE public.team_members TO service_role;


--
-- Name: TABLE team_messages; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.team_messages TO anon;
GRANT ALL ON TABLE public.team_messages TO authenticated;
GRANT ALL ON TABLE public.team_messages TO service_role;


--
-- Name: TABLE team_registrations; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.team_registrations TO anon;
GRANT ALL ON TABLE public.team_registrations TO authenticated;
GRANT ALL ON TABLE public.team_registrations TO service_role;


--
-- Name: TABLE team_requests; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.team_requests TO anon;
GRANT ALL ON TABLE public.team_requests TO authenticated;
GRANT ALL ON TABLE public.team_requests TO service_role;


--
-- Name: TABLE team_schedule; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.team_schedule TO anon;
GRANT ALL ON TABLE public.team_schedule TO authenticated;
GRANT ALL ON TABLE public.team_schedule TO service_role;


--
-- Name: TABLE throws; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.throws TO anon;
GRANT ALL ON TABLE public.throws TO authenticated;
GRANT ALL ON TABLE public.throws TO service_role;


--
-- Name: TABLE tournament_placements; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.tournament_placements TO anon;
GRANT ALL ON TABLE public.tournament_placements TO authenticated;
GRANT ALL ON TABLE public.tournament_placements TO service_role;


--
-- Name: TABLE tournament_registrations; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.tournament_registrations TO anon;
GRANT ALL ON TABLE public.tournament_registrations TO authenticated;
GRANT ALL ON TABLE public.tournament_registrations TO service_role;


--
-- Name: TABLE tournament_requests; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.tournament_requests TO anon;
GRANT ALL ON TABLE public.tournament_requests TO authenticated;
GRANT ALL ON TABLE public.tournament_requests TO service_role;


--
-- Name: TABLE tournament_results; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.tournament_results TO anon;
GRANT ALL ON TABLE public.tournament_results TO authenticated;
GRANT ALL ON TABLE public.tournament_results TO service_role;


--
-- Name: TABLE tournaments; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.tournaments TO anon;
GRANT ALL ON TABLE public.tournaments TO authenticated;
GRANT ALL ON TABLE public.tournaments TO service_role;


--
-- Name: TABLE trivia_answers; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.trivia_answers TO anon;
GRANT ALL ON TABLE public.trivia_answers TO authenticated;
GRANT ALL ON TABLE public.trivia_answers TO service_role;


--
-- Name: TABLE trivia_events; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.trivia_events TO anon;
GRANT ALL ON TABLE public.trivia_events TO authenticated;
GRANT ALL ON TABLE public.trivia_events TO service_role;


--
-- Name: TABLE trivia_game_questions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.trivia_game_questions TO anon;
GRANT ALL ON TABLE public.trivia_game_questions TO authenticated;
GRANT ALL ON TABLE public.trivia_game_questions TO service_role;


--
-- Name: TABLE trivia_games; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.trivia_games TO anon;
GRANT ALL ON TABLE public.trivia_games TO authenticated;
GRANT ALL ON TABLE public.trivia_games TO service_role;


--
-- Name: TABLE trivia_participants; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.trivia_participants TO anon;
GRANT ALL ON TABLE public.trivia_participants TO authenticated;
GRANT ALL ON TABLE public.trivia_participants TO service_role;


--
-- Name: TABLE trivia_questions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.trivia_questions TO anon;
GRANT ALL ON TABLE public.trivia_questions TO authenticated;
GRANT ALL ON TABLE public.trivia_questions TO service_role;


--
-- Name: TABLE trivia_team_members; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.trivia_team_members TO anon;
GRANT ALL ON TABLE public.trivia_team_members TO authenticated;
GRANT ALL ON TABLE public.trivia_team_members TO service_role;


--
-- Name: TABLE trivia_teams; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.trivia_teams TO anon;
GRANT ALL ON TABLE public.trivia_teams TO authenticated;
GRANT ALL ON TABLE public.trivia_teams TO service_role;


--
-- Name: TABLE user_blocks; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.user_blocks TO anon;
GRANT ALL ON TABLE public.user_blocks TO authenticated;
GRANT ALL ON TABLE public.user_blocks TO service_role;


--
-- Name: TABLE user_public_keys; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.user_public_keys TO anon;
GRANT ALL ON TABLE public.user_public_keys TO authenticated;
GRANT ALL ON TABLE public.user_public_keys TO service_role;


--
-- Name: TABLE user_titles; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.user_titles TO anon;
GRANT ALL ON TABLE public.user_titles TO authenticated;
GRANT ALL ON TABLE public.user_titles TO service_role;


--
-- Name: TABLE venue_admins; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.venue_admins TO anon;
GRANT ALL ON TABLE public.venue_admins TO authenticated;
GRANT ALL ON TABLE public.venue_admins TO service_role;


--
-- Name: TABLE venue_events; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.venue_events TO anon;
GRANT ALL ON TABLE public.venue_events TO authenticated;
GRANT ALL ON TABLE public.venue_events TO service_role;


--
-- Name: TABLE venues; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.venues TO anon;
GRANT ALL ON TABLE public.venues TO authenticated;
GRANT ALL ON TABLE public.venues TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- PostgreSQL database dump complete
--
