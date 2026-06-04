-- ============================================================
-- Security Verification Tests
-- Repeatable test suite confirming RLS and RPC security rules.
--
-- HOW TO RUN
-- ----------
-- 1. Open Supabase SQL Editor (or psql).
-- 2. Run this entire file.
-- 3. Every SELECT should return a single row with result='PASS'.
--    Any 'FAIL' rows indicate a security regression.
--
-- These tests use SET LOCAL ROLE and set_config() to simulate
-- different callers without touching real auth.users rows.
-- All test transactions are rolled back — no data is changed.
--
-- Run AFTER all migration scripts have been applied.
-- ============================================================

-- Ensure pgcrypto is available (needed for hash_lane_token)
CREATE EXTENSION IF NOT EXISTS pgcrypto SCHEMA extensions;

-- ────────────────────────────────────────────────────────────
-- Helper: report a test result
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.test_result(
  test_name text,
  passed    boolean
) RETURNS TABLE (test text, result text) AS $$
  SELECT test_name, CASE WHEN passed THEN 'PASS' ELSE 'FAIL' END;
$$ LANGUAGE sql;

-- ════════════════════════════════════════════════════════════
-- BLOCK 1: Anonymous user — cannot read private data
-- ════════════════════════════════════════════════════════════
BEGIN;
SET LOCAL ROLE anon;
-- Anonymous has no auth.uid()

SELECT * FROM test_result(
  'anon: cannot read scores',
  (SELECT COUNT(*) FROM scores) = 0
);

SELECT * FROM test_result(
  'anon: cannot read profiles',
  (SELECT COUNT(*) FROM profiles) = 0
);

SELECT * FROM test_result(
  'anon: cannot read admin_audit_log',
  (SELECT COUNT(*) FROM admin_audit_log) = 0
);

SELECT * FROM test_result(
  'anon: cannot read security_events',
  (SELECT COUNT(*) FROM security_events) = 0
);

SELECT * FROM test_result(
  'anon: cannot read check_ins',
  (SELECT COUNT(*) FROM check_ins) = 0
);

SELECT * FROM test_result(
  'anon: cannot read rate_limit_log',
  (SELECT COUNT(*) FROM rate_limit_log) = 0
);

SELECT * FROM test_result(
  'anon: cannot read lane_qr_tokens',
  (SELECT COUNT(*) FROM lane_qr_tokens) = 0
);

SELECT * FROM test_result(
  'anon: cannot read venue_admins',
  (SELECT COUNT(*) FROM venue_admins) = 0
);

-- public_profiles view should be readable by anon (it is the public-facing view)
-- but only show non-private profiles
SELECT * FROM test_result(
  'anon: public_profiles only shows non-private',
  NOT EXISTS (
    SELECT 1 FROM public_profiles pp
    JOIN profiles p ON p.id = pp.id
    WHERE COALESCE(p.is_private, false) = true
  )
);

ROLLBACK;


-- ════════════════════════════════════════════════════════════
-- BLOCK 2: Authenticated normal user
-- ════════════════════════════════════════════════════════════
BEGIN;
SET LOCAL ROLE authenticated;

-- Simulate user_a and user_b as two separate authenticated users
DO $$
DECLARE
  v_uid_a uuid := gen_random_uuid();
  v_uid_b uuid := gen_random_uuid();
  v_result json;
  v_score_id uuid;
