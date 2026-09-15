# SLATE — Google Play Compliance Audit

**Verdict: READY AFTER EXTERNAL CONFIGURATION — with one hard blocker that
cannot be cleared inside this environment.**

Everything Play policy requires *of the application* is implemented and
verified. Submission is blocked on a toolchain upgrade that requires network
and SDK access this sandbox does not have (§1), plus operator facts nobody but
the operator can supply (§2).

This audit states what was checked, what the evidence was, and — where the
answer is "not done" — says so plainly rather than describing the intent.

---

## 1. BLOCKER — target API level

| | |
| --- | --- |
| **Current** | `compileSdkVersion` / `targetSdkVersion` **34** (`apps/mobile/app.json`) |
| **Play requires** | API 35 minimum for new apps since Aug 2025, rising annually. **Confirm the exact current minimum in Play Console at submission time** |
| **Impact** | The AAB will be **rejected at upload**. This is not a warning |
| **Why it is 34** | Expo SDK 51 ships AGP 8.2.1, which supports `compileSdk` up to 34. `compileSdk 35` needs AGP 8.6+; `36` needs AGP 8.9.1+ with Gradle 8.11+. Setting 36 without the toolchain is a deterministic build failure, which is what Gate 0 found and corrected |
| **Fix** | Upgrade to Expo SDK 54 (`npx expo install --fix`), which brings AGP ≥ 8.9 and Gradle ≥ 8.13, then restore `compileSdkVersion`/`targetSdkVersion` to the required level in `app.json` |
| **Why not fixed here** | `api.expo.dev` is blocked by this sandbox's network policy (403 on CONNECT), so `expo install --fix` cannot resolve the SDK 54 version set. Hand-pinning ~15 native package versions blind would be more likely to produce a broken build than a working one |

Full reasoning and the AGP↔compileSdk matrix: `SLATE_48HR_BUILD_DECISION.md`.

**Nothing else in this document is blocked by this.** Every other item below is
either done or is an operator input.

---

## 2. Operator inputs required before submission

None of these can be invented in code without putting a false statement in
front of users or a reviewer. Each has a named home and a validator that fails
until it is supplied.

| Input | Where it goes | Validator |
| --- | --- | --- |
| Legal entity name | `web/config.js` → `legalEntity` | `node web/verify-config.mjs` |
| Support/privacy email | `web/config.js` → `contactEmail`; `EXPO_PUBLIC_SUPPORT_EMAIL` | same |
| Copyright notice email | `web/config.js` → `copyrightEmail` | same |
| Public web domain | `web/config.js` → `siteBaseUrl`; `EXPO_PUBLIC_WEB_BASE_URL` | same + `scripts/check-release-env.mjs` |
| API origin | `web/config.js` → `apiBaseUrl`; `EXPO_PUBLIC_API_BASE_URL` | same |
| Governing jurisdiction | `web/config.js` → `jurisdiction` | `verify-config.mjs` |
| Legal-document effective date | `web/config.js` → `effectiveDate` | `verify-config.mjs` |
| Play product IDs + prices | Play Console; mirrored in `apps/backend/src/config/products.ts` | — |
| Play service-account JSON | `GOOGLE_SERVICE_ACCOUNT_JSON` (backend env) | `isPlayBillingConfigured()` |
| RTDN shared secret | `RTDN_SHARED_SECRET` (backend env) | webhook returns 401 without it |
| Reviewer demo account | Play Console → App access | see `SLATE_PLAY_REVIEWER_GUIDE.md` |

Full operational runbook: `SLATE_PRODUCTION_CONFIGURATION.md`.

---

## 3. Audit results

Legend: **PASS** — implemented and verified · **OPERATOR** — code is ready,
a real-world value is required · **BLOCKED** — cannot be resolved here.

### 3.1 Target API level — **BLOCKED**

See §1.

### 3.2 Permissions — **PASS**

Verified against the **generated manifest**, not against `app.json` — which
is how this gate caught a real problem.

Shipped: `INTERNET`, `com.android.vending.BILLING`, `VIBRATE`.

`VIBRATE` is a React Native template default. It is normal-level, granted at
install with no runtime prompt, and is left in place rather than blocked
because stripping a permission RN core may call is a crash risk for no
compliance gain. It is disclosed rather than quietly omitted.

