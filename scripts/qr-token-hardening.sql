-- ============================================================
-- QR Token Hardening
-- Replaces static lanes.lane_qr_token with a dedicated
-- lane_qr_tokens table that stores only SHA-256 hashes of
-- short-lived, revocable tokens.
--
-- Run AFTER: security-hardening.sql, security-hardening-2.sql
-- Idempotent — safe to re-run.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── 0. Ensure prerequisite tables exist ───────────────────────
-- These are created by earlier migrations (seed-games.sql, venue-migration.sql).
-- The IF NOT EXISTS guards make this script safe to run standalone.

CREATE TABLE IF NOT EXISTS venues (
  id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug    text UNIQUE NOT NULL,
  name    text NOT NULL,
  address text,
  color   text
);

CREATE TABLE IF NOT EXISTS games (
  id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  type text
);

CREATE TABLE IF NOT EXISTS lanes (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id            uuid        REFERENCES venues(id) ON DELETE CASCADE,
  game_id             uuid        REFERENCES games(id)  ON DELETE SET NULL,
  lane_number         int,
  status              text        DEFAULT 'active',
  lane_qr_token       text,
  qr_token_issued_at  timestamptz,
  qr_token_expires_at timestamptz
);

ALTER TABLE lanes ENABLE ROW LEVEL SECURITY;

