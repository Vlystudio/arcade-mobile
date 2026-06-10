-- ============================================================
-- Rate Limit Log Fix — recreate missing rate_limit_log table
--
-- Run AFTER: security-hardening.sql (order 9)
-- Idempotent — safe to re-run.
--
-- Root cause: scripts/security-hardening.sql (P5) defines
-- public.rate_limit_log and public.check_and_log_rate_limit(), but the
-- table was missing from production even though the function existed.
-- Every call to check_and_log_rate_limit() therefore raised
-- "42P01: relation rate_limit_log does not exist":
--   - rpc_karaoke_add (karaoke-rate-limiting.sql) catches this with a
--     blanket EXCEPTION WHEN OTHERS and reported it to users as
--     "You're adding songs too fast" on every authenticated request.
--   - rpc_submit_score (security-hardening-2.sql) does NOT catch it,
--     so every score submission failed outright.
--
-- This script only recreates the missing table/policy/index — it does
-- not change any function definitions.
-- ============================================================

CREATE TABLE IF NOT EXISTS rate_limit_log (
  id         bigserial   PRIMARY KEY,
  user_id    uuid        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  action     text        NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE rate_limit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "No direct access to rate_limit_log" ON rate_limit_log;
CREATE POLICY "No direct access to rate_limit_log" ON rate_limit_log
  FOR ALL USING (false);

CREATE INDEX IF NOT EXISTS idx_rate_limit_user_action_time
  ON rate_limit_log (user_id, action, created_at DESC);
