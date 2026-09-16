# Slate Gate 3 Report

Generated 2026-09-15T20:55Z · commit `e64a257` · branch
`claude/slate-production-sprint-i5w7gu`

## Verdict

**YELLOW.**

The blocker Gate 0 and Gate 2 both recorded as unresolvable in this
environment is resolved in the repository: Slate is now configured, validated
and self-consistent at **API 36**. What is not resolved is that **no Android
artifact exists**, because this environment cannot compile one — four
independent, verified reasons, none of them a code problem.

Gate 3 also found and fixed four defects that would have reached users: a
purchase-token replay that granted Pro on stolen tokens, an Android purchase
flow that could not have opened the Play sheet at all, a rate limit defeated
behind a load balancer, and a funnel where a third of the required analytics
events were declared but never fired.

Not GREEN, because "buildable and billable" cannot be asserted without a
build. Not RED, because nothing is blocked on code — only on a machine.

---

## Android Build

* **Expo SDK:** 54.0.37 (upgraded from 51.0.28)
* **React Native:** 0.81.5 (from 0.74.5) · React 19.1.0 (from 18.2.0)
* **compileSdk:** 36 ✅
* **targetSdk:** 36 ✅
* **AGP:** 8.11.0 (from 8.2.1 — the version that capped Slate at API 34)
* **Gradle:** 8.14.3 · Kotlin 2.1.20
* **AAB verified:** **NO**
* **Build ID:** none — no build was started

**TARGET SDK VERIFIED = YES**, at the configuration level: read back from
`android/gradle.properties` after `expo prebuild --clean`, with a toolchain
that supports it (AGP 8.11 ≥ the 8.9.1 that compileSdk 36 requires, Gradle
8.14.3 ≥ 8.11). Not verified by compilation.

**AAB VERIFIED = NO.** Each path was attempted, not assumed:

1. `eas build --platform android --profile production` → *"An Expo user
   account is required."* No `EXPO_TOKEN` is set.
2. `api.expo.dev` → **403 CONNECT** at the network gateway.
3. Local `./gradlew :app:bundleRelease` → cannot resolve plugins;
   `dl.google.com` and the Gradle Plugin Portal are policy-denied, and the
   JDK 17 toolchain auto-provisioner gets 403 (only JDK 21 is installed).
4. **No Android SDK exists here.** `ANDROID_HOME` unset, no `platform-tools`,
   no `cmdline-tools` — and the SDK is only distributed from the blocked
   Google hosts.

### How the upgrade was done without `expo install --fix`

Gate 0 concluded the SDK 54 upgrade was impossible here because
`api.expo.dev` is blocked. That was right about the API and wrong about the
conclusion: **`registry.npmjs.org` is reachable**, and the manifest
`expo install --fix` consults — `bundledNativeModules.json` — ships inside
the `expo` npm package. Every Expo-managed dependency was pinned from SDK
54.0.37's own manifest. Not hand-picked.

`expo-doctor` confirms it independently: **16/18 checks pass**, including
*"packages match versions required by installed Expo SDK"*, *"required peer
dependencies are installed"*, *"no duplicate dependencies"*, *"native modules
do not use incompatible support packages"* and *"meets version requirements
for submission to app stores"*. Both failures are network-policy artifacts
(Expo config-schema fetch, React Native Directory lookup).

### Why SDK 54 and not 53 or 55

Established from the packages themselves:

| | compileSdk / targetSdk | AGP |
| --- | --- | --- |
| react-native 0.79.6 (SDK 53) | 35 | 8.8.2 |
| **react-native 0.81.5 (SDK 54)** | **36** | **8.11.0** |

SDK 54 is the smallest SDK that reaches API 36. Anything higher would be
upgrading past the requirement.

### Two deliberate Android decisions

**New Architecture is off** (`newArchEnabled=false`). react-native-iap
12.16.4 has no `codegenConfig`, no TurboModule sources and no New Arch
markers — a legacy-bridge module by inspection. Under the New Architecture it
would depend entirely on the interop layer, which cannot be verified without
compiling. Billing is the release-critical subsystem, so it runs on the
architecture it was built for. SDK 54 is the last SDK supporting this; moving
to 55 requires a New-Arch-native billing library first.

