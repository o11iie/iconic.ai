# VEO — Build Status

_Last updated: 2026-09-21_

---

## Current phase

**Phase 4 — Anatomy Integration**

## Current gate

**Gate 8 — Real Anatomy Provider Integration → GREEN (pipeline ready)**
**Gate 7 — Spatial Manipulation → GREEN (no regression)**
**Gate 6 — Spatial Intelligence → GREEN (no regression)**
**Gate 5 — Core Spatial / 3D Engine → GREEN (no regression)**
**Gate 2 — Premium Product Shell → GREEN (no regression)**
**Gate 1 — Application Foundation → GREEN (no regression)**

> **Gate 8 GREEN does not mean real anatomy is integrated.** It means the
> ingestion and provider pipeline is complete, tested and ready to accept
> licensed anatomy. No licensed asset or provider credential exists in this
> environment, so **no anatomical geometry has been rendered**. That is Gate 9,
> and it is RED until a licensed model is actually loaded and validated.

| # | Gate 8 criterion | Status | Evidence |
| --- | --- | --- | --- |
| 1 | AnatomyProvider production interface | GREEN | 69 conformance assertions per implementation |
| 2 | Provider selection / configuration | GREEN | two providers registered, selected by id |
| 3 | GLTF provider operational | GREEN | passes the conformance suite |
| 4 | Manifest schema operational | GREEN | model, provider, versions, body, systems, regions, structures, layers, relationships, capabilities |
| 5 | Manifest validation operational | GREEN | 15 error classes, 25 tests, each proved by a refused manifest |
| 6 | Semantic namespace established | GREEN | `veo.anatomy.<system>.<structure>`, provider ids never become identity |
| 7 | Hierarchy normalisation | GREEN | Body → System → Region → Structure, derived from declared tags |
| 8 | Layer mapping | GREEN | declared layers resolve to real structures |
| 9 | Relationship mapping | GREEN | resolved and kind-filtered, unknown kinds warned |
| 10 | Capability discovery | GREEN | derived from data, narrowed by provider, never widened by manifest |
| 11 | Model versioning | GREEN | geometry and manifest versions checked against each other |
| 12 | Asset loading lifecycle | GREEN | loading / progress / success / failure / retry |
| 13 | Provider disposal | GREEN | no model, no selection, no stale objects |
| 14 | Provider conformance tests | PASS | 69 × 2 implementations |
| 15 | Security boundary verified | PASS | sentinel scan with a working positive control |
| 16 | No provider secrets exposed | PASS | neither value nor variable name in the bundle |
| 17 | No anatomy source exposed | PASS | catalogue allowlist, no asset served from VEO's origin |
| 18 | Diagnostic stays separate | PASS | `veo.diagnostic.*` only, behind its own flag |
| 19 | Missing-asset state honest | PASS | no canvas, no stand-in, an actionable reason |
| 20 | Spatial engine integration | GREEN | selection, visibility, isolation, camera all reach the engine |
| 21 | Anatomy validation command | PASS | `npm run validate:anatomy` |
| 22 | TypeScript | PASS | 0 errors |
| 23 | ESLint | PASS | 0 errors, 0 warnings |
| 24 | Unit tests | PASS | 468 passed / 468, 22 files |
| 25 | Production build | PASS | 20 routes |
| 26 | Gate 8 browser verification | PASS | 27 checks, 0 failures |
| 27 | Gate 7 regression | PASS | 158 checks |
| 28 | Gate 6 regression | PASS | 80 checks |
| 29 | Gate 5 regression | PASS | 54 checks |
| 30 | Gate 2 regression | PASS | 116 checks |
| 31 | Documentation updated | PASS | ARCHITECTURE.md §18 |
| 32 | Git commit created | PASS | see history |

---

## Completed

### Gate 8 — anatomy provider integration

**The pipeline that will accept licensed anatomy, complete and tested — with
no licensed anatomy in it.**

- **VEO Anatomy Manifest** (`anatomy/mapping/manifest.ts`) — the contract
  between a licensed source and VEO's permanent identity. Carries model,
  provider, both versions, body, systems, regions, structures, layers,
  relationships, exploded groups and capabilities. Each structure carries a
  `providerId` *and* mesh names, so a hosted API and an asset set map through
  the same document.
- **Validation** (`anatomy/mapping/validation.ts`) — 15 error classes, because
  a quietly wrong manifest renders perfectly and teaches something false.
  Duplicate ids, orphaned parents, circular hierarchy, ambiguous meshes and
  provider ids, unresolved relationships / layers / regions / exploded groups,
  empty declared systems, leaves with no geometry to bind to, foreign
  namespaces, capability claims the data cannot support, and version
  disagreement between geometry and manifest. Warnings — an unsourced claim, an
  unknown relationship kind — never block.
