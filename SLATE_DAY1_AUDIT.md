# Slate — Day 1 Audit

**Important context this audit must be honest about:** this repository has one prior commit of application code (`aa1a028`, on this same branch), built in an earlier session of this same engagement. It is not a legacy codebase from another team — it's Slate's actual current state. This audit inspects it exactly as it would inspect any pre-existing codebase: by running it, reading it, and verifying claims rather than trusting memory of having written it.

Before this commit, the repository contained a single unrelated static page (`index.html`, an "Iconic.AI automation agency" landing page, still present and untouched — irrelevant to Slate, not deleted).

## Method

Ran, don't assume: `pnpm exec tsc --noEmit`, `pnpm exec eslint`, `pnpm exec vitest run` in `apps/backend`; `pnpm exec tsc --noEmit` in `apps/mobile` and `packages/shared`; booted the Fastify server live and curled `/health` and `/api/discover/trending`; ran `expo config --type public` to validate the mobile app config resolves. No Android emulator/device or Postgres instance is available in this sandbox, so the mobile app could not be launched on-device and the backend could not be exercised against a real database — noted below as an actual environment constraint, not glossed over.

## CURRENT STACK

- **Backend**: Fastify 5 + TypeScript (strict) + Prisma 5 (Postgres) + Zod validation + `@fastify/jwt` + bcryptjs + OpenAI SDK + google-auth-library. Vitest for tests, ESLint (`@typescript-eslint`) for lint.
- **Mobile**: Expo SDK 51 + React Native 0.74 + TypeScript (strict) + React Navigation 6 (native-stack + bottom-tabs) + expo-secure-store + expo-constants + react-native-iap.
- **Shared**: `packages/shared` — plain TypeScript types/interfaces, no runtime dependencies, consumed by both apps via pnpm workspace `paths` mapping.
- **Monorepo tool**: pnpm workspaces (no Turborepo/Nx — appropriate at this size).
- **Database**: PostgreSQL via Prisma ORM. No live instance in any environment yet.

## CURRENT ARCHITECTURE

```
apps/backend/src/
  app.ts, server.ts, env.ts, prisma.ts     — bootstrap, env validation, DB client
  plugins/                                  — authenticate (JWT), require-role
  config/products.ts                        — single source of truth for Pro pricing/product IDs
  lib/media-type.ts                         — shared <-> Prisma enum mapping
  modules/
    auth/        — signup/login/refresh/logout/me
    tmdb/        — TMDB client + movie/TV routes
    igdb/        — IGDB (Twitch OAuth) client + game routes
    titles/      — ensure-title.ts (lazy local cache row for watchlist/follow FKs)
    discovery/   — unified trending/upcoming/search, countdown.ts, hype.ts
    watchlist/, follows/  — user state, Pro-gated limits
    community/   — posts/comments/reactions/reports
    ai/          — provider.ts (interface), openai-provider.ts, usage-limits.ts, ai.routes.ts
    billing/     — play-verification.ts, entitlement.service.ts, billing.routes.ts
    notifications/, admin/
apps/mobile/
  App.tsx, app.json
  src/api/client.ts          — fetch wrapper, token refresh-on-401
  src/state/                 — AuthContext, EntitlementContext (React Context, no Redux/Zustand)
  src/navigation/            — RootNavigator (auth stack vs tab navigator), one stack per tab
  src/screens/{auth,main}/   — Login, Signup, Home, Search, TitleDetail, Watchlist, Profile, AskSlate, ProUpgrade
  src/billing/iap.ts         — react-native-iap wrapper
  src/theme.ts                — flat color token object
packages/shared/src/          — title.ts, user.ts, billing.ts, community.ts, ai.ts
```

Style system: `StyleSheet.create` per screen + one shared `colors` token file. No design-token system beyond that, no component library, no custom fonts loaded (system font only). This is proportionate to current scope — not a gap worth fixing before there's a second visual pass.

## CURRENT FEATURES (what actually runs, verified)