**Play Billing Library version lifted into `app.json`.** react-native-iap
resolves `billing-ktx` from `RNIap_playBillingSdkVersion` in its own
`gradle.properties`, making a version Google enforces a hard minimum on an
invisible dependency internal. `plugins/withPlayBilling.js` now writes it from
`app.json`. Pinned at react-native-iap's own tested **7.0.0** rather than
silently raised — see P0-2.

### App identity

`ai.iconic.slate` · versionCode 1 · versionName 1.0.0 ·
`usesCleartextTraffic=false` · effective permissions `INTERNET`, `VIBRATE`,
`com.android.vending.BILLING` · seven permissions stripped via
`blockedPermissions` · `slate://title` and `slate://post` intent filters
intact.

---

## Backend

* **Production host:** not deployed — operator action
* **HTTPS:** enforced client-side (release builds refuse a non-`https://` API
  base URL, and `scripts/check-release-env.mjs` fails the build before that
  can ship); `usesCleartextTraffic=false`. Server-side TLS is the host's job
* **Database:** PostgreSQL via Prisma 5. Verified against a real instance
* **Migrations:** 5, applied in order, **zero schema drift** (`prisma migrate
  diff --exit-code` → 0)
* **Health:** `/health` — liveness, no I/O, verified 200 even with the
  database unreachable
* **Readiness:** `/ready` — **added this gate.** Checks the database and
  reports provider configuration. Verified 200 `"database":"ok"` when up, 503
  `"not_ready"` when down
* **CORS:** allowlist via `WEB_ORIGINS`, not origin reflection. Verified: own
  origin echoed, foreign origin gets no header, no-Origin callers unaffected
* **Rate limiting:** five tiers by abuse cost. Verified live — 11 rapid bad
  logins → 429; AI burst → 429; oversized body → 413
* **Secrets:** all server-side. Grep of `apps/mobile/src`, `app.json`,
  `eas.json` and `web/` for every provider key name and hostname: **no match**

### Added this gate

**Trust proxy.** `AUTH_RATE_LIMIT` keys on `req.ip` to bound credential
brute-forcing, but Fastify only reads `X-Forwarded-For` when told how far to
trust it. Behind a load balancer every request appeared to come from the
balancer, so **the entire internet shared one login budget** — one attacker
could lock everyone out, and a distributed attacker evaded the limit. Added
`TRUST_PROXY`, defaulting to `false` because trusting the header blindly lets
a client forge its own source address. Verified: with `TRUST_PROXY=1` the log
shows the real client IP.

**Production configuration refusals.** The server now declines to start in
production on five misconfigurations that otherwise start happily and fail
later. All five verified to refuse, and a correct configuration verified to
start: identical access/refresh JWT secrets (a refresh token becomes an
access token), leftover `.env.example` placeholders, secrets under 32
characters, a `localhost` `DATABASE_URL`, a plaintext `http://` origin.

**Graceful shutdown.** Without it every rolling deploy dropped in-flight
requests — including half-applied account deletions and purchase
verifications — and leaked connections. Verified end to end on SIGTERM.

> **Operational note:** pnpm does not forward SIGTERM to its grandchild.
> Production must run `node dist/server.js` directly, or graceful shutdown
> never fires.

### Database findings

`EXPLAIN` over every hot path found exactly one real gap:
**`Entitlement.latestPurchaseToken` was unindexed**, so every renewal and
cancellation notification Google sends did a sequential scan over the
entitlements table. Measured at 50k subscribers: planner cost **943 → 8.31**.
Index added. Every other hot path was already covered.

**17 cross-user isolation checks pass** against the live API: private state
stays private, IDOR on posts and comments returns 403, admin routes reject
normal users, and a JWT with a tampered payload claiming `role: ADMIN` is
rejected.

---

## Google Play Billing

* **Monthly product:** `SLATE_PRO_MONTHLY` — $7.99, P1M. Defined in
  `apps/backend/src/config/products.ts`; **not created in Play Console**
* **Annual product:** `SLATE_PRO_YEARLY` — $59.99, P1Y. Same
* **Product discovery:** implemented this gate — fetches Play's offer tokens
  and localized prices. **Not device-verified**
* **Purchase:** implemented; monthly, annual, cancelled, pending and
  already-owned paths all handled. **Not device-verified**
* **Verification:** server-side via `purchases.subscriptionsv2`. Code paths
  fully tested; the Google call itself needs credentials
* **Entitlement:** server-authoritative. 20 tests green
* **Restore:** implemented, including the "belongs to another Slate account"
  case
