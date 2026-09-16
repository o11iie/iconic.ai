# VEO — Architecture

This document records the decisions that shape VEO, and **why** each was made.
It is meant to be read before changing anything structural.

---

## 1. The one rule everything else follows

> **VEO's promise is that what you see is true.**

A learner cannot tell the difference between a real anatomical model and a
convincing fake. Neither can they tell a real retention statistic from an
invented one. So the architecture is built so that fabrication is *structurally
difficult*, not merely discouraged:

- Spatial content comes from a provider that either has a licensed asset or
  reports that it does not. There is no fallback geometry path.
- The only non-licensed 3D object in the codebase is an abstract wireframe
  calibration target, isolated in `engine/3d/diagnostics/`, gated behind an
  environment flag, and labelled on screen as a diagnostic.
- Surfaces that would need data show empty or "not configured" states naming
  the exact missing variable, instead of placeholder numbers.

---

## 2. Domain-agnostic core, domain-specific edges

VEO is not an anatomy application that might later be generalised. It is a
spatial-learning platform whose first domain is anatomy.

```
        ┌──────────────────────────────────────────┐
        │  src/engine  — knows nothing about any    │
        │  subject. Geometry, cameras, visual state │
        └───────────────────▲──────────────────────┘
                            │ depends on
        ┌───────────────────┴──────────────────────┐
        │  src/anatomy — systems, regions, clinical │
        │  metadata, licensed asset providers       │
        └──────────────────────────────────────────┘
```

**Dependencies point one way only.** `src/anatomy` imports from `src/engine`;
the reverse is forbidden.

This is **enforced by ESLint**, not just documented — `eslint.config.mjs`
applies `no-restricted-imports` to `src/engine/**`. An engine file importing
from `@/anatomy` fails `npm run lint` with an explanatory message. Adding
chemistry means adding `src/chemistry/` beside `src/anatomy/`, not editing the
engine.

Two further enforced boundaries:

| Boundary | Rule |
| --- | --- |
| `src/types`, `src/config` | may not import UI or three.js — domain description stays free of rendering |
| `src/components`, `src/store`, `src/hooks` | may not import `env.server`, `supabase/admin`, `openai`, `stripe` — secrets cannot reach client code |

---

## 3. Semantic identity — the most important decision in the codebase

A vendor GLB contains meshes named `Heart_LV_001` or `mesh_0442`. Those names
are **export artefacts**: they change between asset revisions and differ between
vendors. VEO never treats them as identity.

Instead every addressable thing carries a permanent VEO semantic id:

```
veo.anatomy.heart.left_ventricle
veo.chemistry.benzene.carbon_1
veo.engineering.turbofan.fan_blade
```

Implemented in `src/lib/semantic-id.ts` as a **branded type** — a string only
becomes a `SemanticId` by passing validation, so any function accepting one can
trust its shape. Hierarchy is encoded in the id, so ancestry is computable
without a database query.

**Why this matters commercially.** Questions, flashcards, notes and per-learner
memory state all reference semantic ids. When VEO changes anatomy asset vendors
— or replaces them with VEO-owned models — only the mapping manifest is
rewritten. Not one thing a learner has studied is invalidated. Without this,
an asset migration would destroy the entire learning history, which is the
product's only real moat.

### The mapping manifest

`src/anatomy/mapping/manifest.ts` defines the contract that bridges the two:

```jsonc
{
  "formatVersion": 1,
  "assetPath": "heart.glb",
  "objects": [
    {
      "semanticId": "veo.anatomy.heart.left_ventricle",
      "meshes": ["Heart_LV_001", "Heart_LV_002"],   // several meshes, one structure
      "system": "cardiovascular"
    }
  ]
}
```

It is **data, not code**, so publishing a new model needs no deployment. It is
validated with Zod plus integrity rules a schema cannot express (parents must
exist, ids must be unique, relationships must resolve). An invalid manifest is
refused rather than rendered as a subtly broken model.

---

## 4. Provider abstraction

`SpatialProvider` (`src/engine/spatial/provider.ts`) is the seam between VEO and
whatever supplies 3D content. Three families must fit behind one interface:

1. licensed third-party SDKs (vendor owns the renderer *and* the hierarchy)
2. licensed GLB/GLTF assets rendered by VEO's own engine
3. future VEO-owned models

Because (1) may own its own canvas, **every visual operation is an intent**
(`ghost these ids`, `fly to this id`) rather than a direct scene-graph
mutation. An SDK provider forwards intents to its SDK; VEO's own renderer
resolves them through the visual-state reducer. Camera intents are *queued*
with a version counter, because the provider does not own the camera — the
React Three Fiber rig does.

`BaseSceneGraphProvider` implements every non-transport concern once —
hierarchy, relationships, search, visual state, isolation, camera intents,
change notification. A new provider only implements **loading**, which is the
part that genuinely differs.

Providers register by id (`src/engine/spatial/registry.ts`) and are selected by
configuration, so VEO is never wired to one commercial vendor.

---

## 5. Visual state as a pure function

`src/engine/spatial/visual-state.ts` resolves presentation from
(selection, hover, highlight, hidden, ghosted, isolation, layers) as a **pure
function**. Precedence is explicit and unit-tested without a WebGL context.

