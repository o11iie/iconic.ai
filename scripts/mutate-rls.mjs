/**
 * Mutation testing for the DATABASE boundary.
 *
 * `verify-rls.sh` reports 100 passing checks against real PostgreSQL. That
 * proves the checks run. It does not prove they would NOTICE if a policy
 * stopped scoping rows to their owner, if the atomic quota guard were
 * dropped, or if append-only history became editable.
 *
 * So each mutation below weakens a real policy in the real migration, applies
 * it to a real database, and requires the verification to FAIL. A survivor
 * means the RLS suite is decorative for that protection.
 *
 * These are separate from `mutate-account.mjs` because they cannot be caught
 * by a unit test: they live in SQL, and only a database can tell you whether
 * a policy still holds.
 *
 * Usage: node scripts/mutate-rls.mjs
 */
import { execFile } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const ROOT = process.cwd();

const MUTANTS = [
  {
    category: 'cross-user access',
    name: 'a learner can read every other learner\'s items',
    file: 'supabase/migrations/0003_learning_memory.sql',
    from: "create policy \"learning_items_select_own\" on public.learning_items\n  for select to authenticated using (user_id = (select auth.uid()));",
    to: "create policy \"learning_items_select_own\" on public.learning_items\n  for select to authenticated using (true);",
  },
  {
    category: 'cross-user access',
    name: 'a learner can write an item attributed to somebody else',
    file: 'supabase/migrations/0003_learning_memory.sql',
    from: "create policy \"learning_items_insert_own\" on public.learning_items\n  for insert to authenticated with check (user_id = (select auth.uid()));",
    to: "create policy \"learning_items_insert_own\" on public.learning_items\n  for insert to authenticated with check (true);",
  },
  {
    category: 'RLS policy failure',
    name: 'row level security is switched off on the review history',
    file: 'supabase/migrations/0003_learning_memory.sql',
    from: 'alter table public.review_events            enable row level security;',
    to: 'alter table public.review_events            disable row level security;',
  },
  {
    category: 'tier escalation',
    name: 'a client can write its own subscription row',
    file: 'supabase/migrations/0002_row_level_security.sql',
    from: 'drop policy if exists "subscriptions_select_own" on public.subscriptions;',
    to: `drop policy if exists "subscriptions_write_own" on public.subscriptions;
create policy "subscriptions_write_own" on public.subscriptions
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "subscriptions_select_own" on public.subscriptions;`,
  },
  {
    category: 'entitlement bypass',
    name: 'a client can clear its own usage counter',
    file: 'supabase/migrations/0004_entitlement_usage.sql',
    from: 'create policy "entitlement_usage_select_own" on public.entitlement_usage',
    to: `create policy "entitlement_usage_delete_own" on public.entitlement_usage
  for delete to authenticated using (user_id = (select auth.uid()));

create policy "entitlement_usage_select_own" on public.entitlement_usage`,
  },
  {
    category: 'quota race',
    name: 'the allowance guard is dropped, so the limit is advisory',
    file: 'supabase/migrations/0004_entitlement_usage.sql',
    from: 'where public.entitlement_usage.used < p_limit',
    to: 'where true',
  },
  {
    category: 'quota race',
    name: 'the counter is read and written separately, losing races',
    file: 'supabase/migrations/0004_entitlement_usage.sql',
    from: '    do update set used = public.entitlement_usage.used + 1',
    to: '    do update set used = (select used + 1 from public.entitlement_usage u\n                           where u.user_id = v_user_id\n                             and u.entitlement_key = p_entitlement_key\n                             and u.usage_date = p_usage_date)',
  },
  {
    category: 'identity forgery',
    name: 'the quota function takes a user id instead of deriving one',
    file: 'supabase/migrations/0004_entitlement_usage.sql',
    from: '  p_entitlement_key text,\n  p_usage_date      date,\n  p_limit           integer',
    to: '  p_entitlement_key text,\n  p_usage_date      date,\n  p_limit           integer,\n  p_user_id         uuid default null',
  },
];

async function verificationFails() {
  try {
    await run('./scripts/verify-rls.sh', [], { cwd: ROOT, maxBuffer: 32 * 1024 * 1024 });
    return false; // exited 0 — the weakened database PASSED, which is the bug
  } catch (error) {
    // Exit 2 means no database at all, which is not a caught mutant.
    if (error.code === 2) throw new Error('no PostgreSQL available — cannot mutate RLS');
    return true;
  }
}

async function main() {
  console.log('VEO DATABASE MUTATION TESTING\n');

  process.stdout.write('baseline (unmutated migrations must PASS) ... ');
  try {
    await run('./scripts/verify-rls.sh', [], { cwd: ROOT, maxBuffer: 32 * 1024 * 1024 });
  } catch (error) {
    console.log('FAILED');
    console.error(
      error.code === 2
        ? '\nNo PostgreSQL is running. RLS mutations cannot be verified.'
        : '\nThe RLS suite is red before any mutation. Fix that first.',
    );
    process.exit(1);
  }
  console.log('passes\n');

  let caught = 0;
  const survivors = [];
  let category = '';

  for (const mutant of MUTANTS) {
    if (mutant.category !== category) {
      category = mutant.category;
      console.log(`  --- ${category} ---`);
    }

    const path = join(ROOT, mutant.file);
    const original = readFileSync(path, 'utf8');

    if (!original.includes(mutant.from)) {
      console.log(`  STALE    ${mutant.name}`);
      survivors.push(`${mutant.name} (target text not found in ${mutant.file})`);
      continue;
    }

    try {
      writeFileSync(path, original.replace(mutant.from, mutant.to));

      if (await verificationFails()) {
        caught += 1;
        console.log(`  caught   ${mutant.name}`);
      } else {
        console.log(`  SURVIVED ${mutant.name}`);
        survivors.push(`[${mutant.category}] ${mutant.name}`);
      }
    } finally {
      // Always restored, so an interrupted run cannot leave a weakened
      // migration in the tree.
      writeFileSync(path, original);
    }
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`DATABASE MUTANTS CAUGHT: ${caught} of ${MUTANTS.length}`);
  console.log('='.repeat(60));

  if (survivors.length > 0) {
    console.log('\nSurvivors — the RLS suite would not notice these:');
    for (const name of survivors) console.log(`  - ${name}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
