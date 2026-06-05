-- Admin RPCs for editing and deleting tournaments.
-- Uses SECURITY DEFINER so they bypass RLS (consistent with all other admin RPCs).

CREATE OR REPLACE FUNCTION public.rpc_admin_update_tournament(
  p_tournament_id uuid,
  p_title         text        DEFAULT NULL,
  p_game_type     text        DEFAULT NULL,
  p_proposed_date timestamptz DEFAULT NULL,
  p_max_players   int         DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RETURN json_build_object('error', 'unauthorized');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM tournaments WHERE id = p_tournament_id) THEN
    RETURN json_build_object('error', 'tournament_not_found');
  END IF;

  UPDATE tournaments SET
    title         = COALESCE(NULLIF(trim(p_title), ''),  title),
    game_type     = CASE WHEN p_title IS NOT NULL THEN NULLIF(trim(p_game_type), '') ELSE game_type END,
    proposed_date = COALESCE(p_proposed_date, proposed_date),
    max_players   = COALESCE(p_max_players,   max_players)
  WHERE id = p_tournament_id;

  RETURN json_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_admin_delete_tournament(
  p_tournament_id uuid
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RETURN json_build_object('error', 'unauthorized');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM tournaments WHERE id = p_tournament_id) THEN
    RETURN json_build_object('error', 'tournament_not_found');
  END IF;

  DELETE FROM tournaments WHERE id = p_tournament_id;

  RETURN json_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_admin_update_tournament(uuid, text, text, timestamptz, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_delete_tournament(uuid) TO authenticated;