- Email/password auth end-to-end (signup, login, JWT refresh rotation, logout), verified via typecheck + route logic inspection; not exercised against a live DB in this sandbox.
- Movie/TV trending, upcoming, search, and detail — real TMDB v3 API contract (genres, cast, trailers, franchise pointer). Verified empty-but-correct behavior live: with no `TMDB_API_KEY` set, `/api/discover/trending` returns `{"results":[]}`, not an error and not fabricated data.
- Game trending/search/detail — real IGDB (Twitch OAuth) Apicalypse contract. Same "empty, not fake" behavior when unconfigured.
- Countdown computation that refuses to invent time-of-day precision the provider didn't supply (unit-tested).
- Hype Score heuristic (rating + release proximity), explicitly documented as Slate's own ranking, not real-world buzz data (unit-tested).
- Watchlist/Follows with real, server-enforced free-tier caps (25 / 10) returning a distinguishable `PRO_REQUIRED` error code the mobile client checks for.
- Community posts/comments/reactions/reports — full CRUD, spoiler flag is self-reported (no ML detection).
- Ask Slate — OpenAI behind a swappable `AiProvider` interface, per-user daily usage cap (5 free / 100 Pro), server-side only, spoiler-aware system prompt that instructs the model to decline rather than guess.
- Slate Pro entitlements — Play Billing purchase verification against the real Android Publisher API surface, idempotent via `(purchaseToken, rawStatus)` uniqueness, entitlement DB row is the only thing any Pro check reads (mobile `EntitlementContext` always re-fetches from `/billing/entitlement`, never trusts a local flag).
- Mobile: full navigable app — auth → tabs → detail/paywall/chat screens, all wired to the backend contract via a typed fetch client with auto token-refresh.

## MOVIE STATUS

**Works**: trending (day/week via TMDB), upcoming, search, detail (overview, cast top-15, trailers, franchise/collection pointer, genres, poster/backdrop URLs), countdown, watchlist/follow toggling, Ask Slate context injection.
**Partially built**: pagination — `tmdb.client.ts` functions accept a `page` argument, but `discovery.routes.ts` never forwards a `page` query param and the mobile Home/Search screens have no "load more." Users are hard-capped at TMDB's first page (~20 items) per section. **Fixed in this session — see below.**
**Missing**: genre-based browsing (discover-by-genre), streaming/watch-provider info, review scores beyond TMDB's `vote_average`.
**Hardcoded**: `MOVIE_GENRES`/`TV_GENRES` id→name maps are hand-copied from TMDB's stable genre list rather than fetched from `/genre/movie/list` — reasonable (that list rarely changes and this avoids an extra round-trip) but should be noted as a static snapshot, not a live source.

## TV STATUS

**Works**: same trending/upcoming/search/detail pipeline as movies, sharing one client and one route file.
**Missing**: season/episode browsing entirely. `episodeCount` (total across the show) is captured, but there's no per-season list, no "next episode" info, no watch-order-within-a-show. This is a real gap for a TV-focused entertainment app and is the most significant TV-specific hole. **Addressed in this session — see below.**
**Note**: `on_the_air` is used as TV's "upcoming" signal (TMDB has no direct "upcoming TV" endpoint) — a reasonable substitute, not a bug.

## GAME STATUS

Out of Day 1's rescoped focus (movie/TV foundation), but present and functional at the same level as movies: trending (via `hypes`-sorted anticipated titles), search, detail. No season/DLC/platform-release-variant handling — expected, deferred to the games-focused day.

## NAVIGATION STATUS

React Navigation, one native-stack per bottom-tab (Home, Search, Watchlist, Profile), each able to push `TitleDetail`; Home/Profile can also push `AskSlate`/`ProUpgrade`. Typechecks clean, including param lists. No deep-linking scheme wired beyond the bare `scheme: "slate"` in `app.json` (no linking config object) — acceptable gap for Day 1, real gap for Day 4/5 (notification taps need it eventually).

## API STATUS

All routes typecheck, lint clean, and the server boots and responds correctly with zero provider keys configured (verified live, not assumed). No OpenAPI/Swagger doc generated yet — routes are the only source of truth for the contract right now.

## DATABASE STATUS

