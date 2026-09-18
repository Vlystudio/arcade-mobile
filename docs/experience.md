# Night-out experience

The main destinations are Home, Play, League, Order, and You. Existing routes remain addressable. Trivia and tournaments are in Play; teams and schedules are in League; staff tools are in You.

Home shows the caller's active game and published team schedule before the feed. Schedule dates use the venue's Eastern time zone. RSVP writes use the date shown on the card, defaulting to the upcoming Monday, with visible failure feedback. Intent selection is optional, persists per account, and carries a guest's Play/League choice through sign-in. Ordering remains public. The full tour is available from profile help rather than starting automatically.

## Game continuity

- Active-game drafts are versioned and stored per account. Saving serializes writes; leaving waits for the last save and reports storage failure.
- A draft includes its session, lane, team, lineup, ring scores, and previous personal best. Restore validates the shape, account, session, and lineup. Submitted server scores take precedence.
- Back saves and leaves. The persistent Resume control is outside the screen stack. End game confirms a discard, waits for server acknowledgement, then clears only that session's draft and queued submission.
- Server status is rechecked on foreground and periodically. The existing 8-minute warning / 10-minute inactivity policy continues while using other screens. Expiry compares the last-activity timestamp to avoid cancelling a teammate's newer activity; queued offline submissions are preserved. App polling cannot run while the operating system has terminated the app.
- Successful completion presents a scrollable recap with individual and team totals, previous-best comparison, league placement when finalized, and optional user-initiated sharing.

## Group phone handoff

Choose the lineup and shooting order, then select **Use this phone for the group**. A named Ready screen starts each three-ball turn. Games retain the existing nine-ball rules: three players rotate A/B/C, two rotate A/B/A. The scorecard supports undo across a handoff and corrections to any recorded ball. Handoffs reset safely when reopening a draft.

One account and device key control the game. Other phones show persisted progress while connected. The database checks membership, freezes the lineup after the phone is chosen, validates chronological drafts, and rejects writes from other phones and older clients. Local drafts and queued completion support interrupted connectivity; choosing a phone and starting a rematch require a connection. Keep the original scoring phone/account available for the duration of the game.

The group recap highlights the combined score and individual contributions. **Play again with this group** preserves the lineup and phone after the league round finishes, provided the lane remains available and the roster is unchanged. A new league week requires checking in again.

Database tests cover ownership, read-only viewers, invalid scores, draft revisions, lineup locking, atomic completion, and rematch eligibility/idempotence. Browser checks cover two- and three-player handoffs, correction, undo, refresh recovery, viewer mode, group recap, and rematch at phone and desktop widths. Physical-device touch and haptic checks remain separate.

## Menu and visual behavior

Square reporting/category IDs supply categories; missing categories never fall back to item names. Known local menu entries can supply category/photo metadata by matching item name. Both sources are normalized and sorted consistently before display, and outdated venue requests cannot replace the selected venue's menu. Real catalog image IDs resolve to Square images. Items without available photography retain a neutral placeholder.

The cart summary stays above navigation and identifies the subtotal separately from taxes, fees, and tip. Lane/game selection uses bounded MotionSheet panels with visible close controls and scrolling. The shared reduced-motion preference applies to transitions and the finish screen. Secondary text contrast, navigation labels, lane controls, and add-to-cart targets are improved.

Personal targets use approved scores, respect the nine-ball Skee-Ball maximum, and show adjacent approved score entries with exact competition ranks (ties share a rank). They link to the full leaderboard with the relevant game selected.

## Verification

Run `npm test`, TypeScript checking, lint, and Expo web/native exports. Regression tests cover draft scope and recovery, lineup changes, authoritative server scores, scoped queue discard, category ordering, actual catalog imagery, Eastern dates, Monday selection, and scoring limits.

Browser verification uses an ignored local fixture, with no live score/order/RSVP writes. Check phone and desktop widths, scorer → menu → refresh → resume, successful completion, explicit discard, cart persistence, category filters, sheet close/Escape, intent routing, and staff/navigation access. Physical-device keyboard, gesture, and frame-pacing checks remain separate from browser and bundle verification.
