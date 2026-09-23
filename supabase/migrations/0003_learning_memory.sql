-- =============================================================================
-- VEO — Learning memory and spaced repetition
-- =============================================================================
-- Gate 12. The persistent half of the recall engine.
--
-- Design notes
--   * The SCHEDULER lives in TypeScript, not here. This schema stores its
--     inputs and outputs; it does not compute intervals. One implementation of
--     the algorithm, in one place, testable without a database.
--   * Review submission is IDEMPOTENT via a client-minted idempotency key with
--     a unique index. A retried request finds the existing event and returns
--     it rather than advancing the item twice.
--   * Scheduling advances under a row lock, so two concurrent submissions for
--     the same item serialise rather than interleave.
--   * Every table is per-user and RLS-protected. `user_id` is never taken from
--     a request body; it is derived from `auth.uid()`, and the policies below
--     make that structural rather than a convention someone can forget.
--   * Semantic ids are TEXT with a format guard, matching the core schema:
--     learning content must survive an asset vendor change.
-- =============================================================================


-- --- learning items -----------------------------------------------------------
-- A schedulable unit. Domain-agnostic: it references generated content and,
-- where applicable, a semantic structure — never anatomy specifically.

create table if not exists public.learning_items (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,

  -- What this item asks. `content_ref` is the generated item's stable key.
  content_ref  text not null,
  content_type text not null check (content_type in ('question','flashcard')),

  -- The structure it is about, when it is about one. Nullable because a
  -- learning item need not be spatial — a definition question about a concept
  -- is perfectly schedulable without a mesh behind it.
  semantic_id  text check (semantic_id is null or public.is_semantic_id(semantic_id)),
  -- Which model that structure belongs to, so a stale id can be detected when
  -- the learner is looking at a different model.
  model_ref    text,

  -- A denormalised copy of what the learner sees, so a review can be shown
  -- without re-running generation. Generated content is not reproducible: the
  -- same prompt yields different text, so the item must carry its own.
  payload      jsonb not null default '{}'::jsonb,

  objective    text,
  difficulty   text check (difficulty is null or difficulty in ('easy','medium','hard')),

  created_at   timestamptz not null default now(),
  archived_at  timestamptz,

  -- One item per piece of content per learner.
  unique (user_id, content_ref)
);

create index if not exists learning_items_user_idx
  on public.learning_items (user_id) where archived_at is null;
create index if not exists learning_items_semantic_idx
  on public.learning_items (user_id, semantic_id) where semantic_id is not null;


-- --- review states ------------------------------------------------------------
-- The scheduler's state for one item. Exactly one row per item.

create table if not exists public.review_states (
  item_id          uuid primary key references public.learning_items (id) on delete cascade,
  user_id          uuid not null references auth.users (id) on delete cascade,

  phase            text not null default 'new'
                     check (phase in ('new','learning','review','relearning','suspended')),
  -- Scheduler inputs, stored rather than only a due date, so the algorithm can
  -- be improved later without discarding a learner's history.
  stability        double precision not null default 0 check (stability >= 0),
  difficulty       double precision not null default 0.3
                     check (difficulty >= 0 and difficulty <= 1),
  repetitions      integer not null default 0 check (repetitions >= 0),
  lapses           integer not null default 0 check (lapses >= 0),
  step             integer not null default 0 check (step >= 0),
  interval_days    double precision not null default 0 check (interval_days >= 0),

  due_at           timestamptz not null default now(),
  last_reviewed_at timestamptz,

  -- Bumped on every scheduling advance. A caller holding a stale version knows
  -- its view is behind.
  version          integer not null default 0,
  updated_at       timestamptz not null default now()
);

-- The queue's access pattern: this user's items, soonest due first.
create index if not exists review_states_due_idx
  on public.review_states (user_id, due_at)
  where phase <> 'suspended';

create index if not exists review_states_phase_idx
  on public.review_states (user_id, phase);


-- --- review events ------------------------------------------------------------
-- The append-only record. Every scheduling decision VEO has ever made, with
-- the state before and after, so any number on a dashboard can be traced back.

create table if not exists public.review_events (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users (id) on delete cascade,
  item_id           uuid not null references public.learning_items (id) on delete cascade,
  session_id        uuid,

  semantic_id       text check (semantic_id is null or public.is_semantic_id(semantic_id)),
  content_ref       text not null,

  rating            text not null check (rating in ('again','hard','good','easy')),
  -- Whether the learner's typed or chosen answer matched, where that is
  -- knowable. Distinct from `rating`, which is their own assessment.
  correct           boolean,
  response_ms       integer not null default 0 check (response_ms >= 0),

  -- Before.
  previous_phase    text not null,
  previous_interval double precision not null default 0,
  previous_due_at   timestamptz,
  -- After.
  next_phase        text not null,
  next_interval     double precision not null default 0,
  next_due_at       timestamptz not null,
  repetitions       integer not null default 0,
  lapses            integer not null default 0,

  elapsed_days      double precision,
  retrievability    double precision
                      check (retrievability is null
                             or (retrievability >= 0 and retrievability <= 1)),

  -- SERVER time. Never the client's clock: a device with a wrong date would
  -- otherwise be able to schedule itself into next year, or claim a streak.
  reviewed_at       timestamptz not null default now(),

  -- Idempotency. A retried submission collides here and is answered from the
  -- existing row instead of advancing the item a second time.
  idempotency_key   text not null
);

