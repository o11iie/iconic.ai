# Slate Changelog

This tracks implementation decisions as Slate is built, in the order they were made. See `SLATE_RISKS.md` for open risks and missing credentials, and `SLATE_RELEASE_READINESS.md` (added before release) for ship/no-ship status.

## Day 5 — Release Gate (security, Android config, QA)

No new product features, by design. See `SLATE_RELEASE_READINESS.md` for the full green/yellow/red assessment.

### Security findings — found and fixed, not just documented
- **No rate limiting existed anywhere in the API.** This was the most serious finding: `/auth/login` was an unthrottled brute-force surface, the TMDB/IGDB proxy routes let anyone burn Slate's provider quota, and the deliberately-unauthenticated analytics ingest could flood the database. Added tiered limits sized per route's actual abuse cost, plus a global backstop so a future route is never unbounded. *Verified live: the 11th rapid login attempt returns 429.*
- **The RTDN billing webhook was completely unauthenticated.** Anyone who learned the URL could make Slate issue Play Developer API calls on demand. Now gated by a constant-time shared-secret check that refuses to process when unconfigured. *Verified live: 401 / 401 / 200 for missing, wrong, and correct tokens.*
- **Moderation authorization failed open.** Post deletion used `role !== "USER"`, which would grant moderator powers to any undefined or unexpected role value. Replaced with an explicit `canModerate` allowlist that fails closed, with unit tests for exactly those cases.
- **Users could not delete their own comments** — there was no endpoint at all. Added, with the same authorization rule. *Verified live: 403 cross-user, 204 for the owner.*
- **A cleartext HTTP dev URL was baked into the mobile config.** Release builds now resolve the API base URL from `EXPO_PUBLIC_API_BASE_URL` and **refuse to start** if it's missing or not HTTPS, rather than silently shipping a build that leaks access tokens over plaintext.
- Lowered the request body cap to 128KB and confirmed no secrets are committed.

### Bug found while verifying the fixes
The first rate-limit implementation returned **500 instead of 429** — `errorResponseBuilder`'s plain object has no `statusCode`, so the global error handler masked it as an internal error. Caught only because the limit was exercised live rather than assumed to work. Fixed on both sides, and the per-tier user-facing copy now surfaces correctly instead of collapsing to a generic string.

### Android release configuration
- Added `eas.json` with development/preview/production profiles; production builds an **app bundle** (`.aab`), not an APK, and auto-increments `versionCode`.
- Added `expo-build-properties` targeting **compile/target SDK 36**, `minSdk 24`, and `usesCleartextTraffic: false`. **Verified by running `expo prebuild` and inspecting the generated native project** — `android.targetSdkVersion=36` really does land in `gradle.properties`, and the manifest really does carry `usesCleartextTraffic="false"`.
- Version set to 1.0.0; added deep-link intent filters, `INTERNET`, and explicitly *blocked* location/camera/microphone permissions Slate has no reason to request.
- Gitignored the generated `android/`/`ios/` directories so continuous native generation keeps working.

### What could NOT be validated here, and is recorded as such
This environment has Java and Gradle but **no Android SDK, no adb, and no device**. A real `.aab` compile and on-device QA were therefore impossible. No build result has been fabricated — these are the top items in the RED section of the readiness doc.

## Day 4 — Notifications, Ads, Analytics, Design Polish

### Analytics: a dead table became a real feature
`AnalyticsEvent` had existed in the schema since Day 1 with **zero code references** — no endpoint, no client, nothing writing to it. Built the whole path:
- `POST /api/analytics/events` — validated batch ingest (max 50/request). Attribution is best-effort: a valid token attributes the event to a user, a missing/expired one records it anonymously rather than rejecting it, so pre-signup funnel events (`app_open`, `paywall_view`) are still measurable.
- A mobile `track()` facade behind an `AnalyticsProvider` interface, queuing and flushing in batches so a burst of taps isn't a request per tap, re-queueing on network failure, and never surfacing an analytics error to the user.
- Wired ~15 real call sites: app open, signup/login, title view, trailer view, follow/unfollow, watchlist add/remove, AI message, AI limit reached, paywall view (with the trigger that caused it), and the full purchase funnel (started/completed/failed/restored).

