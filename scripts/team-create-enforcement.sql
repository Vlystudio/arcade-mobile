-- Enforce the team-creation paywall server-side.
-- Browsing teams and requesting to join stay open to everyone; only
-- creating a team requires a paid team registration while an active
-- season with registration_required is running.
CREATE OR REPLACE FUNCTION public.enforce_team_creation_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Only enforced while a paid season is active
  IF NOT EXISTS (
    SELECT 1 FROM seasons
     WHERE status = 'active' AND registration_required = true
  ) THEN
    RETURN NEW;
  END IF;

  -- Service role (no JWT) and admins bypass — admin tools create teams
  -- for assignments and imports
  IF auth.uid() IS NULL OR public.is_admin() THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM team_registrations tr
      JOIN seasons s ON s.id = tr.season_id
     WHERE tr.user_id = auth.uid()
       AND tr.status = 'paid'
       AND tr.registration_type = 'team'
       AND s.status = 'active'
       AND s.registration_required = true
  ) THEN
    RAISE EXCEPTION 'A paid team registration is required to create a team this season.'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_team_creation_payment_trigger ON public.teams;
CREATE TRIGGER enforce_team_creation_payment_trigger
  BEFORE INSERT ON public.teams
  FOR EACH ROW EXECUTE FUNCTION public.enforce_team_creation_payment();
