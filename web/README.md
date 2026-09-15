# Slate public site (`web/`)

Static pages Google Play requires to be publicly reachable before Slate can
be submitted, plus the working account-deletion flow.

| Page | Why it exists |
| --- | --- |
| `index.html` | Landing page; links to everything below. |
| `privacy.html` | **Required.** The Privacy Policy URL entered in Play Console. |
| `delete-account.html` | **Required.** The external account-deletion URL entered in Play Console. Signs the user in and deletes the account for real. |
| `terms.html` | Terms of Service, including Slate Pro billing and cancellation. |
| `community-guidelines.html` | UGC policy — what reviewers look for on an app with user posts. |
| `copyright.html` | TMDB/IGDB attribution and the copyright notice procedure. |
| `support.html` | Support contact and self-service answers. |

No build step, no framework, no dependencies. Every page is plain HTML that
reads `config.js` at runtime.

## 1. Configure

Open `config.js` and fill in every value. They ship blank on purpose —
Slate's legal entity, contact address, domain and governing law are business
facts, and inventing them would put false statements in front of users and
reviewers.

| Key | Example shape |
| --- | --- |
| `legalEntity` | Registered name of the company or person operating Slate |
| `contactEmail` | A monitored inbox — reviewers do email it |
| `copyrightEmail` | May be the same address |
| `apiBaseUrl` | `https://api.<your-domain>/api` — no trailing slash |
| `siteBaseUrl` | `https://<your-domain>` — no trailing slash |
| `jurisdiction` | Governing law named in the Terms |
| `effectiveDate` | `YYYY-MM-DD` |
| `playStoreUrl` | Fill in after the app is published |

Until a value is filled, every page shows a loud "not configured" banner and
the deletion form refuses to submit. That is deliberate: a half-configured
page is worse than an obviously unfinished one.

## 2. Verify

```bash
node web/verify-config.mjs
```

Exits non-zero and names each problem while anything required is blank, any
URL is not `https://` or has a trailing slash, a date is not `YYYY-MM-DD`, a
required page is missing, or a page contains a `{{token}}` no config key can
fill. Run it in CI ahead of any deploy.

## 3. Allow the site to call the API

The deletion form is a browser request to Slate's API, so the API must allow
the site's origin. Set on the backend:

```
WEB_ORIGINS=https://<your-domain>
```

Comma-separate several. The backend allows **only** these browser origins —
it does not reflect arbitrary ones. Requests without an `Origin` header (the
Android app, Play's RTDN push) are unaffected.

## 4. Deploy

Upload the directory as-is to any static host (Cloudflare Pages, Netlify,
GitHub Pages, S3+CloudFront, nginx). Requirements:

- **HTTPS**, publicly reachable, **no sign-in wall in front of the pages
  themselves** — a reviewer must be able to open the privacy policy and the
  deletion page without an account and without installing the app.
- Serve `config.js` and `assets/` from the same origin as the pages.

Then point the app at it by setting, per EAS build profile:

```
EXPO_PUBLIC_WEB_BASE_URL=https://<your-domain>
EXPO_PUBLIC_SUPPORT_EMAIL=<your support address>
```

The app hides its legal links entirely until `EXPO_PUBLIC_WEB_BASE_URL` is
set, rather than shipping buttons that open dead URLs.

> The app links to extensionless paths (`/privacy`, `/delete-account`, …)
> while this directory contains `privacy.html` and `delete-account.html`.
> Most static hosts resolve that automatically ("clean URLs"); if yours does
> not, add rewrites or drop the `.html` extensions when uploading.

## 5. Enter the URLs in Play Console

- **Policy → App content → Privacy policy** → `https://<your-domain>/privacy`
- **Policy → App content → Data safety → account deletion** → the "users can
  request deletion" option, with
  `https://<your-domain>/delete-account` as the web URL, and the in-app path
  described as *Profile → Settings → Delete account*.

## What the deletion page actually does

1. `POST {apiBaseUrl}/auth/login` with the email and password typed in.
2. `POST {apiBaseUrl}/users/me/delete` with `{ password, confirm: "DELETE" }`
   and the access token from step 1.

The server deletes the account in one transaction. Nothing is queued and no
human approves it. The page stores nothing — no cookie, no `localStorage`,
no `sessionStorage`; the access token exists only in a local variable for the
duration of the submit handler. See
`apps/backend/src/modules/users/account-deletion.service.ts` for exactly what
is deleted versus anonymised, and why.
