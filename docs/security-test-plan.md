# Security Test Plan

## Overview
ArcadeTracker's security posture is verified through a SQL-based RLS/RPC test suite that runs against the live Supabase project. The suite uses `SET LOCAL ROLE` to simulate different caller contexts and checks that every access control boundary behaves correctly.

---

## Running the Tests

### Option A — Supabase SQL Editor (recommended for quick checks)
1. Open **Supabase Dashboard → SQL Editor**
2. Paste the full contents of `scripts/security-verification-tests.sql`
3. Run — every output row should contain `PASS`

### Option B — Supabase CLI (local dev / CI)

#### Prerequisites
```bash
npm install -g supabase
supabase login   # uses SUPABASE_ACCESS_TOKEN env var in CI
```

#### Start a local Supabase instance
```bash
supabase start   # requires Docker
```

#### Apply migrations in order
```bash
supabase db reset   # wipes local DB and replays all migrations
```

If you're not using `supabase/migrations/` yet, apply scripts manually:
```bash
for f in \
  scripts/seed-games.sql \
  scripts/seed-menu.sql \
  scripts/seed-admin-policies.sql \
  scripts/rls-policies.sql \
  scripts/rpc-check-in.sql \
  scripts/rpc-admin-actions.sql \
  scripts/rls-security-patches.sql \
  scripts/venue-migration.sql \
  scripts/security-hardening.sql \
  scripts/security-hardening-2.sql \
  scripts/security-events.sql \
  scripts/venue-role-hardening.sql \
  scripts/qr-token-hardening.sql \
  scripts/storage-security.sql \
  scripts/square-webhook-events.sql \
  scripts/input-validation-hardening.sql; do
  echo "Applying $f..."
  supabase db execute --file "$f"
done
```

#### Run the verification tests
```bash
supabase db execute --file scripts/security-verification-tests.sql 2>&1 | grep -E 'PASS|FAIL|NOTICE'
```

Every line should contain `PASS`. Any `FAIL` line indicates a regression.

---

## Test Blocks

| Block | What is tested |
|-------|---------------|
| 1 | Anonymous cannot read scores, profiles, check-ins, audit log, QR tokens, venue admins |
| 2 | Authenticated user cannot insert directly into `check_ins` or `scores` |
| 3 | Admin RPCs reject callers without MFA (P0003) |
| 4 | Authenticated user cannot read `admin_audit_log` |
| 5 | Authenticated user cannot update another user's profile |
| 6 | Self-promotion to admin is blocked (escalation trigger fires) |
| 7 | Invalid QR token returns `lane_not_found` |
| 8 | `hash_lane_token()` produces consistent 64-char hex output |
| 9 | `public_profiles` view does not expose `is_admin`, `email`, or `phone` |
| 10 | Score range constraint exists on `scores` table |
| 11 | RLS is enabled on all sensitive tables |

---

## Expected PASS Output (abridged)
```
PASS: anon cannot read scores
PASS: anon cannot read profiles
PASS: anon cannot read check_ins
PASS: anon cannot read admin_audit_log
PASS: anon cannot read security_events
PASS: anon cannot read lane_qr_tokens
PASS: anon cannot read venue_admins
PASS: direct check_in insert blocked
PASS: direct score insert blocked
PASS: admin RPC rejected without MFA (P0003)
PASS: authenticated cannot read audit log
PASS: cannot update another user's profile
PASS: self-promotion to admin blocked
PASS: invalid QR token returns lane_not_found
PASS: hash_lane_token returns 64-char hex
PASS: public_profiles hides is_admin
PASS: scores_value_bounds constraint exists
PASS: RLS enabled on scores
PASS: RLS enabled on profiles
... (all 11 blocks)
TEST SUMMARY — all checks passed
```

---

## CI Integration

The test suite requires a live Supabase instance. To run in CI:

1. Use a **dedicated test project** on Supabase (not the production project).
2. Set these CI secrets:
   - `SUPABASE_TEST_URL`
   - `SUPABASE_TEST_SERVICE_ROLE_KEY`
3. Add a CI step:
```yaml
- name: Run security verification tests
  env:
    SUPABASE_URL: ${{ secrets.SUPABASE_TEST_URL }}
    SUPABASE_KEY: ${{ secrets.SUPABASE_TEST_SERVICE_ROLE_KEY }}
  run: |
    npx supabase db execute \
      --db-url "$SUPABASE_URL" \
      --file scripts/security-verification-tests.sql \
      2>&1 | tee test-output.txt
    if grep -q 'FAIL' test-output.txt; then
      echo "::error::Security verification tests failed"
      cat test-output.txt
      exit 1
    fi
```

> **Note:** Full CI automation of these tests requires a separate Supabase test project with the schema pre-applied. Until that is set up, run `scripts/security-verification-tests.sql` manually in the Supabase SQL Editor after every migration.

---

## Adding New Tests

When adding a new RLS policy or RPC security check:
1. Add a corresponding test block to `scripts/security-verification-tests.sql`
2. Follow the `BEGIN/EXCEPTION WHEN foreign_key_violation` pattern for tests that call RPCs which log to `security_events`
3. Run the full suite to confirm all existing tests still pass
4. Document the new block in the table above
