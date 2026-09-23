# VEO — Build Status

_Last updated: 2026-09-24_

---

## Current phase

**Phase 5 — Intelligence**

## Current gate

**Gate 13 — Learning Intelligence, Analytics & Adaptive Study Insights → GREEN**

**Gate 12 — Spaced Repetition, Recall Engine & Learning Memory → GREEN (no regression)**

**Gate 11 — AI Questions, Flashcards & Learning Content → GREEN (no regression)**

**Gate 10 — Contextual AI Tutor → GREEN (no regression)**

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

### Gate 13 in one line

VEO reports what a learner's own reviews show — and where they show nothing,
it says so rather than filling the gap with a plausible number.

**Gate 13 did not change Gate 9.** No anatomy was written, no fixture was
promoted to a catalogue, and `/api/anatomy` still reports
`configured: false, delivery: "none"` — checked by request during the browser
run, not assumed. The knowledge map and every recommendation report
`canViewInModel: false` because no model can be opened, and the 3D action is
omitted rather than offered and broken.

**Gate 14 was not started.** No billing, no plans, no entitlement gating, no
collaboration, no import pipeline.

#### What Gate 13 is

An analytical layer over Gate 12's data. It adds no second learning database,
no second scheduler and no second mastery formula: `itemMastery` and
`structureMastery` remain Gate 12's, and Gate 13 contributes only banding,
counting, period attribution and hierarchy rollup on top of what they return.

- **Deterministic.** The engine is pure — no clock, no environment, no network,
  no AI. The same snapshot and instant always produce the same figures, which
  is what makes a learner's dashboard checkable and what lets the browser
  assert values worked out by hand.
- **Traceable.** Every number descends from persisted review events. An
  impossible record is excluded *and counted*, so a real data problem stays
  visible rather than being absorbed into a slightly smaller denominator.
- **Explainable.** Every weak-area finding carries the evidence that produced
  it — reviews, lapses, recall, mastery, days overdue. "VEO thinks you're weak
  here" is not a finding.
- **Honest about absence.** Where nothing has been measured the value is
  `null`, never 0. A new account sees calls to action; it never sees "0%
  retention", which is a measurement and a false one.

#### What Gate 13 deliberately does NOT do

- The AI does not produce, alter or influence any metric. No module under
  `src/analytics` imports an AI provider, and nothing here calls a model.
- A client cannot name the learner, the time, a date range, a row limit or an
  ordering. It may name one thing: a period, from a closed set of four.
- No recommendation offers an action VEO cannot perform, and none names
  content the learner does not have.

### Gate 12 in one line

VEO decides when each thing comes back, from what the learner actually did —
and where they have done nothing, it says so instead of showing a zero.

**Gate 12 did not change Gate 9.** No anatomy was written, no fixture was
promoted to a catalogue, and `/api/anatomy` still reports
`configured: false, delivery: "none"` — checked by request, not by assumption.
No geometry of any kind was introduced; a test fails if anything under
`src/learning` or `src/components/recall` imports Three.js or names a
primitive. The recall surface labels structures by their semantic ids and
never invents a display name, because the name belongs to the loaded model.

**Gate 13 is now built on top of Gate 12 without altering its behaviour.** The
scheduler, queue, mastery formula and streak rules are untouched; analytics
reads them and adds nothing to them. One Gate 12 function was made faster —
see the performance note below — with its behaviour unchanged and its full
test suite still passing.

#### What Gate 12 is

A scheduler, a queue, a memory, and the surface that shows them.

- **Pure core.** `scheduler.ts`, `queue.ts`, `mastery.ts`, `streaks.ts` and
  `session.ts` have no I/O, no clock, no environment and no AI. A test fails if
  any of them reads `Date.now()`, `process.env` or `fetch`. That is what makes
  a learner's schedule reproducible: the same history and instant always give
  the same answer.
- **Server-authoritative.** `now` is minted once per request on the server.
  Every route schema is strict, so `userId`, `reviewedAt`, `dueAt`,
  `intervalDays` and the rest are fields a client *cannot express* rather than
  fields the server must remember to ignore.
- **Atomic.** One answer advances an item exactly once. Idempotency is a unique
  index; the read-advance-append-count sequence runs inside one PostgreSQL
  function under a row lock.
