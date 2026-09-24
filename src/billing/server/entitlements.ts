import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { resolveEntitlements, tierFor } from '@/lib/stripe/entitlements';
import { localDate } from '@/learning/streaks';
import {
  ENTITLEMENT_KEYS,
  type Entitlement,
  type EntitlementKey,
  type PlanTier,
  type Subscription,
} from '@/types/domain/billing';
import type { UUID } from '@/types/domain/primitives';
import { decide, type AccessDecision, type CapabilityView } from '../access';
import { isMetered, limitFor, quotaState } from '../quotas';

/**
 * The entitlement boundary.
 *
 * ## What this is, and what it is not
 *
 * It is NOT a second entitlement system. `resolveEntitlements` in
 * `@/lib/stripe/entitlements` has mapped tiers to capabilities since Gate 1,
 * is pure and unit-tested, and remains the only place that decision is made.
 * This module does the two things that resolver deliberately cannot: read the
 * subscription from the database under the caller's own identity, and count
 * what has been spent today.
 *
 * ## Why identity is resolved here and nowhere else
 *
 * The same reason Gate 12 resolves it in one place: a second path to decide
 * whose plan this is would be a second chance to get it wrong, and the
 * consequence is a learner spending somebody else's allowance or reading their
 * plan. The subscription is read through the REQUEST's Supabase client, so the
 * row comes back under that user's RLS context — the policy is the boundary,
 * and this code merely asks.
 *
 * ## Why a missing subscription is not an error
 *
 * Most learners will never have a row. `subscriptions` is written only by the
 * Stripe webhook, so "no row" is the normal state of a free account, and
 * `resolveEntitlements(null)` has always returned the free baseline for
 * exactly that case. Treating absence as a failure would lock every free
 * learner out of the product.
 */

export const ENTITLEMENT_FAILURES = ['unauthenticated', 'not_configured'] as const;
export type EntitlementFailure = (typeof ENTITLEMENT_FAILURES)[number];

export interface ResolvedAccess {
  readonly userId: UUID;
  readonly tier: PlanTier;
  readonly entitlements: readonly Entitlement[];
  readonly client: SupabaseClient;
  /** The learner's local date, for the daily allowance. */
  readonly usageDate: string;
  readonly timeZone: string;
}

export type AccessResolution =
  | { readonly ok: true; readonly access: ResolvedAccess }
  | { readonly ok: false; readonly reason: EntitlementFailure };

interface SubscriptionRow {
  tier: string;
  status: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  stripe_price_id: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
}

function toSubscription(row: SubscriptionRow | null, userId: UUID): Subscription | null {
  if (!row) return null;

  return {
    id: userId,
    userId,
    tier: row.tier as PlanTier,
    status: row.status as Subscription['status'],
    stripeCustomerId: row.stripe_customer_id,
    stripeSubscriptionId: row.stripe_subscription_id,
    stripePriceId: row.stripe_price_id,
    currentPeriodEnd: row.current_period_end as Subscription['currentPeriodEnd'],
    cancelAtPeriodEnd: Boolean(row.cancel_at_period_end),
    metadata: {},
    createdAt: '' as Subscription['createdAt'],
    updatedAt: '' as Subscription['updatedAt'],
  };
}

/**
 * Resolve who is asking and what their plan grants.
 *
 * One round trip for the subscription; the learner's timezone comes from the
 * same `learning_goals` row Gate 12 already keeps, so the allowance resets on
 * their day rather than the database's.
 */
export async function resolveAccess(now: Date): Promise<AccessResolution> {
  const typed = await createSupabaseServerClient();
  if (!typed) return { ok: false, reason: 'not_configured' };

  /*
   * Widened, as Gate 12's store does for the same reason: `Database` is
   * generated from Gate 1's schema and predates `learning_goals` and
   * `entitlement_usage`, so the typed client refuses to name them.
   *
   * This loses compile-time column checking on those two tables and nothing
   * else. It does NOT widen any security boundary — the client still carries
   * the caller's cookies and the anon key, so every statement runs under their
   * own RLS context, and the policies decide what comes back.
   */
  const client = typed as unknown as SupabaseClient;

  const { data: auth, error: authError } = await client.auth.getUser();
  if (authError || !auth.user) return { ok: false, reason: 'unauthenticated' };

  const userId = auth.user.id as UUID;

  const [subscription, goal] = await Promise.all([
    client
      .from('subscriptions')
      .select(
        'tier, status, stripe_customer_id, stripe_subscription_id, stripe_price_id, current_period_end, cancel_at_period_end',
      )
      .maybeSingle(),
    client.from('learning_goals').select('time_zone').maybeSingle(),
  ]);

  const resolved = toSubscription(
    (subscription.data as SubscriptionRow | null) ?? null,
    userId,
  );

  const timeZone = (goal.data?.time_zone as string | undefined) || 'UTC';

  return {
    ok: true,
    access: {
      userId,
      tier: tierFor(resolved),
      entitlements: resolveEntitlements(resolved),
      client,
      usageDate: localDate(now, timeZone),
      timeZone,
    },
  };
}

