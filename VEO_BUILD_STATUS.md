# VEO — Build Status

_Last updated: 2026-09-21_

---

## Current phase

**Phase 3 — Core Spatial Engine → COMPLETE**

## Current gate

**Gate 7 — Spatial Manipulation + Reconstruction → GREEN (verified)**
**Gate 6 — Spatial Intelligence → GREEN (no regression)**
**Gate 5 — Core Spatial / 3D Engine → GREEN (no regression)**
**Gate 2 — Premium Product Shell → GREEN (no regression)**
**Gate 1 — Application Foundation → GREEN (no regression)**

Gate 7 was verified by taking a model apart in a running browser and putting it
back: pointer, touch and toolbar input against the real engine, with every
claim read from engine state rather than from the DOM.

| # | Gate 7 criterion | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Visual state model implemented | GREEN | nine states, one value per object, twelve-rule precedence |
| 2 | Layer system operational | GREEN | three declared layers, indexed membership |
| 3 | Layer show / hide | GREEN | objects stop and resume rendering |
| 4 | Layer ghost | GREEN | objects become faint rather than gone |
| 5 | Layer restore | GREEN | returns to visible, nothing else disturbed |
| 6 | Object hide / show | GREEN | subtree-aware, never unregisters |
| 7 | Isolation | GREEN | context ghosted, selection survives, camera frames it |
| 8 | Isolation restoration | GREEN | leaves a hand-hidden structure hidden |
| 9 | Ghost mode | GREEN | spatially present, semantically intact |
| 10 | Ghost restoration | GREEN | no residue |
| 11 | Peel architecture | GREEN | sequence and step count come from the model |
| 12 | Peel progression | GREEN | reveals the next layer, stops before emptying |
| 13 | Peel reversal | GREEN | previous step restores the layer |
| 14 | Peel reset | GREEN | returns to whole |
| 15 | Dissection | GREEN | reveals context, preserves identity |
| 16 | Dissection history | GREEN | ordered stack, undone last-first |
| 17 | Dissection restoration | GREEN | one at a time or all at once |
| 18 | Exploded view | GREEN | declared and group-derived offsets both verified |
| 19 | Exact transform restoration | GREEN | identical coordinates after 5 cycles |
| 20 | Reconstruction | GREEN | step and whole, keeping the learner's place |
| 21 | Reset | GREEN | every axis, plus camera and history |
| 22 | Reset is idempotent | GREEN | twice is byte-identical to once |
| 23 | Capability discovery | GREEN | derived from the graph; a model may only restrict |
| 24 | Context panel connected | GREEN | isolate / hide / ghost / dissect / restore on real ids |
| 25 | Layers panel connected | GREEN | real state, real counts, three operations |
| 26 | Mobile manipulation | GREEN | 360 / 390 / 430, toolbar and sheet |
| 27 | No fake anatomy | GREEN | asserted over the whole diagnostic graph |
| 28 | No semantic object destroyed | GREEN | re-asserted after every manipulation |
| 29 | Source materials unmodified | GREEN | one override per mesh, authored material untouched |
| 30 | No manipulation GPU leak | GREEN | geometry count flat over 60 manipulations |
| 31 | TypeScript | PASS | 0 errors |
| 32 | ESLint | PASS | 0 errors, 0 warnings |
| 33 | Unit tests | PASS | 374 passed / 374, 20 files |
| 34 | Production build | PASS | 18 routes |
| 35 | Gate 7 browser verification | PASS | 158 checks, 0 failures |
| 36 | Gate 6 regression | PASS | 80 checks, 0 failures |
| 37 | Gate 5 regression | PASS | 54 checks, 0 failures |
| 38 | Gate 2 regression | PASS | 116 checks, 0 failures |
| 39 | No console errors | PASS | 0 across desktop and 3 mobile widths |
| 40 | Documentation updated | PASS | ARCHITECTURE.md §17 |
| 41 | Git commit created | PASS | see history |

---

## Completed

### Gate 7 — spatial manipulation and reconstruction

**A learner can take the model apart without taking the MODEL apart.** Every
operation is a change of presentation: nothing is unregistered, no geometry is
disposed, no authored material or transform is overwritten, and every semantic
object stays queryable throughout.

- **One state, eight axes** (`engine/spatial/manipulation.ts`) — hidden,
  ghosted, dissected, isolated, hidden layers, ghosted layers, peel level,
  exploded. Isolation, peel and layer state are held as what the learner asked
  for rather than written into the hidden set, which is what makes each one
  independently reversible.