create unique index if not exists review_events_idempotency_idx
  on public.review_events (user_id, idempotency_key);

create index if not exists review_events_user_time_idx
  on public.review_events (user_id, reviewed_at desc);
create index if not exists review_events_item_idx
  on public.review_events (item_id, reviewed_at desc);
create index if not exists review_events_semantic_idx
  on public.review_events (user_id, semantic_id) where semantic_id is not null;


-- --- review sessions ----------------------------------------------------------

create table if not exists public.review_sessions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,

  status          text not null default 'active'
                    check (status in ('active','completed','abandoned')),
  started_at      timestamptz not null default now(),
  ended_at        timestamptz,

  planned_count   integer not null default 0 check (planned_count >= 0),
  completed_count integer not null default 0 check (completed_count >= 0),
  correct_count   integer not null default 0 check (correct_count >= 0),
  -- Derived on completion from server timestamps, not reported by the client.
  duration_seconds integer check (duration_seconds is null or duration_seconds >= 0),

  metadata        jsonb not null default '{}'::jsonb
);

create index if not exists review_sessions_user_idx
  on public.review_sessions (user_id, started_at desc);
-- A learner has at most one session in flight; a refresh rejoins it rather
-- than starting a second.
create unique index if not exists review_sessions_one_active_idx
  on public.review_sessions (user_id) where status = 'active';


-- --- review session items -----------------------------------------------------
-- The planned queue for a session, frozen at start so a refresh resumes the
-- same list in the same order rather than re-deriving a different one.

