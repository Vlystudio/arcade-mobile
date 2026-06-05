-- Prevent anyone from promoting another user to the architect role via set_user_role.
-- The architect role can only be set directly in the database by a superuser.
--
-- Run this in Supabase SQL Editor. It wraps the existing set_user_role function
-- with an architect guard. Adjust the function body below if your existing
-- set_user_role has additional logic — the key addition is the guard at the top.

CREATE OR REPLACE FUNCTION public.set_user_role(target_user_id uuid, new_role text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only admins and above may change roles
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = 'P0001';
  END IF;

  -- The architect role is reserved — it cannot be assigned via this function
  IF new_role = 'architect' THEN
    RAISE EXCEPTION 'The architect role cannot be assigned through the admin panel.'
      USING ERRCODE = 'P0001';
  END IF;

  -- Owners can only be assigned by architects
  IF new_role = 'owner' AND (SELECT role FROM profiles WHERE id = auth.uid()) != 'architect' THEN
    RAISE EXCEPTION 'Only an architect can assign the owner role.'
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE profiles SET role = new_role WHERE id = target_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.set_user_role(uuid, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.set_user_role(uuid, text) TO authenticated;
