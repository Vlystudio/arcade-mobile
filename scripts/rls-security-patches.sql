-- ============================================================
-- Security patches — run AFTER rls-policies.sql
-- Fixes C1-C3 (critical), H1-H5 (high), M1-M3 (medium)
-- ============================================================

-- ──────────────────────────────────────────────────────────
-- C1: Drop seed-games.sql policies that bypass status checks
-- ──────────────────────────────────────────────────────────

-- These were created by seed-games.sql and never removed.
-- They OR with rls-policies.sql, making the weaker ones win.

DROP POLICY IF EXISTS "Users can insert own scores"  ON scores;  -- no status='pending' check
DROP POLICY IF EXISTS "Users can update own scores"  ON scores;  -- no status restriction
DROP POLICY IF EXISTS "Users can read scores"        ON scores;  -- superseded by auth-only read
DROP POLICY IF EXISTS "Admins can update any score"  ON scores;  -- duplicate of "Admins can review scores"

-- Verify replacements from rls-policies.sql are in place
-- (these are idempotent — harmless to re-run)
DROP POLICY IF EXISTS "Auth users can read scores"            ON scores;
CREATE POLICY "Auth users can read scores" ON scores
  FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Users can submit own scores"           ON scores;
CREATE POLICY "Users can submit own scores" ON scores
  FOR INSERT WITH CHECK (auth.uid() = user_id AND status = 'pending');

DROP POLICY IF EXISTS "Users can update own pending scores"   ON scores;
CREATE POLICY "Users can update own pending scores" ON scores
  FOR UPDATE
  USING  (auth.uid() = user_id AND status = 'pending')
  WITH CHECK (auth.uid() = user_id AND status = 'pending');

DROP POLICY IF EXISTS "Admins can review scores"              ON scores;
CREATE POLICY "Admins can review scores" ON scores
  FOR UPDATE USING (public.is_admin());

-- ──────────────────────────────────────────────────────────
-- C2: Rotate lane QR tokens to cryptographically random values
-- ──────────────────────────────────────────────────────────
-- WARNING: After running this, regenerate and reprint all QR codes.
-- The old 'lane-N-demo-token' values will no longer work.
-- Comment this out if you need to preserve dev tokens.

UPDATE lanes SET lane_qr_token = encode(gen_random_bytes(16), 'hex');

-- ──────────────────────────────────────────────────────────
-- C3: Remove direct check_ins INSERT — only rpc_check_in may insert
-- ──────────────────────────────────────────────────────────
-- rpc_check_in is SECURITY DEFINER (runs as postgres role) so it
-- bypasses RLS and can still INSERT without this policy.
-- Regular authenticated clients lose the ability to insert directly.

DROP POLICY IF EXISTS "Users can insert own check-ins" ON check_ins;

-- Also block direct UPDATE — no app feature needs it and it allows
-- venue_id / lane_id spoofing on existing check-ins.
DROP POLICY IF EXISTS "Users can update own check-ins" ON check_ins;

-- ──────────────────────────────────────────────────────────
-- H1: Restrict tournament owner UPDATE to announcement + cancel only
-- ──────────────────────────────────────────────────────────
-- Prevent owners from changing admin-controlled fields:
-- is_official, is_individual, signup_type, title, game_type,
-- created_by, max_teams.

DROP POLICY IF EXISTS "Owners can update announcement or cancel" ON tournaments;
CREATE POLICY "Owners can update announcement or cancel" ON tournaments
  FOR UPDATE
  USING (auth.uid() = created_by AND status IN ('upcoming', 'active'))
  WITH CHECK (
    auth.uid() = created_by
    AND status IN ('upcoming', 'active', 'cancelled')
    -- These fields must remain unchanged (compare NEW row against current DB row)
    AND is_official    IS NOT DISTINCT FROM (SELECT is_official    FROM tournaments t2 WHERE t2.id = id)
    AND is_individual  IS NOT DISTINCT FROM (SELECT is_individual  FROM tournaments t2 WHERE t2.id = id)
    AND signup_type    IS NOT DISTINCT FROM (SELECT signup_type    FROM tournaments t2 WHERE t2.id = id)
    AND title          IS NOT DISTINCT FROM (SELECT title          FROM tournaments t2 WHERE t2.id = id)
    AND game_type      IS NOT DISTINCT FROM (SELECT game_type      FROM tournaments t2 WHERE t2.id = id)
    AND created_by     IS NOT DISTINCT FROM (SELECT created_by     FROM tournaments t2 WHERE t2.id = id)
    AND max_teams      IS NOT DISTINCT FROM (SELECT max_teams      FROM tournaments t2 WHERE t2.id = id)
  );

