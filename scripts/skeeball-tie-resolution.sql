-- ============================================================
-- Skee-Ball tie resolution — admin sets a round's finishing order
--
-- Ties are settled by a physical roll-off at the venue; the admin then
-- records the result here. This RPC takes a round's completed sessions in
-- final finishing order (winner first) and rewrites placement + base
-- league_points cleanly (1st = K … last = 1), so a tie becomes distinct
-- placements. league_points_adjustment / score_adjustment are left
-- untouched (they remain orthogonal manual nudges).
--
-- Roll-off rules (run at the venue, for admin reference):
--   Regular weeks: 1 player, 1 ball — first to hit a 100 wins. If they
--     miss, the next player shoots. Repeat up to 3 balls; still tied →
--     sudden death, highest single ball wins.
--   Week 7 (Hundo): ladder 10 → 20 → 30 → 40 → 50 → 100. Each player must
--     hit their target ring; first to miss loses if the opponent makes it.
--     Otherwise advance to the next player / next rung.
--
-- Run AFTER: skeeball-finalize-fix.sql
-- Idempotent — safe to re-run.
-- ============================================================

CREATE OR REPLACE FUNCTION public.rpc_admin_skeeball_set_match_order(
  p_match_id            uuid,
  p_ordered_session_ids uuid[]
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
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

REVOKE ALL ON FUNCTION public.rpc_admin_skeeball_set_match_order(uuid, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_admin_skeeball_set_match_order(uuid, uuid[]) TO authenticated;