### Notifications: generation, not just storage
Only one notification was ever created app-wide (a community reply). There was no release-alert generation and no mobile UI at all.
- `runReleaseAlertSweep()` scans followed titles and fires reminders at day milestones (free: 7/1/0, Pro additionally gets a 30-day heads-up). It honors the same precision rule as the countdown engine — a title whose date Slate only knows vaguely never produces a confident "releases tomorrow".
- Idempotent by construction: each reminder records its `milestoneDays`, and the sweep skips a user+title+milestone it has already sent. Exposed as an admin-only endpoint intended for a cron/scheduler rather than an in-process timer, so it behaves identically on one instance or ten.
- `dispatchNotification()` is now the **only** way a notification is created. Preference checks live there rather than at each call site, so a muted type can't leak through a feature that forgot to check.
- Added real per-type preferences (`mutedNotificationTypes`, a new migration) on top of the existing global on/off, plumbed through the preferences API and shared types.
- Built `NotificationsScreen` (read/unread, mark-all-read, tap-to-navigate into the title or post, empty state) and an unread badge on Home.

### Ads: abstraction with Pro suppression enforced in one place
No real ad network is wired up — AdMob needs an account, app ID, ad unit IDs, and a native module requiring a development build. Rather than ship a fake "Your ad here" placeholder, `NoOpAdProvider` renders nothing and the seam is ready: `AdSlot` is the only path an ad can reach the screen, and it checks the **backend-verified** entitlement first, so Pro users are ad-free by construction rather than by each screen remembering to check. Ad density lives in one config constant.

### Design system
`theme.ts` was just a color object. Expanded it into real tokens (spacing, radii, typography scale, min touch target) and added the shared state components the master spec calls for: `Skeleton`/`PosterRowSkeleton` (Home now shows layout-shaped skeletons instead of a bare spinner, so nothing jumps when data lands), and `EmptyState`/`ErrorState` with retry. Replaced generic copy with specific copy on Home, Search, and Watchlist.

### Verification
Backend typecheck/lint clean, 19/19 tests pass, mobile + shared typecheck clean. Live-verified against the real Postgres instance:
- Analytics: authenticated events persisted **attributed**, anonymous events persisted **unattributed**, properties intact, empty batch correctly rejected with 400.
- Sweep: created exactly one correctly-worded reminder, and a second identical run created **zero** — idempotency proven, not assumed.
- Preference gates: muting `RELEASE_REMINDER` suppressed a due notification (0 created), unmuting let the same milestone through (1 created), and `notificationsEnabled: false` suppressed at the query level.

## Day 3 — Slate Pro, AI, Community

### Verification before building anything new
Before writing code, exercised the existing Day 1 backend (community, billing, AI) against a **real** Postgres instance with a real server process — not just typecheck/unit tests. Result: zero bugs found in any of it. Specifically verified live:
- Full community CRUD (create post → list → react → comment → list comments → report) round-trips correctly through real DB writes.
- The Pro entitlement gate is genuinely authoritative: manually flipped a user's `Entitlement` row to `ACTIVE` in the database (simulating a verified Play purchase, since no real purchase can be made in this sandbox) and confirmed `/ai/usage`'s limit changed from 5→100 and `/billing/entitlement` reported `isActive: true`; reverted and confirmed it dropped back. The mobile client never influences this — it only ever reads it.
- `/ai/ask` correctly 503s with `AI_NOT_CONFIGURED` without crashing or fabricating a response, and does NOT consume a user's daily quota when it fails before calling the provider.

### The real gap: no mobile Community UI existed
Community's backend (posts/comments/reactions/reports) was fully built and now-verified on Day 1, but there was **zero mobile UI for it** — a core, explicitly-required V1 feature with no way to reach it from the app. Built:
- `CommunityPostCard` (reactions row, spoiler-gated body preview, comment count) embedded as a "Community" section on `TitleDetailScreen`.
- `SpoilerGate`: a tap-to-reveal wrapper for any spoiler-flagged content. Documented scope limitation: this is a binary gate (hidden vs. revealed) for V1, not yet differentiated by a user's `hide_recent` vs `hide_all` preference, since that requires correlating post age against episode air dates — a real follow-up, not a silently-dropped requirement.
- `NewPostScreen` (kind picker, spoiler toggle, body input) and `PostDetailScreen` (full post, reactions, comments list, inline comment composer, report flow with the 5 real report reasons the backend defines).
- Added `GET /api/community/posts/:id` — a single-post detail endpoint the mobile detail screen needed that didn't exist; the list endpoint alone couldn't reliably serve it without either fetching an unbounded number of posts or adding real pagination-by-id, so this was the correct fix rather than a mobile-side workaround.

