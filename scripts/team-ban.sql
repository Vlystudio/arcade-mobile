-- team_bans: tracks users banned from a specific team by the captain
CREATE TABLE IF NOT EXISTS public.team_bans (
  id         uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  team_id    uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  banned_by  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE(team_id, user_id)
);

ALTER TABLE public.team_bans ENABLE ROW LEVEL SECURITY;

-- Banned user can see their own bans (for client-side filtering).
-- Captain can see bans they issued.
DROP POLICY IF EXISTS "team_bans_select" ON public.team_bans;
CREATE POLICY "team_bans_select" ON public.team_bans
  FOR SELECT USING (user_id = auth.uid() OR banned_by = auth.uid());

-- ─── rpc_team_kick ────────────────────────────────────────────────────────────
-- Removes a member from the team. They can request to rejoin.
CREATE OR REPLACE FUNCTION public.rpc_team_kick(p_team_id uuid, p_member_id uuid)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.teams WHERE id = p_team_id AND captain_user_id = auth.uid()
  ) THEN
    RETURN json_build_object('error', 'unauthorized');
  END IF;

  IF p_member_id = auth.uid() THEN
    RETURN json_build_object('error', 'cannot_kick_self');
  END IF;

  DELETE FROM public.team_members WHERE team_id = p_team_id AND user_id = p_member_id;
  RETURN json_build_object('ok', true);
END; $$;

REVOKE ALL ON FUNCTION public.rpc_team_kick FROM public, anon;
GRANT EXECUTE ON FUNCTION public.rpc_team_kick TO authenticated;

-- ─── rpc_team_ban ─────────────────────────────────────────────────────────────
-- Removes member, clears pending requests, and inserts a ban record.
-- Banned users cannot see the team in search or request to join.
CREATE OR REPLACE FUNCTION public.rpc_team_ban(p_team_id uuid, p_member_id uuid)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.teams WHERE id = p_team_id AND captain_user_id = auth.uid()
  ) THEN
    RETURN json_build_object('error', 'unauthorized');
  END IF;

  IF p_member_id = auth.uid() THEN
    RETURN json_build_object('error', 'cannot_ban_self');
  END IF;

  -- Remove from team
  DELETE FROM public.team_members WHERE team_id = p_team_id AND user_id = p_member_id;

  -- Cancel any open requests/invites
  DELETE FROM public.team_requests WHERE team_id = p_team_id AND user_id = p_member_id;

  -- Insert ban record (idempotent)
  INSERT INTO public.team_bans(team_id, user_id, banned_by)
  VALUES (p_team_id, p_member_id, auth.uid())
  ON CONFLICT (team_id, user_id) DO NOTHING;

  RETURN json_build_object('ok', true);
END; $$;

REVOKE ALL ON FUNCTION public.rpc_team_ban FROM public, anon;
GRANT EXECUTE ON FUNCTION public.rpc_team_ban TO authenticated;

-- ─── rpc_team_unban ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_team_unban(p_team_id uuid, p_member_id uuid)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.teams WHERE id = p_team_id AND captain_user_id = auth.uid()
  ) THEN
    RETURN json_build_object('error', 'unauthorized');
  END IF;

  DELETE FROM public.team_bans WHERE team_id = p_team_id AND user_id = p_member_id;
  RETURN json_build_object('ok', true);
END; $$;

REVOKE ALL ON FUNCTION public.rpc_team_unban FROM public, anon;
GRANT EXECUTE ON FUNCTION public.rpc_team_unban TO authenticated;
