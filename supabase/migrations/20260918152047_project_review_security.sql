-- Project review fixes. Apply AFTER the existing schema has been baselined.
-- Tested against the checked-in regression fixture; verify staging before production.
BEGIN;

ALTER TABLE public.team_registrations
  ADD COLUMN IF NOT EXISTS expected_amount_cents integer,
  ADD COLUMN IF NOT EXISTS expected_currency text,
  ADD COLUMN IF NOT EXISTS square_location_id text;

DROP POLICY IF EXISTS "user_own_registration_insert" ON public.team_registrations;
CREATE POLICY "user_own_registration_insert" ON public.team_registrations
  FOR INSERT TO authenticated WITH CHECK (
    user_id = (SELECT auth.uid()) AND status = 'pending_payment' AND team_id IS NULL
    AND square_payment_link_id IS NULL AND square_order_id IS NULL AND checkout_url IS NULL
    AND paid_at IS NULL AND expected_amount_cents IS NULL AND expected_currency IS NULL
    AND square_location_id IS NULL
  );
DROP POLICY IF EXISTS "admin_registration_update" ON public.team_registrations;
CREATE POLICY "admin_registration_update" ON public.team_registrations
  FOR UPDATE TO authenticated USING (public.is_admin() AND (auth.jwt()->>'aal') = 'aal2')
  WITH CHECK (public.is_admin() AND (auth.jwt()->>'aal') = 'aal2');

-- Bind each paid entitlement once, even when two team inserts race.
ALTER TABLE public.team_registrations ALTER CONSTRAINT team_registrations_team_id_fkey DEFERRABLE INITIALLY DEFERRED;
CREATE OR REPLACE FUNCTION public.enforce_team_creation_payment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE registration_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM seasons WHERE status = 'active' AND registration_required) THEN RETURN NEW; END IF;
  IF (auth.jwt()->>'role') = 'service_role' THEN RETURN NEW; END IF;
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Login required'; END IF;
  IF public.is_admin() THEN PERFORM public.require_mfa(); RETURN NEW; END IF;
  SELECT tr.id INTO registration_id FROM team_registrations tr
    JOIN seasons s ON s.id = tr.season_id
    WHERE tr.user_id = auth.uid() AND tr.status = 'paid' AND tr.registration_type = 'team'
      AND tr.team_id IS NULL AND s.status = 'active' AND s.registration_required
    ORDER BY tr.created_at LIMIT 1 FOR UPDATE OF tr;
  IF registration_id IS NULL THEN RAISE EXCEPTION 'An unused paid team registration is required.'; END IF;
  UPDATE team_registrations SET team_id = NEW.id WHERE id = registration_id;
  RETURN NEW;
END; $$;

