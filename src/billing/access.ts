import type { EntitlementKey, PlanTier } from '@/types/domain/billing';
import type { QuotaState } from './quotas';

/**
 * The answer to "may this learner do this, right now?".
 *
 * PURE. Given a tier, a capability and how much has been used today, it
 * returns one of a closed set of outcomes. No I/O, so the decision can be
 * unit-tested exhaustively rather than inferred from a route's behaviour.
 *
 * ## Why the refusal is typed
 *
 * "Forbidden" is not enough for a UI to do anything useful with. A learner who
 * has run out of today's flashcards needs a different sentence from one whose
 * plan has never included the tutor, and both need a different one from
 * somebody who is not signed in. Three situations, three remedies — so three
 * reasons, decided here once rather than guessed at in each component.
 */

export const ACCESS_DENIALS = [
  /** No authenticated learner. The remedy is to sign in. */
  'unauthenticated',
  /** Signed in, but this capability is not on their plan. Remedy: upgrade. */
  'plan_required',
  /** On their plan, but today's allowance is spent. Remedy: wait, or upgrade. */
  'quota_exhausted',
  /** The deployment cannot do this at all — no database, no provider. */
  'not_configured',
] as const;
export type AccessDenial = (typeof ACCESS_DENIALS)[number];

export type AccessDecision =
  | { readonly allowed: true; readonly tier: PlanTier; readonly quota: QuotaState | null }
  | {
      readonly allowed: false;
      readonly reason: AccessDenial;
      readonly tier: PlanTier;
      readonly quota: QuotaState | null;
    };

/**
 * Human wording for each refusal.
 *
 * Kept beside the reasons so a new denial cannot be added without one, and so
 * every surface says the same thing. None of these blames the learner or
 * pretends the action half-worked.
 */
export const DENIAL_MESSAGES: Record<AccessDenial, string> = {
  unauthenticated: 'Sign in to use this.',
  plan_required: 'This is part of a paid plan.',
  quota_exhausted: "You have used today's free allowance. It resets tomorrow.",
  not_configured: 'This is not available in this deployment.',
};

/** The HTTP status each refusal maps to. */
export const DENIAL_STATUS: Record<AccessDenial, number> = {
  unauthenticated: 401,
  // 403, not 402: 402 Payment Required is reserved and inconsistently handled
  // by intermediaries, and this is an authorization answer either way.
  plan_required: 403,
  // 429: the request was legitimate and may succeed later, which is exactly
  // what a daily allowance means. A 403 would tell the client to stop asking.
  quota_exhausted: 429,
  not_configured: 503,
};

export interface AccessInput {
  readonly tier: PlanTier;
  readonly granted: boolean;
  readonly quota: QuotaState | null;
}

/**
 * Decide access.
 *
 * Order matters and is the whole of the logic: a capability the plan does not
 * include is refused for that reason even if a quota row happens to exist, and
 * a granted capability is refused only once its allowance is genuinely spent.
 * Reversing these would tell a paying learner they had run out of something
 * they have unlimited access to.
 */
export function decide(input: AccessInput): AccessDecision {
  if (!input.granted) {
    return { allowed: false, reason: 'plan_required', tier: input.tier, quota: input.quota };
  }

  if (input.quota?.exhausted) {
    return { allowed: false, reason: 'quota_exhausted', tier: input.tier, quota: input.quota };
  }

  return { allowed: true, tier: input.tier, quota: input.quota };
}

/**
 * What the UI needs to show one capability.
 *
 * Sent to the browser so controls can be disabled and explained BEFORE a
 * learner spends an action discovering they cannot. It is a hint for
 * rendering, exactly as the auth store's entitlements have always been: the
 * server re-decides on every request regardless of what the client believes.
 */
export interface CapabilityView {
  readonly key: EntitlementKey;
  readonly granted: boolean;
  readonly limit: number | null;
  readonly used: number;
  readonly remaining: number | null;
  readonly exhausted: boolean;
  /** Null when the capability is usable right now. */
  readonly denial: AccessDenial | null;
}