- **Honest.** Retention is `null`, not 0, until something has been measured.
  A streak requires a completed review — opening the app, viewing the
  dashboard and generating a flashcard are not studying.

#### What Gate 12 deliberately does NOT do

- It does not let the AI touch learning state. No module under `src/ai`
  imports the learning engine, can call `submitReview`, or names
  `LearningStore` — asserted, and the assertion is mutation-tested.
- It does not let the scheduler consult a model. A scheduler that did would
  give different answers for the same history on different days, which is
  indistinguishable from a bug.
- It does not let a client compute a schedule. Components may `import type`
  from the scheduler — erased at build, granting nothing — but a value import
  of the scheduler or a store fails a test.
- It does not offer an offline mode. See "Removed rather than repaired" below.

### Gate 11 in one line

VEO builds questions and flashcards about a selected structure from facts the
model actually supplies — and refuses, with a reason, when it cannot.

**Gate 11 did not change Gate 9.** No anatomy was written, no fixture was
promoted to a catalogue, and `/api/anatomy` still reports
`configured: false, delivery: "none"`.

**Gate 12 is now built on top of Gate 11 without altering it.** The generated
payload still carries no scheduling fields — the same test asserts it — because
scheduling belongs to the item VEO creates when content is *enrolled*, not to
the content itself.

### Gate 10 in one line

The tutor answers about the structure the learner has selected, using VEO's
own semantic model resolved on the server, and says plainly when that model
does not contain enough to answer.

**Gate 10 did not change Gate 9.** No anatomy was written, no fixture was
promoted to a catalogue, and `/api/anatomy` still reports
`configured: false, delivery: "none"`. The tutor is proved against clearly
labelled test content, which is the only honest way to prove it while the
licensed-anatomy dependency is outstanding.

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
| 20 | Security boundary | GREEN | 31 live checks, positive control + mutation test |
| 21 | No credentials in storage, URL, cookies, HTML | GREEN | scanned with a real secret in the server env; a planted leak was caught |
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

### Gate 11 — learning content

| # | Requirement | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Learning-content domain model | GREEN | objectives added to the EXISTING `learning.ts` |
| 2 | Question schemas | GREEN | discriminated union per kind |
| 3 | Flashcard schemas | GREEN | Zod, validated both ways |
| 4 | Objectives typed | GREEN | closed set of 6 |
| 5 | Difficulty typed | GREEN | reuses the platform's `DIFFICULTIES` |
| 6 | Education levels reuse platform types | GREEN | reuses `LEARNING_LEVELS`; no second enum |
| 7 | LearningContext derived server-side | GREEN | built on Gate 10's `SpatialContext` |
| 8 | Client cannot inject facts | GREEN | unit + browser: facts, context and prompt all ignored |
| 9 | Gate 10 LLMClient reused | GREEN | no second vendor client exists |
| 10 | Question generation | GREEN | 4 kinds, live |
| 11 | Flashcard generation | GREEN | front/reveal/back |
| 12 | Structured output validated | GREEN | schema, then content, then grounding |
| 13 | Grounding validated | GREEN | model claim capped at what VEO measured |
| 14 | Content consistency checks | GREEN | 12 deterministic rules |
| 15 | Duplicate detection | GREEN | normalised signature + token overlap |
| 16 | Generation limits | GREEN | 1–20, enforced server-side |
| 17 | Invalid semantic ids rejected | GREEN | shape AND membership |
| 18 | Invalid related ids rejected | GREEN | item dropped with a reason |
| 19 | Insufficient context handled honestly | GREEN | refusal, not a caveat |
| 20 | Quiz Me UI | GREEN | live |
| 21 | Flashcard UI | GREEN | live |
| 22 | Gate 12 NOT implemented | GREEN | asserted by test |
| 23 | Browser validation | GREEN | 94 checks |
| 24 | Mobile validation | GREEN | 1440 / 1024 / 768 / 430 / 390 / 360 |
| 25 | Security | GREEN | mutation-tested |
| 26 | Regression | GREEN | 535 prior-gate checks, 0 failures |

#### The decision that carries this gate

**Objective support is derived from the data, before the model is called.**

