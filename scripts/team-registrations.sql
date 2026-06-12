-- Extend seasons table with registration/payment/prize fields (idempotent)
ALTER TABLE seasons
  ADD COLUMN IF NOT EXISTS registration_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS team_fee_cents integer NOT NULL DEFAULT 20000,
  ADD COLUMN IF NOT EXISTS individual_fee_cents integer NOT NULL DEFAULT 5000,
  ADD COLUMN IF NOT EXISTS prize_1st_cents integer NOT NULL DEFAULT 50000,
  ADD COLUMN IF NOT EXISTS prize_2nd_cents integer NOT NULL DEFAULT 25000,
  ADD COLUMN IF NOT EXISTS prize_3rd_cents integer NOT NULL DEFAULT 10000,
  ADD COLUMN IF NOT EXISTS prize_4th_cents integer NOT NULL DEFAULT 10000,
  ADD COLUMN IF NOT EXISTS registration_opens_at timestamptz,
  ADD COLUMN IF NOT EXISTS registration_closes_at timestamptz;

-- Team registrations table
CREATE TABLE IF NOT EXISTS team_registrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  season_id uuid NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  registration_type text NOT NULL CHECK (registration_type IN ('team', 'individual')),
  status text NOT NULL DEFAULT 'pending_payment'
    CHECK (status IN ('pending_payment', 'paid', 'refunded', 'cancelled')),
  team_id uuid REFERENCES teams(id) ON DELETE SET NULL,
  square_payment_link_id text,
  square_order_id text,
  checkout_url text,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, season_id)
);

ALTER TABLE team_registrations ENABLE ROW LEVEL SECURITY;

-- Users can read their own registrations
DROP POLICY IF EXISTS "user_own_registration_select" ON team_registrations;
CREATE POLICY "user_own_registration_select"
  ON team_registrations FOR SELECT USING (user_id = auth.uid());

-- Users can insert their own registration (UNIQUE enforces one per season)
DROP POLICY IF EXISTS "user_own_registration_insert" ON team_registrations;
CREATE POLICY "user_own_registration_insert"
  ON team_registrations FOR INSERT WITH CHECK (user_id = auth.uid());

-- Admins/owners/architects can read all registrations
DROP POLICY IF EXISTS "admin_registration_select" ON team_registrations;
CREATE POLICY "admin_registration_select"
  ON team_registrations FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid()
      AND role IN ('admin', 'owner', 'architect'))
  );

-- Admins can update any registration (mark paid, assign team)
DROP POLICY IF EXISTS "admin_registration_update" ON team_registrations;
CREATE POLICY "admin_registration_update"
  ON team_registrations FOR UPDATE USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid()
      AND role IN ('admin', 'owner', 'architect'))
  );
