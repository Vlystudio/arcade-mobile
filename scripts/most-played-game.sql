-- ============================================================
-- rpc_most_played_game — the game with the most approved scores.
--
-- Used by the Leaderboard screen to pick a sensible default board
-- (the most-played game) instead of "All Games". Returns NULL when no
-- approved scores exist yet, in which case the client falls back to
-- All Games.
--
-- STABLE + SECURITY DEFINER so it runs as one cheap aggregate regardless
-- of the caller's row visibility; only non-sensitive fields are returned.
-- Idempotent — safe to re-run.
-- ============================================================
CREATE OR REPLACE FUNCTION public.rpc_most_played_game()
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT json_build_object('id', g.id, 'name', g.name, 'type', g.type)
    FROM scores s
    JOIN games g ON g.id = s.game_id
   WHERE s.status = 'approved'
   GROUP BY g.id, g.name, g.type
   ORDER BY count(*) DESC, max(s.created_at) DESC
   LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.rpc_most_played_game() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_most_played_game() TO authenticated, anon;
