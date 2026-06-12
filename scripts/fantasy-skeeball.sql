-- ============================================================
-- Fantasy Skee-Ball League
--
-- Phase 1 (LIVE NOW) — "Predictions":
--   Users hold a Skee-Coin wallet (100 to start, +20 weekly stipend).
--   Each week, before the first game finishes, they bet coins on whether
--   a team's TOTAL league points for the week will land OVER or UNDER a
--   line (15 / 20 / 25 / 30). Odds are computed from the team's actual
--   hit-rate history and locked into the pick. Weeks settle automatically;
--   the week's top net winner earns a +25 coin bonus.
--
-- Phase 2 (UNLOCKS after 4 counted full seasons — targeted early 2027 — or admin override) —
--   "Transfer Market": every player gets a price from their per-game
--   scoring average across counted seasons (individual skee-ball
--   tournament results included). Salary-cap rosters, buy/sell transfers,
--   hot-streak flags. Tables + RPCs ship now; buy/sell are gated until
--   fantasy_full_mode() is true. The market screen shows a live preview
--   of provisional prices while data accumulates.
--
-- Seasons: skeeball_seasons.counts_for_fantasy lets admins exclude short
-- seasons (e.g. the upcoming half-season) from the 4-season requirement
-- and from price math.
--
-- Run AFTER: skeeball-seasons-stats.sql, skeeball-qr-lane-checkin.sql,
--            community-league-extras.sql
-- Idempotent — safe to re-run.
-- ============================================================


-- ── 0. Season counting flag ──────────────────────────────────
ALTER TABLE public.skeeball_seasons
  ADD COLUMN IF NOT EXISTS counts_for_fantasy boolean NOT NULL DEFAULT true;


-- ── 1. Config singleton ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.fantasy_config (
  id                int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  full_mode_enabled boolean NOT NULL DEFAULT false,
  seasons_required  int NOT NULL DEFAULT 4,
  updated_at        timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.fantasy_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.fantasy_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "fantasy_config_read" ON public.fantasy_config;
CREATE POLICY "fantasy_config_read" ON public.fantasy_config
  FOR SELECT TO authenticated USING (true);
-- writes only via admin RPC (SECURITY DEFINER)


-- ── 2. Wallets ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.fantasy_wallets (
  user_id           uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  balance           int NOT NULL DEFAULT 100 CHECK (balance >= 0),
  lifetime_earned   int NOT NULL DEFAULT 0,
  last_stipend_week date,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.fantasy_wallets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "fantasy_wallets_own" ON public.fantasy_wallets;
CREATE POLICY "fantasy_wallets_own" ON public.fantasy_wallets
  FOR SELECT TO authenticated USING (user_id = auth.uid());
-- all writes via SECURITY DEFINER RPCs


-- ── 3. Predictions ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.fantasy_predictions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  week_of       date NOT NULL,
  team_id       uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  line          int  NOT NULL CHECK (line IN (15, 20, 25, 30)),
  pick          text NOT NULL CHECK (pick IN ('over', 'under')),
  stake         int  NOT NULL CHECK (stake BETWEEN 5 AND 50),
  multiplier    numeric(5,2) NOT NULL CHECK (multiplier >= 1.0),
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'won', 'lost', 'void')),
  result_points int,
  payout        int NOT NULL DEFAULT 0,
  settled_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, week_of, team_id, line)
);

CREATE INDEX IF NOT EXISTS idx_fpred_week_status ON public.fantasy_predictions (week_of, status);
CREATE INDEX IF NOT EXISTS idx_fpred_user        ON public.fantasy_predictions (user_id, created_at DESC);

ALTER TABLE public.fantasy_predictions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "fantasy_predictions_own" ON public.fantasy_predictions;
CREATE POLICY "fantasy_predictions_own" ON public.fantasy_predictions
  FOR SELECT TO authenticated USING (user_id = auth.uid());


-- ── 4. Weekly top-predictor bonus ledger (idempotency) ───────
CREATE TABLE IF NOT EXISTS public.fantasy_week_bonuses (
  week_of    date PRIMARY KEY,
  awarded_to uuid[] NOT NULL,
  awarded_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.fantasy_week_bonuses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "fantasy_week_bonuses_read" ON public.fantasy_week_bonuses;
CREATE POLICY "fantasy_week_bonuses_read" ON public.fantasy_week_bonuses
  FOR SELECT TO authenticated USING (true);


-- ── 5. Phase 2: market tables (gated until full mode) ────────
CREATE TABLE IF NOT EXISTS public.fantasy_rosters (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  season_id  uuid REFERENCES public.skeeball_seasons(id) ON DELETE SET NULL,
  budget     int NOT NULL DEFAULT 1000,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, season_id)
);

CREATE TABLE IF NOT EXISTS public.fantasy_roster_players (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  roster_id      uuid NOT NULL REFERENCES public.fantasy_rosters(id) ON DELETE CASCADE,
  player_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  price_paid     int NOT NULL,
  acquired_at    timestamptz NOT NULL DEFAULT now(),
  sold_at        timestamptz,
  sell_price     int
);

CREATE TABLE IF NOT EXISTS public.fantasy_transfers (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  roster_id      uuid NOT NULL REFERENCES public.fantasy_rosters(id) ON DELETE CASCADE,
  player_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  action         text NOT NULL CHECK (action IN ('buy', 'sell')),
  price          int NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.fantasy_rosters        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fantasy_roster_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fantasy_transfers      ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fantasy_rosters_own" ON public.fantasy_rosters;
CREATE POLICY "fantasy_rosters_own" ON public.fantasy_rosters
  FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS "fantasy_roster_players_own" ON public.fantasy_roster_players;
CREATE POLICY "fantasy_roster_players_own" ON public.fantasy_roster_players
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.fantasy_rosters r WHERE r.id = roster_id AND r.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "fantasy_transfers_own" ON public.fantasy_transfers;
CREATE POLICY "fantasy_transfers_own" ON public.fantasy_transfers
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.fantasy_rosters r WHERE r.id = roster_id AND r.user_id = auth.uid())
  );


