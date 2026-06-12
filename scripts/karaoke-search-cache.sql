-- ============================================================
-- Karaoke search cache
--
-- YouTube Data API search costs ~101 quota units per call against a
-- 10,000 unit/day default quota (~99 searches/day TOTAL). Karaoke
-- queries repeat heavily, so /api/youtube/search now serves repeats
-- from this table (7-day TTL) and only spends quota on novel queries.
--
-- Written exclusively by the Vercel route using the service role —
-- no client access at all.
--
-- Idempotent — safe to re-run.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.karaoke_search_cache (
  query_norm text PRIMARY KEY,          -- lowercased, whitespace-collapsed query
  results    jsonb NOT NULL,            -- the exact items payload returned to clients
  hits       int NOT NULL DEFAULT 0,    -- served-from-cache counter (observability)
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_karaoke_search_cache_age
  ON public.karaoke_search_cache (created_at);

ALTER TABLE public.karaoke_search_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "karaoke_search_cache_no_access" ON public.karaoke_search_cache;
CREATE POLICY "karaoke_search_cache_no_access" ON public.karaoke_search_cache
  FOR ALL USING (false);
