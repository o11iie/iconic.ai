/**
 * Mutation testing for Gate 15's security boundary.
 *
 * The tests pass. That proves they run. It does not prove they would NOTICE
 * if authentication stopped happening, if a user id from a request body
 * started being trusted, if a secret stopped being redacted, or if an account
 * could be deleted without confirming.
 *
 * So each mutation below breaks one of those protections in a way a careless
 * edit plausibly could, and the suite must go RED for every one. A survivor
 * marks a hole in the tests, not a harmless change.
 *
 * SQL-level protections — RLS policies and the atomic quota — are mutated
 * separately by `mutate-rls.mjs`, because breaking them requires re-applying
 * the migrations to a real database.
 *
 * Usage: node scripts/mutate-account.mjs
 */
import { execFile } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const ROOT = process.cwd();

const SUITE = [
  'src/lib/supabase/middleware.test.ts',
  'src/account/lifecycle.test.ts',
  'src/account/server/account-service.test.ts',
  'src/security/rate-limit.test.ts',
  'src/observability/log.test.ts',
  'src/config/production-audit.test.ts',
];

/**
 * Each mutant names the protection it removes, and the category from Gate
 * 15's brief that it belongs to — so a survivor reports which class of defect
 * would go unnoticed rather than just which line changed.
 */
const MUTANTS = [
  // --- auth bypass ---------------------------------------------------------
  {
    category: 'auth bypass',
    name: 'an unconfigured production build serves protected routes anyway',
    file: 'src/lib/supabase/middleware.ts',
    from: '    if (IS_PRODUCTION && isProtectedPath(request.nextUrl.pathname)) {\n      return unconfigured();\n    }',
    to: '    // mutant: the production refusal is gone',
  },
  {
    category: 'auth bypass',
    name: 'the refusal applies to nothing, because no path counts as protected',
    file: 'src/lib/supabase/middleware.ts',
    from: '  return PROTECTED_PREFIXES.some(\n    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),\n  );',
    to: '  void pathname;\n  return false; // mutant: nothing is protected',
  },
  {
    category: 'auth bypass',
    name: 'a lookalike path slips past the prefix check',
    file: 'src/lib/supabase/middleware.ts',
    from: '    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),\n  );\n}\n\nexport function isAuthOnlyPath',
    to: '    (prefix) => pathname.startsWith(prefix),\n  );\n}\n\nexport function isAuthOnlyPath',
  },

  // --- userId trust --------------------------------------------------------
  {
    category: 'userId trust',
    name: 'a profile update is scoped to an id from the request',
    file: 'src/account/server/account-service.ts',
    from: "  const { error } = await client.from('profiles').update(row).eq('user_id', auth.user.id);",
    to: "  const { error } = await client\n    .from('profiles')\n    .update(row)\n    .eq('user_id', (update as { userId?: string }).userId ?? auth.user.id);",
  },
  {
    category: 'userId trust',
    name: 'a profile update spreads the request body into the row',
    file: 'src/account/server/account-service.ts',
    from: '  const row: ProfileUpdateRow = {};',
    to: '  const row: ProfileUpdateRow = { ...(update as ProfileUpdateRow) };',
  },
  {
    category: 'userId trust',
    name: 'a profile read is scoped to an id that is not the session user',
    file: 'src/account/server/account-service.ts',
    from: "    .eq('user_id', auth.user.id)\n    .maybeSingle();",
    to: "    .eq('user_id', 'any-user-id')\n    .maybeSingle();",
  },

  // --- account deletion authorization --------------------------------------
  {
    category: 'deletion authorization',
    name: 'an account can be deleted without confirming',
    file: 'src/account/lifecycle.ts',
    from: "  if (input.confirmation !== DELETION_CONFIRMATION) {\n    return { allowed: false, reason: 'not_confirmed' };\n  }",
    to: '  // mutant: confirmation is not required',
  },
  {
    category: 'deletion authorization',
    name: 'an account can be deleted without a session',
    file: 'src/account/lifecycle.ts',
    from: "  if (!input.userId) return { allowed: false, reason: 'unauthenticated' };",
    to: '  // mutant: no session required',
  },
  {
    category: 'deletion authorization',
    name: 'confirmation is compared loosely, so near-misses count',
    file: 'src/account/lifecycle.ts',
    from: '  if (input.confirmation !== DELETION_CONFIRMATION) {',
    to: '  if (input.confirmation.trim().toUpperCase() !== DELETION_CONFIRMATION) {',
  },
  {
    category: 'deletion authorization',
    name: 'an account is deleted while a subscription is still being billed',
    file: 'src/account/lifecycle.ts',
    from: "  if (billable && !input.stripeConfigured) {",
    to: '  if (false && billable && !input.stripeConfigured) {',
  },
  {
    category: 'deletion authorization',
    name: 'deletion proceeds even when the cancellation failed',
    file: 'src/account/server/account-service.ts',
    from: "    const cancelled = await cancelSubscriptionAtStripe(stripeSubscriptionId);\n    if (!cancelled) {",
    to: "    const cancelled = await cancelSubscriptionAtStripe(stripeSubscriptionId);\n    if (false && !cancelled) {",
  },
  {
    category: 'deletion authorization',
    name: 'a lapsed subscription is treated as live, blocking a valid deletion',
    file: 'src/account/lifecycle.ts',
    from: "  return status === 'active' || status === 'trialing' || status === 'past_due';",
    to: '  return status !== null; // mutant: any status counts as billable',
  },
  {
    category: 'deletion authorization',
    name: 'the session is left valid after the account is gone',
    file: 'src/account/server/account-service.ts',
    from: '  if (client) await client.auth.signOut();',
    to: '  // mutant: the cookie keeps being presented',
  },

  // --- secret exposure -----------------------------------------------------
  {
    category: 'secret exposure',
    name: 'a field named for a secret is logged in full',
    file: 'src/observability/log.ts',
    from: '  const lower = key.toLowerCase();\n  return FORBIDDEN_KEY_PATTERNS.some((pattern) => lower.includes(pattern));',
    to: '  void key;\n  return false; // mutant: nothing is forbidden',
  },
  {
    category: 'secret exposure',
    name: 'free text is logged without scrubbing',
    file: 'src/observability/log.ts',
    from: '  let out = value;\n  for (const pattern of SECRET_VALUE_PATTERNS) out = out.replace(pattern, REDACTED);\n  return out;',
    to: '  return value; // mutant: nothing is scrubbed',
  },
  {
    category: 'secret exposure',
    name: 'a client-supplied correlation id is echoed unchecked',
    file: 'src/observability/log.ts',
    from: '  if (supplied && /^[A-Za-z0-9_-]{1,64}$/.test(supplied)) return supplied;',
    to: '  if (supplied) return supplied; // mutant: anything goes',
  },

  // --- rate limiting -------------------------------------------------------
  {
    category: 'abuse control',
    name: 'the limiter permits everything',
    file: 'src/security/rate-limit.ts',
    from: '  if (previous.count >= rule.limit) {',
    to: '  if (false) {',
  },
  {
    category: 'abuse control',
    name: 'a refused request extends its own lockout',
    file: 'src/security/rate-limit.ts',
    from: '    return { allowed: false, state: previous, remaining: 0, retryAfter };',
    to: '    return {\n      allowed: false,\n      state: { count: previous.count + 1, startedAt: now },\n      remaining: 0,\n      retryAfter,\n    };',
  },
  {
    category: 'abuse control',
    name: 'a window in the future is trusted, so the limit never resets',
    file: 'src/security/rate-limit.ts',
    from: '  if (previous === undefined || elapsed >= rule.windowMs || elapsed < 0) {',
    to: '  if (previous === undefined || elapsed >= rule.windowMs) {',
  },
  {
    category: 'abuse control',
    name: 'the irreversible action is limited as loosely as the rest',
    file: 'src/security/rate-limit.ts',
    from: "  'account.delete': {\n    limit: 5,\n    windowMs: 300_000,",
    to: "  'account.delete': {\n    limit: 500,\n    windowMs: 60_000,",
  },

  // --- configuration -------------------------------------------------------
  {
    category: 'configuration',
    name: 'authentication is classified as optional',
    file: 'src/config/production-audit.ts',
    from: "    id: 'supabase',\n    label: 'Supabase — authentication, database and storage',\n    classification: 'required',",
    to: "    id: 'supabase',\n    label: 'Supabase — authentication, database and storage',\n    classification: 'optional',",
  },
  {
    category: 'configuration',
    name: 'a missing required integration is not treated as blocking',
    file: 'src/config/production-audit.ts',
    from: "      severity: satisfied\n        ? 'ok'\n        : requirement.classification === 'required'\n          ? 'blocking'\n          : 'degraded',",
    to: "      severity: satisfied ? 'ok' : 'degraded',",
  },
];