- **Twelve-rule precedence** (`visual-state.ts`) — removal beats emphasis, and
  explicit intent beats incidental consequence. A structure hidden by hand
  stays hidden when its layer comes back on.
- **Layers** (`layers.ts`) — show / hide / ghost / toggle / restore, over an
  indexed membership map built once per model. The diagnostic layers cut across
  the hierarchy, so hiding a layer and hiding a system are visibly different.
- **Peel** — the sequence and the number of steps come from the model's own
  layers. Each layer declares whether peeling ghosts it or removes it.
- **Dissection** — an ordered stack, undone last-first, with the registry,
  hierarchy, relationships and metadata untouched.
- **Exploded view** — an offset on top of the authored transform, never in
  place of it. Declared offsets win; a group's members move radially from its
  centre. `TransformStateManager` holds each base position and assigns it back,
  so restoration is exact rather than close.
- **Reconstruction and reset** — `reconstructStep` retraces the learner's path
  in reverse; `resetScene` assigns a constant, which is what makes it
  idempotent by construction rather than by care.
- **History** (`manipulation-history.ts`) — semantic intents only, bounded at
  50, with undo and redo.
- **Capability discovery** (`capabilities.ts`) — derived from the graph. A
  model may switch a capability off, never on: a manifest cannot assert its way
  into a feature it has no data for.

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

Nothing. Gate 7 is closed, and with it Phase 3.

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
| `npm run test` | **PASS** — 374 passed / 374 total, 20 files |
| `npm run build` | **PASS** — 18 routes |
| `npm run test:spatial` | **PASS** — 158 live manipulation checks, 0 failures |
| `npm run test:semantics` | **PASS** — 80 live semantic checks, 0 failures |
| `npm run test:engine` | **PASS** — 54 live engine checks, 0 failures |
| `npm run test:ui` | **PASS** — 116 live UI checks, 0 failures |
| `npm run test:browser` | **PASS** — all four, 408 checks, 0 failures |

### Unit coverage

| File | Tests | Covers |
| --- | ---: | --- |
| `engine/spatial/manipulation.test.ts` | 70 | state model, layers, isolation, peel, dissection, exploded transforms, reconstruction, history, reset idempotence, capability discovery, contradictory states, material and transform safety |
| `engine/spatial/semantic.test.ts` | 53 | descriptors, generation safety, hierarchy, selection integrity, bounds, search, annotations, registration order, one copy of the model |
| `engine/3d/engine.test.ts` | 36 | materials, disposal, renderer policy, pointer rules, bounds, diagnostic graph, layer and explosion declarations |
| `components/workspace/workspace.test.tsx` | 25 | context panel, breadcrumb, relationships, search, toolbar capability gating, layers panel |
| `engine/spatial/scene-controller.test.ts` | 20 | selection, visibility, isolation, replacement, camera intents |
| `engine/3d/camera/camera-math.test.ts` | 20 | zoom limits, initial framing, box guards |
| 14 further files | 150 | primitives, semantic ids, lifecycle, visual state, provider, stores, navigation, content, manifest, entitlements, tokens, database types |

Totals: **374 unit tests across 20 files** (Gate 7 added 71).

### Live manipulation verification (`npm run test:spatial`)

Drives a production build in Chromium and takes the diagnostic model apart:

| Group | Checks |
| --- | ---: |
| Workspace and diagnostic model | 4 |
| Capability discovery | 7 |
| Isolation | 12 |
| Ghosting | 5 |
| Hide and show | 4 |
| Layers | 10 |
| Peel | 14 |
| Dissection | 10 |
| Exploded view | 13 |
| Reconstruction | 8 |
| Manipulation history | 4 |
| Reset, twice | 10 |
| GPU and resource stability | 5 |
| Console | 1 |
| Mobile 360 / 390 / 430 | 51 |
| **Total** | **158 passed, 0 failed** |

Two claims are measured rather than asserted. **Nothing is destroyed**: after
every manipulation the script re-checks that all five objects are still
registered, still have a parent, and are still findable by search.
**Restoration is exact**: the authored coordinates are compared for equality,
not closeness, after five explode/implode cycles — an offset added and
subtracted would drift, and this would catch it.

### Live semantic verification (`npm run test:semantics`)

Gate 6's suite, re-run against the Gate 7 build: **80 passed, 0 failed**.

### Live engine verification (`npm run test:engine`)

Gate 5's suite, re-run against the Gate 7 build: **54 passed, 0 failed**.

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

## Issues found and fixed during Gate 7

