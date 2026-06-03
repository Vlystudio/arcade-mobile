-- ============================================================
-- Multi-venue support migration
-- Run AFTER rls-policies.sql and seed-admin-policies.sql
-- ============================================================

-- ── Venues table ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS venues (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug       text UNIQUE NOT NULL,
  name       text NOT NULL,
  address    text,
  color      text DEFAULT '#06b6d4',
  created_at timestamptz DEFAULT now()
);

-- Seed the two venues
INSERT INTO venues (slug, name, address, color) VALUES
  ('arcade_bar', 'Arcade Bar',  '123 Main St', '#06b6d4'),
  ('vinyl_hall', 'Vinyl Hall',  '456 Oak Ave',  '#a855f7')
ON CONFLICT (slug) DO NOTHING;

-- ── Add venue_id to existing tables ─────────────────────────
ALTER TABLE lanes               ADD COLUMN IF NOT EXISTS venue_id uuid REFERENCES venues(id);
ALTER TABLE check_ins           ADD COLUMN IF NOT EXISTS venue_id uuid REFERENCES venues(id);
ALTER TABLE scores              ADD COLUMN IF NOT EXISTS venue_id uuid REFERENCES venues(id);
ALTER TABLE posts               ADD COLUMN IF NOT EXISTS venue_id uuid REFERENCES venues(id);
ALTER TABLE tournaments         ADD COLUMN IF NOT EXISTS venue_id uuid REFERENCES venues(id);
ALTER TABLE trivia_events       ADD COLUMN IF NOT EXISTS venue_id uuid REFERENCES venues(id);

-- ── Backfill lanes to arcade_bar (adjust if needed) ─────────
-- UPDATE lanes SET venue_id = (SELECT id FROM venues WHERE slug = 'arcade_bar');

-- ── RLS for venues ───────────────────────────────────────────
ALTER TABLE venues ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Auth users can read venues" ON venues;
CREATE POLICY "Auth users can read venues" ON venues
  FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Admins can manage venues" ON venues;
CREATE POLICY "Admins can manage venues" ON venues
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ── Tighten scores RLS: venue_id must match the check-in's lane ─
-- (Optional — enforce at insert time that venue_id comes from the lane, not client)
-- The rpc_check_in function already sets venue_id from the lane record,
-- so client cannot spoof it for check-ins. For score inserts, include venue_id
-- from the check_in row server-side if you want a full server-side guarantee.

-- ── Cross-venue isolation (optional, per-admin) ──────────────
-- If you ever want per-venue admins, add a venue_admins join table:
-- CREATE TABLE IF NOT EXISTS venue_admins (
--   venue_id uuid REFERENCES venues(id),
--   user_id  uuid REFERENCES profiles(id),
--   PRIMARY KEY (venue_id, user_id)
-- );
-- Then update admin policies to scope by venue_id.
-- For now, all admins see all venues (single-owner model).
