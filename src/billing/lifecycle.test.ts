import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hasEntitlement, resolveEntitlements, tierFor } from '@/lib/stripe/entitlements';
import type { EntitlementKey, PlanTier } from '@/types/domain/billing';
import type { UUID } from '@/types/domain/primitives';

/**
 * The subscription lifecycle, end to end, through the real webhook.
 *
 * ## What this proves that the unit tests do not
 *
 * `webhook/route.test.ts` proves the endpoint verifies a signature and writes
 * the right row. `entitlements.test.ts` proves the resolver maps a tier to
 * capabilities. Neither proves the thing a customer actually experiences:
 * that paying, renewing, failing a payment, downgrading and cancelling each
 * END with the right access.
 *
 * So each case below drives a genuinely signed Stripe event through the real
 * route, takes the row it wrote, and resolves entitlements from it using the
 * SAME function the server uses on every request. The assertion is on
 * capabilities, not on columns.
 *
 * ## Classification
 *
 * ENGINEERING VERIFIED, not production end-to-end. No Stripe account is
 * configured in this environment, so no real checkout session was created and
 * no card was charged. What IS real: the signature verification (Stripe's own
 * SDK, over HMACs computed the way Stripe computes them), the route, the
 * event shapes, the row that gets written, and the entitlement resolution.
 * What is substituted: Supabase, and the fact that Stripe rather than this
 * test sent the event.
 */

const SECRET = 'whsec_test_secret_for_verification_only';
const USER = '11111111-1111-4111-8111-111111111111' as UUID;

function sign(payload: string, secret = SECRET, timestamp = Math.floor(Date.now() / 1000)) {
  const digest = createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex');
  return `t=${timestamp},v1=${digest}`;
}

/** The rows the webhook wrote, newest last. */
const written: Record<string, unknown>[] = [];

vi.mock('@/lib/supabase/admin', () => ({
  isSupabaseAdminConfigured: () => true,
  getSupabaseAdminClient: () => ({
    from: () => ({
      upsert(row: Record<string, unknown>) {
        written.push(row);
        return Promise.resolve({ error: null });
      },
    }),
  }),
}));

interface EventOptions {
  readonly type?: string;
  readonly tier?: string;
  readonly status?: string;
  readonly cancelAtPeriodEnd?: boolean;
  readonly periodEnd?: number;
}

function stripeEvent(options: EventOptions = {}): string {
  return JSON.stringify({
    id: `evt_${Math.random().toString(36).slice(2)}`,
    type: options.type ?? 'customer.subscription.updated',
    data: {
      object: {
        id: 'sub_lifecycle_1',
        status: options.status ?? 'active',
        customer: 'cus_lifecycle_1',
        cancel_at_period_end: options.cancelAtPeriodEnd ?? false,
        current_period_end: options.periodEnd ?? 1_893_456_000,
        metadata: { veo_user_id: USER, veo_tier: options.tier ?? 'pro' },
      },
    },
  });
}

async function deliver(body: string, signature = sign(body)) {
  const { POST } = await import('@/app/api/billing/webhook/route');
  return POST(
    new Request('http://veo.test/api/billing/webhook', {
      method: 'POST',
      headers: { 'stripe-signature': signature },
      body,
    }),
  );
}

/**
 * The capabilities the last written row grants.
 *
 * Goes through the product's own row mapping and Gate 1's resolver, so this
 * is what the server would decide on the learner's next request.
 */
async function capabilitiesAfterLastEvent(): Promise<{
  tier: PlanTier;
  has: (key: EntitlementKey) => boolean;
}> {
  const { toSubscription } = await import('@/billing/server/entitlements');
  const row = written.at(-1);
  expect(row, 'the event should have written a row').toBeDefined();

  const subscription = toSubscription(
    {
      tier: row!.tier as string,
      status: row!.status as string,
      stripe_customer_id: row!.stripe_customer_id as string | null,
      stripe_subscription_id: row!.stripe_subscription_id as string | null,
      stripe_price_id: row!.stripe_price_id as string | null,
      current_period_end: row!.current_period_end as string | null,
      cancel_at_period_end: row!.cancel_at_period_end as boolean,
    },
    USER,
  );

  const entitlements = resolveEntitlements(subscription);
  return {
    tier: tierFor(subscription),
    has: (key) => hasEntitlement(entitlements, key),
  };
}

