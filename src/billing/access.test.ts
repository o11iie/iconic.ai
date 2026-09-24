import { describe, expect, it } from 'vitest';
import { ENTITLEMENT_KEYS, PLAN_TIERS, type PlanTier } from '@/types/domain/billing';
import { ACCESS_DENIALS, DENIAL_MESSAGES, DENIAL_STATUS, decide } from './access';
import { FREE_DAILY_LIMITS, METERED_KEYS, isMetered, limitFor, quotaState } from './quotas';
import { resolveEntitlements, hasEntitlement } from '@/lib/stripe/entitlements';

/**
 * The access decision and the meter.
 *
 * Both are pure, so these assert the rules exhaustively rather than sampling
 * them. A billing decision that is wrong in one direction charges somebody for
 * what they already have; wrong in the other, it gives the product away.
 */

describe('quota limits', () => {
  it('meters only the capabilities the limit table names', () => {
    for (const key of ENTITLEMENT_KEYS) {
      expect(isMetered(key)).toBe(key in FREE_DAILY_LIMITS);
    }
    expect(METERED_KEYS.length).toBeGreaterThan(0);
  });

  it('meters the free tier and no other', () => {
    // The key names have said this since Gate 1: `material.upload` is free,
    // `material.unlimited_uploads` is paid. Paying removes the meter.
    for (const key of METERED_KEYS) {
      expect(limitFor('free', key)).toBeTypeOf('number');
      for (const tier of PLAN_TIERS.filter((t) => t !== 'free')) {
        expect(limitFor(tier, key), `${tier}/${key}`).toBeNull();
      }
    }
  });

  it('leaves unmetered capabilities unmetered on every tier', () => {
    const unmetered = ENTITLEMENT_KEYS.filter((key) => !isMetered(key));
    expect(unmetered.length).toBeGreaterThan(0);

    for (const key of unmetered) {
      for (const tier of PLAN_TIERS) expect(limitFor(tier, key)).toBeNull();
    }
  });

  it('gives a free allowance big enough to be a product, not a teaser', () => {
    // A limit a learner hits before understanding the feature teaches them the
    // product is broken rather than that the paid tier is worth buying.
    for (const [, limit] of Object.entries(FREE_DAILY_LIMITS)) {
      expect(limit).toBeGreaterThanOrEqual(5);
    }
  });
});

