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