### Bugs found and fixed while wiring this up
- `packages/shared`'s `community.ts` had the exact same lowercase-vs-uppercase enum bug as `SpoilerSensitivity` (fixed Day 2): `ReactionKind`, `PostKind`, `ReportReason`, and `Report.status` were all typed lowercase while the real Prisma enums and every actual API response are uppercase. Also added the `authorHandle` field both `CommunityPost` and `CommunityComment` actually return but the shared type didn't declare. Fixed to match reality exactly.
- **Found a real, previously-shipped navigation bug**: `AskSlate` and `ProUpgrade` were never registered as screens in `SearchStack` or `WatchlistStack` — only in `HomeStack`. Since `TitleDetailScreen` (reachable from all three tabs) navigates to both on a PRO_REQUIRED error or an "Ask Slate" tap, reaching a title's detail page via Search or Watchlist and triggering either would have thrown a React Navigation runtime error ("action not handled"). Fixed by registering the full screen set consistently across all three stacks.

### Verification
Backend typecheck/lint clean, 19/19 tests pass (unchanged — no new pure logic to unit test this round, verification was live/integration). Mobile + shared typecheck clean. Live-tested the new `GET /community/posts/:id` endpoint end-to-end (found post + 404 for a bogus id) against the real database.

## Day 2 — Games, Anticipation Engine, Personalization

