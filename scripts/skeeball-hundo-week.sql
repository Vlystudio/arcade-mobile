-- ============================================================
-- Skee-Ball "Hundo Week" — week 7 scoring rule
--
-- Week 7 of a season is HUNDO WEEK: still 3 players × 9 balls (3 each),
-- but the round winner is the team with the MOST 100-ring balls, not the
-- highest total score. League points are unchanged (placement-based:
-- 1st = N … last = 1). Tie-break on hundo count = higher total score.
-- Actual ball values are still recorded so per-player averages, ring %,
-- and history stay truthful.
--
-- Mechanism: skeeball_league_matches.scoring_mode
--   NULL     → auto (week 7 of its season ⇒ 'hundos', else 'total')
--   'total'  → explicit normal scoring (admin override)
--   'hundos' → explicit hundo scoring (admin override, any week)
--
-- Run AFTER: skeeball-finalize-fix.sql, skeeball-seasons-stats.sql
-- Idempotent — safe to re-run.
-- ============================================================

-- ── 1. Scoring-mode column (nullable = auto) ─────────────────
ALTER TABLE public.skeeball_league_matches
  ADD COLUMN IF NOT EXISTS scoring_mode text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'skeeball_matches_scoring_mode_chk'
  ) THEN
    ALTER TABLE public.skeeball_league_matches
      ADD CONSTRAINT skeeball_matches_scoring_mode_chk
      CHECK (scoring_mode IS NULL OR scoring_mode IN ('total', 'hundos'));
  END IF;
END $$;


-- ── 2. Season week-number helper ─────────────────────────────
-- 1-based week index within the season that contains p_week. NULL if the
-- date falls outside every defined season.
CREATE OR REPLACE FUNCTION public.skeeball_season_week_number(p_week date)
RETURNS int
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (((p_week - s.start_week) / 7) + 1)::int
    FROM skeeball_seasons s
   WHERE p_week BETWEEN s.start_week AND s.end_week
   ORDER BY s.start_week DESC
   LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.skeeball_season_week_number(date) FROM PUBLIC;
-- internal helper


-- ── 3. Effective scoring mode for a week (client-readable) ───
-- Resolves the NULL=auto rule so the tracker can show "Hundo Week".
CREATE OR REPLACE FUNCTION public.rpc_skeeball_week_scoring_mode(p_week_of date DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
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

REVOKE ALL ON FUNCTION public.rpc_skeeball_week_scoring_mode(date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_skeeball_week_scoring_mode(date) TO authenticated;


-- ── 4. Hundo-aware finalize ──────────────────────────────────
-- Same guards/points/tie logic as before; only the RANK ordering becomes
-- mode-aware. In 'hundos' mode: most 100-ring balls wins, ties broken by
-- total score. In 'total' mode: behaviour is identical to before.
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

REVOKE ALL ON FUNCTION public.rpc_skeeball_finalize_match(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_skeeball_finalize_match(uuid, boolean) TO authenticated;


-- ── 5. Admin override: force a week's scoring mode ───────────
-- p_mode: 'total' | 'hundos' | 'auto' (auto clears the override → NULL).
CREATE OR REPLACE FUNCTION public.rpc_admin_skeeball_set_scoring_mode(
  p_mode    text,
  p_week_of date DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
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
    json_build_object('mode', p_mode, 'matches_updated', v_updated)::text);

  RETURN json_build_object('ok', true, 'week_of', v_week, 'mode', p_mode);
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_admin_skeeball_set_scoring_mode(text, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_admin_skeeball_set_scoring_mode(text, date) TO authenticated;
