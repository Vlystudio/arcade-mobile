# ArcadeTracker — Mobile App

React Native (Expo SDK 55) arcade venue companion app backed by Supabase (PostgreSQL + Auth + Storage + RLS).

## Features

| Screen | What it does |
|--------|-------------|
| **Feed** | Social posts, score highlights, likes, following/followers |
| **Games** | Leaderboard, QR lane check-in, score submission with photo proof, Trivia Night |
| **Teams** | Create/join teams, team chat |
| **Tournaments** | Request, manage & join tournaments; owner controls; podium tracking |
| **Food** | In-app menu with cart and order flow |
| **Profile** | Stats, tournament history, follow graph |
| **Admin** | Score review queue, health dashboard, tournament management |

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

Then grant yourself admin access:
```sql
UPDATE profiles
SET is_admin = true
WHERE id = (SELECT id FROM auth.users WHERE email = 'your@email.com');
```

### 4. Supabase Storage
Create two **public** buckets in the Supabase dashboard:
- `post-photos` — feed post images
- `avatars` — profile pictures

For each bucket, add Storage RLS policies (paste into SQL Editor):
```sql
-- post-photos: users can upload to their own folder, anyone can read
CREATE POLICY "Users upload own photos" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'post-photos'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );
CREATE POLICY "Public read post-photos" ON storage.objects
  FOR SELECT USING (bucket_id = 'post-photos');
CREATE POLICY "Users delete own photos" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'post-photos'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );
```

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
Lane QR tokens are static secrets. The app enforces:
1. Only one active check-in per user at a time (client + RLS).
2. Rate-limit: 30-minute cooldown before re-checking into the same lane.
3. Test-lane buttons (`__DEV__` only) are hidden in production builds.

### Score submission
Score inserts are routed through `rpc_submit_score` (SECURITY DEFINER). The RPC:
- Always sets `user_id = auth.uid()` and `status = 'pending'` server-side (cannot be spoofed by the client)
- Enforces score range 0–9,999,999
- Validates `check_in_id` ownership
- Rate-limits to 20 submissions per user per hour

### Admin writes
All admin-only mutations use SECURITY DEFINER RPCs that call `is_admin()` server-side:
- `rpc_admin_review_score` — approve/deny scores
- `rpc_admin_update_forum_status` — approve/reject forum posts
- `rpc_admin_approve_tournament` / `rpc_admin_deny_tournament` — tournament requests
- `rpc_admin_set_tournament_status` — tournament lifecycle
- `rpc_admin_save_placements` — tournament results
- `rpc_admin_delete_team` — team deletion
- `rpc_admin_create_first_friday` — official events

Every admin RPC writes to `admin_audit_log` for traceability.

### Rate limiting
BEFORE INSERT triggers on `posts` (10/h), `messages` (60/min), `team_messages` (60/min), `forums` (5/h), and `team_requests` (10/day) call `check_and_log_rate_limit()` which raises an exception if the limit is exceeded. The `rate_limit_log` table is cleaned up automatically.

### Venue isolation
`venue_admins` table allows per-venue admin scoping. `is_venue_admin(venue_id)` returns true for global admins or explicit venue-admin entries.

### Square / payments
Square prices are **never derived from the client**. The server-side `/api/square/orders` route fetches prices directly from the Square Catalog API using `SQUARE_ACCESS_TOKEN`. The client only sends variation IDs; the server resolves prices and creates the order. A client cannot submit an arbitrary amount.

### Security testing checklist
Run these checks after every migration:

```sql
-- 1. Verify check_ins blocks direct insert (should fail)
-- Run as anon or a regular user:
INSERT INTO check_ins (user_id, lane_id, status) VALUES (auth.uid(), '<lane_id>', 'active');
-- Expected: RLS policy violation

-- 2. Verify score status cannot be set to 'approved' on insert (should fail)
INSERT INTO scores (user_id, game_id, score, status) VALUES (auth.uid(), '<game_id>', 100, 'approved');
-- Expected: RLS policy violation (status must be 'pending')

-- 3. Verify non-admin cannot approve a forum post (should fail)
SELECT rpc_admin_update_forum_status('<forum_id>', 'approved');
-- Expected: {"error":"unauthorized"}

-- 4. Verify username constraint (should fail)
UPDATE profiles SET username = 'a' WHERE id = auth.uid();
-- Expected: constraint violation (length < 3)

-- 5. Verify score range constraint (should fail via RPC)
SELECT rpc_submit_score(null, null, null, null, -1, null);
-- Expected: {"error":"invalid_score"}

-- 6. Verify is_admin cannot be self-escalated (should fail)
UPDATE profiles SET is_admin = true WHERE id = auth.uid();
-- Expected: trigger exception (guard_role_escalation_trigger)
```

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

| Variable | Description |
|----------|-------------|
| `EXPO_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key (public, safe to expose) |
| `EXPO_PUBLIC_SITE_URL` | Public web origin used as an auth email redirect fallback |
| `EXPO_PUBLIC_API_BASE_URL` | Public web origin used by native builds for server API calls |
| `SQUARE_ACCESS_TOKEN` | Server-only Square access token with catalog/order scopes |
| `SQUARE_ENVIRONMENT` | `sandbox` for Square Sandbox, omit or use production env vars for live |
| `SQUARE_LOCATION_ARCADE_BAR_ID` | Square location ID for Arcade Bar |
| `SQUARE_LOCATION_VINYL_HALL_ID` | Square location ID for Vinyl Hall |
| `SQUARE_LOCATION_ID` | Optional fallback Square location ID |
| `SQUARE_VERSION` | Square API version, defaults to `2026-05-20` |
| `SQUARE_REFERENCE_PREFIX` | Optional prefix for Square order reference IDs |
| `SQUARE_CURRENCY` | Currency for fallback non-catalog checkout items, defaults to `USD` |
| `SQUARE_CHECKOUT_REDIRECT_URL` | Optional URL Square sends customers to after payment |

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
