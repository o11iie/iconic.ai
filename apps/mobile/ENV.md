# Mobile build environment

Metro inlines `EXPO_PUBLIC_*` variables into the JavaScript bundle at build
time, so whatever is set when the bundle is built is what ships. Everything
here is public by definition — **never put a secret in an `EXPO_PUBLIC_*`
variable.** TMDB, IGDB/Twitch, OpenAI and Google Play credentials live on the
backend only and must never appear in this app.

## Variables

| Variable | Required for | Effect if unset |
| --- | --- | --- |
| `EXPO_PUBLIC_API_BASE_URL` | every build | Development falls back to the emulator loopback `http://10.0.2.2:4000/api`. A release build **throws at startup** rather than silently talking to a dev address. |
| `EXPO_PUBLIC_WEB_BASE_URL` | production | The app hides its Privacy Policy, Terms, Guidelines, Copyright and Support links rather than opening dead URLs. Google Play requires the privacy policy to be reachable, so a production build without this is not submittable. |
| `EXPO_PUBLIC_SUPPORT_EMAIL` | optional | The "Email support" row in Settings is hidden. |

## Where they are set

`development` sets `EXPO_PUBLIC_API_BASE_URL` inline in `eas.json` because the
emulator loopback is not sensitive and not environment-specific.

`preview` and `production` deliberately set **nothing** in `eas.json`. Real
hostnames are per-deployment facts, and a committed placeholder is worse than
a blank: it builds successfully and fails in a user's hands. Set them as EAS
environment variables (Project → Environment variables, visibility "plain
text") or with `eas env:create`.

## The guard

`scripts/check-release-env.mjs` runs as EAS's `eas-build-pre-install` hook and
**fails the build** on a `preview` or `production` profile when a required
variable is missing, is not `https://`, points at a reserved placeholder host
(`.example`, `.invalid`, `.test`, `.localhost`), or points at a local address.
Development profiles are skipped.

Run it locally the same way EAS does:

```bash
EAS_BUILD_PROFILE=production \
EXPO_PUBLIC_API_BASE_URL=https://api.<your-domain>/api \
EXPO_PUBLIC_WEB_BASE_URL=https://<your-domain> \
pnpm --filter @slate/mobile check-release-env
```
