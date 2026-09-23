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

## 11. The product shell

Two shells, because two fundamentally different layouts are needed:

| Shell | Used by | Behaviour |
| --- | --- | --- |
| `AppShell` | Home, Learn, Recall, Library, Settings | scrolls, pads, page header, optional right aside |
| `WorkspaceShell` | Explore | fills the viewport, never scrolls, never pads |

That split is the whole layout argument. A workspace built inside a scrolling
document turns the model into a figure inside a page; VEO's model has to *be*
the page. `WorkspaceShell` is `h-dvh overflow-hidden`, and the canvas column is
the only region allowed to grow. This is verified at runtime rather than
asserted: `scripts/verify-ui.mjs` measures, at 360/768/1440, that the workspace
fills the screen and the page does not scroll.

Both shells are Server Components that resolve the session once per request.
Navigation is one rail on desktop and one bottom bar on mobile, each rendering
each destination exactly once — an earlier version rendered both and hid one
with CSS, which put every link in the accessibility tree twice.

Settings deliberately lives in the account menu, not the rail. The primary
navigation is about learning; administration does not belong beside it.

---

## 12. Honesty as a design constraint

Gate 2's hardest rule is that the interface must never imply content exists
before it does. This is enforced structurally, not by good intentions:

- **`NotConfiguredState` is a first-class component**, distinct from
  `ErrorState`. Nothing is broken when a key is missing, so it does not look
  like a failure — and it names the exact environment variable required.
- **The content catalogue carries status.** `src/data/subjects.ts` gives every
  category a `contentStatus`, and `src/data/content.test.ts` fails the build if
  a category claims to be `available` without a model behind it, or if any
  anatomy category advertises availability while the catalogue still requires a
  licensed asset.
- **Dashboards show no statistics.** Every number would be invented until real
  recall attempts exist. `scripts/verify-ui.mjs` scans the rendered dashboard
  for percentage and streak patterns and fails if any appear.
- **The AI bar states its real context.** It says "No structure selected" when
  nothing is selected rather than implying a focus it does not have.

---

## 13. Motion

Motion is short, eased and purposeful: it explains where something came from.
Nothing bounces, loops or decorates. The shared vocabulary in
`components/ui/motion.ts` animates opacity and small translations only, so a
reduced-motion user losing the transform loses nothing meaningful.

`motionSafe()` strips movement while preserving mount and unmount transitions,
so `AnimatePresence` keeps working. `prefers-reduced-motion` is read once into
the UI store and threaded everywhere, including into the 3D camera rig, which
snaps instead of animating.

Route transitions animate on mount only. Adding an exit transition would delay
unmount, which makes navigation feel slower — the opposite of premium.

---

## 14. Two silent failures worth remembering

Both were invisible to the compiler, the linter and the test suite, and both
were caught only by running the application.

**Tailwind v4 removed the `utility-[--custom-var]` shorthand.** A class like
`bg-[--color-accent]` still compiles and still appears in the output CSS, but
emits `background-color: --color-accent`, which is not a valid colour, so the
browser drops it. The application rendered with almost none of its palette,
inheriting from `body` and the handful of custom `.veo-*` classes — close enough
to look intentional. Because VEO's tokens live in `@theme`, Tailwind generates
real utilities for them, and those are the only correct form:
`bg-accent`, `text-ink-muted`, `border-hairline`.
Guarded by `src/tests/design-tokens.test.ts`.

**TypeScript interfaces have no implicit index signature; type aliases do.**
`Database` was declared with `interface`, so it failed supabase-js's
`Record<string, GenericTable>` constraint — silently, with no error at the
definition site. The only symptom was that every query builder's argument type
collapsed to `never`, making all inserts and updates impossible to write. This
is why Supabase's own generator emits type aliases.
Guarded by `src/types/database.test.ts`.

The lesson that shaped the rest of Gate 2: a gate is not green because the
build passes. It is green because the running application was measured.

---

## 15. The spatial engine

The engine is a core product subsystem, not a visualisation widget. It is the
thing VEO sells, so it is built to the same standard as the domain model.

### Layering

```
SpatialModel (domain data)
      │
      ▼
SceneController ──── owns selection, visibility, camera intents, lifecycle
      │                 · single source of truth
      ▼                 · React binds via useSyncExternalStore
SpatialObjectRegistry ── semantic id ⇄ scene node
      │
      ▼
SpatialSceneRoot ─── registration, raycasting, materials, disposal
      │
      ▼
Renderer (R3F / three.js)
```

Dependencies point one way. The renderer never learns that an object is a
heart, a femur, a turbine or a molecule — it deals in `Object3D` and semantic
ids, and everything above it deals in domain types.

### One owner for scene state

`SceneController` owns selection, hover, highlight, visibility, isolation,
layer visibility, camera intents and model lifecycle. There is exactly one
implementation of these rules.

`BaseSceneGraphProvider` *delegates* to a controller rather than keeping a
parallel copy, and the renderer binds to the same controller. The provider API
and the viewport are therefore two views of one truth, not two copies that have
to be kept in sync. The viewer store keeps only session concerns — which model
is open, which tool is active — and receives the selected id through a single
one-way sync so non-3D surfaces can read it.

