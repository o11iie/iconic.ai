import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The webhook, driven.
 *
 * `security.test.ts` asserts the ORDER of operations by reading this route's
 * source. That catches a reordering, and nothing else: a source scan cannot
 * tell a signature check that works from one that throws away its result, and
 * this is the single endpoint in VEO that can grant a paid plan.
 *
 * So these tests execute it. The signatures below are real HMACs computed the
 * way Stripe computes them, verified by Stripe's own SDK — not stubbed, since
 * stubbing the verifier would remove the only thing under test.
 *
 * Supabase is the one substitution. It stands in for the service-role client
 * so a write can be observed, and every test asserts on what reached it —
 * including, in the refusal cases, that NOTHING did.
 */

const SECRET = 'whsec_test_secret_for_verification_only';

/** Sign a payload exactly as Stripe does: HMAC-SHA256 over `timestamp.body`. */
function sign(payload: string, secret = SECRET, timestamp = Math.floor(Date.now() / 1000)) {
  const digest = createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex');
  return `t=${timestamp},v1=${digest}`;
}

/** The writes the route attempted. Empty means it granted nothing. */
const upserts: { table: string; row: Record<string, unknown>; options: unknown }[] = [];

vi.mock('@/lib/supabase/admin', () => ({
  isSupabaseAdminConfigured: () => true,
  getSupabaseAdminClient: () => ({
    from(table: string) {
      return {
        upsert(row: Record<string, unknown>, options: unknown) {
          upserts.push({ table, row, options });
          return Promise.resolve({ error: null });
        },
      };
    },
  }),
}));

function event(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    id: 'evt_1',
    type: 'customer.subscription.created',
    data: {
      object: {
        id: 'sub_live_1',
        status: 'active',
        customer: 'cus_1',
        current_period_end: 1893456000,
        cancel_at_period_end: false,
        metadata: { veo_user_id: 'user-1', veo_tier: 'pro' },
        ...(overrides.object as Record<string, unknown>),
      },
    },
    ...overrides,
  });
}

async function post(body: string, signature: string | null) {
  const { POST } = await import('./route');
  return POST(
    new Request('http://veo.test/api/billing/webhook', {
      method: 'POST',
      headers: signature ? { 'stripe-signature': signature } : {},
      body,
    }),
  );
}

describe('the billing webhook, executed', () => {
  beforeEach(() => {
    upserts.length = 0;
    vi.resetModules();
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_not_a_real_key');
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', SECRET);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // --- the happy path, so the refusals below mean something ----------------

  it('records a subscription when the signature is genuine', async () => {
    const body = event();
    const response = await post(body, sign(body));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, handled: true });

    expect(upserts).toHaveLength(1);
    expect(upserts[0]?.table).toBe('subscriptions');
    expect(upserts[0]?.row).toMatchObject({
      user_id: 'user-1',
      tier: 'pro',
      status: 'active',
      stripe_customer_id: 'cus_1',
      stripe_subscription_id: 'sub_live_1',
    });
    // One row per learner, so a redelivery overwrites rather than duplicates.
    expect(upserts[0]?.options).toEqual({ onConflict: 'user_id' });
  });

  // --- the signature is the whole boundary ---------------------------------

  it('grants nothing when the body was tampered with after signing', async () => {
    const original = event();
    const signature = sign(original);

    // The attacker upgrades themselves and reuses the genuine signature.
    const tampered = original.replace('"veo_tier":"pro"', '"veo_tier":"institution"');
    expect(tampered).not.toBe(original);

    const response = await post(tampered, signature);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'invalid_signature' },
    });
    expect(upserts).toHaveLength(0);
  });

  it('grants nothing when the payload is signed with the wrong secret', async () => {
    const body = event();
    const response = await post(body, sign(body, 'whsec_an_attackers_own_secret'));

    expect(response.status).toBe(400);
    expect(upserts).toHaveLength(0);
  });

  it('grants nothing when the signature is missing entirely', async () => {
    const response = await post(event(), null);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'unsigned' } });
    expect(upserts).toHaveLength(0);
  });

  it('grants nothing on a replayed signature outside the tolerance window', async () => {
    // Stripe's own replay protection. A signature captured an hour ago must
    // not still grant a plan.
    const body = event();
    const stale = Math.floor(Date.now() / 1000) - 3600;
    const response = await post(body, sign(body, SECRET, stale));

    expect(response.status).toBe(400);
    expect(upserts).toHaveLength(0);
  });

  // --- what a genuine payload is still not allowed to decide ---------------

  it('refuses a tier VEO does not issue, rather than defaulting upward', async () => {
    const body = event({ object: { metadata: { veo_user_id: 'user-1', veo_tier: 'enterprise_max' } } });
    const response = await post(body, sign(body));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'unrecognised' } });
    expect(upserts).toHaveLength(0);
  });

  it('refuses an event with no VEO account attached', async () => {
    const body = event({ object: { metadata: { veo_tier: 'pro' } } });
    const response = await post(body, sign(body));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'unattributable' } });
    expect(upserts).toHaveLength(0);
  });

  it('copies nothing from the payload into the row VEO reads back', async () => {
    const body = event({
      object: {
        metadata: {
          veo_user_id: 'user-1',
          veo_tier: 'plus',
          // A payload trying to smuggle fields into VEO's own metadata.
          is_admin: 'true',
          entitlements: 'all',
        },
      },
    });
    const response = await post(body, sign(body));

    expect(response.status).toBe(200);
    expect(upserts[0]?.row.metadata).toEqual({});
    expect(JSON.stringify(upserts[0]?.row)).not.toContain('is_admin');
  });

  it('takes the tier from metadata, not from a price or product name', async () => {
    const body = event({
      object: {
        plan: { id: 'price_institution_annual', nickname: 'Institution' },
        metadata: { veo_user_id: 'user-1', veo_tier: 'plus' },
      },
    });
    const response = await post(body, sign(body));

    expect(response.status).toBe(200);
    expect(upserts[0]?.row.tier).toBe('plus');
    expect(upserts[0]?.row.stripe_price_id).toBe('price_institution_annual');
  });

  // --- lifecycle ------------------------------------------------------------

  it('revokes to free on deletion, whatever the payload claims', async () => {
    const body = event({
      type: 'customer.subscription.deleted',
      object: { status: 'active', metadata: { veo_user_id: 'user-1', veo_tier: 'institution' } },
    });
    const response = await post(body, sign(body));

    expect(response.status).toBe(200);
    expect(upserts[0]?.row).toMatchObject({ tier: 'free', status: 'canceled' });
  });

  it('acknowledges an unhandled event without writing, so Stripe stops retrying', async () => {
    const body = event({ type: 'invoice.payment_succeeded' });
    const response = await post(body, sign(body));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, handled: false });
    expect(upserts).toHaveLength(0);
  });

  it('is idempotent, because Stripe redelivers', async () => {
    const body = event();
    const signature = sign(body);

    await post(body, signature);
    await post(body, signature);

    expect(upserts).toHaveLength(2);
    expect(upserts[0]?.row).toEqual(upserts[1]?.row);
  });

  // --- unconfigured ---------------------------------------------------------

  it('refuses rather than half-working when no webhook secret is set', async () => {
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', '');
    vi.resetModules();

    const body = event();
    const response = await post(body, sign(body));

    expect(response.status).toBe(503);
    expect(upserts).toHaveLength(0);
  });
});
