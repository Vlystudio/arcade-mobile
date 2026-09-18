# Review fixes - 18 September 2026

Implemented after the [project review](project-review-2026-09-18.md) of commit `35fc973`. The database, Edge Functions, API and web changes were deployed on 18 September 2026; see [release status](release-2026-09-18.md) for native release status and live verification.

## Implemented changes

| Review findings | Changes |
| --- | --- |
| 1, 13, 14 | Authenticated image moderation derives authorized destinations, rejects arbitrary URLs/cross-owner paths, bounds downloads, uses the AWS SDK, and fails closed on provider errors. Public media ownership is recorded for cleanup. |
| 2 | Registrations must start unpaid with no payment-controlled fields. Creating a team consumes one paid entitlement under a row lock. |
| 3 | Escape print markup, remove print-window opener access, and neutralize spreadsheet formula prefixes in CSV exports. |
| 4, 15 | Participation/admin MFA checks; complete nine-ball validation before writes; authorized, idempotent completion; consistent match/session locks. Remove the legacy finalization overload. |
| 5, 6 | Handle Square's actual payment/order event shapes, retrieve authoritative provider data, verify merchant/location/amount/currency, persist checkout mappings, and apply event claiming plus business effects in one database transaction. Preserve completed state against older events and freeze existing checkout prices. |
| 7 | Durable per-account offline queues, serialized storage mutations, revision-aware replay, visible retained errors, native connectivity/foreground retries, legacy-entry recovery, and atomic submit-plus-complete replay. |
| 8, 23 | Align native dependencies to Expo SDK 55, pin the patched Supabase SDK, update compatible dependencies, standardize Node 22, and use fingerprint-based native runtimes. Add compatibility/regression checks to CI. |
| 9, 10 | Native persistent auth storage and refresh lifecycle; retain valid sessions during transport failures; reject stale auth responses. |
| 11, 12 | Private conversation-scoped message images, refreshed signed URLs, native ArrayBuffer uploads, and paginated history. New messages are server-readable for moderation; the UI accurately says so. Legacy encrypted messages remain readable where original device keys are available. |
| 16 | Batch public-profile reads for rosters/comparisons instead of relying on private profile rows. |
| 17, 18 | Shared native API URL and verified resource authorization for registrations, AI services and substitution pushes; database quotas and AI request deduplication/cache. |
| 19 | Ordinary sign-out buttons use push cleanup. Serialize device registration/deletion, retry failures, and require a persistent device secret for account reassignment. |
| 20 | Server verifies the actual password and existing MFA before deletion. Paginated owned-media inventory, resumable cleanup, checked storage/database failures, personal-data cleanup and refresh-session revocation. |
| 21 | Real browser Sentry in a separate async chunk; queue startup errors and omit sensitive request/user context. |
| 24 | Compute team maxima over all completed sessions, aggregate recap statistics in SQL, and paginate message history. |
| 25 | Role hierarchy checks protect both existing and requested roles, require MFA, synchronize the admin flag, and audit changes. A trigger also protects direct updates. |
| 26 | MFA auto-submit uses the visible six-digit value and prevents concurrent verification. |
| 27 | Persist carts/checkout attempts by account/location; reuse checkout identity, retain cancelled/failed carts, clear only after provider-confirmed payment, and reset native loading state. |
| 28 | Playback advancement requires administrator MFA and serialized queue transitions. Anonymous viewing stays separate; unenrolled administrators are sent to MFA setup. |

### Finding 22 is partially resolved

The repository now has Supabase CLI configuration, an ordered security migration, previously missing match/adjustment/username RPC definitions, and PostgreSQL tests. Public email/username lookup RPCs are revoked; password sign-in resolves usernames only on the server.

Production was paused during the initial review. During release it was restored, backed up, and copied to an isolated local PostgreSQL instance. The migration and runtime SQL smoke checks passed against that copy after preserving the existing optional admin-adjustment argument. The public schema snapshot is now in `supabase/baselines/20260918_public.sql`, and generated `Database` types are in `lib/database.types.ts`. Completing a fresh-environment bootstrap (managed schemas, extensions and storage setup) and converting existing loose query types remain follow-up work. The test fixture is **not a production baseline**.

## Performance

- Feed pages use one aggregate RPC instead of up to 11 requests and render through a paginated FlatList.
- Batch roster lookups; aggregate recaps in PostgreSQL; cache/deduplicate identical authorized AI work.
- Android-only exported assets: **10,962,023 -> 7,346,399 bytes**, about **33% smaller**, through direct icon imports. Framework Material Symbols weights remain.
- Android Hermes bundle: about **9.4 MB -> 9.01 MB**. iOS export: **8.92 MB**.
- Web common chunk: about **2.01 MB -> 1.7 MB**, with monitoring in a separate async chunk. Total web JavaScript includes the restored monitoring SDK; no lower total transfer or startup-latency claim is made.
- Admin-screen extraction and device render profiling remain follow-up optimization work.

## Validation

- **43 passing tests under Node 22**: actual source modules with service mocks, plus the complete upgrade executed in PGlite/PostgreSQL. Coverage includes legacy function signatures, authorization failures, payment rollback/retry, duplicate completion, old-score rankings, over-1,000-row aggregates, queue races, device reassignment, moderation failure and multi-page deletion.
- TypeScript, the three changed Edge Function Deno checks, and Expo SDK compatibility: pass.
- ESLint: 0 errors, 107 remaining warnings (review baseline: 120).
- Production dependency audit: 0 high/critical; 14 moderate dependency entries remain.
- Web export (62 routes), Android Hermes export, and iOS Hermes export: pass with placeholder public configuration.
- Browser: desktop/mobile login renders; Forgot username fills email sign-in without exposing an identity mapping; no runtime errors observed.

Run `npm test`, `npx tsc --noEmit`, `npm run lint`, and `npm run check:expo` with Node 22. The old reproduction harness is historical bug evidence, not the regression suite.

These checks do not establish live schema/RLS compatibility, real Square sandbox completion, AWS moderation, push delivery, Sentry ingestion, or camera/media behavior on devices. Native exports are JavaScript/Hermes checks, not Xcode/Gradle builds.

## Coordinated rollout

1. Identify the intended Supabase project and review its real schema, signatures, policies, storage and migration history. Capture an earlier baseline and generate database types; reconcile drift in staging.
2. Test/apply `supabase/migrations/20260918152047_project_review_security.sql` against that baseline. It requires existing application tables/helpers and fails on unexpected dependencies instead of cascading drops.
3. Deploy `password-login`, `moderate-image`, and `delete-account` with shared modules/configuration. These handlers verify credentials themselves. Verify allowed origins, Supabase service credentials and AWS credentials.
4. Deploy changed API handlers/web app against the migrated backend. Verify Square credentials, allowed locations, signature key and exact webhook URL. Test sandbox completion, retry and cancellation.
5. Reconcile historical data: bind paid registrations to teams already purchased; recover pending checkout snapshots by reopening checkout through the new API; replay previously acknowledged-but-unprocessed Square events after verifying provider state. Audit legacy message-media paths and team-photo ownership that cannot be inferred safely.
6. Build/release new Android/iOS binaries. The migration retires old push-token rows without device secrets; updated clients register again on sign-in/foreground. Coordinate release because older clients lack the required authorization/RPC contracts.
7. Verify auth restart/refresh, airplane-mode scoring, shared-device pushes, photos, checkout return, MFA and deletion with staging accounts. Confirm a synthetic Sentry event in preview.

The later deployment and verification are recorded in [release status](release-2026-09-18.md). No real payment, push send or account deletion was used as a release test.
