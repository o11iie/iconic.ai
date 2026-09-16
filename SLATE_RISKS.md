# Slate Risks & Open Requirements

This is a living document. Anything here is either a real risk to the 5-day plan, a decision with a documented tradeoff, or a credential/account only the product owner can provide. Nothing in this file should be treated as "someday" — items are called out as blocking or non-blocking explicitly.

## Hard blockers — need action from the account/business owner, not more code

These cannot be resolved by writing more code. Each blocks a specific, real part of V1:

1. **TMDB API key** — needed for all movie/TV data. Free, instant approval at https://www.themoviedb.org/settings/api. Until set as `TMDB_API_KEY` in `apps/backend/.env`, movie/TV endpoints return empty results (verified: they do not crash or fabricate data, they return nothing).
2. **IGDB / Twitch developer app** — needed for all game data. Free at https://dev.twitch.tv/console/apps (create an app, get Client ID + Client Secret). Until set as `TWITCH_CLIENT_ID`/`TWITCH_CLIENT_SECRET`, game endpoints return empty results the same way.
3. **OpenAI API key** — needed for Ask Slate. Requires an OpenAI account with billing enabled. Until set as `OPENAI_API_KEY`, `/ai/ask` returns a clear 503 (`AI_NOT_CONFIGURED`) rather than a fake response.
4. **Google Play Console developer account** ($25 one-time, identity verification required, can take days to clear) — required for: creating the app listing, creating the `SLATE_PRO_MONTHLY`/`SLATE_PRO_YEARLY` subscription products, generating the service account used for server-side purchase verification, and any real device testing of purchases (`react-native-iap` does not work in Expo Go — it requires a development build).
5. **Google service account JSON for the Android Publisher API** — created from the Play Console once the account above exists, granted access to the app, scoped to `androidpublisher`. Until set as `GOOGLE_SERVICE_ACCOUNT_JSON`, purchase verification returns 503 (`BILLING_NOT_CONFIGURED`) — it will never silently grant Pro access.
6. **A real Postgres database** for any environment beyond this sandbox (local dev container, or a managed instance for staging/production). `DATABASE_URL` in `.env.example` points at `localhost` as a placeholder only.
7. **Release signing key** for the Android app bundle, and eventually a Play Console upload track (Internal Testing → Closed → Production). Google Play App Signing is recommended so Google holds the final signing key.
8. **Firebase Cloud Messaging credentials** (added Day 4) — needed for *push* notifications. Slate's notification system is fully built and working **in-app** (generation, preferences, read state, unread badge), but delivering an alert while the app is closed needs an FCM project + `google-services.json` + a development build. Until then, a user only sees release reminders when they open Slate. This is a real, deliberate gap, not a silent omission.
9. **Google AdMob account, app ID, and ad unit IDs** (added Day 4) — needed for advertising to free users. The `AdProvider`/`AdSlot` seam is built and Pro suppression is enforced, but `NoOpAdProvider` renders nothing until these exist. Deliberately chose to render nothing rather than ship a fake placeholder ad.
10. **A scheduler** (cron, Cloud Scheduler, or the host platform's equivalent) to call `POST /api/notifications/sweep-release-alerts` — probably hourly. The sweep is idempotent so over-calling is harmless, but nothing calls it automatically today; release reminders won't generate on their own until this is wired up in the deployment environment.

None of the above were skipped or stubbed out with fake data — every integration point (TMDB client, IGDB client, OpenAI provider, Play Billing verification) is written against each provider's real, documented API contract and fails loudly/gracefully (503 with a clear error code) rather than fabricating a response when the credential is missing.

## Gate 3 risks (added Gate 3)

### Blocking

1. **No Android artifact can be produced in this environment.** Four
   independent causes, each verified by attempting it: no `EXPO_TOKEN`;
   `api.expo.dev` returns 403 CONNECT; local Gradle cannot resolve plugins
   because `dl.google.com` and the Gradle Plugin Portal are policy-denied and
   the JDK 17 toolchain provisioner gets 403 (only JDK 21 installed); and no
   Android SDK exists here, distributed as it is only from the blocked Google
   hosts. **Not a code problem** — the repository is configured and validated
   at API 36. Needs a build machine or an EAS account.

2. **Play Billing Library version is unconfirmed and may not be a one-line
   change.** Slate pins 7.0.0 (react-native-iap 12.x's own tested version).
   Google raises the enforced minimum roughly annually. The version is now a
   single reviewable value in `app.json`, but a Billing major the installed
   library was not written against may not compile — and nothing here can
   compile to find out. If Play requires 8+, the tested path is
   react-native-iap 14+, which needs `react-native-nitro-modules`, a
   purchase-flow migration and a real device test. **Confirm before planning
   the build.**

3. **The Android purchase flow has never executed.** The offer-token fix is
   correct per react-native-iap's own types and documentation, but it is a
   native path. Until device test #27 passes, "billable" is unproven.

### Accepted trade-offs worth re-examining

4. **New Architecture is disabled.** Chosen so react-native-iap 12.16.4 runs
   on the architecture it was built for, since the interop alternative cannot
   be verified here. Expo SDK 55 removes the old architecture, so a
   New-Arch-native billing library is required before that upgrade. This is a
   one-release reprieve, not a resolution.

5. **`TRUST_PROXY` defaults to `false`.** Safe, but it means an operator who
   deploys behind a load balancer and forgets it gets a collapsed auth rate
   limit — the failure is silent. The runbook calls it out; consider making
   production refuse to start without an explicit value if this bites.

6. **Analytics event names differ from the Gate 3 vocabulary**
   (`ai_open` for `ask_slate_open`, `purchase_completed` for
   `purchase_success`, and five more). Same events, existing names kept rather
   than churning every call site. Anyone building dashboards needs the mapping
   in `SLATE_GATE_3_REPORT.md`.

7. **`ADVANCED_JOURNEY` has no client path.** The backend gate and the paywall
   headline both exist, but no mobile screen saves a journey, so the trigger
   cannot fire from the app today. Feature work, not a defect — but it means
   one of the five required trigger codes is unreachable in the shipped app.

8. **`versionCode` is 1 in `app.json`** while `eas.json` uses
   `appVersionSource: "remote"` with `autoIncrement`. EAS is authoritative and
   the local value is inert. Harmless, but do not read it as truth.

### Still true from earlier gates

9. **Zero on-device QA.** Unchanged and now the dominant risk.
   `SLATE_DEVICE_QA.md` is ready to execute the moment an artifact exists.
10. **Push notifications not built** — CONFIGURATION REQUIRED. Enabling it
    changes the Data Safety declaration (a push token is a new identifier) and
    the privacy policy, which must be updated in the same change.
11. **Store graphics missing** — no 512×512 icon, no feature graphic, no
    screenshots; screenshots additionally depend on risk 1.
12. **No error tracking or APM.** Adding one changes the Data Safety "App info
    and performance" section.
13. **Row Level Security is not used**, and correctly so as built: no
    untrusted client holds a database credential, and isolation is enforced in
    the API (17 cross-user checks verified). RLS becomes **mandatory** if the
    mobile app is ever pointed at Postgres directly, e.g. via a Supabase
    client SDK.

## Gate 2 compliance risks (added Gate 2)

### Blocking submission

1. **Target API level 34.** Play requires 35+ for new apps and rejects the AAB
   at upload. Expo SDK 51 ships AGP 8.2.1, which caps `compileSdk` at 34; the
   SDK 54 upgrade that fixes it requires `api.expo.dev`, which this sandbox
   blocks (403). Must be done on a machine with network and Android SDK access.
   Full reasoning: `SLATE_48HR_BUILD_DECISION.md` and
   `SLATE_PLAY_COMPLIANCE.md` §1. **This is the only item preventing
   submission that is not an operator input.**

### Operator inputs — code is ready, real-world values are not

2. **Legal entity name, support email, copyright email, public domain,
   governing jurisdiction, legal effective date.** All blank in
   `web/config.js` by design. `node web/verify-config.mjs` exits non-zero until
   filled, and the pages fail visibly rather than displaying a placeholder.
   Inventing any of them would put a false statement in front of users and a
   Play reviewer.
3. **A public HTTPS host for `web/`.** Play requires both the privacy policy
   and the account-deletion page to be publicly reachable with no sign-in wall
   before submission. The pages exist and work; they are not hosted.
4. **`WEB_ORIGINS` on the backend.** Without it the web deletion page's
   requests are refused by CORS. Easy to miss because the page loads fine and
   only fails on submit.
5. **Play reviewer demo account.** Slate is entirely account-gated — a
   reviewer without credentials sees a login screen and nothing else, which is
   a common rejection cause. Setup: `SLATE_PLAY_REVIEWER_GUIDE.md`.

### Not done, and not claimed to be

6. **Store graphics.** No 512×512 store icon, no 1024×500 feature graphic, no
   screenshots. The in-bundle icon/splash assets are valid PNGs but
   placeholder-grade artwork. Screenshots additionally cannot be captured until
   the target-API blocker is cleared, since they must come from a real build.
   Plan: `SLATE_PLAY_STORE_SCREENSHOTS.md`.
7. **Still zero on-device QA.** Every verification in this gate was against a
   real database and a real browser, but nothing has run on an Android device.
   `react-native-iap` in particular cannot be exercised in Expo Go — a real
   purchase flow has never been executed.
8. **Play Billing Library 7.0.0** is what `react-native-iap` 12.16.4 bundles.
   Confirm Play's current minimum at submission; it is a one-line Gradle
   property override if it has moved.

### Accepted trade-offs worth re-examining

9. **Deleting an account destroys its `PurchaseEvent` audit rows** via cascade.
   Correct for privacy, but it means a later billing dispute for that user has
   no local record — Play's own records remain the authority. Revisit if
   financial-record retention obligations apply in your jurisdiction.
10. **Backup retention is asserted as "up to 30 days"** on the deletion page.
    That is a commitment to users; confirm it matches the hosting provider's
    actual retention before publishing, and change the page if not.
11. **Blocking hides content at query time rather than removing it.** A
    blocked user's posts still exist and are still visible to everyone else.
    This is the intended semantic, but it means blocking is not a moderation
    action — genuinely objectionable content still needs a report.
12. **No push notifications.** Unchanged from Day 4, but it now has a
    compliance upside worth stating: with `expo-notifications` absent, Slate
    requests no `POST_NOTIFICATIONS` permission and collects no push token, so
    there is no notification-permission prompt and no extra Data Safety
    identifier. The Settings screen says plainly that alerts are in-app only.

## Release-gate risks (added Day 5)

These are separated by kind, because they are not the same class of problem:

**Technical — unverified, needs a real build/device (see `SLATE_RELEASE_READINESS.md` RED section):**
- The production `.aab` has never been compiled — no Android SDK in the build environment.
- API 36 targeting is configured and verified present in the generated native project, but never compiled, and the project is on Expo SDK 51 whose template defaults to API 34. The cleaner long-term fix is an upgrade to Expo SDK 54. API 35+ edge-to-edge behavior changes are visually untested.
- No on-device QA has been performed. The user journey is verified at the API level only.
- A real Play purchase has never completed end to end; only the entitlement half is verified.

**External configuration — code is ready, credentials are not:**
TMDB, IGDB, OpenAI, Play Console + service account, `RTDN_SHARED_SECRET`, FCM, AdMob, a managed Postgres, a deployed HTTPS API host, and a scheduler for the release-alert sweep. Every one of these fails safely and visibly when absent — none silently fabricate data or grant access.

**Future enhancement — explicitly not release blockers:**
Genre-browse UI, watch-provider data, preference-aware spoiler logic (currently a binary gate), Redis caching for provider responses, community polls, and user blocking.

## Provider/architecture decisions and their tradeoffs

Per explicit product direction:

1. **OpenAI selected for Ask Slate V1** because it minimizes architectural complexity for a solo 5-day build and the team already has familiarity with it. The `AiProvider` interface means swapping in Anthropic or another vendor later is a new ~40-line class, not a rewrite of Ask Slate's routes, context-building, rate limiting, or usage tracking.
2. **Anthropic (or any other provider) can be added later** without touching `ai.routes.ts`, the usage-limit logic, or the mobile client — they all depend only on the `AiProvider` interface in `apps/backend/src/modules/ai/provider.ts`.
3. **Google Play Billing selected directly, no RevenueCat, for V1** because Slate is Android-first and the 5-day timeline favors minimizing third-party billing infrastructure and accounts to set up. This is a real tradeoff: adding iOS later, or wanting RevenueCat's dashboard/analytics, means writing a new verification path — but the `Entitlement` domain model (status enum, product catalog, purchase event log) was deliberately kept provider-agnostic so that addition is additive, not a rewrite of the entitlement gating used throughout the app (watchlist limits, follow limits, AI limits, ad-free flag).
4. **RevenueCat deliberately deferred** — cross-platform subscription management isn't needed until/unless iOS ships.
5. **No local caching layer (Redis) for TMDB/IGDB responses yet.** At current expected V1 traffic this is likely fine, but if TMDB/IGDB rate limits become a problem, add a short-TTL cache in front of `tmdb.client.ts`/`igdb.client.ts` rather than changing their callers.

## Product/scope risks

- **Countdown precision is intentionally conservative.** TMDB and IGDB never report a release *time*, only a date. Slate will not show "23:59:12 remaining" for a title where the real data is "sometime on this date." If a competitor-parity feature ("exact drop time") is wanted for select titles (e.g. game midnight launches), that requires a new, specifically-sourced data feed — it cannot be inferred from TMDB/IGDB and must not be guessed.
- **Hype Score is Slate's own heuristic**, not a measurement of real-world buzz (social volume, search trends, etc.). It must be labeled as such in the UI. If real buzz data is wanted later, that's a new data source and a real scope addition, not a tuning change to the current formula.
- **Free tier limits (25 watchlist / 10 follows / 5 AI requests per day) are a first hypothesis**, not user-tested. They're enforced server-side so they're real gates, but the specific numbers should be revisited once there's any usage data.
- **Ad density is untested against real user tolerance.** One slot per feed with a documented frequency constant is a starting hypothesis, chosen to protect the cinematic feel. Revisit once there's real engagement data — and never at the cost of making the free tier feel hostile.
- **Spoiler protection is a binary gate** (flagged content hidden until tapped), not yet differentiated by the user's `HIDE_RECENT` vs `HIDE_ALL` preference, which would require correlating post age against episode air dates.
- **Community moderation is manual-queue only in V1** (admin/moderator endpoints to review reports). No automated content moderation (profanity/spoiler-detection ML) is implemented — spoiler tagging is currently self-reported by the poster (`containsSpoilers` checkbox), not detected.
- **`react-native-iap` cannot be exercised in this sandbox.** There is no Android emulator/device, no signed build, and no Play Console product to purchase against here. The purchase flow is implemented against the real SDK and the real Play Developer API contract, but it has only been verified by reading, not by executing a live purchase — that verification can only happen once items 4–5 above exist and a development build is installed on a real device or emulator with a Play Store account.
- **Notifications are in-app only so far.** Push notifications (release reminders, community replies while the app is closed) need FCM wiring — planned for Day 4 — plus Android 13+ runtime notification permission handling.

## Non-negotiables preserved so far (do not relax these later)

- Mobile client never receives `OPENAI_API_KEY`, `TWITCH_CLIENT_SECRET`, or the Google service account credentials — verified by inspection of every mobile source file that talks to the backend.
- `isPremium`/Pro status on the client is always read from `/billing/entitlement`, never set locally and trusted — verified in `EntitlementContext.tsx` and every Pro-gated backend route re-checking the `Entitlement` row itself rather than trusting a client-sent flag.
- No fabricated entertainment facts: TMDB/IGDB clients return real API shapes or fail with a clear "not configured"/"provider error" response; Ask Slate's system prompt explicitly instructs the model to say "I don't have that information" rather than guess.
