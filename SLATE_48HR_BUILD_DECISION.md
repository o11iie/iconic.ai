# Slate — 48-Hour Build Decision (Gate 0)

Assessed from commit `5b79b43`. Every version number below was read out of this repository, not recalled.

---

## DECISION

**Architecture: FROZEN on Expo SDK 51 / React Native 0.74.5. No upgrade performed.**

**Android targeting: corrected from API 36 → API 34**, because the API 36 configuration committed on Day 5 **cannot compile**.

**Play Store submission: BLOCKED until an Expo SDK 54 upgrade is performed in an environment this sandbox cannot provide.** That upgrade is a genuine prerequisite, not a preference — but attempting it *here* would be reckless, so it is explicitly scheduled rather than attempted.

---

## REASON

### The Day 5 configuration was provably broken

Day 5 set `compileSdkVersion`/`targetSdkVersion` to 36 and verified the values landed in the generated `gradle.properties`. That verification was real but **insufficient** — it confirmed the values were *present*, not that the toolchain could *consume* them.

Evidence read from this repo:

| Fact | Value | Source |
|---|---|---|
| AGP pinned by React Native | **8.2.1** | `node_modules/react-native/gradle/libs.versions.toml` |
| Gradle wrapper | **8.8** | generated `android/gradle/wrapper/gradle-wrapper.properties` |
| RN template default compile/target SDK | **34** | `libs.versions.toml` + generated `android/build.gradle` |
| Day 5 override | compile/target **36** | `app.json` → generated `gradle.properties` |

The Android Gradle Plugin enforces a hard ceiling on `compileSdk`:

- AGP **8.2.x** → supports `compileSdk` up to **34**
- `compileSdk 35` → requires AGP **8.6+**
- `compileSdk 36` → requires AGP **8.9.1+** (and Gradle 8.11+; this project has 8.8)

**AGP 8.2.1 with `compileSdk 36` is a deterministic build failure, not a risk.** The build would have failed on the first `eas build` attempt. Day 5's RED blocker #2 ("configured but uncompiled") understated this — it was not merely unvalidated, it was wrong.

### Answers to the four questions asked

**1. Can SDK 51 safely build a production AAB targeting API 36?**
**No.** AGP 8.2.1 cannot compile `compileSdk 36`. There is no configuration of SDK 51 that targets API 36.

**2. Are there native dependency incompatibilities making the current configuration unsafe?**
The blocker is the **toolchain**, not the libraries. Checked specifically:
- `react-native-iap` 12.16.4 inherits `compileSdk`/`targetSdk` from the root project (`getExtOrIntegerDefault`), so it imposes no independent SDK ceiling. It bundles **Play Billing Library 7.0.0** (`RNIap_playBillingSdkVersion=7.0.0`), overridable via a Gradle property if Play's minimum has moved — **verify the current Play Billing minimum before submitting**.
- Remaining native modules (`expo-secure-store`, `expo-constants`, `expo-system-ui`, `react-native-screens`, `react-native-safe-area-context`) are all standard SDK 51-aligned versions with no conflicting requirements.

**3. Can the current configuration be compiled by EAS Build despite no local Android SDK?**
**No — EAS would fail identically.** EAS Build compiles *this same project configuration*; it supplies the Android SDK, not a newer AGP. The AGP version comes from React Native's pinned version catalog in the repo. A cloud builder does not resolve a local-environment problem that is actually a dependency-version problem.

**4. Would upgrading to SDK 54 introduce greater risk than staying on SDK 51?**
**In this environment, yes — decisively.** The upgrade was attempted and deliberately reverted:
- `pnpm add expo@~54` succeeded, but `expo install --fix` — the supported mechanism that resolves the matched native version set — **failed: `api.expo.dev` is blocked by this sandbox's network policy (403 CONNECT)**, while npm itself is reachable.
- Without it, upgrading means hand-pinning ~15 interdependent native package versions (RN 0.81, React 19, every `expo-*` module, a `react-native-iap` major bump) **with no ability to compile, and no device to test on.**
- An upgrade that cannot be compiled or tested is not a "smallest safe upgrade" — it is an unverifiable rewrite of the native layer during a freeze.

The partial upgrade was fully reverted; the working tree was returned to exactly `5b79b43` before making the targeted fix below.

### Why API 34 rather than leaving API 36 in place

Neither value ships today, but they fail very differently:

- **API 36 (Day 5 state):** nothing compiles. No internal build, no device QA, no progress for 48 hours.
- **API 34 (now):** compiles cleanly. The team can produce a development/internal build and **run real device QA immediately** — which is the single highest-value unfinished item from Day 5 — while the SDK upgrade happens in parallel on a properly equipped machine.

Choosing the buildable-but-not-yet-submittable state unblocks the work that actually needs doing in the next 48 hours.

---

## RISKS

| Risk | Severity | Mitigation |
|---|---|---|
| **API 34 is below Google Play's minimum for new apps** (API 35 required since Aug 2025; API 36 on the following annual cadence). Submission will be rejected. | **Blocking for submission** | The SDK 54 upgrade below is mandatory before upload. Confirm the exact current minimum in Play Console at submission time. |
| SDK 54 upgrade is unvalidated and carries real breaking changes (RN 0.74 → 0.81, React 18 → 19, `react-native-iap` major bump). | High | Do it on a machine with Expo API access + Android SDK. Budget for a real regression pass — do not do it the night before submission. |
| `react-native-iap` 12.x may not support RN 0.81; a major bump changes its purchase API surface. | Medium | Billing is isolated behind `src/billing/iap.ts` — the blast radius is one file, by design. Re-verify the purchase + restore flow after upgrading. |
| Play Billing Library 7.0.0 may be below Play's current minimum. | Medium | One-line override via the `playBillingSdkVersion` Gradle property; no library change needed. |
| Still zero on-device QA. | High | Now unblocked — API 34 compiles. This is the top priority for the 48-hour window. |

---

## ACTION

**Done in this gate (no architectural churn):**
1. Read the real AGP/Gradle/SDK versions out of the repo and identified the deterministic incompatibility.
2. Attempted the SDK 54 upgrade; hit a hard network-policy block on the supported tooling; **fully reverted** to `5b79b43`.
3. Corrected `compileSdkVersion`/`targetSdkVersion` 36 → 34 so the project is genuinely buildable. Kept `minSdkVersion: 24` and `usesCleartextTraffic: false`.
4. Re-verified via `expo prebuild`: AGP 8.2.1 / compileSdk 34 is self-consistent, cleartext confirmed disabled.
5. Full suite green: typecheck (backend/mobile/shared) PASS, lint PASS, 24/24 tests PASS.

**Required before Play submission — outside this environment:**
1. On a machine with unrestricted network **and** Android SDK: upgrade to Expo SDK 54 via `npx expo install --fix`, which pulls AGP ≥ 8.9 / Gradle ≥ 8.13 and native API 36 support.
2. Restore `compileSdkVersion`/`targetSdkVersion` to **36** in `app.json` — the override stays correct, it simply requires the newer toolchain.
3. Bump `react-native-iap` to its RN 0.81-compatible major and re-verify purchase + restore.
4. Run `eas build --platform android --profile production` and fix whatever surfaces.
5. Full on-device regression pass.

**Frozen from here. Priority order for the remaining window:** buildability → release compliance → production configuration → Pro conversion → QA. No new features.