async function suitePasses() {
  try {
    await run('npx', ['vitest', 'run', '--reporter=dot', ...SUITE], {
      cwd: ROOT,
      maxBuffer: 32 * 1024 * 1024,
    });
    return true;
  } catch {
    return false;
  }
}

async function main() {
  console.log('VEO ACCOUNT & SECURITY MUTATION TESTING\n');

  process.stdout.write('baseline (unmutated suite must PASS) ... ');
  if (!(await suitePasses())) {
    console.log('FAILED');
    console.error('\nThe suite is red before any mutation. Fix that first.');
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
      // A mutation that no longer applies is a mutation that is no longer
      // testing anything, so this is a failure rather than a skip.
      console.log(`  STALE    ${mutant.name}`);
      survivors.push(`${mutant.name} (target text not found in ${mutant.file})`);
      continue;
    }

    try {
      writeFileSync(path, original.replace(mutant.from, mutant.to));
      if (await suitePasses()) {
        console.log(`  SURVIVED ${mutant.name}`);
        survivors.push(`[${mutant.category}] ${mutant.name}`);
      } else {
        caught += 1;
        console.log(`  caught   ${mutant.name}`);
      }
    } finally {
      writeFileSync(path, original);
    }
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`MUTANTS CAUGHT: ${caught} of ${MUTANTS.length}`);
  console.log('='.repeat(60));

  if (survivors.length > 0) {
    console.log('\nSurvivors — each is a protection no test would notice losing:');
    for (const name of survivors) console.log(`  - ${name}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
