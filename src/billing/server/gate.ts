import 'server-only';

import { NextResponse } from 'next/server';
import { stubEnabled } from '@/ai/providers/verification-stub';
import type { EntitlementKey } from '@/types/domain/billing';
import { DENIAL_MESSAGES, DENIAL_STATUS, type AccessDenial } from '../access';
import { consume, resolveAccess, type ResolvedAccess } from './entitlements';

/**
 * The gate every paid action passes through.
 *
 * ## The defect this closes
 *
 * Before Gate 14, `/api/ai/tutor`, `/api/ai/questions` and
 * `/api/ai/flashcards` had no authentication of any kind. Anyone who could
 * reach the deployment could spend its OpenAI budget, without an account,
 * without a limit, and without leaving a record of who did it. Gate 1's
 * entitlement resolver was written to prevent exactly that and had never been
 * called by a single line of production code.
 *
 * ## Why the verification stub is exempt, and why that is not a bypass
 *
 * When `stubEnabled()` is true, VEO is not talking to a paid provider — it is
 * serving deterministic fixture text assembled from the caller's own context.
 * Two properties of that flag, both from Gate 10, make the exemption safe:
 *
 *   1. It is read as a LITERAL `process.env.VEO_TUTOR_STUB`, which Next
 *      inlines at BUILD time. A production bundle built without it cannot be
 *      talked into stub mode by any later environment change — the branch is
 *      not in the bundle.
 *   2. It refuses to activate whenever `OPENAI_API_KEY` is set, so it can
 *      never shadow a configured provider.
 *
 * So the exemption cannot grant access to anything that costs money or
 * belongs to anybody. It grants access to canned strings. That is materially
 * different from an authentication bypass, and it is what keeps the public
 * `/explore` demonstration — Gate 2's deliberate decision — working without
 * putting a real provider behind an open door.
 *
 * The moment a real key is configured, every one of these routes requires an
 * authenticated, entitled learner. There is no flag that changes that.
 */

export interface GateFailure {
  readonly response: NextResponse;
  readonly reason: AccessDenial;
}

export type GateResult =
  | { readonly ok: true; readonly access: ResolvedAccess | null }
  | { readonly ok: false; readonly failure: GateFailure };

function refuse(reason: AccessDenial, quota: unknown = null): GateFailure {
  return {
    reason,
    response: NextResponse.json(
      {
        ok: false,
        error: {
          code: reason,
          message: DENIAL_MESSAGES[reason],
          // What the UI needs to explain the refusal and offer the remedy.
          // Never the learner's id, their subscription, or anything about
          // another account.
          ...(quota ? { quota } : {}),
        },
      },
      { status: DENIAL_STATUS[reason] },
    ),
  };
}

/**
 * Require an entitlement, and spend one unit of its allowance.
 *
 * Spends BEFORE the work runs, not after. A provider call that fails still
 * cost the deployment money and still occupied the slot, and refunding on
 * failure would hand anybody an unlimited allowance by way of a malformed
 * request. The learner loses one of ten flashcards to a provider outage; the
 * alternative is that a scripted failure loop costs unbounded money.
 */
export async function requireEntitlement(
  key: EntitlementKey,
  now: Date = new Date(),
): Promise<GateResult> {
  // See the note above. Stub content is not a paid resource.
  if (stubEnabled()) return { ok: true, access: null };

  const resolution = await resolveAccess(now);
  if (!resolution.ok) {
    return { ok: false, failure: refuse(resolution.reason) };
  }

  const decision = await consume(resolution.access, key);
  if (!decision.allowed) {
    return { ok: false, failure: refuse(decision.reason, decision.quota) };
  }

  return { ok: true, access: resolution.access };
}