### Object registry and semantic resolution

A raycast hits a mesh; a learner selects a *structure*. `SpatialObjectRegistry`
is the only place that knows the mapping.

`resolveSelectable` walks from the hit node **upward** and returns the FIRST
tagged ancestor. That ordering is the whole rule: when a selectable child sits
inside a tagged group, the child wins. Returning the outermost match instead
would mean every click selected the entire model — the classic failure mode of
naive scene picking.

The registry also refuses to resolve identities it does not hold, so a stale
tag left on a node from a previous model cannot resolve to something that no
longer exists. §16 covers how that guarantee is enforced, and the distinction
between a structure existing and a structure being rendered.

It is written against a minimal structural `SceneNode` rather than
`THREE.Object3D`, so every resolution rule is unit-tested without a WebGL
context.

### Model lifecycle

```
idle ──load──▶ loading ──loaded──▶ loaded ──unload──▶ idle
                 │                    │
                 └──fail──▶ failed ◀──┘
                              │
                       dispose│ (from any phase)
                              ▼
                           disposed
```

A pure reducer, so the hardest case — a learner switching models mid-download —
is reasoned about and tested without a network.

`generation` is the load-bearing field. It increments on every load, unload and
dispose, and an async result carrying a stale generation is discarded. Without
it, switching from a slow model to a fast one lets the slow response land last
and replace the model the learner actually asked for.

### Materials: one override per mesh, never per change

The naive approach is to clone a material whenever visual state changes. That
is what makes viewers degrade over a session: every hover allocates a material,
nothing disposes them until unmount, and a minute of pointer movement leaves
hundreds of orphaned GPU resources behind.

`MaterialStateManager` creates **at most one** override material per mesh,
lazily, and mutates that single instance on subsequent changes. Restoring is a
reference swap back to the authored material, which is never mutated. Repeated
selection changes therefore cannot accumulate corruption, and disposal is
bounded and complete. A test drives 200 state changes and asserts the override
count stays at one.

Authored materials are disposed by the scene's own pass, not by the manager —
disposing them there would break a material shared with another mesh.

### Disposal

three.js does not garbage-collect GPU resources. `disposeObject3D` walks every
material slot and every texture-bearing uniform, disposes each shared material
exactly once, detaches the root and empties it. `countResources` makes "no leak
on model replacement" a measurable claim: the browser verification replaces the
scene four times and asserts the renderer's own `gl.info.memory.geometries`
does not grow.

### Camera

Zoom limits are derived from the model's own extent rather than hard-coded, so
one rig serves a molecule and a cathedral. Framing resolves through
`bounds.ts`, which measures the **selectable content** rather than the whole
root — a scene routinely contains grids, axes, lights and helper nodes, and
framing the root sizes the view to the largest helper while leaving the model
small in the middle of it.

Transitions run entirely inside `useFrame` and mutate the camera directly.
Driving a camera tween through React state would re-render the tree every
frame, which is the most common performance mistake in R3F applications.

`reset` returns to the considered opening view — a three-quarter framing from
slightly above — rather than merely re-fitting from wherever the learner
happens to be orbiting.

### Interaction

Selection happens on pointer-**up**, and only when the pointer moved less than
6px since pointer-down. Selecting on click alone means every camera orbit that
ends over a structure changes the selection, which is the single most
irritating bug in 3D viewers. Orbit mode suppresses hover and selection
entirely.

### Rendering policy

Deliberately absent: bloom, depth of field, colour grading, vignettes and
screen-space effects. VEO renders scientific content, so a learner must be able
to trust that what they see is the model's colour and shape rather than a
post-process interpretation of it.

`NeutralToneMapping` at exposure 1 compresses highlights without shifting hue;
ACES Filmic, the usual default, warms mid-tones in a way that changes perceived
material colour. Device pixel ratio is capped at 2 — the highest-value
performance decision in the renderer, since a 3x display renders 9x the
fragments — and harder on low-core devices, where exceeding the GPU budget
causes a context loss rather than a slowdown. The frame loop is on demand:
a static model has no reason to redraw at 60fps.

### The diagnostic scene

`VEO SPATIAL ENGINE TEST` is a calibration rig: four abstract primitives named
Node A–D under the reserved `veo.diagnostic` namespace, plus a grid and axes.

`diagnostic` is deliberately **not** a knowledge domain, so nothing in the
learning catalogue can reference these ids, and a test asserts this. It is
labelled on screen wherever it is mounted, gated behind
`NEXT_PUBLIC_ENABLE_PIPELINE_DIAGNOSTIC`, and never appears on the normal
workspace — also asserted in the browser run.

It is built imperatively and handed to `SpatialSceneRoot` exactly as a loaded
GLTF scene is, so it takes the same registration, interaction, material and
disposal path. Verifying the engine against a scene that bypassed the
production path would prove nothing.

VEO does not substitute generated geometry for licensed subject models. A model
made of primitives would look complete while teaching nothing true. This scene
exists so engineers can verify the engine, and it says so.

### Known limitations

