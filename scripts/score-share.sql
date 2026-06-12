-- Public score card for share links (/score-share?id=...).
-- Anon-accessible by design: approved scores are public leaderboard
-- content. Returns only display fields; pending/denied scores 404.
CREATE OR REPLACE FUNCTION public.rpc_public_score_card(p_score_id uuid)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_s record;
  v_rank int;
BEGIN
  SELECT s.id, s.score, s.created_at, s.game_id, s.user_id,
         g.name AS game_name, g.type AS game_type,
         p.username, p.avatar_url
    INTO v_s
    FROM scores s
    JOIN games g ON g.id = s.game_id
    LEFT JOIN profiles p ON p.id = s.user_id
   WHERE s.id = p_score_id AND s.status = 'approved';
  IF NOT FOUND THEN
    RETURN json_build_object('error', 'not_found');
  END IF;

  SELECT count(*) + 1 INTO v_rank
    FROM scores
   WHERE game_id = v_s.game_id AND status = 'approved' AND score > v_s.score;

  RETURN json_build_object(
    'username',   COALESCE(v_s.username, 'Player'),
    'avatar_url', v_s.avatar_url,
    'game_name',  v_s.game_name,
    'game_type',  v_s.game_type,
    'score',      v_s.score,
    'rank',       v_rank,
    'created_at', v_s.created_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_public_score_card(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_public_score_card(uuid) TO anon, authenticated;