- **Hierarchy normalisation** (`anatomy/mapping/hierarchy.ts`) — Body → System
  → Region → Structure, derived from tags the manifest already declares. A
  view, not a mutation: the containment tree the model declares is preserved
  alongside it.
- **Two providers**, both passing the same conformance suite:
  `GltfAnatomyProvider` for assets a browser may read, and
  `HostedAnatomyProvider` for licensed anatomy that authenticates.
- **Security boundary** (`config/anatomy.server.ts`, `app/api/anatomy/*`) —
  browser → VEO server → licensed provider → temporary resource. The credential
  never leaves the server; the catalogue is the allowlist; a manifest is
  validated before it is served, not after.
- **Conformance suite** — 69 assertions every `AnatomyProvider` must pass,
  driven by a fixture that names no body structure and can never reach the
  catalogue.
- **`npm run validate:anatomy`** — validates a manifest, and cross-checks mesh
  names and the version stamp against the asset itself.

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

Nothing. Gate 8 is closed. Gate 9 — rendering real licensed anatomy —
is RED and blocked on content, not on code.

---

## Blocked

**One external dependency, unchanged since Gate 1 — and now the only one.**

- **No licensed anatomy source exists in this environment.** As of Gate 8 the
  entire pipeline that would consume one is complete and verified: the provider
  abstraction, the manifest contract, validation, hierarchy normalisation,
  capability discovery, the security boundary and the conformance suite. What
  is missing is anatomy.

  This is a **content and licensing blocker, not an engineering one**. VEO does
  not substitute procedurally generated anatomy, and it does not fill in
  descriptive content a manifest omits. Every anatomy surface reports the
  missing configuration explicitly, and the Learn catalogue marks every anatomy
  category as *awaiting licensed assets*.

  **No anatomical geometry has ever been rendered by this build.** Gate 9
  remains RED and will stay RED until a licensed model is loaded and validated
  in a browser.

  *To unblock:* see **Next action** below for the three routes and what each
  one costs.

**Not blockers, simply unconfigured** (each reports itself in the UI): Supabase,
OpenAI, Stripe, OAuth providers.

---

## Tests run

| Command | Result |
| --- | --- |
| `npm run typecheck` | **PASS** — 0 errors |
| `npm run lint` | **PASS** — 0 errors, 0 warnings |
| `npm run test` | **PASS** — 468 passed / 468 total, 22 files |
| `npm run build` | **PASS** — 20 routes |
| `npm run validate:anatomy` | **PASS** — contract fixture valid |
| `npm run test:anatomy` | **PASS** — 27 live provider checks, 0 failures |
| `npm run test:spatial` | **PASS** — 158 live manipulation checks |
| `npm run test:semantics` | **PASS** — 80 live semantic checks |
| `npm run test:engine` | **PASS** — 54 live engine checks |
| `npm run test:ui` | **PASS** — 116 live UI checks |
| `npm run test:browser` | **PASS** — all five, 435 checks, 0 failures |

### Unit coverage

| File | Tests | Covers |
| --- | ---: | --- |
| `engine/spatial/manipulation.test.ts` | 70 | state model, layers, isolation, peel, dissection, exploded transforms, reconstruction, history, reset, capability discovery, contradictory states |
| `anatomy/providers/conformance.test.ts` | 69 | the contract every provider must pass, run against both implementations, plus fixture-safety |
| `engine/spatial/semantic.test.ts` | 53 | descriptors, generation safety, hierarchy, selection integrity, bounds, search, registration order |
| `engine/3d/engine.test.ts` | 36 | materials, disposal, renderer policy, pointer rules, bounds, diagnostic graph |
| `anatomy/mapping/validation.test.ts` | 25 | every manifest error class, each proved by a manifest that must be refused |
| `components/workspace/workspace.test.tsx` | 25 | context panel, breadcrumb, search, toolbar capability gating, layers panel |
| 16 further files | 190 | camera, primitives, semantic ids, lifecycle, visual state, provider, stores, navigation, content, manifest, entitlements, tokens, database types |

Totals: **468 unit tests across 22 files** (Gate 8 added 94).

### Live anatomy verification (`npm run test:anatomy`)

| Group | Checks |
| --- | ---: |
| Provider configuration | 5 |
| Honest unavailable state | 4 |
| Diagnostic stays separate from anatomy | 4 |
| The catalogue is the allowlist | 4 |
| No provider secret reaches the browser | 7 |
| No anatomy source file is downloadable | 2 |
| Console | 1 |
| **Total** | **27 passed, 0 failed** |

The secret scan runs with a **positive control**: it must first find the value
of a public variable, which the build inlines by design. A scan that finds no
secret may simply be a scan that finds nothing, and every "no leak" result
below it would then be worthless.

