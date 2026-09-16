# VEO — Build Status

_Last updated: 2026-09-16_

---

## Current phase

**Phase 1 — Platform Foundation**

## Current gate

**Gate 1 — Application Foundation → GREEN (verified)**

Gate 1 acceptance criteria, all verified by execution rather than inspection:

| # | Criterion | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Project builds for production | GREEN | `next build` — 13 routes compiled |
| 2 | Type checking passes, strict | GREEN | `tsc --noEmit` — 0 errors |
| 3 | Linting passes | GREEN | `eslint .` — 0 errors, 0 warnings |
| 4 | Automated tests pass | GREEN | `vitest run` — 93/93 across 8 files |
| 5 | Application actually runs | GREEN | `next start` served all routes |
| 6 | Every required route responds | GREEN | 12× HTTP 200, 404 route → 404 |
| 7 | Secrets cannot reach the client | GREEN | sentinel scan, with positive control |
| 8 | Architecture boundaries enforced | GREEN | ESLint probe rejected a violating import |
| 9 | No synthetic anatomy anywhere | GREEN | provider returns `provider_not_configured` |
| 10 | No fabricated statistics | GREEN | dashboard scan found no invented metrics |

---

## Completed

### Foundation
- Next.js 16 App Router + React 19.2 + TypeScript 5.9 in `strict` mode, with
  `noUncheckedIndexedAccess` and `verbatimModuleSyntax`.
- Tailwind CSS v4 design system: obsidian palette (`#090D16` / `#111827` /
  `#3B82F6` / electric cyan), Inter via `next/font`, restrained glassmorphism.
- Dependency versions resolved against real peer ranges before installing;
  three deliberate non-latest pins documented in `ARCHITECTURE.md`.

### Domain model
- All 18 required entities: `User`, `Profile`, `Subject`, `Course`,
  `LearningMaterial`, `SpatialModel`, `SpatialObject`, `SpatialRegion`,
  `SpatialLayer`, `Relationship`, `Question`, `Flashcard`, `RecallAttempt`,
  `MemoryState`, `Note`, `LearningSession`, `Subscription`, `Entitlement`.
- `SpatialModel` / `SpatialObject` contain **no** anatomy-specific fields.
- Knowledge domains are an open registry, so a new domain is a data change.

### Semantic identity
- `veo.<domain>.<path...>` branded-type system with parser, builder, hierarchy
  operations, descendant detection and vendor-name normalisation.

### Spatial engine (domain-agnostic)
- `SpatialProvider` contract covering the full required surface: initialize,
  loadModel, loadRegion, loadLayer, getObject, getHierarchy, getObjectMetadata,
  getRelated, select, highlight, hide, show, ghost, isolate, restore, flyTo,
  getBoundingBox, getPosition, resetCamera, fitToSelection.
- `BaseSceneGraphProvider`: shared hierarchy, relationships, search, visual
  state, isolation, camera intents, `useSyncExternalStore` integration.
- Pure visual-state reducer with documented precedence.
- React Three Fiber renderer: orbit/pan/zoom, eased fly-to, fit-to-selection,
  reset, hover/click selection, material state with original-material
  restoration, WebGL2 detection, disposal on unmount.
- Pure camera framing maths, unit-tested without WebGL.

### Anatomy layer
- `AnatomyProvider` with the anatomy vocabulary (systems, regions, structures,
  `getStructure*`, `getRelatedStructures`, `focusStructure`).
- **Functional** `GltfAnatomyProvider`: fetches and validates a manifest, builds
  the semantic graph, maps vendor meshes to VEO ids, resolves the asset URL.
- Semantic mapping manifest schema with integrity validation.
- Provider registry selected by configuration.

### Application
- 10 routes: `/`, `/login`, `/signup`, `/onboarding`, `/dashboard`, `/learn`,
  `/explore`, `/recall`, `/library`, `/settings`, plus `/api/health` and
  `/auth/callback`.
- Supabase email/password auth via server actions; session refresh and route
  protection in `src/proxy.ts`.
- Four separate Zustand stores with narrow selector hooks.
- Postgres schema + Row Level Security for all 14 core tables, plus private
  per-user storage policies.
- Error handling foundation: route/global error boundaries, 404, and
  loading / empty / error / not-configured state components.

---

## In progress

Nothing. Gate 1 is closed.

---

## Blocked

**One external dependency, reported rather than worked around:**

- **Licensed anatomy assets are not available in this environment.**
  The provider, manifest contract, renderer, mapping and full interaction model
  are implemented and tested, but no licensed GLB/GLTF asset set is configured,
  so no anatomical geometry can be displayed.

  This is a **content/licensing blocker, not an engineering one**. Per the
  operating rules, VEO does **not** substitute procedurally generated anatomy.
  Every anatomy surface reports the missing configuration explicitly.

  *To unblock:* publish a licensed asset set plus its `manifest.json` and set
  `NEXT_PUBLIC_SPATIAL_ASSET_BASE_URL`. No code change is required.

  *Verified without assets:* `GltfAnatomyProvider` is tested end-to-end against
  a stubbed manifest — graph construction, mesh mapping, metadata, relationships,
  search, selection, isolation, camera intents, subscriptions, HTTP failure and
  invalid-manifest rejection (14 tests).