-- Add columns that may be missing on an older lanes table
ALTER TABLE lanes
  ADD COLUMN IF NOT EXISTS venue_id            uuid        REFERENCES venues(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS lane_qr_token       text,
  ADD COLUMN IF NOT EXISTS qr_token_issued_at  timestamptz,
  ADD COLUMN IF NOT EXISTS qr_token_expires_at timestamptz;

CREATE TABLE IF NOT EXISTS check_ins (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  lane_id    uuid        REFERENCES lanes(id)  ON DELETE SET NULL,
  venue_id   uuid        REFERENCES venues(id) ON DELETE SET NULL,
  status     text        NOT NULL DEFAULT 'active',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE check_ins ENABLE ROW LEVEL SECURITY;

-- ── 1. New token table ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lane_qr_tokens (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  lane_id     uuid        NOT NULL REFERENCES lanes(id)   ON DELETE CASCADE,
  venue_id    uuid        NOT NULL REFERENCES venues(id)  ON DELETE CASCADE,
  token_hash  text        NOT NULL UNIQUE,           -- SHA-256(raw_token), hex
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,                           -- NULL = reusable within TTL
  revoked_at  timestamptz,
  created_by  uuid        REFERENCES auth.users(id)  ON DELETE SET NULL,
  created_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lqt_lane_id    ON lane_qr_tokens (lane_id);
CREATE INDEX IF NOT EXISTS idx_lqt_hash       ON lane_qr_tokens (token_hash);
CREATE INDEX IF NOT EXISTS idx_lqt_expires_at ON lane_qr_tokens (expires_at);

ALTER TABLE lane_qr_tokens ENABLE ROW LEVEL SECURITY;

-- Only admins and venue admins can read token metadata (never raw tokens)
DROP POLICY IF EXISTS "Admins read lane_qr_tokens" ON lane_qr_tokens;
CREATE POLICY "Admins read lane_qr_tokens" ON lane_qr_tokens
  FOR SELECT USING (
    public.is_admin()
    OR public.is_venue_admin(venue_id)
  );

-- No direct INSERT/UPDATE — all writes go through SECURITY DEFINER RPCs
DROP POLICY IF EXISTS "No direct write lane_qr_tokens" ON lane_qr_tokens;
CREATE POLICY "No direct write lane_qr_tokens" ON lane_qr_tokens
  FOR ALL USING (false);


-- ── 2. Helper: hash a raw token ───────────────────────────────
-- Used internally; not exposed to clients.
CREATE OR REPLACE FUNCTION public.hash_lane_token(p_raw text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT encode(digest(p_raw::bytea, 'sha256'), 'hex');
$$;

REVOKE ALL ON FUNCTION public.hash_lane_token(text) FROM PUBLIC;
-- Do NOT grant to authenticated — internal use only.


-- ── 3. Admin RPC: generate / rotate a QR token for a lane ────
-- Returns the raw token ONCE. It is never stored in the DB.
-- Callers must encode it into a QR code immediately.
--
-- Token lifetime:   p_ttl_hours (default 720 = 30 days)
-- Rotation policy:  all previous active tokens for the lane are revoked.
--
-- Usage:
--   SELECT rpc_admin_generate_lane_qr_token('lane-uuid'::uuid);
--   -- returns { ok: true, raw_token: "...", qr_url: "...", expires_at: "..." }
CREATE OR REPLACE FUNCTION public.rpc_admin_generate_lane_qr_token(
  p_lane_id    uuid,
  p_ttl_hours  int DEFAULT 720  -- 30 days
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_raw_token  text;
  v_hash       text;
  v_venue_id   uuid;
  v_lane_num   int;
  v_expires_at timestamptz;
  v_site_url   text;
  v_qr_url     text;
BEGIN
  PERFORM public.require_mfa();

  -- Look up lane to get venue context; verifies lane exists
  SELECT venue_id, lane_number
    INTO v_venue_id, v_lane_num
    FROM lanes
   WHERE id = p_lane_id;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'lane_not_found');
  END IF;

  IF NOT (public.is_admin() OR public.is_venue_admin(v_venue_id)) THEN
    RETURN json_build_object('error', 'unauthorized',
      'message', 'You do not have admin rights for this venue.');
  END IF;

  -- Revoke all existing active tokens for this lane
  UPDATE lane_qr_tokens
     SET revoked_at = now()
   WHERE lane_id    = p_lane_id
     AND revoked_at IS NULL;

  -- Generate a new UUID raw token (never stored)
  v_raw_token  := gen_random_uuid()::text;
  v_hash       := public.hash_lane_token(v_raw_token);
  v_expires_at := now() + (p_ttl_hours || ' hours')::interval;

  INSERT INTO lane_qr_tokens (lane_id, venue_id, token_hash, expires_at, created_by)
  VALUES (p_lane_id, v_venue_id, v_hash, v_expires_at, auth.uid());

  -- Also update the legacy column for backward compat with any old clients
  UPDATE lanes
     SET lane_qr_token       = v_raw_token,
         qr_token_issued_at  = now(),
         qr_token_expires_at = v_expires_at
   WHERE id = p_lane_id;

  INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (
    auth.uid(), 'generate_lane_qr_token', 'lane', p_lane_id::text,
    jsonb_build_object(
      'venue_id',     v_venue_id,
      'lane_number',  v_lane_num,
      'ttl_hours',    p_ttl_hours,
      'expires_at',   v_expires_at
    )
  );

  -- Build QR URL — app reads ?lane_token=<raw> from QR
  -- EXPO_PUBLIC_SITE_URL is not available server-side; admin must prepend base URL
  RETURN json_build_object(
    'ok',           true,
    'raw_token',    v_raw_token,        -- encode this into the QR
    'token_suffix', right(v_raw_token, 8), -- for display/label only
    'expires_at',   v_expires_at,
    'ttl_hours',    p_ttl_hours,
    'lane_id',      p_lane_id,
    'lane_number',  v_lane_num,
    'note',         'Encode raw_token into QR as: https://your-site/scan?lane_token=<raw_token>'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_admin_generate_lane_qr_token(uuid, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_admin_generate_lane_qr_token(uuid, int) TO authenticated;


-- ── 4. Updated rpc_check_in: hash-first, legacy fallback ─────
CREATE OR REPLACE FUNCTION public.rpc_check_in(p_token text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id   uuid;
  v_lane      record;
  v_game      record;
  v_ci_id     uuid;
  v_cutoff    timestamptz;
  v_token_hash text;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN json_build_object('error', 'not_authenticated',
      'message', 'You must be logged in to check in.');
  END IF;

  v_token_hash := public.hash_lane_token(p_token);

  -- ── Path A: hashed token lookup (new system) ──────────────
  SELECT l.id, l.lane_number, l.game_id, l.venue_id, l.status
    INTO v_lane
    FROM lane_qr_tokens lqt
    JOIN lanes           l ON l.id = lqt.lane_id
   WHERE lqt.token_hash = v_token_hash
   LIMIT 1;

  IF FOUND THEN
    -- Validate token state
    DECLARE
      v_lqt record;
    BEGIN
      SELECT * INTO v_lqt
        FROM lane_qr_tokens
       WHERE token_hash = v_token_hash;

      IF v_lqt.revoked_at IS NOT NULL THEN
        INSERT INTO security_events (event_type, severity, user_id, details)
        VALUES ('qr_token_revoked', 'warn', v_user_id,
          jsonb_build_object('token_suffix', right(p_token, 8), 'lane_id', v_lqt.lane_id))
        ON CONFLICT DO NOTHING;
        RETURN json_build_object('error', 'token_revoked',
          'message', 'This QR code has been revoked. Ask staff for a new one.');
      END IF;

      IF v_lqt.expires_at < now() THEN
        INSERT INTO security_events (event_type, severity, user_id, details)
        VALUES ('qr_token_expired', 'warn', v_user_id,
          jsonb_build_object('token_suffix', right(p_token, 8), 'lane_id', v_lqt.lane_id))
        ON CONFLICT DO NOTHING;
        RETURN json_build_object('error', 'token_expired',
          'message', 'This QR code has expired. Ask staff to regenerate it.');
      END IF;
    END;
  ELSE
    -- ── Path B: legacy lane_qr_token fallback ─────────────
    SELECT l.id, l.lane_number, l.game_id, l.venue_id, l.status
      INTO v_lane
      FROM lanes l
     WHERE l.lane_qr_token = p_token
     LIMIT 1;

    IF NOT FOUND THEN
      INSERT INTO security_events (event_type, severity, user_id, details)
      VALUES ('qr_token_invalid', 'warn', v_user_id,
        jsonb_build_object('token_suffix', right(p_token, 8)))
      ON CONFLICT DO NOTHING;
      RETURN json_build_object('error', 'lane_not_found',
        'message', 'This QR code does not match any lane.');
    END IF;

    -- Check legacy expiry
    IF EXISTS (
      SELECT 1 FROM lanes
       WHERE id = v_lane.id
         AND qr_token_expires_at IS NOT NULL
         AND qr_token_expires_at < now()
    ) THEN
      RETURN json_build_object('error', 'token_expired',
        'message', 'This QR code has expired. Ask staff to regenerate it.');
    END IF;
  END IF;

  -- ── Common validation ────────────────────────────────────

  IF v_lane.status IS NOT NULL AND v_lane.status = 'inactive' THEN
    RETURN json_build_object('error', 'lane_inactive',
      'message', 'This lane is currently inactive.');
  END IF;

  -- Prevent duplicate active check-ins
  IF EXISTS (
    SELECT 1 FROM check_ins
     WHERE user_id = v_user_id AND status = 'active'
  ) THEN
    RETURN json_build_object('error', 'already_active',
      'message', 'You already have an active session. End it before scanning a new lane.');
  END IF;

  -- 30-minute cooldown per lane
  v_cutoff := now() - interval '30 minutes';
  IF EXISTS (
    SELECT 1 FROM check_ins
     WHERE user_id    = v_user_id
       AND lane_id    = v_lane.id
       AND created_at > v_cutoff
  ) THEN
    RETURN json_build_object('error', 'rate_limited',
      'message', 'You checked into this lane recently. Wait 30 minutes before scanning again.');
  END IF;

  SELECT g.name, g.type INTO v_game
    FROM games g WHERE g.id = v_lane.game_id;

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

REVOKE ALL ON FUNCTION public.rpc_check_in(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_check_in(text) TO authenticated;


-- ── 5. Migrate existing lanes → lane_qr_tokens ───────────────
-- Back-fills any lane that already has lane_qr_token set.
-- Tokens are migrated as pre-hashed; admins should rotate soon.
INSERT INTO lane_qr_tokens (lane_id, venue_id, token_hash, expires_at, created_by)
SELECT
  l.id                                             AS lane_id,
  l.venue_id                                       AS venue_id,
  public.hash_lane_token(l.lane_qr_token)          AS token_hash,
  COALESCE(l.qr_token_expires_at, now() + interval '90 days') AS expires_at,
  NULL                                             AS created_by
FROM lanes l
WHERE l.lane_qr_token IS NOT NULL
  AND l.venue_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM lane_qr_tokens lqt WHERE lqt.lane_id = l.id
  )
ON CONFLICT (token_hash) DO NOTHING;


-- ── 6. Verification queries (run manually to check) ──────────
/*
-- Should return 0 rows (no null hashes)
SELECT * FROM lane_qr_tokens WHERE token_hash IS NULL;

-- Should return 0 rows (no duplicate hashes)
SELECT token_hash, COUNT(*) FROM lane_qr_tokens GROUP BY token_hash HAVING COUNT(*) > 1;

-- Test expired token fails
SELECT rpc_check_in('definitely-not-a-real-token-xyz');
-- Expected: { "error": "lane_not_found", ... }
*/