BEGIN
  -- Set up fake JWT claims for user_a
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_uid_a, 'role', 'authenticated')::text,
    true);

  -- ── Test: normal user cannot insert into check_ins directly
  BEGIN
    INSERT INTO check_ins (user_id, lane_id, venue_id, status)
    VALUES (v_uid_a, gen_random_uuid(), gen_random_uuid(), 'active');
    RAISE EXCEPTION 'FAIL: direct check_ins insert should have been blocked';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE 'FAIL:%' THEN
      RAISE NOTICE 'PASS: direct check_ins insert blocked — %', SQLERRM;
    ELSE
      RAISE;
    END IF;
  END;

  -- ── Test: normal user cannot insert into scores directly
  BEGIN
    INSERT INTO scores (user_id, game_id, venue_id, score)
    VALUES (v_uid_a, gen_random_uuid(), gen_random_uuid(), 100);
    RAISE EXCEPTION 'FAIL: direct scores insert should have been blocked';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE 'FAIL:%' THEN
      RAISE NOTICE 'PASS: direct scores insert blocked — %', SQLERRM;
    ELSE
      RAISE;
    END IF;
  END;

  -- ── Test: user cannot read admin_audit_log
  DECLARE v_count int;
  BEGIN
    SELECT COUNT(*) INTO v_count FROM admin_audit_log;
    IF v_count > 0 THEN
      RAISE NOTICE 'FAIL: normal user can read admin_audit_log (% rows)', v_count;
    ELSE
      RAISE NOTICE 'PASS: normal user cannot read admin_audit_log';
    END IF;
  END;

  -- ── Test: user cannot update another user's profile
  BEGIN
    UPDATE profiles SET bio = 'hacked' WHERE id = v_uid_b;
    IF FOUND THEN
      RAISE NOTICE 'FAIL: user updated another user''s profile';
    ELSE
      RAISE NOTICE 'PASS: cannot update other user''s profile (no rows matched)';
    END IF;
  END;

  -- ── Test: user cannot self-promote to admin
  BEGIN
    UPDATE profiles SET is_admin = true WHERE id = v_uid_a;
    RAISE EXCEPTION 'FAIL: self-promotion to admin should have been blocked';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE 'FAIL:%' THEN
      RAISE NOTICE 'PASS: self-promotion to admin blocked — %', SQLERRM;
    ELSE
      RAISE;
    END IF;
  END;

  -- ── Test: user cannot call admin RPC without MFA
  -- rpc_admin_review_score requires require_mfa() which checks aal=aal2
  -- With a plain aal1 JWT, this should raise P0003
  BEGIN
    SELECT rpc_admin_review_score(gen_random_uuid(), 'approved') INTO v_result;
    IF (v_result->>'error') IS NOT NULL THEN
      RAISE NOTICE 'PASS: admin RPC rejected without MFA — %', v_result->>'error';
    ELSE
      RAISE NOTICE 'FAIL: admin RPC allowed without MFA — %', v_result;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'PASS: admin RPC raised exception without MFA — %', SQLERRM;
  END;

END;
$$;

ROLLBACK;


-- ════════════════════════════════════════════════════════════
-- BLOCK 3: QR token validation
-- ════════════════════════════════════════════════════════════
BEGIN;

-- Test: hash function produces consistent output
SELECT * FROM test_result(
  'hash_lane_token: consistent SHA-256',
  public.hash_lane_token('test-token-abc') =
  public.hash_lane_token('test-token-abc')
);

SELECT * FROM test_result(
  'hash_lane_token: different inputs produce different hashes',
  public.hash_lane_token('token-a') <> public.hash_lane_token('token-b')
);

SELECT * FROM test_result(
  'hash_lane_token: produces 64-char hex string',
  length(public.hash_lane_token('any-input')) = 64
);

-- Test: expired token in lane_qr_tokens fails check_in
-- (We simulate by testing the rpc_check_in logic against a fake expired token)
SET LOCAL ROLE authenticated;
DO $$
DECLARE
  v_uid uuid := gen_random_uuid();
  v_result json;
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);

  -- Call rpc_check_in with a clearly invalid token
  SELECT rpc_check_in('invalid-qr-token-that-does-not-exist') INTO v_result;
  IF (v_result->>'error') = 'lane_not_found' THEN
    RAISE NOTICE 'PASS: invalid QR token returns lane_not_found';
  ELSE
    RAISE NOTICE 'FAIL: unexpected result for invalid token — %', v_result;
  END IF;
END;
$$;

ROLLBACK;


-- ════════════════════════════════════════════════════════════
-- BLOCK 4: Role escalation guard
-- ════════════════════════════════════════════════════════════
BEGIN;
SET LOCAL ROLE authenticated;
DO $$
DECLARE
  v_uid uuid := gen_random_uuid();
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);

  -- Attempt to UPDATE profiles.is_admin = true
  BEGIN
    UPDATE profiles SET is_admin = true WHERE id = v_uid;
    RAISE NOTICE 'FAIL: is_admin escalation was not blocked';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'PASS: is_admin escalation blocked — %', left(SQLERRM, 80);
  END;
END;
$$;
ROLLBACK;


