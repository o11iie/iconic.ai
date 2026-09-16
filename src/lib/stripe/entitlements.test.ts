import { describe, expect, it } from 'vitest';
import type { Subscription } from '@/types/domain/billing';
import { hasEntitlement, resolveEntitlements, tierFor } from './entitlements';

function subscription(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: 'sub-1',
    userId: 'user-1',
    tier: 'pro',
    status: 'active',
    stripeCustomerId: 'cus_1',
    stripeSubscriptionId: 'sub_1',
    stripePriceId: 'price_1',
    currentPeriodEnd: '2030-01-01T00:00:00.000Z',
    cancelAtPeriodEnd: false,
    metadata: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('resolveEntitlements', () => {
  it('gives an anonymous or free user only the free capabilities', () => {
    const entitlements = resolveEntitlements(null);

    expect(hasEntitlement(entitlements, 'material.upload')).toBe(true);
    expect(hasEntitlement(entitlements, 'ai.tutor')).toBe(false);
    expect(hasEntitlement(entitlements, 'spatial.premium_models')).toBe(false);
  });

  it('unlocks tier capabilities for an active subscription', () => {
    const entitlements = resolveEntitlements(subscription({ tier: 'pro' }));

    expect(hasEntitlement(entitlements, 'ai.tutor')).toBe(true);
    expect(hasEntitlement(entitlements, 'spatial.premium_models')).toBe(true);
    expect(hasEntitlement(entitlements, 'recall.advanced_scheduling')).toBe(true);
  });

  it('honours a trial', () => {
    const entitlements = resolveEntitlements(subscription({ tier: 'plus', status: 'trialing' }));
    expect(hasEntitlement(entitlements, 'ai.tutor')).toBe(true);
  });

  it('revokes capabilities the moment a subscription lapses', () => {
    for (const status of ['past_due', 'canceled', 'incomplete', 'paused'] as const) {
      const entitlements = resolveEntitlements(subscription({ tier: 'pro', status }));
      expect(hasEntitlement(entitlements, 'ai.tutor')).toBe(false);
      expect(hasEntitlement(entitlements, 'spatial.premium_models')).toBe(false);
      // The free baseline still applies — lapsing does not lock you out entirely.
      expect(hasEntitlement(entitlements, 'material.upload')).toBe(true);
    }
  });

  it('grants institution accounts every capability', () => {
    const entitlements = resolveEntitlements(subscription({ tier: 'institution' }));
    expect(entitlements.every((entitlement) => entitlement.granted)).toBe(true);
  });

  it('reports the effective tier', () => {
    expect(tierFor(null)).toBe('free');
    expect(tierFor(subscription({ tier: 'plus' }))).toBe('plus');
    expect(tierFor(subscription({ tier: 'pro', status: 'canceled' }))).toBe('free');
  });
});
