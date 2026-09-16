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
npm run test        # vitest — unit and component tests
npm run verify      # all of the above, then a production build
npm run test:ui     # live browser checks of the product shell
npm run test:engine # live browser checks of the spatial engine
npm run verify:full # verify, then boot a production server and run test:ui
```

`test:engine` drives the spatial engine in Chromium and reads its actual state
— camera pose, GPU resource counts, registry contents, selection and material
state — asserting that orbit moves the camera, that selection reaches the
scene, and that replacing a model frees its GPU memory. It needs the diagnostic
scene enabled:

```bash
echo 'NEXT_PUBLIC_ENABLE_PIPELINE_DIAGNOSTIC=true' >> .env.local
npm run build && npm start &
npm run test:engine
```

`test:ui` drives a real Chromium against a production build and asserts what
source inspection cannot: that every route renders without console errors, that
the layout holds at 360/390/430/768/1024/1440, that the 3D viewport stays
dominant, that navigation works, and that nothing fabricated appears on screen.

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
    layout/             app shell, nav rail, bottom nav, top bar, auth form
    workspace/          learning workspace: toolbar, context panel, AI bar
    spatial/            3D stage and its lazy boundary
    learning/           subject browser, recall modes, library, settings
    marketing/          landing-page figure
  engine/
    spatial/            DOMAIN-AGNOSTIC contracts + scene state
      scene-controller.ts   single owner of selection, visibility, camera, lifecycle
      object-registry.ts    semantic id <-> scene node resolution
      model-lifecycle.ts    load/replace/dispose state machine
    3d/                 renderer, camera rig, materials, disposal
      renderer/         colour management, tone mapping, DPR policy
      scene/            scene root, GLTF loader
      interaction/      pointer and raycast rules
      diagnostics/      labelled VEO SPATIAL ENGINE TEST scene
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
  tests/                test setup + design-token guards
scripts/                verify-ui.mjs — live browser verification
supabase/migrations/    schema + Row Level Security
```

## Current implementation status

**Gate 1 — Application Foundation: complete and verified.**
**Gate 2 — Premium Product Shell + Learning Workspace: complete and verified.**
**Gate 5 — Core Spatial / 3D Engine: complete and verified.**

Working today:

- A production spatial engine: registry-backed semantic selection, model
  lifecycle with generation guarding, leak-free disposal, model-derived zoom
  limits, fit-to-model and fit-to-selection from real scene bounds, and
  material state that never corrupts an asset's authored appearance.
- Orbit, pan, zoom, reset and animated fly-to, verified in a real browser at
  desktop and four mobile widths.
- Full design system, application shell, landing, authentication, onboarding,
  Home, Learn, Recall, Library and Settings.
- The learning workspace with model switcher, spatial toolbar, dominant
  viewport, layers panel, context panel with relationship UI, and a one-row
  AI study bar.
- Domain model for all 18 core entities, domain-agnostic throughout, with VEO
  semantic identity (`veo.anatomy.heart.left_ventricle`).
- `SpatialProvider` / `AnatomyProvider` abstractions and a functional licensed
  GLB/GLTF provider that validates a manifest and maps vendor mesh names onto
  permanent VEO identity.
- Supabase auth with session refresh and protected routes; Postgres schema and
  Row Level Security for all core tables.
- 242 automated tests plus 170 live browser checks.

Deliberately **not** present:

- **No synthetic anatomy.** VEO does not generate stand-in geometry. Anatomy
  requires licensed assets; until one is configured the product says so.
- **No fabricated data.** No invented statistics, testimonials, logos or
  progress. Where data does not exist, the empty state says so.
- **No recall algorithm or spaced repetition yet.**
- **No tutor responses yet** — the abstraction and context builder exist; the
  server route comes later.
- **No dissection or exploded view yet** — the visual-state model supports
  them; the interface does not drive them.

Next: **Gate 6** — see [VEO_BUILD_STATUS.md](./VEO_BUILD_STATUS.md).

## Note on this repository

`index.html` at the repository root is a pre-existing static page from the
previous use of this repository. It is untouched and unrelated to the VEO
application, which lives entirely under `src/`.
