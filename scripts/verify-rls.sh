#!/usr/bin/env bash
# =============================================================================
# VEO — Row Level Security verification against a REAL PostgreSQL
# =============================================================================
# Applies the actual migrations to a throwaway database and proves, by
# execution, that one learner cannot read, write, forge or delete another's
# learning data.
#
# Why this exists as a script rather than a claim:
#
#   RLS is the one security control in VEO that cannot be checked by reading
#   TypeScript. The policies live in SQL, they are enforced by Postgres, and
#   the only way to know they work is to connect as two different users and
#   try. A migration that enables RLS but forgets a policy looks identical in
#   review to one that gets it right — and fails open in exactly the direction
#   that matters.
#
# Every "must be 0" assertion is paired with a POSITIVE CONTROL showing the
# owner CAN see their own row. Without that pairing, an empty result proves
# nothing: a query returning nothing because the table is empty and a query
# returning nothing because RLS blocked it are indistinguishable.
#
# Usage: scripts/verify-rls.sh [port]
# =============================================================================
set -uo pipefail

PORT="${1:-54329}"
HOST="${PGHOST:-127.0.0.1}"
DB="veo_rls_check"
PSQL="psql -h $HOST -p $PORT -U postgres -q -t -A"

ALICE='11111111-1111-4111-8111-111111111111'
BOB='22222222-2222-4222-8222-222222222222'

pass=0
fail=0

check() {
  # check <expected> <actual> <label>
  if [ "$1" = "$2" ]; then
    pass=$((pass + 1))
    printf '  PASS  %s\n' "$3"
  else
    fail=$((fail + 1))
    printf '  FAIL  %s — expected %s, got %s\n' "$3" "$1" "$2"
  fi
}

if ! $PSQL -c 'select 1' >/dev/null 2>&1; then
  echo "No PostgreSQL on $HOST:$PORT — cannot verify RLS." >&2
  echo "Start one, then re-run. RLS is NOT verified." >&2
  exit 2
fi

echo "=== PREPARING A REAL DATABASE ==="
$PSQL -c "drop database if exists $DB;" >/dev/null
$PSQL -c "create database $DB;" >/dev/null

# Supabase supplies auth.users, auth.uid() and the anon/authenticated roles.
# Stand up the same surface so the REAL migrations apply unchanged — the point
# is to test VEO's SQL, not a rewritten copy of it.
psql -h "$HOST" -p "$PORT" -U postgres -d "$DB" -v ON_ERROR_STOP=1 -q >/dev/null 2>&1 <<'SQL'
create extension if not exists "pgcrypto";
create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb not null default '{}'::jsonb
);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
end $$;
grant usage on schema public, auth to anon, authenticated, service_role;

-- Supabase Storage. Gate 1's RLS migration writes bucket policies, so the
-- shim needs the same surface or the migration cannot apply — and a migration
-- that is never applied is a migration that is never tested.
create schema if not exists storage;
create table if not exists storage.buckets (
  id text primary key, name text not null, public boolean not null default false
);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text not null,
  owner uuid
);
alter table storage.objects enable row level security;
create or replace function storage.foldername(name text)
returns text[] language sql immutable as $$
  select string_to_array(name, '/');
$$;
grant usage on schema storage to anon, authenticated, service_role;
grant select, insert, update, delete on storage.objects, storage.buckets
  to authenticated, service_role;
SQL

