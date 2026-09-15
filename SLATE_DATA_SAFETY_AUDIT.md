# SLATE — Google Play Data Safety Audit

**Purpose.** Every answer Play Console's Data safety form needs, derived from
what the code actually does, with the file that proves each one. Copy the
answers; do not re-derive them from memory.

**Method.** Data types were enumerated from `apps/backend/prisma/schema.prisma`
(every persisted field), from the request bodies each route accepts, and from
every outbound call the backend makes. The mobile dependency list was checked
for SDKs that collect independently. Nothing here is inferred from intent —
where a claim is "no", the audit names what was checked to establish it.

**Status:** Complete and answerable. Two answers depend on operator facts
(data-deletion URL, developer contact) and are marked `[OPERATOR]`.

---

## 1. Summary of the form answers

| Play Console question | Answer |
| --- | --- |
| Does your app collect or share any of the required user data types? | **Yes** |
| Is all of the user data collected by your app encrypted in transit? | **Yes** |
| Do you provide a way for users to request that their data be deleted? | **Yes** — in-app **and** a web URL |
| Does your app contain ads? | **No** (see §6) |
| Does your app collect a device or other identifier? | **No** (see §5) |
| Does your app share data with third parties? | **Yes** — see §4 |

---

## 2. Data collected — the complete list

"Collected" in Play's sense means transmitted off the device. Everything
below reaches Slate's own backend. Nothing is "processed ephemerally" except
where stated.

### Personal info

| Data type | Collected | Shared | Required? | Purpose(s) | Evidence |
| --- | --- | --- | --- | --- | --- |
| Name | Yes | No | Required | App functionality; Account management | `User.displayName` — `schema.prisma`; set at signup in `auth.routes.ts` |
| Email address | Yes | No | Required | App functionality; Account management | `User.email` |
| User IDs | Yes | No | Required | App functionality; Account management | `User.id`, `User.handle` |
| Other info (spoiler sensitivity, favourite genres) | Yes | No | Optional | App functionality; Personalisation | `User.spoilerSensitivity`, `User.favoriteGenres` |

Not collected in this category: physical address, phone number, race/ethnicity,
political or religious beliefs, sexual orientation, other personal info.

### Financial info

| Data type | Collected | Shared | Purpose | Evidence |
| --- | --- | --- | --- | --- |
| Purchase history | Yes | No | App functionality | `Entitlement`, `PurchaseEvent` — the Play purchase token, product id and status only |

**Payment info is NOT collected.** The purchase happens entirely inside Google
Play Billing; Slate receives a purchase token, never a card number, and has no
payment form anywhere in the app. Evidence: `billing.routes.ts` accepts only
`{ purchaseToken, productId }`; there is no payment-field input in
`apps/mobile/src`.

### Messages

| Data type | Collected | Shared | Purpose | Evidence |
| --- | --- | --- | --- | --- |
| Other in-app messages (Ask Slate conversations) | Yes | **Yes — OpenAI** | App functionality | `AiConversation`, `AiMessage`; outbound call in `ai/openai-provider.ts` |

Not collected: emails, SMS or MMS. Slate has no private user-to-user
messaging — the community is public posts and comments, covered below.

### App activity

| Data type | Collected | Shared | Purpose | Evidence |
| --- | --- | --- | --- | --- |
| App interactions | Yes | No | Analytics; App functionality | `AnalyticsEvent` (name + timestamp + non-identifying properties) — `analytics.routes.ts` |
| In-app search history | Yes | No | App functionality | Search terms are sent to the backend, which forwards them to TMDB/IGDB. Not persisted per-user; the `search` analytics event records that a search happened, not the term |
| Other user-generated content | Yes | **Yes — publicly within the app** | App functionality | `CommunityPost`, `CommunityComment`, `Reaction`, `Report` |
| Other actions (follows, watchlist, journeys, blocks, notification prefs) | Yes | No | App functionality; Personalisation | `Follow`, `WatchlistItem`, `SavedJourney`, `UserBlock`, `Notification` |

Not collected: installed apps, page views outside Slate's own screens, or any
other app-activity type.

### App info and performance