### Regression suites

Gate 7 (158), Gate 6 (80), Gate 5 (54) and Gate 2 (116) all re-run unchanged
against the Gate 8 build: **408 checks, 0 failures**.

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

## Issues found and fixed during Gate 8

Two were real defects, both found by the conformance suite rather than by
reading the code.

1. **Hierarchy normalisation nested the model root inside itself.** The
   normaliser grouped every parentless object, and the manifest root is
   parentless — so the body node became the parent of a structure node that was
   the same object, putting the whole model one level too deep and collapsing
   the system and region tiers entirely. It normalised nothing.

   *Fixed* by grouping the root's children rather than the roots, with the root
   becoming the body node. The conformance suite asserts the level sequence
   body → system → region → structure, so the shape cannot silently flatten
   again.

2. **The GLTF provider declared a capability flag that Gate 7 had overtaken.**
   It reported `supportsExplodedView: false`, which was accurate when it was
   written — VEO had no exploded view then. Gate 7 built one, in the engine
   this provider renders through, and the stale flag switched it off for every
   licensed asset. A capability that exists and reports false is the mirror of
   the button that does nothing.

   *Fixed*, and the conformance suite now asserts the capability derived for a
   model that declares exploded offsets.

3. **A type assertion was hiding a copy-paste bug.** `getCapabilities` ended in
   `as SpatialCapabilities`, which silenced the fact that
   `supportsRelationships` was not on the type — and concealed that the line
   computing it read `derived.supportsLayers`. Removing the cast surfaced both.
   `supportsSelection`, `supportsLabels` and `supportsRelationships` are now
   first-class capabilities derived from the graph.

### Verified, not changed

- **The validator was tested by breaking things, not by passing things.** Each
  of its fifteen error classes is proved by a manifest that must be refused;
  a validator that only ever says "valid" demonstrates nothing. The same
  discipline covers the version cross-check: a manifest that is internally
  perfect but describes a different revision of the geometry is refused.

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

**Gate 9 — render real licensed anatomy.** Everything upstream of the content
is done: the provider abstraction, the manifest contract, validation, the
security boundary, hierarchy normalisation and the conformance suite are
complete and verified. What is missing is anatomy.

### What is actually blocking

A licensed anatomy source. One of:

| Route | What VEO needs | Code cost |
| --- | --- | --- |
| Licensed GLB/GLTF asset set | assets + an authored manifest per model, at a host | none — `gltf-asset` is ready |
| Hosted anatomy API | endpoint, credential, and the vendor's request shape | one server-side adapter in `/api/anatomy` |
| VEO-owned models | commissioned geometry + authored manifests | none — same path as a licensed asset set |

In every case the manifest is the work: mapping vendor meshes onto permanent
VEO identities, and authoring the descriptive content with its citations. VEO
will not generate that content, which is the whole reason the pipeline refuses
a manifest rather than filling one in.

### Bringing up a licensed model

```bash
# 1. Validate the manifest before it is ever served.
npm run validate:anatomy -- ./models/heart/manifest.json --asset ./models/heart/heart.glb

# 2. Point the server at the licensed host. Never NEXT_PUBLIC_ for a credential.
echo 'ANATOMY_PROVIDER=gltf-asset'                >> .env.local
echo 'ANATOMY_ASSET_BASE_URL=https://<host>'      >> .env.local
echo 'ANATOMY_LICENCE_HOLDER=<holder>'            >> .env.local
echo 'ANATOMY_LICENCE_EXPIRES_AT=<iso-date>'      >> .env.local

# 3. Confirm the boundary still holds, then the pipeline end to end.
npm run verify && npm start &
npm run test:browser
```

**Decision still required from you:** which of the three routes above. The
provider layer supports all of them; only the hosted-API route carries a code
cost, and it is one adapter behind an interface that already exists.

### What a licensed manifest must supply

| Field | Why |
| --- | --- |
| `semanticId` | VEO's permanent identity; never the vendor's mesh name |
| `providerId` and/or `meshes` | at least one way to find the geometry |
| `parentId` | hierarchy, breadcrumb, fit-to-group, subtree removal |
| `name`, `officialName`, `synonyms` | display and search recall |
| `system`, `region` | grouping, filtering, hierarchy normalisation |
| `description`, `function`, `references` | authored content with its provenance |
| `layers[]` with `order`, `peelable`, `peelMode` | what can be shown, hidden, ghosted and peeled |
| `explodedOffset` or `explosion` | how the model comes apart, when it does |
| `relationships[]` | related-structure navigation |
| `modelVersion`, `manifestVersion` | so geometry and semantics can never be mixed across revisions |

Anything omitted simply switches a capability off. The interface offers only
what the model can actually do.