describe('the subscription lifecycle', () => {
  beforeEach(() => {
    written.length = 0;
    vi.resetModules();
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_not_a_real_key');
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', SECRET);
  });

  afterEach(() => vi.unstubAllEnvs());

  it('free to paid: the tutor becomes available', async () => {
    // Before anything, with no subscription at all.
    const free = resolveEntitlements(null);
    expect(hasEntitlement(free, 'ai.tutor')).toBe(false);
    expect(hasEntitlement(free, 'ai.generate_flashcards')).toBe(true);

    const response = await deliver(
      stripeEvent({ type: 'checkout.session.completed', tier: 'pro' }),
    );
    expect(response.status).toBe(200);

    const after = await capabilitiesAfterLastEvent();
    expect(after.tier).toBe('pro');
    expect(after.has('ai.tutor')).toBe(true);
    expect(after.has('spatial.premium_models')).toBe(true);
    expect(after.has('recall.advanced_scheduling')).toBe(true);
  });

  it('renewal keeps access exactly as it was', async () => {
    await deliver(stripeEvent({ tier: 'pro', periodEnd: 1_893_456_000 }));
    const before = await capabilitiesAfterLastEvent();

    await deliver(stripeEvent({ tier: 'pro', periodEnd: 1_896_134_400 }));
    const after = await capabilitiesAfterLastEvent();

    expect(after.tier).toBe(before.tier);
    expect(after.has('ai.tutor')).toBe(true);
    // The period moved, which is the only thing a renewal changes.
    expect(written.at(-1)!.current_period_end).not.toBe(written.at(0)!.current_period_end);
  });

  it('cancel at period end keeps access until the period ends', async () => {
    await deliver(stripeEvent({ tier: 'pro', status: 'active', cancelAtPeriodEnd: true }));

    const after = await capabilitiesAfterLastEvent();

    // Still active, still paid for. Revoking here would take away access
    // somebody has already paid for, which is the most expensive possible way
    // to be wrong about a subscription.
    expect(after.tier).toBe('pro');
    expect(after.has('ai.tutor')).toBe(true);
    expect(written.at(-1)!.cancel_at_period_end).toBe(true);
  });

  it('cancellation revokes paid access and leaves the free baseline', async () => {
    await deliver(stripeEvent({ type: 'customer.subscription.deleted', tier: 'pro' }));

    const after = await capabilitiesAfterLastEvent();

    expect(after.tier).toBe('free');
    expect(after.has('ai.tutor')).toBe(false);
    expect(after.has('spatial.premium_models')).toBe(false);
    // Cancelling is not being locked out: the free tier still applies.
    expect(after.has('ai.generate_flashcards')).toBe(true);
    expect(after.has('material.upload')).toBe(true);
  });

  it('a failed payment suspends paid access without deleting the account', async () => {
    await deliver(stripeEvent({ tier: 'pro', status: 'past_due' }));

    const after = await capabilitiesAfterLastEvent();

    expect(after.tier).toBe('free');
    expect(after.has('ai.tutor')).toBe(false);
    // The row still records what they were on, so a successful retry restores
    // it without them having to buy the plan again.
    expect(written.at(-1)!.tier).toBe('pro');
    expect(written.at(-1)!.status).toBe('past_due');
  });

  it('reactivation after a failed payment restores access', async () => {
    await deliver(stripeEvent({ tier: 'pro', status: 'past_due' }));
    expect((await capabilitiesAfterLastEvent()).has('ai.tutor')).toBe(false);

    await deliver(stripeEvent({ tier: 'pro', status: 'active' }));
    const after = await capabilitiesAfterLastEvent();

    expect(after.tier).toBe('pro');
    expect(after.has('ai.tutor')).toBe(true);
  });

  it('an upgrade grants the new tier immediately', async () => {
    await deliver(stripeEvent({ tier: 'plus' }));
    const before = await capabilitiesAfterLastEvent();
    expect(before.tier).toBe('plus');
    expect(before.has('spatial.premium_models')).toBe(false);

    await deliver(stripeEvent({ tier: 'pro' }));
    const after = await capabilitiesAfterLastEvent();

    expect(after.tier).toBe('pro');
    expect(after.has('spatial.premium_models')).toBe(true);
    expect(after.has('ai.tutor')).toBe(true);
  });

  it('a downgrade removes what the lower tier does not include', async () => {
    await deliver(stripeEvent({ tier: 'pro' }));
    expect((await capabilitiesAfterLastEvent()).has('export.notes')).toBe(true);

    await deliver(stripeEvent({ tier: 'plus' }));
    const after = await capabilitiesAfterLastEvent();

    expect(after.tier).toBe('plus');
    // Kept: Plus includes the tutor.
    expect(after.has('ai.tutor')).toBe(true);
    // Lost: these are Pro's.
    expect(after.has('export.notes')).toBe(false);
    expect(after.has('spatial.premium_models')).toBe(false);
    expect(after.has('recall.advanced_scheduling')).toBe(false);
  });

  it('a trial grants the tier it is a trial of', async () => {
    await deliver(stripeEvent({ tier: 'plus', status: 'trialing' }));
    const after = await capabilitiesAfterLastEvent();

    expect(after.tier).toBe('plus');
    expect(after.has('ai.tutor')).toBe(true);
  });
});

