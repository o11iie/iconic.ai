# VEO — Build Status

_Last updated: 2026-09-16_

---

## Current phase

**Phase 3 — Core Spatial Engine**

## Current gate

**Gate 5 — Core Spatial / 3D Engine → GREEN (verified)**
**Gate 1 — Application Foundation → GREEN (no regression)**
**Gate 2 — Premium Product Shell → GREEN (no regression)**

Every criterion below was verified by driving the engine in a real browser and
reading its actual state — camera pose, GPU resource counts, registry contents,
selection and material state — not by inspecting source or the DOM.

| # | Gate 5 criterion | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Production R3F scene operational | GREEN | canvas initialises, GPU geometry live |
| 2 | Camera rig operational | GREEN | pose read from the running engine |
| 3 | Orbit operational | GREEN | drag moves camera, distance preserved |
| 4 | Pan operational | GREEN | right-drag moves the camera target |
| 5 | Zoom operational | GREEN | wheel changes distance, stays in limits |
| 6 | Reset operational | GREEN | target returns to model centre |
| 7 | Fit-to-model operational | GREEN | frames selectable content |
| 8 | Fit-to-selection operational | GREEN | reframes on the selected node |
| 9 | Model lifecycle operational | GREEN | 14 unit tests incl. generation guarding |
| 10 | Object registry operational | GREEN | 4 nodes registered from live scene |
| 11 | Semantic resolution operational | GREEN | nearest-ancestor rule, 12 unit tests |
| 12 | Pointer interaction operational | GREEN | click selects through real raycast |
| 13 | Selection operational | GREEN | exactly one selection at a time |
| 14 | Highlighting operational | GREEN | applies, clears, no residue |
| 15 | Visibility foundation operational | GREEN | visible/hidden/ghosted resolved |
| 16 | Scene disposal operational | GREEN | geometries, materials, textures freed |
| 17 | No known memory leak | GREEN | GPU geometry flat across 4 replacements |
| 18 | Mobile viewport verified | GREEN | 360/390/430/768, drag responds |
| 19 | Desktop viewport verified | GREEN | 1440, no overflow, no page scroll |
| 20 | WebGL/model error states verified | GREEN | unavailable + context-loss paths |
| 21 | No fake anatomy used | GREEN | asserted in tests and at runtime |
| 22 | Diagnostic scene clearly labelled | GREEN | on-screen label asserted in browser |
| 23 | Existing /explore preserved | GREEN | Gate 2 suite 116/116 |
| 24 | Gate 1 tests pass | GREEN | 92/92 |
| 25 | Gate 2 tests pass | GREEN | 73/73 |
| 26 | New Gate 5 tests pass | GREEN | 77 new unit tests |
| 27 | TypeScript | PASS | 0 errors |
| 28 | ESLint | PASS | 0 errors, 0 warnings |
| 29 | Production build | PASS | 18 routes |
| 30 | Live browser verification | PASS | 54 engine checks, 0 failures |
| 31 | No critical console errors | PASS | 0 across desktop and 4 mobile sizes |
| 32 | Documentation updated | PASS | ARCHITECTURE.md §15 |
| 33 | Git commit created | PASS | see history |

---

## Completed

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

Nothing. Gate 2 is closed.

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
| `npm run test` | **PASS** — 242 passed / 242 total, 18 files |
| `npm run build` | **PASS** — 18 routes |
| `npm run test:engine` | **PASS** — 54 live engine checks, 0 failures |
| `npm run test:ui` | **PASS** — 116 live UI checks, 0 failures |

### Gate 5 unit coverage

| File | Tests | Covers |
| --- | ---: | --- |
| `engine/spatial/object-registry.test.ts` | 12 | semantic resolution, nearest-ancestor rule, stale tags |
| `engine/spatial/model-lifecycle.test.ts` | 14 | every transition, generation guarding, terminal disposal |
| `engine/spatial/scene-controller.test.ts` | 20 | selection, visibility, isolation, replacement, camera intents |
| `engine/3d/engine.test.ts` | 31 | materials, disposal, renderer policy, pointer rules, bounds, diagnostic scene |
| `engine/3d/camera/camera-math.test.ts` | +8 | zoom limits, initial framing, box guards |

Totals: **242 unit tests across 18 files** (Gate 1: 92, Gate 2: 73, Gate 5: 77).

### Live engine verification (`npm run test:engine`)

Drives a production build in Chromium and reads engine state through a
diagnostic debug bridge, so each claim is about what the engine actually did:

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

## Blocked

**One external dependency, unchanged since Gate 1:**

- **Licensed anatomy assets are not available in this environment.** The
  engine, provider, manifest contract, registry, renderer, camera and disposal
  are complete and verified, but no licensed GLB/GLTF asset set is configured,
  so no subject geometry can be displayed.

  This is a **content/licensing blocker, not an engineering one**. VEO does not
  substitute procedurally generated geometry for licensed subject models. The
  GLTF loading path is implemented and unit-tested against a stubbed manifest;
  it has not been exercised against a real licensed asset because none exists.

  *To unblock:* publish a licensed asset set plus its `manifest.json` and set
  `NEXT_PUBLIC_SPATIAL_ASSET_BASE_URL`. No code change is required.

**Not blockers, simply unconfigured** (each reports itself in the UI): Supabase,
OpenAI, Stripe, OAuth providers.

---

## Next action

**Gate 6.** Gate 5 is GREEN, so this gate is now open. Gate 5 deliberately
stopped short of: AI tutoring, active recall, spaced repetition, dissection and
exploded view, and licensed anatomy asset integration.

To run the engine verification locally:

```bash
# The diagnostic scene is gated; enable it for engineering verification only.
echo 'NEXT_PUBLIC_ENABLE_PIPELINE_DIAGNOSTIC=true' >> .env.local
npm run build && npm start &
npm run test:engine
```

**Decision still required from you:** the licensing route for subject content —
license an SDK, license a GLB/GLTF asset set, or commission VEO-owned models.
The provider layer supports all three; only the SDK path carries a code cost,
and the abstraction for it already exists. This is now the critical path: the
engine is complete and every remaining gate builds on content it cannot yet
display.
