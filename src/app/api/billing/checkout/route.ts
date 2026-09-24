import { NextResponse } from 'next/server';
import { z } from 'zod';
import { PLAN_TIERS } from '@/types/domain/billing';
import { resolveAccess } from '@/billing/server/entitlements';
import { DENIAL_STATUS } from '@/billing/access';
import { serverCapabilities } from '@/config/env.server';

export const dynamic = 'force-dynamic';

/**
 * Begin a checkout.
 *
 * The client names a TIER, from a closed set — never a price, an amount, a
 * currency or a Stripe price id. A browser that could name its own price could
 * buy an institution plan for a penny, and no amount of server-side validation
 * of a client-supplied number is as safe as not accepting one.
 *
 * Stripe is an external dependency and is not configured in every deployment.
 * Where it is absent this says so plainly, with the status that means "the
 * server cannot do this", rather than failing somewhere deeper with an error
 * about a missing key.
 */

const bodySchema = z
  .object({
    // 'free' is deliberately excluded: there is nothing to buy, and accepting
    // it would create a checkout that can only ever fail.
    tier: z.enum(PLAN_TIERS.filter((tier) => tier !== 'free') as [string, ...string[]]),
  })
  .strict();

export async function POST(request: Request) {
  // Identity first: an unauthenticated caller has no account to attach a
  // subscription to, and should be told to sign in rather than shown a
  // payment form.
  const resolution = await resolveAccess(new Date());
  if (!resolution.ok) {
    return NextResponse.json(
      { ok: false, error: { code: resolution.reason } },
      { status: DENIAL_STATUS[resolution.reason] },
    );
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: { code: 'invalid_request', message: 'That request could not be read.' } },
      { status: 400 },
    );
  }

  const parsed = bodySchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: { code: 'invalid_request', message: 'That is not a plan VEO offers.' } },
      { status: 400 },
    );
  }

  if (!serverCapabilities().stripe) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: 'not_configured',
          message:
            'Payments are not set up in this deployment, so VEO cannot start a checkout.',
          // Names the variable, never a value. Gate 8's rule for the anatomy
          // provider, applied to the billing provider.
          requirement: 'STRIPE_SECRET_KEY',
        },
      },
      { status: 503 },
    );
  }

  /*
   * Reached only when Stripe is configured, which it is not in any verified
   * deployment. Creating the session belongs here, using the existing
   * server-only client in `@/lib/stripe/client` — never a second one.
   *
   * It is deliberately not written speculatively. A checkout flow that has
   * never run against Stripe is not a working checkout flow, and shipping one
   * that merely compiles would be exactly the fake success state this build
   * has avoided everywhere else. See VEO_BUILD_STATUS.md.
   */
  return NextResponse.json(
    {
      ok: false,
      error: {
        code: 'not_configured',
        message: 'Checkout has not been completed against a live Stripe account.',
      },
    },
    { status: 503 },
  );
}