Blocked via `blockedPermissions`, so the manifest merger strips them:
`ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`, `RECORD_AUDIO`, `CAMERA`,
`SYSTEM_ALERT_WINDOW`, `READ_EXTERNAL_STORAGE`, `WRITE_EXTERNAL_STORAGE`.

**The last three were found during this gate.** `expo prebuild` emitted them
from the Expo/RN template even though `app.json` listed only two permissions.
Left alone, Slate would have shipped storage access and draw-over-other-apps —
neither of which it uses — and both would have appeared on the store listing.
The lesson generalises: `app.json`'s `permissions` array is additive, not
exhaustive, so the manifest is the only trustworthy source.

No sensitive permission remains, so no Permissions Declaration Form is
required. There is no `QUERY_ALL_PACKAGES`, no `MANAGE_EXTERNAL_STORAGE`, no
`SMS`/`CALL_LOG`, no `AD_ID`, no `POST_NOTIFICATIONS`, and no background
location.

Evidence: `android/app/src/main/AndroidManifest.xml` after
`expo prebuild --platform android`; configured in `apps/mobile/app.json`.

### 3.3 Notifications — **PASS**

Slate ships **in-app notifications only**: a list screen, an unread badge, a
master toggle and five per-type toggles. There is no push delivery while the
app is closed.

This is a deliberate scope decision, and it has a compliance consequence worth
stating: because `expo-notifications` is absent, Slate does **not** request
`POST_NOTIFICATIONS`, does not prompt for the Android 13+ notification
permission, and collects no push token. The Settings screen says so in plain
language rather than implying alerts will arrive when the app is closed.

Evidence: no `expo-notifications` in `apps/mobile/package.json`;
`apps/mobile/src/screens/main/SettingsScreen.tsx` notification section;
`apps/backend/src/modules/notifications/`.

### 3.4 Account creation — **PASS**

Email + password, with a handle and display name. No third-party sign-in, so
no OAuth provider policies apply. Passwords are bcrypt-hashed; access tokens
expire in 15 minutes; refresh tokens are opaque, stored hashed, and rotate on
use.

Play requires that an app offering account creation also offer account
deletion. It does — see §3.5.

### 3.5 Account deletion — **PASS** (the critical item)

Both required paths exist and were verified against a real database:

| Path | Location | Verified |
| --- | --- | --- |
| In-app | Profile → Settings → Delete account | Yes |
| Web, no install needed | `web/delete-account.html` | Yes — driven in a real browser against the live API |

Properties a reviewer will check:

- **Deletes, does not deactivate.** The `User` row is removed; the account
  cannot be logged into again (verified: login returns 401 afterwards).
- **Immediate.** One database transaction, no queue, no cooling-off period.
- **No support ticket required.** The user completes it alone.
- **Re-authentication required.** Password plus a typed `DELETE` confirmation,
  rate-limited. A wrong password returns **403** with `REAUTH_FAILED` —
  deliberately not 401, which the mobile client would misread as an expired
  token and burn a refresh rotation on.
- **Scope is disclosed before the fact,** in the app's confirmation dialog and
  on the web page, including that a Slate Pro subscription is billed by Google
  and is **not** cancelled by deleting the account.

The one design decision worth defending to a reviewer: posts and comments are
**anonymised, not destroyed**. A cascade delete of the author would take other
people's replies with it — users who never asked for deletion. Slate scrubs the
body to `[deleted]` and reassigns authorship to a non-login sentinel. The
deleting user's words and identity are gone; the surrounding conversation
survives.

Evidence: `apps/backend/src/modules/users/account-deletion.service.ts`,
`users.routes.ts` (`POST /users/me/delete`), `web/assets/delete-account.js`.

### 3.6 External deletion resource — **OPERATOR**

`web/delete-account.html` exists, works, and states the app name
(`Slate`), the package (`ai.iconic.slate`), the developer, what is deleted,
what is retained and for how long. It needs a public HTTPS host and the
config values in §2. `node web/verify-config.mjs` fails until then, and the
page shows a "not configured" banner and disables its own submit button rather
than presenting a form that silently does nothing.

### 3.7 Privacy policy — **OPERATOR**

