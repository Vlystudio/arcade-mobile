-- ============================================================
-- Migrate scores.score from int to bigint, raise the ceiling
-- to 100,000,000,000 (100 billion).
--
-- Why: several pinball machines in the catalog (Medieval Madness,
-- Attack from Mars, Twilight Zone, Theatre of Magic, etc.) have
-- documented competitive scores in the billions, which exceeded
-- both the int4 column's ~2.147B range and the 999,999,999
-- scores_value_bounds constraint added by
-- input-validation-hardening.sql (run order 17).
--
-- Source of truth going forward for:
--   - scores.score column type + range constraint
--     (supersedes scores_value_bounds in input-validation-hardening.sql
--     and scores_score_range in security-hardening-2.sql)
--   - rpc_submit_score
--     (supersedes security-hardening.sql run order 9 and
--     security-hardening-2.sql run order 10)
-- ============================================================

ALTER TABLE public.scores ALTER COLUMN score TYPE bigint;

ALTER TABLE public.scores DROP CONSTRAINT IF EXISTS scores_value_bounds;
ALTER TABLE public.scores DROP CONSTRAINT IF EXISTS scores_score_range;
ALTER TABLE public.scores ADD CONSTRAINT scores_score_range
  CHECK (score >= 0 AND score <= 100000000000);

DROP FUNCTION IF EXISTS public.rpc_submit_score(uuid, uuid, uuid, uuid, integer, jsonb);

CREATE OR REPLACE FUNCTION public.rpc_submit_score(
  p_game_id     uuid,
  p_lane_id     uuid,
  p_check_in_id uuid,
  p_venue_id    uuid,
  p_score       bigint,
  p_frame_data  jsonb DEFAULT NULL
) RETURNS json LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
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

REVOKE ALL ON FUNCTION public.rpc_submit_score(uuid, uuid, uuid, uuid, bigint, jsonb) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.rpc_submit_score(uuid, uuid, uuid, uuid, bigint, jsonb) TO authenticated;
