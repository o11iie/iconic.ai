# Slate Gate 4 QA Report

Generated 2026-09-16 · commit `1da95fb` · branch
`claude/slate-production-sprint-i5w7gu`

## Overall Verdict

**YELLOW**

The product is coherent and finished as software. This gate found and fixed
one workflow that could not complete, six screens that told users their data
was gone when a request had failed, missing provider attribution inside the
app, a conversion event that was routinely lost, and 28 interactive elements
with no accessibility role. All are fixed and verified.

YELLOW rather than GREEN for one reason only: **no part of this has ever run
on an Android device.** Every finding here came from live backend exercise
against real Postgres and from reading the code — both real, neither a
substitute for a build. Nothing is known to be broken; a whole class of
defects simply cannot be observed from here.

---

## Core User Journeys

Exercised end to end against a live API and a real database — 45 checks,
45 passing. Where a step is UI-only it is marked as audited, not exercised.

* **Install:** Not verifiable here — no build exists
* **Onboarding:** PASS — signup returns tokens, no `passwordHash` in the
  response, login/wrong-password round trip correct
* **Home:** PASS — trending, upcoming and For You all respond; loading,
  empty and error states all present and distinct (audited)
* **Movies:** PASS — detail, search and discovery respond and degrade without
  a provider key rather than crashing
* **TV:** PASS — same, plus seasons and episode expansion
* **Games:** PASS — same, plus platforms, developer and IGDB anticipation
* **Search:** PASS — **fixed this gate.** A failed request rendered
  "No results for X"; now a distinct error state with retry
* **Following:** PASS — follow, list, unfollow (including the bodyless DELETE
  that was broken before Gate 3) all verified live
* **Watchlist:** PASS — **fixed this gate.** Had no loading state, so the
  empty state flashed on every open, and a failure rendered as "your watchlist
  is empty". Now three states plus pull-to-refresh
* **Countdown:** PASS — precision discipline holds; a month/quarter/year-only
  date is shown as such, never resolved to a fabricated day
* **Release Radar:** PASS — 14-day free horizon reported honestly with
  `truncatedByPlan`
* **Watch Journeys:** PARTIAL — backend and gating verified; no mobile screen
  saves a journey yet, so `ADVANCED_JOURNEY` cannot fire from the app
* **Hype Intelligence:** PASS — real IGDB anticipation, no invented score
* **Ask Slate:** PASS — returns 503 `AI_NOT_CONFIGURED` without a key rather
  than a fabricated answer; free limit 5/day confirmed live
* **Community:** PASS — post, comment, react, report, spoiler flag round trip,
  block, unblock all verified live
* **Pro:** PASS — **fixed this gate.** The paywall spun forever if the
  catalogue request failed. Prices, product IDs and derived savings verified
* **Settings:** PASS — preferences persist; **attribution added this gate**
* **Account deletion:** PASS — wrong password 403, missing confirmation 400,
  deletion 200, login afterwards 401, authored posts anonymised not destroyed

---

## Slate Differentiation

* **My Slate:** Works; recommendations correctly withheld on Free; error state
  present
* **Release Radar:** Works; free horizon and truncation reported honestly
* **Watch Journeys:** Backend correct; **no client entry point** — the one
  feature whose gate cannot currently be reached from the app
* **Hype Intelligence:** Real provider signal only
* **Ask Slate:** Context-aware, entertainment-scoped, anti-fabrication rules in
  the system prompt, server-side limits
* **Countdown:** Precision-honest
* **Following:** Works, limit fires at exactly 10 with `FOLLOW_LIMIT`
* **Watchlist:** Works, now with correct states

---

## Billing

* **Billing Library:** 8.3.0 (`com.android.billingclient:billing-ktx`), via
  `openiap-google:1.3.28`. Guard: `pnpm --filter @slate/mobile billing:version`
* **RNIAP:** 14.7.20
* **Purchase:** Implemented against the event-based API with offer tokens,
  pending, cancelled, already-owned, suspended and failed all handled.
  **Not device-verified**
* **Restore:** Implemented; suspended subscriptions excluded; a subscription
  owned by another Slate account reported distinctly
* **Renewal:** PASS — the Gate 3.5 fix holds. Regression test proves a repeated
  ACTIVE state with a later expiry extends the entitlement
