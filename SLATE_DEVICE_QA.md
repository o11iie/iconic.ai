# SLATE — Real Device QA Matrix

**Nothing in this repository has ever run on an Android device.** Every
verification to date has been against a real Postgres database, a real
browser, and the real generated Gradle configuration — but no APK or AAB has
been built, installed or exercised. This matrix is what closes that gap.

**Prerequisite:** an installable artifact. See
`SLATE_PRODUCTION_CONFIGURATION.md` → REQUIRED BEFORE BUILD.

## How to run it

1. Build a **development build** (`eas build --profile development` or
   `npx expo run:android`). Expo Go is not sufficient — `react-native-iap`
   needs native code and will not load.
2. Sign in as the seeded demo account from `SLATE_PLAY_REVIEWER_GUIDE.md`,
   registered as a Play **licence tester** so purchases complete unbilled.
3. Work down the table. For each failure: reproduce it, capture evidence
   (screenshot, `adb logcat` extract, the API response), classify it, and
   record it in the log at the bottom.

## Severity

| | Meaning | Action |
| --- | --- | --- |
| **P0** | Blocks release. Crash, data loss, money taken without entitlement, entitlement granted without money, account deletion failing, security hole. | Fix and retest before any further QA. |
| **P1** | Materially degrades the product but does not block. A core flow that works with a workaround, a wrong price display, a broken back gesture. | Fix before production rollout. |
| **P2** | Polish. Visual glitch, copy, spacing, minor jank. | Log and schedule. |

## The matrix

| # | Test | Expected | Priority if broken |
| --- | --- | --- | --- |
| 1 | Fresh install | App launches to the login screen, no crash, no blank frame | P0 |
| 2 | Update over an existing install | Opens signed in, no data loss, no migration crash | P0 |
| 3 | Signup | Account created, tokens stored in SecureStore, lands on Discover | P0 |
| 4 | Login | Succeeds; wrong password shows an error and does not sign in | P0 |
| 5 | Logout | Tokens cleared; relaunch shows login, not a stale session | P0 |
| 6 | Search | Results across movies, TV and games from one query | P0 |
| 7 | Movie details | Real synopsis, release date, countdown | P0 |
| 8 | TV details | Seasons listed; countdown reflects the next episode or release | P0 |
| 9 | Game details | Platforms, developer and IGDB anticipation shown | P0 |
| 10 | Follow | Persists across relaunch; appears in Release Radar | P0 |
| 11 | Unfollow | Removed and stays removed — **note:** this path was broken before Gate 3 (bodyless DELETE sent a JSON content-type and got 400). Verify specifically. | P0 |
| 12 | Watchlist add | Appears with the chosen status | P0 |
| 13 | Watchlist remove | Same DELETE fix as #11. Verify specifically. | P0 |
| 14 | Countdown | Counts to the real date; an imprecise date shows its precision, never a fabricated day | P1 |
| 15 | Release Radar | Grouped by window across all three media types; Free shows 14 days | P1 |
| 16 | Watch/Play Journey | Steps in real release order; progress reflects completed watchlist entries | P1 |
| 17 | Hype Score | Renders and is stable between refreshes | P2 |
| 18 | Ask Slate | Answers on-topic; refuses to invent facts; off-topic redirected | P1 |
| 19 | Community post | Posts, appears in the feed, survives relaunch | P1 |
| 20 | Comment | Posts and appears under the right thread | P1 |
| 21 | Reaction | Count updates optimistically and matches after refresh | P2 |
| 22 | Spoiler content | Marked posts stay hidden until tapped, per the account's setting | P1 |
| 23 | Report | Submits; confirmation shown; reaches the moderation queue | P1 |
| 24 | Block | Blocked account's posts and comments disappear immediately; Settings lists the block; unblock restores | P1 |
| 25 | Notification preferences | Master toggle and all five per-type toggles persist across relaunch | P1 |
| 26 | Pro paywall | Opens with the headline matching the trigger that caused it — check FOLLOW_LIMIT (11th follow) and AI_LIMIT (6th question) specifically | P1 |
| 27 | **Play purchase** | Play sheet opens with the correct localized price; purchase completes; Pro appears **only after** server verification — **note:** the offer-token fix in Gate 3 is unverified by compilation. If the Play sheet fails to open, this is the first suspect. | **P0** |
| 28 | Restore purchases | On a reinstall, Pro is recovered; a subscription belonging to another Slate account reports that clearly rather than failing generically | **P0** |
| 29 | Pro entitlement | All Pro limits lift; expiring or revoking the entitlement server-side drops the app back to Free on refresh | **P0** |
| 30 | Account deletion | In-app path deletes immediately; login afterwards fails; a user with an active subscription is told to cancel in Play | **P0** |
| 31 | Deep link | `adb shell am start -a android.intent.action.VIEW -d "slate://title/movie:27205"` lands on that title; `slate://post/<id>` lands on that post | P1 |
| 32 | Offline / error state | Airplane mode shows an error state, not a crash or an infinite spinner; recovers when connectivity returns | P1 |
| 33 | App relaunch | Session restored; no re-login; no flash of the login screen | P1 |
| 34 | Background / foreground | State preserved; entitlement refreshed on resume | P1 |
| 35 | Android back navigation | Back never strands the user; back from a root tab exits rather than looping | P1 |