-- ── 6. Helpers ───────────────────────────────────────────────

-- True once enough counted seasons have completed, or the admin override is on.
CREATE OR REPLACE FUNCTION public.fantasy_full_mode()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    (SELECT full_mode_enabled FROM fantasy_config WHERE id = 1)
    OR (SELECT count(*) FROM skeeball_seasons
         WHERE status = 'completed' AND counts_for_fantasy)
       >= (SELECT seasons_required FROM fantasy_config WHERE id = 1);
$$;

-- A team's total league points for one week. NULL = didn't play (void).
CREATE OR REPLACE FUNCTION public.fantasy_team_week_points(p_team_id uuid, p_week date)
RETURNS int
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE WHEN count(*) = 0 THEN NULL
              ELSE COALESCE(SUM(COALESCE(league_points, 0) + COALESCE(league_points_adjustment, 0)), 0)::int
         END
  FROM skeeball_sessions
  WHERE team_id = p_team_id AND week_of = p_week AND status = 'completed';
$$;

-- Locked-in odds for a pick, from the team's real hit-rate history.
-- Laplace smoothing keeps new teams near even odds; 8% house edge;
-- clamped to [1.15, 8.0].
CREATE OR REPLACE FUNCTION public.fantasy_line_multiplier(p_team_id uuid, p_line int, p_pick text)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
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

-- Current week's board is locked once any team finishes a game that week.
CREATE OR REPLACE FUNCTION public.fantasy_week_locked(p_week date)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM skeeball_sessions
     WHERE week_of = p_week AND status = 'completed'
  );
$$;

REVOKE ALL ON FUNCTION public.fantasy_full_mode()                       FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fantasy_team_week_points(uuid, date)      FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fantasy_line_multiplier(uuid, int, text)  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fantasy_week_locked(date)                 FROM PUBLIC;
-- internal helpers — not granted to clients


-- ── 7. Settlement (internal, idempotent, advisory-locked) ────
-- Settles every pending prediction for weeks BEFORE the current week.
-- Void (team didn't play) refunds the stake. Wins credit stake×multiplier.
-- After settling a week, the top net winner(s) get a +25 coin bonus, once.
CREATE OR REPLACE FUNCTION public.fantasy_settle_pending()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

REVOKE ALL ON FUNCTION public.fantasy_settle_pending() FROM PUBLIC;
-- internal — called from rpc_fantasy_get_state


-- ── 8. RPC: place a prediction ───────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_fantasy_place_prediction(
  p_team_id uuid,
  p_line    int,
  p_pick    text,
  p_stake   int
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

REVOKE ALL ON FUNCTION public.rpc_fantasy_place_prediction(uuid, int, text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_fantasy_place_prediction(uuid, int, text, int) TO authenticated;


-- ── 9. RPC: cancel a pending pick (before lock) ──────────────
CREATE OR REPLACE FUNCTION public.rpc_fantasy_cancel_prediction(p_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

REVOKE ALL ON FUNCTION public.rpc_fantasy_cancel_prediction(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_fantasy_cancel_prediction(uuid) TO authenticated;


-- ── 10. RPC: full screen state ───────────────────────────────
-- Lazily settles past weeks, grants the weekly stipend, then returns
-- wallet, phase progress, this week's board with locked-in odds, the
-- caller's picks, recent history, last week's results, and the
-- coin leaderboard.
CREATE OR REPLACE FUNCTION public.rpc_fantasy_get_state()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

REVOKE ALL ON FUNCTION public.rpc_fantasy_get_state() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_fantasy_get_state() TO authenticated;


-- ── 11. RPC: transfer-market preview / live market ───────────
-- Player prices from per-game scoring average across ALL skee-ball play —
-- league nights AND individual tournaments (any approved score on a
-- skeeball-type game counts). Until fantasy_full_mode() the response is a
-- provisional preview and buy/sell stay locked.
CREATE OR REPLACE FUNCTION public.rpc_fantasy_market()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

REVOKE ALL ON FUNCTION public.rpc_fantasy_market() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_fantasy_market() TO authenticated;


-- ── 12. RPCs: buy / sell (hard-gated until full mode) ────────
CREATE OR REPLACE FUNCTION public.rpc_fantasy_buy_player(p_player_user_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

CREATE OR REPLACE FUNCTION public.rpc_fantasy_sell_player(p_player_user_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

REVOKE ALL ON FUNCTION public.rpc_fantasy_buy_player(uuid)  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_fantasy_sell_player(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_fantasy_buy_player(uuid)  TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_fantasy_sell_player(uuid) TO authenticated;


-- ── 13. Admin RPCs ───────────────────────────────────────────
-- Mark a season as counted/not-counted for fantasy (e.g. exclude the
-- upcoming short season), and force full mode on/off.
CREATE OR REPLACE FUNCTION public.rpc_admin_fantasy_set_season_counts(
  p_season_id uuid,
  p_counts    boolean
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

CREATE OR REPLACE FUNCTION public.rpc_admin_fantasy_set_full_mode(p_enabled boolean)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

REVOKE ALL ON FUNCTION public.rpc_admin_fantasy_set_season_counts(uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_admin_fantasy_set_full_mode(boolean)           FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_admin_fantasy_set_season_counts(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_fantasy_set_full_mode(boolean)           TO authenticated;
