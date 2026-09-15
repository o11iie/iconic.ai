# Slate — Release Readiness

Assessed at the Day 5 release gate. Every "verified" claim below was checked by running something — a live request against a real Postgres instance, a test, a typecheck, or an inspection of generated native build files. Claims that could not be verified in this environment are marked as such rather than assumed.

**Environment constraint that shapes this whole document:** the build sandbox has Java and Gradle but **no Android SDK, no `adb`, and no connected device**. A real `.aab` compile and on-device QA therefore could not be executed here. Config was validated as far as `expo prebuild` allows (which generates and lets us inspect the real native project); actual compilation is unverified. That is stated plainly everywhere it applies below — no build result has been fabricated.

---

## GREEN — Ready

### Security (all fixed and live-verified this session)
- **Tiered rate limiting across the API.** Previously there was none anywhere. Now: auth 10/5min (per IP), provider-proxy 120/min, AI 10/min burst, analytics 60/min, community writes 30/min, plus a 300/min global backstop so a route added later is never unbounded. *Verified live: the 11th rapid login attempt returns 429 with per-tier copy, not a 500.*
- **Brute-force protection on credentials.** Login/signup/refresh are the tightest tier and keyed by IP.
- **RTDN billing webhook authenticated.** Was fully open; now requires a shared secret compared in constant time, and refuses to process at all if the secret isn't configured. *Verified live: 401 with no token, 401 with a wrong token, 200 with the correct one.*
- **Authorization fails closed.** Content deletion uses an explicit moderator allowlist (`canModerate`) instead of `role !== "USER"`, which would have granted moderator powers on an undefined/unexpected role. Covered by 5 unit tests including the fail-closed cases.
- **No IDOR.** Every user-scoped query filters by `req.userId`. *Verified live: user A deleting user B's comment returns 403; the owner gets 204.*
- **Pro entitlement is backend-authoritative.** `isActive` is only ever read from the verified `Entitlement` row; the client cannot set it. *Verified live on Day 3 by flipping a real DB row and watching limits change.*
- **No secrets in the repo.** Scanned for key/token/private-key patterns: clean. `.env` is untracked and gitignored, along with `*.keystore`. `.env.example` documents every variable with no real values.
- **Secrets stay server-side.** OpenAI, Twitch, and Google service-account credentials are only read in backend code; the mobile client only ever calls Slate's own API.
- **Request body cap** lowered to 128KB (from Fastify's 1MB default) — nothing Slate accepts is larger than a 50-event analytics batch.
- **Input validation** via Zod on every route that takes a body, query, or params.

### Application correctness
- Typecheck passes across all three workspaces (backend, mobile, shared).
- Lint passes.
- 24/24 unit tests pass, covering the logic that must not silently break: countdown precision, hype scoring, personalization ranking, product catalog integrity, and moderation authorization.
- Database migrations are ordered, reproducible, and were applied for real against a live Postgres instance (`prisma migrate deploy` from clean, then a second incremental migration).
- Countdown engine refuses to invent precision — a date-only release never renders as a timed countdown. Unit-tested.
- Provider architecture is clean: raw TMDB/IGDB responses are mapped to Slate domain models in the client layer and never leak into mobile UI.

### Product surface
Movies, TV (including season/episode browsing), and games discovery; search with pagination; title detail with trailers, cast, and release info; follow and watchlist with real server-enforced free-tier limits; personalized "For You"; community posts, comments, reactions, reports, and spoiler gating; Ask Slate with context and daily quotas; Pro paywall with restore; in-app notifications with per-type preferences; analytics; admin moderation queue.

---

## YELLOW — Configuration required (code is ready, credentials are not)

None of these are code defects. Each is an external account/credential action, and the code path behind it already exists and fails safely without it.

| Area | Current behavior without config | What's required |
|---|---|---|
| **TMDB** | Movie/TV endpoints return empty results — no crash, no fabricated data | Free API key from themoviedb.org → `TMDB_API_KEY` |
| **IGDB** | Game endpoints return empty results | Free Twitch dev app → `TWITCH_CLIENT_ID` / `TWITCH_CLIENT_SECRET` |
| **Ask Slate** | Returns a clean 503 `AI_NOT_CONFIGURED` | OpenAI account with billing → `OPENAI_API_KEY` |
| **Play Billing** | Verification returns 503 `BILLING_NOT_CONFIGURED`; **never** silently grants Pro | Play Console account, the two subscription products, and an Android Publisher service account → `GOOGLE_SERVICE_ACCOUNT_JSON` |
| **RTDN webhook** | Refuses all calls until the secret is set | Generate a random secret → `RTDN_SHARED_SECRET`, and set the Pub/Sub push endpoint to `…/api/billing/rtdn?token=<secret>` |
| **Push notifications** | In-app notifications work fully; nothing is delivered while the app is closed | FCM project + `google-services.json` + a development build |
| **Ads** | `NoOpAdProvider` renders nothing (deliberately — no fake placeholder ads) | AdMob account, app ID, ad unit IDs, and the native ads module |
| **Release alert scheduler** | The sweep is correct and idempotent but nothing calls it automatically | Point a cron/Cloud Scheduler at `POST /api/notifications/sweep-release-alerts` (hourly is fine; over-calling is harmless) |
| **Production API host** | Release builds intentionally **refuse to start** unless given an HTTPS base URL | Deploy the backend, then set `EXPO_PUBLIC_API_BASE_URL` in `eas.json`'s production profile (currently a placeholder domain) |
| **Managed Postgres** | Works locally; no hosted instance exists | Provision Postgres and set `DATABASE_URL` |

---

## RED — Blockers

### 1. Production `.aab` has never been compiled
- **Issue:** No Android SDK exists in this environment, so `gradlew bundleRelease` / `eas build` could not be run. `expo prebuild` succeeded and the generated native project was inspected, but nothing has actually been compiled.
- **Impact:** Unknown compile-time failures may remain (most likely candidate: `react-native-iap`'s native module against the configured SDK level).
- **Action required:** Run `eas build --platform android --profile production` on a machine with EAS authenticated, or locally with Android SDK 36 installed.
- **Difficulty:** Low effort, but must actually be run.
- **Prevents Play Store submission:** **Yes** — there is no artifact to submit until this runs.

### 2. Android target SDK is below Play's minimum (CORRECTED at Gate 0)
> **This entry was wrong as originally written and has been corrected.** Day 5 claimed API 36 was "configured but uncompiled." It was in fact **impossible to compile**: React Native 0.74.5 pins **AGP 8.2.1**, which caps `compileSdk` at **34** (`compileSdk 36` requires AGP 8.9.1+). Verifying the value landed in `gradle.properties` proved it was *present*, not that the toolchain could consume it. See `SLATE_48HR_BUILD_DECISION.md`.

- **Issue:** Targeting is now set to **API 34** — the maximum Expo SDK 51's toolchain supports — so the project genuinely compiles. API 34 is below Google Play's minimum for new apps.
- **Impact:** The app builds and can be device-tested today, but **cannot be submitted**.
- **Action required:** Upgrade to Expo SDK 54 (ships AGP ≥ 8.9 / Gradle ≥ 8.13 and native API 36 support), then restore targeting to 36. Must be done on a machine with unrestricted network access — `expo install --fix` requires `api.expo.dev`, which this sandbox blocks by policy — and an Android SDK to compile against.
- **Difficulty:** High — a real SDK upgrade (RN 0.74→0.81, React 18→19, `react-native-iap` major) requiring a full regression pass.
- **Prevents Play Store submission:** **Yes.**

### 3. No on-device QA has been performed
- **Issue:** No emulator or physical device was available. The full user journey (launch → onboarding → discovery → follow → countdown → community → Ask Slate → paywall → purchase → restore) has been verified at the **API level against a real database**, but never by tapping through the actual app.
- **Impact:** Runtime-only issues — layout breakage, keyboard handling, navigation edge cases, image loading — would not have been caught by typechecking.
- **Action required:** Install a development build on a real device and walk the journey.
- **Difficulty:** Low effort, high value. This is the single highest-value remaining check.
- **Prevents Play Store submission:** Not technically — but shipping without it would be irresponsible.

### 4. A real purchase has never completed end-to-end
- **Issue:** The full chain (Play Billing → purchase token → backend → Google verification → entitlement → client state) is implemented, and the **entitlement half is verified** against a real database. The Google-verification half has never executed because it requires a Play Console account, live products, and a signed build.
- **Impact:** Monetization is unproven in practice.
- **Action required:** Create the products in Play Console, upload a signed build to Internal Testing, add a license tester, and run a real test purchase plus a restore.
- **Difficulty:** Medium — mostly account setup and waiting on Play review.
- **Prevents Play Store submission:** No (you can submit), but **do not announce paid launch** until a real purchase and restore have been observed.

### Explicitly NOT blockers
Genre-browse UI, watch-provider data, richer spoiler logic, Redis caching, and community polls are **future enhancements**, not release blockers, and are tracked in `SLATE_RISKS.md`.

---

## Play Store submission checklist (outside the codebase)
1. Google Play Console account ($25, identity verification can take days — start this first).
2. Play App Signing enrollment.
3. Store listing: title, short/full description, screenshots, feature graphic, content rating questionnaire.
4. Privacy policy URL and a Data Safety form declaration (Slate collects account email, user content, and first-party analytics).
5. The two subscription products, matching `SLATE_PRO_MONTHLY` / `SLATE_PRO_YEARLY` exactly.
6. TMDB and IGDB attribution is already rendered in-app; confirm it satisfies each provider's current terms before publishing.
