# VEO — Build Status

_Last updated: 2026-09-19_

---

## Current phase

**Phase 3 — Core Spatial Engine**

## Current gate

**Gate 6 — Spatial Intelligence + Object Interaction → GREEN (verified)**
**Gate 5 — Core Spatial / 3D Engine → GREEN (no regression)**
**Gate 2 — Premium Product Shell → GREEN (no regression)**
**Gate 1 — Application Foundation → GREEN (no regression)**

Gate 6 was verified the way it demanded: unit tests, a production build, and a
real browser driving real pointer, touch and keyboard input against the running
engine. Every claim below is backed by an assertion that reads engine or DOM
state, not by source inspection.

| # | Gate 6 criterion | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Semantic object registry operational | GREEN | 4 render nodes bound to a 7-object model |
| 2 | Raycast → semantic resolution operational | GREEN | pointer probing resolves 4 distinct objects |
| 3 | Selection states correct | GREEN | one selection, one hover, at all times |
| 4 | Hover restrained | GREEN | 8 moves inside one object publish no new state |
| 5 | Selection visualisation preserves materials | GREEN | ≤1 override per mesh, never cumulative |
| 6 | Context panel driven by real object state | GREEN | renders descriptor-only facts (`region`, `kind`) |
| 7 | Object hierarchy operational | GREEN | ancestors nearest-first to the model root |
| 8 | Generic breadcrumb renderer | GREEN | navigates to a grouping structure in-browser |
| 9 | Related structures via Relationship model | GREEN | resolvable targets only, 6 unit tests |
| 10 | Camera targeting operational | GREEN | focus/fit/reset move the camera, verified by pose |
| 11 | Object bounds API operational | GREEN | camera targets the centre the API reports |
| 12 | Label foundation operational | GREEN | priority + budget, anchored to objects |
| 13 | Pin foundation operational | GREEN | id/semanticId/position/title/type, pruned per model |
| 14 | Spatial search foundation operational | GREEN | name, id, synonym, system, region |
| 15 | Keyboard interaction operational | GREEN | Escape / R / F, never over a text field |
| 16 | Mobile uses the same pipeline | GREEN | tap selects the same object at 360/390/430 |
| 17 | Stale object references cannot resolve | GREEN | node held across replacement resolves to null |
| 18 | Selection integrity under mutation | GREEN | hiding the selection invalidates it |
| 19 | URL identifiers are not trusted | GREEN | foreign and malformed ids both refused |
| 20 | No second registry or selection system | GREEN | one controller, one registry, one graph entry point |
| 21 | No fake anatomy | GREEN | asserted over the whole diagnostic graph |
| 22 | Diagnostic objects are not called anatomy | GREEN | `veo.diagnostic.*`, labelled in-viewport |
| 23 | TypeScript | PASS | 0 errors |
| 24 | ESLint | PASS | 0 errors, 0 warnings |
| 25 | Unit tests | PASS | 297 passed / 297, 19 files |
| 26 | Production build | PASS | 18 routes |
| 27 | Gate 6 browser verification | PASS | 80 checks, 0 failures |
| 28 | Gate 5 regression | PASS | 54 checks, 0 failures |
| 29 | Gate 2 regression | PASS | 116 checks, 0 failures |
| 30 | No console errors | PASS | 0 across desktop and 3 mobile widths |
| 31 | Documentation updated | PASS | ARCHITECTURE.md §16 |
| 32 | Git commit created | PASS | see history |

---

## Completed

### Gate 6 — spatial intelligence and object interaction

**The semantic object is the source of truth.** A rendered mesh is an
implementation detail of one model; the `SpatialObject` is what the learner
selects, what the panel describes, what search finds and what the camera
frames.

- **Semantic object registry** (`engine/spatial/object-registry.ts`) — the one
  place mapping render nodes to identity. `register` / `unregister` /
  `resolveFromObject` / `resolveFromSemanticId` / `getParent` / `getChildren` /
  `getAncestors` / `getDescendants` / `has` / `hasGeometry` / `isValid` /
  `clear`. Generation-stamped: a node from a previous model can never resolve.
- **`SceneController.beginRegistration`** — the seam between geometry and
  meaning. Clearing render nodes no longer discards the model.
- **Bounds API** — `getObjectBounds` / `getObjectCenter` /
  `getObjectWorldPosition` / `getObjectRadius`, in world units. No three.js type
  crosses into the semantic layer; the 3D layer injects a `BoundsResolver`.
  A grouping structure is framed by the extent of what it contains.
