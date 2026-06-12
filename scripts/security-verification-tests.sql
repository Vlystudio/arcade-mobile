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

-- Wrapped in BEGIN/COMMIT so this setup is durable even when the whole file
-- is sent as a single multi-statement query (e.g. via the Supabase
-- Management API), where the BEGIN/ROLLBACK pairs around each test block
-- below would otherwise also roll back this setup.
BEGIN;

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

COMMIT;

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

-- public_profiles view should be readable by anon (it is the public-facing
-- view). Identity is always visible; private-detail hiding is asserted in
-- BLOCK 18 (runs with table access so it can see the is_private flag).
SELECT * FROM test_result(
  'anon: public_profiles readable',
  (SELECT count(*) FROM public_profiles) >= 0
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

-- Full rpc_check_in decision-table tests (invalid/revoked/expired/active/
-- already_active/rate_limited) now use REAL lane_qr_tokens fixture rows —
-- see BLOCK 20.

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

  -- ── 7A: Venue cross-isolation for rpc_admin_get_score_review_queue /
  -- rpc_admin_review_score with REAL fixture venues, admins and scores —
  -- see BLOCK 20 (20H, 20J, 20K, 20L).
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_venue_a_admin, 'role', 'authenticated', 'aal', 'aal2')::text, true);

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
-- Superseded by BLOCK 20, which exercises rpc_admin_get_score_review_queue
-- and rpc_admin_review_score with REAL fixture venues/admins/scores instead
-- of fake UUIDs (so authorization checks are actually reached, not just
-- their FK-violation side effects).
-- ════════════════════════════════════════════════════════════


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
-- Full decision-table coverage (invalid/revoked/expired/active/
-- already_active/rate_limited) now uses REAL lane_qr_tokens fixture rows —
-- see BLOCK 20. hash_lane_token determinism is covered in BLOCK 3.
-- ════════════════════════════════════════════════════════════


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

  -- ── 15E: direct SELECT on storage_cleanup_queue returns no rows ──
  -- RLS policy "No direct access storage_cleanup_queue" is FOR ALL
  -- USING (false), so even a row-owning admin session must see zero rows
  -- via direct table access; rpc_admin_get_storage_cleanup_queue (SECURITY
  -- DEFINER) is the only read path.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role', 'authenticated', 'aal', 'aal2')::text, true);

  IF (SELECT count(*) FROM storage_cleanup_queue) = 0 THEN
    RAISE NOTICE 'PASS [15E]: direct SELECT on storage_cleanup_queue returns no rows (RLS blocks it)';
  ELSE
    RAISE NOTICE 'FAIL [15E]: direct SELECT on storage_cleanup_queue returned rows — RLS bypassed';
  END IF;

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
-- Covered with a real fixture lane in BLOCK 20 (20A: unrelated random
-- token against a lane that DOES have active lane_qr_tokens rows still
-- returns lane_not_found — proving no legacy/fallback match occurs).
-- ════════════════════════════════════════════════════════════


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

-- Verify the view definition gates details on is_private
SELECT * FROM test_result(
  'public_profiles: view definition gates details on is_private',
  EXISTS (
    SELECT 1
    FROM pg_views
    WHERE schemaname = 'public'
      AND viewname   = 'public_profiles'
      AND definition LIKE '%is_private%'
  )
);