`web/privacy.html` is written against the actual data flows (see
`SLATE_DATA_SAFETY_AUDIT.md` §9 for the consistency cross-check). It needs a
public HTTPS URL, entered in Play Console under Policy → App content → Privacy
policy, and in `EXPO_PUBLIC_WEB_BASE_URL` so the app's Settings screen links to
it. Until that variable is set the app **hides** the legal links rather than
shipping dead buttons.

### 3.8 Data Safety form — **PASS** (answers prepared)

Every field is answered with evidence in `SLATE_DATA_SAFETY_AUDIT.md`. Headline
answers: collects data **yes**; encrypted in transit **yes**; deletion
available **yes, in-app and web**; contains ads **no**; device identifiers
**no**; shares with third parties **yes** (OpenAI, TMDB, IGDB, Google Play,
itemised).

### 3.9 AI-generated content — **PASS**

Ask Slate is an AI assistant, which engages Play's generative-AI
expectations: disclosure, safeguards against offensive output, and a way for
users to report it.

- **Disclosed.** The feature is named "Ask Slate", presented as an assistant,
  and the privacy policy states that messages go to OpenAI.
- **Constrained.** The system prompt restricts answers to entertainment topics
  and instructs the model to say it does not know rather than invent facts
  about titles, dates, cast or plot — the anti-fabrication rule this build has
  held to throughout.
- **Bounded.** Server-side per-day limits (5 free / 100 Pro), rate limiting,
  and a 500-token output cap.
- **Credentials are server-side only.** `OPENAI_API_KEY` is read in
  `apps/backend/src/env.ts` and used only in `ai/openai-provider.ts`. The
  mobile app calls Slate's own `/ai/ask`; grep of `apps/mobile/src` finds no
  provider key or provider hostname.
- **Reportable.** AI output appears in the user's own conversation, not in the
  community feed, and users reach support from Settings.

### 3.10 User-generated content — **PASS**

Play requires apps hosting UGC to provide a content policy, in-app reporting,
in-app **blocking**, and moderation.

| Requirement | Status | Evidence |
| --- | --- | --- |
| Published content policy | Yes | `web/community-guidelines.html` |
| Report objectionable content | Yes | `POST /community/reports`, 5 reasons + free-text, UI on post detail |
| **Block another user** | Yes | `POST/DELETE/GET /community/blocks`; Block action on post detail; managed list in Settings |
| Moderation | Yes | Role-gated queue (`/admin/reports`), soft-delete of posts and comments |
| Authors can remove their own content | Yes | `canModerate()` allows author or moderator |
| Spoiler handling | Yes | Per-post spoiler flag + per-user sensitivity gate |

