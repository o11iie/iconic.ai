# SLATE — Production Configuration Runbook

Everything that must be configured outside the repository, as a gated
checklist. Work top to bottom: nothing in a later section matters until the
earlier ones are done.

**No secret value appears in this document and none should ever be committed.**
Each item names the variable, where the value comes from, where it belongs,
whether it is secret, how to confirm it worked, and whether it can be changed
later.

---

## Principles this configuration enforces

1. **No provider credential ever reaches the mobile client.** TMDB, IGDB,
   Twitch, OpenAI and Google Play credentials are backend-only. `EXPO_PUBLIC_*`
   values are inlined into the shipped JavaScript bundle and are public by
   definition — a secret there is a published secret.
2. **The backend degrades honestly.** Each provider has an `isXConfigured()`
   guard; a missing key produces an explicit "not configured" response, never
   fabricated data. Verified: with no TMDB/IGDB key, search returns empty
   results rather than invented titles; with no OpenAI key, Ask Slate returns
   503 rather than a made-up answer.
3. **Entitlement is server-authoritative.** Pro comes from Google's answer to
   `purchases.subscriptionsv2`, never from a client claim.
4. **Misconfiguration fails loudly.** `web/verify-config.mjs`,
   `apps/mobile/scripts/check-release-env.mjs` and the backend's own
   production env validation all refuse rather than starting wrong.

---

## REQUIRED BEFORE BUILD

Without these, no usable Android artifact exists.

- [ ] **A build environment** — *not a value, a machine*
  - Needed, exactly:
    - **JDK 17.** Expo SDK 54 / React Native 0.81's Gradle plugin declares a
      toolchain of `languageVersion=17`. JDK 21 alone is **not** accepted —
      the build fails with "Cannot find a Java installation matching
      {languageVersion=17}".
    - **Android SDK Platform 36** and **Build Tools 36.0.0**.
    - **NDK 27.1.12297006** (the version React Native 0.81.5 pins).
    - Gradle 8.14.3 — the wrapper downloads it; needs `services.gradle.org`.
    - Network access to **`dl.google.com`** (AGP, androidx, and the Play
      Billing artifacts, which are Google-Maven-only and not mirrored on
      Maven Central), **`plugins.gradle.org`** and **`repo1.maven.org`**.
    - Or, instead of all of the above: an **EAS** account with a linked
      project and `EXPO_TOKEN`.
  - Belongs: wherever builds run — a developer machine, CI, or EAS Build.
  - Secret: `EXPO_TOKEN` yes; the rest no.
  - Verify: `cd apps/mobile && npx expo prebuild --platform android --clean &&
    cd android && ./gradlew :app:bundleRelease` produces an `.aab`.
  - Changeable later: n/a.
  - Note: the repository is already configured for API 36 and prebuilds
    cleanly — see `SLATE_GATE_3_5_REPORT.md`. What is missing is a machine
    that can compile it.

- [ ] **On the first build, confirm the Billing Library in the real dependency
      tree**
  - Run: `cd apps/mobile/android && ./gradlew :app:dependencies | grep billingclient`
  - Expect: `com.android.billingclient:billing-ktx:8.3.0`, arriving via
    `io.github.hyochan.openiap:openiap-google:1.3.28`.
  - `pnpm --filter @slate/mobile billing:version` predicts this from the
    published POMs without a toolchain, but Gradle is the authority — confirm
    they agree.
  - Secret: no. Changeable later: yes, by moving react-native-iap version.

- [ ] **Expo account / EAS access** — `EXPO_TOKEN`
  - Obtain: expo.dev → account settings → Access tokens.
  - Belongs: the build environment only.
  - Secret: **yes**.
  - Verify: `eas whoami` names your account.
  - Changeable later: yes; revoke and reissue freely.