A structure with no description cannot support a DEFINE question; one with no
function cannot support FUNCTION. Asking a model anyway would get an answer —
plausible, fluent and invented — so VEO checks first and refuses with a
message naming what is missing. That check runs *before* the provider call,
which also means it costs nothing.

#### Why there is no separate learning fixture

Gate 11 reuses the Gate 10 tutor fixture rather than adding a second one. Its
variation is exactly what a content generator must be tested against — a
structure that can support DEFINE, one that cannot, and one that can support
nothing — and two near-identical fixtures drift apart, at which point a test
passing against one says nothing about the other.

#### What Gate 11 deliberately does NOT do

- No score, streak, or performance history, in state or in the payload.
- No scheduling, interval, due date, stability or retrievability.
- No persistence of generated content. It lives for the session.

A score kept in the content panel would be a learner's performance record in
component state: it would vanish on navigation and disagree with whatever the
real memory model later stores. The recall experience and the memory model
arrive together, in their own gates, or not at all.


### Gate 10 — contextual AI tutor

| # | Requirement | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Contextual AI architecture | GREEN | `src/ai/{context,tutor,safety,actions}` |
| 2 | TutorRequest typed and validated | GREEN | Zod; 6 rejection tests |
| 3 | SpatialContext deterministic and bounded | GREEN | byte-identical output test; 4 bounding tests |
| 4 | AI provider server-side | GREEN | `server-only`; no client-side call exists |
| 5 | OpenAI credential server-only | GREEN | scan + positive control + mutation test |
| 6 | Structured TutorResponse validated | GREEN | schema + grounding pass; 6 malformed-output tests |
| 7 | Tutor understands selected context | GREEN | answer carries real name, parent, relationships |
| 8 | AI Explain works | GREEN | live browser, panel reaches `success` |
| 9 | Follow-up questions work | GREEN | history passed and re-bounded server-side |
| 10 | Education levels work | GREEN | 4 levels, different guidance, different output |
| 11 | Related structures resolve via semantic id | GREEN | invented ids dropped; click drives selection |
| 12 | Spatial actions use SceneController | GREEN | dispatcher tests incl. undo still working |
| 13 | Unsupported actions rejected | GREEN | capability, id and layer rejection paths |
| 14 | Conversation bounded | GREEN | turn cap + char cap, enforced server-side |
| 15 | Prompt-injection defences | GREEN | fenced data, markers neutralised, both directions tested |
| 16 | Missing context handled honestly | GREEN | three grounding levels; over-claims downgraded |
| 17 | AI errors handled gracefully | GREEN | 8 failure codes, no upstream text surfaced |
| 18 | Context panel integration | GREEN | tutor under the structural facts |
| 19 | AI study bar integration | GREEN | 5 live modes, 2 later-gate modes disabled |
| 20 | Gate 11 NOT implemented | GREEN | `QUIZ` rejected by the server; dirs still empty |
| 21 | Controlled fixture proves it | GREEN | VEO AI TUTOR TEST FIXTURE, isolation asserted |
| 22 | Browser validation | GREEN | 89 checks |
| 23 | Mobile validation | GREEN | 1440 / 1024 / 768 / 430 / 390 / 360 |
| 24 | Security boundary | GREEN | mutation-tested |
| 25 | Regression suite | GREEN | 446 prior-gate checks, 0 failures |

#### What the tutor is NOT given

Stated because the boundary is the design:

- No geometry, no glTF, no three.js object, no renderer state.
- No graph from the browser. The server resolves a model REFERENCE, so a
  client cannot describe a structure into existence and have VEO explain it.
- No client-supplied system prompt, grounding policy, or capability claim.
  Capabilities sent by the browser are intersected with the model's own.

#### The verification stub

Gate 10's browser run uses a deterministic provider (`VEO_TUTOR_STUB=1`), not
a live model, because an assertion against a live model can say little more
than "text appeared" — which cannot distinguish a working tutor from a broken
one. The stub composes its reply from the context it was handed, so the
browser checks assert that the answer names the real structure, its real
parent and its real relationship targets. Every other stage is the production
path.

