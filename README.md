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
npm run test:ui        # live browser checks of the product shell
npm run test:engine    # live browser checks of the spatial engine
npm run test:semantics # live browser checks of semantic object interaction
npm run test:spatial   # live browser checks of spatial manipulation
npm run test:anatomy   # live browser checks of the anatomy provider boundary
npm run test:tutor     # live browser checks of the contextual AI tutor
npm run test:learning  # live browser checks of question and flashcard generation
npm run test:browser   # all seven, in order

npm run validate:anatomy                      # validate the contract fixture
npm run validate:anatomy -- <manifest.json>    # validate a real manifest
npm run validate:anatomy -- <manifest.json> --asset <model.glb>
npm run verify:full    # verify, then boot a production server and run test:ui
```

`test:engine` drives the spatial engine in Chromium and reads its actual state
— camera pose, GPU resource counts, registry contents, selection and material
state — asserting that orbit moves the camera, that selection reaches the
scene, and that replacing a model frees its GPU memory.

`test:semantics` goes a layer up: that pointer, touch and keyboard input
resolve to semantic objects, that the interface is driven by those objects
rather than by meshes, that an id from a URL is validated against the loaded
model, and that a render node held across a model replacement resolves to
nothing. Screen positions are discovered by moving the pointer and asking the
engine what is under it, so no assertion depends on hard-coded geometry.

`test:spatial` takes the model apart and puts it back: layers, isolation,
ghosting, peel, dissection and an exploded view, then a reset run twice. Two
claims there are measured rather than asserted — that every semantic object is
still registered and searchable after each manipulation, and that an exploded
part returns to the *exact* coordinates the asset shipped.

`test:anatomy` verifies the provider boundary: that a missing licensed source
produces an honest unavailable state with no geometry at all, that the
diagnostic scene stays out of the anatomy path, that the model catalogue is the
allowlist, and that no provider secret reaches the browser — with a positive
control, because a scan that finds no secret may simply be a scan that finds
nothing.

`test:tutor` proves the tutor understands what the learner has selected. Its
governing rule is that **an answer appearing is not a pass** — a tutor ignoring
the selection entirely would still render text. So it asserts that the reply
names the real structure, its real parent and its real relationship targets,
all resolved server-side from VEO's own model; that a structure the model
describes poorly produces an honest "not in this model" rather than a
confident answer; that a proposed action aimed at a structure which does not
exist is rejected before it reaches the browser; and that neither the API key
nor the system prompt appears on any browser surface.

It runs against a deterministic provider rather than a live model, enabled by
`VEO_TUTOR_STUB=1` at build time:

```bash
VEO_TUTOR_STUB=1 npm run build
VEO_TUTOR_STUB=1 npm start &
npm run test:tutor
```

A live model would make every run different, so no assertion could be stronger
than "some text appeared". The stub replaces only the network call — request
validation, model resolution, context building, prompt assembly, output
validation, grounding and dispatch all run for real — and it composes its reply
out of the context it was handed, which is what makes the correspondence
assertable. It refuses to run when `OPENAI_API_KEY` is set, and every answer
it gives is marked in the response, in the message, and by a banner in the
workspace.

`test:learning` proves generated study material is built from the model rather
than from the generator's general knowledge. It asserts the questions name the
real structure and its real parent, that every distractor is a REAL structure
from the same model, that exactly one multiple-choice option is correct, and —
the checks that matter most — that an item citing a structure outside the
model and a duplicated flashcard are both rejected before reaching the browser.
The verification stub emits both deliberately, because a stub that only
produced valid content would leave every rejection path unproven.

It also asserts VEO refuses what it cannot support: a FUNCTION question about a
structure whose function the model does not state returns a refusal naming what
is missing, not an invented answer.

`validate:anatomy` checks a manifest before it is ever served, and with
`--asset` cross-checks mesh names and the version stamp against the geometry
itself. A manifest that is internally perfect but describes a different
revision of the asset is refused.

The browser suites need the diagnostic scene enabled:

```bash
echo 'NEXT_PUBLIC_ENABLE_PIPELINE_DIAGNOSTIC=true' >> .env.local
npm run build && npm start &
npm run test:browser
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
      search.ts             weighted spatial search index
      annotations.ts        labels and pins anchored to semantic objects
      manipulation.ts       visual state model, peel, explosion, reconstruction
      manipulation-history.ts  bounded undo/redo over semantic intents
      capabilities.ts       what the loaded model can be asked to do
      layers.ts             layer defaults, peel sequence, membership index
    3d/                 renderer, camera rig, materials, transforms, disposal
      renderer/         colour management, tone mapping, DPR policy
      scene/            scene root, GLTF loader
      interaction/      pointer and raycast rules
      diagnostics/      labelled VEO SPATIAL ENGINE TEST scene
  anatomy/
    taxonomy.ts         systems, regions, relationship vocabulary
    providers/          AnatomyProvider, GLTF and hosted implementations
    mapping/            manifest schema, validation, graph projection, hierarchy
    fixtures/           provider conformance fixture (test content, not anatomy)
    models/             declared model catalogue
  ai/                   the contextual tutor
    context/            SpatialContext builder, server-side model resolution
    tutor/              request/response contracts, prompt, service, conversation
    learning/           objectives, generation contracts, content validation, service
    safety/             prompt-injection defence, grounding validation
    actions/            spatial action dispatch into SceneController
    providers/          LLMClient abstraction, OpenAI adapter, verification stub
    fixtures/           VEO AI TUTOR TEST FIXTURE (test content, not anatomy)
  store/                viewer / learning / auth / ui Zustand stores
  lib/                  semantic ids, Result, errors, Supabase, Stripe
  types/domain/         all core domain entities
  config/               env (client-safe + server-only), anatomy provider secrets
  hooks/                React bindings to the provider layer
  tests/                test setup + design-token guards
