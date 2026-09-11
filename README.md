# Slate — The Home of Entertainment Hype

Monorepo for Slate, an Android-first entertainment app covering movies, TV, and video games.

## Structure

- `apps/backend` — Fastify + TypeScript + Prisma/PostgreSQL API. Source of truth for entitlements, community content, and AI usage.
- `apps/mobile` — Expo (React Native) Android app.
- `packages/shared` — Domain types shared by both.

See `SLATE_CHANGELOG.md` for what's built and why, and `SLATE_RISKS.md` for what's still blocked on credentials/accounts (TMDB, IGDB, OpenAI, Google Play Console) before this runs against real data and real purchases.

## Backend setup

```bash
cd apps/backend
cp .env.example .env   # fill in real values — see SLATE_RISKS.md
pnpm install
pnpm exec prisma migrate dev   # requires a running Postgres instance
pnpm dev
```

## Mobile setup

```bash
cd apps/mobile
pnpm install
pnpm start   # Expo dev server; Google Play Billing requires a dev build, not Expo Go
```