| Data type | Collected | Shared | Purpose | Evidence |
| --- | --- | --- | --- | --- |
| Crash logs | **No** | — | — | No crash SDK. Nothing in `apps/mobile/package.json` reports crashes |
| Diagnostics | **No** | — | — | Same |
| Other app performance data | **No** | — | — | Same |

Server-side request logs (Fastify/pino) are infrastructure logs, not data
collected from the device by the app, and include no device identifier.

### Everything else: not collected

Location (approximate or precise), Health and fitness, Photos and videos,
Audio, Files and docs, Calendar, Contacts, Web browsing history, Device or
other IDs.

This is enforced, not merely intended. Verified by generating the Android
manifest (`expo prebuild`) and reading it, rather than by trusting `app.json`:
the shipped manifest requests `INTERNET`, `com.android.vending.BILLING` and
`VIBRATE`, and nothing else.

`VIBRATE` comes from the React Native template, is a normal-level permission
granted at install with no runtime prompt, and maps to no Data safety type. It
is listed here because the audit reports what the manifest actually contains,
not what the configuration intends.

Seven permissions are explicitly stripped via `blockedPermissions`:
`ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`, `RECORD_AUDIO`, `CAMERA`,
`SYSTEM_ALERT_WINDOW`, `READ_EXTERNAL_STORAGE`, `WRITE_EXTERNAL_STORAGE`. The
last three were **found by this audit** — they are Expo/RN template defaults
that `app.json` never asked for and that would otherwise have shipped, putting
storage and draw-over-other-apps permissions on the store listing for features
Slate does not have.

---

## 3. Per-type declaration values

For each collected type, Play asks three things. Slate's answers:

- **Is this data collected, shared, or both?** As tabled in §2.
- **Is this data processed ephemerally?** **No** for every type — everything
  listed is persisted in Postgres. (Search terms are the one borderline case:
  they are forwarded to a provider and not stored against the user. Declared
  as collected anyway, because they leave the device.)
- **Is this data required, or can users choose whether it's collected?**
  - Required: name, email, user IDs, app interactions, follows/watchlist.
  - Optional: spoiler sensitivity, favourite genres, community posts,
    Ask Slate conversations, purchase history — a user can use Slate
    fully without ever posting, asking or subscribing.

---

## 4. Data sharing — who receives what

Play defines "shared" as transferred to a third party. Slate has exactly four,
and none of them is an advertiser or data broker.

| Recipient | What is transferred | What is deliberately NOT transferred | Evidence |
| --- | --- | --- | --- |
| **OpenAI** | The user's Ask Slate message; up to the last 10 messages in that conversation; spoiler-sensitivity setting; the *names* of titles the user follows/watchlisted | Email, handle, display name, account ID, IP address, device identifiers. The request originates from Slate's server, so OpenAI never sees the user's IP | `ai/ai.routes.ts` builds the message array; `buildUserContext()` emits title names only |
| **TMDB** | Search terms and title IDs | Any account data; the user's IP (server-to-server) | `modules/tmdb/` |
| **IGDB / Twitch** | Game search terms and title IDs | Same | `modules/igdb/` |
| **Google Play** | Purchase token | — | `billing/play-verification.ts` |

Slate does **not** sell personal information, does not share it for
cross-context behavioural advertising, and has no advertising SDK, attribution
SDK or data-broker integration.

Hosting and database providers are service providers processing on Slate's
instructions, which Play does not count as sharing.

---

## 5. Identifiers — why the answer is "no"

Play treats "Device or other IDs" as a distinct, high-scrutiny type. Slate's
answer is **not collected**:

- No advertising ID. `react-native-google-mobile-ads` and every other ads SDK
  are absent from `apps/mobile/package.json`.
- No `AAID`, `ANDROID_ID`, `GAID`, IMEI, MAC or build fingerprint is read
  anywhere in `apps/mobile/src`.
- No device-fingerprinting library.
- The only identifier Slate uses is its own account ID (`User.id`), declared
  under **User IDs** in §2.
- `expo-secure-store` holds the access and refresh tokens in Android
  Keystore-backed storage. Those are session credentials for Slate's own
  account, not device identifiers, and never leave the device except as an
  `Authorization` header to Slate's API.

---

## 6. Ads — why the answer is "no"

`apps/mobile/src/ads/AdProvider.ts` is an interface with exactly one
implementation, `NoOpAdProvider`, whose `canShow()` returns `false`
unconditionally. `AdSlot.tsx` renders `null` in every path. No ad network SDK
is in the dependency tree.

