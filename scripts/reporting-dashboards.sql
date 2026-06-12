-- ============================================================
-- Reporting dashboards: rpc_owner_metrics + rpc_architect_report
-- Owner: retention, attendance, revenue, adoption, funnel, activity heat.
-- Architect: security console, audit trail, AI verification, reports/beta,
--            API health, data-integrity checks.
-- Gated to admins/owners/architects. Read-only. Idempotent.
-- ============================================================

CREATE OR REPLACE FUNCTION public.rpc_owner_metrics()
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ok boolean;
BEGIN
  SELECT (is_admin OR role IN ('owner','architect','admin')) INTO v_ok
    FROM profiles WHERE id = auth.uid();
  IF NOT COALESCE(v_ok, false) THEN
    RETURN json_build_object('error', 'unauthorized');
  END IF;

  RETURN json_build_object(
    -- Weekly signup cohorts (8w): how many came back and did anything
    'retention', (
      SELECT COALESCE(json_agg(row_to_json(r) ORDER BY r.week), '[]'::json) FROM (
        SELECT date_trunc('week', p.created_at)::date AS week,
               count(*) AS signups,
               count(*) FILTER (WHERE EXISTS (
                 SELECT 1 FROM check_ins c WHERE c.user_id = p.id
                   AND c.created_at BETWEEN p.created_at + interval '1 day' AND p.created_at + interval '7 days')
                 OR EXISTS (
                 SELECT 1 FROM scores s WHERE s.user_id = p.id
                   AND s.created_at BETWEEN p.created_at + interval '1 day' AND p.created_at + interval '7 days')
               ) AS active_w1
        FROM profiles p
        WHERE p.created_at > now() - interval '8 weeks'
        GROUP BY 1
      ) r
    ),
    -- League-night attendance (8w): distinct players in completed sessions
    'attendance', (
      SELECT COALESCE(json_agg(row_to_json(a) ORDER BY a.week_of), '[]'::json) FROM (
        SELECT ss.week_of, count(DISTINCT sp.player_user_id) AS players,
               count(DISTINCT ss.team_id) AS teams, count(*) AS games
        FROM skeeball_sessions ss
        JOIN skeeball_session_players sp ON sp.session_id = ss.id
        WHERE ss.status = 'completed' AND ss.week_of > current_date - 56
        GROUP BY ss.week_of
      ) a
    ),
    -- Revenue (8w): Square completed payments + paid team registrations
    'revenue', json_build_object(
      'weekly', (
        SELECT COALESCE(json_agg(row_to_json(v) ORDER BY v.week), '[]'::json) FROM (
          SELECT date_trunc('week', updated_at)::date AS week,
                 count(*) AS payments,
                 COALESCE(SUM((raw_event#>>'{data,object,payment,amount_money,amount}')::bigint), 0) AS cents
          FROM square_payment_statuses
          WHERE status = 'COMPLETED' AND updated_at > now() - interval '8 weeks'
          GROUP BY 1
        ) v
      ),
      'registrations_paid', (SELECT count(*) FROM team_registrations WHERE status = 'paid')
    ),
    -- Feature adoption (30d): distinct users per feature vs total actives
    'adoption', (
      WITH actives AS (
        SELECT DISTINCT user_id AS uid FROM scores WHERE created_at > now() - interval '30 days'
        UNION SELECT DISTINCT user_id FROM check_ins WHERE created_at > now() - interval '30 days'
        UNION SELECT DISTINCT user_id FROM posts WHERE created_at > now() - interval '30 days'
      )
      SELECT json_build_object(
        'actives',  (SELECT count(*) FROM actives),
        'karaoke',  (SELECT count(DISTINCT requested_by) FROM karaoke_queue WHERE created_at > now() - interval '30 days' AND requested_by IS NOT NULL),
        'pickem',   (SELECT count(DISTINCT user_id) FROM pickem_picks WHERE created_at > now() - interval '30 days'),
        'fantasy',  (SELECT count(DISTINCT user_id) FROM fantasy_predictions WHERE created_at > now() - interval '30 days'),
        'forums',   (SELECT count(DISTINCT user_id) FROM forum_posts WHERE created_at > now() - interval '30 days'),
        'posts',    (SELECT count(DISTINCT user_id) FROM posts WHERE created_at > now() - interval '30 days'),
        'dms',      (SELECT count(DISTINCT sender_id) FROM messages WHERE created_at > now() - interval '30 days')
      )
    ),
    -- Signup funnel
    'funnel', json_build_object(
      'signups',      (SELECT count(*) FROM profiles),
      'with_avatar',  (SELECT count(*) FROM profiles WHERE avatar_url IS NOT NULL),
      'on_team',      (SELECT count(DISTINCT user_id) FROM team_members),
      'played_game',  (SELECT count(DISTINCT player_user_id) FROM skeeball_session_players sp
                         JOIN skeeball_sessions ss ON ss.id = sp.session_id AND ss.status = 'completed')
    ),
    -- Activity heat (30d): by day-of-week and by hour
    'heat', json_build_object(
      'by_dow', (
        SELECT COALESCE(json_agg(row_to_json(d) ORDER BY d.dow), '[]'::json) FROM (
          SELECT EXTRACT(dow FROM created_at)::int AS dow, count(*) AS n
          FROM (SELECT created_at FROM scores WHERE created_at > now() - interval '30 days'
                UNION ALL SELECT created_at FROM check_ins WHERE created_at > now() - interval '30 days') t
          GROUP BY 1
        ) d
      ),
      'by_hour', (
        SELECT COALESCE(json_agg(row_to_json(h) ORDER BY h.hour), '[]'::json) FROM (
          SELECT EXTRACT(hour FROM created_at)::int AS hour, count(*) AS n
          FROM (SELECT created_at FROM scores WHERE created_at > now() - interval '30 days'
                UNION ALL SELECT created_at FROM check_ins WHERE created_at > now() - interval '30 days') t
          GROUP BY 1
        ) h
      )
    )
  );
END; $$;

REVOKE ALL ON FUNCTION public.rpc_owner_metrics() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_owner_metrics() TO authenticated;


CREATE OR REPLACE FUNCTION public.rpc_architect_report()
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ok boolean;
BEGIN
  SELECT (is_admin OR role IN ('owner','architect')) INTO v_ok
    FROM profiles WHERE id = auth.uid();
  IF NOT COALESCE(v_ok, false) THEN
    RETURN json_build_object('error', 'unauthorized');
  END IF;

  RETURN json_build_object(
    'security', json_build_object(
      'by_type_7d', (
        SELECT COALESCE(json_agg(row_to_json(t) ORDER BY t.n DESC), '[]'::json) FROM (
          SELECT event_type, severity, count(*) AS n
          FROM security_events WHERE created_at > now() - interval '7 days'
          GROUP BY 1, 2 ORDER BY count(*) DESC LIMIT 12
        ) t
      ),
      'recent', (
        SELECT COALESCE(json_agg(row_to_json(e)), '[]'::json) FROM (
          SELECT event_type, severity, details, created_at
          FROM security_events ORDER BY created_at DESC LIMIT 15
        ) e
      )
    ),
    'audit_recent', (
      SELECT COALESCE(json_agg(row_to_json(a)), '[]'::json) FROM (
        SELECT al.action, al.target_type, al.created_at, p.username AS admin_name
        FROM admin_audit_log al LEFT JOIN profiles p ON p.id = al.admin_id
        ORDER BY al.created_at DESC LIMIT 15
      ) a
    ),
    'ai_verification', (
      SELECT json_build_object(
        'auto_denied',  count(*) FILTER (WHERE ai_verdict = 'auto_denied'),
        'looks_good',   count(*) FILTER (WHERE ai_verdict = 'looks_good'),
        'needs_review', count(*) FILTER (WHERE ai_verdict = 'needs_review'),
        'no_reference', count(*) FILTER (WHERE ai_verdict = 'no_reference'),
        'errors',       count(*) FILTER (WHERE ai_verdict = 'error'),
        'disagreements', count(*) FILTER (WHERE ai_verdict = 'looks_good' AND status = 'denied')
      ) FROM scores WHERE ai_checked_at IS NOT NULL
    ),
    'reports', json_build_object(
      'content_pending', (SELECT count(*) FROM content_reports WHERE status = 'pending'),
      'beta_by_status', (
        SELECT COALESCE(json_agg(row_to_json(b)), '[]'::json) FROM (
          SELECT status, count(*) AS n FROM beta_reports GROUP BY 1
        ) b
      )
    ),
    'api_health', json_build_object(
      'karaoke_cache_entries',   (SELECT count(*) FROM karaoke_search_cache),
      'karaoke_cache_hits',      (SELECT COALESCE(SUM(hits), 0) FROM karaoke_search_cache),
      'webhook_events_7d',       (SELECT count(*) FROM square_webhook_events WHERE received_at > now() - interval '7 days'),
      'webhook_bad_sig_7d',      (SELECT count(*) FROM security_events WHERE event_type = 'payment_webhook_invalid_sig' AND created_at > now() - interval '7 days'),
      'rate_limit_trips_24h',    (SELECT count(*) FROM rate_limit_log WHERE created_at > now() - interval '24 hours')
    ),
    'integrity', json_build_object(
      'users_without_profiles', (SELECT count(*) FROM auth.users u LEFT JOIN profiles p ON p.id = u.id WHERE p.id IS NULL),
      'placeholder_usernames',  (SELECT count(*) FROM profiles WHERE username ~ '^user_[0-9a-f]{32}$'),
      'sessions_stuck_active',  (SELECT count(*) FROM skeeball_sessions WHERE status = 'active' AND last_activity_at < now() - interval '24 hours'),
      'scores_pending_7d',      (SELECT count(*) FROM scores WHERE status = 'pending' AND created_at < now() - interval '7 days'),
      'cleanup_queue_depth',    (SELECT count(*) FROM storage_cleanup_queue WHERE processed_at IS NULL)
    )
  );
END; $$;

REVOKE ALL ON FUNCTION public.rpc_architect_report() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_architect_report() TO authenticated;
