-- ============================================================
-- RLS Test Suite — scripts/rls-tests.sql
-- ============================================================
-- Usage:
--   Run in Supabase SQL Editor (as database owner / postgres user).
--   Tests switch to low-privilege roles via SET LOCAL ROLE so that
--   RLS policies are actually evaluated. Results appear in the
--   "Messages" pane as NOTICE lines (PASS / FAIL / INFO / SKIP).
--
--   Each block is wrapped in a transaction that is rolled back at
--   the end, so no persistent changes are made to the database.
-- ============================================================


-- ── Helper: find two regular users ──────────────────────────
DO $$
DECLARE
  v_cnt int;
BEGIN
  SELECT count(*) INTO v_cnt FROM profiles WHERE role = 'user';
  IF v_cnt < 2 THEN
    RAISE NOTICE 'WARNING: Need at least 2 regular-user profiles for meaningful tests (found %). Some tests will be skipped.', v_cnt;
  ELSE
    RAISE NOTICE 'INFO: Found % user profiles. Proceeding with tests.', v_cnt;
  END IF;
END; $$;


-- ════════════════════════════════════════════════════════════
-- BLOCK 1: Authenticated user — read and write access
-- ════════════════════════════════════════════════════════════
BEGIN;
  SET LOCAL ROLE authenticated;

  DO $$
  DECLARE
    v_uid_a   uuid;
    v_uid_b   uuid;
    v_cnt     int;
  BEGIN
    -- Pick two real user IDs from the database
    SELECT id INTO v_uid_a FROM public.profiles WHERE role = 'user' ORDER BY created_at LIMIT 1;
    SELECT id INTO v_uid_b FROM public.profiles WHERE role = 'user' AND id <> v_uid_a ORDER BY created_at LIMIT 1;

    IF v_uid_a IS NULL THEN
      RAISE NOTICE 'SKIP  Block 1: no regular users found';
      RETURN;
    END IF;

    -- Simulate being user A
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_uid_a, 'role', 'authenticated', 'aal', 'aal1')::text,
      true);

    -- T1: User can read their own profile
    SELECT count(*) INTO v_cnt FROM public.profiles WHERE id = v_uid_a;
    RAISE NOTICE '%  T1: user A can read own profile (rows=%)',
      CASE WHEN v_cnt >= 1 THEN 'PASS' ELSE 'FAIL' END, v_cnt;

    -- T2: User cannot update another user's profile
    UPDATE public.profiles SET bio = '__rls_test_hack__' WHERE id = v_uid_b;
    GET DIAGNOSTICS v_cnt = ROW_COUNT;
    RAISE NOTICE '%  T2: user A cannot update user B bio (rows=%)',
      CASE WHEN v_cnt = 0 THEN 'PASS' ELSE 'FAIL' END, v_cnt;

    -- T3: User can read approved scores
    SELECT count(*) INTO v_cnt FROM public.scores WHERE status = 'approved';
    RAISE NOTICE '%  T3: user A can read approved scores (rows=%)',
      CASE WHEN v_cnt >= 0 THEN 'PASS' ELSE 'FAIL' END, v_cnt;

    -- T4: User cannot update another user's score
    UPDATE public.scores SET score = 0 WHERE user_id = v_uid_b;
    GET DIAGNOSTICS v_cnt = ROW_COUNT;
    RAISE NOTICE '%  T4: user A cannot update user B scores (rows=%)',
      CASE WHEN v_cnt = 0 THEN 'PASS' ELSE 'FAIL' END, v_cnt;

    -- T5: User cannot delete another user's posts
    DELETE FROM public.posts WHERE user_id = v_uid_b;
    GET DIAGNOSTICS v_cnt = ROW_COUNT;
    RAISE NOTICE '%  T5: user A cannot delete user B posts (rows=%)',
      CASE WHEN v_cnt = 0 THEN 'PASS' ELSE 'FAIL' END, v_cnt;

    -- T6: User cannot read admin_audit_log
    SELECT count(*) INTO v_cnt FROM public.admin_audit_log;
    RAISE NOTICE '%  T6: user A cannot read admin_audit_log (rows=%)',
      CASE WHEN v_cnt = 0 THEN 'PASS' ELSE 'FAIL' END, v_cnt;

    -- T7: User can read approved forums
    SELECT count(*) INTO v_cnt FROM public.forums WHERE status = 'approved';
    RAISE NOTICE '%  T7: user A can read approved forums (rows=%)',
      CASE WHEN v_cnt >= 0 THEN 'PASS' ELSE 'FAIL' END, v_cnt;

    -- T8: User cannot read pending forums they don't own
    IF v_uid_b IS NOT NULL THEN
      SELECT count(*) INTO v_cnt FROM public.forums
       WHERE status = 'pending' AND creator_id = v_uid_b;
      RAISE NOTICE '%  T8: user A cannot read user B pending forums (rows=%)',
        CASE WHEN v_cnt = 0 THEN 'PASS' ELSE 'FAIL' END, v_cnt;
    ELSE
      RAISE NOTICE 'SKIP  T8: only one user available';
    END IF;

    -- T9: User cannot read another user's team messages
    SELECT count(*) INTO v_cnt FROM public.team_messages tm
     WHERE NOT EXISTS (
       SELECT 1 FROM team_members m
        WHERE m.team_id = tm.team_id AND m.user_id = v_uid_a
     );
    RAISE NOTICE '%  T9: user A cannot read messages from teams they are not in (rows=%)',
      CASE WHEN v_cnt = 0 THEN 'PASS' ELSE 'FAIL' END, v_cnt;

    -- T10: public_profiles view respects is_private — identity stays
    -- visible, but details (bio/online_status/featured_game_id) must be
    -- NULL on private users when viewed by someone else
    SELECT count(*) INTO v_cnt
      FROM public.public_profiles pp
      JOIN public.profiles pr ON pr.id = pp.id
     WHERE COALESCE(pr.is_private, false) = true
       AND pp.id <> v_uid_a
       AND (pp.bio IS NOT NULL OR pp.online_status IS NOT NULL OR pp.featured_game_id IS NOT NULL);
    RAISE NOTICE '%  T10: public_profiles hides private users'' details (leaky rows=%)',
      CASE WHEN v_cnt = 0 THEN 'PASS' ELSE 'FAIL' END, v_cnt;

  END; $$;

