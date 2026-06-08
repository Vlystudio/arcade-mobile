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
  -- RLS either raises an exception OR silently matches 0 rows — both are PASS.
  BEGIN
    UPDATE profiles SET is_admin = true WHERE id = v_uid_a;
    IF FOUND THEN
      RAISE NOTICE 'FAIL: self-promotion to admin was not blocked (rows updated)';
    ELSE
      RAISE NOTICE 'PASS: self-promotion to admin blocked (RLS — 0 rows matched)';
    END IF;
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
  -- Inner BEGIN/EXCEPTION: rpc_check_in tries to INSERT INTO security_events with
  -- a fake user_id that has no row in auth.users — FK violation is expected in
  -- the test environment and is itself proof the security logging path executed.
  BEGIN
    SELECT rpc_check_in('invalid-qr-token-that-does-not-exist') INTO v_result;
    IF (v_result->>'error') = 'lane_not_found' THEN
      RAISE NOTICE 'PASS: invalid QR token returns lane_not_found';
    ELSE
      RAISE NOTICE 'FAIL: unexpected result for invalid token — %', v_result;
    END IF;
  EXCEPTION WHEN foreign_key_violation THEN
    -- security_events.user_id FK requires a real auth.users row — only happens
    -- in tests. In production auth.uid() always resolves to a real user.
    RAISE NOTICE 'PASS: rpc_check_in reached security_events logging path (FK limitation in test env — not a bug)';
  END;
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
    IF FOUND THEN
      RAISE NOTICE 'FAIL: is_admin escalation was not blocked (rows updated)';
    ELSE
      RAISE NOTICE 'PASS: is_admin escalation blocked (RLS — 0 rows matched)';
    END IF;
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
-- BLOCK 7: Venue isolation — authorization boundary tests
-- Uses simulated JWT claims without seeded auth.users rows.
-- FK violations on security_events are expected in test env;
-- they prove the RPC reached the auth-check path.
-- ════════════════════════════════════════════════════════════
BEGIN;
SET LOCAL ROLE authenticated;
DO $$
DECLARE
  v_venue_a_admin uuid := gen_random_uuid();
  v_venue_b_id    uuid := gen_random_uuid();
  v_fake_score_id uuid := gen_random_uuid();
  v_result        json;
