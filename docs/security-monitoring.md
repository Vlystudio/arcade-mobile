# Security Monitoring & Alerting

This document describes the monitoring strategy, alert types, recommended tooling, and how to triage security events for ArcadeTracker.

---

## Tables

| Table | Purpose |
|-------|---------|
| `security_events` | Structured log of security-relevant events (failed QR scans, role changes, rate-limit hits, etc.) |
| `admin_audit_log` | Admin action log (score reviews, tournament approvals, account deletions, etc.) |
| `rate_limit_log` | Per-user action timestamps for DB-level rate limiting |

---

## Event Catalogue

| `event_type` | `severity` | Trigger |
|---|---|---|
| `qr_token_invalid` | warn | Unrecognised QR token scanned |
| `qr_token_expired` | warn | Expired QR token scanned |
| `qr_token_revoked` | warn | Revoked QR token scanned |
| `admin_permission_denied` | warn | Caller failed is_admin / is_venue_admin check |
| `rate_limit_hit` | warn | DB-level rate limit exceeded |
| `role_escalation_attempt` | critical | User tried to set `is_admin` or `role` directly |
| `venue_role_granted` | info | Venue admin/owner/staff added |
| `venue_role_revoked` | info | Venue admin/owner/staff removed |
| `account_deleted` | info | Self-requested account deletion completed |
| `moderation_service_down` | warn/critical | AWS Rekognition / OpenAI unavailable in production |
| `payment_validation_fail` | warn | Square catalog rejection |
| `login_failed` | warn | Failed login attempt (wrong password / account not found) |
| `mfa_failed` | warn | Correct password but MFA code wrong or timed out |
| `mfa_disabled` | warn | MFA removed from account |
| `password_reset_requested` | info | Password reset email triggered |
| `storage_upload_spike` | warn | User uploaded >10 files in 5 minutes |
| `suspicious_score_spike` | warn | User submitted >5 scores in 10 minutes (above normal rate-limit) |
| `payment_webhook_invalid_sig` | critical | Square webhook received with invalid HMAC signature |
| `payment_webhook_replay` | warn | Duplicate Square event_id received (replay attempt) |
| `moderation_flagged` | warn | Image or text flagged by moderation service |

---

## Recommended Tooling

### 1. Sentry (crash & error monitoring)

Install:
```bash
npx expo install @sentry/react-native
```

Configure in `app.json`:
```json
{
  "plugins": [
    ["@sentry/react-native/expo", { "organization": "...", "project": "..." }]
  ]
}
```

Set `SENTRY_DSN` in `.env` (not `EXPO_PUBLIC_`):
```env
SENTRY_DSN=https://abc123@o0.ingest.sentry.io/0
```

### 2. Supabase Log Drain (Logtail / Better Stack)

1. Go to **Supabase Dashboard → Settings → Logs → Log Drains**
2. Add a drain to Better Stack or Datadog
3. Set up alerts on log patterns:
   - `event_type = 'role_escalation_attempt'`
   - `event_type = 'admin_permission_denied' AND count > 5 in 10 minutes`

### 3. Database Webhook for Critical Events

To get real-time Slack/email alerts on `critical` severity events:

1. Go to **Supabase Dashboard → Database → Webhooks**
2. Create webhook on `security_events` table, `INSERT` trigger
3. Filter: `severity = 'critical'`
4. Target: Supabase Edge Function `notify-admin`
5. The `notify-admin` function sends a Slack message or Resend email

Example `notify-admin` Edge Function payload handler:
```typescript
// supabase/functions/notify-admin/index.ts
Deno.serve(async (req) => {
  const { record } = await req.json();
  if (record.severity === 'critical') {
    await fetch(Deno.env.get('SLACK_WEBHOOK_URL')!, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: `🚨 *Critical security event*: \`${record.event_type}\`\nUser: ${record.user_id}\nDetails: ${JSON.stringify(record.details)}`,
      }),
    });
  }
  return new Response('ok');
});
```

### 4. Scheduled Security Summary (weekly)

Add a Supabase cron job (pg_cron) to send a weekly security summary:
```sql
-- Requires pg_cron extension (Supabase Pro plan)
SELECT cron.schedule(
  'weekly-security-summary',
  '0 9 * * 1',  -- Monday 9am UTC
  $$
    INSERT INTO admin_audit_log (action, details)
    SELECT 'weekly_security_summary', jsonb_build_object(
      'critical_events_7d', (SELECT COUNT(*) FROM security_events WHERE severity='critical' AND created_at > now()-interval '7 days'),
      'warn_events_7d',     (SELECT COUNT(*) FROM security_events WHERE severity='warn'     AND created_at > now()-interval '7 days'),
      'rate_limit_hits_7d', (SELECT COUNT(*) FROM security_events WHERE event_type='rate_limit_hit' AND created_at > now()-interval '7 days'),
      'failed_qr_scans_7d', (SELECT COUNT(*) FROM security_events WHERE event_type LIKE 'qr_token_%'  AND created_at > now()-interval '7 days')
    );
  $$
);
```

---

## Manual Triage Queries

### Recent critical events
```sql
SELECT event_type, user_id, p.username, details, created_at
FROM security_events se
LEFT JOIN profiles p ON p.id = se.user_id
WHERE severity = 'critical'
ORDER BY created_at DESC
LIMIT 50;
```

### QR scan failures in the last 24h (potential brute-force)
```sql
SELECT user_id, COUNT(*) AS attempts, MAX(created_at) AS last_attempt
FROM security_events
WHERE event_type IN ('qr_token_invalid','qr_token_expired','qr_token_revoked')
  AND created_at > now() - interval '24 hours'
