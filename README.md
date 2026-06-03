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
```
The anon key is safe to ship in a mobile app — it can only do what your RLS policies allow.

### 3. Database setup
Run these SQL scripts **in order** in the Supabase SQL Editor:

| Order | File | Purpose |
|-------|------|---------|
| 1 | `scripts/seed-games.sql` | Game catalog and base table definitions |
| 2 | `scripts/seed-menu.sql` | Food menu seed data |
| 3 | `scripts/seed-admin-policies.sql` | `is_admin()` helper function |
| 4 | `scripts/rls-policies.sql` | Full Row Level Security for every table |

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
