import 'server-only';

import Stripe from 'stripe';
import { serverEnv } from '@/config/env.server';
import { VeoError } from '@/lib/errors';

/**
 * Stripe abstraction.
 *
 * SERVER-ONLY. Two rules this layer exists to enforce:
 *   1. Entitlements are derived from Stripe, never from the client. A browser
 *      that could write `subscriptions` could grant itself a paid plan, which
 *      is why RLS gives that table no client write policy at all.
 *   2. Webhooks are verified by signature before anything is granted.
 */

let stripe: Stripe | null = null;

export function isStripeConfigured(): boolean {
  return Boolean(serverEnv().STRIPE_SECRET_KEY);
}

export function getStripeClient(): Stripe {
  if (stripe) return stripe;

  const key = serverEnv().STRIPE_SECRET_KEY;
  if (!key) {
    throw new VeoError('Stripe is not configured.', {
      code: 'provider_not_configured',
      userMessage: 'Billing is not available in this environment.',
    });
  }

  stripe = new Stripe(key);
  return stripe;
}

/**
 * Verify a webhook signature and return the parsed event.
 *
 * Throws when the signature does not match. An unverified webhook body is
 * attacker-controlled input and must never be trusted to change entitlements.
 */
export function constructWebhookEvent(payload: string, signature: string): Stripe.Event {
  const secret = serverEnv().STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    throw new VeoError('STRIPE_WEBHOOK_SECRET is not configured.', {
      code: 'provider_not_configured',
    });
  }

  return getStripeClient().webhooks.constructEvent(payload, signature, secret);
}

/**
 * Cancel a subscription at Stripe, immediately.
 *
 * Returns whether it is now cancelled. Used by account deletion, where the
 * answer decides whether the deletion may proceed at all — so a failure is
 * reported rather than thrown: the caller must be able to refuse cleanly
 * instead of leaving a half-deleted account behind.
 *
 * A subscription Stripe says is already cancelled counts as success, because
 * the postcondition the caller needs — "nobody is being billed for this" —
 * holds either way. Retrying a cancel is a normal thing to happen.
 */
export async function cancelSubscriptionAtStripe(subscriptionId: string): Promise<boolean> {
  if (!isStripeConfigured()) return false;

  try {
    const subscription = await getStripeClient().subscriptions.cancel(subscriptionId);
    return subscription.status === 'canceled';
  } catch (error) {
    // The message is not returned to the caller: a Stripe error can name the
    // account, the key prefix, or the reason a key was rejected.
    const code = error instanceof Error ? error.name : 'unknown';
    if (code === 'StripeInvalidRequestError') {
      // Most commonly "no such subscription" — already gone, so the
      // postcondition holds.
      return true;
    }
    return false;
  }
}