scripts/                verify-ui / verify-engine / verify-semantics — live browser verification
supabase/migrations/    schema + Row Level Security
```

## Current implementation status

**Gate 1 — Application Foundation: complete and verified.**
**Gate 2 — Premium Product Shell + Learning Workspace: complete and verified.**
**Gate 5 — Core Spatial / 3D Engine: complete and verified.**
**Gate 6 — Spatial Intelligence + Object Interaction: complete and verified.**
**Gate 7 — Spatial Manipulation + Reconstruction: complete and verified.**
**Gate 8 — Anatomy Provider Integration: pipeline complete and verified.**
**Gate 9 — Real Anatomy Rendering: RED, blocked by an external dependency.**
**Gate 10 — Contextual AI Tutor: complete and verified.**
**Gate 11 — AI Questions, Flashcards & Learning Content: complete and verified.**

> **No anatomical geometry has been rendered by this build.** No licensed
> anatomy source exists in this environment. Everything upstream of the content
> is built and verified; the content itself cannot be written, and VEO renders
> nothing rather than a placeholder.
>
> Gate 10 did not change this. The tutor is proved against clearly labelled
> test content, because that is the only honest way to prove it while the
> anatomy dependency is outstanding. It has never explained a real anatomical
> structure, and the product does not suggest otherwise.

Working today:

- A production anatomy ingestion pipeline: the VEO Anatomy Manifest, a
  validator with fifteen error classes, hierarchy normalisation into Body →
  System → Region → Structure, capability discovery, model versioning, two
  provider implementations behind one conformance suite, and a server-side
  security boundary that keeps licence credentials out of the browser.
  **No licensed anatomy exists in this environment, so no anatomical geometry
  has been rendered.**
- Asset-to-manifest reconciliation at load time, binary glTF transport verified
  against a real GLB, progressive per-system and per-region loading, domain
  containment, structure labels that follow their structures, and the load
  instrumentation a real asset will be measured with.

- Spatial manipulation that never destroys the model: layers (show / hide /
  ghost / restore), isolation, object hide and ghost, a peel driven by the
  model's own layer sequence, reversible dissection, an exploded view that
  restores authored transforms exactly, step-by-step reconstruction, bounded
  undo and redo, and an idempotent reset. The interface offers only what the
  loaded model can actually support.

- A semantic object layer: structures, not meshes, drive selection, the context
  panel, hierarchy and breadcrumb, related structures, search, camera targeting
  and labels. A structure the model declares but does not render is still
  navigable, searchable and framable; a render node held across a model
  replacement resolves to nothing.
- A production spatial engine: registry-backed semantic selection, model
  lifecycle with generation guarding, leak-free disposal, model-derived zoom
  limits, fit-to-model and fit-to-selection from real scene bounds, and
  material state that never corrupts an asset's authored appearance.
- Orbit, pan, zoom, reset and animated fly-to, verified in a real browser at
  desktop and four mobile widths.
- Full design system, application shell, landing, authentication, onboarding,
  Home, Learn, Recall, Library and Settings.
- The learning workspace with model switcher, spatial toolbar, dominant
  viewport, layers panel, spatial search, hierarchy breadcrumb, context panel
  with relationship UI, keyboard shortcuts, and a one-row AI study bar.
- Domain model for all 18 core entities, domain-agnostic throughout, with VEO
  semantic identity (`veo.anatomy.heart.left_ventricle`).
- `SpatialProvider` / `AnatomyProvider` abstractions and a functional licensed
  GLB/GLTF provider that validates a manifest and maps vendor mesh names onto
  permanent VEO identity.
- Supabase auth with session refresh and protected routes; Postgres schema and
  Row Level Security for all core tables.
- 500 automated tests plus 444 live browser checks.

Deliberately **not** present:

- **No synthetic anatomy.** VEO does not generate stand-in geometry. Anatomy
  requires licensed assets; until one is configured the product says so.
- **No fabricated data.** No invented statistics, testimonials, logos or
  progress. Where data does not exist, the empty state says so.
- **No recall algorithm or spaced repetition yet.**
- **No tutor responses yet** — the abstraction and context builder exist; the
  server route comes later.
- **No sectioning or cut planes yet** — the provider capability is declared in
  the contract; nothing sits behind it.

Next: **a licensed anatomy source** — see [VEO_BUILD_STATUS.md](./VEO_BUILD_STATUS.md).

## Note on this repository

`index.html` at the repository root is a pre-existing static page from the
previous use of this repository. It is untouched and unrelated to the VEO
application, which lives entirely under `src/`.
