-- ============================================================
-- Wire feedback submissions to the notify-feedback Edge Function
-- via pg_net so an email is sent on every new submission.
-- Run AFTER: support-feedback.sql
-- ============================================================

CREATE OR REPLACE FUNCTION public.rpc_submit_feedback(
  p_category    text,
  p_message     text,
  p_rating      int  DEFAULT NULL,
  p_app_version text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_username text;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN json_build_object('error', 'not_authenticated');
  END IF;

  IF p_category NOT IN ('bug', 'feature', 'general', 'other') THEN
    RETURN json_build_object('error', 'invalid_category');
  END IF;

  IF length(trim(p_message)) < 10 THEN
    RETURN json_build_object('error', 'message_too_short',
      'message', 'Please provide at least 10 characters of feedback.');
  END IF;

  IF length(p_message) > 2000 THEN
    RETURN json_build_object('error', 'message_too_long',
      'message', 'Feedback must be under 2000 characters.');
  END IF;

  INSERT INTO feedback_submissions (user_id, category, rating, message, app_version)
  VALUES (auth.uid(), p_category, p_rating, trim(p_message), p_app_version);

  -- Fetch username for the notification email
  SELECT username INTO v_username FROM profiles WHERE id = auth.uid();

  -- Fire-and-forget notification (errors here don't fail the submission)
  PERFORM net.http_post(
    url     := 'https://ahtynqcogyqhcrvqdsmi.supabase.co/functions/v1/notify-feedback',
    headers := jsonb_build_object(
      'Content-Type',    'application/json',
      'x-notify-secret', 'ntfy_arcade_eF4k9zPq7Bw'
    ),
    body    := jsonb_build_object(
      'category',    p_category,
      'message',     trim(p_message),
      'rating',      p_rating,
      'username',    v_username,
      'app_version', p_app_version
    )
  );

  RETURN json_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_submit_feedback(text, text, int, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.rpc_submit_feedback(text, text, int, text) TO authenticated;
