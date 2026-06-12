# Square Webhook — Signature Verification & Sandbox Testing

`api/square/webhook.ts` verifies every request with HMAC-SHA256 over the
**exact raw request bytes**: `HMAC_SHA256(signature_key, notification_url + raw_body)`,
compared in constant time against the `x-square-hmacsha256-signature` header.

The Vercel body parser is **disabled** for this route
(`export const config = { api: { bodyParser: false } }`) so the handler reads
the untouched stream. If the body ever arrives pre-parsed, the handler fails
closed (500) rather than verifying against a re-serialized object — JSON
re-serialization is not byte-faithful and must never be used for signatures.

## Required environment variables (Vercel)

| Variable | Notes |
|---|---|
| `SQUARE_WEBHOOK_SIGNATURE_KEY` | From Square Dashboard → Developers → Webhooks → your subscription. Sandbox and production keys are **different**. |
| `SQUARE_WEBHOOK_NOTIFICATION_URL` | Must be the **exact** URL configured in the Square subscription, character for character (scheme, host, path, no trailing slash differences). The URL is part of the signed payload — any mismatch fails verification. |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | For event/status persistence. |

## Testing in the Square sandbox

1. In [Square Developer Dashboard](https://developer.squareup.com/apps), open
   your app → **Sandbox** mode → Webhooks → create a subscription pointing at
   your staging deployment, e.g.
   `https://<staging-deployment>.vercel.app/api/square/webhook`, subscribed to
   `payment.created`, `payment.updated`, `order.created`, `order.updated`.
2. Set the staging Vercel env vars to the **sandbox** signature key and that
   exact URL, then redeploy.
3. Use the dashboard's **"Send test event"** button. Expect HTTP `200 {ok:true}`
   (or `202 ignored:true` for unsubscribed types). The event should appear in
   `square_webhook_events`.
4. Negative test — tampered body must be rejected:

   ```bash
   # Valid signature for an empty-ish body, then mutate one byte
   BODY='{"event_id":"test-123","type":"payment.updated","data":{}}'
   URL="https://<staging>.vercel.app/api/square/webhook"
   SIG=$(printf '%s%s' "$URL" "$BODY" \
     | openssl dgst -sha256 -hmac "$SANDBOX_SIGNATURE_KEY" -binary | base64)

   # 1) correct signature → 200/202
   curl -s -o /dev/null -w '%{http_code}\n' -X POST "$URL" \
     -H "content-type: application/json" \
     -H "x-square-hmacsha256-signature: $SIG" \
     --data-raw "$BODY"

   # 2) same signature, mutated body → must be 401
   curl -s -o /dev/null -w '%{http_code}\n' -X POST "$URL" \
     -H "content-type: application/json" \
     -H "x-square-hmacsha256-signature: $SIG" \
     --data-raw "${BODY/123/124}"
   ```

5. Replay test: send the same valid event twice. The second delivery returns
   `200 {ok:true, duplicate:true}` and logs a `payment_webhook_replay`
   security event (dedupe on `square_webhook_events.event_id`).

## Logging policy

- Invalid signatures log a `payment_webhook_invalid_sig` security event with
  the endpoint only — never the body, signature, or key.
- Console logs contain error messages only; full payment payloads are stored
  exclusively in the RLS-protected `square_webhook_events` table (service
  role access only), not in stdout/Sentry.

## Before production launch

- Swap to the **production** signature key + production notification URL.
- Re-run the tamper and replay tests above against production once (with a
  test-mode payment), and confirm `security_events` receives the
  `payment_webhook_invalid_sig` row for the tampered request.