One rule worth calling out: when a structure is isolated, surrounding geometry
is **ghosted, not deleted**. Losing spatial context defeats the purpose of a
spatial learning tool — you need to see *where* the thing sits. A regression
test covers this after an early bug where the blanket isolation rule overrode
the ghost set.

---

## 6. State: four stores, not one

| Store | Owns |
| --- | --- |
| `viewerStore` | selection, hover, layers, isolation, camera target, interaction mode |
| `learningStore` | subject, course, material, concept, loop stage, session |
| `authStore` | session mirror, profile, entitlements |
| `uiStore` | sidebar, toasts, reduced motion |

Separate because they change at wildly different frequencies. Hovering a
structure fires many times per second; it must not be able to re-render the
navigation. Narrow selector hooks (`useSelectedObject`, `useLoopStage`) are
exported so components subscribe to one field.

`authStore` is documented as **a cache for rendering, never an authority**.
`useEntitlementHint` is named to make misuse obvious at the call site.

---

## 7. Security model

**Three layers, in order of authority:**

1. **Row Level Security** (`supabase/migrations/0002_row_level_security.sql`) —
   the real boundary. Every table has RLS enabled and defaults to deny.
2. **Server verification** — server code uses `getUser()`, which validates the
   JWT with the auth server, never `getSession()`, which trusts a cookie.
3. **Proxy/middleware** — decides which *page* renders. Defence in depth only.

Deliberate choices:

- `subscriptions` has **no client write policy at all**. A browser that could
  write it could grant itself a paid plan. Entitlements change only through
  signature-verified Stripe webhooks running with the service role.
- Uploads live in a private bucket namespaced by user id; storage policies check
  `(storage.foldername(name))[1] = auth.uid()`.
- Sign-in does not distinguish "no such user" from "wrong password" — that
  difference is an account-enumeration oracle.
- `?next=` redirects accept only same-origin relative paths.

**Secret boundary:** `env.server.ts` and `supabase/admin.ts` import
`server-only`, making a client import a *build error*. ESLint blocks the same
paths from client directories. This was verified empirically by planting
sentinel secret values, building, and scanning every client asset — with a
positive control proving the scan could detect a leak.

---

## 8. Performance

Large spatial assets are the defining performance constraint.

- The viewport is behind `next/dynamic` with `ssr: false`
  (`components/spatial/ViewportShell.tsx`), so three.js, R3F and drei are absent
  from the initial bundle. Routes without a viewport pay nothing.
- Assets are **never bundled** — they are fetched at runtime through the
  provider, so they cannot inflate application boot.
- `frameloop="demand"`: a static model does not render at 60fps.
- Device pixel ratio is capped at 2; high-DPI displays otherwise cost 4× fill.
- `useGLTF` caches by URL; the scene is cloned per mount so two viewports cannot
  fight over one graph's materials.
- Cloned materials are disposed on unmount to stop GPU memory growth.

---

## 9. Errors are values

`src/lib/result.ts` provides `Result<T, E>`; `src/lib/errors.ts` provides a
closed `ErrorCode` taxonomy with a user-safe message per code.

Expected failures — an unlicensed model, a malformed id, an unconfigured
provider — are **returned**, not thrown. A caller cannot read `.value` without
narrowing on `.ok`, so a failure cannot be ignored by accident. Throwing is
reserved for genuine programmer error.

This is why `LoadingState`, `EmptyState`, `ErrorState` and `NotConfiguredState`
are first-class components. `NotConfiguredState` is deliberately distinct from
`ErrorState`: nothing is broken, a key is simply absent, and it names the exact
variable required.

---

## 10. Accessibility

Treated as correctness, not polish:

- Real landmarks and a skip link in `AppShell`.
- `Input` **requires** a label (a placeholder is not a label); `hideLabel` still
  emits a real `<label>`.
- `ButtonLink` exists so navigation is an `<a>`, not a `<button>` — middle-click
  and "open in new tab" work, and assistive tech lists links separately.
- `aria-current="page"` on active nav; colour alone never conveys state.
- Focus is restyled, never removed.
- `prefers-reduced-motion` is honoured in CSS *and* threaded into the camera rig,
  which snaps instead of animating.

---

## Appendix: version pinning rationale

Two pins are not "latest", for concrete compatibility reasons found by checking
peer ranges before installing:

| Package | Pinned | Latest | Why |
| --- | --- | --- | --- |
| `react` / `react-dom` | 19.2.8 | 19.3.0 | `@react-three/fiber@9.7` declares `react: >=19 <19.3`. React 19.3 is outside its supported range. |
| `typescript` | 5.9.3 | 7.0.2 | `typescript-eslint@8.70` declares `typescript: >=4.8.4 <6.1.0`. TS 7 would break linting. |
| `eslint` | 9.39.5 | 10.10.0 | ESLint 10 was tried and **fails**: the `eslint-plugin-react` bundled inside `eslint-config-next@16.3.5` uses the removed context API (`contextOrFilename.getFilename is not a function`). Revisit when `eslint-config-next` supports ESLint 10. |

Revisit these when the upstream constraints lift.