- [ ] **Android upload key**
  - Obtain: let EAS generate and manage it, or upload your own keystore.
  - Belongs: EAS credentials, or your own secure storage.
  - Secret: **yes**.
  - Verify: `eas credentials` shows a configured Android keystore.
  - Changeable later: **no** — losing this key means you cannot update the app.
    Back it up and enrol in Play App Signing.

- [ ] **`EXPO_PUBLIC_API_BASE_URL`** — `https://<api-host>/api`
  - Obtain: your own deployed API origin.
  - Belongs: EAS environment variables (plain text; it is not a secret).
  - Secret: no.
  - Verify: `EAS_BUILD_PROFILE=production EXPO_PUBLIC_API_BASE_URL=... \
    pnpm --filter @slate/mobile check-release-env` exits 0.
  - Changeable later: yes, but only by shipping a new build — it is compiled in.

- [ ] **`EXPO_PUBLIC_WEB_BASE_URL`** — `https://<your-domain>`
  - Obtain: your own deployed site origin.
  - Belongs: EAS environment variables.
  - Secret: no.
  - Verify: same guard; also the app's Settings screen shows legal links
    instead of hiding them.
  - Changeable later: yes, with a new build.

- [ ] **`EXPO_PUBLIC_SUPPORT_EMAIL`**
  - Obtain: a monitored inbox you control.
  - Belongs: EAS environment variables.
  - Secret: no.
  - Verify: "Email support" appears in Settings.
  - Changeable later: yes, with a new build.

- [ ] **Confirm Play's current minimum target API and Billing Library version**
  - Obtain: Play Console → the policy banners, and Google's Play Billing
    deprecation schedule.
  - Belongs: `targetSdkVersion` in `apps/mobile/app.json` under
    `expo-build-properties`. The Billing version is **not** set in this repo —
    it arrives transitively from `openiap-google`, so changing it means moving
    the `react-native-iap` version.
  - Secret: no.
  - Verify: `npx expo prebuild` then read `android/gradle.properties` for the
    SDK levels; `pnpm --filter @slate/mobile billing:version` for Billing.
  - Current state: target API **36**, Billing **8.3.0**. Billing 8's deadline
    is 31 August 2027 and Billing 9's is 31 August 2028.
  - Changeable later: yes, but moving to Billing 9 means **react-native-iap
    15+**, which is a library upgrade rather than a version bump. Budget a real
    device test for it.

---

## REQUIRED BEFORE CLOSED TEST

Needed before anyone outside the team installs the app.

### Database

- [ ] **`DATABASE_URL`**
  - Obtain: your Postgres 14+ provider. Use a dedicated application role, not
    the superuser, and require TLS.
  - Belongs: backend host secret manager.
  - Secret: **yes**.
  - Verify: `curl https://<api-host>/ready` returns `"database":"ok"`.
  - Changeable later: yes; restart the backend to re-pool.

- [ ] **Migrations applied**
  - Run: `cd apps/backend && pnpm exec prisma migrate deploy`. Never
    `prisma db push` in production.
  - Verify: `prisma migrate diff --from-schema-datasource prisma/schema.prisma
    --to-schema-datamodel prisma/schema.prisma --exit-code` exits 0 (no drift).
  - Changeable later: forward-only; add a new migration.

- [ ] **Confirm your provider's real backup retention**
  - `web/delete-account.html` tells users deleted data may persist in backups
    for up to 30 days. That is a commitment — change the page if your provider
    differs.

### Backend secrets and configuration

- [ ] **`JWT_ACCESS_SECRET`** and **`JWT_REFRESH_SECRET`**
  - Obtain: `openssl rand -base64 48`, twice.
  - Belongs: backend host secret manager.
  - Secret: **yes**.
  - Verify: the server starts. In production it **refuses** to start if the two
    match, if either is under 32 characters, or if either still contains a
    placeholder string from `.env.example`.
  - Changeable later: yes — rotating the access secret invalidates access
    tokens (clients refresh transparently); rotating the refresh secret signs
    everyone out.

