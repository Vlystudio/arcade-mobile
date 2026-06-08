-- Square webhook persistence.
-- Run this before enabling the /api/square/webhook subscription in Square.

CREATE TABLE IF NOT EXISTS public.square_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id text NOT NULL UNIQUE,
  event_type text NOT NULL,
  merchant_id text,
  payload jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_square_webhook_events_type
  ON public.square_webhook_events (event_type);

CREATE INDEX IF NOT EXISTS idx_square_webhook_events_received
  ON public.square_webhook_events (received_at DESC);

ALTER TABLE public.square_webhook_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read square webhook events" ON public.square_webhook_events;
CREATE POLICY "Admins read square webhook events"
  ON public.square_webhook_events
  FOR SELECT
  USING (public.is_admin());

DROP POLICY IF EXISTS "No direct square webhook writes" ON public.square_webhook_events;
CREATE POLICY "No direct square webhook writes"
  ON public.square_webhook_events
  FOR ALL
  USING (false)
  WITH CHECK (false);

CREATE TABLE IF NOT EXISTS public.square_payment_statuses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  square_payment_id text,
  square_order_id text,
  status text,
  event_type text NOT NULL,
  last_event_id text NOT NULL,
  raw_event jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT square_payment_status_identity CHECK (
    square_payment_id IS NOT NULL OR square_order_id IS NOT NULL
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_square_payment_status_payment_id
  ON public.square_payment_statuses (square_payment_id)
  WHERE square_payment_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_square_payment_status_order_id
  ON public.square_payment_statuses (square_order_id)
  WHERE square_order_id IS NOT NULL;

ALTER TABLE public.square_payment_statuses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read square payment statuses" ON public.square_payment_statuses;
CREATE POLICY "Admins read square payment statuses"
  ON public.square_payment_statuses
  FOR SELECT
  USING (public.is_admin());

DROP POLICY IF EXISTS "No direct square payment status writes" ON public.square_payment_statuses;
CREATE POLICY "No direct square payment status writes"
  ON public.square_payment_statuses
  FOR ALL
  USING (false)
  WITH CHECK (false);
