# VEO — Build Status

_Last updated: 2026-09-16_

---

## Current phase

**Phase 1 — Platform Foundation & Product Shell**

## Current gate

**Gate 2 — Premium Product Shell + Learning Workspace → GREEN (verified)**
**Gate 1 — Application Foundation → GREEN (no regression)**

Every criterion below was verified by executing the application, not by reading
the source. Live checks were run against a production build in a real browser.

| # | Gate 2 criterion | Status |
| --- | --- | --- |
| 1 | Landing page complete | GREEN |
| 2 | Login complete | GREEN |
| 3 | Signup complete | GREEN |
| 4 | Onboarding complete | GREEN |
| 5 | Dashboard complete | GREEN |
| 6 | Learn experience complete | GREEN |
| 7 | Explore experience complete | GREEN |
| 8 | Recall shell complete | GREEN |
| 9 | Library complete | GREEN |
| 10 | Settings complete | GREEN |
| 11 | Global navigation complete | GREEN |
| 12 | Mobile navigation complete | GREEN |
| 13 | Learning workspace implemented | GREEN |
| 14 | 3D viewport visually dominant | GREEN — measured at 3 breakpoints |
| 15 | Context panel implemented | GREEN |
| 16 | AI Study panel implemented | GREEN |
| 17 | Relationship UI implemented | GREEN |
| 18 | Loading states implemented | GREEN |
| 19 | Empty states implemented | GREEN |
| 20 | Error states implemented | GREEN |
| 21 | Responsive breakpoints verified | GREEN — 360/390/430/768/1024/1440 |
| 22 | Accessibility baseline verified | GREEN |
| 23 | TypeScript | PASS — 0 errors |
| 24 | ESLint | PASS — 0 errors, 0 warnings |
| 25 | Tests | PASS — 157/157 |
| 26 | Production build | PASS — 17 routes |
| 27 | Route verification | PASS — 14 routes, all 200 |
| 28 | No critical console/runtime errors | PASS — 0 across all routes |
| 29 | No fake anatomy | PASS — asserted in tests and at runtime |
| 30 | No fabricated data | PASS — asserted in tests and at runtime |
| 31 | Gate 1 remains GREEN | PASS — all Gate 1 tests still pass |

---

## Completed

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
| `npm run test` | **PASS** — 157 passed / 157 total, 14 files |
| `npm run build` | **PASS** — 17 routes |
| `npm run test:ui` | **PASS** — 116 live browser checks, 0 failures |

### Unit coverage by area

| File | Tests | Covers |
| --- | ---: | --- |
| `lib/semantic-id.test.ts` | 17 | parsing, hierarchy, normalisation |
| `engine/spatial/visual-state.test.ts` | 14 | precedence, isolation, ghosting, layers |
| `engine/3d/camera/camera-math.test.ts` | 12 | framing, FOV, aspect, easing |
| `anatomy/providers/gltf-anatomy-provider.test.ts` | 14 | full provider lifecycle |
| `anatomy/mapping/manifest.test.ts` | 9 | schema + integrity rules |
| `store/stores.test.ts` | 12 | all four stores |
| `lib/stripe/entitlements.test.ts` | 6 | tier mapping, lapse revocation |
| `components/ui/components.test.tsx` | 9 | base primitives + accessibility |
| `components/ui/primitives.test.tsx` | 18 | overlays, menu, tabs, tooltip, search |
| `components/workspace/workspace.test.tsx` | 21 | context panel, relationships, AI bar, toolbar, layers |
| `data/content.test.ts` | 11 | content-honesty guards |
| `config/navigation.test.ts` | 9 | nav structure and route protection |
| `types/database.test.ts` | 2 | Supabase schema type integrity |
| `tests/design-tokens.test.ts` | 3 | Tailwind v4 token correctness |

### Live browser verification (`npm run test:ui`)

Runs a production build in Chromium and asserts what source inspection cannot:

