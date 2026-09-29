import type { PlanTier, SubscriptionStatus } from '@/types/domain/billing';

/**
 * Account lifecycle decisions.
 *
 * Pure. No database, no clock, no network — so the rules that decide whether
 * somebody's account may be destroyed are readable in one place and testable
 * without standing anything up.
 *
 * The orchestration lives in `server/account-service.ts`. This module only
 * answers "may this proceed, and if not, why?".
 */

// ---------------------------------------------------------------------------
// Deleting an account
// ---------------------------------------------------------------------------

/**
 * The phrase a learner must type.
 *
 * A checkbox is not confirmation of an irreversible act: it is one
 * mis-aimed tap. Typing the words takes a deliberate decision, and the
 * server — not the browser — is what checks them, so a client that skipped
 * its own confirmation step still cannot delete anything.
 */
export const DELETION_CONFIRMATION = 'DELETE MY ACCOUNT';

export const DELETION_REFUSALS = [
  'unauthenticated',
  'not_confirmed',
  'not_configured',
  'active_subscription',
  'failed',
] as const;
export type DeletionRefusal = (typeof DELETION_REFUSALS)[number];

export const DELETION_STATUS: Record<DeletionRefusal, number> = {
  unauthenticated: 401,
  not_confirmed: 400,
  not_configured: 503,
  active_subscription: 409,
  failed: 500,
};

export const DELETION_MESSAGES: Record<DeletionRefusal, string> = {
  unauthenticated: 'Sign in to delete your account.',
  not_confirmed: `Type ${DELETION_CONFIRMATION} to confirm.`,
  not_configured:
    'This deployment cannot delete accounts. Deleting an account requires a configured service role, and VEO will not half-delete one.',
  active_subscription:
    'Cancel your subscription before deleting your account, so you are not charged for an account that no longer exists.',
  failed: 'VEO could not delete your account. Nothing has been changed.',
};

/** Whether a subscription is one somebody is still being billed for. */
export function isBillable(
  tier: PlanTier | null,
  status: SubscriptionStatus | null,
): boolean {
  if (!tier || tier === 'free') return false;
  return status === 'active' || status === 'trialing' || status === 'past_due';
}

export interface DeletionInput {
  /** Resolved from the session, never from the request body. */
  readonly userId: string | null;
  /** Exactly what the learner typed. */
  readonly confirmation: string;
  /** Whether a service role is configured — deletion needs one. */
  readonly adminConfigured: boolean;
  /** Whether VEO can cancel a subscription on their behalf. */
  readonly stripeConfigured: boolean;
  readonly tier: PlanTier | null;
  readonly status: SubscriptionStatus | null;
}

export type DeletionDecision =
  | {
      readonly allowed: true;
      readonly userId: string;
      /**
       * Whether a live subscription must be cancelled first.
       *
       * Deletion is not permitted to leave one running: the account would be
       * gone and the card would keep being charged, with nothing left in VEO
       * to cancel it from.
       */
      readonly cancelSubscriptionFirst: boolean;
    }
  | { readonly allowed: false; readonly reason: DeletionRefusal };

export function decideDeletion(input: DeletionInput): DeletionDecision {
  if (!input.userId) return { allowed: false, reason: 'unauthenticated' };

  // Checked before anything else that could have a side effect.
  if (input.confirmation !== DELETION_CONFIRMATION) {
    return { allowed: false, reason: 'not_confirmed' };
  }

  if (!input.adminConfigured) return { allowed: false, reason: 'not_configured' };

  const billable = isBillable(input.tier, input.status);

  if (billable && !input.stripeConfigured) {
    // VEO cannot cancel it, so it must not delete the only record of who is
    // being billed. Refusing is the safe direction.
    return { allowed: false, reason: 'active_subscription' };
  }

  return { allowed: true, userId: input.userId, cancelSubscriptionFirst: billable };
}

// ---------------------------------------------------------------------------
// Updating a profile
// ---------------------------------------------------------------------------

/**
 * What a learner may change about themselves.
 *
 * Listed as a closed set rather than "whatever the body contains", so a field
 * that should never be client-writable — user_id, onboarded_at, anything
 * added to the table later — cannot become writable by accident.
 */
export const EDITABLE_PROFILE_FIELDS = [
  'displayName',
  'level',
  'timeZone',
  'locale',
  'interests',
  'preferences',
] as const;
export type EditableProfileField = (typeof EDITABLE_PROFILE_FIELDS)[number];

/** Fields a client may never write, asserted by the tests rather than trusted. */
export const PROTECTED_PROFILE_FIELDS = [
  'user_id',
  'id',
  'onboarded_at',
  'created_at',
  'updated_at',
  'metadata',
] as const;