- **No licensed subject asset has been rendered.** The GLTF path is implemented
  and unit-tested against a stubbed manifest, but has not been exercised
  against a real licensed asset, because none exists yet. Draco and KTX2
  decoders are declared in the manifest schema but not yet wired.
- **Sectioning and cut planes are not implemented.** The provider capability
  exists in the contract; no engine or interface support sits behind it yet.
- **The canvas is `aria-hidden`.** Arbitrary 3D geometry cannot be navigated by
  a screen reader, and claiming otherwise would be a false promise. The
  surrounding interface carries the information: camera controls are real
  focusable buttons, and selection is announced through a live region.
- **No anatomical geometry has ever been rendered by this build.** Every
  spatial capability above is verified against the diagnostic model. What a
  licensed asset does — how it frames, how it performs, how its structures are
  named and nested — is unverified because none exists here.
- **Pins are a foundation, not a feature.** Labels are drawn; pins have a data
  model, anchoring and pruning, and nothing renders them yet.
- **Instancing and LOD are not implemented.** Neither is needed at current
  scene complexity, and both would be premature before a real asset sets the
  performance budget.

---

## 16. The semantic layer

Gate 5 made the engine draw and frame. This layer makes it *mean* something.

### The one rule

**A rendered mesh is not the source of truth. The `SpatialObject` is.**

A mesh belongs to one model from one vendor. Replace the asset and every mesh
is different. What must survive is the structure: what it is called, what
contains it, what it connects to, what a learner wrote about it last month.
That lives in the semantic object, addressed by a `SemanticId`, and every layer
above the renderer speaks only that language.

Concretely, nothing outside `engine/3d` ever sees a `THREE.Object3D`. The
context panel, the breadcrumb, search, labels, pins, the camera API and the URL
all deal in semantic ids.

### Geometry and meaning have different lifetimes

This is the distinction the layer is built around, and getting it wrong caused
both real defects found during Gate 6.

| Question | Answered by |
| --- | --- |
| Does the current model contain this structure? | `registry.has(id)` / `isValid(id)` |
| Is it currently backed by a render node? | `registry.hasGeometry(id)` |
| What is it? | `registry.resolveFromSemanticId(id)` |
| What render node did this raycast hit? | `registry.resolve(node)` |

A model routinely declares structures that draw as bare grouping nodes with no
mesh of their own — a system, a region, an assembly. They are first-class: they
appear in the hierarchy, they are searchable, selectable and framable. Treating
geometry as the test for existence silently deletes them from the model, which
is the same mistake as letting the mesh be the source of truth.

Symmetrically, geometry can be unloaded without the structure ceasing to exist.
`unregister` drops the binding; the descriptor stays.

### One entry point for a model

`SceneController.setGraph(graph)` is the only way a model enters the system.
It publishes descriptors to the registry, builds the search index, seeds labels
and declares the object universe — once, in one place, from one shape. Both
content paths go through it: a manifest-loaded GLTF asset and the diagnostic
scene. Verifying the engine against a scene that bypassed the production path
would prove nothing.

`SceneController.beginRegistration()` is the matching seam on the geometry
side. It drops the previous generation's render nodes and re-attaches the
current model's descriptors.

That second step is not incidental. Registration happens inside the canvas,
which React reconciles as a **separate tree that commits on its own schedule**,
while the model is published from the page tree. Neither can assume it runs
first. Clearing render nodes used to discard the model's descriptors as a side
effect, so whenever registration committed last, the model lost its hierarchy,
its groups and its search entries — while still rendering and selecting
perfectly. Routing both through the controller makes the result identical in
either order, which is the property the regression tests pin.

### Generation safety

Every registration is stamped with the registry's generation, which increments
on `clear()`. A node held from a previous model still carries its tag, but
resolving it returns `null` because the stamp no longer matches.

This makes *"a stale object reference can never resolve as a valid current
object"* a property of the design rather than a hope. The browser suite proves
it the only way that counts: it captures a real render node from the live
model, replaces the model, and requires that same node to resolve to nothing.

### Resolution pipeline

```
pointer event
  → R3F raycast              (nearest hit mesh)
  → resolveSelectable(node)  (first tagged ancestor, walking UP)
  → registry.resolve(id)     (generation check)
  → controller.setHovered / select
  → subscribers re-render
```

`resolveSelectable` walking upward and stopping at the **first** tag is the
whole selection rule: when a selectable child sits inside a tagged group, the
child wins. Returning the outermost match would mean every click selected the
entire model.

### Restrained hover

Hover runs on every pointer move, so it must cost almost nothing. `setHovered`
returns early when the id is unchanged: no state published, no subscriber
notified, no frame requested. Moving the pointer across one structure produces
exactly one state change, on entry. The browser suite asserts this directly by
reading the controller's revision counter across eight moves.

### Selection integrity

- At most one selection and one hover at any moment.
- Selecting an id the current model does not contain **fails** and changes
  nothing — the guard every externally supplied id passes through.
- Hiding the selected structure invalidates the selection rather than leaving
  the interface describing something invisible.
- A model reload keeps the selection when the identity still exists, and drops
  it when it does not. Losing a learner's place on every reload would be
  hostile; keeping a dangling reference would be a bug.

