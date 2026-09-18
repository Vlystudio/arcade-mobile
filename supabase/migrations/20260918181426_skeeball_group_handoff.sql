-- Group scoring opts a session into one phone. Legacy sessions keep their existing API.
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;
CREATE TABLE private.skeeball_scoring_controls (
  session_id uuid PRIMARY KEY REFERENCES public.skeeball_sessions(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  device_hash bytea NOT NULL,
  balls jsonb NOT NULL DEFAULT '[]',
  revision integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE private.skeeball_scoring_controls ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.skeeball_scoring_controls FROM PUBLIC, anon, authenticated;

-- This RPC is the only access to the private draft. Every call verifies team/session membership.
CREATE FUNCTION public.rpc_skeeball_group_control(
  p_session_id uuid, p_device_key text, p_action text DEFAULT 'read',
  p_balls jsonb DEFAULT NULL, p_revision integer DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  sess public.skeeball_sessions%ROWTYPE;
  control private.skeeball_scoring_controls%ROWTYPE;
  can_score boolean; ids uuid[]; total integer; ball jsonb; idx integer; player_idx integer;
  counts integer[] := ARRAY[0,0,0]; result jsonb;
BEGIN
  SELECT * INTO sess FROM public.skeeball_sessions WHERE id=p_session_id;
  IF auth.uid() IS NULL OR sess.id IS NULL OR NOT (
    EXISTS(SELECT 1 FROM public.team_members WHERE team_id=sess.team_id AND user_id=auth.uid()) OR
    EXISTS(SELECT 1 FROM public.skeeball_session_players WHERE session_id=p_session_id AND player_user_id=auth.uid())
  ) THEN RAISE EXCEPTION 'Game membership required'; END IF;
  IF p_action NOT IN ('read','claim','save','submit') OR p_action IS NULL THEN RAISE EXCEPTION 'Unknown scoring action'; END IF;
  IF p_device_key IS NULL OR length(p_device_key) NOT BETWEEN 32 AND 256 THEN RAISE EXCEPTION 'Scoring phone key required'; END IF;
  IF p_action <> 'read' THEN
    -- Match then session: the same lock order used by completion/finalization.
    PERFORM 1 FROM public.skeeball_league_matches WHERE id=sess.league_match_id FOR UPDATE;
    SELECT * INTO sess FROM public.skeeball_sessions WHERE id=p_session_id FOR UPDATE;
  END IF;
  SELECT * INTO control FROM private.skeeball_scoring_controls WHERE session_id=p_session_id;
  IF p_action='claim' AND control.session_id IS NULL THEN
    IF sess.status <> 'active' OR EXISTS(SELECT 1 FROM public.skeeball_ball_scores WHERE session_id=p_session_id) THEN
      RAISE EXCEPTION 'This game has already been submitted';
    END IF;
    IF NOT EXISTS(SELECT 1 FROM public.skeeball_session_players WHERE session_id=p_session_id AND player_user_id=auth.uid()) THEN
      RAISE EXCEPTION 'A player in the lineup must choose the scoring phone';
    END IF;
    INSERT INTO private.skeeball_scoring_controls(session_id,owner_id,device_hash)
      VALUES(p_session_id,auth.uid(),sha256(convert_to(p_device_key,'UTF8'))) RETURNING * INTO control;
  END IF;
  can_score := COALESCE(control.owner_id=auth.uid() AND control.device_hash=sha256(convert_to(p_device_key,'UTF8')),false);
  IF p_action IN ('save','submit') THEN
    IF NOT can_score THEN RAISE EXCEPTION 'Scores are controlled by the group scoring phone'; END IF;
    IF p_action='save' AND sess.status <> 'active' THEN RAISE EXCEPTION 'This game is no longer active'; END IF;
    IF p_action='save' AND p_revision IS DISTINCT FROM control.revision THEN RAISE EXCEPTION 'Scoring draft changed. Reopen this game before editing'; END IF;
    IF jsonb_typeof(p_balls) IS DISTINCT FROM 'array' OR jsonb_array_length(p_balls)>9 THEN RAISE EXCEPTION 'Invalid group scorecard'; END IF;
    SELECT array_agg(player_user_id ORDER BY shoot_position NULLS LAST,player_user_id) INTO ids
      FROM public.skeeball_session_players WHERE session_id=p_session_id;
    total := cardinality(ids);
    IF total IS NULL OR total NOT BETWEEN 1 AND 3 THEN RAISE EXCEPTION 'Invalid lineup'; END IF;
    FOR ball,idx IN SELECT value,ordinality::integer-1 FROM jsonb_array_elements(p_balls) WITH ORDINALITY LOOP
      player_idx := (idx/3)%total+1;
      counts[player_idx] := counts[player_idx]+1;
      IF (ball->>'player_user_id')::uuid IS DISTINCT FROM ids[player_idx]
        OR (ball->>'ball_number')::integer IS DISTINCT FROM counts[player_idx]
        OR (ball->>'score')::integer IS NULL OR (ball->>'score')::integer NOT IN (10,20,30,40,50,100)
      THEN RAISE EXCEPTION 'Scores must follow the three-ball shooting order'; END IF;
    END LOOP;
    IF p_action='submit' THEN
      IF jsonb_array_length(p_balls) <> 9 THEN RAISE EXCEPTION 'Record all nine balls before saving the game'; END IF;
      PERFORM set_config('app.skeeball_device_key',p_device_key,true);
      result := public.rpc_skeeball_submit_and_complete(p_session_id,p_balls)::jsonb;
      IF result->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION '%',COALESCE(result->>'message','Could not save the game'); END IF;
      RETURN result;
    END IF;
    UPDATE private.skeeball_scoring_controls SET balls=p_balls,revision=revision+1,updated_at=now()
      WHERE session_id=p_session_id RETURNING * INTO control;
    UPDATE public.skeeball_sessions SET last_activity_at=now() WHERE id=p_session_id;
  END IF;
  RETURN jsonb_build_object('ok',true,'claimed',control.session_id IS NOT NULL,'can_score',can_score,
    'owner_id',control.owner_id,'owner_name',(SELECT username FROM public.profiles WHERE id=control.owner_id),
    'balls',COALESCE(control.balls,'[]'::jsonb),'revision',COALESCE(control.revision,0),'status',sess.status);
END; $$;
REVOKE ALL ON FUNCTION public.rpc_skeeball_group_control(uuid,text,text,jsonb,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.rpc_skeeball_group_control(uuid,text,text,jsonb,integer) TO authenticated;

-- Old clients cannot overwrite a group scorecard. Identical persisted scores remain
-- idempotent so the existing completion RPC can validate them without a device key.
DO $migration$
DECLARE definition text; marker text := '  IF v_session.status=''completed'' THEN';
BEGIN
  definition := pg_get_functiondef('public.rpc_skeeball_submit_balls(uuid,jsonb)'::regprocedure);
  IF position(marker IN definition)=0 THEN RAISE EXCEPTION 'Unexpected submit function; refusing to change it'; END IF;
  definition := replace(definition,marker,$guard$
  IF EXISTS(SELECT 1 FROM private.skeeball_scoring_controls WHERE session_id=p_session_id) AND NOT EXISTS(
    SELECT 1 FROM private.skeeball_scoring_controls WHERE session_id=p_session_id AND owner_id=auth.uid()
      AND device_hash=sha256(convert_to(COALESCE(current_setting('app.skeeball_device_key',true),''),'UTF8'))
  ) THEN
    IF (SELECT count(*) FROM public.skeeball_ball_scores WHERE session_id=p_session_id)=9 AND NOT EXISTS(
      SELECT 1 FROM jsonb_array_elements(p_balls) b LEFT JOIN public.skeeball_ball_scores s
      ON s.session_id=p_session_id AND s.player_user_id=(b->>'player_user_id')::uuid AND s.ball_number=(b->>'ball_number')::int
      WHERE s.score IS DISTINCT FROM (b->>'score')::int
    ) THEN RETURN json_build_object('ok',true,'already_submitted',true); END IF;
    RAISE EXCEPTION 'Use the group scoring phone to submit this game';
  END IF;
$guard$ || marker);
  EXECUTE definition;
END; $migration$;

CREATE FUNCTION private.lock_group_lineup() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM private.skeeball_scoring_controls c JOIN public.skeeball_sessions s ON s.id=c.session_id
    WHERE c.session_id=COALESCE(NEW.session_id,OLD.session_id) AND s.status='active') THEN
    RAISE EXCEPTION 'The lineup is locked after choosing the group scoring phone';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION private.lock_group_lineup() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER group_lineup_locked BEFORE INSERT OR UPDATE ON public.skeeball_session_players
  FOR EACH ROW EXECUTE FUNCTION private.lock_group_lineup();

CREATE FUNCTION public.rpc_skeeball_group_rematch(p_session_id uuid,p_device_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE prior public.skeeball_sessions%ROWTYPE; next_session public.skeeball_sessions%ROWTYPE;
  match_result json; match_id uuid; this_week date := date_trunc('week',now() AT TIME ZONE 'America/New_York')::date;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM private.skeeball_scoring_controls
    WHERE session_id=p_session_id AND owner_id=auth.uid() AND device_hash=sha256(convert_to(p_device_key,'UTF8')))
  THEN RAISE EXCEPTION 'Start the next game from the group scoring phone'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('skee-week:'||this_week::text,0));
  SELECT * INTO prior FROM public.skeeball_sessions WHERE id=p_session_id;
  PERFORM 1 FROM public.skeeball_league_matches WHERE id=prior.league_match_id FOR UPDATE;
  SELECT * INTO prior FROM public.skeeball_sessions WHERE id=p_session_id FOR UPDATE;
  IF prior.status <> 'completed' OR prior.week_of IS DISTINCT FROM this_week THEN RAISE EXCEPTION 'Check in again for a new league night'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.team_members WHERE team_id=prior.team_id AND user_id=auth.uid()) THEN RAISE EXCEPTION 'Team membership required'; END IF;
  IF EXISTS(SELECT 1 FROM public.team_bans WHERE team_id=prior.team_id AND user_id=auth.uid()) THEN RAISE EXCEPTION 'You cannot check in for this team'; END IF;
  IF EXISTS(SELECT 1 FROM public.lanes l JOIN public.games g ON g.id=l.game_id
    WHERE g.type='skeeball' AND l.lane_number=prior.lane_number AND l.status='inactive') THEN RAISE EXCEPTION 'That lane is not available. Scan another lane'; END IF;
  IF EXISTS(SELECT 1 FROM public.skeeball_league_matches WHERE id=prior.league_match_id AND status='active') THEN
    RAISE EXCEPTION 'Wait for the other teams to finish this round before playing again';
  END IF;
  SELECT * INTO next_session FROM public.skeeball_sessions WHERE team_id=prior.team_id AND status='active' LIMIT 1;
  IF next_session.id IS NOT NULL THEN RETURN jsonb_build_object('ok',true,'session',to_jsonb(next_session),'already_active',true); END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('skee-lane:'||prior.lane_number::text,0));
  IF EXISTS(SELECT 1 FROM public.skeeball_sessions WHERE lane_number=prior.lane_number AND status='active') THEN
    RAISE EXCEPTION 'Your previous lane is now in use. Scan an available lane to play again';
  END IF;
  IF EXISTS(SELECT 1 FROM public.skeeball_session_players p WHERE p.session_id=p_session_id AND NOT EXISTS(
    SELECT 1 FROM public.team_members m WHERE m.team_id=prior.team_id AND m.user_id=p.player_user_id)) THEN RAISE EXCEPTION 'Your team roster changed. Check in again to choose a lineup'; END IF;
  match_result := public.rpc_skeeball_get_or_create_match(this_week);
  match_id := (match_result->>'match_id')::uuid;
  IF match_id IS NULL THEN RAISE EXCEPTION 'Could not start the next round'; END IF;
  INSERT INTO public.skeeball_sessions(team_id,lane_number,week_of,created_by,status,last_activity_at,league_match_id)
    VALUES(prior.team_id,prior.lane_number,this_week,auth.uid(),'active',now(),match_id) RETURNING * INTO next_session;
  INSERT INTO public.skeeball_session_players(session_id,player_user_id,shoot_position)
    SELECT next_session.id,player_user_id,shoot_position FROM public.skeeball_session_players WHERE session_id=p_session_id;
  INSERT INTO private.skeeball_scoring_controls(session_id,owner_id,device_hash)
    VALUES(next_session.id,auth.uid(),sha256(convert_to(p_device_key,'UTF8')));
  RETURN jsonb_build_object('ok',true,'session',to_jsonb(next_session));
END; $$;
REVOKE ALL ON FUNCTION public.rpc_skeeball_group_rematch(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.rpc_skeeball_group_rematch(uuid,text) TO authenticated;