describe('what no event may do', () => {
  beforeEach(() => {
    written.length = 0;
    vi.resetModules();
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_not_a_real_key');
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', SECRET);
  });

  afterEach(() => vi.unstubAllEnvs());

  it('a duplicate delivery leaves exactly the same access', async () => {
    const body = stripeEvent({ tier: 'pro' });
    const signature = sign(body);

    await deliver(body, signature);
    const first = await capabilitiesAfterLastEvent();

    await deliver(body, signature);
    const second = await capabilitiesAfterLastEvent();

    expect(second.tier).toBe(first.tier);
    expect(written).toHaveLength(2);
    expect(written[0]).toEqual(written[1]);
  });

  it('a replay from outside the tolerance window grants nothing', async () => {
    const body = stripeEvent({ tier: 'institution' });
    const stale = Math.floor(Date.now() / 1000) - 3600;

    const response = await deliver(body, sign(body, SECRET, stale));

    expect(response.status).toBe(400);
    expect(written).toHaveLength(0);
  });

  it('a body edited after signing grants nothing', async () => {
    const original = stripeEvent({ tier: 'plus' });
    const signature = sign(original);
    const tampered = original.replace('"veo_tier":"plus"', '"veo_tier":"institution"');

    const response = await deliver(tampered, signature);

    expect(response.status).toBe(400);
    expect(written).toHaveLength(0);
  });

  it('a malformed payload with a VALID signature is refused, not parsed', async () => {
    /*
     * The case a signature check alone does not cover: an attacker who
     * somehow obtained the secret still cannot make the route act on
     * something that is not a Stripe event. Signed correctly, so the
     * signature is not what rejects it.
     */
    const body = 'this is not json at all';
    const response = await deliver(body, sign(body));

    expect(response.status).toBe(400);
    expect(written).toHaveLength(0);
  });

  it('an unknown tier grants nothing rather than defaulting upward', async () => {
    const response = await deliver(stripeEvent({ tier: 'platinum_unlimited' }));

    expect(response.status).toBe(400);
    expect(written).toHaveLength(0);
  });

  it('an unknown status grants nothing', async () => {
    const response = await deliver(stripeEvent({ status: 'gifted' }));

    expect(response.status).toBe(400);
    expect(written).toHaveLength(0);
  });

  it('an event with no VEO account attached grants nothing', async () => {
    const body = JSON.stringify({
      id: 'evt_x',
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_1',
          status: 'active',
          customer: 'cus_someone_else',
          metadata: { veo_tier: 'institution' },
        },
      },
    });

    const response = await deliver(body, sign(body));

    expect(response.status).toBe(400);
    expect(written).toHaveLength(0);
  });
});