**Not blockers, simply unconfigured** (each reports itself in the UI): Supabase,
OpenAI, Stripe.

---

## Tests run

| Command | Result |
| --- | --- |
| `npm run typecheck` | **PASS** — 0 errors |
| `npm run lint` | **PASS** — 0 errors, 0 warnings |
| `npm run test` | **PASS** — 93 passed / 93 total, 8 files |
| `npm run build` | **PASS** — 13 routes, compiled in ~3s |
| `next start` + route probe | **PASS** — see table below |
| Secret-boundary scan | **PASS** — 0 leaks, positive control confirmed |
| Boundary-enforcement probe | **PASS** — violating import rejected |

### Test coverage by area

| File | Tests | Covers |
| --- | ---: | --- |
| `lib/semantic-id.test.ts` | 17 | parsing, validation, hierarchy, normalisation |
| `engine/spatial/visual-state.test.ts` | 14 | precedence, isolation, ghosting, layers |
| `engine/3d/camera/camera-math.test.ts` | 12 | framing, FOV, aspect, easing |
| `anatomy/providers/gltf-anatomy-provider.test.ts` | 14 | full provider lifecycle |
| `anatomy/mapping/manifest.test.ts` | 9 | schema + integrity rules |
| `store/stores.test.ts` | 12 | all four stores |
| `lib/stripe/entitlements.test.ts` | 6 | tier mapping, lapse revocation |
| `components/ui/components.test.tsx` | 9 | rendering + accessibility contracts |

### Route verification (production server)

| Route | Expected | Actual |
| --- | --- | --- |
| `/` `/login` `/signup` `/onboarding` | 200 | 200 |
| `/dashboard` `/learn` `/explore` `/recall` | 200 | 200 |
| `/library` `/settings` `/api/health` | 200 | 200 |
| `/explore?diagnostic=1` | 200 | 200 |
| `/does-not-exist` | 404 | 404 |

### Secret-boundary result

Sentinel values were planted for `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`,
`STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`, the app rebuilt, and all 29
client assets scanned.

- Server secrets found in client bundles: **0**
- Server secret *names* found in client bundles: **0**
- Server secrets found in rendered HTML across 5 routes: **0**
- Positive control (`NEXT_PUBLIC_` value) found: **yes** — confirms the scan
  was capable of detecting a leak rather than trivially passing.

### Bugs found and fixed during verification

1. **Isolation overrode ghosting.** The blanket isolation rule hid everything
   outside the isolated subtree before the explicit ghost set was consulted, so
   isolating a structure erased the surrounding context that orients a learner.
   Fixed in the reducer; regression test added.
2. **`'use server'` module exported a constant**, breaking the production build.
   Shared form state moved to `src/app/(auth)/form-state.ts`.
3. **ESLint 10 incompatible** with `eslint-config-next@16.3.5`. Detected by
   running it; pinned to ESLint 9.39.5 and documented.
4. **`setState` called synchronously inside an effect** in `use-anatomy-model`.
   Reworked so `idle` is derived rather than set.
5. **Invalid HTML** — a `Link` nested in a `button`. Replaced with `ButtonLink`.
6. Deprecated `middleware` convention migrated to Next 16's `proxy`.

---

## Next action

**Gate 2 — Live Data & The Spatial Learning Surface.** Gate 1 is GREEN, so this
gate is now open. Proposed scope, in order:

1. **Connect a Supabase project.** Apply both migrations, regenerate
   `src/types/database.ts` from the live schema, verify RLS with a two-user
   test proving one user cannot read another's rows.
2. **Profiles and onboarding persistence.** Wire the onboarding form to
   `profiles.interests` / `profiles.level` through a server action.
3. **Licensed anatomy asset integration.** Publish the first licensed model plus
   its manifest, point `NEXT_PUBLIC_SPATIAL_ASSET_BASE_URL` at it, and verify
   the full interaction loop against real geometry. *This is the highest-value
   item and the one currently blocked on licensing.*
4. **Learning sessions.** Persist `learning_sessions` on entering/leaving a
   viewport, recording concepts studied.
5. **Structure search and layer panel** in the viewport, driven by the provider
   methods that already exist.

**Decision required from you:** item 3 needs a licensing route chosen — license
an anatomy SDK, license a GLB/GLTF asset set, or commission VEO-owned models.
The provider layer supports all three; only the first has a code cost (a new
provider implementation), and the abstraction is already in place for it.
