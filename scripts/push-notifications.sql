-- Push notification infrastructure
-- - push_tokens: one row per device Expo push token
-- - skeeball_league_matches.notified_at: dedupe for round-final pushes

CREATE TABLE IF NOT EXISTS public.push_tokens (
  token text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  platform text NOT NULL DEFAULT 'unknown',
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_push_tokens_user ON public.push_tokens (user_id);

ALTER TABLE public.push_tokens ENABLE ROW LEVEL SECURITY;

-- Users manage only their own device tokens; reads happen via service role
DROP POLICY IF EXISTS "push_tokens_own_insert" ON public.push_tokens;
CREATE POLICY "push_tokens_own_insert" ON public.push_tokens
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "push_tokens_own_update" ON public.push_tokens;
CREATE POLICY "push_tokens_own_update" ON public.push_tokens
  FOR UPDATE TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "push_tokens_own_delete" ON public.push_tokens;
CREATE POLICY "push_tokens_own_delete" ON public.push_tokens
  FOR DELETE TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "push_tokens_own_select" ON public.push_tokens;
CREATE POLICY "push_tokens_own_select" ON public.push_tokens
  FOR SELECT TO authenticated USING (user_id = auth.uid());

ALTER TABLE public.skeeball_league_matches
  ADD COLUMN IF NOT EXISTS notified_at timestamptz;
