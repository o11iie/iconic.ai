# Slate — Day 1 Checklist

Scope for today per the reframed objective: **complete and stabilize the movie/TV foundation and discovery experience.** Games, community, AI, and billing exist from prior work and are noted but are not today's focus.

## Audit phase

- [x] Inspect package.json, lockfiles, source tree across all 3 workspaces
- [x] Inspect routes/navigation (backend routes, mobile React Navigation stacks)
- [x] Inspect screens, reusable components, styling system, fonts, image handling
- [x] Inspect API services (TMDB client, IGDB client)
- [x] Inspect database (schema, migrations)
- [x] Inspect authentication (JWT + bcrypt flow)
- [x] Inspect state management (React Context: Auth, Entitlement)
- [x] Inspect environment variables (`.env.example`, `env.ts` validation)
- [x] Inspect existing movie functionality
- [x] Inspect existing TV functionality
- [x] Inspect existing game functionality
- [x] Inspect backend/server bootstrap
- [x] Inspect Android configuration (`app.json` android block)
- [x] Inspect Expo/React Native configuration
- [x] Inspect tests (backend vitest suite)
- [x] Inspect build scripts, deployment configuration (none yet — correctly absent at this stage)
- [x] Inspect current error/loading/empty states in mobile screens
- [x] Run typecheck (backend, mobile, shared) — all clean
- [x] Run lint (backend) — clean
- [x] Run tests (backend, 11/11 pass)
- [x] Boot the backend live and smoke-test `/health` + `/api/discover/trending`
- [x] Validate mobile Expo config resolves (`expo config --type public`)
- [x] Write `SLATE_DAY1_AUDIT.md`
- [x] Write `SLATE_DAY1_CHECKLIST.md` (this file)

## Implementation phase

- [x] Fix P0: missing mobile asset files (`icon.png`, `splash.png`, `adaptive-icon.png`, `favicon.png`) that `app.json` referenced but didn't exist — would have broken any `expo start`/build
- [x] Generate baseline Prisma migration from the existing schema (none existed before today)
- [ ] Add `page` query param support to `/api/discover/trending`, `/api/discover/upcoming`, `/api/search` (backend)
- [ ] Add "Load more" to `HomeScreen` and `SearchScreen` (mobile) using the new pagination
- [ ] Add TV season listing: `/api/tv/:id/seasons/:seasonNumber` route + season count/list on TV detail
- [ ] Show season list in `TitleDetailScreen` when `mediaType === "tv"`
- [ ] Re-run typecheck + lint + tests after changes
- [ ] Live smoke-test the changed endpoints
- [ ] Commit and push

## Explicitly deferred (not silently dropped — tracked for a later day)

- [ ] Genre-based discovery/browse UI
- [ ] Streaming/watch-provider data
- [ ] Deep-linking config for notification taps
- [ ] Password reset / email verification
- [ ] CI workflow, `eas.json`, Dockerfile (Day 5 scope)
- [ ] Real brand icon/splash assets (design deliverable, not engineering — placeholders in place so builds don't break)
