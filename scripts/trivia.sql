-- ─── trivia.sql ──────────────────────────────────────────────────────────────
-- Full trivia system: question bank, game sessions, participants, answers

-- ─── Tables ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.trivia_questions (
  id              uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  question        text        NOT NULL,
  question_type   text        NOT NULL DEFAULT 'multiple_choice'
                              CHECK (question_type IN ('multiple_choice', 'text')),
  options         jsonb       DEFAULT '[]'::jsonb,  -- [{id:"a",text:"..."}, ...]
  correct_answer  text        NOT NULL,
  points          int         NOT NULL DEFAULT 100,
  category        text,
  created_by      uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.trivia_games (
  id                      uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  title                   text        NOT NULL DEFAULT 'Trivia Night',
  status                  text        NOT NULL DEFAULT 'lobby'
                                      CHECK (status IN ('lobby', 'active', 'finished')),
  current_question_id     uuid        REFERENCES public.trivia_questions(id) ON DELETE SET NULL,
  current_question_index  int         NOT NULL DEFAULT -1,
  max_participants        int         NOT NULL DEFAULT 20,
  allow_teams             boolean     NOT NULL DEFAULT true,
  min_team_size           int         NOT NULL DEFAULT 3,
  signup_token            text        NOT NULL UNIQUE DEFAULT gen_random_uuid()::text,
  created_by              uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  started_at              timestamptz,
  ended_at                timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.trivia_game_questions (
  game_id        uuid NOT NULL REFERENCES public.trivia_games(id) ON DELETE CASCADE,
  question_id    uuid NOT NULL REFERENCES public.trivia_questions(id) ON DELETE CASCADE,
  question_order int  NOT NULL,
  PRIMARY KEY (game_id, question_id),
  UNIQUE (game_id, question_order)
);

CREATE TABLE IF NOT EXISTS public.trivia_participants (
  id               uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  game_id          uuid        NOT NULL REFERENCES public.trivia_games(id) ON DELETE CASCADE,
  participant_type text        NOT NULL CHECK (participant_type IN ('individual', 'team')),
  user_id          uuid        REFERENCES auth.users(id) ON DELETE CASCADE,
  team_id          uuid        REFERENCES public.teams(id) ON DELETE CASCADE,
  display_name     text        NOT NULL,
  score            int         NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE(game_id, user_id),
  UNIQUE(game_id, team_id)
);

CREATE TABLE IF NOT EXISTS public.trivia_answers (
  id             uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  game_id        uuid        NOT NULL REFERENCES public.trivia_games(id) ON DELETE CASCADE,
  question_id    uuid        NOT NULL REFERENCES public.trivia_questions(id) ON DELETE CASCADE,
  participant_id uuid        NOT NULL REFERENCES public.trivia_participants(id) ON DELETE CASCADE,
  answer_text    text,
  is_correct     boolean,
  points_awarded int         NOT NULL DEFAULT 0,
  submitted_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE(question_id, participant_id)
);

-- ─── RLS ──────────────────────────────────────────────────────────────────────

ALTER TABLE public.trivia_questions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trivia_games         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trivia_game_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trivia_participants  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trivia_answers       ENABLE ROW LEVEL SECURITY;

-- Questions: authenticated can read; admins can write
DROP POLICY IF EXISTS "trivia_questions_select" ON public.trivia_questions;
CREATE POLICY "trivia_questions_select" ON public.trivia_questions
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "trivia_questions_admin" ON public.trivia_questions;
CREATE POLICY "trivia_questions_admin" ON public.trivia_questions
  FOR ALL USING (public.is_admin());

-- Games: authenticated can read
DROP POLICY IF EXISTS "trivia_games_select" ON public.trivia_games;
CREATE POLICY "trivia_games_select" ON public.trivia_games
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "trivia_games_admin" ON public.trivia_games;
CREATE POLICY "trivia_games_admin" ON public.trivia_games
  FOR ALL USING (public.is_admin());

-- Game questions: authenticated can read
DROP POLICY IF EXISTS "trivia_game_questions_select" ON public.trivia_game_questions;
CREATE POLICY "trivia_game_questions_select" ON public.trivia_game_questions
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "trivia_game_questions_admin" ON public.trivia_game_questions;
CREATE POLICY "trivia_game_questions_admin" ON public.trivia_game_questions
  FOR ALL USING (public.is_admin());

-- Participants: authenticated can read; can insert own via RPC
DROP POLICY IF EXISTS "trivia_participants_select" ON public.trivia_participants;
CREATE POLICY "trivia_participants_select" ON public.trivia_participants
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "trivia_participants_admin" ON public.trivia_participants;
CREATE POLICY "trivia_participants_admin" ON public.trivia_participants
  FOR ALL USING (public.is_admin());

-- Answers: can read own or admin; insert via RPC
DROP POLICY IF EXISTS "trivia_answers_select" ON public.trivia_answers;
CREATE POLICY "trivia_answers_select" ON public.trivia_answers
  FOR SELECT USING (
    public.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.trivia_participants tp
      WHERE tp.id = participant_id
        AND (tp.user_id = auth.uid()
          OR EXISTS (SELECT 1 FROM public.team_members tm WHERE tm.team_id = tp.team_id AND tm.user_id = auth.uid()))
    )
  );

DROP POLICY IF EXISTS "trivia_answers_admin" ON public.trivia_answers;
CREATE POLICY "trivia_answers_admin" ON public.trivia_answers
  FOR ALL USING (public.is_admin());

-- ─── RPCs ─────────────────────────────────────────────────────────────────────

-- Join a trivia game (individual or team)
CREATE OR REPLACE FUNCTION public.rpc_trivia_join(
  p_game_id  uuid,
  p_team_id  uuid DEFAULT NULL
) RETURNS json LANGUAGE plpgsql SECURITY DEFINER AS $$
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

REVOKE ALL ON FUNCTION public.rpc_trivia_join FROM public, anon;
GRANT EXECUTE ON FUNCTION public.rpc_trivia_join TO authenticated;

-- Submit an answer
CREATE OR REPLACE FUNCTION public.rpc_trivia_submit_answer(
  p_game_id     uuid,
  p_question_id uuid,
  p_answer      text
) RETURNS json LANGUAGE plpgsql SECURITY DEFINER AS $$
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

REVOKE ALL ON FUNCTION public.rpc_trivia_submit_answer FROM public, anon;
GRANT EXECUTE ON FUNCTION public.rpc_trivia_submit_answer TO authenticated;

-- Admin: create game with question set
-- Trivia is a platform-wide feature (no venue_id) — platform-admin-only.
CREATE OR REPLACE FUNCTION public.rpc_admin_trivia_create_game(
  p_title            text,
  p_max_participants int,
  p_allow_teams      boolean,
  p_min_team_size    int,
  p_question_ids     uuid[]
) RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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

REVOKE ALL ON FUNCTION public.rpc_admin_trivia_create_game FROM public, anon;
GRANT EXECUTE ON FUNCTION public.rpc_admin_trivia_create_game TO authenticated;

-- Admin: start game (moves to first question)
CREATE OR REPLACE FUNCTION public.rpc_admin_trivia_start_game(p_game_id uuid)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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

REVOKE ALL ON FUNCTION public.rpc_admin_trivia_start_game FROM public, anon;
GRANT EXECUTE ON FUNCTION public.rpc_admin_trivia_start_game TO authenticated;

-- Admin: advance to next question
CREATE OR REPLACE FUNCTION public.rpc_admin_trivia_next_question(p_game_id uuid)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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

REVOKE ALL ON FUNCTION public.rpc_admin_trivia_next_question FROM public, anon;
GRANT EXECUTE ON FUNCTION public.rpc_admin_trivia_next_question TO authenticated;

-- Admin: end game early
CREATE OR REPLACE FUNCTION public.rpc_admin_trivia_end_game(p_game_id uuid)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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

REVOKE ALL ON FUNCTION public.rpc_admin_trivia_end_game FROM public, anon;
GRANT EXECUTE ON FUNCTION public.rpc_admin_trivia_end_game TO authenticated;

-- Admin: grade a text answer
CREATE OR REPLACE FUNCTION public.rpc_admin_trivia_grade(
  p_answer_id  uuid,
  p_is_correct boolean
) RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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

REVOKE ALL ON FUNCTION public.rpc_admin_trivia_grade FROM public, anon;
GRANT EXECUTE ON FUNCTION public.rpc_admin_trivia_grade TO authenticated;

-- Admin: delete a game
CREATE OR REPLACE FUNCTION public.rpc_admin_trivia_delete_game(p_game_id uuid)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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

REVOKE ALL ON FUNCTION public.rpc_admin_trivia_delete_game FROM public, anon;
GRANT EXECUTE ON FUNCTION public.rpc_admin_trivia_delete_game TO authenticated;
