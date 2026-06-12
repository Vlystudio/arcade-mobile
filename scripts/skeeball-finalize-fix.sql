-- ============================================================
-- Skee-Ball league finalize fix
--
-- League rule: 4 teams play per round, each shooting 9 balls.
-- When ALL FOUR teams have completed, placements are awarded
-- automatically: 1st = 4 pts, 2nd = 3, 3rd = 2, 4th = 1.
--
-- Fixes over the previous version:
--  1. Auto-finalize now waits for 4 completed sessions — it no
--     longer closes a round early when only the first 2 teams
--     to check in have finished (which used to split the round
--     into two 2-team matches).
--  2. Admin score_adjustment is now included in ranking totals.
--  3. Ties share the better placement and its points (RANK()).
--  4. New rpc_admin_skeeball_force_finalize lets an admin close
--     out a short round (2-3 teams) when fewer teams showed up;
--     unfinished sessions are marked abandoned to free lanes.
-- ============================================================

-- Drop the old 1-arg version so the new defaulted signature is unambiguous
DROP FUNCTION IF EXISTS public.rpc_skeeball_finalize_match(uuid);

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
  v_total int;
  v_completed int;
  v_rec record;
BEGIN
  SELECT COUNT(*) INTO v_total
    FROM skeeball_sessions
   WHERE league_match_id = p_match_id AND status != 'abandoned';

  SELECT COUNT(*) INTO v_completed
    FROM skeeball_sessions
   WHERE league_match_id = p_match_id AND status = 'completed';

  IF p_force THEN
    -- Admin override: close out a short round (needs at least 2 finished teams)
    IF v_completed < 2 THEN
      RETURN json_build_object('ok', false, 'message', 'Need at least 2 completed sessions to finalize.');
    END IF;
  ELSE
    -- A league round is 4 teams: wait until all 4 have checked in AND completed.
    -- Prevents early finalization when the first teams to check in finish
    -- before the rest of the round has even started.
    IF v_total < 4 OR v_completed < v_total THEN
      RETURN json_build_object('ok', false, 'message', 'Round not complete yet (' || v_completed || '/' || GREATEST(v_total, 4) || ' teams finished)');
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM skeeball_sessions
     WHERE league_match_id = p_match_id AND placement IS NOT NULL LIMIT 1
  ) THEN
    RETURN json_build_object('ok', true, 'message', 'Already finalized');
  END IF;

  -- Rank completed sessions by total score (admin adjustments included).
  -- Ties share the better placement and its points.
  FOR v_rec IN
    SELECT ranked.id, ranked.rnk
    FROM (
      SELECT ss.id,
             RANK() OVER (ORDER BY COALESCE(SUM(bs.score), 0) + ss.score_adjustment DESC) AS rnk
        FROM skeeball_sessions ss
        LEFT JOIN skeeball_ball_scores bs ON bs.session_id = ss.id
       WHERE ss.league_match_id = p_match_id AND ss.status = 'completed'
       GROUP BY ss.id, ss.score_adjustment
    ) ranked
  LOOP
    UPDATE skeeball_sessions
       SET placement = v_rec.rnk,
           league_points = GREATEST(5 - v_rec.rnk, 1)
     WHERE id = v_rec.id;
  END LOOP;

  -- Force-finalize: clear out sessions that never finished so lanes free up
  IF p_force THEN
    UPDATE skeeball_sessions
       SET status = 'abandoned', last_activity_at = now()
     WHERE league_match_id = p_match_id AND status = 'active';
  END IF;

  UPDATE skeeball_league_matches SET status = 'completed' WHERE id = p_match_id;

  RETURN json_build_object('ok', true, 'teams_ranked', v_completed);
END;
$$;

-- Admin-only wrapper to close out a round with fewer than 4 teams
CREATE OR REPLACE FUNCTION public.rpc_admin_skeeball_force_finalize(p_match_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
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

REVOKE ALL ON FUNCTION public.rpc_skeeball_finalize_match(uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_admin_skeeball_force_finalize(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_skeeball_finalize_match(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_skeeball_force_finalize(uuid) TO authenticated;