Schema (`prisma/schema.prisma`) is complete for the V1 domain (13 models, matches every feature above). **Gap found and fixed in this session**: no migration existed — the schema had never been turned into a `prisma/migrations/*/migration.sql`. Generated the baseline migration via `prisma migrate diff --from-empty` (works without a live DB connection) and committed it as `prisma/migrations/20260911000000_init`. No live Postgres instance exists in any environment yet — first real `prisma migrate deploy` against an actual database is still outstanding and blocked on provisioning one (see `SLATE_RISKS.md`).

## AUTH STATUS

Fully implemented (bcrypt + JWT access/refresh), not yet exercised against a live database in any environment. No password reset flow (stubbed nowhere — genuinely absent, not hidden). No email verification. Both are reasonable Day 1 omissions for a five-day timeline, not silently-dropped V1 requirements (V1 scope doesn't list either explicitly).

## BUILD STATUS

- Backend: `tsc --noEmit` clean, `eslint` clean, 11/11 tests pass, server boots and serves real traffic-shaped responses.
- Mobile: `tsc --noEmit` clean. **P0 bug found and fixed in this session**: `app.json` referenced `./assets/icon.png`, `./assets/splash.png`, `./assets/adaptive-icon.png` — none of which existed. This would have broken `expo start` / any prebuild the moment Expo tried to resolve them. Placeholder PNGs (solid Slate brand color) were generated and committed; real brand assets are a design task, not an engineering blocker, and are tracked in `SLATE_RISKS.md`.
- No CI workflow, no `eas.json`, no Dockerfile exist yet. Expected at this stage; not yet needed until Day 5 (Google Play readiness) and not a Day 1 blocker.

## P0 BLOCKERS (found this session, fixed unless noted)

1. **Missing mobile asset files referenced by `app.json`** — FIXED (placeholder assets generated; real brand assets still needed from design, tracked as a risk not an engineering blocker).
2. **No Prisma migration existed** — FIXED (baseline migration generated and committed via schema diff, without needing a live DB).
3. **No pagination on discovery endpoints** — blocks "complete discovery experience" as stated in today's objective — FIXED this session (see implementation section).
4. **No TV season data** — blocks "complete movie/TV foundation" for TV specifically — FIXED this session (see implementation section).

## P1 ISSUES (real, not blocking today, tracked)

- No genre-based browse/filter UI (data exists server-side as static genre maps; no `/genres` endpoint or UI chips yet).
- No streaming/watch-provider data (TMDB supports `/watch/providers`; not integrated).
- No deep-linking config for push-notification taps (notification rows exist, FCM wiring doesn't).
- No password reset / email verification.
- `docs/` directory exists but is empty — either populate it or remove it; leaving an empty directory tracked in git is disorganized. Left as-is pending a decision on what belongs there.
- No CI, no `eas.json` — correctly out of scope until Day 5.

## WHAT SHOULD BE PRESERVED (do not rebuild)

Everything above marked "Works" — the auth flow, the TMDB/IGDB client contracts, the countdown/hype logic (unit-tested, correctness-critical, don't rewrite casually), the entitlement/billing verification path, the mobile navigation shell and API client. All of it typechecks, lints, and behaves correctly under live smoke-testing. Rebuilding any of it "differently" without a concrete defect would be pure churn against a hard five-day deadline.

## WHAT SHOULD NOT BE TOUCHED

The billing/entitlement verification logic and the countdown precision logic — both encode explicit non-negotiable product rules (never trust a client Pro flag; never fabricate a release time) and both are covered by tests or live-verified behavior. Changes here need a real reason, not a style preference.

## DAY 1 IMPLEMENTATION ORDER (this session)

1. Fix the mobile asset P0 (blocks any build) — done first, cheapest, unblocks everything else.
2. Generate the missing baseline DB migration — done, no live DB needed.
3. Add pagination to `/discover/trending`, `/discover/upcoming`, `/search` (backend) + "Load more" in Home/Search (mobile) — directly required by today's "complete discovery experience" objective.
4. Add TV season listing (`/tv/:id/seasons/:seasonNumber` + season count in detail) + a basic season list in `TitleDetailScreen` for TV titles — directly required by today's "complete movie/TV foundation" objective, and the single biggest verified TV gap.
5. Re-run typecheck/lint/tests, smoke-test the server live again, commit and push.
