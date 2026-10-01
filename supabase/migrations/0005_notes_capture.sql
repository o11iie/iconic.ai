-- =============================================================================
-- VEO — Gate 16: notes capture
-- =============================================================================
-- The `notes` table has existed since Gate 1 with the right shape: owner_id
-- with a cascade, a spatial_object_id constrained by is_semantic_id(), title,
-- body, tags, timestamps, the set_updated_at trigger and a full RLS quartet.
-- Nothing had ever written to it.
--
-- So this migration adds no columns and changes no policy. It adds only what
-- Gate 16 needs that the original design could not have known:
--
--   1. a search index, because search over a sequential scan is not search;
--   2. a composite anchor index, because the real query is always scoped by
--      owner AND structure, never by structure alone;
--   3. length bounds at the DATABASE, so they hold for any writer rather than
--      only for the one that goes through Zod.
--
-- Every statement is additive and idempotent. Rolling back means dropping the
-- indexes, the generated column and the constraints; the generated column is
-- derived from `title` and `body`, so nothing a learner wrote lives only
-- there and a rollback cannot lose a note.
-- =============================================================================

-- --- 0. a helper, because a CHECK may not contain a subquery -----------------
--
-- Bounding every tag's length needs an aggregate over `unnest(tags)`, and
-- PostgreSQL refuses a subquery inside a CHECK constraint outright. The
-- supported way round it is an IMMUTABLE function, whose body may contain
-- what the constraint may not — exactly how Gate 1's `is_semantic_id()`
-- already backs the `spatial_object_id` check on this same table.
--
-- IMMUTABLE is required and is honest here: the result depends only on the
-- arguments, so the planner may cache it and a dump/restore revalidates it
-- identically.

create or replace function public.tags_within_length(tags text[], max_length integer)
returns boolean
language sql
immutable
as $$
  select coalesce(bool_and(char_length(t) <= max_length), true) from unnest(tags) as t;
$$;


-- --- 1. bounds, enforced where they cannot be bypassed ------------------------
--
-- Zod bounds the API. These bound the TABLE. A future importer, a backfill
-- script or a psql session reaches the table without passing through the API,
-- and "the application validates it" is not a constraint.
--
-- 20,000 characters is a long essay and far more than anybody writes about one
-- structure; it exists to stop a single row becoming a denial-of-service on
-- the learner's own list view, not to limit expression.

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'notes_body_length'
  ) then
    alter table public.notes
      add constraint notes_body_length check (char_length(body) <= 20000);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'notes_title_length'
  ) then
    alter table public.notes
      add constraint notes_title_length
      check (title is null or char_length(title) <= 200);
  end if;

  -- A tag array is unbounded by default, which makes it an unbounded write.
  if not exists (
    select 1 from pg_constraint where conname = 'notes_tags_bounded'
  ) then
    alter table public.notes
      add constraint notes_tags_bounded
      check (
        coalesce(array_length(tags, 1), 0) <= 12
        and public.tags_within_length(tags, 40)
      );
  end if;
end;
$$;


-- --- 2. search ---------------------------------------------------------------
--
-- A STORED generated column, indexed with GIN.
--
-- A bare expression index would have been one fewer schema change, but
-- PostgREST's full-text filter names a COLUMN, so searching through an
-- expression index would mean either an RPC wrapper or an ILIKE scan. An
-- ILIKE with a leading wildcard cannot use an index at all, which is a
-- sequential scan over every note a learner owns dressed up as search.
--
-- Weighted so a match in the title outranks one buried in a long body.
--
-- `english` is a stated limitation rather than an oversight: stemming is
-- language-specific and VEO has no per-learner language to key it from yet.
-- For a non-English note the column still tokenises on whitespace, so matches
-- are exact rather than stemmed — degraded, not broken, and honest until
-- there is a language setting to read.
--
-- Generated and stored, so it cannot drift from the row: there is no trigger
-- to forget and no writer that can set it to something else.

alter table public.notes
  add column if not exists fts tsvector
  generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(body, '')), 'B')
  ) stored;

create index if not exists notes_search_idx on public.notes using gin (fts);


-- --- 3. the anchor lookup ----------------------------------------------------
--
-- `notes_spatial_idx on (spatial_object_id)` already exists from Gate 1, but
-- the query VEO actually runs is "this learner's notes on this structure" —
-- never "everybody's notes on this structure", which RLS forbids anyway. A
-- composite index matching the real predicate lets the planner use one index
-- instead of intersecting two.
--
-- Partial, because a note with no anchor is a general note and is never found
-- this way.

create index if not exists notes_owner_anchor_idx
  on public.notes (owner_id, spatial_object_id)
  where spatial_object_id is not null;


-- --- 4. the list view --------------------------------------------------------
--
-- The Library lists a learner's notes newest first. Without this the planner
-- sorts the whole owner partition on every page load.

create index if not exists notes_owner_recent_idx
  on public.notes (owner_id, updated_at desc);


-- =============================================================================
-- Deliberately NOT here
-- =============================================================================
--
--   * No policy change. Gate 1 gave `notes` select/insert/update/delete scoped
--     to `owner_id = auth.uid()`, and Gate 15's matrix verifies all four. A
--     note is private, so nothing needs widening.
--
--   * No `set_updated_at` trigger. It already exists — Gate 1 installs it for
--     `notes` in the same loop as every other mutable table. Adding a second
--     one would fire twice.
--
--   * No writable column of any kind. `fts` is GENERATED, so no client can
--     set it and it can never disagree with the title and body it is derived
--     from.
--
--   * No owner-supplied timestamp column. `created_at` and `updated_at` both
--     default to `now()` on the server, and the trigger overwrites any
--     `updated_at` a client tries to send.
-- =============================================================================