ALTER TABLE public.square_webhook_events ADD COLUMN IF NOT EXISTS processed_at timestamptz;
ALTER TABLE public.square_payment_statuses ADD COLUMN IF NOT EXISTS provider_updated_at timestamptz;
CREATE OR REPLACE FUNCTION public.process_square_webhook(p_event jsonb, p_order jsonb, p_payment jsonb, p_verified_paid boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  event_key text := p_event->>'event_id';
  order_key text := p_order->>'id';
  payment_key text := p_payment->>'id';
  state text := COALESCE(p_payment->>'status', p_order->>'state');
  provider_time timestamptz := COALESCE((p_payment->>'updated_at')::timestamptz, (p_order->>'updated_at')::timestamptz, (p_event->>'created_at')::timestamptz);
  processed timestamptz;
  status_id uuid;
  reg team_registrations%ROWTYPE;
BEGIN
  IF COALESCE(auth.jwt()->>'role','') <> 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF event_key IS NULL OR order_key IS NULL OR provider_time IS NULL THEN RAISE EXCEPTION 'invalid_event'; END IF;
  -- Lock by order as well as event, so payment-first and order-first delivery converge.
  PERFORM pg_advisory_xact_lock(hashtextextended('square:' || order_key, 0));
  INSERT INTO square_webhook_events(event_id,event_type,merchant_id,payload)
    VALUES(event_key,p_event->>'type',p_event->>'merchant_id',p_event) ON CONFLICT(event_id) DO NOTHING;
  SELECT processed_at INTO processed FROM square_webhook_events WHERE event_id = event_key FOR UPDATE;
  IF processed IS NOT NULL THEN RETURN jsonb_build_object('ok',true,'duplicate',true); END IF;
  SELECT id INTO status_id FROM square_payment_statuses
    WHERE square_order_id = order_key OR (payment_key IS NOT NULL AND square_payment_id = payment_key)
    ORDER BY (square_order_id = order_key) DESC LIMIT 1 FOR UPDATE;
  IF status_id IS NULL THEN
    INSERT INTO square_payment_statuses(square_payment_id,square_order_id,status,event_type,last_event_id,raw_event,provider_updated_at)
      VALUES(payment_key,order_key,state,p_event->>'type',event_key,p_event,provider_time);
  ELSE
    UPDATE square_payment_statuses SET
      square_payment_id = COALESCE(square_payment_id,payment_key), square_order_id = order_key,
      status = CASE WHEN status = 'COMPLETED' AND state IN ('OPEN','APPROVED','PENDING') THEN status ELSE state END,
      event_type = p_event->>'type', last_event_id = event_key, raw_event = p_event,
      provider_updated_at = provider_time, updated_at = now()
      WHERE id = status_id AND (provider_updated_at IS NULL OR provider_updated_at <= provider_time);
  END IF;
  SELECT * INTO reg FROM team_registrations WHERE square_order_id = order_key FOR UPDATE;
  IF reg.id IS NULL AND p_order->>'reference_id' LIKE 'reg:%' THEN
    -- The provider may deliver before checkout mapping commits. Retry instead of dropping it.
    RAISE EXCEPTION 'registration_mapping_not_ready';
  END IF;
  IF reg.id IS NOT NULL AND p_verified_paid AND reg.status = 'pending_payment' THEN
    IF p_order->>'reference_id' IS DISTINCT FROM 'reg:' || reg.id::text
      OR reg.expected_amount_cents IS NULL
      OR reg.expected_amount_cents IS DISTINCT FROM (p_order#>>'{total_money,amount}')::integer
      OR reg.expected_currency IS DISTINCT FROM p_order#>>'{total_money,currency}'
      OR reg.square_location_id IS DISTINCT FROM p_order->>'location_id'
    THEN RAISE EXCEPTION 'registration_payment_mismatch'; END IF;
    UPDATE team_registrations SET status = 'paid', paid_at = now() WHERE id = reg.id;
  END IF;
  UPDATE square_webhook_events SET processed_at = now() WHERE event_id = event_key;
  RETURN jsonb_build_object('ok',true);
END; $$;
REVOKE ALL ON FUNCTION public.process_square_webhook(jsonb,jsonb,jsonb,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_square_webhook(jsonb,jsonb,jsonb,boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.set_user_role(target_user_id uuid, new_role text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE caller_role text; target_role text; caller_rank int; target_rank int; next_rank int;
BEGIN
  PERFORM public.require_mfa();
  SELECT role INTO caller_role FROM profiles WHERE id = auth.uid();
  SELECT role INTO target_role FROM profiles WHERE id = target_user_id FOR UPDATE;
  caller_rank := array_position(ARRAY['user','admin','owner','architect'],caller_role);
  target_rank := array_position(ARRAY['user','admin','owner','architect'],target_role);
  next_rank := array_position(ARRAY['user','admin','owner','architect'],new_role);
  IF caller_rank IS NULL OR caller_rank < 2 OR target_rank IS NULL OR next_rank IS NULL
    OR target_user_id = auth.uid() OR target_rank >= caller_rank OR next_rank >= caller_rank THEN
    RAISE EXCEPTION 'Role change is not permitted';
  END IF;
  UPDATE profiles SET role = new_role, is_admin = new_role IN ('admin','owner','architect') WHERE id = target_user_id;
  INSERT INTO admin_audit_log(admin_id,action,target_type,target_id,details)
    VALUES(auth.uid(),'set_user_role','user',target_user_id::text,jsonb_build_object('old_role',target_role,'new_role',new_role));
END; $$;
REVOKE ALL ON FUNCTION public.set_user_role(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_user_role(uuid,text) TO authenticated;

-- Private storage is bounded at upload as well as at moderation download.
UPDATE storage.buckets SET file_size_limit = 5242880, allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp']
  WHERE id IN ('media-quarantine','message-media');
UPDATE storage.buckets SET public = false WHERE id IN ('media-quarantine','message-media');

-- Validate the complete nine-ball payload before any write. Exception blocks roll back the entire call.
CREATE OR REPLACE FUNCTION public.rpc_skeeball_submit_balls(p_session_id uuid, p_balls jsonb)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_session skeeball_sessions%ROWTYPE; v_players int; v_invalid boolean;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM skeeball_session_players WHERE session_id=p_session_id AND player_user_id=auth.uid()
  ) THEN RAISE EXCEPTION 'You are not a player in this session'; END IF;
  SELECT * INTO v_session FROM skeeball_sessions WHERE id=p_session_id FOR UPDATE;
  IF v_session.id IS NULL THEN RAISE EXCEPTION 'Session not found'; END IF;
  IF v_session.status NOT IN ('active','completed') THEN RAISE EXCEPTION 'Session is no longer active'; END IF;
  IF jsonb_typeof(p_balls) IS DISTINCT FROM 'array' OR jsonb_array_length(p_balls) <> 9 THEN
    RAISE EXCEPTION 'Submit exactly nine balls';
  END IF;
  SELECT count(*) INTO v_players FROM skeeball_session_players WHERE session_id=p_session_id;
  IF v_players NOT BETWEEN 1 AND 3 THEN RAISE EXCEPTION 'Invalid lineup'; END IF;
  WITH lineup AS (
    SELECT player_user_id, row_number() OVER(ORDER BY shoot_position NULLS LAST, player_user_id)::int AS position
    FROM skeeball_session_players WHERE session_id=p_session_id
  ), expected AS (
    SELECT l.player_user_id, generate_series(1, 3 * (1 + (3-l.position)/v_players)) AS ball_number FROM lineup l
  ), balls AS (
    SELECT (b->>'player_user_id')::uuid player_user_id, (b->>'ball_number')::int ball_number, (b->>'score')::int score
    FROM jsonb_array_elements(p_balls) b
  )
  SELECT EXISTS (
    SELECT 1 FROM balls b LEFT JOIN expected e USING(player_user_id,ball_number)
    WHERE e.player_user_id IS NULL OR b.score IS NULL OR b.score NOT IN(10,20,30,40,50,100)
  ) OR (SELECT count(DISTINCT (player_user_id,ball_number)) FROM balls) <> 9 INTO v_invalid;
  IF v_invalid THEN RAISE EXCEPTION 'Invalid player, ball allocation or ring value'; END IF;
  IF v_session.status='completed' THEN
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_balls) b
      LEFT JOIN skeeball_ball_scores s ON s.session_id=p_session_id AND s.player_user_id=(b->>'player_user_id')::uuid AND s.ball_number=(b->>'ball_number')::int
      WHERE s.score IS DISTINCT FROM (b->>'score')::int
    ) THEN RAISE EXCEPTION 'Completed scores cannot be changed'; END IF;
    RETURN json_build_object('ok',true,'already_completed',true);
  END IF;
  DELETE FROM skeeball_ball_scores WHERE session_id=p_session_id;
  INSERT INTO skeeball_ball_scores(session_id,player_user_id,ball_number,score)
    SELECT p_session_id,(b->>'player_user_id')::uuid,(b->>'ball_number')::int,(b->>'score')::int FROM jsonb_array_elements(p_balls) b;
  UPDATE skeeball_sessions SET last_activity_at=now() WHERE id=p_session_id;
  RETURN json_build_object('ok',true);
END; $$;
REVOKE ALL ON FUNCTION public.rpc_skeeball_submit_balls(uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.rpc_skeeball_submit_balls(uuid,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.rpc_skeeball_finalize_match(
  p_match_id uuid,
  p_force boolean DEFAULT false
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
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
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Login required'; END IF;
  IF p_force THEN
    PERFORM public.require_mfa();
    IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator required'; END IF;
  ELSIF NOT public.is_admin() AND NOT EXISTS (
    SELECT 1 FROM skeeball_sessions s JOIN skeeball_session_players p ON p.session_id=s.id
    WHERE s.league_match_id=p_match_id AND p.player_user_id=auth.uid()
  ) THEN RAISE EXCEPTION 'Match participation required'; END IF;
  SELECT COALESCE(expected_teams, 4), week_of, scoring_mode
    INTO v_expected, v_week, v_mode
    FROM skeeball_league_matches WHERE id = p_match_id FOR UPDATE;
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

REVOKE ALL ON FUNCTION public.rpc_skeeball_finalize_match(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_skeeball_finalize_match(uuid, boolean) TO authenticated;



CREATE OR REPLACE FUNCTION public.rpc_skeeball_complete_session(p_session_id uuid)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_session record;
  v_lane record;
  v_game_id uuid;
  v_ball_count int;
  v_finalize json;
  v_balls jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RETURN json_build_object('error', 'not_authenticated');
  END IF;

  -- Consistent lock order: match, then session, across completion and forced finalization.
  PERFORM 1 FROM skeeball_league_matches WHERE id=(SELECT league_match_id FROM skeeball_sessions WHERE id=p_session_id) FOR UPDATE;
  SELECT s.* INTO v_session
    FROM public.skeeball_sessions s
   WHERE s.id = p_session_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'not_found');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM skeeball_session_players WHERE session_id=p_session_id AND player_user_id=v_uid) THEN
    RAISE EXCEPTION 'Only session players can finalize this game';
  END IF;
  IF v_session.status = 'completed' THEN RETURN json_build_object('ok',true,'already_completed',true); END IF;
  IF v_session.status <> 'active' THEN RAISE EXCEPTION 'Session is no longer active'; END IF;
  SELECT jsonb_agg(jsonb_build_object('player_user_id',player_user_id,'ball_number',ball_number,'score',score)) INTO v_balls
    FROM skeeball_ball_scores WHERE session_id=p_session_id;
  PERFORM public.rpc_skeeball_submit_balls(p_session_id,COALESCE(v_balls,'[]'::jsonb));

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
$$;


CREATE OR REPLACE FUNCTION public.rpc_karaoke_next(
  p_current_id uuid DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_next record;
BEGIN
  PERFORM public.require_mfa();
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator required'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('karaoke-playback',0));
  -- Mark the current song as played
  IF p_current_id IS NOT NULL THEN
    UPDATE karaoke_queue
       SET status = 'played'
     WHERE id = p_current_id
       AND status = 'playing';
    IF NOT FOUND THEN RAISE EXCEPTION 'Song is not currently playing'; END IF;
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

REVOKE ALL ON FUNCTION public.rpc_karaoke_next(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_karaoke_next(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.rpc_karaoke_next(uuid) FROM anon;


CREATE OR REPLACE FUNCTION public.rpc_skeeball_submit_and_complete(p_session_id uuid,p_balls jsonb)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE result json;
BEGIN
  PERFORM 1 FROM skeeball_league_matches WHERE id=(SELECT league_match_id FROM skeeball_sessions WHERE id=p_session_id) FOR UPDATE;
  PERFORM public.rpc_skeeball_submit_balls(p_session_id,p_balls);
  result := public.rpc_skeeball_complete_session(p_session_id);
  IF (result->>'ok') IS DISTINCT FROM 'true' THEN RAISE EXCEPTION '%',result; END IF;
  RETURN result;
END; $$;
REVOKE ALL ON FUNCTION public.rpc_skeeball_submit_and_complete(uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.rpc_skeeball_submit_and_complete(uuid,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.rpc_skeeball_team_high_scores(p_limit integer DEFAULT 100,p_offset integer DEFAULT 0)
RETURNS TABLE(team_id uuid,team_name text,total_score bigint,week_of date,rank bigint)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
  WITH totals AS (
    SELECT s.id,s.team_id,t.name team_name,s.week_of,COALESCE(sum(b.score),0)+COALESCE(s.score_adjustment,0) total_score
    FROM skeeball_sessions s JOIN teams t ON t.id=s.team_id LEFT JOIN skeeball_ball_scores b ON b.session_id=s.id
    WHERE s.status='completed' GROUP BY s.id,t.name
  ), best AS (
    SELECT DISTINCT ON(team_id) * FROM totals ORDER BY team_id,total_score DESC,week_of DESC,id
  ) SELECT team_id,team_name,total_score,week_of,dense_rank() OVER(ORDER BY total_score DESC) rank FROM best
    ORDER BY total_score DESC,team_id LIMIT LEAST(GREATEST(p_limit,1),100) OFFSET GREATEST(p_offset,0);
$$;
REVOKE ALL ON FUNCTION public.rpc_skeeball_team_high_scores(integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.rpc_skeeball_team_high_scores(integer,integer) TO authenticated;

CREATE TABLE IF NOT EXISTS public.service_quotas (
  scope text PRIMARY KEY, window_start timestamptz NOT NULL, used integer NOT NULL
);
ALTER TABLE public.service_quotas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.service_quotas FROM anon,authenticated;
CREATE OR REPLACE FUNCTION public.consume_service_quota(p_scope text,p_limit integer,p_seconds integer)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_used integer;
BEGIN
  IF COALESCE(auth.jwt()->>'role','') <> 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_limit < 1 OR p_seconds < 1 OR length(p_scope)>250 THEN RAISE EXCEPTION 'invalid quota'; END IF;
  INSERT INTO service_quotas(scope,window_start,used) VALUES(p_scope,now(),1)
  ON CONFLICT(scope) DO UPDATE SET
    used=CASE WHEN service_quotas.window_start + make_interval(secs=>p_seconds) <= now() THEN 1 ELSE service_quotas.used+1 END,
    window_start=CASE WHEN service_quotas.window_start + make_interval(secs=>p_seconds) <= now() THEN now() ELSE service_quotas.window_start END
  RETURNING used INTO v_used;
  RETURN v_used <= p_limit;
END; $$;
REVOKE ALL ON FUNCTION public.consume_service_quota(text,integer,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.consume_service_quota(text,integer,integer) TO service_role;

CREATE TABLE IF NOT EXISTS public.media_ownership (
  bucket_id text NOT NULL, path text NOT NULL, user_id uuid NOT NULL, PRIMARY KEY(bucket_id,path)
);
ALTER TABLE public.media_ownership ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.media_ownership FROM anon,authenticated;
GRANT ALL ON public.media_ownership TO service_role;
CREATE INDEX IF NOT EXISTS media_ownership_user_idx ON public.media_ownership(user_id);
CREATE TABLE IF NOT EXISTS public.account_deletion_jobs (
  user_id uuid PRIMARY KEY, stage text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.account_deletion_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.account_deletion_jobs FROM anon,authenticated;
GRANT ALL ON public.account_deletion_jobs TO service_role;

CREATE OR REPLACE FUNCTION public.account_storage_inventory(p_user_id uuid,p_limit integer DEFAULT 100)
RETURNS TABLE(bucket_id text,name text) LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF COALESCE(auth.jwt()->>'role','') <> 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;
  RETURN QUERY SELECT o.bucket_id,o.name FROM storage.objects o
    WHERE o.owner_id=p_user_id::text
      OR (o.bucket_id IN ('avatars','post-photos','score-proofs','media-quarantine') AND split_part(o.name,'/',1)=p_user_id::text)
      OR (o.bucket_id='message-media' AND (split_part(o.name,'/',2)=p_user_id::text OR split_part(o.name,'/',1)=p_user_id::text))
      OR (o.bucket_id='team-photos' AND EXISTS(SELECT 1 FROM teams t WHERE t.id::text=split_part(o.name,'/',1) AND t.captain_user_id=p_user_id)
        AND NOT EXISTS(SELECT 1 FROM media_ownership m WHERE m.bucket_id=o.bucket_id AND m.path=o.name))
      OR EXISTS(SELECT 1 FROM media_ownership m WHERE m.bucket_id=o.bucket_id AND m.path=o.name AND m.user_id=p_user_id)
    ORDER BY o.bucket_id,o.name LIMIT LEAST(GREATEST(p_limit,1),1000);
END; $$;
REVOKE ALL ON FUNCTION public.account_storage_inventory(uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.account_storage_inventory(uuid,integer) TO service_role;
CREATE OR REPLACE FUNCTION public.delete_account_data(p_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF COALESCE(auth.jwt()->>'role','') <> 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF EXISTS(SELECT 1 FROM public.account_storage_inventory(p_user_id,1)) THEN RAISE EXCEPTION 'Storage cleanup is incomplete'; END IF;
  UPDATE profiles SET username='deleted_'||left(replace(p_user_id::text,'-',''),12),avatar_url=NULL,bio=NULL,is_private=true WHERE id=p_user_id;
  DELETE FROM messages WHERE sender_id=p_user_id;
  DELETE FROM post_comments WHERE user_id=p_user_id;
  DELETE FROM posts WHERE user_id=p_user_id;
  DELETE FROM follows WHERE follower_id=p_user_id OR following_id=p_user_id;
  DELETE FROM push_tokens WHERE user_id=p_user_id;
  DELETE FROM media_ownership WHERE user_id=p_user_id;
  UPDATE conversations SET last_message=NULL WHERE participant_1=p_user_id OR participant_2=p_user_id;
  UPDATE account_deletion_jobs SET stage='data_complete',updated_at=now() WHERE user_id=p_user_id;
  INSERT INTO admin_audit_log(action,target_type,target_id,details)
    VALUES('account_deletion_requested','user',p_user_id::text,jsonb_build_object('self_requested',true));
END; $$;
REVOKE ALL ON FUNCTION public.delete_account_data(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.delete_account_data(uuid) TO service_role;

-- Counts and caller state are computed in PostgreSQL, under the caller's RLS.
CREATE OR REPLACE FUNCTION public.rpc_feed_page(p_tab text DEFAULT 'following',p_before timestamptz DEFAULT NULL,p_before_id uuid DEFAULT NULL,p_limit integer DEFAULT 25)
RETURNS SETOF jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
  SELECT jsonb_build_object(
    'id',p.id,'user_id',p.user_id,'username',COALESCE(pr.username,'Unknown'),'avatar_url',pr.avatar_url,
    'content',p.content,'photo_url',p.photo_url,'post_type',p.post_type,'created_at',p.created_at,
    'score_value',s.score,'game_name',g.name,
    'like_count',(SELECT count(*) FROM post_likes l WHERE l.post_id=p.id),
    'liked_by_me',EXISTS(SELECT 1 FROM post_likes l WHERE l.post_id=p.id AND l.user_id=auth.uid()),
    'comment_count',(SELECT count(*) FROM post_comments c WHERE c.post_id=p.id),
    'my_reaction',(SELECT r.emoji FROM post_reactions r WHERE r.post_id=p.id AND r.user_id=auth.uid() LIMIT 1),
    'reactions',COALESCE((SELECT jsonb_object_agg(counts.emoji,counts.n) FROM
      (SELECT r.emoji,count(*) n FROM post_reactions r WHERE r.post_id=p.id GROUP BY r.emoji) counts),'{}'::jsonb),
    'saved',EXISTS(SELECT 1 FROM saved_posts sp WHERE sp.post_id=p.id AND sp.user_id=auth.uid())
  ) FROM posts p
    LEFT JOIN public_profiles pr ON pr.id=p.user_id LEFT JOIN scores s ON s.id=p.score_id LEFT JOIN games g ON g.id=s.game_id
  WHERE auth.uid() IS NOT NULL
    AND NOT EXISTS(SELECT 1 FROM user_blocks b WHERE b.blocker_id=auth.uid() AND b.blocked_id=p.user_id)
    AND (p_before IS NULL OR (p.created_at,p.id)<(p_before,p_before_id))
    AND ((p_tab='arcade' AND p.post_type='announcement') OR (p_tab='following' AND (
      p.user_id=auth.uid()
      OR EXISTS(SELECT 1 FROM follows f WHERE (f.follower_id=auth.uid() AND f.following_id=p.user_id) OR (f.following_id=auth.uid() AND f.follower_id=p.user_id))
      OR EXISTS(SELECT 1 FROM friendships f WHERE f.status='accepted' AND ((f.requester_id=auth.uid() AND f.addressee_id=p.user_id) OR (f.addressee_id=auth.uid() AND f.requester_id=p.user_id)))
    )))
  ORDER BY p.created_at DESC,p.id DESC LIMIT LEAST(GREATEST(p_limit,1),50);
$$;
REVOKE ALL ON FUNCTION public.rpc_feed_page(text,timestamptz,uuid,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.rpc_feed_page(text,timestamptz,uuid,integer) TO authenticated;
CREATE INDEX IF NOT EXISTS posts_feed_cursor_idx ON public.posts(created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS post_comments_post_idx ON public.post_comments(post_id);
CREATE INDEX IF NOT EXISTS post_reactions_post_idx ON public.post_reactions(post_id);


-- Keep the established default on the guarded two-argument function and remove
-- the legacy one-argument bypass. No CASCADE: unexpected dependencies stop rollout.
DROP FUNCTION IF EXISTS public.rpc_skeeball_finalize_match(uuid);
REVOKE ALL ON FUNCTION public.rpc_skeeball_complete_session(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.rpc_skeeball_complete_session(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.enforce_team_creation_payment() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.guard_role_escalation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE caller_rank int; old_rank int; new_rank int;
BEGIN
  IF auth.jwt()->>'role' = 'service_role' THEN RETURN NEW; END IF;
  IF NEW.role IS DISTINCT FROM OLD.role OR NEW.is_admin IS DISTINCT FROM OLD.is_admin THEN
    PERFORM public.require_mfa();
    SELECT array_position(ARRAY['user','admin','owner','architect'],role) INTO caller_rank FROM profiles WHERE id=auth.uid();
    old_rank:=array_position(ARRAY['user','admin','owner','architect'],OLD.role);
    new_rank:=array_position(ARRAY['user','admin','owner','architect'],NEW.role);
    IF caller_rank IS NULL OR old_rank IS NULL OR new_rank IS NULL OR caller_rank<2
      OR auth.uid()=OLD.id OR old_rank>=caller_rank OR new_rank>=caller_rank
      OR NEW.is_admin IS DISTINCT FROM (NEW.role IN ('admin','owner','architect'))
    THEN RAISE EXCEPTION 'Role change is not permitted'; END IF;
  END IF;
  IF NEW.is_arcade_official IS DISTINCT FROM OLD.is_arcade_official OR NEW.is_beta_tester IS DISTINCT FROM OLD.is_beta_tester THEN
    PERFORM public.require_mfa();
    IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator required'; END IF;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS guard_role_escalation_trigger ON public.profiles;
CREATE TRIGGER guard_role_escalation_trigger BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.guard_role_escalation();
REVOKE ALL ON FUNCTION public.guard_role_escalation() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.check_username_available(p_username text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT p_username ~ '^[A-Za-z0-9_]{3,20}$' AND NOT EXISTS(SELECT 1 FROM profiles WHERE lower(username)=lower(p_username));
$$;
REVOKE ALL ON FUNCTION public.check_username_available(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_username_available(text) TO anon,authenticated;
CREATE OR REPLACE FUNCTION public.resolve_login_email(p_username text)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF COALESCE(auth.jwt()->>'role','') <> 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;
  RETURN (SELECT u.email FROM auth.users u JOIN profiles p ON p.id=u.id WHERE lower(p.username)=lower(p_username) LIMIT 1);
END; $$;
REVOKE ALL ON FUNCTION public.resolve_login_email(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_login_email(text) TO service_role;
DO $$ DECLARE fn regprocedure; BEGIN
  FOR fn IN SELECT oid::regprocedure FROM pg_proc WHERE pronamespace='public'::regnamespace
    AND proname IN ('get_email_by_username','get_username_by_email','check_email_available')
  LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',fn); END LOOP;
END; $$;


ALTER TABLE public.push_tokens ADD COLUMN IF NOT EXISTS device_secret_hash text;
-- Legacy rows cannot prove which signed-out device owns them. Retire them;
-- updated clients register again on sign-in/foreground with a device secret.
DELETE FROM public.push_tokens WHERE device_secret_hash IS NULL;
CREATE OR REPLACE FUNCTION public.register_device_push_token(p_token text,p_secret text,p_platform text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE existing push_tokens%ROWTYPE; secret_hash text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Login required'; END IF;
  IF p_secret IS NULL OR p_token IS NULL OR p_platform NOT IN ('ios','android','web') OR p_platform IS NULL OR length(p_secret) < 64 OR length(p_secret)>128 OR p_token !~ '^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$' THEN RAISE EXCEPTION 'Invalid device token'; END IF;
  secret_hash:=encode(sha256(convert_to(p_secret,'UTF8')),'hex');
  PERFORM pg_advisory_xact_lock(hashtextextended('push:'||p_token,0));
  SELECT * INTO existing FROM push_tokens WHERE token=p_token FOR UPDATE;
  IF existing.token IS NOT NULL AND existing.user_id <> auth.uid() AND existing.device_secret_hash IS DISTINCT FROM secret_hash THEN
    RAISE EXCEPTION 'Device ownership could not be verified';
  END IF;
  INSERT INTO push_tokens(token,user_id,platform,updated_at,device_secret_hash)
    VALUES(p_token,auth.uid(),p_platform,now(),secret_hash)
    ON CONFLICT(token) DO UPDATE SET user_id=EXCLUDED.user_id,platform=EXCLUDED.platform,updated_at=EXCLUDED.updated_at,device_secret_hash=EXCLUDED.device_secret_hash;
END; $$;
REVOKE ALL ON FUNCTION public.register_device_push_token(text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.register_device_push_token(text,text,text) TO authenticated;
-- All registration goes through the ownership-checked RPC; deletion remains owner scoped.
DROP POLICY IF EXISTS "push_tokens_own_insert" ON public.push_tokens;
DROP POLICY IF EXISTS "push_tokens_own_update" ON public.push_tokens;


CREATE OR REPLACE FUNCTION public.rpc_skeeball_get_or_create_match(p_week_of date)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE match_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM team_members WHERE user_id=auth.uid()) THEN RAISE EXCEPTION 'Team membership required'; END IF;
  IF p_week_of IS DISTINCT FROM (date_trunc('week',now() AT TIME ZONE 'America/New_York'))::date THEN RAISE EXCEPTION 'Only the current league week can be started'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('skee-week:'||p_week_of::text,0));
  SELECT m.id INTO match_id FROM skeeball_league_matches m
    WHERE m.week_of=p_week_of AND m.status='active'
      AND (SELECT count(*) FROM skeeball_sessions s WHERE s.league_match_id=m.id AND s.status <> 'abandoned') < COALESCE(m.expected_teams,4)
    ORDER BY m.id LIMIT 1;
  IF match_id IS NULL THEN
    INSERT INTO skeeball_league_matches(week_of,status,expected_teams) VALUES(p_week_of,'active',4) RETURNING id INTO match_id;
  END IF;
  RETURN json_build_object('ok',true,'match_id',match_id);
END; $$;
REVOKE ALL ON FUNCTION public.rpc_skeeball_get_or_create_match(date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.rpc_skeeball_get_or_create_match(date) TO authenticated;
CREATE OR REPLACE FUNCTION public.rpc_admin_adjust_skeeball_session(p_session_id uuid,p_league_points_adjustment integer,p_score_adjustment integer,p_note text DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE previous skeeball_sessions%ROWTYPE;
BEGIN
  PERFORM public.require_mfa();
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator required'; END IF;
  IF p_league_points_adjustment IS NULL OR abs(p_league_points_adjustment::bigint)>100
    OR p_score_adjustment IS NULL OR abs(p_score_adjustment::bigint)>900 OR length(COALESCE(p_note,''))>1000 THEN RAISE EXCEPTION 'Invalid adjustment'; END IF;
  PERFORM 1 FROM skeeball_league_matches WHERE id=(SELECT league_match_id FROM skeeball_sessions WHERE id=p_session_id) FOR UPDATE;
  SELECT * INTO previous FROM skeeball_sessions WHERE id=p_session_id FOR UPDATE;
  IF previous.id IS NULL OR previous.status <> 'completed' THEN RAISE EXCEPTION 'Completed session required'; END IF;
  UPDATE skeeball_sessions SET league_points_adjustment=p_league_points_adjustment,score_adjustment=p_score_adjustment WHERE id=p_session_id;
  INSERT INTO admin_audit_log(admin_id,action,target_type,target_id,details) VALUES(auth.uid(),'adjust_skeeball_session','skeeball_session',p_session_id::text,
    jsonb_build_object('previous_points_adjustment',previous.league_points_adjustment,'previous_score_adjustment',previous.score_adjustment,
    'points_adjustment',p_league_points_adjustment,'score_adjustment',p_score_adjustment,'note',p_note));
  RETURN json_build_object('ok',true);
END; $$;
REVOKE ALL ON FUNCTION public.rpc_admin_adjust_skeeball_session(uuid,integer,integer,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.rpc_admin_adjust_skeeball_session(uuid,integer,integer,text) TO authenticated;

-- Aggregate history in PostgreSQL so PostgREST's row cap cannot truncate a recap.
CREATE OR REPLACE FUNCTION public.rpc_skeeball_recap_data(p_team_id uuid,p_start date DEFAULT NULL,p_end date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF COALESCE(auth.jwt()->>'role','') <> 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;
  RETURN (
    WITH sessions AS (
      SELECT id,week_of,placement,league_points,league_points_adjustment,score_adjustment,league_match_id
      FROM skeeball_sessions WHERE team_id=p_team_id AND status='completed' AND league_match_id IS NOT NULL
        AND (p_start IS NULL OR week_of>=p_start) AND (p_end IS NULL OR week_of<=p_end)
    ), balls AS (
      SELECT b.session_id,b.player_user_id,sum(b.score) AS score FROM skeeball_ball_scores b
      JOIN sessions s ON s.id=b.session_id GROUP BY b.session_id,b.player_user_id
    ), opponents AS (
      SELECT s.id,s.league_match_id,s.team_id,s.placement,s.score_adjustment,jsonb_build_object('name',t.name) AS teams
      FROM skeeball_sessions s JOIN teams t ON t.id=s.team_id
      WHERE s.league_match_id IN (SELECT league_match_id FROM sessions) AND s.team_id<>p_team_id AND s.status='completed'
    ), opponent_scores AS (
      SELECT b.session_id,sum(b.score) AS score FROM skeeball_ball_scores b
      JOIN opponents s ON s.id=b.session_id GROUP BY b.session_id
    )
    SELECT jsonb_build_object(
      'sessions',COALESCE((SELECT jsonb_agg(s ORDER BY s.week_of,s.id) FROM sessions s),'[]'::jsonb),
      'balls',COALESCE((SELECT jsonb_agg(b) FROM balls b),'[]'::jsonb),
      'profiles',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',p.id,'username',p.username)) FROM profiles p
        WHERE p.id IN (SELECT player_user_id FROM balls)),'[]'::jsonb),
      'oppSessions',COALESCE((SELECT jsonb_agg(o) FROM opponents o),'[]'::jsonb),
      'oppBalls',COALESCE((SELECT jsonb_agg(o) FROM opponent_scores o),'[]'::jsonb)
    )
  );
END; $$;
REVOKE ALL ON FUNCTION public.rpc_skeeball_recap_data(uuid,date,date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_skeeball_recap_data(uuid,date,date) TO service_role;

COMMIT;