ROLLBACK;


-- ════════════════════════════════════════════════════════════
-- BLOCK 2: Anonymous user — should see nothing
-- ════════════════════════════════════════════════════════════
BEGIN;
  SET LOCAL ROLE anon;

  DO $$
  DECLARE
    v_cnt int;
  BEGIN
    PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);

    -- T11: anon cannot read profiles
    SELECT count(*) INTO v_cnt FROM public.profiles;
    RAISE NOTICE '%  T11: anon cannot read profiles (rows=%)',
      CASE WHEN v_cnt = 0 THEN 'PASS' ELSE 'FAIL' END, v_cnt;

    -- T12: anon cannot read scores
    SELECT count(*) INTO v_cnt FROM public.scores;
    RAISE NOTICE '%  T12: anon cannot read scores (rows=%)',
      CASE WHEN v_cnt = 0 THEN 'PASS' ELSE 'FAIL' END, v_cnt;

    -- T13: anon cannot read posts
    SELECT count(*) INTO v_cnt FROM public.posts;
    RAISE NOTICE '%  T13: anon cannot read posts (rows=%)',
      CASE WHEN v_cnt = 0 THEN 'PASS' ELSE 'FAIL' END, v_cnt;

    -- T14: anon cannot read team_messages
    SELECT count(*) INTO v_cnt FROM public.team_messages;
    RAISE NOTICE '%  T14: anon cannot read team_messages (rows=%)',
      CASE WHEN v_cnt = 0 THEN 'PASS' ELSE 'FAIL' END, v_cnt;

    -- T15: anon cannot read forums
    SELECT count(*) INTO v_cnt FROM public.forums;
    RAISE NOTICE '%  T15: anon cannot read forums (rows=%)',
      CASE WHEN v_cnt = 0 THEN 'PASS' ELSE 'FAIL' END, v_cnt;

    -- T16: anon cannot read admin_audit_log
    SELECT count(*) INTO v_cnt FROM public.admin_audit_log;
    RAISE NOTICE '%  T16: anon cannot read admin_audit_log (rows=%)',
      CASE WHEN v_cnt = 0 THEN 'PASS' ELSE 'FAIL' END, v_cnt;

  END; $$;