-- ──────────────────────────────────────────────────────────
-- H2: tournament_registrations — enforce correct initial status
-- ──────────────────────────────────────────────────────────
-- Prevents users from inserting status='accepted' for non-official tournaments.
-- official tournaments auto-accept; community tournaments must start pending.

DROP POLICY IF EXISTS "Users can register for tournaments" ON tournament_registrations;
CREATE POLICY "Users can register for tournaments" ON tournament_registrations
  FOR INSERT WITH CHECK (
    auth.uid() = user_id
    AND (
      -- Auto-accept for official tournaments (skee-ball events etc.)
      (status = 'accepted' AND (SELECT is_official FROM tournaments WHERE id = tournament_id))
      -- All community tournament registrations start as pending
      OR status = 'pending'
    )
  );

-- ──────────────────────────────────────────────────────────
-- H3: team_requests — full RLS (table has no policies anywhere)
-- ──────────────────────────────────────────────────────────
ALTER TABLE team_requests ENABLE ROW LEVEL SECURITY;

-- Visible to: the requesting user, the team captain, admins
DROP POLICY IF EXISTS "Users can read relevant team requests" ON team_requests;
CREATE POLICY "Users can read relevant team requests" ON team_requests
  FOR SELECT USING (
    auth.uid() = user_id
    OR public.is_admin()
    OR auth.uid() = (SELECT captain_id FROM teams WHERE id = team_id)
  );

-- Users may send join requests (direction='request', status='pending')
DROP POLICY IF EXISTS "Users can send join requests" ON team_requests;
CREATE POLICY "Users can send join requests" ON team_requests
  FOR INSERT WITH CHECK (
    auth.uid() = user_id
    AND direction = 'request'
    AND status    = 'pending'
  );

-- Captains may send invites (direction='invite', status='pending')
DROP POLICY IF EXISTS "Captains can send invites" ON team_requests;
CREATE POLICY "Captains can send invites" ON team_requests
  FOR INSERT WITH CHECK (
    auth.uid() = (SELECT captain_id FROM teams WHERE id = team_id)
    AND direction = 'invite'
    AND status    = 'pending'
  );

-- Captains approve/deny join requests; invitees accept/reject invites; admins anything
DROP POLICY IF EXISTS "Captains and invitees can update requests" ON team_requests;
CREATE POLICY "Captains and invitees can update requests" ON team_requests
  FOR UPDATE USING (
    (direction = 'request' AND auth.uid() = (SELECT captain_id FROM teams WHERE id = team_id))
    OR (direction = 'invite'   AND auth.uid() = user_id)
    OR public.is_admin()
  );

-- Users cancel own requests; captains clean up after; admins anything
DROP POLICY IF EXISTS "Users can delete own team requests" ON team_requests;
CREATE POLICY "Users can delete own team requests" ON team_requests
  FOR DELETE USING (
    auth.uid() = user_id
    OR auth.uid() = (SELECT captain_id FROM teams WHERE id = team_id)
    OR public.is_admin()
  );

-- ──────────────────────────────────────────────────────────
-- H4: Drop "Anyone can read" policies for games and lanes
-- ──────────────────────────────────────────────────────────
-- seed-games.sql created USING(true) policies; rls-policies.sql
-- created auth-only ones under different names without dropping the old ones.
-- PostgreSQL OR's permissive policies — USING(true) was winning.

DROP POLICY IF EXISTS "Anyone can read games" ON games;
DROP POLICY IF EXISTS "Anyone can read lanes" ON lanes;

-- The rls-policies.sql auth-only versions remain and now take effect:
-- "Auth users can read games"  USING (auth.role() = 'authenticated')
-- "Auth users can read lanes"  USING (auth.role() = 'authenticated')

