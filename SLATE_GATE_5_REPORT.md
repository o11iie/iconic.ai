# Slate Gate 5 Report

Generated 2026-09-16 · commit `4b6abef` (+ this gate's tooling) · branch
`claude/slate-production-sprint-i5w7gu`

> **No AAB was produced and no device test was run.** Every field below that
> would describe an artifact says so. Nothing in this report is inferred from
> what a build "would" contain.

## Build

* **Build method:** none — neither path is available in this environment
* **Expo:** 54.0.37
* **React Native:** 0.81.5 (React 19.1.0)
* **compileSdk:** 36
* **targetSdk:** 36
* **Billing:** `com.android.billingclient:billing-ktx:8.3.0`, resolved via
  `openiap-google:1.3.28`
* **RNIAP:** 14.7.20
* **Version:** 1.0.0
* **VersionCode:** 1 in `app.json`; `eas.json` uses `appVersionSource:
  "remote"` with `autoIncrement`, so EAS assigns the real one
* **AAB:** **NONE**
* **Build ID:** none

### Why neither path could run

The gate said not to fight blocked infrastructure in the previous sandbox.
This is still that sandbox. One bounded probe, then I stopped:

**Path A — EAS: impossible.**
`EXPO_TOKEN` is unset, and both `api.expo.dev` and `expo.dev` are unreachable
(HTTP 000, 403 CONNECT at the network gateway). There is no account to
authenticate and no endpoint to authenticate against.

**Path B — local: impossible.**
No JDK 17 (only 21 is installed, and React Native 0.81's Gradle plugin
declares a `languageVersion=17` toolchain). No Android SDK — `ANDROID_HOME`
unset, `sdkmanager` absent. `dl.google.com` policy-denied, which is where AGP,
androidx and the Billing artifacts live; they are not mirrored on Maven
Central. Of the Android toolchain — `adb`, `aapt`, `aapt2`, `bundletool`,
`apksigner`, `zipalign`, `sdkmanager`, `avdmanager`, `emulator` — **none is
installed**. Only `keytool` exists, because it ships with the JDK.

**Part 6 — physical device: categorically impossible.**
`adb` is not installed and `/dev/bus/usb` contains **zero USB buses**. This is
not a network policy that could be lifted: there is no Android hardware
attached to this machine and no mechanism by which there could be. Even given
an AAB, Part 6 could not have been executed.

---

## Signing

* **Release signing:** not applicable — no artifact was produced
* **Debug signing:** not applicable — no artifact was produced
* **Credentials source:** none configured. No keystore exists in this
  repository, and none should

**The trap remains live for whoever builds.** `expo prebuild` emits Expo's
template default, in which the *release* build type uses
`signingConfigs.debug`. EAS replaces this at build time. A local
`./gradlew bundleRelease` without configured signing produces a debug-signed
AAB that looks entirely normal — and the Android debug key is public, so
anyone can forge updates for anything signed with it.

This gate added `scripts/verify-aab.mjs` to catch exactly that (below).

---

## AAB Inspection

**Not performed — there is no AAB.**

What follows is the *release configuration* read from the repository. It is
the input to a build, not the output of one, and is reported as such.

* **Application ID:** `ai.iconic.slate`
* **Target SDK:** 36 (`compileSdkVersion` 36, `minSdkVersion` 24)
* **Permissions:** `INTERNET`, `VIBRATE`, `com.android.vending.BILLING`;
  seven stripped via `blockedPermissions`
* **Billing:** 8.3.0, verified through the artifact chain by
  `pnpm --filter @slate/mobile billing:version`
* **Cleartext:** `usesCleartextTraffic: false`
* **Production API:** deliberately unset. `eas.json` carries no
  `EXPO_PUBLIC_API_BASE_URL` for `preview`/`production`, and
  `scripts/check-release-env.mjs` fails the build when it is missing,
  non-HTTPS, a reserved placeholder host or a local address
* **Secrets:** none in `apps/mobile/src`, `app.json`, `eas.json`, `web/` or
  `packages/shared`; no `.env` tracked
* **Debug configuration:** `android:debuggable` absent from the generated
  release manifest

### What this gate contributed instead: `verify-aab.mjs`

Part 5 is a twelve-point manual inspection that has to be done on the real
artifact, by someone with an Android SDK. I cannot do it, so I automated as
much of it as is possible without one — an AAB is a zip, and the checks that
matter most do not need `bundletool`.

`pnpm --filter @slate/mobile verify-aab <path-to.aab>` checks:

- the file is genuinely an app bundle
- it is signed, and **not** with the Android debug key
- the shipped JS bundle contains no OpenAI key, no private key, no
  `service_role`, no `localhost`, no emulator loopback, no reserved
  placeholder host and no cleartext `http://` endpoint
- the manifest declares no permission outside the expected three

It prints the exact `bundletool` and `apksigner` commands for what it *cannot*
check, rather than implying more coverage than it has.

**It was tested against four synthetic bundles** — fixtures built to exercise
the script, containing no Slate code:

| Fixture | Expected | Result |
| --- | --- | --- |
| Debug-signed | FAIL | FAIL — "DEBUG-SIGNED … the key is public" |
| Release-signed, clean | PASS | PASS |
| Secrets + localhost + placeholder host + camera/location permissions | FAIL | FAIL — all four reported |
| Unsigned | FAIL | FAIL — "UNSIGNED — no META-INF signature block" |

**The first version of this script failed its own test.** It reported a
debug-signed bundle as *"release (non-debug key)"* — a false PASS on the one
check it exists to perform. `keytool -printcert -file` cannot parse a raw
extracted PKCS#7 block, and the code fell through to the success branch
instead of failing. Fixed to use `-jarfile`, and to **fail closed**: a signing
check that cannot read the signature now reports failure rather than success.
I would not have found that without building the fixtures.

---

## Physical Device

Every field: **not performed.** No Android device exists in this environment
(no `adb`, zero USB buses), and no artifact exists to install.

* **Device:** none
* **Android version:** n/a
* **Installation:** not performed
* **Launch:** not performed
* **Signup:** not performed
* **Login:** not performed
* **Home:** not performed
* **Search:** not performed
* **Movie:** not performed
* **TV:** not performed
* **Game:** not performed
* **Follow:** not performed
* **Watchlist:** not performed
* **Countdown:** not performed
* **My Slate:** not performed
* **Background/foreground:** not performed
* **Back navigation:** not performed

Each of these *is* exercised against the live API and real Postgres — 45 steps
from signup to account deletion passed in Gate 4 — but that verifies the
server contract, not rendering, gestures, memory or the native billing path.
They are different claims and I am not going to blur them.

---

## Problems Found

### P0

1. **No production AAB exists.** Both build paths are unavailable here, for
   four independently verified reasons. Blocks the gate entirely.
2. **No physical device exists.** Not a configuration issue — no Android
   hardware is attached and none can be. Part 6 is unexecutable from here.

Neither is a defect in Slate. No code change would resolve either.

### P1

None found. Nothing in this gate changed product code.

### P2

1. **Release signing is still the Expo template default**, so a local
   `bundleRelease` without configured signing silently produces a debug-signed
   artifact. Left as an operator action rather than patched, because hardcoding
   a keystore path this repository cannot know would break the EAS path, which
   injects credentials its own way. `verify-aab.mjs` now catches the outcome.
2. **`versionCode` is 1 in `app.json`** while EAS assigns the real one
   remotely. Inert, but it reads as truth.
3. **The DB-backed test suite fails rather than skips when `DATABASE_URL` is
   set but the database is unreachable.** Noticed when Postgres stopped
   mid-gate: the run reported `1 failed | 20 skipped` instead of a clean skip.
   Arguably correct for CI — you declared a database and there wasn't one — so
   left alone, but worth knowing before misreading a run.

---

## Verification that *was* possible

Product code is untouched by this gate. Re-run to confirm nothing regressed:

* **Tests:** 68/68 pass (48 unit + 20 database-backed, with Postgres running)
* **Typecheck:** PASS ×3 — backend, shared, mobile
* **Lint:** PASS
* **Navigation guard:** PASS
* **Billing version guard:** PASS — 8.3.0 ≥ required major 8

---

## Verdict

**RED — no valid production AAB exists.**

The gate's own definition leaves no other option: GREEN and YELLOW both
require an artifact, and there is none. I am not going to describe a build
that did not happen.

The reason is worth stating precisely, because it is not the same as the
previous gates' network problem. Gate 3.5 was blocked by policy-denied hosts —
something an environment change could lift. Gate 5 additionally requires a
**physical Android device**, and this machine has no USB bus. That is not a
policy, it is the absence of hardware, and no amount of configuration here
would produce it.

**What the next step actually needs**, in order:

1. A machine with **JDK 17**, **Android SDK Platform 36**, **Build Tools
   36.0.0**, **NDK 27.1.12297006**, and reachable `dl.google.com` — or an Expo
   account with `EXPO_TOKEN` for EAS Build.
2. **Release signing credentials.** EAS-managed is simplest; a local build
   needs a real upload keystore, kept out of this repository.
3. `EXPO_PUBLIC_API_BASE_URL`, `EXPO_PUBLIC_WEB_BASE_URL` and
   `EXPO_PUBLIC_SUPPORT_EMAIL` as EAS environment variables — the pre-install
   guard fails the build without them.
4. `eas build --platform android --profile production`, or
   `./gradlew :app:bundleRelease` with signing configured.
5. `pnpm --filter @slate/mobile verify-aab <artifact>` — then the
   `bundletool` and `apksigner` commands it prints.
6. A physical Android phone, and the smoke test in Part 6.

Slate is product-complete and, as far as anything here can establish,
correctly configured for release. It has still never been compiled or run as
an Android application. That gap has been the same one since Gate 3, it has
not narrowed, and it will not narrow from inside this environment.