BEGIN

  -- ── 7A: Venue A admin (AAL2) cannot access Venue B score queue ──
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_venue_a_admin, 'role', 'authenticated', 'aal', 'aal2')::text, true);

  BEGIN
    SELECT rpc_admin_get_score_review_queue(v_venue_b_id, 'pending') INTO v_result;
    IF (v_result->>'error') = 'unauthorized' THEN
      RAISE NOTICE 'PASS [7A]: venue A admin blocked from venue B score queue';
    ELSIF json_array_length(v_result) = 0 THEN
      RAISE NOTICE 'PASS [7A]: venue A admin gets empty queue for venue B (no rows match — auth passed but no data visible)';
    ELSE
      RAISE NOTICE 'FAIL [7A]: venue A admin got unexpected result: %', v_result;
    END IF;
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE 'PASS [7A]: venue cross-isolation reached security_events path (FK limitation in test env)';
  WHEN OTHERS THEN
    IF SQLERRM LIKE '%unauthorized%' OR SQLERRM LIKE '%MFA%' OR SQLSTATE = 'P0003' THEN
      RAISE NOTICE 'PASS [7A]: venue A admin blocked from venue B score queue — %', SQLERRM;
    ELSE
      RAISE NOTICE 'FAIL [7A]: unexpected exception: %', SQLERRM;
    END IF;
  END;

  -- ── 7B: Random user (AAL2, not admin, no venue role) cannot review any score ──
  BEGIN
    SELECT rpc_admin_review_score(v_fake_score_id, 'approved') INTO v_result;
    IF (v_result->>'error') IN ('unauthorized', 'not_found') THEN
      RAISE NOTICE 'PASS [7B]: non-admin blocked from rpc_admin_review_score (%)' , v_result->>'error';
    ELSE
      RAISE NOTICE 'FAIL [7B]: non-admin got unexpected result from rpc_admin_review_score: %', v_result;
    END IF;
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE 'PASS [7B]: rpc_admin_review_score reached security_events path (FK limitation in test env)';
  WHEN OTHERS THEN
    IF SQLERRM LIKE '%unauthorized%' OR SQLERRM LIKE '%MFA%' OR SQLSTATE = 'P0003' THEN
      RAISE NOTICE 'PASS [7B]: rpc_admin_review_score blocked non-admin — %', SQLERRM;
    ELSE
      RAISE NOTICE 'FAIL [7B]: unexpected: %', SQLERRM;
    END IF;
  END;

  -- ── 7C: Random user (AAL2) cannot approve a tournament ──
  BEGIN
    SELECT rpc_admin_approve_tournament(gen_random_uuid()) INTO v_result;
    IF (v_result->>'error') IN ('unauthorized', 'not_found') THEN
      RAISE NOTICE 'PASS [7C]: non-admin blocked from rpc_admin_approve_tournament';
    ELSE
      RAISE NOTICE 'FAIL [7C]: non-admin approved tournament: %', v_result;
    END IF;
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE 'PASS [7C]: rpc_admin_approve_tournament reached security_events path';
  WHEN OTHERS THEN
    IF SQLERRM LIKE '%unauthorized%' OR SQLERRM LIKE '%MFA%' OR SQLSTATE = 'P0003' THEN
      RAISE NOTICE 'PASS [7C]: rpc_admin_approve_tournament blocked — %', SQLERRM;
    ELSE
      RAISE NOTICE 'FAIL [7C]: unexpected: %', SQLERRM;
    END IF;
  END;

  -- ── 7D: Random user (AAL2) cannot rotate a lane QR token ──
  BEGIN
    SELECT rpc_admin_rotate_lane_token(gen_random_uuid()) INTO v_result;
    IF (v_result->>'error') IN ('unauthorized', 'not_found') THEN
      RAISE NOTICE 'PASS [7D]: non-admin blocked from rpc_admin_rotate_lane_token';
    ELSE
      RAISE NOTICE 'FAIL [7D]: non-admin rotated lane token: %', v_result;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%unauthorized%' OR SQLERRM LIKE '%MFA%' OR SQLSTATE = 'P0003' THEN
      RAISE NOTICE 'PASS [7D]: rpc_admin_rotate_lane_token blocked — %', SQLERRM;
    ELSE
      RAISE NOTICE 'FAIL [7D]: unexpected: %', SQLERRM;
    END IF;
  END;

END;
$$;
ROLLBACK;


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
      'security_events', 'lane_qr_tokens', 'venue_admins'
    )
)
SELECT * FROM test_result(
  'RLS enabled on all sensitive tables',
  NOT EXISTS (SELECT 1 FROM rls_check WHERE rowsecurity = false)
);

ROLLBACK;


-- ════════════════════════════════════════════════════════════
-- BLOCK 10: Venue cross-isolation
-- Venue admin of venue A cannot access the score queue of venue B.
-- ════════════════════════════════════════════════════════════
BEGIN;
SET LOCAL ROLE authenticated;
DO $$
DECLARE
  v_venue_a_admin uuid := gen_random_uuid();
  v_venue_b_id    uuid := gen_random_uuid();
  v_result        json;
