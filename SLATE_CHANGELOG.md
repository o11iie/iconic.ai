# Slate Changelog

This tracks implementation decisions as Slate is built, in the order they were made. See `SLATE_RISKS.md` for open risks and missing credentials, and `SLATE_RELEASE_READINESS.md` (added before release) for ship/no-ship status.

## Day 1 — Foundation + Movie/TV Data

### Starting state
The repository contained a single unrelated static page (`index.html`, an "Iconic.AI automation agency" landing page) and no application code. Slate is being built from zero — this changelog reflects that reality rather than assuming prior infrastructure. `index.html` was left untouched rather than deleted.

### Architecture decisions
- **Monorepo**: pnpm workspaces — `apps/backend` (API), `apps/mobile` (Expo/React Native Android app), `packages/shared` (domain types shared by both).
- **Client**: React Native via Expo, chosen specifically because Android + Google Play release is a hard V1 requirement — a single TypeScript codebase compiles to a real Android app (via `expo run:android` / EAS Build) rather than a wrapped web view.
- **Backend**: Fastify + TypeScript + Prisma + PostgreSQL. Chosen for a small, fast, well-typed API surface a solo build can keep consistent under a tight timeline; no reason to add a heavier framework.
- **Auth**: First-party email/password with bcrypt + short-lived JWT access tokens (15 min) and rotating opaque refresh tokens (30 days, hashed at rest). No third-party auth provider introduced — kept simple and owned.
- **Domain model**: Slate does not mirror TMDB/IGDB catalogs into its own database. A `Title` row is a thin cached pointer (id, name, release date) created lazily the first time a user follows/watchlists/discusses it — full metadata is always fetched live from the provider. This respects both providers' terms (no wholesale redistribution of their catalog) and avoids a sync/staleness problem entirely.
- **Countdowns**: `computeCountdown()` explicitly refuses to fabricate a time-of-day. TMDB and IGDB only ever report a calendar date. A numeric HH:MM:SS countdown is only produced for `exact_datetime` precision, which nothing currently populates — this is intentional, not a bug, until a source that actually reports release *times* is integrated. Date-only titles get a date label and a "released / not yet" boolean, never an invented countdown.
- **Hype Score**: An explicit, documented heuristic (`computeHypeScore`) blending provider rating and release proximity — not a claim of real-world buzz/social data Slate doesn't have. Must always be labeled "Slate's Hype Score" in the UI, never presented as an objective fact.
- **Ask Slate (AI)**: Provider-agnostic `AiProvider` interface; `OpenAiProvider` is the only implementation for V1, per explicit product decision. The system prompt instructs the model to decline rather than guess when context is missing, and to respect spoiler sensitivity. All AI calls are server-side only; the mobile client never sees the OpenAI key. Daily usage is rate-limited per user (5/day free, 100/day Pro — configurable, not literally unlimited, to bound cost and abuse).
- **Slate Pro / Billing**: Google Play Billing only for V1 (no RevenueCat), per explicit product decision. The mobile client's local purchase state is never trusted — every purchase token is re-verified server-side against the Play Developer API (`purchases.subscriptionsv2`), and the resulting `Entitlement` row in Postgres is the only source of truth `isPro` checks read from. Purchase/RTDN processing is idempotent via a `(purchaseToken, rawStatus)` unique constraint on `PurchaseEvent`. Product IDs and reference pricing live in one config file (`apps/backend/src/config/products.ts`) — nowhere else hardcodes "$5.99" or "$49.99".
- **Free tier limits** (watchlist: 25 items, follows: 10 titles, Ask Slate: 5/day) are real, enforced server-side gates — not UI-only suggestions — so Pro is a genuine, verifiable upgrade rather than a client-side flag.

### Built this session
- Prisma schema covering users/auth, titles, watchlist, follows, community (posts/comments/reactions/reports), entitlements/purchase events, AI conversations/usage, notifications, and analytics events.
- Backend: auth (signup/login/refresh/logout/me), TMDB client + movie/TV routes, IGDB client (Twitch OAuth) + game routes, unified discovery/search/trending/upcoming with real (non-fabricated) countdown computation, watchlist + follows with Pro gating, community posts/comments/reactions/reports, Ask Slate with OpenAI provider + rate limiting, billing (product catalog, purchase verification, RTDN webhook), notifications, admin (moderation queue, coarse stats).
- Mobile: Expo app scaffold, auth flow, bottom-tab navigation (Discover/Search/Watchlist/Profile), title detail screen with follow/watchlist/Ask Slate actions, Ask Slate chat screen, Pro paywall screen wired to `react-native-iap` (Google Play Billing) and the backend's verify-purchase/restore endpoints.
- Automated tests for the logic that must never lie: countdown precision handling and hype score bounds/ordering, plus product catalog integrity. Backend typechecks, lints, and boots cleanly; a live smoke test confirmed `/health` and `/api/discover/trending` both behave correctly with zero provider keys configured (returns an empty result set, not fabricated data or a crash).

### Explicitly deferred, not silently dropped
- Full game/anticipation-engine polish and personalization (Day 2 scope) — the IGDB client and games routes exist and are wired into unified discovery now, but ranking/personalization logic is still basic.
- Push notifications (only in-app notification rows exist so far; no FCM wiring yet).
- Ads for free users, analytics dashboards, and design polish (Day 4 scope).
- Android release signing, ProGuard/R8 config, and Play Console listing (Day 5 scope).