### Untrusted identifiers

A semantic id arriving from outside the application — a URL parameter, a saved
note, a shared link — is **data, not authority**. `?select=` is parsed for
shape, then validated against the loaded model. A well-formed id from a
different model is refused; a malformed one is ignored without error. Nothing
about an object reference can mutate unrelated model state: the only mutations
it can reach are this controller's own selection and camera intents.

### Bounds without three.js

`engine/spatial` must not import three.js, or the semantic layer becomes
untestable without a WebGL context. So the 3D layer **injects** a
`BoundsResolver`, registered per rendered root, and the controller exposes
`getObjectBounds` / `getObjectCenter` / `getObjectWorldPosition` /
`getObjectRadius` in plain world units.

Resolution order: live geometry, then bounds declared by the model, then the
union of the structure's descendants. That last step is what lets the camera
frame a grouping structure that owns no geometry itself.

Camera framing reads bounds through this API rather than the registry, so there
is one answer to "what is this object's extent" rather than two that drift.

### Search

`SpatialSearchIndex` scores name, semantic id, synonyms, system, region and
metadata, weighted in that order, with exact > prefix > word-boundary >
substring. Results are filtered to the current model before they are returned,
so a search result is always something the learner can actually select.

### Labels and pins

Both anchor to a **semantic object**, never to world coordinates: a label that
remembers a position is wrong the moment the model changes. Labels carry a
priority (derived from hierarchy depth) and are drawn against a budget, so a
dense model degrades by dropping the least important rather than by
overlapping. Pins carry an id, a semantic id, an anchor, a title, a description
and a type. Both are pruned to the current model on every `setGraph`.

Gate 6 builds the foundation; neither is rendered in the viewport yet.

### What this layer is not

It does not know what a heart is. `veo.anatomy.heart.left_ventricle` and
`veo.engineering.turbine.stage_two_rotor` are the same kind of thing to it. The
diagnostic model — `veo.diagnostic.test_scene.system_a.object_1` — exercises
every path in it, which is only possible because none of it is domain-specific.

---

## 17. Spatial manipulation

Gate 6 made the engine mean something. This layer lets a learner take it apart.

### The one rule

**A manipulation changes how a model is presented, never what it is.**

Nothing is unregistered, no geometry is disposed, no authored material or
transform is overwritten, and every semantic object stays queryable throughout.
A dissected structure still has a name, a parent, its relationships and its
metadata; it simply is not being drawn at this moment. That is what makes every
operation reversible without remembering what it destroyed — there is nothing
to remember, because nothing was destroyed.

### One state, eight axes

```ts
interface ManipulationState {
  hiddenIds, ghostedIds        // explicit, per object
  dissectedIds                 // ordered: last in, first out
  isolatedId                   // one subtree, or null
  hiddenLayerIds, ghostedLayerIds
  peelLevel                    // how far through the model's own sequence
  exploded
}
```

Eight fields, each an independent axis of meaning rather than a pile of
booleans, and one value per object resolved from all of them together.

The important design decision is what is NOT here. Isolation does not write
itself into `hiddenIds`. Peel does not write itself into `ghostedIds`. Layer
state does not touch either. Each stays as what the learner asked for, and the
rendered result is computed. That is what lets `restoreIsolation()` leave a
structure the learner hid by hand still hidden — and it is what the first
implementation got wrong.

### Precedence

Twelve rules, one fixed order, first match wins:

```
 1. dissected          (subtree)      7. hovered
 2. hidden             (subtree)      8. highlighted
 3. peeled             (subtree)      9. isolated
 4. layer hidden                     10. layer ghosted
 5. outside isolation                11. ghosted
 6. selected                         12. default
```

Two principles decide that order, and every future addition has to fit them:

**Removal beats emphasis.** Highlighting something the learner cannot see
communicates nothing, and a selected-but-invisible object is the kind of
contradiction that makes a viewport impossible to reason about. Selection and
hover invalidate against `NON_RENDERING_STATES` rather than a list of names, so
a state added later is covered by construction.

**Explicit intent beats incidental consequence.** A structure hidden by hand
stays hidden when its layer is switched back on. Otherwise turning a layer on
would silently undo a decision made deliberately.

Rules 1–3 apply to a structure and everything beneath it: removing an assembly
that still showed its own parts would be incoherent.

### Layers

A layer is a meaningful grouping of objects — a system, a shell, a subassembly,
a stratum. The model's manifest decides what exists and what it is called;
nothing in the engine knows.

Membership is indexed once per model, so a layer operation is a set lookup
rather than a walk over every object. On a model with tens of thousands of
parts that is the difference between a toggle and a stall.

A layer has three states, not two: hiding removes it, ghosting keeps it faintly
present so the learner can still see where what they are studying sits. Those
are different questions and a checkbox can only answer one.

An object in two layers stays visible while either is on. A layer is a way of
looking at a model, not an owner of geometry.

### Peel

Peeling removes outer layers progressively to reveal what they cover. It is
emphatically not arbitrary translation of meshes: it works from the model's own
layer sequence, and each layer declares whether peeling ghosts it or removes
it outright.