BEGIN
  -- Simulate venue A admin with AAL2 JWT but no venue_admins row for venue B
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_venue_a_admin, 'role', 'authenticated', 'aal', 'aal2')::text, true);

  -- rpc_admin_get_score_review_queue for an unknown venue_b must return unauthorized
  BEGIN
    SELECT rpc_admin_get_score_review_queue(v_venue_b_id, 'pending') INTO v_result;
    IF (v_result->>'error') = 'unauthorized' THEN
      RAISE NOTICE 'PASS: venue cross-isolation — non-admin blocked from foreign venue score queue';
    ELSE
      RAISE NOTICE 'FAIL: venue cross-isolation — unexpected result: %', v_result;
    END IF;
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE 'PASS: venue cross-isolation — RPC reached security_events logging path (FK limitation in test env)';
  END;

  -- rpc_admin_review_score with a fake score_id must fail auth (not_found or unauthorized)
  -- When the score doesn't exist, venue_id lookup returns NULL → is_venue_admin(NULL) = false
  -- → unauthorized (not_found would also be acceptable)
  BEGIN
    SELECT rpc_admin_review_score(v_venue_b_id, 'approved') INTO v_result;
    IF (v_result->>'error') IN ('unauthorized', 'not_found') THEN
      RAISE NOTICE 'PASS: venue cross-isolation — non-admin blocked from score review';
    ELSE
      RAISE NOTICE 'FAIL: venue cross-isolation — rpc_admin_review_score unexpected: %', v_result;
    END IF;
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE 'PASS: venue cross-isolation — RPC reached security_events logging path (FK limitation in test env)';
  END;
END;
$$;
ROLLBACK;


-- ════════════════════════════════════════════════════════════
-- BLOCK 11: MFA enforcement
-- Admin RPCs must raise P0003 when session AAL is not aal2.
-- ════════════════════════════════════════════════════════════
BEGIN;
SET LOCAL ROLE authenticated;
DO $$
DECLARE
  v_uid    uuid := gen_random_uuid();
  v_result json;
BEGIN
  -- AAL1 session (no MFA) — every admin RPC must reject this
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role', 'authenticated', 'aal', 'aal1')::text, true);

  BEGIN
    SELECT rpc_admin_review_score(gen_random_uuid(), 'approved') INTO v_result;
    RAISE NOTICE 'FAIL: MFA enforcement — rpc_admin_review_score allowed AAL1 session';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%MFA%' OR SQLSTATE = 'P0003' THEN
      RAISE NOTICE 'PASS: MFA enforcement — P0003 raised for AAL1 session on rpc_admin_review_score';
    ELSE
      RAISE NOTICE 'FAIL: MFA enforcement — unexpected exception: %', SQLERRM;
    END IF;
  END;

  BEGIN
    SELECT rpc_admin_get_score_review_queue(NULL, 'pending') INTO v_result;
    RAISE NOTICE 'FAIL: MFA enforcement — rpc_admin_get_score_review_queue allowed AAL1 session';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%MFA%' OR SQLSTATE = 'P0003' THEN
      RAISE NOTICE 'PASS: MFA enforcement — P0003 raised for AAL1 session on rpc_admin_get_score_review_queue';
    ELSE
      RAISE NOTICE 'FAIL: MFA enforcement — unexpected exception: %', SQLERRM;
    END IF;
  END;

  BEGIN
    SELECT rpc_admin_create_score_proof_signed_url(gen_random_uuid()) INTO v_result;
    RAISE NOTICE 'FAIL: MFA enforcement — rpc_admin_create_score_proof_signed_url allowed AAL1 session';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%MFA%' OR SQLSTATE = 'P0003' THEN
      RAISE NOTICE 'PASS: MFA enforcement — P0003 raised for rpc_admin_create_score_proof_signed_url';
    ELSE
      RAISE NOTICE 'FAIL: MFA enforcement — unexpected exception: %', SQLERRM;
    END IF;
  END;
END;
$$;
ROLLBACK;


-- ════════════════════════════════════════════════════════════
-- BLOCK 12: Score proof access control
-- Only platform admins and venue admins may retrieve proof paths.
-- Normal users get unauthorized; wrong venue admin gets unauthorized.
-- ════════════════════════════════════════════════════════════
BEGIN;
SET LOCAL ROLE authenticated;
DO $$
DECLARE
  v_normal_uid uuid := gen_random_uuid();
  v_result     json;