* **Expiry:** PASS
* **RTDN:** PASS — 8/8 live scenarios, including four rejection variants
* **Entitlement:** Server-authoritative; 20/20 billing scenarios pass

---

## Security

Re-run in full this gate, live.

* **Auth:** PASS — bcrypt, short-lived access tokens, rotating hashed refresh
  tokens; forged and tampered tokens rejected, including a payload claiming
  `role: ADMIN`
* **Authorization:** PASS — 17/17 isolation checks; IDOR on posts and comments
  returns 403; admin routes reject normal users
* **Blocking:** PASS — blocked content disappears for the blocker, bystanders
  and anonymous viewers unaffected, the blocked user cannot enumerate who
  blocked them, direct links 404 rather than confirming existence
* **Deletion:** PASS — other users' replies survive; deleting a blocker
  removes their blocks
* **CORS:** PASS — own origin allowed, foreign origin refused
* **Rate limits:** PASS — 429 after the auth budget; AI burst limit; analytics
  and write tiers
* **Secrets:** PASS — no server secret in `apps/mobile/src`, `app.json`,
  `eas.json`, `web/` or `packages/shared`; no `.env` tracked. **404 responses
  no longer echo Fastify's routing format** (fixed this gate)
* **AI:** PASS — 1000-char request cap (400), 500-token output cap, 20s
  timeout, burst limit, per-day quota, key server-side only

---

## Performance

Measured where measurable; the rest is a code audit, stated as such.

* **Cold start:** Not measurable without a build
* **Home:** Skeletons present; single load per focus
* **Search:** 350ms debounce; stale-response guard by active query; paginated
* **Details:** Single fetch per title; seasons lazy-loaded on expand
* **Feed:** Cursor-paginated; long lists use FlatList (virtualized)
* **AI:** Server-side timeout and token cap
* **Database:** `EXPLAIN` over every hot path — all index-served. The Gate 3
  RTDN index and Gate 3.5 dedupe key are both present, and the composite key
  was confirmed at 50k rows to serve the purchase-token ownership lookup
  (planner cost 1093 → 8.43)

One unbounded render remains: post comments use `.map()` inside a ScrollView
(P2 below).

---

## Accessibility

* **Touch targets:** PASS — sub-44dp targets now use `minHeight`
  (genre chips, title actions) or `hitSlop` where a 44dp box would distort the
  layout (inline text links)
* **Labels:** PASS — **0 of 47 touchables lack `accessibilityRole`** (was 28
  missing). TitleCard announces one sentence rather than three nodes;
  follow/watchlist/season toggles expose `accessibilityState`
* **Contrast:** Audited — single dark token set, muted text reserved for
  secondary content
* **Text scaling:** No `allowFontScaling={false}` anywhere, so system text
  scaling is respected
* **Navigation:** PASS — every `navigate()` target is registered in its stack,
  now enforced by a guard

---

## Analytics

* **Funnel:** PASS — all 21 required events fire. Slate's names differ for
  seven of them (`ai_open` for `ask_slate_open`, `purchase_completed` for
  `purchase_success`, and five more); mapping in `SLATE_GATE_3_REPORT.md`
* **Purchase:** PASS — started, completed, failed, restored, plus cancelled
  and pending so a backed-out checkout is not counted as a failure
* **Errors:** Batched, requeued on failure, queue capped at 200 events
* **Duplication:** No duplicate storms — single interval timer, guarded. A
  request that succeeds server-side but times out client-side will be
  requeued and double-counted (P2 below)

**Fixed this gate:** `flushAnalytics` was exported and never called, so
backgrounding the app dropped up to ten seconds of events — including
`purchase_completed`, which usually fires immediately before the user leaves.

---

## Automated Tests

* **Tests:** 68 total · **68 passed** · 0 failed · 0 skipped
* **Typecheck:** PASS ×3 (backend, shared, mobile)
* **Lint:** PASS

Plus, live and outside the suite: 45-step user journey, 17 isolation checks,
8 RTDN scenarios, the full blocking scenario, CORS, rate limits, body cap,
`EXPLAIN` on every hot query, `expo prebuild`, the navigation guard and the
billing-version guard.

No test was weakened, skipped or deleted. Two apparent failures during this
gate were traced to my own test harness (a wrong endpoint, and a bodyless
DELETE sent with a JSON content-type) and the harness was corrected, not the
assertion.

---

## P0 Issues

**None found, and none outstanding.**

---

## P1 Issues