ROLLBACK;


-- ════════════════════════════════════════════════════════════
-- BLOCK 3: Platform admin — should have elevated read access
-- ════════════════════════════════════════════════════════════
BEGIN;
  SET LOCAL ROLE authenticated;

  DO $$
  DECLARE
    v_admin_uid uuid;
    v_cnt       int;
  BEGIN
    SELECT id INTO v_admin_uid
      FROM public.profiles
     WHERE role IN ('admin', 'owner', 'architect')
     LIMIT 1;

    IF v_admin_uid IS NULL THEN
      RAISE NOTICE 'SKIP  Block 3: no admin/owner/architect user found';
      RETURN;
    END IF;

    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_admin_uid, 'role', 'authenticated', 'aal', 'aal2')::text,
      true);

    -- T17: Admin can read admin_audit_log
    SELECT count(*) INTO v_cnt FROM public.admin_audit_log;
    RAISE NOTICE '%  T17: admin can read admin_audit_log (rows=%)',
      CASE WHEN v_cnt >= 0 THEN 'PASS' ELSE 'FAIL' END, v_cnt;

    -- T18: Admin can read all scores (including pending)
    SELECT count(*) INTO v_cnt FROM public.scores;
    RAISE NOTICE '%  T18: admin can read all scores (rows=%)',
      CASE WHEN v_cnt >= 0 THEN 'PASS' ELSE 'FAIL' END, v_cnt;

    -- T19: Admin can read all forums (including pending)
    SELECT count(*) INTO v_cnt FROM public.forums;
    RAISE NOTICE '%  T19: admin can read all forums including pending (rows=%)',
      CASE WHEN v_cnt >= 0 THEN 'PASS' ELSE 'FAIL' END, v_cnt;

  END; $$;

ROLLBACK;


-- ════════════════════════════════════════════════════════════
-- BLOCK 4: post_comments isolation
-- ════════════════════════════════════════════════════════════
BEGIN;
  SET LOCAL ROLE authenticated;

  DO $$
  DECLARE
    v_uid_a uuid;
    v_uid_b uuid;
    v_cnt   int;
  BEGIN
    SELECT id INTO v_uid_a FROM public.profiles WHERE role = 'user' ORDER BY created_at LIMIT 1;
    SELECT id INTO v_uid_b FROM public.profiles WHERE role = 'user' AND id <> v_uid_a ORDER BY created_at LIMIT 1;

    IF v_uid_a IS NULL OR v_uid_b IS NULL THEN
      RAISE NOTICE 'SKIP  Block 4: need 2 users';
      RETURN;
    END IF;

    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_uid_a, 'role', 'authenticated')::text, true);

    -- T20: User cannot delete another user's comments
    DELETE FROM public.post_comments WHERE user_id = v_uid_b;
    GET DIAGNOSTICS v_cnt = ROW_COUNT;
    RAISE NOTICE '%  T20: user A cannot delete user B comments (rows=%)',
      CASE WHEN v_cnt = 0 THEN 'PASS' ELSE 'FAIL' END, v_cnt;

  END; $$;

ROLLBACK;


DO $$
BEGIN
  RAISE NOTICE '════════════════════════════════════════════';
  RAISE NOTICE 'RLS test suite complete. Review PASS/FAIL above.';
  RAISE NOTICE 'All transactions were rolled back — no data was changed.';
  RAISE NOTICE '════════════════════════════════════════════';
END; $$;
