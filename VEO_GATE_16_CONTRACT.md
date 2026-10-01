# VEO — Gate 16 Contract

**Learner Notes & Knowledge Capture**

_Written before implementation, as the gate brief requires._

---

## 1. Objective

Give a learner somewhere to put what they work out, anchored to the structure
they worked it out about, and let them take it with them.

---

## 2. Why this capability was selected

The audit found the same defect shape Gates 14 and 15 each uncovered: a
complete piece of architecture, designed early, that nothing has ever called.

**Six of the nine entitlement keys have zero implementation** outside their own
declaration:

| Key | References outside the billing declaration |
| --- | --- |
| `material.upload` | 0 |
| `material.unlimited_uploads` | 0 |
| `export.notes` | 0 |
| `recall.advanced_scheduling` | 0 |
| `spatial.premium_models` | 0 |
| `spatial.unlimited_sessions` | 0 |

And the `notes` table has existed since Gate 1 — with `owner_id`, a
`spatial_object_id` constrained by `is_semantic_id()`, `title`, `body`, `tags`,
timestamps, two indexes and a full RLS quartet — and **has never been written
to by a single line of production code.** The Library's Notes tab is an empty
state with no backing data.

That is not a cosmetic gap. It is the one place in VEO where the learner
*produces* something rather than consuming it. Today VEO answers questions,
generates material and schedules reviews; the learner contributes nothing
durable of their own, and leaves with nothing.

### Why notes rather than uploads

`material.upload` is equally unimplemented and equally real, but it is a
larger, different capability: file storage, format detection, text extraction,
chunking and grounding. It is deliberately a **non-goal** here (§5).

Notes were chosen because they sit *inside* the architecture rather than
beside it. A note carries a semantic id, so it joins the semantic graph that
is VEO's spine: it surfaces when that structure is selected, rolls up through
`semanticIdAncestors` exactly as mastery does, and can be fed to the existing
Gate 11 generator as grounding. Uploads must first become text before they can
do any of that.

### Where it sits in the architecture

```
REAL LICENSED ANATOMY      (Gate 9 — RED, unchanged)
        ↓
ANATOMY PROVIDER           (Gate 8)
        ↓
SEMANTIC GRAPH             (Gate 6)  ← a note anchors here
        ↓
SPATIAL ENGINE             (Gates 5, 7)
        ↓
LEARNER INTERACTION        ← GATE 16 adds the learner's own output
        ↓
AI / LEARNING CONTENT      (Gates 10, 11) ← a note becomes grounding
        ↓
RECALL + MEMORY            (Gate 12) ← flashcards from a note enrol here
        ↓
ANALYTICS                  (Gate 13)
        ↓
ENTITLEMENTS               (Gate 14) ← `export.notes` finally means something
```

---

## 3. User problem solved

A learner selects the left ventricle, asks the tutor, reads the answer, works
something out — and has nowhere to put it. Next week the understanding is gone
and the only trace is a review score.

After Gate 16 they write it down where they are looking, find it again by
searching or by selecting that structure, and can export everything they have
written.

---

## 4. Scope

1. **Create, read, update, delete** a note. Identity from the session; never
   from the request.
2. **Anchor** a note to a semantic id and/or a model ref, both validated
   against the semantic-id grammar. Anchoring is optional — a general note is
   legitimate.
3. **Search** a learner's own notes by text and by anchor.
4. **Contextual retrieval**: notes for the selected structure, including notes
   on its ancestors, marked as inherited rather than silently merged.
5. **Export** every note, gated by the existing `export.notes` entitlement.
6. **Generate flashcards from a note** using the **existing** Gate 11 engine,
   with the note body as grounding. No second generator.
7. Notes surfaces in the workspace Context Panel and in the Library.

---

## 5. Non-goals

Explicitly out of scope, and why:

| Not doing | Why |
| --- | --- |
| File / material upload | A separate capability needing storage, extraction and chunking. `material.upload` stays unimplemented and is reported as such. |
| Rich text, images, audio | Plain text keeps the body usable as AI grounding and as export. Formatting is presentation, not capture. |
| Sharing or collaboration | Notes are private. Every RLS policy says so, and sharing would need a whole permission model. |
| Note versioning / history | Not needed to make the capability coherent. |
| A second search system | Search is scoped to the learner's own notes, in PostgreSQL. No index service. |
| Anything touching Gate 9 | A note anchors to a semantic id, which exists whether or not anatomy does. No anatomy is invented, inferred or fabricated. |

---

## 6. Existing systems reused

| System | Reused for |
| --- | --- |
| Supabase auth + `getServerUser` | identity, server-derived |
| RLS policies on `notes` (Gate 1) | ownership — already SELECT/INSERT/UPDATE/DELETE own |
| `SemanticId` + `semanticIdAncestors` (Gate 6) | anchoring and rollup |
| `resolveLearning` pattern (Gate 12) | the store seam and identity resolution |
| Gate 11 generation engine | flashcards from a note — **no new generator** |
| `requireEntitlement` (Gate 14) | the export gate |
| `rateLimit` (Gate 15) | abuse control, distinct from quota |
| `serverLog` / `withRequestId` (Gate 15) | structured logging, correlation ids |
| Design system (Gate 2) | every component |

---

## 7. New systems required

- `src/notes/` — pure note validation and normalisation (no I/O).
- `src/notes/server/` — the store seam and service, identity from session.
- `src/components/notes/` — UI.

No new AI client. No new scheduler. No new analytics. No new entitlement
system. No new auth.

---

## 8. Routes

| Route | Change |
| --- | --- |
| `/library` | Notes tab becomes real: list, search, export |
| `/explore` | Context Panel gains notes for the selected structure |

No new pages. Notes belong where the learner already is.

---

## 9. API endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/notes` | list / search own notes (`q`, `semanticId`, `limit`, `offset`) |
| `POST` | `/api/notes` | create |
| `PATCH` | `/api/notes/[id]` | update own note |
| `DELETE` | `/api/notes/[id]` | delete own note |
| `GET` | `/api/notes/export` | export all own notes — **gated by `export.notes`** |

Every one: 401 anonymous, 404-not-403 for another learner's note (see §12),
strict Zod validation, structured errors, rate limited.

---

## 10. Database changes

The `notes` table already exists with the right shape. Migration
`0005_notes_capture.sql` adds only what search and correctness require:

1. **A generated `fts` column, GIN-indexed.** _Revised during implementation:_
   the contract first said "no columns". A bare expression index would have
   been one fewer change, but PostgREST's full-text filter names a column, so
   an expression index means either an RPC wrapper or an ILIKE scan — and an
   ILIKE with a leading wildcard cannot use an index at all. The column is
   `generated always as (...) stored`, so no client can write it and it cannot
   drift from the title and body it derives from.
2. **Anchor index** — `(owner_id, spatial_object_id)` partial, matching the
   real predicate. Gate 1's index on `spatial_object_id` alone does not,
   because the query is always scoped by owner.
3. **Recency index** — `(owner_id, updated_at desc)` for the list view.
4. **Length and tag-count constraints** — bounds at the database, not only in
   Zod, so they hold for any writer that reaches the table.

**No `updated_at` trigger.** The contract anticipated needing one; Gate 1
already installs `set_updated_at` on `notes` in the same loop as every other
mutable table, so adding a second would fire twice.

**No policy change.** Gate 1 gave `notes` all four own-row policies and Gate
15's matrix verifies them.

Additive and rollback-safe: nothing is dropped, no policy changes, every
statement is guarded, and `fts` is derived — so a rollback cannot lose
anything a learner wrote.

---

## 11. Security requirements

- Identity from `auth.getUser()` on every path. **No endpoint accepts an owner
  id.**
- A note id from the URL is a *client-supplied identifier*, so it is validated
  as a UUID and every query is additionally scoped by `owner_id`. RLS would
  refuse anyway; the application must not have the option.