describe('quota state', () => {
  it('counts down as it is used', () => {
    expect(quotaState('free', 'ai.generate_flashcards', 0)).toMatchObject({
      limit: 10, used: 0, remaining: 10, exhausted: false,
    });
    expect(quotaState('free', 'ai.generate_flashcards', 7)).toMatchObject({
      used: 7, remaining: 3, exhausted: false,
    });
  });

  it('is exhausted exactly at the limit, not after it', () => {
    expect(quotaState('free', 'ai.generate_flashcards', 10).exhausted).toBe(true);
    expect(quotaState('free', 'ai.generate_flashcards', 9).exhausted).toBe(false);
  });

  it('never reports negative remaining, even past the limit', () => {
    // Overshoot should be impossible, but if a counter ever did drift the UI
    // must not render "-3 left".
    const state = quotaState('free', 'ai.generate_flashcards', 99);
    expect(state.remaining).toBe(0);
    expect(state.exhausted).toBe(true);
  });

  it('is never exhausted when unmetered', () => {
    const state = quotaState('pro', 'ai.generate_flashcards', 10_000);
    expect(state.limit).toBeNull();
    expect(state.remaining).toBeNull();
    expect(state.exhausted).toBe(false);
  });

  it('repairs a nonsensical stored count rather than propagating it', () => {
    for (const nonsense of [Number.NaN, -5, Number.POSITIVE_INFINITY]) {
      const state = quotaState('free', 'ai.generate_flashcards', nonsense);
      expect(Number.isFinite(state.used)).toBe(true);
      expect(state.used).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('the access decision', () => {
  it('refuses a capability the plan does not include', () => {
    const decision = decide({ tier: 'free', granted: false, quota: null });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toBe('plan_required');
  });

  it('refuses a granted capability whose allowance is spent', () => {
    const decision = decide({
      tier: 'free',
      granted: true,
      quota: quotaState('free', 'ai.generate_flashcards', 10),
    });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toBe('quota_exhausted');
  });

  it('allows a granted capability with allowance left', () => {
    const decision = decide({
      tier: 'free',
      granted: true,
      quota: quotaState('free', 'ai.generate_flashcards', 2),
    });
    expect(decision.allowed).toBe(true);
  });

  it('never tells a paying learner they have run out of something unlimited', () => {
    // The ordering bug this guards against: checking the quota before the
    // grant, so a stale row on an upgraded account produces a false refusal.
    const decision = decide({
      tier: 'pro',
      granted: true,
      quota: quotaState('pro', 'ai.generate_flashcards', 100_000),
    });
    expect(decision.allowed).toBe(true);
  });

  it('reports plan_required over quota_exhausted when both could apply', () => {
    // A capability they do not have is not a capability they have used up.
    // Telling them to wait until tomorrow would be a lie.
    const decision = decide({
      tier: 'free',
      granted: false,
      quota: quotaState('free', 'ai.generate_flashcards', 10),
    });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toBe('plan_required');
  });
});

describe('refusals are actionable', () => {
  it('gives every denial a message and a status', () => {
    for (const denial of ACCESS_DENIALS) {
      expect(DENIAL_MESSAGES[denial]?.length ?? 0).toBeGreaterThan(5);
      expect(DENIAL_STATUS[denial]).toBeGreaterThanOrEqual(400);
    }
  });

  it('uses a retryable status for a daily allowance and a final one for a plan', () => {
    // 429 says "legitimate, try later", which is what tomorrow's reset means.
    // 403 says "stop asking", which is what a plan boundary means.
    expect(DENIAL_STATUS.quota_exhausted).toBe(429);
    expect(DENIAL_STATUS.plan_required).toBe(403);
    expect(DENIAL_STATUS.unauthenticated).toBe(401);
  });

  it('never blames the learner', () => {
    for (const message of Object.values(DENIAL_MESSAGES)) {
      expect(message).not.toMatch(/you (cannot|failed|are not allowed)/i);
    }
  });
});

describe('the tier map is still Gate 1\'s', () => {
  it('resolves through the existing resolver, not a second one', () => {
    // Gate 14 adds metering. It does not re-decide who may do what.
    expect(hasEntitlement(resolveEntitlements(null), 'ai.generate_flashcards')).toBe(true);
    expect(hasEntitlement(resolveEntitlements(null), 'ai.tutor')).toBe(false);
  });

  it('meters only capabilities the free tier actually holds', () => {
    // Metering something free users cannot use would be dead configuration
    // that looks like a working allowance.
    const free = resolveEntitlements(null);
    for (const key of METERED_KEYS) {
      expect(hasEntitlement(free, key), `${key} is metered but not granted free`).toBe(true);
    }
  });

  it('gives every paid tier strictly more than free', () => {
    const free = resolveEntitlements(null).filter((e) => e.granted).map((e) => e.key);

    for (const tier of PLAN_TIERS.filter((t) => t !== 'free') as PlanTier[]) {
      const paid = resolveEntitlements({
        id: 's', userId: 'u', tier, status: 'active',
        stripeCustomerId: null, stripeSubscriptionId: null, stripePriceId: null,
        currentPeriodEnd: null, cancelAtPeriodEnd: false, metadata: {},
        createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
      }).filter((e) => e.granted).map((e) => e.key);

      for (const key of free) {
        expect(paid, `${tier} lost the free capability ${key}`).toContain(key);
      }
      expect(paid.length).toBeGreaterThan(free.length);
    }
  });
});
