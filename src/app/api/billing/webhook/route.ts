import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { constructWebhookEvent } from '@/lib/stripe/client';
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from '@/lib/supabase/admin';
import { serverCapabilities } from '@/config/env.server';
import { PLAN_TIERS, SUBSCRIPTION_STATUSES, type PlanTier, type SubscriptionStatus } from '@/types/domain/billing';

export const dynamic = 'force-dynamic';

/**
 * The only path that may grant a plan.
 *
 * ## Why it is the only one
 *
 * `subscriptions` has a select policy and no write policy, deliberately, since
 * Gate 1. No authenticated client can insert or update it — Gate 14's database
 * verification proves that by execution. Entitlements therefore cannot be
 * self-granted through any API VEO exposes; they can only arrive here, from
 * Stripe, after a signature check.
 *
 * ## Why the signature is checked before anything else
 *
 * An unverified webhook body is attacker-controlled input that claims somebody
 * has paid. Reading a user id out of it before verifying would let anybody
 * POST themselves an institution plan. So: verify, then parse, then write —
 * and never in any other order.
 *
 * ## Why the service role is used, and only here
 *
 * Writing a subscription requires bypassing the very policy that makes
 * self-granting impossible. That is legitimate exactly once, in a handler that
 * has already proved the request came from Stripe. Every other route in VEO
 * uses the request's own client under the caller's RLS context; this one does
 * not, and says so.
 */

/** Stripe redelivers. A grant must be idempotent, not merely usually correct. */
const HANDLED_EVENTS = new Set([
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
]);

function refuse(status: number, code: string, message: string) {
  return NextResponse.json({ ok: false, error: { code, message } }, { status });
}

/** Map a Stripe status onto VEO's, refusing anything unrecognised. */
function toStatus(raw: string): SubscriptionStatus | null {
  return (SUBSCRIPTION_STATUSES as readonly string[]).includes(raw)
    ? (raw as SubscriptionStatus)
    : null;
}

/**
 * The tier a subscription confers.
 *
 * Read from metadata VEO itself set when the checkout session was created —
 * not from a price id or a product name, which are configured in a dashboard
 * and can be renamed by anyone with Stripe access. An unrecognised tier grants
 * nothing rather than defaulting upward.
 */
function toTier(raw: unknown): PlanTier | null {
  return typeof raw === 'string' && (PLAN_TIERS as readonly string[]).includes(raw)
    ? (raw as PlanTier)
    : null;
}

export async function POST(request: Request) {
  if (!serverCapabilities().stripeWebhooks) {
    return refuse(503, 'not_configured', 'Billing webhooks are not configured.');
  }
  if (!isSupabaseAdminConfigured()) {
    return refuse(503, 'not_configured', 'This deployment cannot record a subscription.');
  }

  const signature = request.headers.get('stripe-signature');
  if (!signature) {
    return refuse(400, 'unsigned', 'Missing signature.');
  }

  // The raw body, unparsed: the signature covers the exact bytes Stripe sent,
  // so re-serialising a parsed object would invalidate a genuine signature and
  // — worse — could validate a body that is not what was signed.
  const raw = await request.text();

  let event: Stripe.Event;
  try {
    event = constructWebhookEvent(raw, signature);
  } catch {
    // The message is not echoed: a signature error can reveal whether a secret
    // is configured and how it failed.
    return refuse(400, 'invalid_signature', 'Signature verification failed.');
  }

  if (!HANDLED_EVENTS.has(event.type)) {
    // 200, deliberately. An unhandled event is not an error, and returning a
    // failure would make Stripe retry it forever.
    return NextResponse.json({ ok: true, handled: false });
  }

  const object = event.data.object as unknown as Record<string, unknown>;
  const metadata = (object.metadata ?? {}) as Record<string, unknown>;

  /*
   * The learner. Taken from metadata VEO set at checkout, so it is an id this
   * deployment issued rather than one the payload asserts. A mismatch grants
   * nothing.
   */
  const userId = typeof metadata.veo_user_id === 'string' ? metadata.veo_user_id : null;
  if (!userId) {
    return refuse(400, 'unattributable', 'No VEO account is attached to this event.');
  }

  const deleted = event.type === 'customer.subscription.deleted';
  const tier = deleted ? 'free' : toTier(metadata.veo_tier);
  const status = deleted ? 'canceled' : toStatus(String(object.status ?? 'active'));

  if (!tier || !status) {
    return refuse(400, 'unrecognised', 'That plan or status is not one VEO issues.');
  }

  const admin = getSupabaseAdminClient();

  /*
   * Idempotent by construction: one row per learner, upserted. A redelivered
   * event writes the same values a second time and changes nothing, so no
   * separate event-id ledger is needed to make redelivery safe.
   */
  const { error } = await admin
    .from('subscriptions')
    .upsert(
      {
        user_id: userId,
        tier,
        status,
        stripe_customer_id: typeof object.customer === 'string' ? object.customer : null,
        stripe_subscription_id: typeof object.id === 'string' ? object.id : null,
        stripe_price_id:
          typeof object.plan === 'object' && object.plan !== null
            ? ((object.plan as Record<string, unknown>).id as string | undefined) ?? null
            : null,
        current_period_end:
          typeof object.current_period_end === 'number'
            ? new Date(object.current_period_end * 1000).toISOString()
            : null,
        cancel_at_period_end: Boolean(object.cancel_at_period_end),
        // Deliberately empty: nothing Stripe sends is copied into VEO's own
        // metadata, so a payload cannot smuggle fields into a row VEO reads.
        metadata: {},
      },
      { onConflict: 'user_id' },
    );

  if (error) {
    // 500 so Stripe retries: a grant that failed to record must not be
    // silently dropped, or a learner has paid for nothing.
    console.error('[billing] failed to record subscription', error.message);
    return refuse(500, 'not_recorded', 'Could not record the subscription.');
  }

  return NextResponse.json({ ok: true, handled: true });
}
