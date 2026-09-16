# Slate Gate 3.5 Report

Generated 2026-09-16 · commit `fbe9c92` · branch
`claude/slate-production-sprint-i5w7gu`

## Billing Version

* **Current RN IAP:** `react-native-iap@14.7.20` (was 12.16.4)
* **Previous Billing Library:** 7.0.0
* **Final Billing Library:** **8.3.0** — `com.android.billingclient:billing-ktx:8.3.0`
* **Supported by current RN IAP:** Yes
* **Migration performed:** Yes — library upgrade, purchase-flow rewrite,
  New Architecture enabled
* **Official compatibility basis:** the artifact chain, inspected end to end

### Why 7.0.0 could not stay

Billing 7's new-app and update deadline was **31 August 2026**, sixteen days
before this commit. The pinned 7.0.0 was already non-compliant, not a future
risk.

### Why react-native-iap 12/13 could not be lifted to Billing 8

Read from the installed source, not from release notes.
`android/src/play/java/com/dooboolab/rniap/RNIapModule.kt`:

| Line | Usage | Status in Billing 8 |
| --- | --- | --- |
| 18 | `import com.android.billingclient.api.PurchaseHistoryRecord` | **Removed** |
| 21 | `import com.android.billingclient.api.QueryPurchaseHistoryParams` | **Removed** |
| 421 | `billingClient.queryPurchaseHistoryAsync(...)` | **Removed** |
| 45 | `BillingClient.newBuilder(ctx).enablePendingPurchases()` (no-arg) | **Removed** — now requires `PendingPurchasesParams` |

Two of these are **imports**, so the module does not merely misbehave — it
fails to resolve and the Kotlin does not compile. `react-native-iap@13.0.4`
pins the same `RNIap_playBillingSdkVersion=7.0.0` and carries the same code.

This is exactly what Gate 3 flagged as P0-2 and declined to override blind.
Forcing the Gradle property to `8.x` would have produced a build failure.

### How Billing 8.3.0 was established

`react-native-iap` 14 stopped pinning Billing directly and delegates to
OpenIAP, so the version appears in no file in this repository. The chain,
each link inspected:

```
react-native-iap 14.7.20
  └─ openiap-versions.json           { "google": "1.3.28" }
     └─ android/build.gradle          implementation
                                      "io.github.hyochan.openiap:openiap-google:${googleVersionString}"
        └─ Maven Central POM          com.android.billingclient:billing-ktx:8.3.0  (compile scope)
```

`pnpm --filter @slate/mobile billing:version` walks that chain and exits
non-zero if the resolved major is below 8:

```
react-native-iap      14.7.20
resolves via          openiap-google:1.3.28
Play Billing Library  com.android.billingclient:billing-ktx:8.3.0 (compile)

OK: Billing Library major 8 meets the required minimum 8.
```

It was also run with `--min 9` and confirmed to **fail** — a guard that cannot
fail is not a guard.

> This substitutes for `./gradlew :app:dependencies`, which is authoritative
> but needs a full Android toolchain. The operator should still run the Gradle
> dependency report on the first real build and confirm it agrees.

### Why not Billing 9

| react-native-iap | openiap-google | Billing Library |
| --- | --- | --- |
| 13.0.4 | — (direct pin) | 7.0.0 |
| **14.7.20** | **1.3.28** | **8.3.0** |
| 15.6.2 | 2.5.2 | 9.1.0 |
| 16.6.1 | 3.5.2 | 9.1.0 |

Billing 9's deadline is August 2028. Taking 15.x or 16.x now would upgrade two
years past the requirement, so 14.x is the smallest version that satisfies it.

### What else the migration required

**New Architecture is now enabled.** react-native-iap 14's Android code lives
in `com.margelo.nitro.iap` and implements Nitro `HybridObject`s; Nitro's
Gradle codegen only runs when `newArchEnabled=true`. Gate 3 disabled the New
Architecture *because* react-native-iap 12 was a legacy bridge module — that
reason no longer exists, and this returns to Expo SDK 54's own default.

**The Gate 3 `withPlayBilling` config plugin was removed.** It wrote
`RNIap_playBillingSdkVersion`, which react-native-iap 14 does not read.
Leaving it would have made the version look pinned in this repository when it
is not — worse than not having it. `billing:version` replaces it.

