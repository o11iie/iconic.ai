import { NextResponse } from 'next/server';
import { capabilityViews, resolveAccess } from '@/billing/server/entitlements';
import { DENIAL_STATUS } from '@/billing/access';
import { serverCapabilities } from '@/config/env.server';

export const dynamic = 'force-dynamic';

/**
 * What this learner's plan currently allows.
 *
 * Read-only, and scoped to the caller by the same identity boundary every
 * other route uses. It returns capabilities and allowances — never a Stripe
 * customer id, a price id, or anything else that identifies the account to a
 * third party.
 *
 * The client uses this to disable and explain controls BEFORE a learner spends
 * an action discovering they cannot use something. It is a rendering hint, as
 * the auth store's entitlements have always been documented: the server
 * re-decides on every request regardless of what the browser believes.
 */
export async function GET() {
  const resolution = await resolveAccess(new Date());

  if (!resolution.ok) {
    return NextResponse.json(
      { ok: false, error: { code: resolution.reason } },
      { status: DENIAL_STATUS[resolution.reason] },
    );
  }

  const capabilities = await capabilityViews(resolution.access);

  return NextResponse.json({
    ok: true,
    tier: resolution.access.tier,
    capabilities,
    /*
     * Whether this deployment can take a payment at all. Without it the plans
     * page explains the situation rather than offering a button that fails —
     * the same discipline Gate 9 applies to unavailable anatomy.
     */
    checkoutAvailable: serverCapabilities().stripe,
    // The learner's own timezone, so the UI can say when the allowance resets
    // in their day rather than the server's.
    timeZone: resolution.access.timeZone,
  });
}
