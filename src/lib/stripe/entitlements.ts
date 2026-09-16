import {
  ENTITLEMENT_KEYS,
  FREE_TIER_ENTITLEMENTS,
  type Entitlement,
  type EntitlementKey,
  type PlanTier,
  type Subscription,
} from '@/types/domain/billing';

/**
 * Plan -> capability mapping.
 *
 * Pure and dependency-free, so it is unit-testable and can be evaluated on the
 * server without a Stripe round trip. This is the single place that decides
 * what a tier unlocks.
 */

const TIER_ENTITLEMENTS: Record<PlanTier, readonly EntitlementKey[]> = {
  free: FREE_TIER_ENTITLEMENTS,
  plus: [
    'material.upload',
    'material.unlimited_uploads',
    'ai.tutor',
    'ai.generate_flashcards',
    'ai.generate_questions',
    'spatial.unlimited_sessions',
  ],
  pro: [
    'material.upload',
    'material.unlimited_uploads',
    'ai.tutor',
    'ai.generate_flashcards',
    'ai.generate_questions',
    'spatial.unlimited_sessions',
    'spatial.premium_models',
    'recall.advanced_scheduling',
    'export.notes',
  ],
  institution: [...ENTITLEMENT_KEYS],
};

/** A subscription only confers entitlements while it is actually in good standing. */
const ACTIVE_STATUSES = new Set(['active', 'trialing']);

/**
 * Resolve entitlements for a subscription.
 *
 * SERVER-SIDE AUTHORITY. Client code may read the result to hide controls, but
 * every gated action re-resolves this on the server before acting.
 */
export function resolveEntitlements(subscription: Subscription | null): Entitlement[] {
  const tier: PlanTier =
    subscription && ACTIVE_STATUSES.has(subscription.status) ? subscription.tier : 'free';

  const granted = new Set(TIER_ENTITLEMENTS[tier]);

  return ENTITLEMENT_KEYS.map((key) => ({
    key,
    granted: granted.has(key),
    limit: null,
    usage: 0,
    source: tier === 'free' ? 'plan' : subscription?.status === 'trialing' ? 'trial' : 'plan',
    expiresAt: subscription?.currentPeriodEnd ?? null,
  }));
}

export function hasEntitlement(
  entitlements: readonly Entitlement[],
  key: EntitlementKey,
): boolean {
  return entitlements.some((entitlement) => entitlement.key === key && entitlement.granted);
}

export function tierFor(subscription: Subscription | null): PlanTier {
  if (!subscription || !ACTIVE_STATUSES.has(subscription.status)) return 'free';
  return subscription.tier;
}
