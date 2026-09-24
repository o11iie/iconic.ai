-- =============================================================================
-- Gate 14 — metered entitlement usage
-- =============================================================================
--
-- ## Why a new table
--
-- `Entitlement.limit` and `.usage` have existed since Gate 1 and have always
-- been null and 0, because nothing counted. Nothing could: an AI generation is
-- not persisted anywhere unless the learner chooses to enrol what it produced,
-- so there is no existing row to count. `learning_daily_activity` counts
-- completed REVIEWS — a different thing, and folding AI calls into it would
-- corrupt the streak, the daily goal and every analytics figure derived from
-- them.
--
-- So one table, as narrow as the question it answers: how many times has this
-- learner used this capability today.
--
-- ## Why per day rather than per month
--
-- A daily allowance resets while a learner still remembers wanting it, and it
-- caps the worst case a single account can cost in one go. A monthly quota
-- exhausted on the 3rd leaves somebody locked out for four weeks, which reads
-- as a broken product rather than a free tier.
-- =============================================================================

create table if not exists public.entitlement_usage (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,

  -- The capability being metered. Text rather than an enum: EntitlementKey is
  -- owned by the application and adding one must not require a migration.
  entitlement_key text not null check (length(entitlement_key) between 1 and 64),

  -- The learner's LOCAL date, supplied by the server from their stored
  -- timezone. Not `current_date`, which is the database's day: a learner in
  -- Auckland would otherwise have their allowance reset in the middle of their
  -- afternoon, and the reset would not line up with the daily goal or the
  -- streak, which Gate 12 already computes in local time.
  usage_date      date not null,

  used            integer not null default 0 check (used >= 0),

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  -- One row per learner, per capability, per day. This is also what makes the
  -- atomic increment below possible.
  unique (user_id, entitlement_key, usage_date)
);

create index if not exists entitlement_usage_lookup_idx
  on public.entitlement_usage (user_id, usage_date);

-- The same trigger function every other table uses, so `updated_at` means the
-- same thing here as it does everywhere else.
drop trigger if exists set_updated_at on public.entitlement_usage;
create trigger set_updated_at
  before update on public.entitlement_usage
  for each row execute function public.set_updated_at();


-- --- Row Level Security -------------------------------------------------------
--
-- A learner may READ their own usage, so the UI can show a real remaining
-- balance. They may not write it: a browser that could set `used` to zero
-- would have an unlimited free plan, and one that could set another learner's
-- to the limit could lock them out.
--
-- Every write goes through `consume_entitlement` below, which is SECURITY
-- DEFINER precisely so that no direct write policy has to exist.

alter table public.entitlement_usage enable row level security;

drop policy if exists "entitlement_usage_select_own" on public.entitlement_usage;
create policy "entitlement_usage_select_own" on public.entitlement_usage
  for select to authenticated using (user_id = (select auth.uid()));

-- Deliberately absent: insert, update and delete policies. See above.


-- =============================================================================
-- Atomic consumption
-- =============================================================================
--
-- Read-then-write in the application cannot enforce a limit. Two requests that
-- both read `used = 9` against a limit of 10 both believe they may proceed,
-- and the learner gets 11. The window is small and entirely reachable: a
-- double-tap, a retried fetch, two tabs.
--
-- So the check and the increment are one statement. `insert ... on conflict do
-- update` takes a row lock on the conflicting row, and the `where` clause on
-- the update is what refuses the eleventh caller — atomically, in the database,
-- with no application-side co-ordination at all.
--
-- SECURITY DEFINER because the table has no write policy. The function
-- therefore establishes the caller's identity ITSELF from auth.uid() rather
-- than accepting it as an argument: a definer function that took a user id
-- would let any authenticated caller spend, or refund, anybody's allowance.
-- =============================================================================

create or replace function public.consume_entitlement(
  p_entitlement_key text,
  p_usage_date      date,
  p_limit           integer
)
returns table (allowed boolean, used integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_used    integer;
begin
  if v_user_id is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  if p_entitlement_key is null or length(p_entitlement_key) not between 1 and 64 then
    raise exception 'invalid entitlement key' using errcode = '22023';
  end if;

  -- A null limit means unmetered. Still recorded, because usage is worth
  -- knowing for a paying learner too, but never refused.
  if p_limit is null then
    insert into public.entitlement_usage (user_id, entitlement_key, usage_date, used)
    values (v_user_id, p_entitlement_key, p_usage_date, 1)
    on conflict (user_id, entitlement_key, usage_date)
      do update set used = public.entitlement_usage.used + 1
    returning public.entitlement_usage.used into v_used;

    return query select true, v_used;
    return;
  end if;

  if p_limit < 0 then
    raise exception 'invalid limit' using errcode = '22023';
  end if;

  -- The whole enforcement, in one statement.
  --
  -- On conflict the row is locked, its current `used` re-read under that lock,
  -- and the increment applied only while it remains below the limit. A caller
  -- that loses the race matches no row, `v_used` stays null, and it is
  -- refused — without ever having incremented anything.
  insert into public.entitlement_usage (user_id, entitlement_key, usage_date, used)
  values (v_user_id, p_entitlement_key, p_usage_date, 1)
  on conflict (user_id, entitlement_key, usage_date)
    do update set used = public.entitlement_usage.used + 1
    where public.entitlement_usage.used < p_limit
  returning public.entitlement_usage.used into v_used;

  if v_used is null then
    -- Refused. Report what they have actually used, so the UI can say so.
    select eu.used into v_used
      from public.entitlement_usage eu
     where eu.user_id = v_user_id
       and eu.entitlement_key = p_entitlement_key
       and eu.usage_date = p_usage_date;

    return query select false, coalesce(v_used, 0);
    return;
  end if;

  return query select true, v_used;
end;
$$;

revoke all on function public.consume_entitlement(text, date, integer) from public;
grant execute on function public.consume_entitlement(text, date, integer) to authenticated;


-- =============================================================================
-- Subscriptions remain read-only to the client
-- =============================================================================
--
-- Gate 1 gave `subscriptions` a select policy and no write policy, so a
-- browser cannot grant itself a plan. Gate 14 does not add one. Writes arrive
-- only from the Stripe webhook, through the service role, after a signature
-- has been verified.
--
-- Stated here because it is the single most valuable property of this feature
-- and the easiest to undo by accident while adding "just one" convenience
-- policy.
