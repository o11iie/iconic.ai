# SLATE — Production Configuration Runbook

Everything that has to be configured outside the repository, in the order it
has to happen.

**No secret value appears in this document, and none should ever be committed.**
Where a value is needed, this names the variable, where it comes from, and how
to confirm it is working — never the value itself.

---

## 0. Principles this configuration enforces

1. **No provider credential ever reaches the mobile client.** TMDB, IGDB,
   Twitch, OpenAI and Google Play credentials are backend-only. `EXPO_PUBLIC_*`
   variables are inlined into the JavaScript bundle and are public by
   definition — a secret there is a published secret.
2. **The backend starts without optional credentials and degrades honestly.**
   Each provider has an `isXConfigured()` guard; a missing key produces a clear
   "not configured" response, never fabricated data.
3. **Entitlement is server-authoritative.** Pro comes from Google's answer to
   `purchases.subscriptionsv2`, never from a client claim.
4. **Placeholders fail loudly.** `web/verify-config.mjs` and
   `apps/mobile/scripts/check-release-env.mjs` both exit non-zero rather than
   let an unconfigured build or site ship.

---

## 1. Backend environment

Set on the backend host. `apps/backend/src/env.ts` is the schema; it validates
at first access and throws on anything malformed.

### Required — the server will not start without these

| Variable | Source | Notes |
| --- | --- | --- |
| `DATABASE_URL` | Your Postgres provider | Use a dedicated application role, not the superuser. Require TLS |
| `JWT_ACCESS_SECRET` | Generate: `openssl rand -base64 48` | ≥ 16 chars enforced. Rotating it invalidates all access tokens |
| `JWT_REFRESH_SECRET` | Generate separately | **Must differ from the access secret.** Rotating it signs everyone out |

### Required for the features that depend on them

| Variable | Source | Without it |
| --- | --- | --- |
| `TMDB_API_KEY` | themoviedb.org → Settings → API | Film and TV endpoints return "not configured" |
| `TWITCH_CLIENT_ID` | dev.twitch.tv → register an application | Game endpoints unavailable |
| `TWITCH_CLIENT_SECRET` | Same application | Same. Slate exchanges these for an IGDB client-credentials token server-side |
| `OPENAI_API_KEY` | platform.openai.com | Ask Slate returns "not configured" rather than a canned answer |
| `OPENAI_MODEL` | — | Defaults to `gpt-4o-mini`. Changing it changes cost and answer quality |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | See §3 | Purchases cannot be verified, so **no one can get Pro** |
| `GOOGLE_PLAY_PACKAGE_NAME` | — | Defaults to `ai.iconic.slate`. Must match the published package |
| `RTDN_SHARED_SECRET` | Generate: `openssl rand -hex 32` | The RTDN webhook rejects everything (401), so renewals and cancellations never reach Slate |
| `WEB_ORIGINS` | Your site origin | No browser origin is allowed, so the **web account-deletion page cannot call the API** |

### Optional

| Variable | Default |
| --- | --- |
| `PORT` | `4000` |
| `NODE_ENV` | `development` — set to `production` |

### Verify

```bash
curl -s https://<api-host>/health
# {"status":"ok","timestamp":"..."}
```

Then confirm each provider guard reports configured rather than degraded, by
exercising one endpoint per provider against the real service.

---

## 2. Database

1. Provision Postgres 14+ with TLS and automated backups.
2. Apply migrations — **never** `prisma db push` in production:
   ```bash
   cd apps/backend && pnpm exec prisma migrate deploy
   ```
3. Confirm every migration in `apps/backend/prisma/migrations/` is applied.
4. Note your provider's actual backup retention window and make
   `web/delete-account.html` match it (it currently states up to 30 days).
   That statement is a commitment to users.

The application role needs DML on all tables plus DDL for `migrate deploy`. If
you separate those, run migrations as a migration role and serve traffic as a
lower-privileged one.

---

## 3. Google Play Billing

### 3.1 Service account for purchase verification

1. Play Console → Setup → **API access** → link a Google Cloud project.
2. In Google Cloud, create a service account. **No project-level roles are
   needed.**
3. Create a JSON key and download it once.
4. Back in Play Console → Users and permissions, invite the service-account
   email and grant, scoped to this app only:
   - View app information
   - **View financial data**
   - **Manage orders and subscriptions**
5. Put the JSON into `GOOGLE_SERVICE_ACCOUNT_JSON` as a single-line string, via
   your host's secret manager. **Never commit it.** If it leaks, revoke the key
   in Google Cloud immediately — it can read financial data and modify
   subscriptions.
6. Permission propagation takes up to ~24 hours. A 401 from the Publisher API
   right after granting usually means "wait", not "misconfigured".

### 3.2 Subscription products

Play Console → Monetise → Subscriptions. Create exactly these IDs — they are
enum values in the database schema and cannot drift:

| Product ID | Price | Period |
| --- | --- | --- |
| `SLATE_PRO_MONTHLY` | $7.99 | P1M |
| `SLATE_PRO_YEARLY` | $59.99 | P1Y |

Keep `apps/backend/src/config/products.ts` in step. The 37% / $35.89 / $5.00
annual-saving figures are derived from these two prices at runtime, so they
correct themselves — but only if `products.ts` matches Play.

### 3.3 Real-time developer notifications

1. Google Cloud → Pub/Sub → create a topic, e.g. `slate-rtdn`.
2. Grant `google-play-developer-notifications@system.gserviceaccount.com` the
   **Pub/Sub Publisher** role on that topic.