---

## Billing Security

* **Purchase token uniqueness:** enforced — one token, one account, for life
* **Account binding:** enforced on every path, including after the original
  owner's subscription expires
* **Replay protection:** every Google-reportable state rejected for a second
  account
* **State transitions:** all specified transitions verified
* **RTDN:** 8/8 live scenarios pass
* **Restore:** verified; suspended subscriptions excluded
* **Entitlement:** server-authoritative; no client callback grants Pro

### A renewal bug found by this gate's own test — the most serious defect yet

Writing the required `ACTIVE → IN_GRACE_PERIOD → ACTIVE` test made it fail,
and the root cause turned out to be far wider than grace periods.

The deduplication key was `(purchaseToken, rawStatus)`, which assumes a
subscription never returns to a state it has already been in. Subscriptions do
nothing else: **every renewal reports `ACTIVE` again.** So the second month's
notification looked like a duplicate of the first and was discarded.
`expiresAt` stayed pinned to the first period, and one billing cycle later
`isEntitlementActive` returned false.

**Every subscriber would have lost Pro one billing period after paying, while
Google kept charging them.** Demonstrated directly against the database:

```
after initial purchase:  expiresAt = 2026-10-16 | Pro: true
after renewal:           expiresAt = 2026-10-16 | Pro: true
RENEWAL IGNORED — the paying subscriber's expiry never moved.
expected expiry: 2026-11-15
```

Fixed at the root rather than patched. Applying Google's current answer to the
entitlement is idempotent by nature — writing the same status and expiry twice
is indistinguishable from doing it once — so the entitlement write is now
unconditional, and deduplication is left to the audit log, which is
append-only and genuinely needs it. `PurchaseEvent` gains the reported expiry
and keys on `(purchaseToken, rawStatus, expiresAt)`: a redelivered Pub/Sub
message carries the identical expiry, a renewal moves it. Non-nullable on
purpose — Postgres treats NULLs as distinct, so a nullable column would
silently disable deduplication.

Migration `20260916070000_fix_purchase_event_dedupe_key` backfills existing
rows before applying the constraint.

### Scenario results — 20/20

| Scenario | Result |
| --- | --- |
| A · no entitlement → Free | PASS |
| B · verified monthly → Pro | PASS |
| C · verified annual → Pro | PASS |
| D · expired → Free | PASS |
| E · pending → not active | PASS |
| F · unknown product rejected | PASS |
| F2 · unusable expiry rejected | PASS |
| G · replayed notification idempotent | PASS |
| G2 · concurrent redelivery, no error | PASS |
| J · restore, no duplicate state | PASS |
| K · token cannot move to a second account | PASS |
| K2 · original owner may resubmit | PASS |
| **renewal repeating ACTIVE with a later expiry** | **PASS** (was failing) |
| **ACTIVE → IN_GRACE_PERIOD → ACTIVE** | **PASS** (was failing) |
| ACTIVE → EXPIRED | PASS |
| ACTIVE → CANCELLED → EXPIRED | PASS |
| PENDING → PURCHASED | PASS |
| PENDING → CANCELED | PASS |
| **no state transition transfers ownership** | PASS |
| **ownership survives the owner's own expiry** | PASS |

The ownership test replays a stolen token as `IN_GRACE_PERIOD`, `ON_HOLD`,
`CANCELED`, `EXPIRED`, `PENDING` and `UNSPECIFIED`. Each is a `(token, status)`
pair Slate has not recorded, so the idempotency constraint does not fire and
only the ownership check stands between the attacker and Pro. All six are
rejected, the attacker ends with no entitlement row at all, and exactly one
entitlement holds the token.

### Purchase flow (Part 3) — implemented, not device-verified

1. Query subscription products — `fetchProducts({ skus, type: "subs" })` ✅
2. Receive product details ✅
3. Select valid subscription offer — first offer, the base plan ✅
4. Extract correct offer token — `subscriptionOfferDetailsAndroid[0].offerToken` ✅
5. Initiate purchase with the correct offer — `subscriptionOffers: [{ sku, offerToken }]` ✅
6. Handle pending — `purchaseState === "pending"`, no Pro claimed ✅
7. Handle cancelled — `ErrorCode.UserCancelled`, no error dialog ✅
8. Handle already-owned — `ErrorCode.AlreadyOwned`, directs to Restore ✅
9. Handle failed ✅
10. Send purchase token to backend ✅
11. Verify backend — `purchases.subscriptionsv2` ✅
12. Grant entitlement only after backend verification ✅
13. Acknowledge appropriately — `finishTransaction` **after** verification ✅
14. Refresh entitlement ✅
15. Update UI ✅