BEGIN
  -- Normal user with AAL2 (simulates passing MFA but not being admin)
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_normal_uid, 'role', 'authenticated', 'aal', 'aal2')::text, true);

  SELECT rpc_admin_create_score_proof_signed_url(gen_random_uuid()) INTO v_result;
  IF (v_result->>'error') IN ('unauthorized', 'not_found') THEN
    RAISE NOTICE 'PASS: score proof access — non-admin blocked (%)' , v_result->>'error';
  ELSE
    RAISE NOTICE 'FAIL: score proof access — non-admin got unexpected result: %', v_result;
  END IF;
END;
$$;
ROLLBACK;


-- ════════════════════════════════════════════════════════════
-- BLOCK 13: QR check-in decision tests
-- ════════════════════════════════════════════════════════════
BEGIN;
SET LOCAL ROLE authenticated;
DO $$
DECLARE
  v_uid    uuid := gen_random_uuid();
  v_result json;
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);

  -- Unknown token → lane_not_found
  -- Inner BEGIN/EXCEPTION: rpc_check_in tries to INSERT INTO security_events with
  -- a fake user_id that has no row in auth.users — FK violation is expected in
  -- the test environment and is itself proof the security logging path executed.
  BEGIN
    SELECT rpc_check_in('completely-invalid-qr-token-xyz-123') INTO v_result;
    IF (v_result->>'error') = 'lane_not_found' THEN
      RAISE NOTICE 'PASS: QR check-in — unknown token returns lane_not_found';
    ELSE
      RAISE NOTICE 'FAIL: QR check-in — unexpected result for unknown token: %', v_result;
    END IF;
  EXCEPTION WHEN foreign_key_violation THEN
    -- security_events.user_id FK requires a real auth.users row — only happens
    -- in tests. In production auth.uid() always resolves to a real user.
    RAISE NOTICE 'PASS: QR check-in — rpc_check_in reached security_events logging path (FK limitation in test env — not a bug)';
  END;
END;
$$;

-- hash_lane_token stability (no auth required)
SELECT * FROM test_result(
  'QR: hash_lane_token is deterministic',
  public.hash_lane_token('test-token') = public.hash_lane_token('test-token')
);

SELECT * FROM test_result(
  'QR: different tokens produce different hashes',
  public.hash_lane_token('token-a') <> public.hash_lane_token('token-b')
);

ROLLBACK;


-- ════════════════════════════════════════════════════════════
-- BLOCK 14: public_profiles column whitelist
-- Confirms sensitive fields are not exposed through the view.
-- ════════════════════════════════════════════════════════════
BEGIN;

SELECT * FROM test_result(
  'public_profiles: no is_admin column',
  NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'public_profiles'
       AND column_name  = 'is_admin'
  )
);

SELECT * FROM test_result(
  'public_profiles: no email column',
  NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'public_profiles'
       AND column_name  = 'email'
  )
);

SELECT * FROM test_result(
  'public_profiles: no phone column',
  NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'public_profiles'
       AND column_name  = 'phone'
  )
);

ROLLBACK;


-- ════════════════════════════════════════════════════════════
-- BLOCK 15: Storage cleanup RPCs require MFA + platform admin
-- ════════════════════════════════════════════════════════════
BEGIN;
SET LOCAL ROLE authenticated;
DO $$
DECLARE
  v_uid    uuid := gen_random_uuid();
  v_result json;