3. Create a **push** subscription with endpoint:
   ```
   https://<api-host>/api/billing/rtdn?token=<RTDN_SHARED_SECRET>
   ```
4. Play Console → Monetisation setup → paste the topic name.
5. Verify:
   ```bash
   curl -i -X POST https://<api-host>/api/billing/rtdn          # expect 401
   curl -i -X POST "https://<api-host>/api/billing/rtdn?token=wrong"  # expect 401
   ```
   A correct token with a valid Pub/Sub envelope returns 200.

An RTDN for a purchase token Slate has never seen is acknowledged with 200 and
logged — it must not be retried forever.

### 3.4 Licence testers

Play Console → Setup → **Licence testing**. Add the reviewer demo account and
your own test accounts so purchases complete without being charged.

---

## 4. Public web site

Full detail in `web/README.md`. In short:

1. Fill every value in `web/config.js`.
2. `node web/verify-config.mjs` — must exit 0.
3. Deploy `web/` to public HTTPS with **no sign-in wall** in front of the
   pages. A reviewer must reach the privacy policy and the deletion page
   without an account and without installing the app.
4. Set the backend's `WEB_ORIGINS` to that origin, or the deletion form's
   requests will be blocked by CORS.
5. Confirm from a browser:
   - `https://<your-domain>/privacy` loads with no "not configured" banner.
   - `https://<your-domain>/delete-account` loads and its submit button is
     **enabled**.
   - Deleting a throwaway account end to end actually works.

The app links to extensionless paths (`/privacy`, `/delete-account`). Most
static hosts resolve those to the `.html` files automatically; if yours does
not, add rewrites.

---

## 5. Mobile build

Full detail in `apps/mobile/ENV.md`.

Set as EAS environment variables — never committed:

| Variable | Value |
| --- | --- |
| `EXPO_PUBLIC_API_BASE_URL` | `https://<api-host>/api` |
| `EXPO_PUBLIC_WEB_BASE_URL` | `https://<your-domain>` |
| `EXPO_PUBLIC_SUPPORT_EMAIL` | Your support address |

`scripts/check-release-env.mjs` runs as the `eas-build-pre-install` hook and
fails a `preview` or `production` build when any of these is missing, not
HTTPS, a reserved placeholder host, or a local address.

**Before a production build**, resolve the target-API blocker in
`SLATE_PLAY_COMPLIANCE.md` §1. Building at API 34 wastes a build slot — Play
rejects it at upload.

### Signing

Let EAS manage the Android keystore, or upload your own. Either way, back up
the upload key: losing it means you cannot update the app. Enrol in Play App
Signing.

---

## 6. Administrator and moderator accounts

`User.role` defaults to `USER`. There is no self-service promotion and no
endpoint that grants a role — intentionally. Promote deliberately, by hand:

```sql
UPDATE "User" SET role = 'ADMIN' WHERE email = '<your admin email>';
```

- `MODERATOR` — the report queue and content removal (`/admin/reports`).
- `ADMIN` — the above plus `/admin/stats`.

Keep the admin set small. Every admin route requires a valid access token
**and** the role.

---

## 7. Post-deployment verification

Run against production before announcing anything.

### Health and security
- [ ] `/health` returns 200.
- [ ] HTTP redirects to HTTPS; TLS certificate valid.
- [ ] `curl -H "Origin: https://evil.example" https://<api-host>/health` returns
      **no** `access-control-allow-origin` header.
- [ ] `curl -H "Origin: https://<your-domain>" ...` **does** return it.
- [ ] 11 rapid failed logins return 429, not 500.
- [ ] `POST /api/billing/rtdn` without the token returns 401.

### Data providers
- [ ] A film search returns real TMDB results.
- [ ] A game search returns real IGDB results.
- [ ] Ask Slate returns a real answer and enforces the daily limit.

### Billing
- [ ] A licence-tester account completes a purchase.
- [ ] Pro appears **only after** server verification.
- [ ] Flipping the entitlement row to `EXPIRED` immediately removes Pro.
- [ ] Cancelling in Play produces an RTDN that Slate processes.

### Account deletion — the Play-critical path
- [ ] In-app deletion completes and the account cannot log in again.
- [ ] Web deletion completes from a browser with no app installed.
- [ ] A wrong password is refused (403, `REAUTH_FAILED`).
- [ ] Another user's replies on a deleted user's post still exist.
- [ ] A user with an active subscription is told to cancel in Play.

### Community safety
- [ ] Reporting reaches the moderation queue.
- [ ] Blocking hides that user's posts and comments immediately.
- [ ] A bystander's view is unchanged by someone else's block.
- [ ] Unblocking restores visibility.

---

## 8. Secret handling

| Rule | Why |
| --- | --- |
| Never commit `.env` | `apps/backend/.env` is gitignored and must stay that way |
| Never put a secret in `EXPO_PUBLIC_*` | Metro inlines it into the shipped bundle |
| Use the host's secret manager | Not a `.env` file on disk, and not CI plaintext |
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

---

## 9. Configuration order

Dependencies, so nothing is done twice:

1. Database → migrations applied.
2. Backend env (secrets, `DATABASE_URL`, JWT secrets) → `/health` green.
3. Provider credentials → search and Ask Slate verified live.
4. Deploy the web site → set `WEB_ORIGINS` → web deletion verified end to end.
5. Play Console: package, subscription products, service account, RTDN,
   licence testers.
6. **Resolve the target-API blocker.**
7. EAS environment variables → production build (the guard passes).
8. Upload the AAB; complete Data safety, content rating, App access and the
   store listing.
9. Internal testing track → run §7 on the real build.
10. Promote to production.