Plus **suspended subscriptions** (`isSuspendedAndroid`, Billing 8.1+): the
subscription exists but payment failed, and Play is explicit that entitlements
must not be granted. Suppressed on both purchase and restore.

`requestPurchase` in react-native-iap 14 is **event-based, not
promise-based** — results arrive on `purchaseUpdatedListener` /
`purchaseErrorListener`. That is wrapped back into a promise with listener
cleanup, a product-id guard (Play replays purchases for other SKUs on connect)
and a timeout.

**How far this is verified:** every call is type-checked against
react-native-iap 14's own declarations. That was confirmed to be meaningful,
not vacuous, by deliberately introducing four errors — a bad `ProductQueryType`,
a bogus field inside `AndroidSubscriptionOfferInput`, a non-existent
`ErrorCode` member, and a typo'd field behind the `PurchaseAndroid` type
guard — and confirming the compiler caught each. It has **not** been compiled
natively or run on a device.

---

## Android Build

* **Expo:** 54.0.37
* **RN:** 0.81.5 (React 19.1.0)
* **compileSdk:** 36
* **targetSdk:** 36
* **AGP:** 8.11.0
* **Gradle:** 8.14.3
* **Kotlin:** 2.1.20
* **AAB:** **NO — none produced**
* **Build ID:** none
* **Version:** 1.0.0
* **VersionCode:** 1 in `app.json`; `eas.json` uses
  `appVersionSource: "remote"` with `autoIncrement`, so EAS is authoritative
  and the local value is inert

Both paths were attempted this gate, not carried over from Gate 3:

**EAS** — `eas build --platform android --profile production`:
> An Expo user account is required to proceed.

No `EXPO_TOKEN` is set, and `api.expo.dev` returns **403 CONNECT** at the
network gateway.

**Local Gradle** — `./gradlew :app:bundleRelease`:
> Cannot find a Java installation matching `{languageVersion=17}`. Some
> toolchain resolvers had internal failures: foojay (Unable to tunnel through
> proxy. Proxy returns "HTTP/1.1 403 Forbidden").

Three independent blockers, each verified:
1. **No JDK 17.** Only JDK 21 is installed, and the foojay auto-provisioner is
   403-blocked.
2. **No Android SDK.** `ANDROID_HOME` unset; no `platform-tools`, no
   `cmdline-tools`.
3. **`dl.google.com` is policy-denied (403 CONNECT).** AGP, androidx and the
   Billing artifacts all live on Google's Maven, and they are **not** mirrored
   on Maven Central (confirmed: HTTP 404).

Installing a JDK 17 would not help, because (2) and (3) would still stand and
the Android SDK is itself only distributed from the blocked Google hosts.

*Changed since Gate 3:* the Gradle Plugin Portal is now reachable (was
denied). It moved the local failure from plugin resolution to the JDK
toolchain, one step further, but not to a build.

---

## AAB Static Inspection

**Not performed — there is no AAB to inspect.**

Everything below is what the *generated native project* shows after
`expo prebuild --platform android --clean` on this commit. It is the input to
a build, not the output of one, and is reported as such.

* **Package:** `ai.iconic.slate` (`namespace` and `applicationId`)
* **Permissions:** `INTERNET`, `VIBRATE`, `com.android.vending.BILLING`.
  Seven stripped via `blockedPermissions` (location ×2, camera, microphone,
  `SYSTEM_ALERT_WINDOW`, external storage read/write)
* **Cleartext traffic:** `usesCleartextTraffic="false"`
* **Secrets:** none. Grep of `apps/mobile/src`, `app.json`, `eas.json` and
  `web/` for every provider key name, hostname and private-key pattern returns
  no match. No Supabase service-role key, no OpenAI key, no Twitch secret, no
  TMDB credential
