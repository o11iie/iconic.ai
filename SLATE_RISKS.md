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