All five were found and fixed in this gate.

1. **My Slate → title → "+ New post" / any post did nothing.** `MySlateStack`
   never registered `NewPost` or `PostDetail`. *Fixed, plus a guard so it
   cannot recur.*
2. **Six screens rendered failures as empty states**, telling users their
   watchlist, notifications or search results were empty when the request had
   failed. *Fixed.*
3. **The paywall and post detail could spin forever.** A single failed request
   left the screen that takes money with no content, no error and no retry.
   Post detail was reachable normally, because a blocked author's post 404s by
   design. *Fixed.*
4. **No TMDB/IGDB attribution in the app.** Present on the website and store
   listing, absent where the data is actually shown. *Fixed.*
5. **`purchase_completed` was routinely lost.** Analytics flushed on a
   10-second timer with no flush on background. *Fixed.*

---

## P2 Issues

Logged, not fixed — none justifies delaying a release.

1. **Post comments render unbounded.** `.map()` inside a ScrollView; a post
   with hundreds of comments renders all of them. Converting to a FlatList
   means restructuring the screen, which is more risk than the problem during
   a freeze gate.
2. **Analytics can double-count on a client timeout.** A request that succeeds
   server-side but times out is requeued. Affects analytics accuracy only, not
   entitlement or billing.
3. **`versionCode` is 1 in `app.json`** while `eas.json` uses remote
   versioning with `autoIncrement`. EAS is authoritative; the local value is
   inert but misleading to read.
4. **Watch Journeys have no client entry point,** so `ADVANCED_JOURNEY` cannot
   fire from the app. Feature work, deliberately not done under the freeze.

---

## Documented, Not Built

Per Part 1 — noticed during the audit, deliberately not implemented:

* A "share countdown" action (the `countdown_share` analytics event exists
  with no UI behind it).
* Per-title spoiler overrides — the Pro benefit is gated server-side, but the
  UI still offers only the global setting.
* A retry affordance on the Ask Slate error notice.

---

## External Configuration

Only what the operator must do. Full detail in
`SLATE_PRODUCTION_CONFIGURATION.md`.

1. **A build environment** — JDK **17** specifically, Android SDK Platform 36,
   Build Tools 36.0.0, NDK 27.1.12297006, and reachable `dl.google.com`; or an
   EAS account with `EXPO_TOKEN`.
2. **Release signing.** `expo prebuild` emits the Expo template default, where
   the release build type uses `signingConfigs.debug`. EAS replaces this at
   build time; a **local** `./gradlew bundleRelease` without configured signing
   produces a debug-signed AAB that Play rejects at upload.
3. **`EXPO_PUBLIC_API_BASE_URL`, `EXPO_PUBLIC_WEB_BASE_URL`,
   `EXPO_PUBLIC_SUPPORT_EMAIL`** as EAS environment variables. `preview` and
   `production` deliberately carry none, and the pre-install guard fails the
   build without them.
4. **Two subscription products** in Play Console, each with a **published base
   plan** — the purchase flow needs an offer token, which only exists once a
   base plan is live.
5. **Backend production configuration** — database plus `migrate deploy`,
   provider credentials, Play service account, RTDN topic and secret,
   `WEB_ORIGINS`, `TRUST_PROXY`.
6. **Deploy `web/`** to public HTTPS after filling `web/config.js`.
7. **Store graphics** — 512×512 icon, 1024×500 feature graphic, screenshots
   from the real running app.
8. **Confirm Billing 8 is still Play's minimum** at submission.

---

## Final Release Decision

**2. READY AFTER P0/P1 FIXES**

Every P0 and P1 identified in this gate has been fixed and verified —
navigation, failure states, the paywall dead end, attribution, analytics
attribution and accessibility. The automated suite is 68/68 with nothing
weakened to get there.

The remaining work before a production release is not product work. It is a
build environment, real device QA, and operator configuration. The honest
sequence:

1. Build on a machine with JDK 17 and Android SDK 36.
2. Run `SLATE_DEVICE_QA.md` — 35 tests, prioritising purchase, restore,
   entitlement, account deletion, and the two DELETE paths that were once
   broken. Treat any launch crash citing Nitro or JSI as the New Architecture
   switch from Gate 3.5.
3. Complete operator configuration.
4. Ship to an internal track before production.

Slate is finished as a product. It is unproven as an Android application, and
those are different statements.