* **Production host:** **not set, by design.** `eas.json` deliberately carries
  no `EXPO_PUBLIC_API_BASE_URL` for `preview`/`production`, and
  `scripts/check-release-env.mjs` runs as the `eas-build-pre-install` hook and
  **fails the build** if it is missing, non-HTTPS, a reserved placeholder host
  (`.example`, `.invalid`, `.test`, `.localhost`) or a local address. Verified
  to refuse with nothing set
* **Billing dependency:** `com.android.billingclient:billing-ktx:8.3.0`,
  resolved transitively via `openiap-google:1.3.28`
* **Release signing:** no keystore configured. EAS-managed or operator-supplied

The full Part 7 inspection must be run against the real artifact once one
exists — `bundletool`/`aapt2 dump badging` for package, targetSdk, permissions
and signing, and `apksigner verify` for the signature.

---

## External Operator Actions

1. **A build environment.** Either:
   - **EAS** — an Expo account, a linked project, and `EXPO_TOKEN`; or
   - **Local** — **JDK 17** (Expo SDK 54 / RN 0.81 requires it; 21 is not
     accepted by the RN Gradle plugin's toolchain spec), **Android SDK
     Platform 36**, **Build Tools 36.0.0**, **NDK 27.1.12297006**, Gradle
     8.14.3 (the wrapper fetches it), and unrestricted access to
     `dl.google.com`, `plugins.gradle.org` and `repo1.maven.org`.
2. **Android signing credentials** — EAS-managed keystore or your own upload
   key. Back it up; losing it means the app can never be updated. Enrol in
   Play App Signing.
3. **`EXPO_PUBLIC_API_BASE_URL`, `EXPO_PUBLIC_WEB_BASE_URL`,
   `EXPO_PUBLIC_SUPPORT_EMAIL`** as EAS environment variables — the release
   guard fails the build without them.
4. **Confirm Billing 8 is still Play's minimum** at submission time. Billing 9
   becomes mandatory 31 August 2028; `pnpm --filter @slate/mobile
   billing:version --min 9` is the one-line check, and moving to Billing 9
   means react-native-iap 15+.
5. **Create the two subscription products** in Play Console, each with a
   **published base plan** — the purchase flow needs an offer token, which
   only exists once a base plan is live.
6. Everything else already listed in `SLATE_PRODUCTION_CONFIGURATION.md`
   (database, provider credentials, Play service account, RTDN topic, web
   hosting, legal facts).

---

## Remaining Blockers

1. **No build environment.** Three independent, verified causes in this
   sandbox — no JDK 17, no Android SDK, `dl.google.com` policy-denied. Not a
   code problem: the repository prebuilds cleanly at API 36 and every
   dependency resolves.
2. **The native build of the billing migration is unverified.** Type-checking
   is strong evidence the JavaScript is correct, and it caught four deliberate
   errors when tested. It says nothing about whether Nitro's codegen, the New
   Architecture switch and openiap-google compile together. The first build
   carries three simultaneous unverified native changes — react-native-iap 14,
   `react-native-nitro-modules`, and `newArchEnabled=true` — and if it fails,
   those are the three suspects, in that order.
3. **No device QA.** `SLATE_DEVICE_QA.md` is ready; test #27 (purchase) and
   #28 (restore) now additionally cover the rewritten flow.

---

## Verdict

**RED.**

Not because billing is unresolved — that objective is complete. The Billing
Library question is answered with evidence, the migration is done, the
compliance gap that already existed on 31 August 2026 is closed, and the
security properties this gate specified are verified across all twenty
scenarios. A renewal bug that would have cost every subscriber their
subscription after one billing period was found and fixed.

RED because the gate's own scale allows nothing else. GREEN and YELLOW both
require that a first real AAB exists. None does, and none can be produced
here: no JDK 17, no Android SDK, and Google's Maven is denied at the network
gateway. Reporting anything other than RED would mean claiming a build that
does not exist.

The distinction that matters for the next step: **this is an environment
blocker, not an engineering one.** Nothing in the codebase is waiting on more
work before a build can be attempted. Put this commit on a machine with JDK 17,
Android SDK Platform 36 and normal network access — or supply an `EXPO_TOKEN` —
and the build is the next thing that happens.