It requires the flag at BUILD time (Next inlines `process.env.X` and drops the
dead branch), and refuses to run when `OPENAI_API_KEY` is set, so it can never
shadow a configured provider. Every stub answer is marked in the response, in
the message, and by a banner in the workspace.


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
| `npm run test` | **PASS** — 1,077 passed / 1,077 total, 46 files |
| `npm run build` | **PASS** — 37 routes |
| `npm run validate:anatomy` | **PASS** — contract fixture valid |
| `npm run test:anatomy` | **PASS** — 32 live provider checks |
| `npm run test:spatial` | **PASS** — 164 live manipulation checks |
| `npm run test:semantics` | **PASS** — 80 live semantic checks |
| `npm run test:engine` | **PASS** — 54 live engine checks |
| `npm run test:ui` | **PASS** — 116 live UI checks |
| `npm run test:tutor` | **PASS** — 89 live tutor checks |
| `npm run test:learning` | **PASS** — 94 live content checks |
| `npm run test:browser` | **PASS** — all seven, 629 checks, 0 failures |
| `npm run verify:rls` | **PASS** — 46 checks on real PostgreSQL 16 |
| `npm run test:recall` | **PASS** — 118 live recall checks, 6 viewports |
| `npm run test:analytics` | **PASS** — 87 live analytics checks, 6 viewports |
| `npm run measure:analytics` | **PASS** — 213ms worst case against a 250ms budget |

Gate 13 added 135 unit tests, 9 database checks and 87 live browser checks.

### Gate 13's browser run asserts hand-computed values

The reference learner is deterministic and shared between the unit tests and
the browser harness, so both assert the same data:

| Structure | Reviews | Recalled | Retention |
| --- | --- | --- | --- |
| A (a question) | 10 | 8 | 80% |
| B (a flashcard) | 5 | 1 | 20% |
| C | 0 | — | untouched |
| **Total** | **15** | **9** | **60%** |

`scripts/analytics-fixture.mjs` generates the harness's fixture by running the
REAL engine over that learner, then checks its output against those constants
before writing anything. If the engine stops producing 60% from 9 of 15, it
refuses to emit a fixture rather than quietly moving the goalposts — a harness
that reimplemented the calculation could be wrong in the same way as the code
it tests, and both would agree.

The browser then asserts the figures ON SCREEN equal those values: 60%
retention, 15 reviews, a 10/5 question-flashcard split, 10 active days, 3
structures tracked. Switching to the 7-day window must show its own 11 reviews
and 55% — and a positive control asserts the two windows genuinely differ, so
the check can fail.

### Performance was measured, not asserted

`npm run measure:analytics` runs the engine at 100, 1,000 and 10,000 events
across three periods and exits non-zero above a 250ms budget. The first run
was **10,253ms** at the largest scale. See "Issues found" below — the cause was
`Intl.DateTimeFormat` construction, not a missing index, and no index was
added.

### Gate 12 ran against a real database, not a mock

PostgreSQL 16 is installed in this environment, so `scripts/verify-rls.sh`
applies the **real** migrations to a throwaway cluster and drives them as two
real users through a Supabase-compatible shim. It proves, by execution:

- an owner can read their own rows, and another user cannot read, forge,
  update or delete them;
- `review_events` resists even its owner — it has SELECT and INSERT policies
  and no others, so history is append-only;
- a duplicate idempotency key is refused by a unique index, and the same key
  is still free under a different learner;
- `submit_review` returns the first submission's result rather than erroring,
  advances the item exactly once, and counts the day once;
- a second active session per learner is impossible;
- RLS is enabled on all seven tables.

It carries a **negative control**: a deliberately unprotected table that the
harness must detect as exposed. Without it, a harness that had stopped working
would pass silently, which is the failure mode that matters.

### The recall surface was verified signed in, in a real browser

`/recall` sits behind authentication, and authentication is Supabase. Rather
than add an environment flag to VEO that fabricates a learner — an auth bypass
living in production code, which is the shape of mistake that ships — the
substitute lives in the harness: `scripts/fixture-auth-server.mjs` stands in
for Supabase Auth exactly as the anatomy fixture and tutor stub stand in for
their services. The browser carries the cookie `@supabase/ssr` writes, and
VEO's middleware and routes validate it through their normal path. No VEO
source is changed to make the tests pass.