- [ ] **`TRUST_PROXY`**
  - Obtain: how many reverse proxies sit in front of the API (`1` behind a
    single load balancer; `false` if directly exposed).
  - Belongs: backend environment.
  - Secret: no.
  - Verify: the request log's `remoteAddress` shows the real client IP, not the
    balancer's.
  - Changeable later: yes.
  - **Why it matters:** the auth rate limit keys on client IP. Left unset
    behind a balancer, every login attempt on earth shares one budget.

- [ ] **`WEB_ORIGINS`** — `https://<your-domain>`
  - Obtain: your deployed site origin. Comma-separate several; no trailing
    slashes.
  - Belongs: backend environment.
  - Secret: no.
  - Verify: `curl -H "Origin: https://<your-domain>" https://<api-host>/health`
    returns an `access-control-allow-origin` header, and any other origin does
    not.
  - Changeable later: yes.
  - Missed easily: the deletion page loads fine and only fails on submit.

- [ ] **`NODE_ENV=production`**
  - Turns on the configuration refusals above. Without it they do not run.

### Data providers

- [ ] **`TMDB_API_KEY`** — themoviedb.org → Settings → API (free, instant).
  Secret: **yes**. Verify: a film search returns real results. Changeable: yes.
- [ ] **`TWITCH_CLIENT_ID`** / **`TWITCH_CLIENT_SECRET`** —
  dev.twitch.tv/console/apps (free). Secret: **yes** (the secret; the id is not
  sensitive but keep both server-side). Verify: a game search returns real
  results. Changeable: yes.
- [ ] **`OPENAI_API_KEY`** — platform.openai.com, billing enabled.
  Secret: **yes**. Verify: Ask Slate answers instead of returning 503
  `AI_NOT_CONFIGURED`. Changeable: yes.
- [ ] **`OPENAI_MODEL`** — optional; defaults to `gpt-4o-mini`. Not secret.
  Changing it changes cost and answer quality.

### Google Play

- [ ] **`GOOGLE_SERVICE_ACCOUNT_JSON`**
  - Obtain: Play Console → Setup → API access → link a Google Cloud project;
    create a service account and a JSON key; then Play Console → Users and
    permissions, invite the service-account email and grant, **scoped to this
    app**: View app information, View financial data, Manage orders and
    subscriptions. No project-level Cloud roles are needed.
  - Belongs: backend host secret manager, as a single-line string.
  - Secret: **yes, highly** — it can read financial data and modify
    subscriptions. If it leaks, revoke the key in Google Cloud immediately.
  - Verify: `/ready` reports `"playBilling":true`, and a licence-tester
    purchase grants Pro.
  - Changeable later: yes; create a new key and delete the old one.
  - Note: permission propagation takes up to ~24 hours. A 401 from the
    Publisher API right after granting usually means "wait", not
    "misconfigured".

- [ ] **Subscription products** — exactly these IDs, which are enum values in
  the database schema and cannot drift:

  | Product ID | Price | Period |
  | --- | --- | --- |
  | `SLATE_PRO_MONTHLY` | $7.99 | P1M |
  | `SLATE_PRO_YEARLY` | $59.99 | P1Y |

  Keep `apps/backend/src/config/products.ts` in step. The 37% / $35.89 /
  $5.00 annual-saving figures are derived from these two prices at runtime, so
  they correct themselves — but only if `products.ts` matches Play.
  Each product needs a **base plan**; the app requires an offer token, which
  only exists once a base plan is published.

