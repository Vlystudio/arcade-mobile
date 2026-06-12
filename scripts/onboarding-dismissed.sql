-- Persists the feed onboarding-checklist dismissal across devices
-- (the X on "Get set for league night"). Users may update their own row
-- under the existing profiles RLS update policy.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS onboarding_dismissed boolean NOT NULL DEFAULT false;