create table if not exists public.review_session_items (
  session_id  uuid not null references public.review_sessions (id) on delete cascade,
  item_id     uuid not null references public.learning_items (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  position    integer not null check (position >= 0),
  answered_at timestamptz,
  rating      text check (rating is null or rating in ('again','hard','good','easy')),

  primary key (session_id, item_id)
);

create index if not exists review_session_items_order_idx
  on public.review_session_items (session_id, position);


-- --- daily activity -----------------------------------------------------------
-- One row per learner per LOCAL calendar day. The streak's only source.
--
-- `activity_date` is a date in the learner's timezone, computed server-side
-- when the review is recorded. Storing the local date rather than deriving it
-- later is what makes a streak stable when someone travels.

create table if not exists public.learning_daily_activity (
  user_id          uuid not null references auth.users (id) on delete cascade,
  activity_date    date not null,
  time_zone        text not null default 'UTC',
  reviews_completed integer not null default 0 check (reviews_completed >= 0),
  seconds_studied  integer not null default 0 check (seconds_studied >= 0),
  items_learned    integer not null default 0 check (items_learned >= 0),
  updated_at       timestamptz not null default now(),

  primary key (user_id, activity_date)
);

create index if not exists learning_daily_activity_recent_idx
  on public.learning_daily_activity (user_id, activity_date desc);


-- --- goals --------------------------------------------------------------------

create table if not exists public.learning_goals (
  user_id            uuid primary key references auth.users (id) on delete cascade,
  daily_review_target integer not null default 20
                        check (daily_review_target >= 1 and daily_review_target <= 500),
  time_zone          text not null default 'UTC',
  updated_at         timestamptz not null default now()
);


-- --- updated_at triggers ------------------------------------------------------

drop trigger if exists review_states_updated_at on public.review_states;
create trigger review_states_updated_at
  before update on public.review_states
  for each row execute function public.set_updated_at();

drop trigger if exists learning_goals_updated_at on public.learning_goals;
create trigger learning_goals_updated_at
  before update on public.learning_goals
  for each row execute function public.set_updated_at();

drop trigger if exists learning_daily_activity_updated_at on public.learning_daily_activity;
create trigger learning_daily_activity_updated_at
  before update on public.learning_daily_activity
  for each row execute function public.set_updated_at();


-- =============================================================================
-- Row Level Security
-- =============================================================================
-- Every table here is OWNED: rows belong to one learner and nobody else may
-- read or write them. The default is deny — RLS on with no matching policy
-- returns nothing.
--
-- `with check (user_id = auth.uid())` on insert is the load-bearing clause: it
-- makes it impossible to write a row attributed to another user even if a
-- request body says otherwise. The server never has to remember to check.
-- =============================================================================

alter table public.learning_items           enable row level security;
alter table public.review_states            enable row level security;
alter table public.review_events            enable row level security;
alter table public.review_sessions          enable row level security;
alter table public.review_session_items     enable row level security;
alter table public.learning_daily_activity  enable row level security;
alter table public.learning_goals           enable row level security;

-- learning_items
drop policy if exists "learning_items_select_own" on public.learning_items;
create policy "learning_items_select_own" on public.learning_items
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists "learning_items_insert_own" on public.learning_items;
create policy "learning_items_insert_own" on public.learning_items
  for insert to authenticated with check (user_id = (select auth.uid()));

drop policy if exists "learning_items_update_own" on public.learning_items;
create policy "learning_items_update_own" on public.learning_items
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "learning_items_delete_own" on public.learning_items;
create policy "learning_items_delete_own" on public.learning_items
  for delete to authenticated using (user_id = (select auth.uid()));

-- review_states
drop policy if exists "review_states_select_own" on public.review_states;
create policy "review_states_select_own" on public.review_states
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists "review_states_insert_own" on public.review_states;
create policy "review_states_insert_own" on public.review_states
  for insert to authenticated with check (user_id = (select auth.uid()));

drop policy if exists "review_states_update_own" on public.review_states;
create policy "review_states_update_own" on public.review_states
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- review_events: insert and read only. An audit trail nobody may rewrite —
-- there is deliberately no update or delete policy, so a learner cannot edit
-- their own history into a better one.
drop policy if exists "review_events_select_own" on public.review_events;
create policy "review_events_select_own" on public.review_events
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists "review_events_insert_own" on public.review_events;
create policy "review_events_insert_own" on public.review_events
  for insert to authenticated with check (user_id = (select auth.uid()));

-- review_sessions
drop policy if exists "review_sessions_select_own" on public.review_sessions;
create policy "review_sessions_select_own" on public.review_sessions
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists "review_sessions_insert_own" on public.review_sessions;
create policy "review_sessions_insert_own" on public.review_sessions
  for insert to authenticated with check (user_id = (select auth.uid()));

drop policy if exists "review_sessions_update_own" on public.review_sessions;
create policy "review_sessions_update_own" on public.review_sessions
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- review_session_items
drop policy if exists "review_session_items_select_own" on public.review_session_items;
create policy "review_session_items_select_own" on public.review_session_items
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists "review_session_items_insert_own" on public.review_session_items;
create policy "review_session_items_insert_own" on public.review_session_items
  for insert to authenticated with check (user_id = (select auth.uid()));

drop policy if exists "review_session_items_update_own" on public.review_session_items;
create policy "review_session_items_update_own" on public.review_session_items
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- learning_daily_activity
drop policy if exists "learning_daily_activity_select_own" on public.learning_daily_activity;
create policy "learning_daily_activity_select_own" on public.learning_daily_activity
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists "learning_daily_activity_insert_own" on public.learning_daily_activity;
create policy "learning_daily_activity_insert_own" on public.learning_daily_activity
  for insert to authenticated with check (user_id = (select auth.uid()));

drop policy if exists "learning_daily_activity_update_own" on public.learning_daily_activity;
create policy "learning_daily_activity_update_own" on public.learning_daily_activity
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- learning_goals
drop policy if exists "learning_goals_select_own" on public.learning_goals;
create policy "learning_goals_select_own" on public.learning_goals
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists "learning_goals_insert_own" on public.learning_goals;
create policy "learning_goals_insert_own" on public.learning_goals
  for insert to authenticated with check (user_id = (select auth.uid()));

drop policy if exists "learning_goals_update_own" on public.learning_goals;
create policy "learning_goals_update_own" on public.learning_goals
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));


-- =============================================================================
-- submit_review — the atomic scheduling advance
-- =============================================================================
-- Everything a single answer changes, in one transaction:
--
--   1. dedupe on the idempotency key
--   2. lock the item's review state
--   3. write the next state
--   4. append the review event
--   5. mark the session item answered and bump the session counters
--   6. increment the learner's local-day activity
--
-- Split across round trips, two taps on a phone read the same state twice and
-- write the same interval twice — the item advances once and is recorded
-- twice, or advances twice from one answer. Neither is recoverable, because
-- the history that would let you tell is what got corrupted.
--
-- The SCHEDULER is not here. This function is handed the next state, already
-- computed by the one implementation of the algorithm in TypeScript. Two
-- implementations would drift, and the drift would only show up as a learner
-- seeing different due dates on different devices.
--
-- SECURITY INVOKER (the default) so RLS applies: the function can only touch
-- rows the calling user already owns, and cannot be used to reach around the
-- policies.
-- =============================================================================