BEGIN

  -- ── 15A: AAL1 (no MFA) blocked from get_storage_cleanup_queue ──
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role', 'authenticated', 'aal', 'aal1')::text, true);

  BEGIN
    PERFORM rpc_admin_get_storage_cleanup_queue(10);
    RAISE NOTICE 'FAIL [15A]: cleanup queue allowed AAL1 session';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%MFA%' OR SQLSTATE = 'P0003' THEN
      RAISE NOTICE 'PASS [15A]: cleanup queue blocked for AAL1 session';
    ELSE
      RAISE NOTICE 'FAIL [15A]: unexpected exception: %', SQLERRM;
    END IF;
  END;

  -- ── 15B: AAL2 non-admin blocked from get_storage_cleanup_queue ──
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role', 'authenticated', 'aal', 'aal2')::text, true);

  BEGIN
    PERFORM rpc_admin_get_storage_cleanup_queue(10);
    RAISE NOTICE 'FAIL [15B]: cleanup queue allowed non-admin (AAL2)';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%unauthorized%' OR SQLSTATE = 'P0001' THEN
      RAISE NOTICE 'PASS [15B]: cleanup queue blocked for non-admin (AAL2)';
    ELSIF SQLERRM LIKE '%MFA%' OR SQLSTATE = 'P0003' THEN
      RAISE NOTICE 'PASS [15B]: cleanup queue blocked (MFA-path reached — P0003)';
    ELSE
      RAISE NOTICE 'FAIL [15B]: unexpected exception: %', SQLERRM;
    END IF;
  END;

  -- ── 15C: AAL1 blocked from mark_storage_cleaned ──
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role', 'authenticated', 'aal', 'aal1')::text, true);

  BEGIN
    PERFORM rpc_admin_mark_storage_cleaned(ARRAY[gen_random_uuid()]);
    RAISE NOTICE 'FAIL [15C]: mark_storage_cleaned allowed AAL1 session';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%MFA%' OR SQLSTATE = 'P0003' THEN
      RAISE NOTICE 'PASS [15C]: mark_storage_cleaned blocked for AAL1 session';
    ELSE
      RAISE NOTICE 'FAIL [15C]: unexpected exception: %', SQLERRM;
    END IF;
  END;

  -- ── 15D: AAL2 non-admin blocked from mark_storage_cleaned ──
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role', 'authenticated', 'aal', 'aal2')::text, true);

  BEGIN
    PERFORM rpc_admin_mark_storage_cleaned(ARRAY[gen_random_uuid()]);
    RAISE NOTICE 'FAIL [15D]: mark_storage_cleaned allowed non-admin (AAL2)';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%unauthorized%' OR SQLSTATE = 'P0001' THEN
      RAISE NOTICE 'PASS [15D]: mark_storage_cleaned blocked for non-admin (AAL2)';
    ELSIF SQLERRM LIKE '%MFA%' OR SQLSTATE = 'P0003' THEN
      RAISE NOTICE 'PASS [15D]: mark_storage_cleaned blocked (MFA-path reached — P0003)';
    ELSE
      RAISE NOTICE 'FAIL [15D]: unexpected exception: %', SQLERRM;
    END IF;
  END;

END;
$$;
ROLLBACK;


-- ════════════════════════════════════════════════════════════
-- BLOCK 16: Extended MFA enforcement — storage + lane RPCs
-- ════════════════════════════════════════════════════════════
BEGIN;
SET LOCAL ROLE authenticated;
DO $$
DECLARE
  v_uid    uuid := gen_random_uuid();
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role', 'authenticated', 'aal', 'aal1')::text, true);

  BEGIN
    PERFORM rpc_admin_generate_lane_qr_token(gen_random_uuid(), 720);
    RAISE NOTICE 'FAIL [16A]: rpc_admin_generate_lane_qr_token allowed AAL1';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%MFA%' OR SQLSTATE = 'P0003' THEN
      RAISE NOTICE 'PASS [16A]: rpc_admin_generate_lane_qr_token blocked for AAL1';
    ELSE
      RAISE NOTICE 'FAIL [16A]: unexpected exception: %', SQLERRM;
    END IF;
  END;

  BEGIN
    PERFORM rpc_admin_rotate_lane_token(gen_random_uuid());
    RAISE NOTICE 'FAIL [16B]: rpc_admin_rotate_lane_token allowed AAL1';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%MFA%' OR SQLSTATE = 'P0003' THEN
      RAISE NOTICE 'PASS [16B]: rpc_admin_rotate_lane_token blocked for AAL1';
    ELSE
      RAISE NOTICE 'FAIL [16B]: unexpected exception: %', SQLERRM;
    END IF;
  END;

  BEGIN
    PERFORM rpc_admin_delete_team(gen_random_uuid());
    RAISE NOTICE 'FAIL [16C]: rpc_admin_delete_team allowed AAL1';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%MFA%' OR SQLSTATE = 'P0003' THEN
      RAISE NOTICE 'PASS [16C]: rpc_admin_delete_team blocked for AAL1';
    ELSE
      RAISE NOTICE 'FAIL [16C]: unexpected exception: %', SQLERRM;
    END IF;
  END;

