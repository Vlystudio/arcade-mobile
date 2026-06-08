# ArcadeTracker — Mobile App

React Native (Expo SDK 55) arcade venue companion app backed by Supabase (PostgreSQL + Auth + Storage + RLS).

## Features

### Social & Community
| Screen | What it does |
|--------|-------------|
| **Feed** | Social posts with photos, score highlights, likes, comments, follow/unfollow |
| **Chat** | Direct messaging between users (Realtime) |
| **Forums** | Community forum threads with admin moderation |

### Games & Competition
| Screen | What it does |
|--------|-------------|
| **Games** | Multi-game leaderboard, QR lane check-in, score submission with photo proof |
| **Leaderboard** | Global score rankings across all game types |
| **Skee-Ball Tracker** | Live 3-player session tracker — per-ball scoring across 6 lanes |
| **Lane Scores** | Per-lane score history and player stats |
| **Pool** | Table occupancy tracking, game type selection (8-ball, 9-ball, cutthroat, straight), player roster per table |
| **Trivia Night** | Event sign-up, team formation for Trivia Night events |
| **Demo Mode** | Guided walkthrough of app features for new visitors |

### Teams & Leagues
| Screen | What it does |
|--------|-------------|
| **Teams** | Create/join teams, team chat (Realtime), weekly schedule, captain announcements, team photos |
| **Leagues** | Season standings, match schedule, win/loss records per team |

### Tournaments
| Screen | What it does |
|--------|-------------|
| **Tournaments** | Request, manage & join tournaments; bracket management; podium placements; owner controls |
| **First Friday Series** | Dedicated screen for the recurring First Friday Skee-Ball tournament — Hall of Champions (win count across all events), per-event history, bracket viewer, guest player support (admin can add players by name without an account) |

### Food & Ordering
| Screen | What it does |
|--------|-------------|
| **Food Menu** | Location-aware menu browsing by category (accessible without login) |
| **Cart & Checkout** | Cart management, Square-hosted final total and checkout (no account required) |

### Profile & Account
| Screen | What it does |
|--------|-------------|
| **Profile** | Stats, avatar, bio, tournament history, follow graph, privacy toggle |
| **MFA Setup / Verify** | TOTP-based two-factor authentication (required for admin actions) |
| **Delete Account** | Full account deletion — clears storage, posts, follows, and auth record |
| **Privacy & Terms** | In-app privacy policy and terms of service |
| **Support Chat** | In-app support messaging |
| **Feedback** | User feedback submission |

### Staff & Administration
| Screen | What it does |
|--------|-------------|
| **Admin** | Score review queue, tournament management (including FF guest players), team deletion, audit log viewer, health dashboard |
| **Owner Dashboard** | Business analytics — user growth, active players, score volume, game-type breakdown, top players |

---

## Prerequisites