GROUP BY user_id
HAVING COUNT(*) >= 5
ORDER BY attempts DESC;
```

### Rate-limit spikes by action
```sql
SELECT
  details->>'action' AS rate_limited_action,
  COUNT(*) AS hits,
  COUNT(DISTINCT user_id) AS unique_users
FROM security_events
WHERE event_type = 'rate_limit_hit'
  AND created_at > now() - interval '1 hour'
GROUP BY 1
ORDER BY hits DESC;
```

### Admin actions in the last 7 days
```sql
SELECT action, admin_id, p.username, target_type, target_id, created_at
FROM admin_audit_log al
LEFT JOIN profiles p ON p.id = al.admin_id
WHERE created_at > now() - interval '7 days'
ORDER BY created_at DESC;
```

### Role escalation attempts (should always be 0)
```sql
SELECT * FROM security_events
WHERE event_type = 'role_escalation_attempt'
ORDER BY created_at DESC;
```

### Failed login / MFA attempts (potential credential stuffing)
```sql
SELECT user_id, event_type, COUNT(*) as attempts, MAX(created_at) as last_attempt
FROM security_events
WHERE event_type IN ('login_failed', 'mfa_failed')
  AND created_at > now() - interval '1 hour'
GROUP BY user_id, event_type
HAVING COUNT(*) >= 3
ORDER BY attempts DESC;
```

### Storage upload spikes
```sql
SELECT user_id, COUNT(*) as uploads, MAX(created_at) as last_upload
FROM security_events
WHERE event_type = 'storage_upload_spike'
  AND created_at > now() - interval '24 hours'
GROUP BY user_id
ORDER BY uploads DESC;
```

### Payment integrity issues
```sql
SELECT event_type, details, created_at
FROM security_events
WHERE event_type IN ('payment_webhook_invalid_sig', 'payment_webhook_replay')
ORDER BY created_at DESC
LIMIT 20;
```

### Moderation flags by type
```sql
SELECT details->>'record_type' as content_type, COUNT(*) as flags
FROM security_events
WHERE event_type = 'moderation_flagged'
  AND created_at > now() - interval '7 days'
GROUP BY 1
ORDER BY flags DESC;
```

---

## Alert Thresholds (Recommended)

| Condition | Threshold | Action |
|-----------|-----------|--------|
| `role_escalation_attempt` | Any | Page on-call immediately |
| `admin_permission_denied` | >10 in 10 min from same user | Investigate + possible ban |
| `qr_token_invalid` | >20 in 5 min from same user | Investigate + rate-limit user |
| `rate_limit_hit` | >100 in 1 hour overall | Check for automated attack |
| `moderation_service_down` | Any in production | Page on-call + check AWS/OpenAI |
| Failed logins (Supabase Auth logs) | >10 in 5 min | Enable Auth rate limiting, check for credential stuffing |
| `login_failed` | >10 in 5 min same user | Possible credential stuffing — check Supabase Auth logs |
| `mfa_failed` | >5 in 10 min same user | Possible MFA brute-force |
| `payment_webhook_invalid_sig` | Any | Immediate — possible webhook spoofing attempt |
| `storage_upload_spike` | Any | Review uploaded content for abuse |
| `moderation_flagged` | >3 from same user in 1h | Possible repeat offender — review account |

---

## New Event SQL Additions

```sql
-- New event types added in security hardening pass 2:
-- login_failed              — auth.users login failure (hook or Supabase Auth log)
-- mfa_failed                — MFA code rejected
-- mfa_disabled              — 2FA removed from account
-- password_reset_requested  — password reset email triggered
-- storage_upload_spike      — >10 uploads in 5 min from one user
-- suspicious_score_spike    — >5 score submissions in 10 min
-- payment_webhook_invalid_sig — Square webhook HMAC mismatch
-- payment_webhook_replay    — duplicate Square event_id
-- moderation_flagged        — image or text flagged by AI moderation
```

---

## Privacy Note

`security_events` logs user IDs but not PII (names, emails). IP addresses are stored only when available from the request context and are used for rate-limit analysis only. Retain events for 90 days, then purge:

```sql
-- Run monthly via pg_cron
DELETE FROM security_events WHERE created_at < now() - interval '90 days';
DELETE FROM admin_audit_log  WHERE created_at < now() - interval '365 days';
```

---

## Supabase Dashboard Checklist

- [ ] Enable **GitHub Secret Scanning** in repo Settings → Security
- [ ] Enable **Dependabot alerts** in repo Settings → Security
- [ ] Enable **Branch protection** on `master`: require status checks, no force-push
- [ ] Set **Supabase Auth rate limiting**: max 10 sign-in attempts per minute per IP
- [ ] Enable **Supabase PITR** (Point-in-Time Recovery) for production data
- [ ] Verify `score-proofs` bucket is **private** (not public)
- [ ] Verify `message-media` bucket is **private**
- [ ] Confirm storage bucket file size limits (5 MB for images)
- [ ] Confirm storage MIME type restrictions (images only for photo buckets)
