import type { ISODateString, Metadata, Timestamped, UUID } from './primitives';

/**
 * Commercial access. Kept deliberately thin: Stripe owns billing truth, VEO
 * owns the *derived* entitlement that gates features.
 */

export const PLAN_TIERS = ['free', 'plus', 'pro', 'institution'] as const;
export type PlanTier = (typeof PLAN_TIERS)[number];

export const SUBSCRIPTION_STATUSES = [
  'active',
  'trialing',
  'past_due',
  'canceled',
  'incomplete',
  'paused',
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export interface Subscription extends Timestamped {
  readonly id: UUID;
  readonly userId: UUID;
  readonly tier: PlanTier;
  readonly status: SubscriptionStatus;
  /** Stripe identifiers. Null while a user is on the free tier. */
  readonly stripeCustomerId: string | null;
  readonly stripeSubscriptionId: string | null;
  readonly stripePriceId: string | null;
  readonly currentPeriodEnd: ISODateString | null;
  readonly cancelAtPeriodEnd: boolean;
  readonly metadata: Metadata;
}

/**
 * Capabilities a subscription grants.
 *
 * Entitlements are always resolved server-side from the subscription record.
 * Client code may read them to hide UI, but must never be trusted to enforce
 * them — every gated action re-checks on the server.
 */
export const ENTITLEMENT_KEYS = [
  'spatial.premium_models',
  'spatial.unlimited_sessions',
  'ai.tutor',
  'ai.generate_questions',
  'ai.generate_flashcards',
  'material.upload',
  'material.unlimited_uploads',
  'recall.advanced_scheduling',
  'export.notes',
] as const;
export type EntitlementKey = (typeof ENTITLEMENT_KEYS)[number];

export interface Entitlement {
  readonly key: EntitlementKey;
  readonly granted: boolean;
  /** Null means unlimited when granted. */
  readonly limit: number | null;
  readonly usage: number;
  readonly source: 'plan' | 'trial' | 'grant' | 'institution';
  readonly expiresAt: ISODateString | null;
}

/** Baseline capabilities for a signed-in user with no paid plan. */
export const FREE_TIER_ENTITLEMENTS: readonly EntitlementKey[] = [
  'material.upload',
  'ai.generate_flashcards',
];
