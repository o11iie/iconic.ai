# VEO

**Learning you can see.**

VEO (*Vee-oh*) is a spatial-learning platform. It helps people understand and
remember complex subjects by **seeing, exploring, manipulating, understanding
and recalling** interactive spatial models — combined with AI tutoring, active
recall and spaced repetition.

The flagship experience is **VEO Anatomy**. The platform underneath is
domain-agnostic by construction: the same engine is built to serve health
sciences, engineering, chemistry, physics, architecture, computing, earth
sciences and astrophysics.

---

## The learning loop

Every feature in VEO plugs into one loop:

```
UPLOAD → UNDERSTAND → STRUCTURE → EXPLORE → ASK
       → CONNECT → RECALL → APPLY → REVIEW → REMEMBER
```

## Stack

| Concern | Choice |
| --- | --- |
| Framework | Next.js 16 (App Router, Turbopack) |
| UI | React 19.2, TypeScript 5.9 (strict) |
| Styling | Tailwind CSS v4 (CSS-first `@theme`) |
| 3D | Three.js, React Three Fiber 9, drei 10 |
| State | Zustand 5 (four separate stores) |
| Animation | Framer Motion |
| Backend | Supabase (Postgres, Auth, Storage) |
| AI | OpenAI, behind an `LLMClient` abstraction |
| Payments | Stripe, behind an entitlement abstraction |
| Validation | Zod 4 |
| Testing | Vitest 5, Testing Library, jsdom |
| Linting | ESLint 9 + `eslint-config-next` |

Exact versions are pinned in `package.json`. See
[ARCHITECTURE.md](./ARCHITECTURE.md#appendix-version-pinning-rationale) for why
each pin exists.

## Install

Requires **Node.js ≥ 20.9**.

```bash
npm install
cp .env.example .env.local
```

## Run locally

```bash
npm run dev      # development server on http://localhost:3000
npm run build    # production build
npm start        # serve the production build
```

VEO **boots with no configuration at all**. Every unconfigured integration
renders an explicit "not configured" state naming the exact variable it needs,
rather than a control that silently does nothing.

## Verification

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
npm run test        # vitest
npm run verify      # all of the above, then a production build
```

## Environment variables

Full documentation lives in [`.env.example`](./.env.example). Summary:

| Variable | Scope | Required | Purpose |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_APP_URL` | public | yes | Origin, for auth redirects |
| `NEXT_PUBLIC_SUPABASE_URL` | public | for auth | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | public | for auth | RLS-constrained browser key |
| `SUPABASE_SERVICE_ROLE_KEY` | **server** | no | Bypasses RLS. Webhooks/admin only |
| `OPENAI_API_KEY` | **server** | no | AI tutor, ingestion, generation |
| `OPENAI_MODEL` | server | no | Default model id |
| `STRIPE_SECRET_KEY` | **server** | no | Subscriptions |
| `STRIPE_WEBHOOK_SECRET` | **server** | no | Verifies webhook authenticity |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | public | no | Stripe.js checkout |
| `NEXT_PUBLIC_ANATOMY_PROVIDER` | public | no | Which provider to activate |
| `NEXT_PUBLIC_SPATIAL_ASSET_BASE_URL` | public | for 3D | Licensed asset host |
| `NEXT_PUBLIC_ENABLE_PIPELINE_DIAGNOSTIC` | public | no | Enables the render diagnostic |

**Secrets are never committed.** `.env.local` is git-ignored, server-only
modules are guarded by the `server-only` package, and ESLint forbids importing
them from client directories. This boundary is verified — see
[VEO_BUILD_STATUS.md](./VEO_BUILD_STATUS.md).

## Project structure

```
src/
  app/                  Next.js App Router routes
    (auth)/             login, signup, auth server actions
    (app)/              dashboard, explore, learn, recall, library, settings
    api/health/         capability + health endpoint
  components/
    ui/                 design-system primitives + loading/empty/error states
    layout/             app shell, navigation, auth form
    spatial/            viewport, controls, structure inspector
    anatomy/            anatomy-specific surfaces
  engine/
    spatial/            DOMAIN-AGNOSTIC provider contract, visual-state reducer
    3d/                 React Three Fiber renderer, camera rig, materials
      diagnostics/      isolated render-pipeline calibration object
  anatomy/
    taxonomy.ts         systems, regions, relationship vocabulary
    providers/          AnatomyProvider + licensed GLB/GLTF implementation
    mapping/            semantic mapping manifest schema + validation
    models/             declared model catalogue
  ai/                   LLMClient abstraction, OpenAI adapter, tutor prompts
  store/                viewer / learning / auth / ui Zustand stores
  lib/                  semantic ids, Result, errors, Supabase, Stripe
  types/domain/         all core domain entities
  config/               env (client-safe + server-only), site config
  hooks/                React bindings to the provider layer
  tests/                test setup
supabase/migrations/    schema + Row Level Security
```

## Current implementation status

**Gate 1 — Application Foundation: complete and verified.**

Working today:

- All 10 routes render and are navigable; production build passes.
- Domain model for all 18 core entities, domain-agnostic throughout.
- VEO semantic identity system (`veo.anatomy.heart.left_ventricle`) with a
  parser, builder, hierarchy operations and 17 tests.
- `SpatialProvider` / `AnatomyProvider` abstractions and a **functional**
  licensed-GLB/GLTF provider: it fetches and validates a manifest, maps vendor
  mesh names to permanent VEO ids, and drives selection, highlight, ghost,
  isolate, hide/show and camera framing.
- React Three Fiber renderer: orbit/pan/zoom, animated fly-to, fit-to-selection,
  reset, hover and click selection, material state, WebGL detection.
- Supabase auth (email/password) via server actions, session refresh and
  protected routes.
- Postgres schema and Row Level Security for all core tables.
- 93 automated tests.

Deliberately **not** present:

- **No synthetic anatomy.** VEO does not generate stand-in geometry from
  primitives. Anatomy requires licensed assets; until one is configured the
  product says so.
- **No fabricated statistics.** The dashboard shows real state or an empty
  state — never invented progress.

Next: **Gate 2** — see [VEO_BUILD_STATUS.md](./VEO_BUILD_STATUS.md).

## Note on this repository

`index.html` at the repository root is a pre-existing static page from the
previous use of this repository. It is untouched and unrelated to the VEO
application, which lives entirely under `src/`.