- **Node.js** 18+
- **Expo CLI** — `npm install -g expo-cli`
- **EAS CLI** (production builds) — `npm install -g eas-cli`
- A **[Supabase](https://supabase.com)** project (free tier is fine for dev)

---

## Local Setup

### 1. Install dependencies
```bash
npm install
```

### 2. Environment variables
Create a `.env` file in the project root (never commit this):
```env
EXPO_PUBLIC_SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
EXPO_PUBLIC_SITE_URL=https://your-live-site.example.com
EXPO_PUBLIC_API_BASE_URL=https://your-live-site.example.com
EXPO_PUBLIC_IS_PRODUCTION=true
```
The anon key is safe to ship in a mobile app — it can only do what your RLS policies allow.

Square credentials must be configured only in the server/deployment environment, never as `EXPO_PUBLIC_*` variables:
```env
SQUARE_ACCESS_TOKEN=your-square-access-token
SQUARE_ENVIRONMENT=sandbox
SQUARE_LOCATION_ARCADE_BAR_ID=square-location-id
SQUARE_LOCATION_VINYL_HALL_ID=square-location-id
SQUARE_VERSION=2026-05-20
SQUARE_REFERENCE_PREFIX=arcadetracker
SQUARE_CURRENCY=USD
SQUARE_CHECKOUT_REDIRECT_URL=https://your-live-site.example.com/food
SQUARE_WEBHOOK_SIGNATURE_KEY=your-square-webhook-signature-key
SQUARE_WEBHOOK_NOTIFICATION_URL=https://your-live-site.example.com/api/square/webhook
APP_ALLOWED_ORIGINS=https://your-live-site.example.com,https://your-vercel-domain.vercel.app
```

### 3. Database setup
Run these SQL scripts **in order** in the Supabase SQL Editor:

| Order | File | Purpose |
|-------|------|---------|
| 1 | `scripts/seed-games.sql` | Game catalog and base table definitions |
| 2 | `scripts/seed-menu.sql` | Food menu seed data |
| 3 | `scripts/seed-admin-policies.sql` | `is_admin()` helper function |
| 4 | `scripts/rls-policies.sql` | Full Row Level Security for every table |
| 5 | `scripts/rpc-check-in.sql` | `rpc_check_in` SECURITY DEFINER function |
| 6 | `scripts/rpc-admin-actions.sql` | Admin SECURITY DEFINER RPCs (score review, tournament actions, team delete) |
| 7 | `scripts/rls-security-patches.sql` | Critical RLS patches (C1-C3, H1-H5, M1-M3) |
| 8 | `scripts/venue-migration.sql` | Multi-venue support (`venues` table, `venue_id` columns) |
| 9 | `scripts/security-hardening.sql` | P2-P9 hardening: rate limits, constraints, audit log, forum RPC, score RPC, public profiles, team features |
| 10 | `scripts/security-hardening-2.sql` | MFA enforcement, score proof RPC, QR expiry, score range, privacy view |
| 11 | `scripts/security-events.sql` | Structured security audit log (`security_events` table, `log_security_event` RPC) |
| 12 | `scripts/venue-role-hardening.sql` | Venue role hierarchy (`owner`/`admin`/`staff`), scoped helper functions |
| 13 | `scripts/qr-token-hardening.sql` | Hashed QR tokens with expiry, revocation, and backfill migration |
| 14 | `scripts/storage-security.sql` | Storage bucket RLS policies, including private media quarantine + cleanup queue |
| 15 | `scripts/square-webhook-events.sql` | Square webhook idempotency and payment/order status tables |
| 16 | `scripts/input-validation-hardening.sql` | Database check constraints for user-generated inputs |

> **Verification:** After all scripts are applied, run `scripts/security-verification-tests.sql` in the SQL Editor. Every row should return `result = 'PASS'`.

Then grant yourself admin access:
```sql
UPDATE profiles
SET is_admin = true
WHERE id = (SELECT id FROM auth.users WHERE email = 'your@email.com');
```

### 4. Supabase Storage
Create the following buckets in the Supabase dashboard:

| Bucket | Visibility | Max size | MIME types |
|--------|-----------|----------|------------|
| `avatars` | **Public** | 5 MB | `image/jpeg`, `image/png`, `image/webp` |
| `post-photos` | **Public** | 5 MB | `image/jpeg`, `image/png`, `image/webp` |
| `score-proofs` | **Private** | 5 MB | `image/jpeg`, `image/png`, `image/webp` |
| `message-media` | **Private** | 5 MB | `image/jpeg`, `image/png`, `image/webp` |
| `team-photos` | **Public** | 5 MB | `image/jpeg`, `image/png`, `image/webp` |
| `media-quarantine` | **Private** | 5 MB | `image/jpeg`, `image/png`, `image/webp` |

Storage RLS policies are applied by `scripts/storage-security.sql` (step 14 above). Do **not** add manual policies for these buckets — the script handles everything.

Public user media uploads first go to `media-quarantine`; the `moderate-image` Edge Function publishes approved files into the public bucket.

### 5. Start the dev server
```bash
npx expo start
```
Open in Expo Go (scan QR), iOS Simulator (`i`), or Android Emulator (`a`).

---

## Database Schema

| Table | Key columns | Notes |
|-------|------------|-------|
| `profiles` | `id`, `username`, `avatar_url`, `is_admin`, `is_arcade_official` | Created automatically on signup via trigger |
| `posts` | `id`, `user_id`, `content`, `post_type`, `photo_url`, `score_id` | `post_type`: `post` \| `announcement` |
| `post_likes` | `post_id`, `user_id` | |
| `follows` | `follower_id`, `following_id` | |
| `scores` | `id`, `user_id`, `game_id`, `score`, `status`, `photo_url` | `status`: `pending` \| `approved` \| `denied` |
| `games` | `id`, `name`, `type` | Seeded via `seed-games.sql` |
| `lanes` | `id`, `lane_number`, `lane_qr_token`, `status`, `game_id` | QR token is a static secret per lane |
| `check_ins` | `id`, `user_id`, `lane_id`, `status` | One active check-in per user enforced by RLS |
| `teams` | `id`, `name`, `captain_id` | |
| `team_members` | `team_id`, `user_id` | |
| `tournaments` | `id`, `title`, `status`, `is_official`, `is_individual`, `signup_type`, `created_by`, `announcement` | |
| `tournament_requests` | `id`, `user_id`, `title`, `status`, `admin_note` | `status`: `pending` \| `approved` \| `denied` |
| `tournament_registrations` | `id`, `tournament_id`, `user_id`, `status` | `status`: `pending` \| `accepted` \| `denied` |
| `tournament_placements` | `tournament_id`, `user_id`, `placement` | |
| `trivia_events` | `id`, `title`, `signup_deadline`, `status` | |
| `trivia_teams` | `id`, `event_id`, `name`, `captain_id` | |
| `trivia_team_members` | `trivia_team_id`, `user_id` | |
| `venues` | `id`, `slug`, `name`, `address`, `color` | Seeded with Arcade Bar and Vinyl Hall |
| `venue_admins` | `venue_id`, `user_id`, `granted_by` | Per-venue admin scoping |
| `team_schedule` | `id`, `team_id`, `week_label`, `slot` | Weekly time slot assignments |
| `team_announcements` | `id`, `team_id`, `user_id`, `content` | Captain-only broadcast messages |
| `team_messages` | `id`, `team_id`, `user_id`, `content` | Group chat (Realtime) |
| `admin_audit_log` | `id`, `admin_id`, `action`, `target_type`, `target_id`, `details` | Admin action history |
| `rate_limit_log` | `id`, `user_id`, `action`, `created_at` | Rate-limit tracking (auto-pruned) |

---

## Security Model

### Row Level Security
Every table has RLS enabled. The anon key cannot bypass it. Key rules:

- **Profiles**: Anyone authenticated can read. Users can only update their own row, and **cannot set `is_admin` or `is_arcade_official` on themselves** — those fields are locked to the current value in the WITH CHECK clause.
- **Scores**: New inserts must have `status = 'pending'`. Only admins can flip status to `approved`/`denied`.
- **Announcements**: Only users with `is_arcade_official = true` can insert `post_type = 'announcement'`.
- **Check-ins**: The DB enforces a single active check-in per user via a `NOT EXISTS` sub-select in the INSERT policy.
- **Tournament management**: Only admins can create/approve tournaments. Owners (set via `created_by` on admin approval) can update `announcement` and cancel their own tournament — nothing else.

### Admin access
Admin screens verify `profiles.is_admin` with a live DB query on every mount (`checkAdminAndLoad` in `admin.tsx`). The frontend check is for UX only — all sensitive operations are blocked by RLS regardless.

### QR codes
Lane QR tokens are **hashed and expiring** — raw token values are never stored in the DB.

1. Admins generate tokens via `rpc_admin_generate_lane_qr_token(lane_id)` — the raw token is returned once and must be printed/embedded in the QR code.
2. The DB stores only the SHA-256 hash (`lane_qr_tokens.token_hash`). A compromised DB reveals nothing usable.
3. Tokens expire after 90 days. Admins can force-rotate any time.
4. Revoked and expired tokens are rejected with distinct error codes in `rpc_check_in`.
5. Only one active check-in per user at a time (RLS enforced).
6. Rate-limit: 30-minute cooldown before re-checking into the same lane.
7. Test-lane buttons (`__DEV__` only) are hidden in production builds.

### Score submission
Score inserts are routed through `rpc_submit_score` (SECURITY DEFINER). The RPC:
- Always sets `user_id = auth.uid()` and `status = 'pending'` server-side (cannot be spoofed by the client)
- Enforces score range 0–9,999,999
- Validates `check_in_id` ownership
- Rate-limits to 20 submissions per user per hour

### Admin writes
All admin-only mutations use SECURITY DEFINER RPCs. Every RPC:
1. Calls `public.require_mfa()` — rejects callers without AAL2 (TOTP/passkey second factor).
2. Checks `is_admin()` or `is_venue_admin(venue_id)` depending on scope.
3. Writes to `admin_audit_log` for traceability.

| RPC | Who can call |
|-----|-------------|
| `rpc_admin_review_score` | Platform admin **or** venue admin of that score's venue |
| `rpc_admin_update_forum_status` | Platform admin only |
| `rpc_admin_approve_tournament` / `rpc_admin_deny_tournament` | Platform admin only |
| `rpc_admin_set_tournament_status` | Platform admin only |
| `rpc_admin_save_placements` | Platform admin only |
| `rpc_admin_delete_team` | Platform admin only |
| `rpc_admin_create_first_friday` | Platform admin only |

### Venue role hierarchy
`venue_admins.role` has three levels: `owner > admin > staff`.

| Helper function | Returns true for |
|----------------|-----------------|
| `is_platform_admin()` | `profiles.is_admin = true` |
| `is_venue_owner(venue_id)` | platform admin OR venue owner |
| `is_venue_admin(venue_id)` | platform admin OR venue owner/admin |
| `is_venue_staff(venue_id)` | platform admin OR any venue role |

### Rate limiting
BEFORE INSERT triggers on `posts` (10/h), `messages` (60/min), `team_messages` (60/min), `forums` (5/h), and `team_requests` (10/day) call `check_and_log_rate_limit()` which raises an exception if the limit is exceeded. The `rate_limit_log` table is cleaned up automatically.

### Venue isolation
`venue_admins` table allows per-venue admin scoping. `is_venue_admin(venue_id)` returns true for global admins or explicit venue-admin entries.

### Square / payments
Square prices are **never derived from the client**. The server-side `/api/square/orders` route fetches prices directly from the Square Catalog API using `SQUARE_ACCESS_TOKEN`. The client only sends variation IDs and quantities; the server resolves prices and creates the order. Taxes, tips, fees, and the final payable total are shown by Square at hosted checkout, so the cart only displays an item subtotal.

Payment/order status must come from `/api/square/webhook`, which verifies Square's HMAC signature, deduplicates event IDs, and stores status server-side. Do not trust client redirects as proof of payment.

### Security testing
Run `scripts/security-verification-tests.sql` in the Supabase SQL Editor after every migration. It uses `SET LOCAL ROLE` to simulate anonymous, authenticated, and admin callers across 9 test blocks. Every row should return `result = 'PASS'`.

The test suite verifies:
- Anonymous cannot read scores, profiles, audit log, security events, check-ins, rate-limit log, QR tokens, venue admins
- Authenticated user cannot insert directly into `check_ins` or `scores`
- Authenticated user cannot read `admin_audit_log`
- Authenticated user cannot update another user's profile
- Authenticated user cannot self-promote to admin (escalation trigger fires)
- Admin RPCs are rejected without MFA (P0003 exception)
- Invalid QR token returns `lane_not_found`
- `hash_lane_token()` produces consistent 64-char hex output
- `public_profiles` view does not expose `is_admin`, `email`, or `phone`
- `scores_score_range` constraint exists
- RLS is enabled on all 12 sensitive tables

### Monitoring and alerting
See `docs/security-monitoring.md` for the full event catalogue, alert thresholds, triage queries, and recommended tooling (Sentry, Supabase log drain, DB webhook → `notify-admin` Edge Function).

---

## Image Uploads
Photos are compressed client-side before upload (`lib/compress-image.ts`):
- Resized to max 1920 px on the longest side
- JPEG quality 0.75
- Hard 5 MB cap — rejected before upload if exceeded

---

## Building for Production

### Preview (internal testing)
```bash
eas build --platform ios --profile preview
eas build --platform android --profile preview
```

### App Store / Play Store
```bash
eas build --platform all --profile production
eas submit --platform ios
eas submit --platform android
```

**Required before App Store review:**
- Privacy policy URL — link to the in-app `/privacy` screen or a hosted page
- Data deletion instructions — link to the `/delete-account` screen
- App Store Connect: complete all privacy nutrition labels (data types collected, usage)
- `eas.json` with correct bundle ID / app ID credentials

---

## Environment Variables Reference

### Client (Expo — `EXPO_PUBLIC_*` prefix, safe to expose)

| Variable | Description |
|----------|-------------|
| `EXPO_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key (public — RLS is the real guard) |
| `EXPO_PUBLIC_SITE_URL` | Public web origin for auth redirect fallback |
| `EXPO_PUBLIC_API_BASE_URL` | Public web origin for server API calls from native builds |

### Server (never `EXPO_PUBLIC_*`, never commit to source control)

| Variable | Used by | Description |
|----------|---------|-------------|
| `SQUARE_ACCESS_TOKEN` | `api/square/` | Square access token with catalog + order scopes |
| `SQUARE_ENVIRONMENT` | `api/square/` | `sandbox` or `production` |
| `SQUARE_LOCATION_ARCADE_BAR_ID` | `api/square/` | Square location ID for Arcade Bar |
| `SQUARE_LOCATION_VINYL_HALL_ID` | `api/square/` | Square location ID for Vinyl Hall |
| `SQUARE_LOCATION_ID` | `api/square/` | Optional fallback location ID |
| `SQUARE_VERSION` | `api/square/` | Square API version (e.g., `2026-05-20`) |
| `SQUARE_REFERENCE_PREFIX` | `api/square/` | Optional prefix for order reference IDs |
| `SQUARE_CURRENCY` | `api/square/` | Currency code, defaults to `USD` |
| `SQUARE_CHECKOUT_REDIRECT_URL` | `api/square/` | URL Square redirects to after payment |
| `SQUARE_WEBHOOK_SIGNATURE_KEY` | `api/square/webhook.ts` | Square webhook signature key |
| `SQUARE_WEBHOOK_NOTIFICATION_URL` | `api/square/webhook.ts` | Exact webhook URL configured in Square |
| `APP_ALLOWED_ORIGINS` | Vercel API + Edge Functions | Comma-separated production browser origins allowed by CORS |
| `UPSTASH_REDIS_REST_URL` | `api/_ratelimit.ts` | Upstash Redis URL for API rate limiting |
| `UPSTASH_REDIS_REST_TOKEN` | `api/_ratelimit.ts` | Upstash Redis token |
| `IS_PRODUCTION` | `api/_ratelimit.ts`, Edge Functions | Set to `true` in production to enable fail-closed behavior |

### Supabase Edge Function secrets (set via Dashboard → Settings → Secrets)

| Variable | Used by | Description |
|----------|---------|-------------|
| `SUPABASE_SERVICE_ROLE_KEY` | All Edge Functions | Service role key (auto-injected by Supabase) |
| `AWS_ACCESS_KEY_ID` | `moderate-image` | AWS credentials for Rekognition |
| `AWS_SECRET_ACCESS_KEY` | `moderate-image` | AWS credentials for Rekognition |
| `AWS_REGION` | `moderate-image` | AWS region (e.g., `us-east-1`) |
| `OPENAI_API_KEY` | `moderate-text` | OpenAI API key for text moderation |
| `IS_PRODUCTION` | `moderate-image`, `moderate-text` | Set to `true` to enable fail-closed behavior in production |
| `EXPO_PUBLIC_SITE_URL` | Edge CORS helper | Canonical production web origin |
| `APP_ALLOWED_ORIGINS` | Edge CORS helper | Additional allowed browser origins |
| `SLACK_WEBHOOK_URL` | `notify-admin` (optional) | Slack webhook for critical security event alerts |

---

## Project Structure

```
src/
  app/           Expo Router screens (file-based routing)
  components/    Shared UI components
  context/       React contexts (admin, cart, location)
  hooks/         Custom hooks (auth, theme, color-scheme)
  constants/     Theme tokens
lib/
  supabase.ts    Supabase client
  pick-image.ts  Image picker helpers
  compress-image.ts  Client-side image compression
scripts/
  seed-games.sql
  seed-menu.sql
  seed-admin-policies.sql
  rls-policies.sql
```
