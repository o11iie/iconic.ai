/**
 * Mutation testing for the entitlement boundary.
 *
 * A passing test suite proves the tests run. It does not prove they would
 * NOTICE if the code stopped enforcing anything — and for a module whose whole
 * job is to refuse people, that is the only property worth having.
 *
 * So each mutation below breaks enforcement in a way a careless edit plausibly
 * could: granting where it should refuse, failing open, an off-by-one on the
 * last unit of an allowance. The suite must go RED for every one. A mutant
 * that survives marks a hole in the tests, not a harmless change.
 *
 * Every mutation is applied to a file on disk and reverted in a `finally`, so
 * an interrupted run cannot leave the tree modified.
 *
 * Usage: node scripts/mutate-billing.mjs
 */
import { execFile } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const ROOT = process.cwd();

const SUITE = [
  'src/billing/access.test.ts',
  'src/billing/server/consume.test.ts',
  'src/billing/server/security.test.ts',
  'src/app/api/billing/webhook/route.test.ts',
];

/**
 * Each mutant names the protection it removes, so a survivor reports what is
 * unguarded rather than just which line changed.
 */
const MUTANTS = [
  {
    name: 'a capability the plan does not grant is allowed anyway',
    file: 'src/billing/access.ts',
    from: "  if (!input.granted) {\n    return { allowed: false, reason: 'plan_required', tier: input.tier, quota: input.quota };\n  }",
    to: '  // mutant: the plan check is gone',
  },
  {
    name: 'a spent allowance is ignored',
    file: 'src/billing/access.ts',
    from: "  if (input.quota?.exhausted) {\n    return { allowed: false, reason: 'quota_exhausted', tier: input.tier, quota: input.quota };\n  }",
    to: '  // mutant: the quota check is gone',
  },
  {
    name: 'quota exhaustion answers 200 instead of 429',
    file: 'src/billing/access.ts',
    from: 'quota_exhausted: 429',
    to: 'quota_exhausted: 200',
  },
  {
    name: 'the free tier becomes unmetered',
    file: 'src/billing/quotas.ts',
    from: "  if (tier !== 'free') return null;\n  return FREE_DAILY_LIMITS[key] ?? null;",
    to: '  return null; // mutant: nothing is ever metered',
  },
  {
    name: 'off by one: the last unit of an allowance never exhausts it',
    file: 'src/billing/quotas.ts',
    from: '  const remaining = Math.max(0, limit - safeUsed);\n  return { key, limit, used: safeUsed, remaining, exhausted: remaining === 0 };',
    to: '  const remaining = Math.max(0, limit - safeUsed);\n  return { key, limit, used: safeUsed, remaining, exhausted: remaining < 0 };',
  },
  {
    name: 'a negative usage count is trusted, handing back allowance',
    file: 'src/billing/quotas.ts',
    from: '  const safeUsed = Number.isFinite(used) && used > 0 ? Math.floor(used) : 0;',
    to: '  const safeUsed = used;',
  },
  {
    name: 'the counter failing open grants free usage',
    file: 'src/billing/server/entitlements.ts',
    from: "    console.error('[billing] consume_entitlement failed', error.message);\n    return {\n      allowed: false,\n      reason: 'not_configured',",
    to: "    console.error('[billing] consume_entitlement failed', error.message);\n    return {\n      allowed: true,\n      reason: 'not_configured',",
  },
  {
    name: "the database's refusal is not believed",
    file: 'src/billing/server/entitlements.ts',
    from: '  const allowed = Boolean(row?.allowed);',
    to: '  const allowed = true; // mutant: the atomic decision is discarded',
  },
  {
    name: 'a capability not on the plan is never checked before spending',
    file: 'src/billing/server/entitlements.ts',
    from: "  if (!granted(access, key)) {\n    return decide({ tier: access.tier, granted: false, quota: null });\n  }",
    to: '  // mutant: the grant check is gone',
  },
  {
    name: 'the gate lets every caller through',
    file: 'src/billing/server/gate.ts',
    from: '  const decision = await consume(resolution.access, key);\n  if (!decision.allowed) {',
    to: '  const decision = await consume(resolution.access, key);\n  if (false && !decision.allowed) {',
  },
  {
    name: 'the gate no longer requires a signed-in learner',
    file: 'src/billing/server/gate.ts',
    from: '  const resolution = await resolveAccess(now);\n  if (!resolution.ok) {',
    to: '  const resolution = await resolveAccess(now);\n  if (false && !resolution.ok) {',
  },
  {
    name: 'the gate is exempt for everyone, not only the stub',
    file: 'src/billing/server/gate.ts',
    from: '  if (stubEnabled()) return { ok: true, access: null };',
    to: '  if (true) return { ok: true, access: null };',
  },

  // --- the webhook: the one endpoint that can grant a paid plan ------------
  {
    name: 'the webhook trusts the body instead of verifying the signature',
    file: 'src/app/api/billing/webhook/route.ts',
    from: '    event = constructWebhookEvent(raw, signature);',
    to: '    event = JSON.parse(raw) as Stripe.Event; // mutant: unverified',
  },
  {
    name: 'the webhook proceeds without a signature header',
    file: 'src/app/api/billing/webhook/route.ts',
    from: "  if (!signature) {\n    return refuse(400, 'unsigned', 'Missing signature.');\n  }",
    to: "  const _unused = signature; // mutant: no header required",
  },
  {
    name: 'an unrecognised tier is granted rather than refused',
    file: 'src/app/api/billing/webhook/route.ts',
    from: "  return typeof raw === 'string' && (PLAN_TIERS as readonly string[]).includes(raw)\n    ? (raw as PlanTier)\n    : null;",
    to: "  return (raw as PlanTier) ?? null; // mutant: any string is a tier",
  },
  {
    name: 'an event with no VEO account attached still writes a row',
    file: 'src/app/api/billing/webhook/route.ts',
    from: "  if (!userId) {\n    return refuse(400, 'unattributable', 'No VEO account is attached to this event.');\n  }",
    to: "  // mutant: anybody's event grants somebody a plan",
  },
  {
    name: "the payload's own metadata is copied into VEO's row",
    file: 'src/app/api/billing/webhook/route.ts',
    from: '        metadata: {},',
    to: '        metadata: metadata as Record<string, never>, // mutant: smuggling allowed',
  },
  {
    name: 'an unhandled event type is processed as if it granted a plan',
    file: 'src/app/api/billing/webhook/route.ts',
    from: '  if (!HANDLED_EVENTS.has(event.type)) {',
    to: '  if (false) {',
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
  console.log('VEO BILLING MUTATION TESTING\n');

  // Positive control. If the suite is red before a single mutation, every
  // "caught" below would be meaningless.
  process.stdout.write('baseline (unmutated suite must PASS) ... ');
  if (!(await suitePasses())) {
    console.log('FAILED');
    console.error('\nThe suite is red before any mutation. Fix that first.');
    process.exit(1);
  }
  console.log('passes\n');

  let caught = 0;
  const survivors = [];

  for (const mutant of MUTANTS) {
    const path = join(ROOT, mutant.file);
    const original = readFileSync(path, 'utf8');

    if (!original.includes(mutant.from)) {
      // The code moved. Treated as a failure, not a skip: a mutation that no
      // longer applies is a mutation that is no longer testing anything.
      console.log(`  STALE   ${mutant.name}`);
      survivors.push(`${mutant.name} (its target text is not in ${mutant.file})`);
      continue;
    }

    try {
      writeFileSync(path, original.replace(mutant.from, mutant.to));
      const stillPasses = await suitePasses();

      if (stillPasses) {
        console.log(`  SURVIVED ${mutant.name}`);
        survivors.push(mutant.name);
      } else {
        caught += 1;
        console.log(`  caught  ${mutant.name}`);
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
