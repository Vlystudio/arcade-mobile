# Project review — 18 September 2026

> Historical pre-fix assessment of commit 35fc973. See [implementation and validation results](review-fixes-2026-09-18.md) for the current working tree. The old reproduction harness below asserts original bugs; use npm test to validate the fixes.

The project builds, but several authorization, payment, and data-loss defects should be fixed before expanding the beta. The most consequential problems are in the connections between the client, server handlers, and database policies. Passing TypeScript and lint does not verify those contracts.

Reviewed repository: `D:\ArcadeApp\mobile`, starting at commit `35fc973`. The inventory covers 250 TypeScript/TSX/SQL files, approximately 67,093 lines, including 77 SQL scripts. The review combined repository-wide searches with detailed inspection of authentication, payments, moderation, scoring, messaging, administration, storage, deployment configuration, and major data-loading paths. This is a project-wide static review with targeted reproductions, not a claim that every screen has been exercised on a device. Findings concern the current code; authorship was not established.

## Verification and limits

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | Pass |
| `npx expo lint` | 0 errors, 120 warnings |
| Expo production web export | Pass using placeholder public configuration |
| Expo Android JavaScript/Hermes export | Pass; 9.4 MB bundle and 10,962,023 bytes of exported assets |
| `npx expo install --check` | Fails: 20 compatibility/version mismatches |
| `npm audit --omit=dev --json` | 30 affected dependency entries: 12 high, 17 moderate, 1 low |
| Local failure reproductions against actual source with mocked services | 8 reproduced |

The Android export is not a Gradle build or an emulator/device test. No iOS native build, real checkout, real email, push send, moderation-provider call, or database mutation was performed. The connected Supabase project named `arcade-score-app` was reported `INACTIVE`; the other project reference in EAS configuration was not returned by the connector. Consequently, deployed policies, functions, buckets, secrets, and migration order remain unverified. SQL findings describe the checked-in definitions and apply where those definitions are deployed.