* **RTDN:** shared-secret authenticated, constant-time compared. 8/8 live
  scenarios pass
* **Replay protection:** **fixed this gate** — see P0-1

### Scenario results

| | Scenario | Result |
| --- | --- | --- |
| A | No entitlement → Free | PASS |
| B | Verified monthly → Pro | PASS |
| C | Verified annual → Pro | PASS |
| D | Expired → Free | PASS |
| E | Pending → not treated as active | PASS |
| F | Invalid product / unusable expiry → rejected | PASS |
| G | Replayed notification → idempotent | PASS |
| G2 | **Concurrent** redelivery → no error | PASS (was failing) |
| H | Unauthorized RTDN → rejected | PASS (4 variants) |
| I | Authorized RTDN → processed | PASS (4 variants) |
| J | Restore → recovered, no duplicate state | PASS |
| K | Token moved to a second account → rejected | PASS (was failing) |
| — | ACTIVE → CANCELLED → EXPIRED transitions | PASS |

All against a real database. The Play API is neither called nor faked — these
drive `applyVerifiedPurchase` with the shape `subscriptionsv2.get` actually
returns, because the code under test is Slate's handling of the answer, which
is where every bug in this subsystem has been.

---

## OpenAI

* **Server-side key:** confirmed. `OPENAI_API_KEY` is read only in
  `apps/backend/src/env.ts` and used only in `ai/openai-provider.ts`. Not
  present anywhere in the mobile bundle
* **Ask Slate:** system prompt forbids inventing release dates, cast, review
  scores, platforms and plot; instructs the model to say it does not know
  rather than guess; respects spoiler sensitivity; redirects off-topic
  requests. Movies, TV and games are explicitly equal
* **Rate limits:** 10/minute burst (verified → 429); 1000-character request
  cap (verified → 400); 500-token output cap; 20-second timeout; 2 retries
* **Free limits:** 5 messages/day — confirmed from the live endpoint
* **Pro limits:** 100 messages/day — a high configurable ceiling, not
  "unlimited", because cost and abuse still need a bound

With no key configured, `/ai/ask` returns **503 `AI_NOT_CONFIGURED`** — never
a fabricated answer.

What reaches OpenAI: the user's message, up to 10 prior messages in that
conversation, their spoiler setting, and the **names** of titles they follow
or have watchlisted. Not their email, handle, display name, account ID or IP —
the request originates from Slate's server.

---

## TMDB / IGDB

* **TMDB:** client implemented against the documented v3 API — movies, TV,
  seasons, images, release dates with precision, trailers, collections.
  **No production key configured here**
* **IGDB:** client implemented against v4 Apicalypse with Twitch
  client-credentials OAuth — search, details, release dates, platforms,
  artwork, the real `hypes` anticipation signal, collections. **No production
  credentials configured here**
* **Attribution:** preserved. "Not endorsed or certified by TMDB / IGDB /
  Twitch" appears on `web/copyright.html` and in the footer of every web page,
  and in the store listing

**Degradation verified live.** With no credentials, `/discover/trending` and
`/search` return `{"results":[],...}` with HTTP 200, and following a title
that is not already cached fails with *"Could not load title from provider"*
rather than inventing one. No fabricated entertainment data anywhere; mock
data exists only in test fixtures.

---

## Notifications

* **In-app:** working and verified. Five types
  (`RELEASE_REMINDER`, `FOLLOWED_TITLE_UPDATE`, `COMMUNITY_REPLY`,
  `COMMUNITY_MENTION`, `SUBSCRIPTION_STATUS`), a master toggle plus per-type
  mutes, unread badge, read state
* **Sweep:** admin-only (anonymous → 401) and **idempotent — verified**: three
  consecutive runs created 4, then 0, then 0
* **Push:** **CONFIGURATION REQUIRED — not built**
* **Device verified:** NO

No push code exists — nothing in the repository falsely claims otherwise, and
the Settings screen tells users plainly that alerts are in-app only.

Adding push is a deliberate non-decision for this gate, not an oversight. It
requires `expo-notifications`, an FCM project, `google-services.json`, a
device-token table and the `POST_NOTIFICATIONS` runtime permission — and it
**changes the Data safety declaration**, because a push token is a new
identifier that `SLATE_DATA_SAFETY_AUDIT.md` and `web/privacy.html` currently
both state is not collected. Shipping it unverified, invalidating Gate 2's
declarations for a feature no device here can test, would trade a verified
position for an unverifiable one.