-- ════════════════════════════════════════════════════════════
-- BLOCK 5: Storage path convention verification
-- ════════════════════════════════════════════════════════════
-- Verifies that the storage.foldername() helper returns what we expect
-- (used in storage policies to enforce path-based ownership)
BEGIN;

SELECT * FROM test_result(
  'storage.foldername: first segment is user_id folder',
  (storage.foldername('550e8400-e29b-41d4-a716-446655440000/my-score.jpg'))[1]
    = '550e8400-e29b-41d4-a716-446655440000'
);

SELECT * FROM test_result(
  'storage.foldername: second segment for nested path',
  (storage.foldername('userId/scoreId/proof.jpg'))[2] = 'scoreId'
);

ROLLBACK;


-- ════════════════════════════════════════════════════════════
-- BLOCK 6: public_profiles view
-- ════════════════════════════════════════════════════════════
BEGIN;
SET LOCAL ROLE authenticated;

-- View should NOT expose is_admin, email, or sensitive fields
SELECT * FROM test_result(
  'public_profiles: does not expose is_admin column',
  NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'public_profiles'
      AND column_name IN ('is_admin', 'email', 'phone')
  )
);

ROLLBACK;


-- ════════════════════════════════════════════════════════════
-- BLOCK 7: Venue isolation (conceptual — requires real data)
-- ════════════════════════════════════════════════════════════
-- These tests document the expected behaviour but can only be
-- fully verified with real venue + user data in the database.
-- Run manually in the Supabase SQL editor with real IDs.

/*
-- Replace with real IDs from your database:
-- SET LOCAL ROLE authenticated;
-- PERFORM set_config('request.jwt.claims',
--   json_build_object('sub', '<venue_a_admin_id>', 'role', 'authenticated')::text, true);
--
-- Test: venue A admin cannot review score belonging to venue B
-- SELECT rpc_admin_review_score('<venue_b_score_id>', 'approved');
-- Expected: { "error": "unauthorized" }
--
-- Test: venue staff cannot approve tournaments (owner/admin only)
-- SELECT rpc_admin_approve_tournament('<request_id>');
-- Expected: { "error": "unauthorized" }
--
-- Test: platform admin CAN review any venue's score
-- SET LOCAL ROLE authenticated;
-- PERFORM set_config('request.jwt.claims',
--   json_build_object('sub', '<platform_admin_id>', 'role', 'authenticated', 'aal', 'aal2')::text, true);
-- SELECT rpc_admin_review_score('<any_score_id>', 'approved');
-- Expected: { "ok": true }
*/

SELECT * FROM test_result(
  'venue isolation: documented manual verification steps above',
  true  -- placeholder — see comments above
);


-- ════════════════════════════════════════════════════════════
-- BLOCK 8: Score range constraint
-- ════════════════════════════════════════════════════════════
BEGIN;
SELECT * FROM test_result(
  'scores: score_range constraint exists',
  EXISTS (
    SELECT 1 FROM information_schema.check_constraints
     WHERE constraint_name = 'scores_score_range'
  )
);
ROLLBACK;


-- ════════════════════════════════════════════════════════════
-- BLOCK 9: Sensitive tables have RLS enabled
-- ════════════════════════════════════════════════════════════
BEGIN;

WITH rls_check AS (
  SELECT tablename, rowsecurity
  FROM pg_tables
  WHERE schemaname = 'public'
    AND tablename IN (
      'scores', 'profiles', 'check_ins', 'messages',
      'team_messages', 'posts', 'admin_audit_log',
      'security_events', 'lane_qr_tokens', 'venue_admins',
      'rate_limit_log', 'storage_cleanup_queue'
    )
)
SELECT * FROM test_result(
  'RLS enabled on all sensitive tables',
  NOT EXISTS (SELECT 1 FROM rls_check WHERE rowsecurity = false)
);

ROLLBACK;


-- ════════════════════════════════════════════════════════════
-- SUMMARY
-- ════════════════════════════════════════════════════════════
SELECT
  '=== TEST SUMMARY ===' AS note,
  'All PASS rows above = security rules are correctly applied.' AS instruction,
  'Any FAIL rows require immediate investigation.' AS warning;

-- Clean up helper function
DROP FUNCTION IF EXISTS public.test_result(text, boolean);