The number of steps comes from the model. A layer marked unpeelable is what
stops a peel ending in an empty viewport — the diagnostic model's core layer
exists for exactly that reason.

### Dissection

An ordered stack, undone last-first. `dissectObject` pushes, `restoreDissection`
pops one, `resetDissection` clears. The registry, hierarchy, relationships and
metadata are untouched throughout: a dissected structure can still be searched
for, navigated to and described.

### Exploded view, and transform safety

The same contract the material layer holds, for positions.

An asset's authored transform is the truth about where a part belongs. A
manipulation is a displacement **on top of** it:

```
currentTransform = baseTransform + manipulationTransform
```

`TransformStateManager` captures each node's base position once and assigns it
back on restore. Restoration is therefore exact rather than close: the
coordinates after a restore are the ones the asset shipped, however many times
the view has been exploded and collapsed. Subtracting the offset instead would
accumulate floating-point error, and the browser suite compares coordinates for
equality specifically to catch that.

Offsets are semantic: an object's own declared offset wins, otherwise its
exploded group moves it radially from the group's centre by an amount the
group's scale and spacing fix exactly. A structure with neither gets no offset.
VEO does not invent a separation it has no basis for — a made-up explosion
looks convincing and teaches something false about how the thing comes apart.

They are computed once per explosion and cached. A group-derived offset is a
function of where its members are, so reading it again once they had moved
would compound, pushing them further out on every frame.

### Reconstruction and reset

`reconstructStep` retraces the learner's own path in reverse — dissection,
then hidden, then peel, then isolation, then layers, then ghosts, then the
exploded view — rather than jumping to an arbitrary intermediate state.
`reconstructAll` makes the model whole while leaving the camera and the
selection where they are.

`resetScene` returns everything to the state a model loads in, reframes the
camera and clears the history. It is **idempotent by construction**: it assigns
a constant rather than reversing whatever happened to be in force, so calling
it twice cannot differ from calling it once. That is a property of the
implementation, not a thing to be careful about.

### History

Semantic intents only — never a frame, never a pointer position. Each entry
holds the action and the state it produced, which makes undo exact: there is no
inverse to re-derive and no chance of an operation that almost undoes itself.
The states are small enough that the whole bounded stack costs less than one
frame of geometry.

This is deliberately not a document-editing history: no merges, no
transactions, no persistence.

### Capability discovery

What the interface offers is decided by what the loaded model can support, not
by which buttons exist. Capability is **derived from the graph**: layers need
layers, peeling needs at least two peelable layers, explosion needs declared
offsets.

A model may then switch something off — a licence that forbids dissection, an
asset whose geometry does not come apart cleanly — but it can never switch
something on. A manifest cannot assert its way into a feature it has no data
for, because that is precisely the button that appears and then does nothing.

The toolbar hides what the model cannot do and disables, with a reason, what it
can do but not yet.

### One owner, still

Components dispatch intents; the controller owns the resulting state. There is
no second visibility store, no layer store, no dissection controller and no
component-local copy of what is hidden. Every manipulation goes through one
private method, so there is one place that decides what happens to the
selection afterwards, one place that records history, and one place that
publishes.

---

## 18. Anatomy provider integration

Everything above this section is domain-agnostic. This is where anatomy
arrives — and the shape of the seam is what lets any other domain arrive the
same way later.

```
licensed source → AnatomyProvider → adapter → manifest
    → semantic graph → spatial engine → learning experience
```

### The identity rule

**The provider's object id must never become VEO's identity.**

A vendor asset contains meshes called `Heart_LV_001`; a hosted API returns
`obj_88213`. Both are export artefacts that change between revisions and differ
between vendors. The manifest declares the mapping in one direction:

```
providerId "obj_88213"     ──┐
                             ├──→ veo.anatomy.heart.left_ventricle
mesh       "Heart_LV_001"  ──┘
```

Swap the vendor, rewrite the manifest, and every question, flashcard, note and
memory record a learner has built stays valid. The learner's work outlives the
asset it was made against. A provider that resolves a selection does it through
the mapping, never by trusting the id it was handed — the conformance suite
asserts that a lookup by provider id returns nothing.

### The manifest

One document describing a model: `model`, `provider`, `modelVersion`,
`manifestVersion`, `domain`, `body`, `systems`, `regions`, `structures`,
`layers`, `relationships`, `explosion` and `capabilities`. A structure carries
`semanticId`, `providerId`, `meshes`, `name`, `officialName`, `synonyms`,
`kind`, `system`, `region`, `parentId`, `layers`, `description`, `function`,
`references`, `educationalLevel`, `externalIds`, bounds and exploded offset.

It is data, not code, so a new model needs no deployment.

**VEO does not author it.** Every descriptive field comes from the manifest's
author, with `references` recording where the claim came from. A structure with
no description renders without one. A description with no citation raises a
warning, because an anatomical claim VEO cannot stand behind should be visible
as such rather than invisible.

### Validation, and why it refuses

A hand-authored manifest will be wrong sometimes. The question is whether it is
wrong loudly or quietly.