- **Camera targeting** — `focusObject` selects and frames in one step and
  refuses an id the model does not contain.
- **Annotations** (`engine/spatial/annotations.ts`) — labels and pins anchored
  to semantic objects, never to world coordinates, with priority and a
  visibility budget.
- **Spatial search** (`engine/spatial/search.ts`) — weighted over name, id,
  synonym, system, region and metadata; results filtered to the current model.
- **Workspace** — context panel, breadcrumb, children, relationships, search
  and keyboard shortcuts, all reading the same controller state.
- **Diagnostic model** — a real `SpatialModelGraph` of 7 objects across two
  systems, published through the same `setGraph` used by a manifest-loaded
  asset. Named `System A` / `Object 1`, under `veo.diagnostic.*`, labelled
  **VEO SPATIAL ENGINE TEST** in the viewport. Not anatomy, and never described
  as anatomy.

### Gate 5 — core spatial engine

**Engine core.** `SceneController` is the single owner of scene state —
selection, hover, highlight, visibility, isolation, layers, camera intents and
lifecycle. `BaseSceneGraphProvider` now delegates to it rather than keeping a
parallel copy, so the provider API and the renderer are two views of one truth.
`SpatialObjectRegistry` maps scene nodes to semantic identity, resolving a hit
to its NEAREST tagged ancestor so a selectable child wins over its group.
`modelLifecycleReducer` is a pure state machine whose `generation` field
discards results from superseded loads.

**Renderer.** Neutral tone mapping at exposure 1, sRGB output, DPR capped at 2
(1.5 on low-core devices), antialiasing dropped once resolution does the same
job, on-demand frame loop, and WebGL context-loss handling with an honest
recovery path.

**Materials.** `MaterialStateManager` allocates at most ONE override material
per mesh and mutates it in place, replacing the previous clone-per-change
approach that leaked a material on every hover. Authored materials are never
mutated; restoring is a reference swap.

**Disposal.** `disposeObject3D` walks every material slot and texture-bearing
uniform, disposes shared materials exactly once, and detaches the root.

**Camera.** Zoom limits derived from model extent, three-quarter initial
framing, fit-to-model and fit-to-selection measured from selectable content
rather than the whole root, transitions driven in `useFrame` with zero React
re-renders, touch configured for one-finger orbit and two-finger pinch/pan.

**Interaction.** Selection on pointer-up within a 6px slop, so orbiting never
changes the selection. Orbit mode suppresses hover and selection.

**Diagnostic scene.** `VEO SPATIAL ENGINE TEST` — four abstract primitives
under the reserved `veo.diagnostic` namespace, which is deliberately not a
knowledge domain. Built imperatively and handed to the same scene root as a
loaded GLTF, so it exercises the production path.

**Accessibility.** The canvas is `aria-hidden`; camera controls are real
focusable buttons outside it, and selection is announced through a live region.

### Gate 2 — product shell

**Design system.** Button, ButtonLink, IconButton, Input, Search, Card, Panel,
Modal, Drawer, Badge, Tooltip, Tabs, TabPanel, Segmented, Menu, Avatar, Icon
(30-glyph inline set), plus Loading/Empty/Error/NotConfigured states and a
shared motion vocabulary. Overlays trap focus, close on Escape, lock scroll and
restore focus; Tabs implement roving tabindex; Menu implements the menu-button
pattern.

**App shell.** Desktop navigation rail (icon-only from `md`, labelled from
`xl`), mobile bottom navigation with safe-area padding, top bar with search and
account menu, and an optional contextual right panel. Settings lives in the
account menu rather than the primary rail. Navigation carries the open model in
the URL so returning to Explore resumes it.

**Landing page.** Hero, three pillars, the learning loop, domain coverage and a
close. No user counts, no logos, no testimonials, no outcome statistics.

**Authentication.** Sign in, sign up, forgot password and reset password, all
wired to Supabase server actions. OAuth architecture implemented and driven by
`NEXT_PUBLIC_OAUTH_PROVIDERS`; the social section renders nothing when no
provider is configured rather than showing dead buttons. Terms and privacy
pages exist and state plainly that final documents are pending.

**Onboarding.** Three steps — name, subject, level plus an optional goal —
persisted to `profiles` through a server action under RLS.