### Games / anticipation engine
- Surfaced IGDB's real `hypes` count as `anticipationCount` on game titles — genuine third-party signal (how many IGDB users marked a game anticipated), kept visually and semantically separate from Slate's own `hypeScore` heuristic so the UI never conflates "a number we made up" with "a number IGDB actually reports."
- Blended `anticipationCount` into `computeHypeScore` for games specifically (log-normalized against a documented heuristic ceiling, since pre-release games usually have no rating yet to rank by otherwise).
- Added `developer` (from IGDB's `involved_companies`) and confirmed `platforms` are both fetched and now actually rendered in `TitleDetailScreen` — previously fetched but unused.

### Personalization
- `User.favoriteGenres`/`spoilerSensitivity`/`notificationsEnabled` existed in the schema since Day 1 but had no endpoint to read or write them and nothing consumed them — dead columns. Added `PATCH /api/users/me/preferences`.
- Added `GET /api/genres`: a deduped, cross-provider genre name list (TMDB movie + TV genres, IGDB's documented genre taxonomy) for the mobile genre picker. Personalization matches on genre **name**, not provider-specific numeric ids, since TMDB and IGDB each use their own id space.
- Added `GET /api/discover/for-you` (authenticated): merges trending + upcoming across every configured provider, dedupes, and re-ranks by a genre-affinity boost layered on top of Hype Score — a genre match nudges a title up, it never overrides raw popularity/proximity for a title with no affinity data. Returns `personalized: false` honestly when the user hasn't set any favorite genres yet, rather than pretending to personalize with no signal.
- Mobile: genre picker (chip multi-select) in Profile wired to the preferences endpoint; a "For You" section on Home wired to the new endpoint.
- Fixed a real, previously-unnoticed type mismatch: `packages/shared`'s `SpoilerSensitivity` was typed as a lowercase union (`"hide_recent"`) while the Prisma enum and every actual API response use uppercase (`"HIDE_RECENT"`) — the backend's loose `string` typing on that field had been hiding it since Day 1. Corrected the shared type to match Prisma exactly and gave `auth.routes.ts` a precise type instead of `string`. Also wired Ask Slate's spoiler-sensitivity request field to the user's actual stored preference (it was previously hardcoded to `"hide_recent"` regardless of what the user had set — moot until preferences existed to read from).

### Verification
First time the app has run against a **real** Postgres instance rather than being smoke-tested with an empty/unreachable database: started the local Postgres cluster available in this sandbox, ran `prisma migrate deploy` for real, and exercised the full path live — signup, `PATCH /users/me/preferences`, `GET /discover/for-you` flipping from `personalized: false` to `true` after genres were set, and confirmed the route correctly 401s without auth. Backend typecheck/lint clean, 19/19 tests pass (8 new: anticipation-blended hype scoring, personalization ranking/dedup), mobile + shared typecheck clean.

## Day 1 — Foundation + Movie/TV Data

### Starting state
The repository contained a single unrelated static page (`index.html`, an "Iconic.AI automation agency" landing page) and no application code. Slate is being built from zero — this changelog reflects that reality rather than assuming prior infrastructure. `index.html` was left untouched rather than deleted.

### Architecture decisions
- **Monorepo**: pnpm workspaces — `apps/backend` (API), `apps/mobile` (Expo/React Native Android app), `packages/shared` (domain types shared by both).
- **Client**: React Native via Expo, chosen specifically because Android + Google Play release is a hard V1 requirement — a single TypeScript codebase compiles to a real Android app (via `expo run:android` / EAS Build) rather than a wrapped web view.
- **Backend**: Fastify + TypeScript + Prisma + PostgreSQL. Chosen for a small, fast, well-typed API surface a solo build can keep consistent under a tight timeline; no reason to add a heavier framework.
- **Auth**: First-party email/password with bcrypt + short-lived JWT access tokens (15 min) and rotating opaque refresh tokens (30 days, hashed at rest). No third-party auth provider introduced — kept simple and owned.
- **Domain model**: Slate does not mirror TMDB/IGDB catalogs into its own database. A `Title` row is a thin cached pointer (id, name, release date) created lazily the first time a user follows/watchlists/discusses it — full metadata is always fetched live from the provider. This respects both providers' terms (no wholesale redistribution of their catalog) and avoids a sync/staleness problem entirely.
- **Countdowns**: `computeCountdown()` explicitly refuses to fabricate a time-of-day. TMDB and IGDB only ever report a calendar date. A numeric HH:MM:SS countdown is only produced for `exact_datetime` precision, which nothing currently populates — this is intentional, not a bug, until a source that actually reports release *times* is integrated. Date-only titles get a date label and a "released / not yet" boolean, never an invented countdown.
- **Hype Score**: An explicit, documented heuristic (`computeHypeScore`) blending provider rating and release proximity — not a claim of real-world buzz/social data Slate doesn't have. Must always be labeled "Slate's Hype Score" in the UI, never presented as an objective fact.
- **Ask Slate (AI)**: Provider-agnostic `AiProvider` interface; `OpenAiProvider` is the only implementation for V1, per explicit product decision. The system prompt instructs the model to decline rather than guess when context is missing, and to respect spoiler sensitivity. All AI calls are server-side only; the mobile client never sees the OpenAI key. Daily usage is rate-limited per user (5/day free, 100/day Pro — configurable, not literally unlimited, to bound cost and abuse).
- **Slate Pro / Billing**: Google Play Billing only for V1 (no RevenueCat), per explicit product decision. The mobile client's local purchase state is never trusted — every purchase token is re-verified server-side against the Play Developer API (`purchases.subscriptionsv2`), and the resulting `Entitlement` row in Postgres is the only source of truth `isPro` checks read from. Purchase/RTDN processing is idempotent via a `(purchaseToken, rawStatus)` unique constraint on `PurchaseEvent`. Product IDs and reference pricing live in one config file (`apps/backend/src/config/products.ts`) — nowhere else hardcodes "$5.99" or "$49.99".
- **Free tier limits** (watchlist: 25 items, follows: 10 titles, Ask Slate: 5/day) are real, enforced server-side gates — not UI-only suggestions — so Pro is a genuine, verifiable upgrade rather than a client-side flag.

### Built this session
- Prisma schema covering users/auth, titles, watchlist, follows, community (posts/comments/reactions/reports), entitlements/purchase events, AI conversations/usage, notifications, and analytics events.
- Backend: auth (signup/login/refresh/logout/me), TMDB client + movie/TV routes, IGDB client (Twitch OAuth) + game routes, unified discovery/search/trending/upcoming with real (non-fabricated) countdown computation, watchlist + follows with Pro gating, community posts/comments/reactions/reports, Ask Slate with OpenAI provider + rate limiting, billing (product catalog, purchase verification, RTDN webhook), notifications, admin (moderation queue, coarse stats).
- Mobile: Expo app scaffold, auth flow, bottom-tab navigation (Discover/Search/Watchlist/Profile), title detail screen with follow/watchlist/Ask Slate actions, Ask Slate chat screen, Pro paywall screen wired to `react-native-iap` (Google Play Billing) and the backend's verify-purchase/restore endpoints.
- Automated tests for the logic that must never lie: countdown precision handling and hype score bounds/ordering, plus product catalog integrity. Backend typechecks, lints, and boots cleanly; a live smoke test confirmed `/health` and `/api/discover/trending` both behave correctly with zero provider keys configured (returns an empty result set, not fabricated data or a crash).

### Explicitly deferred, not silently dropped
- Full game/anticipation-engine polish and personalization (Day 2 scope) — the IGDB client and games routes exist and are wired into unified discovery now, but ranking/personalization logic is still basic.
- Push notifications (only in-app notification rows exist so far; no FCM wiring yet).
- Ads for free users, analytics dashboards, and design polish (Day 4 scope).
- Android release signing, ProGuard/R8 config, and Play Console listing (Day 5 scope).