---

## Analytics

* **Core funnel:** all 21 required events now **actually fire**
* **Purchase events:** `purchase_started`, `purchase_completed`,
  `purchase_failed`, `purchase_restored`, plus `purchase_cancelled` and
  `purchase_pending` added this gate

Six required events were declared in `AnalyticsEventName` but emitted by no
`track()` call anywhere: `search`, `countdown_view`, `ai_open`,
`community_post`, `community_comment`, `community_reaction`. The type said the
funnel was instrumented; it was not measurable. All six are now wired where
the thing actually happens — `search` on the debounced query that runs rather
than per keystroke, `countdown_view` only when a real countdown renders rather
than on a title with no known date.

`purchase_cancelled` matters for the same reason: backing out of the Play
sheet was being recorded as `purchase_failed`, which makes checkout conversion
meaningless. `purchase_pending` separates a payment Google has taken but not
completed from a success that produced no entitlement.

Events are first-party only — Slate's own backend. No third-party analytics
SDK, no advertising identifier.

**Naming:** Slate predates this event list and uses `ai_open`/`ai_message`,
`purchase_completed`, `purchase_restored`, `notification_opened`,
`community_comment` and `community_reaction` for `ask_slate_open`/
`ask_slate_message`, `purchase_success`, `restore_purchase`,
`notification_open`, `comment` and `reaction`. Same events; existing names
kept rather than churning every call site.

---

## Security

* **Auth:** bcrypt passwords; 15-minute access tokens; rotating opaque refresh
  tokens stored hashed and revocable. Forged and tampered tokens rejected —
  including a payload claiming `role: ADMIN`
* **CORS:** allowlist, not reflection. Verified
* **Billing webhook:** shared secret, constant-time compared, 401 without it.
  Four rejection variants verified
* **Rate limiting:** five tiers, now **actually effective behind a proxy**
* **Secrets:** never in the client. Verified by grep across the whole mobile
  surface. Production refuses to start on unsafe secret configuration
* **Account deletion:** unchanged from Gate 2 and re-verified — immediate,
  password re-authenticated, other users' replies survive
* **Request limits:** 128 KB body cap, verified → 413

---

## Play Compliance

* **Target API:** **36** ✅ — *the Gate 2 blocker, now resolved in
  configuration*
* **Permissions:** `INTERNET`, `VIBRATE`, `BILLING`. Seven stripped
* **Data Safety:** answers prepared with evidence
  (`SLATE_DATA_SAFETY_AUDIT.md`). Unchanged by Gate 3 — no new data type, no
  new identifier, no new third party
* **Privacy:** policy written against real data flows; needs a public URL
* **Account deletion:** in-app **and** a working web page. Browser-verified
* **UGC:** guidelines, reporting, blocking, moderation, spoiler gating
* **Subscriptions:** server-authoritative, disclosed before purchase,
  cancellation route named in-app
* **Ads:** none shipped. Declare **"contains ads: No"**
* **Reviewer access:** guide written; needs a demo account

---

## Tests

* **Tests:** 61/61 pass (41 before Gate 3; 20 billing tests added)
* **Typecheck:** PASS ×3 — backend, shared, mobile
* **Lint:** PASS
* **Dependency validation:** `expo-doctor` 16/18; both failures are network
  policy
* **Prebuild:** PASS — `expo prebuild --platform android --clean`
* **Build:** **NOT RUN** — impossible here (see Android Build)

Live verification beyond the suite, all against real infrastructure: 17
cross-user isolation checks, 13 Pro-gating checks, 8 RTDN scenarios, 5
production-config refusals, readiness up/down, graceful shutdown, sweep
idempotency, CORS, rate limits, body limits, provider degradation.

---

## Remaining External Actions

Only what genuinely requires the operator or an external platform.

1. **A build machine** — Android SDK, JDK 17, and access to `dl.google.com`,
   the Gradle Plugin Portal and `api.expo.dev`. Or an EAS account with
   `EXPO_TOKEN`.
2. **Confirm Play's current minimum target API and Billing Library version**
   in Play Console at submission time.
3. **Create the two subscription products** in Play Console at the prices in
   `products.ts`, each with a published base plan — the purchase flow needs an
   offer token, which only exists once a base plan is live.