**Declare "contains ads: No" for this release.** The abstraction exists so a
network can be added later; shipping an unconfigured ad SDK would have meant
declaring ads that never render. If an ad network is wired up in a future
release, this answer, the store listing's ads flag, and the Data safety
sharing section all have to change together.

---

## 7. Security practices

| Play question | Answer | Evidence |
| --- | --- | --- |
| Is data encrypted in transit? | **Yes** | `usesCleartextTraffic: false` in `app.json`; `resolveApiBaseUrl()` throws on a non-`https://` base URL in release builds (`api/client.ts`); `scripts/check-release-env.mjs` fails the build before that can ship |
| Can users request data deletion? | **Yes** | In-app: Profile → Settings → Delete account. Web: `web/delete-account.html`. Both call `POST /users/me/delete` |
| Committed to Play Families Policy? | N/A — not a Families app | Target audience 13+; see `SLATE_PLAY_COMPLIANCE.md` §Target audience |
| Independent security review? | No | Not claimed |

Additional measures not asked about on the form but relevant to a reviewer:
bcrypt password hashing, rotating refresh tokens stored hashed, per-route
tiered rate limiting, an authenticated RTDN webhook, and a CORS allowlist
rather than origin reflection.

---

## 8. Data deletion declaration

Play's Data safety form asks specifically about account deletion. Slate
qualifies for the strongest available answer: **"Users can request that their
data be deleted"** with **both** paths provided.

| Field | Value |
| --- | --- |
| In-app deletion path | Profile → Settings → Delete account |
| Web deletion URL | `[OPERATOR]` `https://<your-domain>/delete-account` |
| Requires the user to log in? | Yes — password re-authentication, by design |
| Requires contacting support? | No |
| Time to deletion | Immediate — one database transaction |

### What is deleted vs retained

Deleted outright: account, email, password hash, sessions, follows,
watchlist, saved journeys, notification history and preferences, Ask Slate
conversations and usage counters, reactions, blocks (both directions),
entitlement and purchase-event audit rows.

Anonymised rather than destroyed, and why: community posts and comments are
threaded, so a cascade delete of the author would destroy replies written by
**other** users who never requested deletion. Slate instead scrubs the body
text to `[deleted]` and reassigns authorship to a non-login sentinel account.
Reports the user filed stay with moderators but no longer identify them.
Analytics events are detached (`onDelete: SetNull`) and survive as anonymous
counts.

Evidence: `apps/backend/src/modules/users/account-deletion.service.ts`.

Backup retention: deleted data may persist in encrypted backups until they
rotate (stated as up to 30 days on the deletion page) and is never restored to
the live service. **`[OPERATOR]`: confirm this matches your hosting provider's
actual backup retention before publishing.**

---

## 9. Consistency check

Play rejects apps whose Data safety answers contradict their privacy policy.
These were cross-checked line by line:

| Claim | Data safety §  | Privacy policy § | Consistent |
| --- | --- | --- | --- |
| Email/name/user ID collected | §2 Personal info | §2.1 | Yes |
| Ask Slate messages shared with OpenAI | §4 | §4 table row 1 | Yes |
| Posts visible to other users | §2 App activity | §5 | Yes |
| No location/camera/mic/contacts | §2, §5 | §3 | Yes |
| No advertising ID, no ads | §5, §6 | §1, §2.5 | Yes |
| Purchase token stored, card details never | §2 Financial | §2.4 | Yes |
| Deletion in-app and on the web, immediate | §8 | §6, §7 | Yes |
| Encrypted in transit | §7 | §9 | Yes |

---

## 10. What to re-audit on the next release

Re-open this document if any of the following changes, because each one
changes a form answer:

1. An ad network is wired into `AdProvider` → ads declaration, identifiers,
   sharing.
2. A crash/analytics SDK is added → App info and performance section.
3. Push notifications are added (`expo-notifications`) → a push token is a new
   identifier, and `POST_NOTIFICATIONS` becomes a declared permission.
4. Avatar upload is added → Photos and videos, plus storage permissions.
5. Private messaging is added → the Messages section changes materially.
6. A new outbound third-party call is added anywhere in `apps/backend` → §4.