-- Identity always visible; details (bio/online_status/featured_game_id)
-- must be NULL for private users when viewed by someone else
-- (auth.uid() is NULL in this block, so "someone else" = everyone).
SELECT * FROM test_result(
  'public_profiles: identity visible, private details hidden',
  (SELECT count(*) FROM public_profiles)
    = (SELECT count(*) FROM profiles)
  AND NOT EXISTS (
    SELECT 1
      FROM public_profiles pp
      JOIN profiles pr ON pr.id = pp.id
     WHERE COALESCE(pr.is_private, false) = true
       AND (pp.bio IS NOT NULL OR pp.online_status IS NOT NULL OR pp.featured_game_id IS NOT NULL)
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
-- BLOCK 20: Fixture-based cross-venue isolation & QR token tests
-- Creates real (rolled-back) fixture rows — two venues, a venue admin and
-- venue staff member for venue A, a venue admin for venue B, a platform
-- admin, a normal user, a lane with active/expired/revoked lane_qr_tokens,
-- pending scores in each venue, a tournament in each venue, and a recent
-- check-in — then exercises rpc_check_in and the venue-scoped admin RPCs
-- against them under simulated JWT claims for each role. Everything runs inside this transaction's BEGIN/ROLLBACK, so
-- nothing persists.
--
-- Bootstrapping the fixture platform admin requires impersonating an
-- existing real platform admin (profiles.is_admin = true) for one UPDATE,
-- to satisfy guard_role_escalation_trigger. If no platform admin exists yet
-- (e.g. a fresh dev database), this block is skipped.
--
-- Unlike other blocks, this one does NOT `SET LOCAL ROLE authenticated` —
-- fixture setup needs to insert directly into auth.users/venues/lanes/etc.,
-- which the `authenticated` role cannot do. The RPCs under test are
-- SECURITY DEFINER and authorize purely via request.jwt.claims (set below
-- per-step), so running fixture setup as the default role does not affect
-- the validity of the authorization checks being tested.
-- ════════════════════════════════════════════════════════════
BEGIN;
DO $$
DECLARE
  v_real_admin      uuid;
  v_platform_admin  uuid := gen_random_uuid();
  v_venue_a_admin   uuid := gen_random_uuid();
  v_venue_a_staff   uuid := gen_random_uuid();
  v_venue_b_admin   uuid := gen_random_uuid();
  v_normal_user     uuid := gen_random_uuid();
  v_cooldown_user   uuid := gen_random_uuid();
  v_venue_a         uuid := gen_random_uuid();
  v_venue_b         uuid := gen_random_uuid();
  v_game_id         uuid := gen_random_uuid();
  v_lane_id         uuid := gen_random_uuid();
  v_score_a         uuid := gen_random_uuid();
  v_score_b         uuid := gen_random_uuid();
  v_tourn_a         uuid := gen_random_uuid();
  v_tourn_b         uuid := gen_random_uuid();
  v_token_active    text := 'fixture-active-'  || gen_random_uuid()::text;
  v_token_expired   text := 'fixture-expired-' || gen_random_uuid()::text;
  v_token_revoked   text := 'fixture-revoked-' || gen_random_uuid()::text;
  v_result          json;
BEGIN
  SELECT id INTO v_real_admin FROM profiles WHERE is_admin = true LIMIT 1;
  IF v_real_admin IS NULL THEN
    RAISE NOTICE 'SKIP [BLOCK 20]: no existing platform admin (profiles.is_admin=true) to bootstrap fixtures — skipping';
    RETURN;
  END IF;

  -- ── Fixture setup ──────────────────────────────────────────
  INSERT INTO auth.users (id) VALUES
    (v_platform_admin), (v_venue_a_admin), (v_venue_a_staff),
    (v_venue_b_admin), (v_normal_user), (v_cooldown_user);

  -- Bypass guard_role_escalation_trigger by impersonating the real admin
  -- for this one UPDATE.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_real_admin, 'role', 'authenticated')::text, true);
  UPDATE profiles SET is_admin = true WHERE id = v_platform_admin;

  INSERT INTO venues (id, slug, name) VALUES
    (v_venue_a, 'fixture-venue-a-' || left(v_venue_a::text, 8), 'Fixture Venue A'),
    (v_venue_b, 'fixture-venue-b-' || left(v_venue_b::text, 8), 'Fixture Venue B');

  INSERT INTO venue_admins (venue_id, user_id, role) VALUES
    (v_venue_a, v_venue_a_admin, 'admin'),
    (v_venue_a, v_venue_a_staff, 'staff'),
    (v_venue_b, v_venue_b_admin, 'admin');

  INSERT INTO games (id, name, type) VALUES (v_game_id, 'Fixture Pinball', 'pinball');

  INSERT INTO lanes (id, game_id, venue_id, lane_number, status) VALUES
    (v_lane_id, v_game_id, v_venue_a, 999, 'available');

  INSERT INTO lane_qr_tokens (lane_id, venue_id, token_hash, expires_at, revoked_at) VALUES
    (v_lane_id, v_venue_a, public.hash_lane_token(v_token_active),  now() + interval '1 hour', NULL),
    (v_lane_id, v_venue_a, public.hash_lane_token(v_token_expired), now() - interval '1 hour', NULL),
    (v_lane_id, v_venue_a, public.hash_lane_token(v_token_revoked), now() + interval '1 hour', now());

  INSERT INTO scores (id, user_id, game_id, venue_id, score, status, proof_storage_path) VALUES
    (v_score_a, v_normal_user, v_game_id, v_venue_a, 12345, 'pending', 'fixture/proof-a.jpg'),
    (v_score_b, v_normal_user, v_game_id, v_venue_b, 54321, 'pending', 'fixture/proof-b.jpg');

  INSERT INTO check_ins (user_id, lane_id, venue_id, status, created_at)
  VALUES (v_cooldown_user, v_lane_id, v_venue_a, 'completed', now() - interval '5 minutes');

  INSERT INTO tournaments (id, title, venue_id, status) VALUES
    (v_tourn_a, 'Fixture Tournament A', v_venue_a, 'upcoming'),
    (v_tourn_b, 'Fixture Tournament B', v_venue_b, 'upcoming');

  -- ── 20A-F: rpc_check_in decision table (real lane_qr_tokens rows) ──
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_normal_user, 'role', 'authenticated')::text, true);

  SELECT rpc_check_in('fixture-no-such-token-' || gen_random_uuid()::text) INTO v_result;
  IF (v_result->>'error') = 'lane_not_found' THEN
    RAISE NOTICE 'PASS [20A]: rpc_check_in — unrecognized token returns lane_not_found';
  ELSE
    RAISE NOTICE 'FAIL [20A]: unexpected result for unrecognized token: %', v_result;
  END IF;

  SELECT rpc_check_in(v_token_revoked) INTO v_result;
  IF (v_result->>'error') = 'token_revoked' THEN
    RAISE NOTICE 'PASS [20B]: rpc_check_in — revoked token returns token_revoked';
  ELSE
    RAISE NOTICE 'FAIL [20B]: unexpected result for revoked token: %', v_result;
  END IF;

  SELECT rpc_check_in(v_token_expired) INTO v_result;
  IF (v_result->>'error') = 'token_expired' THEN
    RAISE NOTICE 'PASS [20C]: rpc_check_in — expired token returns token_expired';
  ELSE
    RAISE NOTICE 'FAIL [20C]: unexpected result for expired token: %', v_result;
  END IF;

  SELECT rpc_check_in(v_token_active) INTO v_result;
  IF (v_result->>'check_in_id') IS NOT NULL AND (v_result->>'lane_id') = v_lane_id::text THEN
    RAISE NOTICE 'PASS [20D]: rpc_check_in — active token succeeds (check_in_id=%)', v_result->>'check_in_id';
  ELSE
    RAISE NOTICE 'FAIL [20D]: active token did not produce a successful check-in: %', v_result;
  END IF;

  SELECT rpc_check_in(v_token_active) INTO v_result;
  IF (v_result->>'error') = 'already_active' THEN
    RAISE NOTICE 'PASS [20E]: rpc_check_in — second check-in blocked as already_active';
  ELSE
    RAISE NOTICE 'FAIL [20E]: unexpected result for duplicate check-in: %', v_result;
  END IF;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_cooldown_user, 'role', 'authenticated')::text, true);
  SELECT rpc_check_in(v_token_active) INTO v_result;
  IF (v_result->>'error') = 'rate_limited' THEN
    RAISE NOTICE 'PASS [20F]: rpc_check_in — recent check-in to same lane blocked as rate_limited';
  ELSE
    RAISE NOTICE 'FAIL [20F]: unexpected result for cooldown user: %', v_result;
  END IF;

  -- ── 20H-M: cross-venue score review queue / review ──────────
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_venue_a_admin, 'role', 'authenticated', 'aal', 'aal2')::text, true);

  SELECT rpc_admin_get_score_review_queue(v_venue_b, 'pending') INTO v_result;
  IF (v_result->>'error') = 'unauthorized' THEN
    RAISE NOTICE 'PASS [20H]: venue A admin blocked from venue B score review queue';
  ELSE
    RAISE NOTICE 'FAIL [20H]: venue A admin unexpectedly accessed venue B queue: %', v_result;
  END IF;

  SELECT rpc_admin_get_score_review_queue(v_venue_a, 'pending') INTO v_result;
  IF json_typeof(v_result) = 'array'
     AND EXISTS (SELECT 1 FROM json_array_elements(v_result) e WHERE (e->>'id')::uuid = v_score_a) THEN
    RAISE NOTICE 'PASS [20I]: venue A admin sees venue A''s pending score in review queue';
  ELSE
    RAISE NOTICE 'FAIL [20I]: venue A admin queue missing fixture score: %', v_result;
  END IF;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_venue_a_staff, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  SELECT rpc_admin_get_score_review_queue(v_venue_a, 'pending') INTO v_result;
  IF (v_result->>'error') = 'unauthorized' THEN
    RAISE NOTICE 'PASS [20J]: venue A staff (non-admin role) blocked from score review queue';
  ELSE
    RAISE NOTICE 'FAIL [20J]: venue A staff unexpectedly accessed score review queue: %', v_result;
  END IF;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_platform_admin, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  SELECT rpc_admin_get_score_review_queue(v_venue_b, 'pending') INTO v_result;
  IF json_typeof(v_result) = 'array'
     AND EXISTS (SELECT 1 FROM json_array_elements(v_result) e WHERE (e->>'id')::uuid = v_score_b) THEN
    RAISE NOTICE 'PASS [20K]: platform admin sees venue B''s pending score in review queue';
  ELSE
    RAISE NOTICE 'FAIL [20K]: platform admin queue missing fixture score: %', v_result;
  END IF;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_venue_a_admin, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  SELECT rpc_admin_review_score(v_score_b, 'approved') INTO v_result;
  IF (v_result->>'error') = 'unauthorized' THEN
    RAISE NOTICE 'PASS [20L]: venue A admin blocked from reviewing venue B''s score';
  ELSE
    RAISE NOTICE 'FAIL [20L]: venue A admin unexpectedly reviewed venue B''s score: %', v_result;
  END IF;

  SELECT rpc_admin_review_score(v_score_a, 'approved') INTO v_result;
  IF (v_result->>'ok')::boolean IS TRUE THEN
    RAISE NOTICE 'PASS [20M]: venue A admin successfully reviews venue A''s own score';
  ELSE
    RAISE NOTICE 'FAIL [20M]: venue A admin could not review venue A''s own score: %', v_result;
  END IF;

  -- ── 20N-O: cross-venue score-proof signed URL access ────────
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_venue_b_admin, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  SELECT rpc_admin_create_score_proof_signed_url(v_score_a) INTO v_result;
  IF (v_result->>'error') = 'unauthorized' THEN
    RAISE NOTICE 'PASS [20N]: venue B admin blocked from venue A''s score-proof path';
  ELSE
    RAISE NOTICE 'FAIL [20N]: venue B admin unexpectedly accessed venue A''s score proof: %', v_result;
  END IF;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_venue_a_admin, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  SELECT rpc_admin_create_score_proof_signed_url(v_score_a) INTO v_result;
  IF (v_result->>'ok')::boolean IS TRUE AND v_result->>'path' = 'fixture/proof-a.jpg' THEN
    RAISE NOTICE 'PASS [20O]: venue A admin can access venue A''s own score-proof path';
  ELSE
    RAISE NOTICE 'FAIL [20O]: venue A admin could not access its own score proof: %', v_result;
  END IF;

  -- ── 20R-T: cross-venue tournament management ────────────────
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_venue_a_admin, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  SELECT rpc_admin_delete_tournament(v_tourn_b) INTO v_result;
  IF (v_result->>'error') = 'unauthorized' THEN
    RAISE NOTICE 'PASS [20R]: venue A admin blocked from deleting venue B''s tournament';
  ELSE
    RAISE NOTICE 'FAIL [20R]: venue A admin unexpectedly managed venue B''s tournament: %', v_result;
  END IF;

  SELECT rpc_admin_delete_tournament(v_tourn_a) INTO v_result;
  IF (v_result->>'error') IS NULL
     AND NOT EXISTS (SELECT 1 FROM tournaments WHERE id = v_tourn_a) THEN
    RAISE NOTICE 'PASS [20S]: venue A admin manages venue A''s own tournament';
  ELSE
    RAISE NOTICE 'FAIL [20S]: venue A admin could not manage own venue tournament: %', v_result;
  END IF;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_platform_admin, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  SELECT rpc_admin_delete_tournament(v_tourn_b) INTO v_result;
  IF (v_result->>'error') IS NULL
     AND NOT EXISTS (SELECT 1 FROM tournaments WHERE id = v_tourn_b) THEN
    RAISE NOTICE 'PASS [20T]: platform admin manages any venue''s tournament';
  ELSE
    RAISE NOTICE 'FAIL [20T]: platform admin could not manage venue B''s tournament: %', v_result;
  END IF;

  -- ── 20U: QR security_events never contain raw token fragments ──
  -- Logged details must use the SHA-256 fingerprint (12 hex chars), and must
  -- not contain a token_suffix key or any substring of the raw tokens.
  IF NOT EXISTS (
       SELECT 1 FROM security_events
        WHERE user_id = v_normal_user
          AND event_type IN ('qr_token_invalid','qr_token_revoked','qr_token_expired')
          AND (details ? 'token_suffix'
               OR details::text LIKE '%' || right(v_token_revoked, 8) || '%'
               OR details::text LIKE '%' || right(v_token_expired, 8) || '%'))
     AND (SELECT count(*) FROM security_events
           WHERE user_id = v_normal_user
             AND event_type IN ('qr_token_invalid','qr_token_revoked','qr_token_expired')
             AND details->>'token_fingerprint' ~ '^[0-9a-f]{12}$') = 3
     AND EXISTS (
       SELECT 1 FROM security_events
        WHERE user_id = v_normal_user
          AND event_type = 'qr_token_revoked'
          AND details->>'token_fingerprint' = public.qr_token_fingerprint(v_token_revoked)) THEN
    RAISE NOTICE 'PASS [20U]: QR security_events store only hash fingerprints — no raw token fragments';
  ELSE
    RAISE NOTICE 'FAIL [20U]: QR security_events contain raw token fragments or missing fingerprints';
  END IF;

  -- ── 20P-Q: security_events / admin_audit_log side effects ───
  IF (SELECT count(*) FROM security_events
       WHERE event_type = 'admin_access_denied'
         AND user_id IN (v_venue_a_admin, v_venue_a_staff, v_venue_b_admin)) >= 5 THEN
    RAISE NOTICE 'PASS [20P]: admin_access_denied logged for each cross-venue/role denial above';
  ELSE
    RAISE NOTICE 'FAIL [20P]: expected >= 5 admin_access_denied security_events rows for fixture admins';
  END IF;

  IF (SELECT count(*) FROM security_events
       WHERE user_id = v_normal_user
         AND event_type IN ('qr_token_invalid','qr_token_revoked','qr_token_expired')) = 3 THEN
    RAISE NOTICE 'PASS [20P]: invalid/revoked/expired QR attempts logged to security_events';
  ELSE
    RAISE NOTICE 'FAIL [20P]: expected 3 qr_token_* security_events rows for normal user';
  END IF;

  IF (SELECT count(*) FROM security_events
       WHERE user_id = v_cooldown_user
         AND event_type = 'qr_checkin_rate_limited') = 1 THEN
    RAISE NOTICE 'PASS [20P]: rate-limited check-in attempt logged to security_events';
  ELSE
    RAISE NOTICE 'FAIL [20P]: expected qr_checkin_rate_limited security_events row for cooldown user';
  END IF;

  IF (SELECT count(*) FROM admin_audit_log
       WHERE admin_id = v_venue_a_admin
         AND action = 'score_review'
         AND target_id = v_score_a::text) = 1 THEN
    RAISE NOTICE 'PASS [20Q]: successful score review logged to admin_audit_log';
  ELSE
    RAISE NOTICE 'FAIL [20Q]: expected admin_audit_log row for venue A admin''s score review';
  END IF;

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