- [ ] **`RTDN_SHARED_SECRET`**
  - Obtain: `openssl rand -hex 32`.
  - Belongs: backend environment, and the Pub/Sub push endpoint URL.
  - Secret: **yes**.
  - Setup: Google Cloud → Pub/Sub → create a topic; grant
    `google-play-developer-notifications@system.gserviceaccount.com` the
    Pub/Sub Publisher role on it; create a **push** subscription with endpoint
    `https://<api-host>/api/billing/rtdn?token=<secret>`; paste the topic name
    into Play Console → Monetisation setup.
  - Verify: `curl -i -X POST https://<api-host>/api/billing/rtdn` returns 401,
    and the same with the correct token and a valid envelope returns 200.
  - Changeable later: yes — update the Pub/Sub push endpoint in the same
    change, or renewals stop arriving.

- [ ] **Licence testers** — Play Console → Setup → Licence testing. Add the
  reviewer demo account and your own test accounts so purchases complete
  without being charged.

### Public web site

- [ ] **Fill `web/config.js`** — `legalEntity`, `contactEmail`,
  `copyrightEmail`, `apiBaseUrl`, `siteBaseUrl`, `jurisdiction`,
  `effectiveDate`. None are secret; all are legally meaningful.
  Verify: `node web/verify-config.mjs` exits 0.
  Changeable later: yes, by redeploying the static site.

- [ ] **Deploy `web/` to public HTTPS with no sign-in wall.** A reviewer must
  reach the privacy policy and the deletion page without an account and
  without installing the app.
  Verify: both URLs load in a private browser window with no "not configured"
  banner, and the deletion form's submit button is enabled.

### Operations

- [ ] **Run the backend as `node dist/server.js`, not through a package
  manager.** pnpm does not forward SIGTERM to its grandchild, so graceful
  shutdown never fires and every deploy drops in-flight requests — including
  half-applied account deletions and purchase verifications.
- [ ] **Schedule the notification sweep** — `POST
  /api/notifications/sweep-release-alerts` with an admin token, roughly hourly.
  It is idempotent (verified: 4 notifications, then 0, then 0 on repeat runs),
  so over-calling is harmless, but nothing calls it automatically.
- [ ] **Promote an admin account** — there is no self-service path, by design:
  `UPDATE "User" SET role = 'ADMIN' WHERE email = '<your admin email>';`
  `MODERATOR` gets the report queue; `ADMIN` also gets `/admin/stats`.
- [ ] **Point liveness at `/health` and readiness at `/ready`.** They are
  different questions: `/health` does no I/O so a database blip never gets
  healthy instances killed; `/ready` checks the database and returns 503 so a
  rolling deploy waits for an instance that can actually serve.

---

## REQUIRED BEFORE PRODUCTION

- [ ] **Real device QA passed** — see the matrix in `SLATE_DEVICE_QA.md`. In
  particular a real Play purchase, restore, and both account-deletion paths.
  Nothing in this repository has ever run on an Android device.
- [ ] **Play Console → App access**: demo account credentials
  (`SLATE_PLAY_REVIEWER_GUIDE.md`). Slate is entirely account-gated; without
  these a reviewer sees a login screen and nothing else.
- [ ] **Data safety form** completed from `SLATE_DATA_SAFETY_AUDIT.md`.
- [ ] **Privacy policy URL** and **account-deletion URL** entered.
- [ ] **Content rating questionnaire** answered from the app's real behaviour
  (`SLATE_PLAY_COMPLIANCE.md` §3.14).
- [ ] **Target audience** 13+, not Families. **Contains ads: No.**
- [ ] **Store listing** from `SLATE_PLAY_STORE_LISTING.md`.
- [ ] **Store graphics**: 512×512 icon and 1024×500 feature graphic produced,
  and screenshots captured from the real running app
  (`SLATE_PLAY_STORE_SCREENSHOTS.md`). The in-bundle icon and splash are valid
  PNGs at the right dimensions but are placeholder artwork.
- [ ] **Post-deployment verification** (below) run against production.

### Post-deployment verification