**A quietly wrong manifest is the worst failure this system has.** A structure
mapped to the wrong mesh renders perfectly, selects perfectly, and teaches a
learner something false — and nothing in the running application looks broken.
So every check converts a silent mislabelling into a refusal to load:

duplicate ids · orphaned parents · circular hierarchy · ambiguous meshes ·
ambiguous provider ids · unresolved relationships, layers, regions and exploded
groups · empty declared systems · leaves with nothing to render · ids from
another domain · capability claims the data cannot support · geometry and
manifest describing different revisions.

Warnings — an unsourced claim, a relationship kind outside the vocabulary —
never block. A model that is merely incomplete is still useful, and refusing it
would push authors towards inventing content to satisfy a validator, which is
the opposite of the point.

### Versioning

Geometry and semantics version separately and are corrected on different
cadences, so the manifest carries both `modelVersion` and `manifestVersion`.
When the asset stamps its own version, validation compares them and refuses a
mismatch. Mixing semantic data from one revision with geometry from another
mislabels structures while looking exactly like working software.

### Hierarchy normalisation

VEO's hierarchy is Body → System → Region → Structure → Substructure. No
provider ships exactly that: one nests by dissection order, another by mesh
grouping, a third gives a flat list with tags.

The normaliser builds that shape from tags the manifest already declares. The
grouping nodes it produces carry no geometry, no description and no anatomical
claim — they are navigation, and they are marked `synthetic` so nothing
mistakes them for content.

It builds a **view**. The containment tree the manifest declares is untouched,
so both survive: a learner navigating by system and a learner navigating by
containment are asking different questions.

### Capabilities

Derived from the model's data, then narrowed twice — by what the manifest
permits and by what the provider can drive. Never widened.

A manifest claiming `supportsPeeling` with one peelable layer is a validation
**error**, not a silently ignored field: an author who wrote it believed it
would do something. This is Gate 7's rule enforced where manifests are written.

### Security

```
browser  →  VEO server  →  licensed provider  →  temporary resource
```

The browser never holds a provider credential and never talks to the vendor.
Configuration lives in `config/anatomy.server.ts`, which imports `server-only`
so the build fails if a Client Component reaches it, and ESLint forbids the
import from components, hooks and stores. A `NEXT_PUBLIC_` variable is compiled
into the bundle; a licence token in a bundle is a licence token that has been
published.

Three further boundaries:

- **The catalogue is the allowlist.** `/api/anatomy/<modelRef>` serves only
  catalogued models. Without that it is an open proxy to any path on a licensed
  host — precisely the extraction vector a licence forbids.
- **Upstream errors are not echoed.** They carry hosts, paths and occasionally
  the credential that failed.
- **Manifests are validated server-side before being served**, then again in
  the browser. A client that trusts a response shape it did not verify is one
  proxy away from rendering someone else's data under VEO's labels.

The verification runs with a **positive control**: the scan must first find the
value of a public variable, because a scan that finds no secret may simply be a
scan that finds nothing.

### Conformance

Every `AnatomyProvider` implementation passes the same 69 assertions —
initialisation, model load, manifest, versions, structure lookup, hierarchy,
normalisation, relationships, layers, capabilities, bounds, selection,
visibility, isolation, camera, disposal, and replacement leaving no stale
objects. A provider that passes behaves interchangeably with the others from
the application's point of view, which is the whole promise of the abstraction.

Driven by a fixture that names no body structure, sits under a reserved
namespace, and is absent from the catalogue — asserted by a test, because a
fixture that could be served as anatomy is a fixture that eventually will be.

### What Gate 8 does NOT mean

It does not mean anatomy is integrated. It means the pipeline is ready to
accept it. **No anatomical geometry has been rendered by this build**, because
no licensed source exists in this environment. When none is configured the
product says so and renders nothing — no canvas, no stand-in, no primitive
standing in for an organ.

---

## 19. Between the pipeline and the asset

Gate 8 built the pipeline. This is what sits between it and a real file
arriving — the parts that only matter once geometry is involved.

### Reconciliation: the check that runs when geometry arrives

`validate:anatomy` checks a manifest against an asset offline. Reconciliation
asks the same question at load time, against the scene the renderer really
received — which is not always the file the author validated. A CDN serves a
stale revision; a deploy ships the manifest before the asset; a vendor
re-exports and renames three meshes.

Without it, a structure whose mesh is missing keeps its name, its parent, its
relationships and its context panel, and has nothing to draw. It can be
searched for and navigated to and never seen. Nothing throws. The learner
concludes the structure does not exist, or clicks the structure beside it and
reads the missing one's label.

Three separate facts come out of a load, and they mean different things:

| Fact | Meaning | Outcome |
| --- | --- | --- |
| `missingMeshes` | the manifest promised geometry the asset lacks | **refuse the model** |
| `unmappedMeshes` | the asset carries geometry nothing names | report it; assets legitimately carry scenery and armature |
| `versionMismatch` | asset and manifest describe different revisions | **refuse the model** |

A structure with *some* of its meshes still renders, partially — visible but
wrong, which is a different fact from absent, and reported separately.

### Version binding

Geometry and semantics version separately. The asset's own stamp lives in
`asset.extras`, which three.js keeps on the parsed result rather than on the
scene — and the scene is all the renderer sees. So the loader copies it onto
the root, and reconciliation compares it with the manifest.