## Changed again in Gate 4 — read before running

Gate 4 fixed a broken workflow and six misleading failure states. Verify these
specifically, because they were wrong until this commit:

| # | Test | Verify specifically |
| --- | --- | --- |
| — | **My Slate → title → "+ New post"** | Opens the composer. This did nothing at all before Gate 4 — the route was never registered. Same for tapping a community post from My Slate |
| 12/13 | Watchlist | Shows skeletons on first open, **not** a flash of "Your watchlist is empty". Pull-to-refresh works. In airplane mode it says Slate couldn't load it, not that the list is empty |
| 6 | Search | In airplane mode shows a retry error, **not** "No results for X" |
| 25 | Notifications | In airplane mode shows an error, not "Nothing yet" |
| 26 | Pro paywall | With the API unreachable, shows an error with Try again — **not** a spinner that never resolves |
| 24 | Block | Open a blocked author's post by deep link: shows "This post isn't available", not a permanent spinner |
| — | Settings | Shows TMDB and IGDB attribution under Data sources |
| — | Accessibility | Turn on TalkBack: every button announces a role; a title card reads as one sentence |

## Changed in Gate 3.5 — read before running

The billing stack was replaced, not tweaked. Tests #27–#29 now exercise
react-native-iap 14 on Play Billing 8.3.0, through a rewritten, event-based
purchase flow, on the React Native New Architecture. None of it has been
compiled natively.

Additional checks for this build:

| # | Test | Also verify |
| --- | --- | --- |
| 1 | Fresh install | The app launches at all. New Architecture is newly enabled; a crash citing Nitro, JSI or TurboModules points there |
| 27 | Play purchase | The Play sheet opens with the correct localized price; a **renewal** extends expiry rather than being ignored (the Gate 3.5 fix — visible only across a billing period or a test-track short renewal) |
| 28 | Restore | A suspended subscription reports "payment needs attention" rather than silently restoring nothing |
| 29 | Pro entitlement | Pro appears only after server verification, and the purchase is acknowledged — an unacknowledged purchase is auto-refunded by Google after three days |
| — | Dependency tree | `./gradlew :app:dependencies \| grep billingclient` shows `billing-ktx:8.3.0` |

## Tests this build's specific changes make worth extra attention

Gate 3 changed code that could not be compiled here. These are the places to
look first if something misbehaves:

- **#27 Play purchase** — the purchase call now passes `subscriptionOffers`
  with an offer token, which is mandatory on Play Billing 5+. This is the
  single most important untested change.
- **#11, #13 unfollow / watchlist remove** — the `Content-Type` fix on
  bodyless DELETEs. These were genuinely broken before.
- **Any crash on launch** — the app runs on the React Native old architecture
  (`newArchEnabled=false`) under Expo SDK 54 deliberately, so that
  react-native-iap runs on the architecture it was built for. A launch crash
  citing TurboModules or the interop layer points here.
- **#31 deep links** — routing was added this gate; the intent filters are
  unchanged.

## Failure log

Copy a row per defect.

| # | Test | What happened | Evidence | Severity | Fix | Retested |
| --- | --- | --- | --- | --- | --- | --- |
| | | | | | | |

## Exit criteria

- [ ] Every **P0** passes.
- [ ] Every **P1** either passes or is logged with a scheduled fix.
- [ ] #27, #28, #29 and #30 pass on a real device with a real Play account.
- [ ] Both account-deletion paths verified on the submitted build.
- [ ] No crash in `adb logcat` across a full pass.