| Group | Checks |
| --- | ---: |
| Routes render, no console errors | 44 |
| Responsive breakpoints (6 sizes × 5 routes + nav) | 36 |
| 3D viewport is visually dominant | 6 |
| Navigation | 7 |
| Accessibility baseline | 9 |
| No fabricated content | 3 |
| **Total** | **116 passed, 0 failed** |

Breakpoints verified: **360, 390, 430, 768, 1024, 1440**. At every size: no
horizontal overflow, primary navigation visible, and on `/explore` the
workspace fills the screen without scrolling the page.

---

## Issues found and fixed during Gate 2

Six real defects, all caught by execution rather than review:

1. **Every colour utility in the application was emitting invalid CSS.**
   Tailwind v4 removed the v3 `bg-[--custom-var]` shorthand. Classes like
   `bg-[--color-accent]` still compiled, but emitted
   `background-color: --color-accent`, which browsers drop. There was no build
   error, lint error or type error — the interface simply rendered without most
   of its colour, inheriting from `body`. All 369 occurrences across 50 files
   were rewritten to Tailwind v4's generated theme utilities (`bg-accent`,
   `text-ink-muted`, `border-hairline`). Guarded by
   `src/tests/design-tokens.test.ts`.

2. **The Supabase typed client accepted no writes at all.** `Database` was
   declared with `interface`. TypeScript gives type aliases an implicit index
   signature but not interfaces, so the schema silently failed supabase-js's
   `Record<string, GenericTable>` constraint and every query builder's argument
   collapsed to `never`. This was a latent Gate 1 defect, invisible until Gate 2
   wrote the first row. Converted to type aliases; guarded by
   `src/types/database.test.ts`.

3. **Horizontal overflow on mobile (285px on `/dashboard`).** Grid and flex
   items default to `min-width: auto`, so a card was sized by its content's
   min-content rather than its column. Fixed systemically with `min-w-0` on
   `Card` and `Panel`, plus `whitespace-nowrap shrink-0` on `Badge` and a
   width-bounded description in the state components.

4. **The navigation rail rendered every destination twice**, hiding one copy
   with CSS — putting every link in the accessibility tree twice. Rewritten to
   render each link once with the label visually hidden below `xl`.

5. **The AI notice consumed a third of the mobile screen**, squeezing the
   viewport into a thumbnail and violating viewport dominance. Redesigned the
   study bar to a single compact row.

6. **A signed-out visitor saw a "?" avatar**, which reads as a broken image.
   Replaced with a "Sign in" affordance.

Also fixed: the Segmented control could not shrink and overflowed Settings at
360px; there was no favicon, producing a 404 on every page load.

### A deliberate decision recorded

`/explore` is intentionally **not** behind authentication. The workspace is
VEO's product demonstration, the landing page's "Explore VEO" call to action
must not hit a login wall, and it exposes no personal data. This is now
documented in `src/lib/supabase/middleware.ts` and asserted in
`src/config/navigation.test.ts` so it cannot change silently.

---

## Next action

**Gate 3.** Gate 2 is GREEN, so this gate is now open. Gate 2 deliberately
stopped short of: the recall algorithm, spaced repetition, tutor responses,
question and flashcard generation, dissection and exploded view, and licensed
anatomy asset integration.

Proposed Gate 3 scope, in order:

1. **Connect a Supabase project.** Apply both migrations, regenerate
   `src/types/database.ts` from the live schema, and verify RLS with a two-user
   test proving one account cannot read another's rows.
2. **Persist the learning loop.** Sessions on entering and leaving the
   workspace; notes and saved models from the context panel actions.
3. **Tutor responses.** Wire `AIStudyPanel` to a server route using the existing
   `LLMClient` abstraction and `buildTutorMessages` context builder.
4. **Recall generation and scheduling.** Question and flashcard generation, then
   the scheduler over `memory_states` — which already stores scheduler inputs
   rather than only a due date.
5. **Licensed anatomy asset integration.** *Blocked on licensing.*

**Decision still required from you:** the licensing route for anatomy content —
license an SDK, license a GLB/GLTF asset set, or commission VEO-owned models.
The provider layer supports all three; only the SDK path carries a code cost,
and the abstraction for it already exists.