**Learning workspace (`/explore`).** Workspace bar with model switcher, a
vertical spatial toolbar (Select, Explore, Layers, Isolate, Reset), the
dominant viewport, a floating layers panel, a context panel that collapses to a
bottom sheet below `xl`, and a single-row AI study bar. The model is resolved
once and passed down, so mounting the stage cannot trigger a duplicate asset
download.

**Context panel and relationship UI.** Renders a real `SpatialObject` plus
optional provider metadata; every field appears only when supplied. Study
actions (AI Explain, Quiz Me, Flashcard, Add Note, Review Later) are present
and disabled when there is nothing to act on. `RelationshipTrail` and
`RelationshipList` are domain-agnostic patterns over the relationship system.

**Home, Learn, Recall, Library, Settings.** Each with honest empty states.
Learn browses the subject catalogue with real content status attached to every
category. Recall exposes the five modes and the state architecture without
implementing scheduling. Settings covers profile, learning preferences,
appearance, notifications, subscription, environment and data/privacy.

### Gate 1 — foundation (unchanged, still green)

Domain model, semantic identity, spatial engine, provider abstractions, the
GLTF anatomy provider, Supabase integration, database schema and RLS. See the
Gate 1 section of the git history for detail.

---

## In progress

Nothing. Gate 6 is closed.

---

## Blocked

**One external dependency, unchanged from Gate 1:**

- **Licensed anatomy assets are not available in this environment.** The
  provider, manifest contract, renderer, mapping, workspace and full
  interaction model are implemented and tested, but no licensed GLB/GLTF asset
  set is configured, so no anatomical geometry can be displayed.

  This is a **content/licensing blocker, not an engineering one**. VEO does not
  substitute procedurally generated anatomy. Every anatomy surface reports the
  missing configuration explicitly, and the Learn catalogue marks every anatomy
  category as *awaiting licensed assets*.

  *To unblock:* publish a licensed asset set plus its `manifest.json` and set
  `NEXT_PUBLIC_SPATIAL_ASSET_BASE_URL`. No code change is required.

**Not blockers, simply unconfigured** (each reports itself in the UI): Supabase,
OpenAI, Stripe, OAuth providers.

---

## Tests run

| Command | Result |
| --- | --- |
| `npm run typecheck` | **PASS** — 0 errors |
| `npm run lint` | **PASS** — 0 errors, 0 warnings |
| `npm run test` | **PASS** — 297 passed / 297 total, 19 files |
| `npm run build` | **PASS** — 18 routes |
| `npm run test:semantics` | **PASS** — 80 live semantic checks, 0 failures |
| `npm run test:engine` | **PASS** — 54 live engine checks, 0 failures |
| `npm run test:ui` | **PASS** — 116 live UI checks, 0 failures |

### Unit coverage

| File | Tests | Covers |
| --- | ---: | --- |
| `engine/spatial/semantic.test.ts` | 52 | descriptors, generation safety, hierarchy, selection integrity, bounds, search, annotations, registration order |
| `engine/3d/engine.test.ts` | 33 | materials, disposal, renderer policy, pointer rules, bounds, diagnostic graph |
| `components/workspace/workspace.test.tsx` | 22 | context panel, breadcrumb, relationships, search, empty states |
| `engine/spatial/scene-controller.test.ts` | 20 | selection, visibility, isolation, replacement, camera intents |
| `engine/3d/camera/camera-math.test.ts` | 20 | zoom limits, initial framing, box guards |
| `components/ui/primitives.test.tsx` | 18 | design-system primitives |
| `lib/semantic-id.test.ts` | 17 | parsing, building, hierarchy operations |
| `engine/spatial/model-lifecycle.test.ts` | 14 | every transition, generation guarding, terminal disposal |
| `engine/spatial/visual-state.test.ts` | 14 | visual state resolution |
| `anatomy/providers/gltf-anatomy-provider.test.ts` | 14 | provider contract |
| 9 further files | 73 | stores, navigation, content, manifest, entitlements, tokens, database types |

Totals: **297 unit tests across 19 files** (Gate 6 added 55).

### Live semantic verification (`npm run test:semantics`)

Drives a production build in Chromium. Screen positions are discovered by
moving the pointer and asking the engine what is under it, so nothing depends
on hard-coded geometry:

| Group | Checks |
| --- | ---: |
| Workspace opens with the diagnostic model | 3 |
| Semantic model and hierarchy | 4 |
| Hover resolves and clears | 7 |
| Hover does not churn state | 1 |
| Selection drives the interface | 10 |
| Navigating the hierarchy | 3 |
| The child wins over its parent group | 4 |
| Camera targeting and bounds | 5 |
| Spatial search | 4 |
| Keyboard | 4 |
| Material integrity | 5 |
| Selection integrity | 3 |
| Untrusted identifiers | 5 |
| Stale references | 6 |
| Console | 1 |
| Mobile 360 / 390 / 430 | 15 |
| **Total** | **80 passed, 0 failed** |

The stale-reference claim is measured, not asserted: a real render node is
captured from the live model, the model is replaced, and resolving that same
node is required to return `null`.

### Live engine verification (`npm run test:engine`)

Gate 5's suite, re-run unchanged against the Gate 6 build:

| Group | Checks |
| --- | ---: |
| Page, canvas, diagnostic scene | 8 |
| Camera responds / orbit | 2 |
| Zoom | 2 |
| Pan | 1 |
| Reset | 2 |
| Targeting, selection, highlight | 9 |
| Fit-to-selection and model replacement | 7 |
| Console and layout | 3 |
| Mobile viewport (4 sizes) | 16 |
| Honest state without a licensed asset | 2 |
| **Total** | **54 passed, 0 failed** |

The memory claim is measured, not asserted: the scene is replaced four times
and the renderer's own `gl.info.memory.geometries` is required not to grow.

---

## Performance findings

- **Device pixel ratio is the dominant cost.** A 3x display renders nine times
  the fragments of a 1x one. Capping at 2 (1.5 on devices reporting four or
  fewer cores) is the single highest-value renderer decision, and on low-memory
  devices it is the difference between a slowdown and a lost WebGL context.
- **Camera tweens must never touch React.** Transitions run inside `useFrame`
  and mutate the camera directly; driving them through state would re-render
  the tree every frame.
- **Material churn was the real leak.** Cloning a material per visual-state
  change allocated one GPU material per hover. Reusing a single override per
  mesh removed it entirely — measured at 200 state changes producing exactly
  one override.
- **On-demand rendering keeps idle frames idle.** `MaterialStateManager.apply`
  reports whether anything actually changed, so an unchanged visual state does
  not request a frame.
- **Snapshot stability matters.** `SceneController.getSnapshot` returns the
  same object until something changes, and re-selecting the current selection
  does not notify — otherwise every no-op selection would cost a render.

---

## Issues found and fixed during Gate 6

Two were real defects in the engine, both invisible to unit tests and to source
inspection, and both found only by driving the running application.

1. **Clearing render nodes silently deleted the model.** `SpatialSceneRoot`
   called `registry.clear()` directly when binding a newly rendered scene, and
   `clear()` dropped the model's descriptors along with its render nodes.
   Registration happens inside the canvas — a separate React tree that commits
   on its own schedule — while the model is published from the page tree, so
   whichever committed last won. In the production build registration committed
   last, and the loaded model lost its hierarchy, its grouping structures and
   its search entries while still rendering and selecting perfectly.

   *Fixed* by adding `SceneController.beginRegistration()`, which clears the
   previous generation's nodes and re-attaches the current model's descriptors.
   Geometry and meaning have different lifetimes; this is the seam that keeps
   them from being confused. The result is now identical in either commit
   order, which four regression tests pin down.

2. **The registry treated "has geometry" as "exists".** `has`, `isValid` and
   hierarchy lookups consulted only registered render nodes, so a structure the
   model declares but draws as a bare group — a system, a region, an assembly,
   which is how essentially every real asset is authored — vanished from the
   hierarchy, from search and from selection. That is precisely the mistake of
   letting the rendered mesh be the source of truth.

   *Fixed* by making the registry's notion of the current model the union of
   declared descriptors and registered nodes, with `hasGeometry()` kept as the
   separate question it actually is. `getObjectBounds` now frames a grouping
   structure by the extent of what it contains, so the camera can target one.
   Seven regression tests cover it, and the browser suite navigates to a group
   through the breadcrumb and finds one by name.

3. **A debug field reported a constant.** The diagnostic bridge published
   `materialOverrides: 0` unconditionally. Nothing asserted on it, so nothing
   failed — which is the problem: a verification surface that reports a fixed
   number can only ever mislead. It is now wired to the material manager's real
   count, and the browser suite asserts the actual invariant.