The fixture implements **auth only** and answers 501 to data queries, so a UI
check cannot quietly pass against invented rows. What it does not cover is
covered by execution elsewhere: the API routes by 22 behavioural tests driving
the real exported handlers, the database by the 37 RLS checks above.

**Running the secret scan so that it means something.** In a bare environment
no `ANATOMY_*` variable is set, so the scan has no real value to hunt for and
three of its checks report only that there is nothing to leak. To exercise it
properly, put a credential in the *server's* environment for both the build and
the run:

```bash
export ANATOMY_PROVIDER_API_KEY='<any distinctive value>'
npm run build && npx next start -p 3410 &
npm run test:anatomy
```

A key on its own does not make the deployment `configured` — that needs a URL
too — so every other assertion in the suite still holds, while a leak of this
value would now be visible. This is the run that was mutation-tested.

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

## Issues found and fixed during Gate 13

### 1. Analytics was 40x over its performance budget

The first measured run took **10,253ms** at 10,000 events, and scaled
superlinearly — 42ms at 100 events, 572ms at 1,000. Nothing about reading the
code suggested it; the spec's instruction not to claim scalability without
measuring it is the only reason it was found.

Profiling rather than guessing located it: `localDate` constructed a fresh
`Intl.DateTimeFormat` on every call, which measured **60x slower** than reusing
one — 2,009ms against 33ms over 20,000 calls, with 98% of the cost in
construction alone.

It was invisible for the whole of Gate 12, because a learner has one streak and
the function was called a few dozen times. It became dominant the moment
analytics derived a local date for every review event across several passes.

Memoised per timezone, bounded at 200 entries, with the invalid-zone fallback
intact. Worst case is now **199ms**, a 51x improvement. All 38 Gate 12 streak
tests still pass, DST cases included, and two regression tests cover the risks
memoisation introduces: a cached formatter answering for the wrong timezone, or
freezing the offset in force when it was built. Removing the cache puts the
budget check back over at 10,898ms.

**No index was added.** The bottleneck was arithmetic in the application, not
the database, and an index would have been a fix aimed at the wrong layer.

### 2. /analytics was briefly reachable signed out

Adding Analytics to the primary navigation without adding it to
`PROTECTED_PREFIXES`. Learning analytics are private data — mastery, review
history, study time, streak — and the route had no auth gate for the length of
one commit.

Gate 2's navigation test caught it: it asserts that every personal surface is
protected, and it failed the moment the nav item existed. Fixed by protecting
the route, not by adjusting the test.

### 3. Retention's `change` could never be reported

`change` compared the last 20 reviews against everything earlier, which left
the earlier half **empty below 21 reviews**. No ordinary learner ever received a
comparison, and the minimum-sample guard beneath it was unreachable code.

Found by mutation testing: weakening the guard changed nothing, because nothing
reached it. Now split into halves by count, so both sides are equal by
construction and the guard's only job is to require that they are big enough.

### 4. Two strength tests passed for reasons unrelated to their names

Both derived their inputs from the very constants they were testing —
`ok(DETECTION.minReviewsForStrength - 1)` — so mutating a constant moved the
test with it. And in both cases mastery, not the rule under test, was doing the
rejecting: the assertions would have held with the rule deleted.

Rewritten with literal counts and a state that clears every other bar, so each
exercises exactly one rule. Both mutants are now caught.

### 5. The viewport check measured a navigation icon

The chart-height check selected `svg` by DOM order and measured the first one
on the page — a 19px nav icon — reporting a collapsed chart at every width. The
charts were fine; the harness was looking at the wrong element.

Fixed with an explicit `data-veo-chart` hook rather than DOM position, and
widened to assert every chart rather than one.

### 6. An RLS check ran against an insert that had failed

The analytics event insert omitted four NOT NULL columns and its error was
swallowed by a redirect, so the check ran against an empty table. The positive
control caught it — which is exactly what a positive control is for, and the
second time in two gates it has earned its place.

### Verified, not changed

- **A raw store error escaping to the client** looked like an uncovered
  mutation in the analytics boundary. It is inert: sanitisation lives one layer
  up in Gate 12's `withLearner`. Breaking that layer directly was confirmed to
  fail both suites.