create or replace function public.submit_review(
  p_item_id           uuid,
  p_session_id        uuid,
  p_rating            text,
  p_correct           boolean,
  p_response_ms       integer,
  p_idempotency_key   text,
  p_previous_phase    text,
  p_previous_interval double precision,
  p_previous_due_at   timestamptz,
  p_next_phase        text,
  p_next_stability    double precision,
  p_next_difficulty   double precision,
  p_next_repetitions  integer,
  p_next_lapses       integer,
  p_next_step         integer,
  p_next_interval     double precision,
  p_next_due_at       timestamptz,
  p_elapsed_days      double precision,
  p_retrievability    double precision,
  p_time_zone         text,
  p_activity_date     date
)
returns table (event_id uuid, deduplicated boolean, state public.review_states)
language plpgsql
as $$
declare
  v_user_id     uuid := auth.uid();
  v_existing    public.review_events%rowtype;
  v_state       public.review_states%rowtype;
  v_event_id    uuid;
  v_content_ref text;
  v_semantic_id text;
begin
  if v_user_id is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  -- 1. Idempotency. A retried submission returns what the first one produced
  --    rather than advancing the item a second time.
  select * into v_existing
    from public.review_events
   where user_id = v_user_id and idempotency_key = p_idempotency_key
   limit 1;

  if found then
    select * into v_state from public.review_states where item_id = v_existing.item_id;
    return query select v_existing.id, true, v_state;
    return;
  end if;

  -- 2. Lock the state row. A concurrent submission for the same item waits
  --    here rather than reading a value that is about to change.
  select * into v_state
    from public.review_states
   where item_id = p_item_id and user_id = v_user_id
   for update;

  if not found then
    raise exception 'unknown item' using errcode = 'P0002';
  end if;

  select content_ref, semantic_id into v_content_ref, v_semantic_id
    from public.learning_items
   where id = p_item_id and user_id = v_user_id;

  -- 3. Write the next state.
  update public.review_states
     set phase            = p_next_phase,
         stability        = greatest(0, p_next_stability),
         difficulty       = least(1, greatest(0, p_next_difficulty)),
         repetitions      = greatest(0, p_next_repetitions),
         lapses           = greatest(0, p_next_lapses),
         step             = greatest(0, p_next_step),
         interval_days    = greatest(0, p_next_interval),
         due_at           = p_next_due_at,
         last_reviewed_at = now(),
         version          = version + 1
   where item_id = p_item_id and user_id = v_user_id
   returning * into v_state;

  -- 4. Append the event. `reviewed_at` defaults to now() — SERVER time, so a
  --    device with a wrong clock cannot schedule itself into next year or
  --    manufacture a streak.
  insert into public.review_events (
    user_id, item_id, session_id, semantic_id, content_ref,
    rating, correct, response_ms,
    previous_phase, previous_interval, previous_due_at,
    next_phase, next_interval, next_due_at, repetitions, lapses,
    elapsed_days, retrievability, idempotency_key
  ) values (
    v_user_id, p_item_id, p_session_id, v_semantic_id, coalesce(v_content_ref, ''),
    p_rating, p_correct, greatest(0, coalesce(p_response_ms, 0)),
    p_previous_phase, greatest(0, coalesce(p_previous_interval, 0)), p_previous_due_at,
    p_next_phase, greatest(0, p_next_interval), p_next_due_at,
    greatest(0, p_next_repetitions), greatest(0, p_next_lapses),
    p_elapsed_days, p_retrievability, p_idempotency_key
  )
  returning id into v_event_id;

  -- 5. Session progress.
  if p_session_id is not null then
    update public.review_session_items
       set answered_at = now(), rating = p_rating
     where session_id = p_session_id and item_id = p_item_id and user_id = v_user_id;

    update public.review_sessions
       set completed_count = completed_count + 1,
           correct_count   = correct_count + (case when p_correct then 1 else 0 end)
     where id = p_session_id and user_id = v_user_id and status = 'active';
  end if;

  -- 6. Daily activity, keyed by the learner's LOCAL date so a streak survives
  --    travel and daylight saving.
  insert into public.learning_daily_activity (
    user_id, activity_date, time_zone, reviews_completed, seconds_studied
  ) values (
    v_user_id, p_activity_date, coalesce(nullif(p_time_zone, ''), 'UTC'), 1,
    greatest(0, coalesce(p_response_ms, 0)) / 1000
  )
  on conflict (user_id, activity_date) do update
    set reviews_completed = public.learning_daily_activity.reviews_completed + 1,
        seconds_studied   = public.learning_daily_activity.seconds_studied
                            + greatest(0, coalesce(p_response_ms, 0)) / 1000,
        time_zone         = coalesce(nullif(p_time_zone, ''), public.learning_daily_activity.time_zone);

  return query select v_event_id, false, v_state;
end;
$$;

revoke all on function public.submit_review from public;
grant execute on function public.submit_review to authenticated;
