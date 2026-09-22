# VEO — Build Status

_Last updated: 2026-09-22_

---

## Current phase

**Phase 4 — Anatomy Integration**

## Current gate

**Gate 9 — Real Anatomy Rendering → RED, blocked by an external dependency**

**Gate 8 — Anatomy Provider Integration → GREEN (no regression)**
**Gate 7 — Spatial Manipulation → GREEN (no regression)**
**Gate 6 — Spatial Intelligence → GREEN (no regression)**
**Gate 5 — Core Spatial / 3D Engine → GREEN (no regression)**
**Gate 2 — Premium Product Shell → GREEN (no regression)**
**Gate 1 — Application Foundation → GREEN (no regression)**

> ## Gate 9 is RED
>
> **No licensed anatomy source exists in this environment, so no anatomical
> geometry has been rendered.** Gate 9's one acceptance condition — real
> licensed anatomy rendering in a browser — cannot be met, and reporting
> anything else would be a lie.
>
> This is not an engineering blocker. Everything upstream of the content is
> built and verified. What is missing is anatomy, and it cannot be written.

### Environment classification

Phase 1 of Gate 9 requires the anatomy source to be established by inspection
rather than assumption. The result is **D — no real provider available**:

| Checked | Found |
| --- | --- |
| `ANATOMY_*` server variables | none set |
| `NEXT_PUBLIC_SPATIAL_ASSET_BASE_URL` | not set |
| `.glb` / `.gltf` files in the repository | none |
| `manifest.json` anywhere | none |
| `public/` asset tree | empty |
| Vendor references (any provider) in tracked files | none |
| `GET /api/anatomy` on the running build | `configured: false`, `delivery: "none"` |
| `GET /api/anatomy/heart` | `503 not_configured` |
| Catalogue entries | all four `licensedAssetRequired: true` |

### What Gate 9 completed anyway

Everything that can be legitimately finished without the content was finished,
so that the day a licence arrives is a day of loading a file rather than a day
of writing the loader.

| # | Gate 9 criterion | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Actual licensed anatomy renders | **RED** | no licensed source exists |
| 2 | Rendered geometry is provider geometry | **RED** | nothing is rendered |
| 3 | AnatomyProvider remains the source of truth | GREEN | 69 conformance assertions × 2 providers |
| 4 | Manifest validation passes | GREEN | 15 error classes, 25 tests |
| 5 | Provider-independent semantic ids | GREEN | provider id never resolves as identity |
| 6 | Asset ↔ manifest reconciliation | GREEN | 10 tests; refuses a mislabelled model |
| 7 | Model version binding at load time | GREEN | asset stamp read and compared |
| 8 | Binary glTF transport | GREEN | 9 tests over a real GLB round trip |
| 9 | Progressive system / region loading | GREEN | 4 tests; declared part assets fetched |
| 10 | Domain containment | GREEN | both providers refuse a non-anatomy manifest |
| 11 | Selection through the semantic registry | GREEN | 80 live checks (Gate 6 suite) |
| 12 | Camera framing from real bounds | GREEN | 54 live checks (Gate 5 suite) |
| 13 | Layers / isolation / ghosting | GREEN | 164 live checks (Gate 7 suite) |
| 14 | Peel / dissection / explosion / reconstruction | GREEN | same suite |
| 15 | Labels render and track their structures | GREEN | 6 live checks, 5 unit tests |
| 16 | Load instrumentation | GREEN | 5 tests; the harness a real asset is measured with |
| 17 | Reset restores baseline | GREEN | idempotent, asserted twice over |
| 18 | Disposal and replacement | GREEN | no stale objects, no geometry growth |
| 19 | Mobile interaction | GREEN | 360 / 390 / 430, 51 live checks |
| 20 | Security boundary | GREEN | 30 live checks with a positive control |
| 21 | No credentials in storage, URL, cookies, HTML | GREEN | scanned on every anatomy surface |
| 22 | TypeScript / ESLint | PASS | 0 errors, 0 warnings |
| 23 | Unit tests | PASS | 500 passed / 500, 25 files |
| 24 | Production build | PASS | 20 routes |
| 25 | Full browser chain | PASS | 444 checks, 0 failures |
| 26 | Documentation | PASS | ARCHITECTURE.md §18, this file |