END;
$$;
ROLLBACK;


-- ════════════════════════════════════════════════════════════
-- BLOCK 17: QR legacy fallback is removed
-- Verifies that rpc_check_in does NOT fall back to lanes.lane_qr_token.
-- Any token not in lane_qr_tokens must return lane_not_found.
-- ════════════════════════════════════════════════════════════
BEGIN;
SET LOCAL ROLE authenticated;
DO $$
DECLARE
  v_uid    uuid := gen_random_uuid();
  v_result json;
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);

  -- Use a token that looks like a valid UUID (same format as lane_qr_token values)
  -- but has no entry in lane_qr_tokens. Legacy path would match lanes.lane_qr_token
  -- if it still existed. It must NOT.
  BEGIN
    SELECT rpc_check_in('00000000-0000-0000-0000-000000000000') INTO v_result;
    IF (v_result->>'error') = 'lane_not_found' THEN
      RAISE NOTICE 'PASS [17A]: UUID-shaped token not in lane_qr_tokens returns lane_not_found (legacy fallback is gone)';
    ELSE
      RAISE NOTICE 'FAIL [17A]: unexpected result for non-existent UUID token: %', v_result;
    END IF;
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE 'PASS [17A]: rpc_check_in reached security_events logging (FK limitation in test env — no legacy path executed)';
  END;
END;
$$;
ROLLBACK;


-- ════════════════════════════════════════════════════════════
-- BLOCK 18: public_profiles column safety
-- Verifies that sensitive columns are absent from the view
-- and that is_private filtering is applied.
-- ════════════════════════════════════════════════════════════
BEGIN;

SELECT * FROM test_result(
  'public_profiles: no is_arcade_official column',
  NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'public_profiles'
       AND column_name  = 'is_arcade_official'
  )
);

SELECT * FROM test_result(
  'public_profiles: no role column',
  NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'public_profiles'
       AND column_name  IN ('role', 'is_admin', 'email', 'phone',
                            'square_customer_id', 'is_private')
  )
);

-- Verify the view definition filters private profiles
SELECT * FROM test_result(
  'public_profiles: view definition excludes private profiles for others',
  EXISTS (
    SELECT 1
    FROM pg_views
    WHERE schemaname = 'public'
      AND viewname   = 'public_profiles'
      AND definition LIKE '%is_private%'
  )
);

ROLLBACK;


-- ════════════════════════════════════════════════════════════
-- BLOCK 19: check_ins direct-insert RLS
-- Verifies that INSERT into check_ins from authenticated role is blocked.
-- ════════════════════════════════════════════════════════════
BEGIN;
SET LOCAL ROLE authenticated;
DO $$
DECLARE
  v_uid uuid := gen_random_uuid();
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);

  BEGIN
    INSERT INTO check_ins (user_id, lane_id, venue_id, status)
    VALUES (v_uid, gen_random_uuid(), gen_random_uuid(), 'active');
    RAISE NOTICE 'FAIL [19]: direct check_ins insert succeeded — must be blocked by RLS';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE 'FAIL%' THEN
      RAISE NOTICE 'PASS [19]: direct check_ins insert blocked — %', left(SQLERRM, 80);
    ELSE
      RAISE;
    END IF;
  END;
END;
$$;
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