Blocking was **added during this gate** — it was the one UGC requirement the
app did not previously meet. Semantics, verified live: one-directional (the
blocked user still sees their own and everyone else's content), silent (no
notification, and no endpoint exposes who blocked you), filtered at query time
rather than destructive (a bystander's view is unchanged), and a blocked
author's post returns **404** to the blocker rather than 403, so a deep link
cannot confirm the content exists.

### 3.11 Copyright and attribution — **PASS**

Slate does not copy provider catalogues into its own database; `Title` is a
thin pointer plus Slate-specific state, and metadata is fetched live. TMDB and
IGDB attributions, including the required "not endorsed or certified by"
statements, appear on `web/copyright.html` and in the footer of every web page.
A notice-and-counter-notice procedure with a repeat-infringer termination
policy is published there. The Community Guidelines prohibit piracy links and
leaked material.

### 3.12 Subscriptions and billing — **PASS**

- Google Play Billing via `react-native-iap` (Play Billing Library 7.0.0
  bundled). **Verify Play's current minimum Billing Library version at
  submission**; it is a one-line Gradle property override if it has moved.
- No alternative payment path anywhere in the app.
- **Entitlement is server-authoritative.** `POST /billing/verify` calls
  Google's `purchases.subscriptionsv2` and grants access only on Google's
  answer. A client claiming to be Pro gets nothing.
- Price and terms are disclosed before purchase, read from
  `apps/backend/src/config/products.ts` — a single source of truth, with the
  annual saving *derived* from the two prices so marketing copy cannot drift
  from what is charged.
- Auto-renewal, the renewal period and how to cancel are stated in-app and in
  `web/terms.html` §5. Settings links straight to Play's subscription screen.
- RTDN webhook is authenticated by shared secret (401 without it) and is
  idempotent per purchase token.

### 3.13 Ads — **PASS**

No ad SDK ships. Declare **"contains ads: No"**. See
`SLATE_DATA_SAFETY_AUDIT.md` §6.

### 3.14 Target audience and content — **PASS** (answers prepared)

- **Target age:** 13+. Not a Families app; do not opt into the Designed for
  Families programme.
- **Appeals to children?** No. The content is release tracking and discussion
  of films, television and games, including adult-rated titles.
- **Content rating questionnaire:** Slate itself contains no violence, sexual
  content, profanity, gambling, or drug references. Two answers require care:
  (a) **users can interact** — yes, public posts and comments, unmoderated in
  real time and moderated on report; (b) **users can share content** — yes,
  text posts. Expect approximately Teen/PEGI 12 driven by the social feature
  rather than by any content Slate authors. Answer the questionnaire from the
  app's real behaviour; do not copy a rating from another app.
- **Age gate:** the Terms and Privacy Policy state a 13+ minimum (or the local
  age of digital consent, if higher). No date-of-birth collection — that would
  add a personal-data type for no compliance benefit at this rating.

### 3.15 Reviewer access — **OPERATOR**

Slate is entirely account-gated, so a reviewer cannot evaluate it without
credentials. Play Console → App access → "All or some functionality is
restricted" and supply a demo account. Instructions, exact navigation paths and
what to say about Pro: `SLATE_PLAY_REVIEWER_GUIDE.md`.

### 3.16 Links, support and store listing — **OPERATOR**

Support email, privacy policy URL and the store listing text are all prepared;
they need the operator values from §2. Listing copy:
`SLATE_PLAY_STORE_LISTING.md`. Screenshot plan: `SLATE_PLAY_STORE_SCREENSHOTS.md`.

### 3.17 Icons and graphics — **PARTIAL**

`assets/icon.png`, `adaptive-icon.png` and `splash.png` exist and are valid
PNGs, and the adaptive icon is configured with a background colour. They are
placeholder-grade artwork, not a finished brand asset. Play additionally
requires a **512×512 store icon** and a **1024×500 feature graphic**, neither of
which is a build input and neither of which exists yet. Design work, not a code
blocker — tracked in `SLATE_PLAY_STORE_SCREENSHOTS.md`.

### 3.18 Deep links — **PASS**

`app.json` declares `slate://title/...` and `slate://post/...` intent filters.
Those are now actually handled: `apps/mobile/src/navigation/linking.ts` maps
exactly those two hosts to `TitleDetail` and `PostDetail`. Before this gate the
manifest advertised links the JavaScript never handled, so tapping one opened
the app to wherever it was last — worse than not claiming the link.

No `https://` App Link is claimed. Doing so would require a verified
`assetlinks.json` on Slate's domain; claiming one without it produces links
Android refuses to open.

### 3.19 External API configuration — **OPERATOR**

TMDB, IGDB/Twitch, OpenAI and Google Play credentials are all backend-only and
optional at boot: each has an `isXConfigured()` guard so the server starts and
degrades honestly rather than crashing or faking data. See
`SLATE_PRODUCTION_CONFIGURATION.md`.

**No credential is reachable from the mobile client.** Verified by grepping
`apps/mobile/src` for every provider key name and hostname: no match.

---

## 4. Policy risk scan

Areas Play rejects apps for, checked against what Slate actually does.

| Risk | Assessment |
| --- | --- |
| **Deceptive behaviour** | Release dates are shown at the precision the provider supplies; where a date is a month or a quarter, Slate says so rather than inventing a day. No fabricated metadata anywhere |
| **Misrepresentation of the app** | Store listing describes only shipped features. It does not claim push notifications (not built) or ads-free-as-a-Pro-benefit as though ads existed today |
| **Subscription dark patterns** | Price, period and renewal stated before purchase; cancellation route named in-app; the annual saving is computed from the real prices; no countdown pressure, no pre-checked upsell, no hidden trial conversion |
| **Paywalling an advertised free feature** | Free tier is functional on its own: full discovery, search, detail, countdowns, community, 10 follows, 25 watchlist items, 5 AI messages a day, a 14-day Release Radar and one journey. Pro adds scale and intelligence; it removes nothing |
| **UGC without safeguards** | Guidelines, reporting, blocking, moderation and spoiler gating all present (§3.10) |
| **AI misuse** | Constrained to entertainment; instructed against fabrication; rate-limited; keys server-side (§3.9) |
| **Impersonation** | App name, package and branding are Slate's own. Provider attributions state explicitly that Slate is not endorsed or certified by TMDB, IGDB or Twitch |
| **Data-safety inaccuracy** | Cross-checked against the privacy policy line by line — `SLATE_DATA_SAFETY_AUDIT.md` §9 |
| **Broken or unusable submission** | The remaining risk. A build pointed at a placeholder host would install and fail; `scripts/check-release-env.mjs` now fails the build instead |
| **Permissions beyond need** | Two permissions, four blocked (§3.2) |
| **Payments outside Play** | None. Play Billing is the only path |

---

## 5. What changed during this gate

Compliance fixes, not features:

1. **Account deletion** — service, endpoint, in-app flow, and a working web
   resource (§3.5, §3.6).
2. **User blocking** — the missing UGC requirement (§3.10).
3. **Legal document set** — privacy, terms, guidelines, copyright, support,
   deletion, with a config validator that fails on anything unfilled.
4. **CORS tightened** — `origin: true` reflected any site's origin back;
   replaced with an allowlist so only Slate's own web page can call the API
   from a browser. Verified live: allowed origin echoed, other origins refused,
   non-browser callers unaffected.
5. **Release-build guard** — `scripts/check-release-env.mjs` fails a
   `preview`/`production` build whose API or web URL is missing, non-HTTPS, a
   reserved placeholder host, or a local address. Placeholder hosts were
   removed from `eas.json`.
6. **Deep links made real** (§3.18).
7. **Bug found and fixed while verifying blocking:** the mobile API client sent
   `Content-Type: application/json` on every request including bodyless
   `DELETE`s, which Fastify rejects with 400. **Unfollow and watchlist removal
   were broken in the app.** Header is now set only when there is a body;
   verified live (400 → 204).
8. **Deletion now reports an active subscription** so the user is told, at the
   moment it matters, that Google will keep charging them unless they cancel.

---

## 6. Submission checklist

Blockers first; nothing below §6.1 matters until §6.1 is done.

### 6.1 Must be done elsewhere
- [ ] Upgrade to Expo SDK 54 on a machine with network + Android SDK access.
- [ ] Set `compileSdkVersion`/`targetSdkVersion` to Play's current minimum.
- [ ] Build an AAB and confirm it uploads without a target-API rejection.

### 6.2 Operator configuration
- [ ] Fill `web/config.js`; `node web/verify-config.mjs` exits 0.
- [ ] Deploy `web/` to public HTTPS with no sign-in wall.
- [ ] Set backend `WEB_ORIGINS` to the deployed site origin.
- [ ] Set backend provider credentials and `RTDN_SHARED_SECRET`.
- [ ] Set `EXPO_PUBLIC_API_BASE_URL`, `EXPO_PUBLIC_WEB_BASE_URL`,
      `EXPO_PUBLIC_SUPPORT_EMAIL` as EAS environment variables.
- [ ] Create the two subscription products in Play Console at the prices in
      `products.ts`.

### 6.3 Play Console
- [ ] Privacy policy URL.
- [ ] Data safety form, from `SLATE_DATA_SAFETY_AUDIT.md`.
- [ ] Account deletion URL + in-app path.
- [ ] Content rating questionnaire (§3.14).
- [ ] Target audience: 13+, not Families.
- [ ] Ads: **No**.
- [ ] App access: demo credentials (`SLATE_PLAY_REVIEWER_GUIDE.md`).
- [ ] Store listing (`SLATE_PLAY_STORE_LISTING.md`).
- [ ] Graphics: 512×512 icon, 1024×500 feature graphic, screenshots.

### 6.4 Verify on a real device before upload
- [ ] Sign up, follow, watchlist, search across movies, TV and games.
- [ ] Post, comment, react, report, **block, unblock**.
- [ ] Ask Slate answers and enforces the daily limit.
- [ ] Settings: toggles, legal links open, delete account works.
- [ ] Purchase Slate Pro from a licence-tester account; entitlement appears;
      cancel and confirm access ends at period end.
- [ ] Deep links `slate://title/...` and `slate://post/...` land correctly.