**Performance:** not measured. Measuring load time, time-to-interaction and
geometry counts against a diagnostic scene would produce numbers that say
nothing about a licensed asset. The instrumentation exists and is tested; the
numbers wait for the model.

---

## Completed

### Gate 9 — everything except the anatomy

Gate 8 built the pipeline. Gate 9 closed the gaps between that pipeline and a
real file arriving, and left the file itself as the only missing piece.

- **Asset ↔ manifest reconciliation** (`anatomy/mapping/reconciliation.ts`) —
  the check that runs when geometry actually arrives, as opposed to the offline
  one. A structure whose mesh is absent from the asset keeps its name, its
  parent and its context panel, and has nothing to show; the learner concludes
  it does not exist, or reads its label off the structure beside it. Nothing
  throws. The model is now refused instead, with the reason on screen.
- **Model version binding at load time** — the asset's own version stamp is
  carried from the loader to the reconciler, so geometry from one revision can
  never be labelled with another's names.
- **Binary glTF transport rehearsal** (`engine/3d/scene/gltf-transport.test.ts`)
  — the one link nothing had ever exercised. Gates 5–7 tested a scene built in
  memory; Gate 8 tested a stubbed network. This exports a real GLB, asserts its
  container is spec-conformant, parses it with the real loader, and puts the
  result through the real registry, bounds, material and disposal code. If that
  step were broken it would have been discovered on the day a licence arrived.
- **Progressive system and region loading** — a manifest may declare a separate
  asset per system and per region, and the provider now fetches them. A whole
  body is not one download; loading every system to look at the skeleton costs
  a learner minutes and a phone its memory.
- **Domain containment** — both providers refuse a manifest whose domain is not
  `anatomy`. The anatomy workspace shows anatomy; diagnostic content has its own
  labelled path and cannot arrive through this one.
- **Labels** — the Gate 6 foundation is now drawn, as selectable DOM over the
  canvas, off until asked for and bounded so a dense model stays readable. A
  label whose structure is hidden, dissected or peeled away disappears with it;
  a ghosted structure keeps its label, because it is still there.
- **Load instrumentation** (`engine/3d/diagnostics/load-metrics.ts`) — what a
  real asset will be measured with, built before one arrives so the numbers are
  recorded rather than reconstructed from impressions afterwards.

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

**Gate 9, blocked.** Every part of it that does not require the content is
finished. The remaining part requires a licensed anatomy source that does not
exist in this environment.

---

## Blocked

### The one blocker: a licensed anatomy source

Gate 9 cannot be completed from inside this repository. It needs anatomy, and
anatomy cannot be written — it is licensed, or commissioned, or it does not
exist. VEO does not generate it, and will not render a placeholder in its
place: a primitive standing in for an organ looks complete and teaches
something false, which is worse than an empty viewport that says why.

**Exact remaining external action.** One of:

| Route | What must be supplied | Then |
| --- | --- | --- |
| **Licensed GLB/GLTF asset set** | the assets, plus an authored VEO manifest per model, on a host | set `ANATOMY_ASSET_BASE_URL`; no code change |
| **Hosted anatomy API** | endpoint, credential, and the vendor's request shape | set `ANATOMY_PROVIDER_API_URL` / `_API_KEY`; one server-side adapter in `/api/anatomy` |
| **VEO-owned models** | commissioned geometry, plus authored manifests | same path as a licensed asset set; no code change |

In every case the manifest is the real work: mapping each vendor mesh onto a
permanent VEO identity, and authoring the descriptive content with its
citations. VEO refuses a manifest rather than filling one in, which is exactly
why that work cannot be automated away.

### Bringing up a licensed model

```bash
# 1. Validate before anything is served. --asset cross-checks mesh names and
#    the version stamp against the geometry itself.
npm run validate:anatomy -- ./models/heart/manifest.json --asset ./models/heart/heart.glb

# 2. Configure the server. Never NEXT_PUBLIC_ for a credential.
ANATOMY_PROVIDER=gltf-asset
ANATOMY_ASSET_BASE_URL=https://<licensed-host>
ANATOMY_LICENCE_HOLDER=<holder>
ANATOMY_LICENCE_EXPIRES_AT=<iso-date>

# 3. Prove the boundary still holds, then the pipeline end to end.
npm run verify && npm start &
npm run test:browser
```