for migration in supabase/migrations/*.sql; do
  if psql -h "$HOST" -p "$PORT" -U postgres -d "$DB" -v ON_ERROR_STOP=1 -q -f "$migration" >/dev/null 2>&1; then
    printf '  PASS  applied %s\n' "$(basename "$migration")"
    pass=$((pass + 1))
  else
    printf '  FAIL  applied %s\n' "$(basename "$migration")"
    fail=$((fail + 1))
  fi
done

psql -h "$HOST" -p "$PORT" -U postgres -d "$DB" -q >/dev/null 2>&1 <<SQL
insert into auth.users (id, email) values
  ('$ALICE','alice@example.test'), ('$BOB','bob@example.test')
on conflict do nothing;
grant select, insert, update, delete on all tables in schema public to authenticated;
SQL

# Confirm the fixture users really exist. Every later assertion depends on it,
# and the first draft of this script silently created none — which made every
# "bob sees 0" check vacuously true.
users=$($PSQL -d "$DB" -c "select count(*) from auth.users;")
check "2" "$users" "positive control: two real users exist to test between"

as() {
  # as <user-uuid> <sql>
  psql -h "$HOST" -p "$PORT" -U postgres -d "$DB" -q -t -A 2>&1 <<SQL
set role authenticated;
select set_config('request.jwt.claim.sub', '$1', false);
$2
SQL
}

lastline() { tail -n 1; }

echo
echo "=== 1. A LEARNER CAN SEE THEIR OWN DATA (positive control) ==="
as "$ALICE" "
insert into public.learning_items (id, user_id, content_ref, content_type, semantic_id)
values ('aaaaaaaa-0000-4000-8000-000000000001','$ALICE','alice-item-1','question',
        'veo.diagnostic.test_scene.system_a.object_1');
insert into public.review_states (item_id, user_id, phase, repetitions)
values ('aaaaaaaa-0000-4000-8000-000000000001','$ALICE','review',5);
insert into public.review_events (user_id, item_id, content_ref, rating,
  previous_phase, next_phase, next_due_at, idempotency_key)
values ('$ALICE','aaaaaaaa-0000-4000-8000-000000000001','alice-item-1','good',
        'new','review', now()+interval '1 day','alice-key-1');
" >/dev/null

check "1" "$(as "$ALICE" "select count(*) from public.learning_items;" | lastline)" \
  "alice sees her own item"
check "1" "$(as "$ALICE" "select count(*) from public.review_states;" | lastline)" \
  "alice sees her own review state"
check "1" "$(as "$ALICE" "select count(*) from public.review_events;" | lastline)" \
  "alice sees her own review event"

echo
echo "=== 2. ANOTHER LEARNER CANNOT SEE IT ==="
check "0" "$(as "$BOB" "select count(*) from public.learning_items;" | lastline)" \
  "bob cannot read alice's items"
check "0" "$(as "$BOB" "select count(*) from public.review_states;" | lastline)" \
  "bob cannot read alice's review states"
check "0" "$(as "$BOB" "select count(*) from public.review_events;" | lastline)" \
  "bob cannot read alice's review history"

echo
echo "=== 3. FORGING ANOTHER LEARNER'S IDENTITY IS REFUSED ==="
forged=$(as "$BOB" "
insert into public.learning_items (user_id, content_ref, content_type)
values ('$ALICE','forged-by-bob','question');" | grep -c "row-level security")
check "1" "$forged" "an insert attributed to alice is refused by the policy"
check "0" "$(as "$ALICE" "select count(*) from public.learning_items where content_ref='forged-by-bob';" | lastline)" \
  "and no forged row exists"

echo
echo "=== 4. MUTATING ANOTHER LEARNER'S STATE DOES NOTHING ==="
as "$BOB" "update public.review_states set repetitions = 999
           where item_id = 'aaaaaaaa-0000-4000-8000-000000000001';" >/dev/null
check "5" "$(as "$ALICE" "select repetitions from public.review_states
             where item_id='aaaaaaaa-0000-4000-8000-000000000001';" | lastline)" \
  "alice's repetitions are untouched by bob's update"

as "$BOB" "delete from public.learning_items where content_ref='alice-item-1';" >/dev/null
check "1" "$(as "$ALICE" "select count(*) from public.learning_items where content_ref='alice-item-1';" | lastline)" \
  "alice's item survives bob's delete"

echo
echo "=== 5. REVIEW HISTORY IS APPEND-ONLY ==="
# There is deliberately no update or delete policy on review_events, so even
# the owner cannot rewrite their own record into a better one.
as "$ALICE" "update public.review_events set rating='easy' where idempotency_key='alice-key-1';" >/dev/null
check "good" "$(as "$ALICE" "select rating from public.review_events where idempotency_key='alice-key-1';" | lastline)" \
  "the owner cannot rewrite their own review history"

as "$ALICE" "delete from public.review_events where idempotency_key='alice-key-1';" >/dev/null
check "1" "$(as "$ALICE" "select count(*) from public.review_events where idempotency_key='alice-key-1';" | lastline)" \
  "and cannot delete it"

echo
echo "=== 6. REVIEW SUBMISSION IS IDEMPOTENT AT THE DATABASE LEVEL ==="
dup=$(as "$ALICE" "
insert into public.review_events (user_id, item_id, content_ref, rating,
  previous_phase, next_phase, next_due_at, idempotency_key)
values ('$ALICE','aaaaaaaa-0000-4000-8000-000000000001','alice-item-1','again',
        'review','relearning', now(),'alice-key-1');" | grep -c "duplicate key")
check "1" "$dup" "a repeated idempotency key is refused by a unique index"
check "1" "$(as "$ALICE" "select count(*) from public.review_events where idempotency_key='alice-key-1';" | lastline)" \
  "so one retried submission produces exactly one event"

# The same key for a DIFFERENT user must still be allowed: keys are scoped per
# learner, or two people clicking at once would collide.
as "$BOB" "
insert into public.learning_items (id, user_id, content_ref, content_type)
values ('bbbbbbbb-0000-4000-8000-000000000001','$BOB','bob-item-1','question');
insert into public.review_events (user_id, item_id, content_ref, rating,
  previous_phase, next_phase, next_due_at, idempotency_key)
values ('$BOB','bbbbbbbb-0000-4000-8000-000000000001','bob-item-1','good',
        'new','review', now()+interval '1 day','alice-key-1');" >/dev/null
check "1" "$(as "$BOB" "select count(*) from public.review_events where idempotency_key='alice-key-1';" | lastline)" \
  "the same key under a different learner is allowed"

echo
echo "=== 7. ONE ACTIVE SESSION PER LEARNER ==="
as "$ALICE" "insert into public.review_sessions (user_id, status) values ('$ALICE','active');" >/dev/null
second=$(as "$ALICE" "insert into public.review_sessions (user_id, status) values ('$ALICE','active');" | grep -c "duplicate key")
check "1" "$second" "a second active session is refused, so a refresh rejoins rather than forks"

echo
echo "=== 8. EVERY GATE 12 TABLE HAS RLS ENABLED ==="
for table in learning_items review_states review_events review_sessions \
             review_session_items learning_daily_activity learning_goals; do
  enabled=$($PSQL -d "$DB" -c "select relrowsecurity from pg_class
    where oid = 'public.$table'::regclass;")
  check "t" "$enabled" "$table has row level security on"
done

echo
echo "=== 9. THE ATOMIC SUBMIT FUNCTION ==="
# The unique index proves a duplicate INSERT is refused. This proves the
# function callers actually use handles that refusal gracefully — returning
# the first submission's result rather than erroring — and advances state
# exactly once.
as "$ALICE" "
insert into public.learning_items (id, user_id, content_ref, content_type)
values ('cccccccc-0000-4000-8000-000000000001','$ALICE','submit-item','question');
insert into public.review_states (item_id, user_id, phase, repetitions, interval_days)
values ('cccccccc-0000-4000-8000-000000000001','$ALICE','new',0,0);" >/dev/null

submit() {
  as "$ALICE" "select deduplicated from public.submit_review(
    'cccccccc-0000-4000-8000-000000000001'::uuid, null, 'good', true, 1200, '$1',
    'new', 0, now(), 'review', 2.5, 0.28, 1, 0, 0, 1.0, now()+interval '1 day',
    null, null, 'UTC', current_date);" | lastline
}

check "f" "$(submit 'submit-key-1')" "a first submission is not a duplicate"
check "t" "$(submit 'submit-key-1')" "the SAME key returns deduplicated rather than erroring"
check "1" "$(as "$ALICE" "select count(*) from public.review_events
             where item_id='cccccccc-0000-4000-8000-000000000001';" | lastline)" \
  "and exactly one event was recorded for two submissions"
check "1" "$(as "$ALICE" "select repetitions from public.review_states
             where item_id='cccccccc-0000-4000-8000-000000000001';" | lastline)" \
  "the item advanced exactly once"
check "1" "$(as "$ALICE" "select reviews_completed from public.learning_daily_activity
             where activity_date = current_date;" | lastline)" \
  "and the day's activity counted it once"

# A different key on the same item advances again — dedup must not wedge it.
check "f" "$(submit 'submit-key-2')" "a different key advances the item again"
check "2" "$(as "$ALICE" "select reviews_completed from public.learning_daily_activity
             where activity_date = current_date;" | lastline)" \
  "and the day's activity counted the second review"

echo
echo "=== 10. THE SUBMIT FUNCTION RESPECTS OWNERSHIP ==="
# Bob calls the function against Alice's item. RLS makes the locked SELECT
# return nothing, so the function raises rather than scheduling her item.
denied=$(as "$BOB" "select * from public.submit_review(
  'cccccccc-0000-4000-8000-000000000001'::uuid, null, 'easy', true, 10, 'bob-key',
  'review', 1, now(), 'review', 9, 0.2, 9, 0, 0, 9, now()+interval '9 days',
  null, null, 'UTC', current_date);" | grep -c "unknown item")
check "1" "$denied" "bob cannot schedule alice's item through the function"
check "1" "$(as "$ALICE" "select repetitions from public.review_states
             where item_id='cccccccc-0000-4000-8000-000000000001';" | lastline)" \
  "and her repetitions are unchanged by his attempt"

echo
echo "=== 11. ANALYTICS READS ARE SCOPED THE SAME WAY ==="
# Gate 13 reads the same tables through the same policies. These prove the
# analytics queries specifically — the ones that pull whole histories rather
# than single rows — cannot cross a learner boundary.

as "$ALICE" "
insert into public.learning_items (id, user_id, content_ref, content_type, semantic_id, model_ref)
values ('dddddddd-0000-4000-8000-000000000001','$ALICE','analytics-item','question',
        'veo.diagnostic.analytics.system_a.unit_one','fixture-model');
insert into public.review_states (item_id, user_id, phase, repetitions, interval_days)
values ('dddddddd-0000-4000-8000-000000000001','$ALICE','review',3,5);
insert into public.review_events
  (user_id, item_id, content_ref, rating, correct, response_ms,
   previous_phase, next_phase, next_due_at, idempotency_key)
values ('$ALICE','dddddddd-0000-4000-8000-000000000001','analytics-item','good',true,4000,
        'review','review', now() + interval '5 days','analytics-ev-1'),
       ('$ALICE','dddddddd-0000-4000-8000-000000000001','analytics-item','again',false,9000,
        'review','relearning', now() + interval '10 minutes','analytics-ev-2');" >/dev/null

# The four reads an analytics snapshot performs, as the owner.
check "1" "$(as "$ALICE" "select count(*) from public.learning_items
             where content_ref='analytics-item';" | lastline)" \
  "the owner's analytics read returns their items"
check "2" "$(as "$ALICE" "select count(*) from public.review_events
             where item_id='dddddddd-0000-4000-8000-000000000001';" | lastline)" \
  "and their full event history"

# The same four reads as another learner. Not "fewer rows" — zero.
check "0" "$(as "$BOB" "select count(*) from public.learning_items
             where content_ref='analytics-item';" | lastline)" \
  "another learner's analytics read returns none of her items"
check "0" "$(as "$BOB" "select count(*) from public.review_events
             where item_id='dddddddd-0000-4000-8000-000000000001';" | lastline)" \
  "and none of her review history"
check "0" "$(as "$BOB" "select count(*) from public.review_sessions;" | lastline)" \
  "and none of her sessions"
check "0" "$(as "$BOB" "select count(*) from public.learning_daily_activity;" | lastline)" \
  "and none of her daily activity"

# An unscoped aggregate is the shape an analytics query actually takes. RLS
# must bound it too, or a single COUNT would leak the size of someone's history.
check "0" "$(as "$BOB" "select coalesce(sum(reviews_completed),0)
             from public.learning_daily_activity;" | lastline)" \
  "an unscoped aggregate cannot total another learner's activity"
check "0" "$(as "$BOB" "select count(*) from public.review_events
             where rating = 'again';" | lastline)" \
  "nor count another learner's failures"

# A forged item id in a filter is still bounded by the policy, not by the
# filter: the WHERE clause is the caller's, the row visibility is not.
check "0" "$(as "$BOB" "select count(*) from public.review_states
             where item_id='dddddddd-0000-4000-8000-000000000001';" | lastline)" \
  "guessing an item id does not expose its scheduling state"

echo
echo "=== 12. NEGATIVE CONTROL: THE CHECK CAN FAIL ==="
# Without this, every assertion above could be passing because the harness is
# broken rather than because the policies work.
$PSQL -d "$DB" -c "create table if not exists public.rls_control (user_id uuid, note text);
  grant select, insert on public.rls_control to authenticated;" >/dev/null
as "$ALICE" "insert into public.rls_control (user_id, note) values ('$ALICE','visible to all');" >/dev/null
check "1" "$(as "$BOB" "select count(*) from public.rls_control;" | lastline)" \
  "an UNPROTECTED table IS readable by another user, proving the harness detects exposure"

$PSQL -c "drop database if exists $DB;" >/dev/null 2>&1

echo
echo "============================================================"
echo "VEO RLS VERIFICATION: $pass passed, $fail failed"
echo "============================================================"

[ "$fail" -eq 0 ]