/** Today's usage for the metered capabilities, in one read. */
export async function readUsage(
  access: ResolvedAccess,
): Promise<ReadonlyMap<EntitlementKey, number>> {
  const { data } = await access.client
    .from('entitlement_usage')
    .select('entitlement_key, used')
    .eq('usage_date', access.usageDate);

  const out = new Map<EntitlementKey, number>();
  for (const row of data ?? []) {
    const key = String(row.entitlement_key) as EntitlementKey;
    out.set(key, Number(row.used) || 0);
  }
  return out;
}

/** Whether a capability is granted by the plan, ignoring any allowance. */
export function granted(access: ResolvedAccess, key: EntitlementKey): boolean {
  return access.entitlements.some(
    (entitlement) => entitlement.key === key && entitlement.granted,
  );
}

/**
 * Decide access WITHOUT spending anything.
 *
 * For rendering: a control can be disabled and explained before a learner
 * spends an action discovering they cannot use it. The answer is advisory —
 * `consume` re-decides atomically at the moment of use, because between this
 * call and that one another tab may have spent the last of the allowance.
 */
export async function check(
  access: ResolvedAccess,
  key: EntitlementKey,
): Promise<AccessDecision> {
  const isGranted = granted(access, key);
  if (!isGranted) {
    return decide({ tier: access.tier, granted: false, quota: null });
  }

  if (!isMetered(key) || limitFor(access.tier, key) === null) {
    return decide({ tier: access.tier, granted: true, quota: null });
  }

  const usage = await readUsage(access);
  return decide({
    tier: access.tier,
    granted: true,
    quota: quotaState(access.tier, key, usage.get(key) ?? 0),
  });
}

/**
 * Decide AND spend, atomically.
 *
 * The check and the increment happen in one database statement
 * (`consume_entitlement`), because doing them separately cannot enforce a
 * limit: two requests that both read `used = 9` against a limit of 10 both
 * believe they may proceed. That window is a double-tap wide.
 *
 * The function derives the learner from `auth.uid()` itself and takes no user
 * id, so there is nothing here to forge.
 */
export async function consume(
  access: ResolvedAccess,
  key: EntitlementKey,
): Promise<AccessDecision> {
  if (!granted(access, key)) {
    return decide({ tier: access.tier, granted: false, quota: null });
  }

  const limit = limitFor(access.tier, key);

  const { data, error } = await access.client.rpc('consume_entitlement', {
    p_entitlement_key: key,
    p_usage_date: access.usageDate,
    p_limit: limit,
  });

  if (error) {
    // A failure to record usage must not silently grant free usage. Refusing
    // is the safe direction: the learner is told to try again, rather than the
    // allowance quietly becoming unlimited whenever the counter is unhealthy.
    console.error('[billing] consume_entitlement failed', error.message);
    return {
      allowed: false,
      reason: 'not_configured',
      tier: access.tier,
      quota: null,
    };
  }

  const row = Array.isArray(data) ? data[0] : data;
  const allowed = Boolean(row?.allowed);
  const used = Number(row?.used) || 0;

  const quota = limit === null ? null : quotaState(access.tier, key, used);

  if (!allowed) {
    return { allowed: false, reason: 'quota_exhausted', tier: access.tier, quota };
  }

  return { allowed: true, tier: access.tier, quota };
}

/**
 * Every capability, as the UI needs to render it.
 *
 * A hint for rendering only — exactly what the auth store's entitlements have
 * always been documented as. The server re-decides on every request whatever
 * the client believes.
 */
export async function capabilityViews(
  access: ResolvedAccess,
): Promise<CapabilityView[]> {
  const usage = await readUsage(access);

  return ENTITLEMENT_KEYS.map((key): CapabilityView => {
    const isGranted = granted(access, key);
    const quota = isGranted && isMetered(key)
      ? quotaState(access.tier, key, usage.get(key) ?? 0)
      : null;

    const decision = decide({ tier: access.tier, granted: isGranted, quota });

    return {
      key,
      granted: isGranted,
      limit: quota?.limit ?? null,
      used: quota?.used ?? usage.get(key) ?? 0,
      remaining: quota?.remaining ?? null,
      exhausted: quota?.exhausted ?? false,
      denial: decision.allowed ? null : decision.reason,
    };
  });
}