On load the pipeline will, in order: fetch and validate the manifest, refuse a
foreign domain or provider, project it into the semantic graph, load the
binary asset, reconcile every mapped mesh against what actually arrived, refuse
a version mismatch, register the structures, and hand the result to the same
engine Gates 5–7 verified.

**Not blockers, simply unconfigured** (each reports itself in the UI): Supabase,
OpenAI, Stripe, OAuth providers.

---

## Tests run

| Command | Result |
| --- | --- |
| `npm run typecheck` | **PASS** — 0 errors |
| `npm run lint` | **PASS** — 0 errors, 0 warnings |
| `npm run test` | **PASS** — 500 passed / 500 total, 25 files |
| `npm run build` | **PASS** — 20 routes |
| `npm run validate:anatomy` | **PASS** — contract fixture valid |
| `npm run test:anatomy` | **PASS** — 30 live provider checks |
| `npm run test:spatial` | **PASS** — 164 live manipulation checks |
| `npm run test:semantics` | **PASS** — 80 live semantic checks |
| `npm run test:engine` | **PASS** — 54 live engine checks |
| `npm run test:ui` | **PASS** — 116 live UI checks |
| `npm run test:browser` | **PASS** — all five, 444 checks, 0 failures |

Gate 9 added 32 unit tests and 9 live checks.

### What has NOT been tested

Honesty about coverage matters more here than anywhere else in this file.

- **No anatomical geometry has been rendered**, so nothing about how a real
  model looks, frames, selects or performs has been verified.
- **Performance is unmeasured.** The instrumentation exists and is tested; the
  numbers require an asset.
- **The hosted provider has never spoken to a vendor.** It passes the
  conformance suite against a controlled fixture; the vendor-specific request
  shaping in the server route is unwritten because no vendor is chosen.
- **The GLB transport rehearsal is not an anatomy test.** It proves a real
  binary glTF parses and binds; it says nothing about a licensed model's
  structure, naming or scale.

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

## Issues found and fixed during Gate 9

Three real defects, all in code that would have failed on the day a licence
arrived.

1. **A mesh the manifest named and the asset lacked failed silently.** The
   registry recorded meshes it could not map, but nothing checked the reverse:
   a structure whose geometry was absent kept its name, its parent, its
   relationships and its context panel while having nothing to draw. It could
   be searched for and navigated to and never seen. Nothing threw.

   *Fixed* by reconciling the manifest against the asset that actually arrived,
   and refusing the model when they disagree. Ten tests, including the case
   where only some of a structure's meshes are missing — visible but wrong,
   which is a different fact from absent.

2. **The asset's own version stamp never reached the check that needed it.**
   `validate:anatomy --asset` compared versions offline, but at runtime the
   loader discarded `asset.extras` — three.js keeps it on the parsed result, and
   the scene is all the renderer sees. So geometry from one revision could be
   labelled with another revision's names, which looks exactly like working
   software.

   *Fixed* by stamping the version onto the loaded root and carrying it through
   to reconciliation.

3. **Turning labels on drew nothing.** Gate 6 seeded every label
   `visible: false` so a dense model would not be unreadable, and Gate 9 added
   a master switch for the same reason. Two gates for one intent meant the
   switch was inert.

   *Fixed* by keeping the switch, which is where the guarantee is actually
   enforced, and seeding labels as not-individually-suppressed. The Gate 6 test
   now asserts the property at that level rather than at the seed.

### Also hardened

- **Both providers now refuse a manifest whose domain is not `anatomy`.** The
  anatomy workspace shows anatomy; without this, any manifest could put
  non-anatomical structures in front of a learner there.
- **A declared part asset that the host does not have is an error**, not a
  viewport that mounts a 404 and renders nothing with no explanation.
- **The secret scan now covers** localStorage, sessionStorage, the URL, cookies
  and the server-rendered HTML, not only the script bundle.

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

**Supply a licensed anatomy source.** Nothing else in Gate 9 remains, and Gate
10 must not begin until Gate 9 is independently green.

See **Blocked** above for the three routes, what each requires, and the
bring-up procedure. Two of the three need no code at all.

Until then the product behaves exactly as it should with no content: `/explore`
renders no geometry, says why in words an operator can act on, and offers
nothing it cannot do.