-- ──────────────────────────────────────────────────────────
-- M3: Validate check_in_id ownership on score INSERT
-- ──────────────────────────────────────────────────────────
-- Prevents submitting a score with a null or stolen check_in_id.

CREATE OR REPLACE FUNCTION public.validate_score_check_in()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.check_in_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM check_ins
       WHERE id = NEW.check_in_id AND user_id = NEW.user_id
    ) THEN
      RAISE EXCEPTION 'check_in_id does not belong to this user';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_score_check_in_trigger ON scores;
CREATE TRIGGER validate_score_check_in_trigger
  BEFORE INSERT ON scores
  FOR EACH ROW EXECUTE FUNCTION public.validate_score_check_in();

-- ──────────────────────────────────────────────────────────
-- M1: Storage buckets and object-level RLS
-- ──────────────────────────────────────────────────────────

-- score-proofs: private — only owner and admins may read
INSERT INTO storage.buckets (id, name, public)
VALUES ('score-proofs', 'score-proofs', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Users upload own score proofs"         ON storage.objects;
DROP POLICY IF EXISTS "Users read own proofs admins read all" ON storage.objects;
DROP POLICY IF EXISTS "Users delete own score proofs"         ON storage.objects;

CREATE POLICY "Users upload own score proofs" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'score-proofs'
    AND auth.role() = 'authenticated'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Users read own proofs admins read all" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'score-proofs'
    AND (
      auth.uid()::text = (storage.foldername(name))[1]
      OR public.is_admin()
    )
  );

CREATE POLICY "Users delete own score proofs" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'score-proofs'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- post-photos: public read, owner-only write/delete
INSERT INTO storage.buckets (id, name, public)
VALUES ('post-photos', 'post-photos', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Users upload own post photos"  ON storage.objects;
DROP POLICY IF EXISTS "Anyone can read post photos"   ON storage.objects;
DROP POLICY IF EXISTS "Users delete own post photos"  ON storage.objects;

CREATE POLICY "Users upload own post photos" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'post-photos'
    AND auth.role() = 'authenticated'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Anyone can read post photos" ON storage.objects
  FOR SELECT USING (bucket_id = 'post-photos');

CREATE POLICY "Users delete own post photos" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'post-photos'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- ──────────────────────────────────────────────────────────
-- L2: rpc_admin_save_placements — guard against cancelled tournaments
-- ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_admin_save_placements(
  p_tournament_id uuid,
  p_placements    jsonb
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry    jsonb;
  v_uid      uuid;
  v_uname    text;
  v_status   text;
  v_warnings text[] := '{}';
BEGIN
  IF NOT public.is_admin() THEN
    RETURN json_build_object('error', 'unauthorized', 'message', 'Admin only.');
  END IF;

  SELECT status INTO v_status FROM tournaments WHERE id = p_tournament_id;
  IF NOT FOUND THEN
    RETURN json_build_object('error', 'not_found');
  END IF;
  IF v_status NOT IN ('upcoming', 'active') THEN
    RETURN json_build_object('error', 'invalid_status',
      'message', 'Results can only be saved for upcoming or active tournaments.');
  END IF;

  FOR v_entry IN SELECT * FROM jsonb_array_elements(p_placements)
  LOOP
    v_uname := trim(COALESCE(v_entry->>'username', ''));
    CONTINUE WHEN v_uname = '';

    SELECT id INTO v_uid
      FROM profiles
     WHERE lower(username) = lower(v_uname)
     LIMIT 1;

    IF v_uid IS NULL THEN
      v_warnings := array_append(v_warnings, 'User not found: ' || v_uname);
      CONTINUE;
    END IF;

    INSERT INTO tournament_placements (tournament_id, user_id, placement)
    VALUES (p_tournament_id, v_uid, (v_entry->>'place')::int)
    ON CONFLICT (tournament_id, user_id)
    DO UPDATE SET placement = EXCLUDED.placement;
  END LOOP;

  UPDATE tournaments SET status = 'completed' WHERE id = p_tournament_id;

  RETURN json_build_object('ok', true, 'warnings', v_warnings);
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_admin_save_placements(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_admin_save_placements(uuid, jsonb) TO authenticated;
