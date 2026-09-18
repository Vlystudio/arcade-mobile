-- Private handover requests: no device secret is returned through the Data API.
ALTER TABLE private.skeeball_scoring_controls ADD COLUMN generation integer NOT NULL DEFAULT 0;
CREATE TABLE private.skeeball_scoring_requests (
  session_id uuid PRIMARY KEY REFERENCES public.skeeball_sessions(id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  requester_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  device_hash bytea NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '5 minutes'
);
ALTER TABLE private.skeeball_scoring_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.skeeball_scoring_requests FROM PUBLIC, anon, authenticated;

DO $migration$
DECLARE definition text; marker text := '''status'',sess.status)';
BEGIN
  definition := pg_get_functiondef('public.rpc_skeeball_group_control(uuid,text,text,jsonb,integer)'::regprocedure);
  IF position(marker IN definition)=0 THEN RAISE EXCEPTION 'Unexpected group control function'; END IF;
  definition := replace(definition,marker,$replacement$
    'status',sess.status,'generation',COALESCE(control.generation,0),
    'transfer',(SELECT jsonb_build_object('id',r.id,'name',p.username,'expires_at',r.expires_at,
      'is_requester',r.requester_id=auth.uid() AND r.device_hash=sha256(convert_to(p_device_key,'UTF8')))
      FROM private.skeeball_scoring_requests r JOIN public.profiles p ON p.id=r.requester_id
      WHERE r.session_id=p_session_id AND r.expires_at>now() AND
      (can_score OR (r.requester_id=auth.uid() AND r.device_hash=sha256(convert_to(p_device_key,'UTF8'))))))
  $replacement$);
  EXECUTE definition;
END; $migration$;

CREATE FUNCTION public.rpc_skeeball_group_transfer(p_session_id uuid,p_device_key text,p_action text,p_request_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE sess public.skeeball_sessions%ROWTYPE; control private.skeeball_scoring_controls%ROWTYPE;
  request private.skeeball_scoring_requests%ROWTYPE; owner boolean; requester boolean;
BEGIN
  IF auth.uid() IS NULL OR p_device_key IS NULL OR length(p_device_key) NOT BETWEEN 32 AND 256 THEN RAISE EXCEPTION 'Sign in on the scoring phone'; END IF;
  IF p_action IS NULL OR p_action NOT IN ('request','approve','decline','cancel') THEN RAISE EXCEPTION 'Unknown handover action'; END IF;
  SELECT * INTO sess FROM public.skeeball_sessions WHERE id=p_session_id;
  IF sess.id IS NULL OR NOT EXISTS(SELECT 1 FROM public.team_members WHERE team_id=sess.team_id AND user_id=auth.uid())
    OR NOT EXISTS(SELECT 1 FROM public.skeeball_session_players WHERE session_id=p_session_id AND player_user_id=auth.uid()) THEN RAISE EXCEPTION 'A player in this game must request the handover'; END IF;
  PERFORM 1 FROM public.skeeball_league_matches WHERE id=sess.league_match_id FOR UPDATE;
  SELECT * INTO sess FROM public.skeeball_sessions WHERE id=p_session_id FOR UPDATE;
  IF sess.status <> 'active' THEN RAISE EXCEPTION 'This game is no longer active'; END IF;
  SELECT * INTO control FROM private.skeeball_scoring_controls WHERE session_id=p_session_id FOR UPDATE;
  IF control.session_id IS NULL THEN RAISE EXCEPTION 'Choose the group scoring phone first'; END IF;
  owner := control.owner_id=auth.uid() AND control.device_hash=sha256(convert_to(p_device_key,'UTF8'));
  SELECT * INTO request FROM private.skeeball_scoring_requests WHERE session_id=p_session_id;
  requester := COALESCE(request.requester_id=auth.uid() AND request.device_hash=sha256(convert_to(p_device_key,'UTF8')),false);
  IF p_action='request' THEN
    IF owner THEN RAISE EXCEPTION 'This phone already controls scoring'; END IF;
    IF request.id IS NOT NULL AND request.expires_at>now() AND NOT requester THEN RAISE EXCEPTION 'Another handover is pending. Try again after it is resolved'; END IF;
    IF request.id IS NULL OR request.expires_at<=now() THEN
      INSERT INTO private.skeeball_scoring_requests(session_id,requester_id,device_hash)
        VALUES(p_session_id,auth.uid(),sha256(convert_to(p_device_key,'UTF8')))
        ON CONFLICT(session_id) DO UPDATE SET id=gen_random_uuid(),requester_id=EXCLUDED.requester_id,device_hash=EXCLUDED.device_hash,expires_at=now()+interval '5 minutes';
    END IF;
  ELSE
    IF request.id IS NULL OR request.id IS DISTINCT FROM p_request_id THEN RAISE EXCEPTION 'This handover is no longer pending'; END IF;
    IF p_action='approve' THEN
      IF NOT owner THEN RAISE EXCEPTION 'Approve on the current scoring phone'; END IF;
      IF request.expires_at<=now() THEN RAISE EXCEPTION 'This handover expired. Request it again'; END IF;
      IF NOT EXISTS(SELECT 1 FROM public.skeeball_session_players WHERE session_id=p_session_id AND player_user_id=request.requester_id)
        OR NOT EXISTS(SELECT 1 FROM public.team_members WHERE team_id=sess.team_id AND user_id=request.requester_id)
        OR EXISTS(SELECT 1 FROM public.team_bans WHERE team_id=sess.team_id AND user_id=request.requester_id) THEN RAISE EXCEPTION 'The receiving player is no longer eligible'; END IF;
      UPDATE private.skeeball_scoring_controls SET owner_id=request.requester_id,device_hash=request.device_hash,
        generation=generation+1,revision=revision+1,updated_at=now() WHERE session_id=p_session_id;
      UPDATE public.skeeball_sessions SET last_activity_at=now() WHERE id=p_session_id;
    ELSIF (p_action='decline' AND NOT owner) OR (p_action='cancel' AND NOT requester) THEN RAISE EXCEPTION 'This phone cannot cancel that handover'; END IF;
    DELETE FROM private.skeeball_scoring_requests WHERE session_id=p_session_id;
  END IF;
  RETURN public.rpc_skeeball_group_control(p_session_id,p_device_key);
END; $$;
REVOKE ALL ON FUNCTION public.rpc_skeeball_group_transfer(uuid,text,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.rpc_skeeball_group_transfer(uuid,text,text,uuid) TO authenticated;

-- A separate, private-to-owner history. These rows never feed league scores or standings.
CREATE FUNCTION public.rpc_skeeball_apply_recent_lineup(p_session_id uuid,p_players uuid[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE sess public.skeeball_sessions%ROWTYPE;
BEGIN
  SELECT * INTO sess FROM public.skeeball_sessions WHERE id=p_session_id;
  IF auth.uid() IS NULL OR sess.id IS NULL OR NOT EXISTS(SELECT 1 FROM public.team_members WHERE team_id=sess.team_id AND user_id=auth.uid()) THEN RAISE EXCEPTION 'Team membership required'; END IF;
  PERFORM 1 FROM public.skeeball_league_matches WHERE id=sess.league_match_id FOR UPDATE;
  SELECT * INTO sess FROM public.skeeball_sessions WHERE id=p_session_id FOR UPDATE;
  IF sess.status<>'active' OR EXISTS(SELECT 1 FROM private.skeeball_scoring_controls WHERE session_id=p_session_id)
    OR EXISTS(SELECT 1 FROM public.skeeball_ball_scores WHERE session_id=p_session_id) THEN RAISE EXCEPTION 'The lineup is already locked'; END IF;
  IF p_players IS NULL OR cardinality(p_players) NOT BETWEEN 1 AND 3 OR NOT auth.uid()=ANY(p_players)
    OR (SELECT count(DISTINCT id) FROM unnest(p_players) id)<>cardinality(p_players)
    OR EXISTS(SELECT 1 FROM unnest(p_players) id WHERE NOT EXISTS(SELECT 1 FROM public.team_members m WHERE m.team_id=sess.team_id AND m.user_id=id)
      OR EXISTS(SELECT 1 FROM public.team_bans b WHERE b.team_id=sess.team_id AND b.user_id=id)) THEN RAISE EXCEPTION 'Your recent lineup is no longer available. Choose the players again'; END IF;
  DELETE FROM public.skeeball_session_players WHERE session_id=p_session_id;
  INSERT INTO public.skeeball_session_players(session_id,player_user_id,shoot_position)
    SELECT p_session_id,id,position::integer FROM unnest(p_players) WITH ORDINALITY p(id,position);
  RETURN jsonb_build_object('ok',true);
END; $$;
REVOKE ALL ON FUNCTION public.rpc_skeeball_apply_recent_lineup(uuid,uuid[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.rpc_skeeball_apply_recent_lineup(uuid,uuid[]) TO authenticated;

CREATE TABLE public.skeeball_practice_games (
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  id uuid NOT NULL,
  game jsonb NOT NULL CHECK(octet_length(game::text)<16384),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id,id)
);
ALTER TABLE public.skeeball_practice_games ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.skeeball_practice_games FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.skeeball_practice_games TO authenticated;
CREATE POLICY practice_read ON public.skeeball_practice_games FOR SELECT TO authenticated USING(user_id=(SELECT auth.uid()));
CREATE POLICY practice_save ON public.skeeball_practice_games FOR INSERT TO authenticated WITH CHECK(user_id=(SELECT auth.uid()));
CREATE INDEX practice_recent ON public.skeeball_practice_games(user_id,created_at DESC);

CREATE FUNCTION private.validate_practice_game() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE players jsonb; balls jsonb; ids text[]; names text[]; player jsonb; ball jsonb; idx integer; target integer; counts integer[]:=ARRAY[0,0,0];
BEGIN
  players:=NEW.game->'players'; balls:=NEW.game->'balls';
  IF (NEW.game->>'version')::integer IS DISTINCT FROM 1 OR (NEW.game->>'id')::uuid IS DISTINCT FROM NEW.id
    OR jsonb_typeof(players) IS DISTINCT FROM 'array' OR jsonb_typeof(balls) IS DISTINCT FROM 'array'
    OR jsonb_array_length(players) NOT BETWEEN 1 AND 3 OR jsonb_array_length(balls)<>9
    OR jsonb_typeof(NEW.game->'startedAt') IS DISTINCT FROM 'number' OR jsonb_typeof(NEW.game->'completedAt') IS DISTINCT FROM 'number'
    OR (NEW.game->>'completedAt')::numeric < (NEW.game->>'startedAt')::numeric THEN RAISE EXCEPTION 'Invalid practice game'; END IF;
  FOR player IN SELECT value FROM jsonb_array_elements(players) LOOP
    IF length(btrim(player->>'name')) NOT BETWEEN 1 AND 40 OR player->>'name' IS NULL OR player->>'id' IS NULL THEN RAISE EXCEPTION 'Invalid practice player'; END IF;
    PERFORM (player->>'id')::uuid;
    ids:=array_append(ids,player->>'id'); names:=array_append(names,lower(btrim(player->>'name')));
  END LOOP;
  IF (SELECT count(DISTINCT x) FROM unnest(ids) x) <> cardinality(ids) OR (SELECT count(DISTINCT x) FROM unnest(names) x) <> cardinality(names) THEN RAISE EXCEPTION 'Practice players must be distinct'; END IF;
  FOR ball,idx IN SELECT value,ordinality::integer-1 FROM jsonb_array_elements(balls) WITH ORDINALITY LOOP
    target:=(idx/3)%cardinality(ids)+1; counts[target]:=counts[target]+1;
    IF ball->>'player_user_id' IS DISTINCT FROM ids[target] OR (ball->>'ball_number')::integer IS DISTINCT FROM counts[target]
      OR (ball->>'score')::integer IS NULL OR (ball->>'score')::integer NOT IN (10,20,30,40,50,100) THEN RAISE EXCEPTION 'Invalid practice ball order or score'; END IF;
  END LOOP;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION private.validate_practice_game() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER validate_practice_game BEFORE INSERT ON public.skeeball_practice_games FOR EACH ROW EXECUTE FUNCTION private.validate_practice_game();