- **The mastery band FAIL from the colour validator** is the categorical-palette
  check applied to a status palette. Status colours are reserved and are meant
  to differ in lightness; the validator's own scope note says so. The three real
  hues pass CVD separation, chroma and contrast, and every band ships with its
  name in text so nothing is encoded by colour alone.
- **Cyan and the strong-green sit at ΔE 12.1**, below the normal-vision floor.
  Rather than re-step VEO's brand hue, they are never used as distinct series in
  one chart: cyan is for single-series trends, green only for band indicators.

### Mutation testing

| Target | Mutants | Caught |
| --- | --- | --- |
| Metrics and periods | 10 | 10 (one after fixing a real design defect) |
| Detection and recommendations | 10 | 10 (two after fixing self-defeating tests) |
| Analytics security boundary | 6 | 5 outright; the 6th inert, with the real layer broken to confirm |
| Performance guard | 1 | 1 |

## Issues found and fixed during Gate 12

### 1. Structure banding compared a per-item threshold to a summed count

`MASTERY.difficultLapses` is documented as a **per-item** threshold: three
lapses on one item marks it difficult. But a structure's lapse count is the
**sum** across its items, and `band()` compared the two directly. The band
therefore scaled with how much content existed about a structure rather than
with how well it was known.

Concretely: twenty well-known items about one structure, each lapsed once
years ago and fully relearned, score 0.85 — and were branded "struggling",
permanently, for the offence of being well covered.

Found by a unit test whose *setup* would not produce the band I expected;
probing why showed the rule, not the test, was wrong. Now judged per item,
with regression tests in both directions — the well-covered structure reads
"strong", and one whose items each lapse three times still reads "struggling".

### 2. The session summary existed and was unreachable

Rating the last item in a session called `onFinished`, which refreshed the
dashboard, which replaced the review screen — unmounting the "Session
complete" summary the instant it rendered. A learner who finished a session
was thrown straight back to where they started with no acknowledgement that
they had done anything.

Both components were behaving exactly as written, so no unit test could have
seen it. The browser harness caught it on the first end-to-end run. Finishing
now prefetches the fresh dashboard quietly and the learner leaves when they
choose.

### 3. Enrolment filed items under a model they did not come from

`addToSchedule` recorded `activeModel`, but content is generated against
`tutorModelRef`. Those differ in diagnostic mode and whenever no model is
loaded — so items were filed under the wrong model, or under `null`. An item
with no model can never offer "View in 3D", which quietly severs a question
from the structure it is about.

Caught by a browser check asserting the enrolled item records *which* model it
came from, rather than merely that enrolment succeeded.

### 4. The first RLS test was vacuous

The minimal `auth.users` shim lacked `raw_user_meta_data`, so Gate 1's
`handle_new_user()` trigger failed, **no users were created**, and checks 2–13
passed only because there was no data to read. A green result meaning nothing.

Rebuilt the shim, added positive controls asserting two real users exist
before any isolation claim is made, and added a negative control: an
unprotected table the harness must detect as exposed.

### 5. An offline mode that could never work

`resolve-store.ts` had an env-flagged in-memory branch. A probe showed it could
never serve a request: the flag required Supabase to be **absent**, and without
Supabase `getServerUser()` has nothing to validate against, so every request
resolved to `unauthenticated`.

It was removed rather than repaired. Dead code shaped like a working offline
mode is worse than none, because the obvious way to "fix" it is to skip the
identity check — an auth bypass behind an environment variable. The in-memory
store remains as the test double it genuinely is, and a test now fails if
anything under `src/app` imports it.

### 6. A React effect used to reset derived state

Two components synced state in an effect, which renders the stale value once
before correcting it — in one case showing "In your schedule" over cards that
had never been added. Both now derive the value instead. A third had no
staleness guard on overlapping loads, so finishing a session while an earlier
refresh was in flight could let the older response land last and show a
dashboard from *before* the reviews.

### Verified, not changed

- **A yield inside the store's critical section** was caught by the
  concurrency test — but only once the mutation was placed correctly. Placed
  *before* the read it is harmless, which is not a gap.
