/**
 * Gate 14 performance measurement.
 *
 * Entitlement enforcement sits in front of every AI request, so its cost is
 * paid on every one. The budget is deliberately tight: this is overhead on
 * work the learner asked for, not work itself.
 *
 * What is measured is the decision path — resolving a subscription into
 * entitlements, deriving allowances and deciding access — with the database
 * stubbed at a fixed latency, so the number reported is VEO's own cost rather
 * than the network's. The database round trips themselves are bounded by
 * being two indexed single-row reads, which `verify-rls.sh` exercises against
 * real PostgreSQL.
 *
 * Usage: npx tsx scripts/measure-entitlements.mjs
 */
import { performance } from 'node:perf_hooks';
import { resolveEntitlements, tierFor } from '../src/lib/stripe/entitlements.ts';
import { decide } from '../src/billing/access.ts';
import { limitFor, quotaState } from '../src/billing/quotas.ts';
import { ENTITLEMENT_KEYS } from '../src/types/domain/billing.ts';

function subscription(tier) {
  return {
    id: 's', userId: 'u', tier, status: 'active',
    stripeCustomerId: null, stripeSubscriptionId: null, stripePriceId: null,
    currentPeriodEnd: null, cancelAtPeriodEnd: false, metadata: {},
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

/** One request's entitlement decision, end to end minus I/O. */
function decideOnce(sub, key, used) {
  const entitlements = resolveEntitlements(sub);
  const tier = tierFor(sub);
  const granted = entitlements.some((e) => e.key === key && e.granted);
  const limit = limitFor(tier, key);
  const quota = limit === null ? null : quotaState(tier, key, used);
  return decide({ tier, granted, quota });
}

/** The full capability view the status route builds, for every key. */
function viewAll(sub, used) {
  const entitlements = resolveEntitlements(sub);
  const tier = tierFor(sub);
  return ENTITLEMENT_KEYS.map((key) => {
    const granted = entitlements.some((e) => e.key === key && e.granted);
    const limit = limitFor(tier, key);
    const quota = granted && limit !== null ? quotaState(tier, key, used) : null;
    return decide({ tier, granted, quota });
  });
}

function measure(label, run, iterations = 2000) {
  for (let i = 0; i < 200; i += 1) run(); // warm

  const start = performance.now();
  for (let i = 0; i < iterations; i += 1) run();
  const total = performance.now() - start;

  return { label, per: total / iterations, total };
}

console.log('VEO ENTITLEMENT PERFORMANCE');
console.log('='.repeat(64));
console.log('case'.padEnd(42) + 'per call'.padStart(12) + 'x2000'.padStart(10));
console.log('-'.repeat(64));

const cases = [
  ['free, metered capability, allowance left', () => decideOnce(null, 'ai.generate_flashcards', 3)],
  ['free, metered capability, exhausted', () => decideOnce(null, 'ai.generate_flashcards', 10)],
  ['free, capability not on plan', () => decideOnce(null, 'ai.tutor', 0)],
  ['pro, unmetered capability', () => decideOnce(subscription('pro'), 'ai.tutor', 0)],
  ['institution, unmetered', () => decideOnce(subscription('institution'), 'export.notes', 0)],
  ['full capability view (status route)', () => viewAll(null, 3)],
];

let worst = 0;
for (const [label, run] of cases) {
  const result = measure(label, run);
  worst = Math.max(worst, result.per);
  console.log(
    label.padEnd(42) +
      `${result.per.toFixed(4)}ms`.padStart(12) +
      `${result.total.toFixed(0)}ms`.padStart(10),
  );
}

console.log('-'.repeat(64));

/*
 * 1ms. Enforcement runs before an AI call that takes hundreds of milliseconds
 * at best, so anything at this scale is free in context — but a regression
 * here would be paid on every request in the product, which is why it has a
 * number rather than a shrug.
 */
const BUDGET_MS = 1;
console.log(`worst case: ${worst.toFixed(4)}ms per call (budget ${BUDGET_MS}ms)`);
console.log(worst <= BUDGET_MS ? 'WITHIN BUDGET' : 'OVER BUDGET');

process.exit(worst <= BUDGET_MS ? 0 : 1);