Mixing revisions is the failure that looks most like working software: every
structure renders, every selection responds, and the names are wrong.

### Progressive loading

A whole body is not one download. Fetching every system to look at the skeleton
costs a learner minutes and a phone its memory, so a manifest may declare a
separate asset per system and per region, and `loadSystem` / `loadAnatomyRegion`
fetch them.

A declared part the host does not have is an error the learner can read, not a
viewport that mounts a 404 and renders nothing.

### Domain containment

Both providers refuse a manifest whose `domain` is not `anatomy`. The anatomy
workspace shows anatomy; diagnostic content has its own clearly-labelled path
and cannot arrive through this one. Without the guard, any manifest could put
non-anatomical structures in front of a learner as though they were body
structures.

### Labels

Drawn as DOM over the canvas rather than as 3D text, for three reasons in
order: legibility at any camera distance, which billboarded geometry does not
have; screen-reader access, since the canvas is `aria-hidden`; and selectable
text, because copying a structure's name into a search is a thing people do.

Positions come from each object's live bounds through the controller. No label
carries a coordinate — that would be wrong the moment the asset is re-exported.

Two rules decide what is drawn:

- **Off until asked.** A dense model with every structure labelled is
  unreadable, and a learner who cannot see the anatomy for the text has been
  given nothing.
- **A label follows its structure.** Hidden, dissected or peeled away, the
  label goes too: a name floating over nothing is worse than no name. A ghosted
  structure keeps its label, because it is still there — faint, and often
  exactly what a learner is orienting by.

The selected structure always survives the budget. Losing its label would be
the one omission anyone would notice.

### The transport rehearsal

One link in the chain had never been exercised: a real binary glTF arriving,
parsing into a three.js scene, and that scene's meshes binding to the
identities a manifest declared for them. Gates 5–7 tested a scene built in
memory; Gate 8 tested a stubbed network.

`gltf-transport.test.ts` exports a real GLB, asserts its container is
spec-conformant down to the chunk headers, parses it with the real loader, and
runs the result through the real registry, bounds, material and disposal code.
If that step were broken it would have surfaced on the day a licence arrived —
the worst possible day.

Its geometry is abstract and exists to carry mesh names through a file format.
It is never mounted in a viewport and never given an anatomy identity, and a
test asserts that both providers refuse it.

### Instrumentation

`LoadMetricsRecorder` measures the two things a learner feels — time to
something on screen, time to being able to do something with it — and the
counts that explain a bad answer to either. A model that loads slowly because
it has 400 000 triangles needs a different fix from one shipping 40
uncompressed textures, and without the counts both look the same.

Deliberately not a budget. Numbers are recorded, not enforced: the right
threshold depends on an asset nobody has seen, and a limit guessed now would
either never fire or fire on everything.

---

## 20. The contextual tutor

VEO's tutor is not a chat panel beside a model. It is a tutor that knows what
the learner is looking at, and the architecture exists to make that claim
defensible rather than merely plausible.

```
UI → TutorRequest → [server] resolve model → build context → prompt
   → provider → validate output → ground against context → TutorResponse
   → UI → optional SpatialAction → SceneController → renderer
```

### The model is resolved on the server

The browser sends a model REFERENCE and a semantic id. It never sends a graph.

This is the load-bearing decision. A client-supplied graph would let a client
describe any structure it liked — inventing names, descriptions and
relationships — and VEO would hand the invention to the model as though it
were licensed content. Every honesty guarantee downstream would then be worth
nothing, because the thing being honest ABOUT would be attacker-controlled.

Scene state (what is hidden, isolated, which layers are on) does come from the
browser, because that is the only place that knows it. It cannot invent a
structure; it can only describe the display of one the server already
resolved. Capabilities the browser claims are intersected with the model's
own, never trusted.

### Grounding is measured, not reported

`buildSpatialContext` records how much the model actually supplied about a
structure:

| Level | Means | Ceiling on `sourceStatus` |
| --- | --- | --- |
| `rich` | description and/or function | `grounded` |
| `structural` | hierarchy, systems, relationships, no prose | `partially-grounded` |
| `bare` | a name and a parent | `insufficient-context` |

The language model also reports its own grounding, and a model is not a
reliable witness to its own confidence. So the two are reconciled: a claim may
be worse than VEO measured, never better. An answer that sounds authoritative
about a structure carrying nothing but a name is downgraded to
`insufficient-context` before the UI ever sees it.

That is what turns "never fabricate" from an instruction in a prompt into a
property of the system.

### Everything untrusted is data

Structure names, descriptions, synonyms, provider metadata and the learner's
own words are fenced between `<<<VEO_DATA` and `VEO_DATA>>>`, and the system
prompt states that fenced content is never an instruction.

The fence alone is a suggestion. What makes it enforceable:

1. Values that contain the fence are neutralised, so nothing can close it.
2. Text imitating the transcript's own framing is defanged — but only where a
   turn could start. "The cardiovascular system: a network of vessels" is a
   description and survives intact; the same words after a sentence boundary
   do not. A sanitiser that corrupts real content to defend against an attack
   it is not carrying has cost more than it saved.