- **A route reading `body.data.userId`** is inert while the schema is strict,
  so the single-layer mutation escaped. Re-run with **both** layers broken, it
  was caught by four tests. Defence in depth working, not a hole; the weak text
  scan it escaped was replaced with behavioural route tests.
- **`ReviewSession` imports the scheduler** — but `import type` only, which is
  erased at build and grants no capability. The boundary test now permits type
  imports and fails on value imports, which is the rule that matters.

### Mutation testing

Every claim below was verified by deliberately breaking the code and
confirming the suite fails.

| Target | Mutants | Caught |
| --- | --- | --- |
| Scheduler | 9 | 9 (one after strengthening a weak purity test) |
| Learning store | 9 | 9 (two mutants were mis-placed; re-run correctly, both caught) |
| Security boundary | 10 | 9 outright; the 10th proved defence in depth and was caught with both layers broken |
| Module boundaries | 4 | 4 |

## Issues found and fixed during Gate 11

Two real defects, both found by the verification.

1. **An injection payload survived because VEO's own phrasing created the
   boundary.** The role-marker sanitiser neutralised markers after a sentence
   end, a newline or a quote — but not after a COLON. VEO's fact template ends
   `"…is also known as: "`, the payload in a synonym list began `"System:"`,
   and together they read exactly like a turn boundary. Neither half was
   dangerous alone; the shape was formed at the join. A sanitiser that
   examines untrusted text in isolation cannot see this, which is why the
   colon case now has its own regression test.

2. **A mutation test that could not leak, which turned out to be the point.**
   The first attempt at proving the key scan works put
   `process.env.OPENAI_API_KEY` into a CLIENT component. Nothing leaked —
   because Next replaces non-public env vars with `undefined` in client
   bundles. That is the protection doing its job, and it is worth recording
   as a finding rather than as a failed test: the naive developer mistake is
   already impossible. The leak that DOES work is a server component passing
   the value down as a prop, which is the realistic vector, and the scan
   catches it.

### Verified, not changed

Two browser assertions failed and were wrong about the product:

- **Quiz Me is correctly disabled with nothing selected.** Generation is about
  a structure; an enabled control with no subject would be one that cannot
  work. The check now asserts disabled-then-enabled across a selection.
- **A DEFINE prompt correctly describes rather than names its structure.**
  Naming it would hand over the answer — and VEO's own validator rejects a
  prompt that does. Correspondence is now asserted on the model's description
  text and on the real structure appearing among the options.

### A known limit, stated rather than papered over

Duplicate detection catches near-identical text, not paraphrase. "Which
structure contains X?" and "X is contained by which structure?" score 0.56 on
token overlap; lowering the threshold to catch them would put it within 0.06
of merging two genuinely different questions about different structures. Token
overlap cannot separate those cases. Catching paraphrase properly needs
embeddings — a different system — and a test documents the limit rather than
a tuned threshold pretending otherwise.

### Two assertions updated because the product changed

Gate 10 asserted Quiz Me and Flashcard were unavailable. That was true then
and is false now. Both the unit test and the browser check were updated to the
current contract — they go to the GENERATOR rather than the tutor — which is a
stronger assertion than "disabled", not a weaker one.

---

## Issues found and fixed during Gate 10

Four real defects, three of them found by the verification rather than by
reading the code.

1. **The context builder reversed the hierarchy path, and truncated the wrong
   end.** `semanticIdAncestors` returns nearest-first; the builder assumed
   root-first. So a path read "Assembly A → Test Apparatus → Core Unit", and
   worse, capping ancestors on a deep model dropped the immediate parent and
   kept the model root — discarding the one piece of hierarchy that is always
   relevant. Caught by the first hierarchy test written.