Two were real defects, both invisible to unit tests and found only by running
the application.

1. **The provider kept a second copy of the loaded model.** `ProviderSnapshot`
   reported the provider's own `graph` field alongside the controller's, and a
   model published straight to the controller — which is exactly what the
   diagnostic path does — left that field null. So the layers panel listed
   nothing while the engine was peeling those same layers, and everything
   reading the provider saw a model with no layers, no regions and no
   relationships.

   *Fixed* by making `graph` a getter over `scene.getGraph()`, leaving the
   controller as the only copy. A regression test publishes straight to the
   controller and asserts the provider reports it.

2. **Isolation wrote itself into the hidden set.** Isolating computed hidden
   and ghosted sets and assigned them over the learner's own, so restoring
   isolation un-hid a structure they had hidden deliberately. Isolation is now
   held as the id alone and resolved at render time, which also makes the
   `isolated` visual state possible.

   *Fixed* alongside a wider change: peel level and layer state are held the
   same way. That is what makes each axis independently reversible, and a
   regression test hides a structure by hand, isolates, restores, and requires
   the hand-hidden structure to still be hidden.

3. **A test drag could sample a moving camera.** Gate 5's mobile orbit check
   occasionally read a pose mid-transition and compared two moving values,
   reading as no movement. It failed once in five runs. Rather than call it a
   flake, the check now waits for the camera to settle first; it has since run
   clean three times in a row and through the full chain.

### Verified, not changed

Four browser assertions failed on first run and were wrong about the engine
rather than finding a defect. Each was made more specific, not less:

- **Selection outranks isolation on the object carrying both.** `isolateObject`
  selects and isolates in one step, so the object reports `selected`. The check
  now asserts that precedence explicitly, and reads `isolated` from a member of
  the subtree that is not itself selected.
- **Undoing a dissection reveals the peel beneath it.** The test expected the
  structure to return to normal, but it sat in a peeled layer. The removal
  states are independent axes; putting one back does not silently put back
  another. The check now states that.
- **Selecting a structure in a hidden layer invalidates the selection.** The
  mobile test hid a layer and never restored it, then selected a structure
  inside it. The engine was right; the test now restores the layer, which also
  covers restore-by-touch.
- **Manipulating on a narrow screen happens in the details sheet.** Selecting
  opens the sheet over the toolbar, which is the point: the controls for the
  selected structure come to the thumb. The mobile checks now drive the sheet's
  own controls, which is the real path a learner takes.

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

**Phase 4.** Gate 7 is GREEN, which closes Phase 3: the spatial engine and
everything built on it — semantics, interaction and manipulation — are complete
and verified. Phase 3 deliberately stopped short of AI tutor responses, active
recall, spaced repetition, generated study material, and licensed asset
integration.

To reproduce the verification locally:

```bash
# The diagnostic scene is gated; enable it for engineering verification only.
echo 'NEXT_PUBLIC_ENABLE_PIPELINE_DIAGNOSTIC=true' >> .env.local
npm run verify
npm start &
npm run test:browser      # UI + engine + semantics + spatial, 408 checks
```

**Decision still required from you:** the licensing route for subject content —
license an SDK, license a GLB/GLTF asset set, or commission VEO-owned models.
The provider layer supports all three; only the SDK path carries a code cost,
and the abstraction for it already exists. This is now the only thing standing
between the engine and a learner: everything Phase 4 builds sits on content
this environment cannot yet display.

### What a licensed asset needs to supply

Gates 6 and 7 together make the integration contract concrete. An asset set is
ready for VEO when its `manifest.json` provides, for every structure:

| Field | Why it matters now |
| --- | --- |
| `semanticId` | VEO's permanent identity; never the vendor's mesh name |
| `parentId` / `childIds` | hierarchy, breadcrumb, fit-to-group, and subtree removal |
| `name` | what the panel, search and labels display |
| `synonyms` | search recall for the terms a learner actually types |
| `system` / `region` | grouping and filtering |
| `providerMeshNames` | the vendor-side mapping, kept at the edge |
| `relationships` | related-structure navigation |
| `layers` | what can be shown, hidden, ghosted and peeled |
| `layers[].order` | the peel sequence, outermost first |
| `layers[].peelable` / `peelMode` | whether a peel removes a layer, and how |
| `explodedOffset` or `explosion` | how the model comes apart, when it does |

Structures that render as bare grouping nodes are first-class: they need no
geometry to be navigable, searchable, selectable, framable or removable.
Anything the manifest omits simply switches a capability off — the interface
offers only what the model can actually do.