4. **Two browser assertions checked the wrong thing.** One matched the selected
   object's name against the whole context panel, which also prints the
   semantic id — so it would have passed without the name ever being rendered.
   It now reads the heading, and a second assertion checks a fact that exists
   only in the descriptor (`region`), which appears nowhere in the id.

### Verified, not changed

Three browser assertions failed on first run and were wrong about the engine
rather than finding a defect:

- **Selecting a breadcrumb ancestor also moves the camera**, because
  `onSelectObject` is `focusObject` — selecting and framing in one gesture.
  The test had reused pixel coordinates probed before the camera moved. It now
  re-probes against the current view.
- **Override materials are deliberately reused, not freed.** The engine
  allocates at most one override per mesh and swaps the authored material back
  by reference. Asserting zero overrides after deselection would have forced a
  worse design that churns GPU resources on every hover. The assertion now
  states the real invariant: never more than one override per tracked mesh, and
  never a count that climbs with interaction.
- **Search returns nothing for a query with no match**, which is correct; the
  first draft of the test read that as a defect before the grouping-structure
  fix above landed.

---

## Issues found and fixed during Gate 5

1. **Grid and axes helpers inflated the model bounds**, so fit-to-model framed
   the helper rather than the content and left the model small in the middle of
   the viewport. Bounds are now measured across *selectable* objects, falling
   back to the root — which also fixes framing for any licensed asset that
   ships lights, cameras or helper nodes inside its scene.
2. **`setState` inside effects** in three components would have caused
   cascading renders. The scene root's forced re-render was redundant once the
   controller notified subscribers; the stage now derives the loaded root from
   the URL it came from rather than clearing it after the fact; and the
   workspace opens its mobile drawer from a controller subscription rather than
   by reacting to rendered state.
3. **Camera control labels wrapped onto two lines** in the viewport toolbar.
4. **Double-mounted diagnostic group.** The first draft rendered the diagnostic
   primitive both in its own component and in the scene root. Resolved by
   making the diagnostic a pure builder, which also ensures it takes the same
   code path as a loaded asset.

### Verified, not changed

Two browser assertions failed initially and turned out to be wrong about the
engine rather than finding a defect:

- **Selection surviving a same-scene reload is correct.** Losing the learner's
  selection on every reload would be hostile. What matters is that it is not a
  *dangling* reference, so the assertion now proves the surviving id still
  resolves in the rebuilt registry and its highlight re-applied to the new
  geometry.
- **A structure under the cursor is legitimately `hovered`, not residue.** The
  check now parks the pointer off-canvas first, and additionally asserts that
  hover clears when the pointer leaves.

---

## Next action

**Gate 7.** Gate 6 is GREEN, so the next gate is open. Gate 6 deliberately
stopped short of: dissection, full peel mechanics, spaced repetition, AI tutor
responses, and licensed anatomy asset integration. The semantic layer those
features need is now in place — every one of them addresses structures by
semantic id, not by mesh.

To reproduce the verification locally:

```bash
# The diagnostic scene is gated; enable it for engineering verification only.
echo 'NEXT_PUBLIC_ENABLE_PIPELINE_DIAGNOSTIC=true' >> .env.local
npm run verify
npm start &
npm run test:browser      # UI + engine + semantics, 250 checks
```

**Decision still required from you:** the licensing route for subject content —
license an SDK, license a GLB/GLTF asset set, or commission VEO-owned models.
The provider layer supports all three; only the SDK path carries a code cost,
and the abstraction for it already exists. This remains the critical path: the
engine and its semantic layer are complete and every remaining gate builds on
content this environment cannot yet display.

### What a licensed asset needs to supply

Gate 6 makes the integration contract concrete. An asset set is ready for VEO
when its `manifest.json` provides, for every structure:

| Field | Why it matters now |
| --- | --- |
| `semanticId` | VEO's permanent identity; never the vendor's mesh name |
| `parentId` / `childIds` | drives hierarchy, breadcrumb and fit-to-group |
| `name` | what the panel, search and labels display |
| `synonyms` | search recall for the terms a learner actually types |
| `system` / `region` | grouping, filtering and layer membership |
| `providerMeshNames` | the vendor-side mapping, kept at the edge |
| `relationships` | related-structure navigation |

Structures that render as bare grouping nodes are first-class: they need no
geometry to be navigable, searchable, selectable or framable.