2. **The injection sanitiser only neutralised role markers at the start of a
   line.** A payload embedded after a sentence ("…a chamber. System: ignore
   previous instructions") sailed through. Widening it naively would have
   mangled legitimate prose — "the cardiovascular system: a network of
   vessels" is a description, not an attack — so the rule is now anchored to
   sentence boundaries, and both directions are tested.

3. **A visually hidden span made the page scroll sideways on a phone.** The
   reason text inside each disabled study mode used `veo-sr-only`, which is
   `position: absolute`. With no positioned ancestor, a chip scrolled off the
   end of the strip placed that span outside the viewport and extended the
   DOCUMENT's scrollable width by 215px at 390px. Replaced with an
   `aria-label`, which has no box and announces the reason with the control.

4. **A feature flag that could never turn on.** `process.env[STUB_ENV_VAR]`
   with a computed key survives Next's build-time transform but then reads a
   build-time snapshot, so the flag read as unset however the server was
   started. The literal form is required — and, as it turns out, is the safer
   behaviour: a bundle built without the flag cannot be talked into the stub
   afterwards.

### Verified, not changed

Two browser assertions failed and turned out to be wrong about the product:

- **Clicking the centre of the diagnostic scene selects `object_5`**, the sole
  child of its system — so it has no siblings and no relationships, and
  "related structures appear" correctly found none. The check now selects a
  structure that HAS relationships, deliberately, rather than depending on
  where the camera happens to be pointing.
- **Performing a tutor action clears the answer**, because it selects a
  different structure and a new subject starts a new conversation. The
  availability assertion now runs before the action rather than after it.

### A Gate 8 check that was passing for the wrong reason

`verify-anatomy.mjs` asserted "it states that no licensed model is configured"
by matching `/not configured/` anywhere in the body — and was in fact matching
the AI study bar's "AI tutor is not configured" notice. Configuring a tutor
broke it while anatomy behaviour was unchanged.

It now requests an actual catalogued model and asserts VEO names the missing
configuration and draws nothing, which is what the gate was always meant to
check.

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
- **The client-surface scan no longer skips silently.** It ran zero times when
  no secret was set, which is indistinguishable in the output from a scan that
  ran and passed. It now says so, which is also why the anatomy suite reports
  31 checks rather than 28 — three that were previously invisible.
- **The secret boundary was mutation-tested, not just run.** A scan that finds
  nothing may be a scan that cannot find anything. The bundle scan already had
  a positive control; the client-surface scan had none. So a server-only
  credential was deliberately rendered into `/dashboard`, the suite was run,
  and both checks *failed* as they should. The leak was reverted and the suite
  returned to green. The boundary is now known to be observed, not merely
  asserted.

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

**Supply a licensed anatomy source.** It remains the one outstanding external
dependency, and Gate 9 stays RED until it arrives.

Gates 10, 11 and 12 proceeded because none of them depends on it: the tutor,
the content generator and the recall engine all consume VEO's normalised
semantic model, so the same code paths will serve licensed anatomy the day a
manifest exists, without modification. What they cannot claim — and do not —
is that any of them has ever handled a real anatomical structure.

Gate 12 is the least affected of the three. A scheduler does not care what an
item is about: the same engine that would schedule a question about the left
ventricle schedules one about benzene, a crankshaft or a main-sequence star,
and the aggregation rolls mastery up through semantic-id ancestry with nothing
anatomical hard-coded. Unit tests exercise it across anatomy, chemistry,
physics, engineering and astrophysics ids for exactly that reason.

Gate 13 is unaffected by it entirely. Analytics describes a learner's review
history, and a review is a review whether its subject is the left ventricle or
a benzene ring. The knowledge map builds from semantic ids with nothing
anatomical hard-coded, and unit tests exercise it across anatomy, chemistry,
physics, engineering and astrophysics ids for exactly that reason. What Gate 13
cannot do while Gate 9 is RED is open a structure in 3D — and it reports that
honestly per node rather than offering an action that would fail.

**A second, smaller external dependency now exists: a Supabase project.**
Gate 12's data lives in PostgreSQL behind Supabase Auth. In a bare environment
`/recall` says the learning schedule is not configured — the same thing every
other persisted feature says, and the truth. This is not a blocker in the way
anatomy is: the schema, its policies and the atomic scheduling function are all
verified by execution against real PostgreSQL 16, so what is missing is a
hosted instance, not code, and nothing needs to be written when one arrives.

See **Blocked** above for the three routes, what each requires, and the
bring-up procedure. Two of the three need no code at all.

Until then the product behaves exactly as it should with no content: `/explore`
renders no geometry, says why in words an operator can act on, and offers
nothing it cannot do.