3. Chat-template markers, control characters and zero-width characters are
   stripped.

VEO does not match phrases like "ignore previous instructions". Denylists on
natural language fail open on the phrasing nobody thought of, and fail closed
on a learner legitimately asking about one.

### Responses are validated twice

A schema check proves the model returned the right SHAPE. It says nothing
about whether the content refers to anything real, so a second pass checks
every id against the context that was actually sent.

Unknown ids are DROPPED, not fatal. A model may produce a good explanation and
then invent a structure in its related list; failing the turn would discard a
correct answer, and passing it through would put a button in the UI that
cannot resolve. Where VEO's name and the model's disagree, VEO's wins — a
renamed structure is one the learner cannot find again in the tree.

### The AI never touches the renderer

```
AI → validated SpatialAction → dispatcher → SceneController → renderer
```

Gate 7 left ONE authority over scene state. An AI that mutated the scene
directly would be a second one, and the first thing it would break is undo.

The dispatcher validates against the LIVE controller, not against what was
true when the answer was generated — a learner can switch models while a
response is in flight. It returns a result rather than throwing, because an
action that no longer applies is an expected outcome, and the UI renders it as
a disabled control rather than an error.

### Bounded by design

A whole-body model has tens of thousands of structures. Sending the graph
would blow the context window, cost real money per question, and bury the one
structure the learner asked about. Children, relationships, related structures
and ancestors are each capped, and what was dropped is stated in the context
so the tutor cannot claim its list is complete.

Conversation history is bounded twice: once by the client as a UX choice, and
again by the server, because a client is not a trustworthy place to enforce a
cost ceiling.

---

## 21. Learning content

Gate 11 generates questions and flashcards. It sits beside the tutor rather
than inside it, and the reason is worth stating because it drives everything
else in this section.

A tutor may say "generally, structures like this do X" — clearly flagged as
background, and gone the moment the learner moves on. A question cannot. The
learner sees a prompt and four options, and reads every one as fact. So the
content engine has its own system prompt, its own stricter grounding, and its
own refusal behaviour.

```
semanticId → [server] resolve model → SpatialContext → LearningContext
           → check the objective is supportable → prompt → provider
           → schema → content rules → grounding → validated content
```

### Facts, not prose

`LearningContext` turns the model's fields into a list of labelled statements:

```
{ from: "description", statement: "…" }
{ from: "parent",      statement: "It is part of \"Assembly A\"." }
{ from: "relationship", statement: "\"X\" connects to \"Y\"." }
```

A generator handed a blob of prose can write a question about anything in it.
A generator handed labelled facts can be held to them — and the prompt states
plainly that the list is the complete set of things it may assert, not a
starting point.

### Objective support is derived before the model is called

Each objective needs particular material:

| Objective | Needs |
| --- | --- |
| IDENTIFY | a name |
| DEFINE | a description |
| FUNCTION | a stated function |
| RELATE | hierarchy or relationships |
| DISTINGUISH | nearby structures AND something to tell them apart by |
| LOCATE | a parent, system or region |

If the material is absent, VEO refuses with a message naming what is missing,
and never calls the provider. This is the single most important check in the
gate. Asking a model for a FUNCTION question about a structure whose function
VEO does not know would produce one — fluent, plausible, invented — and no
downstream validation could tell it from a real one, because there is nothing
to compare it against.

Refusing costs nothing and is honest. Generating costs money and teaches
something false.

### Distractors must be real

A wrong option is drawn from the distractor pool: siblings and relationship
targets, which are real structures in the same model. An invented distractor
is not a wrong answer — it is a second thing the learner has to unlearn.

### Validation is rejection, never repair

Schema first, then deterministic content rules:

- exactly one correct multiple-choice option, present among the choices
- no duplicate or empty options
- an identification target that resolves, with a name matching the model's
- a prompt that does not contain its own answer
- a flashcard whose front and back differ
- every referenced id present in the context

A failing item is dropped with a reason. It is never patched, because patching
means VEO writing part of a question about a subject it does not understand —
and a multiple-choice question silently given a second correct answer by its
own validator is worse than no question, since it looks authored.

What was rejected is reported rather than discarded: a batch where eight of
ten items were dropped is a signal about the model or the context, and quietly
returning two would hide it.

### Grounding is capped, not trusted

The model reports its own `sourceStatus`, and VEO caps that claim at what it
measured when building the context. A claim may be worse than VEO measured,
never better — the same rule the tutor uses, deliberately sharing one
vocabulary so a learner never sees "grounded" in one panel and "partial" in
another for the same structure.

`insufficient-context` is a REFUSAL here rather than a caveat. A tutor saying
"I don't have much on this" is being helpful; a flashcard that says so is a
card the learner will see again in three days.

### What Gate 11 does not build

No scheduling, no scoring, no streaks, no retention, no persistence. Generated
content lives for the session. A score kept in the content panel would be a
learner's performance record in component state — vanishing on navigation and
disagreeing with whatever the real memory model later stores. The recall
experience and the memory model arrive together, in their own gates.

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
