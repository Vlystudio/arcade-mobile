-- ============================================================
-- Atomic check-in RPC
-- Run in Supabase SQL Editor.
-- Called from the app as: supabase.rpc("rpc_check_in", { p_token: "..." })
-- ============================================================

CREATE OR REPLACE FUNCTION public.rpc_check_in(p_token text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id  uuid;
  v_lane     record;
  v_game     record;
  v_ci_id    uuid;
  v_cutoff   timestamptz;
BEGIN
  -- 1. Auth check
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN json_build_object('error', 'not_authenticated',
                             'message', 'You must be logged in.');
  END IF;

  -- 2. Look up lane by token
  SELECT l.id, l.lane_number, l.game_id, l.venue_id, l.status
    INTO v_lane
    FROM lanes l
   WHERE l.lane_qr_token = p_token
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'lane_not_found',
                             'message', 'This QR code does not match any lane.');
  END IF;

  -- 3. Prevent duplicate active sessions
  IF EXISTS (
    SELECT 1 FROM check_ins
     WHERE user_id = v_user_id AND status = 'active'
  ) THEN
    RETURN json_build_object('error', 'already_active',
                             'message', 'You already have an active session. End it before scanning a new lane.');
  END IF;

  -- 4. 30-minute cooldown per lane
  v_cutoff := NOW() - INTERVAL '30 minutes';
  IF EXISTS (
    SELECT 1 FROM check_ins
     WHERE user_id = v_user_id
       AND lane_id  = v_lane.id
       AND created_at > v_cutoff
  ) THEN
    RETURN json_build_object('error', 'rate_limited',
                             'message', 'You checked into this lane recently. Wait 30 minutes before scanning again.');
  END IF;

  -- 5. Fetch game info
  SELECT g.name, g.type INTO v_game
    FROM games g WHERE g.id = v_lane.game_id;

  -- 6. Create check-in atomically
  INSERT INTO check_ins (user_id, lane_id, venue_id, status)
  VALUES (v_user_id, v_lane.id, v_lane.venue_id, 'active')
  RETURNING id INTO v_ci_id;

  RETURN json_build_object(
    'check_in_id',  v_ci_id,
    'lane_id',      v_lane.id,
    'lane_number',  v_lane.lane_number,
    'game_id',      v_lane.game_id,
    'game_name',    COALESCE(v_game.name, 'Game'),
    'game_type',    COALESCE(v_game.type, 'arcade'),
    'venue_id',     v_lane.venue_id
  );
END;
$$;

-- Allow authenticated callers to execute it
REVOKE ALL ON FUNCTION public.rpc_check_in(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_check_in(text) TO authenticated;