Health and security
- [ ] `/health` 200; `/ready` 200 with `"database":"ok"`.
- [ ] HTTP redirects to HTTPS; certificate valid.
- [ ] A foreign `Origin` gets no `access-control-allow-origin`; your own does.
- [ ] 11 rapid failed logins return 429, not 500.
- [ ] `POST /api/billing/rtdn` without the token returns 401.
- [ ] An oversized request body returns 413.

Data providers
- [ ] A film search returns real TMDB results.
- [ ] A game search returns real IGDB results.
- [ ] Ask Slate answers and enforces the 5/day free limit.

Billing
- [ ] A licence-tester account completes a purchase of each product.
- [ ] Pro appears **only after** server verification.
- [ ] Setting the entitlement row to `EXPIRED` immediately removes Pro.
- [ ] Cancelling in Play produces an RTDN that Slate processes.
- [ ] Restore on a reinstall recovers Pro.
- [ ] Submitting a token already linked to another account returns 409.

Account deletion
- [ ] In-app deletion completes; the account cannot log in again.
- [ ] Web deletion completes from a browser with no app installed.
- [ ] A wrong password is refused (403, `REAUTH_FAILED`).
- [ ] Another user's replies on a deleted user's post still exist.
- [ ] A user with an active subscription is told to cancel in Play.

Community safety
- [ ] Reporting reaches the moderation queue.
- [ ] Blocking hides that user's posts and comments immediately.
- [ ] A bystander's view is unchanged by someone else's block.

---

## OPTIONAL

- [ ] **`playStoreUrl`** in `web/config.js` — fill in after publishing.
- [ ] **Push notifications** — *not built.* Slate delivers notifications
  in-app only. Adding push requires `expo-notifications`, an FCM project and
  `google-services.json`, a device-token table, and the `POST_NOTIFICATIONS`
  runtime permission. It also **changes the Data safety declaration** (a push
  token is a new identifier) and the privacy policy, both of which currently
  state that no push token is collected. Do not enable it without updating
  `SLATE_DATA_SAFETY_AUDIT.md`, `web/privacy.html` and the store listing
  together, and do not claim it works until a real device receives a real
  notification.
- [ ] **AdMob** — *not built.* `AdProvider`/`AdSlot` exist with Pro
  suppression enforced, and `NoOpAdProvider` renders nothing. Wiring a real
  network changes the Data safety answers (advertising ID, sharing) and the
  store listing's ads flag at the same time. Not a launch blocker.
- [ ] **Error tracking / APM** — none installed. Adding a crash reporter
  changes the "App info and performance" Data safety section.
- [ ] **Row Level Security** — not applicable as built. No untrusted client
  holds a database credential; every read and write goes through the
  authenticated API, and isolation is enforced there (17 cross-user checks
  verified, including IDOR and a JWT with a forged `role: ADMIN` claim). RLS
  becomes **mandatory** if you ever let the mobile app talk to Postgres
  directly, e.g. via a Supabase client SDK.

---

## Secret handling

| Rule | Why |
| --- | --- |
| Never commit `.env` | `apps/backend/.env` is gitignored and must stay that way |
| Never put a secret in `EXPO_PUBLIC_*` | Metro inlines it into the shipped bundle |
| Use the host's secret manager | Not a `.env` file on disk, not CI plaintext |
| Rotate on suspicion | Play service-account key and `RTDN_SHARED_SECRET` first — they touch money |
| Separate staging and production credentials | A staging leak must not reach production data |
| Log the absence of a secret, never its value | The provider guards already do this |

Rotation effects, so nobody is surprised:

| Secret | Effect of rotating |
| --- | --- |
| `JWT_ACCESS_SECRET` | All access tokens invalid; clients refresh transparently |
| `JWT_REFRESH_SECRET` | Everyone is signed out |
| `RTDN_SHARED_SECRET` | Update the Pub/Sub push endpoint in the same change, or renewals stop arriving |
| Play service-account key | Purchase verification fails until the new key is deployed — nobody can obtain or refresh Pro |
| `DATABASE_URL` password | Restart the backend to re-pool |