- **Another learner's note answers 404, not 403.** 403 confirms the id exists,
  which is an enumeration oracle.
- Rate limited under a new `notes.write` bucket — abuse control, never the
  product allowance.
- Export is entitlement-gated and the refusal says `plan_required`.
- Body and title bounded; tags bounded in count and length.
- No secrets, no stack traces, no provider messages in any response.
- Logs carry a correlation id and never a note body — a note is personal data.

---

## 12. AI requirements

Flashcards from a note use the **existing** `LLMClient` and the Gate 11
generation path. The note body is supplied as grounding material; the
generated content is schema-validated and content-validated by the existing
validators.

The AI **never** invents anatomical structures: a note's anchor is a semantic
id the learner selected, and generation is grounded in the note body and the
live semantic model, exactly as Gate 11 already enforces.

If no provider key is configured, this reports
`AI INTEGRATION VERIFIED BUT LIVE PROVIDER UNCONFIGURED` rather than claiming
live verification.

---

## 13. Entitlement requirements

| Capability | Entitlement | Behaviour |
| --- | --- | --- |
| Write / read / search notes | none | free for every signed-in learner |
| Export notes | `export.notes` | paid; refusal explains and links to `/plans` |
| Flashcards from a note | `ai.generate_flashcards` | the existing Gate 14 meter, unchanged |

Writing notes is deliberately unmetered. Charging somebody to record their own
understanding would be a bad product and a worse principle.

---

## 14. Acceptance criteria

Gate 16 is GREEN only when all of these hold, each verified by execution:

1. A note persists and survives a refresh.
2. Identity is server-derived; a supplied owner id changes nothing.
3. Another learner's note is unreachable by every verb, answering 404.
4. Anonymous access to every endpoint is 401.
5. Malformed input returns a structured 400 and writes nothing.
6. Search returns the learner's matching notes and nobody else's.
7. Contextual notes include ancestors, marked inherited.
8. Export is refused without the entitlement and succeeds with it.
9. The Notes tab and Context Panel show server state, never local state.
10. Six viewports: no overflow, no clipping, no console errors.
11. RLS verified on real PostgreSQL, including cross-user and concurrency.
12. Mutation testing catches every security-critical defect.
13. Gates 2–15 regress green; Gate 9 stays RED.
14. Typecheck, lint, build clean.

---

## 15. Browser tests

Driven in Chromium against a production build:

- create a note from the workspace with a structure selected, and from the
  Library with none
- refresh and confirm persistence
- edit and delete
- search, including a term that must match nothing
- the inherited-note case
- export refused without the entitlement, allowed with it
- anonymous and cross-user API rejection with no interception
- hostile input scanned for leaked internals

## 16. Mobile tests

360, 390, 430, 768, 1024, 1440. No horizontal overflow measured by scroll
displacement. The note editor and its save control reachable and unclipped at
every width; the delete confirmation on screen.

---

## 17. Performance requirements

| Measure | Budget |
| --- | --- |
| Note validation / normalisation (pure) | < 1 ms per call |
| Contextual note resolution over a large set | < 10 ms |
| Search query against real PostgreSQL | < 50 ms at 1,000 notes |

Measured by execution at realistic volume, not asserted from unit tests.

---

## 18. Regression requirements

Gates 2, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15 all re-run green. Gate 9 verified
still RED by request to `/api/anatomy`. No existing test weakened.

---

## 19. External dependencies

| Dependency | State | Effect on Gate 16 |
| --- | --- | --- |
| Licensed anatomy | **absent — Gate 9 RED** | none: a note anchors to a semantic id, which exists regardless |
| Supabase | required, unconfigured here | notes persist to real PostgreSQL in the RLS suite; the browser run uses the fixture auth server and intercepts data |
| OpenAI | unconfigured here | flashcards-from-a-note verified through the deterministic stub, reported as such |
| Stripe | unconfigured here | the export entitlement is resolved from the same resolver; no checkout involved |

Nothing here turns an absent dependency into a fake success.