4. **Play service account** with financial-data and order-management access,
   scoped to the app.
5. **Pub/Sub topic and push subscription** for RTDN.
6. **Licence testers**, including the reviewer demo account.
7. **Production Postgres**, plus `migrate deploy`.
8. **Provider credentials** — TMDB, Twitch/IGDB, OpenAI.
9. **Deploy `web/`** to public HTTPS with no sign-in wall, after filling
   `web/config.js`.
10. **Legal and contact facts** — entity name, support and copyright inboxes,
    domain, jurisdiction, effective date.
11. **Store graphics** — 512×512 icon, 1024×500 feature graphic, screenshots
    from the real running app.
12. **Real device QA** — `SLATE_DEVICE_QA.md`.

Full detail, in gated order: `SLATE_PRODUCTION_CONFIGURATION.md`.

---

## P0 Blockers

**P0-1 — No Android artifact exists.** Four independent environmental causes,
each verified by attempting it (see Android Build). Not a code problem; the
repository is configured and validated at API 36. Resolved by building on a
suitable machine.

**P0-2 — Play Billing Library version is unconfirmed, and raising it may not
be a one-line change.** Slate pins 7.0.0, which is react-native-iap 12.x's own
tested version. Google raises the enforced minimum on roughly an annual
cadence. The version is now a single reviewable value in `app.json`, but a
Billing Library major that the installed react-native-iap was not written
against may not compile — and nothing here can compile to find out. If Play
requires 8+, the tested path is react-native-iap 14+, which needs
`react-native-nitro-modules`, a purchase-flow migration, and a real device
test. **Confirm this before planning the build.**

**P0-3 — The Android purchase flow has never executed.** The offer-token fix
is correct per react-native-iap's own documentation and types, but it is a
native path that cannot be exercised here. Until #27 in `SLATE_DEVICE_QA.md`
passes on a real device with a real Play account, "billable" is unproven.

---

## P1 Remaining

1. **Zero on-device QA** — nothing here has ever run on Android.
   `SLATE_DEVICE_QA.md` is ready to execute.
2. **Store graphics missing** — no 512×512 icon, no feature graphic, no
   screenshots. In-bundle assets are valid PNGs at correct dimensions but
   placeholder artwork. Screenshots additionally depend on P0-1.
3. **Push notifications not built** — CONFIGURATION REQUIRED, deliberately.
   Enabling it changes the Data safety declaration and privacy policy, which
   must be updated together.
4. **Ads not wired** — CONFIGURATION REQUIRED, acceptable per the gate brief.
5. **`ADVANCED_JOURNEY` has no client path** — the backend gate and the
   paywall headline both exist, but no mobile screen saves a journey yet, so
   the trigger cannot currently fire from the app. Feature work, not a defect.
6. **New Architecture must be adopted before Expo SDK 55**, which removes the
   old architecture. Requires a New-Arch-native billing library.
7. **`versionCode` is 1 locally** while `eas.json` uses
   `appVersionSource: "remote"` with `autoIncrement`. EAS is authoritative;
   the local value is inert. Harmless but worth knowing before reading it as
   truth.
8. **No error tracking or APM.** Adding one changes the Data safety "App info
   and performance" section.

---

## Final Recommendation

**Require an external operator action first, then proceed to Gate 4 device QA.**

Slate cannot proceed to device QA from here, because device QA needs a device
build and this environment cannot produce one. That is the only thing standing
between the current state and Gate 4.

The immediate sequence:

1. Confirm Play's current minimum target API **and Billing Library version**
   (P0-2). This is first because the answer may change what gets built.
2. Build on a machine with an Android SDK and unrestricted network. The
   configuration is ready; expect `expo prebuild && ./gradlew :app:bundleRelease`
   to work, and treat any failure as new information rather than an expected
   outcome.
3. Run `SLATE_DEVICE_QA.md`, prioritising #27 purchase, #28 restore,
   #29 entitlement, #30 deletion, and #11/#13 — the DELETE paths that were
   genuinely broken before this gate.
4. Then Gate 4.

The codebase is in better shape than the verdict suggests. Gate 3 removed a
real entitlement-theft vector, repaired a purchase flow that could not have
worked, made a rate limit actually effective, and turned a funnel that only
looked instrumented into one that is. What remains is a machine and a set of
operator facts — not engineering.