The exact [Expo SDK 55 reference](https://docs.expo.dev/versions/v55.0.0/) was read before creating review artifacts. An initial Expo check encountered the machine's certificate-trust issue; it completed with Node's system CA support enabled, without disabling TLS verification.

Application source, dependencies, and deployed services were left unchanged. This review adds this report and the files in [review-evidence](review-evidence).

The local harness is [reproduce.cjs](review-evidence/reproduce.cjs); results are [reproductions.json](review-evidence/reproductions.json), with check totals in [check-summary.json](review-evidence/check-summary.json). Run it from the repository with:

```powershell
node docs/review-evidence/reproduce.cjs
```

The harness makes no external requests: database, storage, AWS, and fetch calls are mocked. Its assertions deliberately confirm the current bugs. It is investigation evidence, not a passing regression suite for the corrected behavior; invert those expectations when implementing fixes.

## Findings and repairs

P1 means fix before broader release because it affects authorization, payments, sensitive data, or a core flow. P2 means a concrete reliability or operational issue. P3 means a smaller usability defect.

### 1. P1 — Image moderation gives callers control over privileged storage writes

**Evidence:** [moderate-image/index.ts:92](../supabase/functions/moderate-image/index.ts#L92), publication at line 254, and record updates at lines 202–209 and 304–307. The function accepts source/target buckets, paths, and record IDs, then uses the service-role client without verifying the caller or ownership. Publication uses `upsert: true` and deletes the caller-specified source object.

**Impact:** A caller able to invoke this function can overwrite or delete another user's files or affect another user's moderation state. Gateway JWT verification alone would not bind those paths to the caller. The local reproduction supplied no Authorization header and observed a successful privileged overwrite and deletion through the real handler; actual gateway exposure remains unverified.

**Fix:** Authenticate a real user; derive source and destination from an owned quarantine object and an authorized record. Allowlist buckets and operations, validate team membership/captain permissions where applicable, and never accept an arbitrary record/path as authorization. Use the caller's access context for ownership checks before invoking privileged storage operations.

**Verify:** User A must be unable to publish, delete, replace, or hold user B's content; anonymous callers must be rejected. Test both approved and rejected images.

### 2. P1 — Users can insert an already-paid registration

**Evidence:** [team-registrations.sql:39](../scripts/team-registrations.sql#L39) checks only `user_id = auth.uid()` on insert. [team-create-enforcement.sql:31](../scripts/team-create-enforcement.sql#L31) subsequently trusts `status = 'paid'`.

**Impact:** A user can bypass the paid team-creation gate by inserting their own registration with a paid status. Column defaults do not prevent supplying a different value.

**Fix:** Create registrations through an RPC that hardcodes the initial status and excludes payment-controlled fields. Alternatively, constrain the insert policy and column privileges to enforce `pending_payment` with null payment IDs and `paid_at`. Only verified payment processing or an authorized, audited admin action should change payment state. Bind any team-creation entitlement to its intended team to prevent unlimited reuse.

**Verify:** Attempt self-owned inserts with `paid`, `refunded`, fabricated order IDs, and fabricated payment timestamps. All must fail for ordinary users.

### 3. P1 — Printing standings exposes a stored HTML/script injection path

**Evidence:** [leagues.tsx:250](../src/app/leagues.tsx#L250) interpolates team names into markup passed to `window.open('', '_blank').document.write(...)`. The [team-name validator](../lib/validation.ts#L81) and SQL constraint only limit length.

**Impact:** A specially named team can inject active HTML into the viewer's same-origin print window. The configured CSP permits inline scripts. An administrator printing a schedule is a particularly sensitive case. A local reproduction confirmed that accepted user input reaches the real print function's HTML unescaped; no browser exploit was executed.

**Fix:** Build the print document with DOM `textContent`, or escape every dynamic HTML value with a proven helper. Remove opener access where possible and tighten CSP after resolving the injection. Quoting CSV fields alone also does not neutralize spreadsheet formula injection in the adjacent CSV exporter.

**Verify:** Team/season names containing angle brackets, quotes, ampersands, and formula prefixes must render as literal text in exports.

### 4. P1 — Any signed-in user can force-finalize another league match

**Evidence:** [skeeball-hundo-week.sql:97](../scripts/skeeball-hundo-week.sql#L97) exposes `rpc_skeeball_finalize_match(uuid, boolean)` to `authenticated` at line 191. Its `p_force = true` branch has no caller, role, venue, or MFA check and abandons active sessions. The earlier definition in `skeeball-finalize-fix.sql` also needs review.

**Impact:** An unrelated signed-in user can prematurely rank a match with at least two completed sessions and abandon other teams' ongoing games.

**Fix:** Move forced finalization into a private/internal helper called only by an MFA-protected, venue-authorized admin RPC. Public non-forced finalization should validate permitted participation and lock the match while deciding whether it is complete.

**Verify:** Unrelated users and non-admin participants must fail when requesting `p_force = true`; authorized admins should succeed only within their scope.

### 5. P1 — Real Square events do not auto-confirm league registrations

**Evidence:** [webhook.ts:85](../api/square/webhook.ts#L85) expects `data.object.order`, then requires `order.reference_id` at line 125. Square's documented [order.updated event](https://developer.squareup.com/reference/square/orders-api/webhooks/order.updated) contains `data.object.order_updated`. Its [payment.updated event](https://developer.squareup.com/reference/square/payments-api/webhooks/payment.updated) contains a payment and order ID, not the full order/reference expected here.

**Impact:** A completed payment can return HTTP 200 while the registration stays `pending_payment`. Both documented event shapes reproduced this in the local handler tests.

**Fix:** Normalize the supported event types. Resolve the registration through the stored `square_order_id`, or retrieve the authoritative Square order when needed. Verify the merchant/location, expected amount/currency, and payment completion before confirming. Persist the checkout-to-registration mapping successfully before returning a usable checkout URL.

**Verify:** Use real Square sandbox payload fixtures for created, updated, completed, and duplicate events, including their actual object names.

### 6. P1 — Webhook deduplication permanently discards failed processing

**Evidence:** [webhook.ts:68](../api/square/webhook.ts#L68) records the event before processing its effects. A duplicate ID immediately returns success at line 76. A later database failure returns 500 without undoing or recording a retryable event state.

**Impact:** The provider retries an event that failed, but the retry is discarded as already processed. The reproduction returned 500, then 200/`duplicate: true`, with exactly one processing attempt. Registration-update errors are also logged and acknowledged rather than retried.

**Fix:** Use a transactional database operation for event claiming plus all database effects, or persist explicit pending/processing/completed states with retry recovery. Enforce monotonic payment state/version handling. Normalize identity consistently: the current lookup chooses payment ID when present, but the table also has a unique order-ID index, so order-first/payment-later processing can collide rather than update.

**Verify:** Inject a failure after recording an event, retry it, and prove the business update eventually happens exactly once. Include out-of-order events and an existing row located by order ID.

### 7. P1 — The offline score queue can silently lose games

**Evidence:** [offline-queue.ts:48](../lib/offline-queue.ts#L48), startup in [_layout.tsx:67](../src/app/_layout.tsx#L67), and the offline navigation branch in [skeeball-tracker.tsx:502](../src/app/skeeball-tracker.tsx#L502).

**Impact:** Server rejections such as unauthenticated/unauthorized are removed and counted as successes. A concurrent `queueSubmit()` can be overwritten by a flush's final stale `write(remaining)`. Both losses were reproduced. Initialization runs before auth is ready; the queue is not user-scoped. Native reconnects have no connectivity listener, and a successful replay only submits balls—it does not call session completion after the tracker has navigated away. Storage-write errors are swallowed even though the UI says the scores were saved.

**Fix:** Use a serialized, durable outbox scoped to user ID. Start replay only after session restoration and retry on native connectivity/foreground events. Remove entries only after explicit success or verified idempotent completion. Retain terminal failures visibly for recovery. Make submission plus completion an idempotent server operation, and surface failures to save locally.

**Verify:** Cold start before login, different-account login, native airplane-mode recovery, concurrent enqueue/flush, temporary server rejection, and recovery after the tracker unmounts.

### 8. P1 — The native dependency set mixes Expo SDK generations

**Evidence:** [package.json:32](../package.json#L32) uses `expo-image-manipulator ^56.0.16`; line 35 uses `expo-media-library ^56.0.7`, while Expo is 55. The compatibility checker reported 20 mismatches, including AsyncStorage, Sentry, FlashList, view-shot, and several Expo patch versions. The versioned [ImageManipulator docs](https://docs.expo.dev/versions/v55.0.0/sdk/imagemanipulator/) and [MediaLibrary docs](https://docs.expo.dev/versions/v55.0.0/sdk/media-library/) identify SDK 55 package versions.

**Impact:** Successful JavaScript bundling does not establish compatibility with Expo Go or the installed native binary. The two SDK 56 native modules are the clearest mismatches; some third-party deviations may be intentional and need individual validation.

**Fix:** Align the native package set with SDK 55 using `expo install`, review API changes where a major version is changed, and rebuild development/production binaries. Add `expo install --check` to CI. Use a tested LTS Node version consistently; local verification currently ran on Node 25 while CI uses Node 22.

**Verify:** Camera capture, image manipulation, screenshot saving, push registration, auth persistence, and scrolling on real Android/iOS development builds. An OTA update alone cannot replace native dependencies.

### 9. P1 — Native login sessions are not persisted

**Evidence:** [lib/supabase.ts:14](../lib/supabase.ts#L14) calls `createClient` without a native storage adapter. The installed auth client falls back to memory when browser localStorage is unavailable. The app stores the Remember Me preference separately, but not the Supabase session.

**Impact:** A native process restart loses the login session despite Remember Me. This undermines recovery of queued scores as well.

**Fix:** Configure a persistent native auth storage adapter and explicit refresh lifecycle handling. Follow Supabase's [React Native authentication setup](https://supabase.com/docs/guides/auth/quickstarts/react-native), while retaining the web redirect behavior needed by this app. Choose encrypted storage where the threat model requires it.

**Verify:** Sign in on a device, kill the process, reopen, and refresh the access token. Check explicit sign-out and inactivity expiration separately.

### 10. P2 — A transient network failure makes the UI forget the signed-in user

**Evidence:** [auth-context.tsx:70](../src/context/auth-context.tsx#L70) clears React user/session state for any `getUser()` error. This runs every minute and on foregrounding; it does not distinguish invalid credentials from a failed network request or clear the Supabase session consistently.

**Impact:** Weak venue Wi-Fi can send a valid user back to authentication, leaving the context and underlying client disagreeing about whether they are signed in.

**Fix:** Preserve the last valid session on transport/server failures, expose an offline state, and sign out only on definitive auth invalidation. Catch persistence/verification rejections and avoid racing stale verification results against a new login.

**Verify:** Disconnect a signed-in device for more than a minute, reconnect, and confirm the same session and screen remain usable.

### 11. P1 — Direct-message photo uploads contradict the storage policy

**Evidence:** [chat-conversation.tsx:252](../src/app/chat-conversation.tsx#L252) uploads `userId/file.jpg` and then calls `getPublicUrl`. [storage-security.sql:162](../scripts/storage-security.sql#L162) requires `conversationId/senderId/file.jpg`; the README specifies a private bucket.

**Impact:** The intended policy rejects the upload. If policies are loosened to make uploads work, the public URL still does not make a private object readable. Changing the bucket to public would defeat private-message access control.

**Fix:** Adopt the conversation-scoped path, store the path in the message, and issue short-lived signed URLs only for authorized participants. Handle expiration on reload. Use ArrayBuffer/base64-derived upload data consistently with the other native upload helpers rather than relying on a React Native Blob.

**Verify:** Sender and recipient can view the photo after reload; an unrelated user cannot fetch or sign it.

### 12. P1 — Chat's “End-to-end encrypted” label is misleading

**Evidence:** [chat-conversation.tsx:229](../src/app/chat-conversation.tsx#L229) writes every outgoing message in plaintext to `conversations.last_message`, including messages whose encrypted body was stored successfully. Plaintext is also sent to server-side moderation, and sending falls back to plaintext if keys are unavailable. The label appears at line 321.

**Impact:** The server can read content the UI describes as end-to-end encrypted. Keys are device-local, yet one public key is overwritten per user, so a second device also creates decryption/history problems.

**Fix:** Decide on the intended privacy model. For genuinely end-to-end encrypted chat, encrypt previews and attachments, remove server plaintext paths, reject silent plaintext fallback, and design multi-device key handling and secure key storage. If server-side moderation/readability is required, remove the E2E claim and use accurate messaging.

**Verify:** Inspect stored rows and outgoing requests for a known test message; no plaintext should reach the server if the E2E label remains. Test two devices per account.

### 13. P1 — Vercel image moderation generates malformed AWS signatures and allows failures

**Evidence:** [api/moderation/_image.ts:44](../api/moderation/_image.ts#L44) appends `00Z` to a timestamp that already includes seconds and `Z`. The reproduced value was `20260918T133758Z00Z`. The error handler returns `flagged: false`, and chat accepts it.

**Impact:** The signing format is invalid, while failures appear to the client as permitted content. This is a separate implementation from the Supabase moderation function and does not share its fail-closed behavior.

**Fix:** Use the AWS SDK signer or a verified SigV4 implementation, and represent provider failures as unavailable/pending rather than approved. Consolidate moderation behavior so different posting surfaces do not have conflicting rules. The expected date format is documented in [AWS SigV4](https://docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-header-based-auth.html).

**Verify:** A fixed timestamp produces `YYYYMMDDTHHMMSSZ`; AWS rejects neither date nor signature; provider timeouts do not approve content.

### 14. P1 — Both image-moderation endpoints fetch arbitrary caller-supplied URLs

**Evidence:** [api/moderation/_image.ts:100](../api/moderation/_image.ts#L100) and [moderate-image/index.ts:101](../supabase/functions/moderate-image/index.ts#L101) fetch the supplied URL and buffer its entire body without a URL allowlist, redirect policy, timeout, or streaming size cap.

**Impact:** This is an SSRF and resource-exhaustion path. The precise network resources reachable depend on hosting restrictions; those were not probed. Public rate limiting and CORS do not establish authorization over the fetched resource.

**Fix:** Accept an owned storage path and download through Storage instead of fetching arbitrary URLs. If remote URLs are necessary, allowlist exact hosts/paths, validate every redirect, block private/internal destinations, and cap duration and bytes while reading.

**Verify:** Foreign hosts, redirects to internal addresses, unsupported protocols, oversized responses, and slow responses are rejected without initiating an unrestricted fetch.

### 15. P1 — Score submission and finalization lack complete invariants

**Evidence:** [skeeball-rls-fix.sql:55](../scripts/skeeball-rls-fix.sql#L55) checks that the caller is in the session, but does not verify each submitted player's membership, ball-number range, or per-player allocation. [skeeball-qr-lane-checkin.sql:367](../scripts/skeeball-qr-lane-checkin.sql#L367) finalizes based on total row count alone.

**Impact:** Valid ring values can be assigned to the wrong player or impossible ball positions. A later invalid item returns an error after earlier items have been written, rather than rolling the whole operation back. Finalization reads the session without a lock; concurrent callers can both reach the score-insert step even when only one wins the status update.

**Fix:** Validate the entire payload against the locked session roster before writing. Enforce unique, bounded ball positions and the required player allocation. Use an atomic, idempotent submission/completion transaction, with a uniqueness key for the resulting player/session scores. An error must roll back the payload.

**Verify:** Foreign players, duplicate/out-of-range balls, mixed valid/invalid payloads, submissions racing completion, and simultaneous completion from multiple teammates.

### 16. P2 — Profile lockdown breaks remaining roster/profile joins

**Evidence:** [profiles-lockdown.sql:65](../scripts/profiles-lockdown.sql#L65) removes general profile reads. [team-detail.tsx:224](../src/app/team-detail.tsx#L224), `skeeball-tracker.tsx:243`, `skeeball-compare.tsx:71`, and several tournament/team paths still embed `profiles(username, avatar_url)`.

**Impact:** Ordinary users receive null profiles for other members and see “Unknown” or blank avatars. Admins may not notice because their policy permits all profile reads.

**Fix:** Resolve public identity fields through `public_profiles` in a batched lookup, or use a narrowly scoped roster RPC. Keep private profile fields protected.

**Verify:** Test rosters, captain transfer, tournament winners, and comparisons as a normal user with several other members, including private profiles.

### 17. P2 — Native paid registration uses the wrong API environment variable

**Evidence:** [team-registration.tsx:140](../src/app/team-registration.tsx#L140) reads `EXPO_PUBLIC_API_URL`. The shared [API helper](../lib/api-base.ts#L8), documentation, and other callers use `EXPO_PUBLIC_API_BASE_URL`.

**Impact:** With the documented native configuration, this request becomes `/api/square/registration`, which has no browser origin to resolve against on native. Web can mask the error by accepting the relative URL.

**Fix:** Use the shared API URL helper and validate required native configuration at startup/build time.

**Verify:** A native build with only the documented environment variables can open the registration checkout.

### 18. P1 — Several server endpoints lack resource-level authorization

**Evidence:** [api/skeeball/_coach.ts:24](../api/skeeball/_coach.ts#L24) and [_recap.ts:23](../api/skeeball/_recap.ts#L23) use service-role data and paid AI calls without verifying a user. [api/push/league.ts:104](../api/push/league.ts#L104) authenticates callers but lets any user request sub notifications for an arbitrary team; `sub_filled` also lacks caller authorization and event deduplication. [square/registration.ts:26](../api/square/registration.ts#L26) reads/modifies a registration by ID without proving it belongs to the requester.

**Impact:** Users or unauthenticated callers can invoke privileged operations outside the resources they own, consume paid services, or generate unsolicited team notifications. CORS allows requests without an Origin header and does not replace authentication.

**Fix:** Verify JWTs, enforce membership/captain/admin/owner rules per operation, and bind work to an existing authorized database event. Add per-user quotas, caching for identical AI inputs, and notification deduplication. Check registration ownership before generating checkout links.

**Verify:** User A cannot operate on user/team B's resources. Requests without credentials fail before service-role reads or paid calls.

### 19. P2 — Push tokens remain attached to the previous account on a shared device

**Evidence:** [src/lib/push.ts:55](../src/lib/push.ts#L55) upserts by token, ignores the returned error, and marks registration complete. [push-notifications.sql](../scripts/push-notifications.sql) allows updates only by the existing row's user. Sign-out does not remove the old token.

**Impact:** After A signs out and B signs in, B cannot update A's token row through RLS. The client treats that failure as success, so the device can keep receiving A's league notifications while B receives none.

**Fix:** Deregister the device token while A is still authenticated, reset the local registration cache, and handle all database errors. Provide a deliberate server-side device reassignment mechanism where necessary rather than weakening token ownership globally.

**Verify:** A → sign out → B on one physical device; notifications must follow the active account and registration failures must be retried.

### 20. P1 — Account deletion has incomplete cleanup and a weak reauthentication check

**Evidence:** [delete-account/index.ts:52](../supabase/functions/delete-account/index.ts#L52) treats a recent JWT `iat` as recent password verification. A refresh can also produce a recently issued token. Cleanup at line 70 lists one user folder once; Storage listings are not recursive and are paginated. Message media is conversation-prefixed, quarantine has nested target-bucket folders, and `team-photos` is not covered. Several database/storage error results are ignored.

**Impact:** The server does not prove the recent credential confirmation promised by the UI. Deletion can also leave personal media or partially remove content before ultimately failing to delete the auth user. The comment that auth deletion immediately invalidates all access JWTs is not a reliable session-security assumption; see [Supabase user management](https://supabase.com/docs/guides/auth/managing-user-data).

**Fix:** Verify recent authentication from appropriate verified authentication evidence or a dedicated short-lived reauthentication flow, including the intended MFA policy. Enumerate user-owned objects from an explicit inventory with pagination and correct prefixes. Make cleanup resumable, inspect every result, and report success only when the defined deletion/anonymization contract is satisfied. Explicitly handle sessions and retained history.

**Verify:** A refreshed old session cannot bypass reauthentication. Test nested uploads, more than one page of objects, messages, team photos, storage failures, foreign-key failures, and retrying partially completed deletion.

### 21. P2 — Web error reporting is completely disabled

**Evidence:** [metro.config.js:18](../metro.config.js#L18) replaces every web import of `@sentry/react-native` with [sentry-stub.ts](../src/lib/sentry-stub.ts), where initialization and capture functions are no-ops.

**Impact:** The public web app can fail silently even though `reportError` appears to report it and the README calls for web monitoring.

**Fix:** Use a real web-compatible Sentry integration selected by platform. Preserve one reporting interface but provide working native/web implementations; redact sensitive content before reporting.

**Verify:** Trigger a harmless test error in a preview web build and verify it appears in the expected Sentry project with a readable stack.

### 22. P2 — Database setup cannot be reproduced from this repository

**Evidence:** Schema changes are 77 manually ordered scripts, with multiple replacements of important functions and no versioned migration baseline. The documented setup depends on pre-existing base tables. Client/server RPC calls have no checked-in definitions for `get_email_by_username`, `get_username_by_email`, `check_username_available`, `check_email_available`, `rpc_admin_adjust_skeeball_session`, and `rpc_skeeball_get_or_create_match`.

**Impact:** A fresh environment cannot reliably reproduce the current backend, and rerunning an older script can restore weaker behavior. A passing app build cannot detect deployed schema drift. The login lookups additionally return email/username identity mappings before login; their deployed privacy/abuse controls need review because their definitions are missing.

**Fix:** Capture and review the intended schema into ordered Supabase migrations, including grants, policies, triggers, and base tables. Keep seed data separate. Generate database TypeScript types and use `createClient<Database>()`. Run migrations and security/contract tests against an ephemeral database in CI.

**Verify:** A clean database reset plus migrations can support signup/login, paid registration, scoring, and messaging without dashboard-only setup or undocumented SQL.

### 23. P2 — The dependency audit gate currently fails

**Evidence:** The production dependency-tree audit reports 12 high-severity package entries. These include Metro-related packages and transitive build tools such as `image-size`, `js-yaml`, `postcss`, `shell-quote`, and `@xmldom/xmldom`.

**Impact:** The repository's blocking high-severity audit job will fail on this dependency state. These are affected package entries, not 12 independently proven remotely exploitable vulnerabilities in the shipped app; several are build-tool dependencies carried in the production tree.

**Fix:** Update compatible patches and inspect each dependency path and runtime exposure. Align Expo packages first. Avoid `npm audit fix --force`: some reported automatic fixes propose incompatible major changes or downgrades. Re-run the audit, exports, and native smoke tests after a reviewed lockfile update.

**Verify:** The CI audit command passes or has a documented, scoped exception with an owner and expiration.

### 24. P2 — Team high-score rankings only consider the newest 100 sessions

**Evidence:** [leaderboard.tsx:143](../src/app/leaderboard.tsx#L143) fetches completed sessions ordered by newest with `.limit(100)`, then computes each team's maximum client-side.

**Impact:** An older record disappears from the rankings as new games are played, even when it remains the team's real high score. Other unpaginated bulk reads, such as message history and season-wide ball rows in the recap API, can also hit the backend's configured row cap.

**Fix:** Calculate team maxima and ranks in SQL over the complete intended period, then paginate the ranked result. Use explicit pagination for history and aggregate season statistics server-side.

**Verify:** Seed more than 100 sessions with the best score near the beginning; it must remain ranked. Test datasets exceeding the backend row cap.

### 25. P1 — Role management does not protect existing higher-privilege accounts

**Evidence:** [protect-architect-role.sql:16](../scripts/protect-architect-role.sql#L16) checks `is_admin()`, restricts assigning certain new roles, then updates any supplied target at line 32. It does not require MFA or forbid an ordinary admin from demoting an existing owner/architect.

**Impact:** Protecting assignment of `architect` does not protect an architect account from having its role removed by a lower-level administrator.

**Fix:** Validate both the caller's role and the target's current role; require MFA; forbid self-promotion and unauthorized changes to equal/higher roles; record the change in the audit log. Keep the role column and legacy admin flag consistent through one authoritative mechanism.

**Verify:** An admin cannot demote an owner or architect, and stale/AAL1 admin sessions cannot change roles.

### 26. P3 — MFA auto-submit uses the previous input value

**Evidence:** [mfa-verify.tsx:136](../src/app/mfa-verify.tsx#L136) calls `setCode(d)` and schedules the current render's `handleVerify`, which still closes over the old code.

**Impact:** Entering the sixth digit does not reliably submit, or can submit the previous value during replacement. The manual verify action may mask the defect.

**Fix:** Pass the freshly normalized six-digit value into the verification function. Prevent duplicate submissions explicitly.

**Verify:** Typing, pasting, autofill, and replacing a six-digit code each submit exactly the visible value once.

### 27. P2 — Checkout clears the cart before payment and leaves native loading state set

**Evidence:** [food-cart.tsx:64](../src/app/food-cart.tsx#L64) clears the cart before opening Square. `placing` is reset only on failure, not after native `Linking.openURL` succeeds.

**Impact:** Cancelling checkout loses the order selection. Returning on native and adding more items to the same mounted screen can leave checkout disabled as still “Opening Square”. A fresh order ID is also created for each retry rather than retaining an idempotent pending attempt.

**Fix:** Preserve a pending checkout/cart until authoritative payment confirmation or explicit user clearing. Reset launch/loading state in `finally`, and reuse the pending order ID for retries of the same cart. Do not infer payment success merely from returning to the app.

**Verify:** Browser launch failure, cancelled checkout, return on native, and retry after a lost API response.

### 28. P1 — The public karaoke advance RPC bypasses admin skip controls

**Evidence:** [karaoke-schema.sql:59](../scripts/karaoke-schema.sql#L59) defines an unauthenticated `SECURITY DEFINER` advance operation and grants it to `anon` at line 115. Its `p_current_id` can mark any queued/playing row played. The separate skip RPC requires admin and MFA.

**Impact:** Anyone with the public client credentials can advance or skip songs through the public RPC, bypassing the protected admin operation. An anonymous kiosk cannot be distinguished from an arbitrary caller through that grant.

**Fix:** Give the display a scoped kiosk/device credential and authorize queue transitions server-side. Keep public viewing/requesting separate from playback control. Serialize the transition and enforce one playing song.

**Verify:** Public viewers cannot advance, skip, or mark a chosen song played; the paired kiosk can advance only the expected current song.

## Optimizations with measurable value

| Area | Current evidence | Proposed improvement | Measure |
| --- | --- | --- | --- |
| Feed requests | `index.tsx:136` makes up to 11 Supabase requests per feed load, across sequential phases, and downloads individual likes/comments/reactions to count them | A paginated feed RPC or view returning counts and caller state; cache stable identity data | Requests per load, transferred bytes, first usable feed latency |
| Feed rendering | `index.tsx:806` renders up to 50 posts and their images inside one ScrollView; there is no feed pagination | Use FlatList/FlashList with a stable row component, cursor pagination, and image sizing | JS frame time, mounted row count, memory on a midrange Android device |
| Bundle/assets | Android export: 9.4 MB Hermes bundle, roughly 10.96 MB assets, including many icon families and seven Material Symbols weights; web common chunk ~2.01 MB plus entry ~1.04 MB uncompressed | Audit icon/font imports and transitive imports, retain only used fonts/weights, lazy-load optional heavy web features | Export asset list and bytes before/after; real cold-start/download times |
| Administration | `src/app/admin.tsx` is 6,916 lines; several `src/features/admin/*/index.tsx` files describe a future extraction rather than implementing it | Extract working feature components/hooks and shared authorized query helpers incrementally; load only the active panel | Panel load requests, rerender work, review/test isolation |
| Data access correctness | Untyped Supabase client and extensive `any` hide RPC/result/schema mismatches | Generated Database types, runtime validation at external API boundaries, one shared error/result convention | Schema/API defects caught in CI; reduce unchecked casts in sensitive paths |
| Repeated service work | AI coach/recap regenerate identical responses; feed and screen transitions refetch shared data | Cache by authorized team, season, and data version; deduplicate in-flight requests; add per-user quotas | Paid calls per useful result, duplicate request count |

Do not start by adding `useMemo` everywhere: the React Compiler is enabled, and the larger costs here are network fan-out, excessive mounted content, assets, and oversized feature modules. Use profiling to decide which remaining render paths warrant manual memoization.

## Suggested repair sequence

1. **Close the authorization gaps:** findings 1–4, 14–15, 18, 25, and 28. Put negative authorization tests around each affected operation before deploying changes.
2. **Repair payment processing:** findings 2, 5–6, 17, and 27 together. Use recorded Square sandbox fixtures and fault-injection tests; verify registration activation exactly once.
3. **Stabilize native and offline use:** findings 7–11, 16, and 19–20. Align SDK 55, rebuild native binaries, and exercise two-account/offline/device-restart scenarios.
4. **Resolve privacy and operations:** findings 12–13, 21–23, and 26. Clarify the chat privacy model, restore web monitoring, and establish reproducible migrations and dependency checks.
5. **Optimize against a baseline:** correct ranking completeness, then measure feed requests, scrolling, exported assets, and large admin panels before and after each change.

Also review the OTA runtime policy before publishing native dependency changes: `app.json` uses `runtimeVersion.policy = appVersion` while the app version remains `1.0.0`. Build-number increments alone do not create a new app-version runtime. A native-module change needs a compatible new runtime/binary or a deliberately configured fingerprint-based policy; see the [Expo runtime-version reference](https://docs.expo.dev/eas-update/runtime-versions/).
