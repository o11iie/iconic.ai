import 'server-only';

import { z } from 'zod';
import { createSupabaseServerClient, getServerUser } from '@/lib/supabase/server';
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from '@/lib/supabase/admin';
import { cancelSubscriptionAtStripe, isStripeConfigured } from '@/lib/stripe/client';
import { serverLog } from '@/observability/log';
import { LEARNING_LEVELS } from '@/types/domain/user';
import type { PlanTier, SubscriptionStatus } from '@/types/domain/billing';
import {
  decideDeletion,
  DELETION_MESSAGES,
  type DeletionRefusal,
} from '../lifecycle';

/**
 * The account lifecycle, executed.
 *
 * Identity is resolved from the Supabase session on every call. No function
 * here accepts a user id: a route cannot forget to check one it was never
 * given, which is the same discipline Gate 12's `resolveLearning` applies to
 * learning data.
 *
 * ## Why deletion uses the service role
 *
 * Removing a learner means removing their `auth.users` row, and every
 * user-owned table in VEO cascades from it. A learner's own client cannot
 * delete from `auth.users` — nor should it be able to — so this is the second
 * legitimate use of the admin client, after the Stripe webhook. Both are
 * handlers that have already established who is asking; neither takes an
 * identifier from a request body.
 *
 * ## Why billing records are not separately preserved
 *
 * VEO's `subscriptions` table is a derived cache of Stripe's state, not the
 * financial record. Stripe retains the customer, its invoices and its payment
 * history independently of VEO, and that is what any retention obligation
 * actually attaches to. Deleting VEO's row therefore destroys no record that
 * must be kept — it destroys a copy — while leaving VEO holding nothing about
 * a person who asked to be forgotten.
 *
 * What deletion must NOT do is leave a live subscription running. The account
 * would be gone and the card would keep being charged, with nothing left in
 * VEO to cancel it from. So a billable subscription is cancelled at Stripe
 * first, and if that cannot be done the deletion is refused rather than
 * half-completed.
 */

export interface ProfileView {
  readonly displayName: string | null;
  readonly level: string;
  readonly timeZone: string;
  readonly locale: string;
  readonly interests: readonly string[];
  readonly onboardedAt: string | null;
  readonly email: string | null;
  readonly emailVerified: boolean;
}

const levels = LEARNING_LEVELS as readonly string[];

/**
 * What a learner may send.
 *
 * Every field is optional so a form can submit only what it changed, and
 * every field is bounded — an unbounded display name is a storage cost and a
 * rendering hazard, not a feature.
 */
export const profileUpdateSchema = z
  .object({
    displayName: z.string().trim().min(1).max(80),
    level: z.enum(levels as [string, ...string[]]),
    timeZone: z.string().trim().min(1).max(64),
    locale: z.string().trim().min(2).max(16),
    interests: z.array(z.string().trim().min(1).max(40)).max(12),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Nothing to update.',
  });

export type ProfileUpdate = z.infer<typeof profileUpdateSchema>;

/**
 * The exact columns this module may write.
 *
 * Typed rather than `Record<string, unknown>` so a column name that does not
 * exist — or one that exists but must never be client-writable — is a
 * compile error rather than a silently ignored key.
 */
type ProfileUpdateRow = Partial<{
  display_name: string;
  level: 'foundation' | 'intermediate' | 'advanced' | 'professional';
  timezone: string;
  locale: string;
  interests: string[];
}>;

export type ProfileResult =
  | { readonly ok: true; readonly profile: ProfileView }
  | {
      readonly ok: false;
      /**
       * `unavailable` rather than `failed`, matching the learning and
       * analytics routes.
       *
       * The cause is the same in all three — VEO could not reach the
       * database — and it is not a defect in VEO. Reporting it as an internal
       * error would tell a learner their account is broken when their
       * account is fine and a dependency is down, and would send an operator
       * looking in the wrong place.
       */
      readonly reason: 'unauthenticated' | 'not_configured' | 'unavailable';
    };

/** The signed-in learner's profile. */
export async function readProfile(): Promise<ProfileResult> {
  const client = await createSupabaseServerClient();
  if (!client) return { ok: false, reason: 'not_configured' };

  const { data: auth, error: authError } = await client.auth.getUser();
  if (authError || !auth.user) return { ok: false, reason: 'unauthenticated' };

  const { data, error } = await client
    .from('profiles')
    .select('display_name, level, timezone, locale, interests, onboarded_at')
    .eq('user_id', auth.user.id)
    .maybeSingle();

  if (error) {
    serverLog('error', 'account.profile_read_failed', { reason: error.message });
    return { ok: false, reason: 'unavailable' };
  }

  return {
    ok: true,
    profile: {
      displayName: data?.display_name ?? null,
      level: data?.level ?? 'foundation',
      timeZone: data?.timezone ?? 'UTC',
      locale: data?.locale ?? 'en',
      interests: data?.interests ?? [],
      onboardedAt: data?.onboarded_at ?? null,
      email: auth.user.email ?? null,
      // Supabase records when the address was confirmed. Reported rather than
      // assumed: a deployment with confirmation switched off has verified
      // nothing, and saying otherwise would be a fake success state.
      emailVerified: Boolean(auth.user.email_confirmed_at),
    },
  };
}

/**
 * Update the signed-in learner's profile.
 *
 * The write is made with the REQUEST's client, so it runs under that
 * learner's RLS context and the `profiles_update_own` policy applies. The
 * `.eq('user_id', ...)` below is belt and braces, not the boundary.
 */
export async function updateProfile(update: ProfileUpdate): Promise<ProfileResult> {
  const client = await createSupabaseServerClient();
  if (!client) return { ok: false, reason: 'not_configured' };

  const { data: auth, error: authError } = await client.auth.getUser();
  if (authError || !auth.user) return { ok: false, reason: 'unauthenticated' };

  /*
   * Built field by field from the parsed input. Never spread from the request
   * body: a spread would write whatever arrived, so adding a column to
   * `profiles` would silently make it client-writable.
   */
  const row: ProfileUpdateRow = {};
  if (update.displayName !== undefined) row.display_name = update.displayName;
  if (update.level !== undefined) row.level = update.level as ProfileUpdateRow['level'];
  if (update.timeZone !== undefined) row.timezone = update.timeZone;
  if (update.locale !== undefined) row.locale = update.locale;
  if (update.interests !== undefined) row.interests = [...update.interests];

  if (Object.keys(row).length === 0) return readProfile();

  const { error } = await client.from('profiles').update(row).eq('user_id', auth.user.id);

  if (error) {
    serverLog('error', 'account.profile_update_failed', { reason: error.message });
    return { ok: false, reason: 'unavailable' };
  }

  serverLog('info', 'account.profile_updated', { fields: Object.keys(row).join(',') });
  return readProfile();
}

// ---------------------------------------------------------------------------

export type DeletionResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: DeletionRefusal; readonly message: string };

function refuse(reason: DeletionRefusal): DeletionResult {
  return { ok: false, reason, message: DELETION_MESSAGES[reason] };
}

/**
 * Delete the signed-in learner's account, and everything that belongs to it.
 *
 * Order matters and is deliberate:
 *   1. Establish who is asking, from the session.
 *   2. Read their subscription, server-side.
 *   3. Decide — purely — whether this may proceed.
 *   4. Cancel a live subscription at Stripe, refusing if that fails.
 *   5. Delete the auth user, which cascades every user-owned row.
 *   6. Sign out, so the cookie this request arrived with is dead.
 *
 * Step 4 before step 5: cancelling and then failing to delete leaves somebody
 * with an account and no subscription, which is recoverable. Deleting and then
 * failing to cancel leaves a charge nobody can stop, which is not.
 */
export async function deleteAccount(confirmation: string): Promise<DeletionResult> {
  const user = await getServerUser();
  const client = await createSupabaseServerClient();

  let tier: PlanTier | null = null;
  let status: SubscriptionStatus | null = null;
  let stripeSubscriptionId: string | null = null;

  if (user && client) {
    const { data } = await client
      .from('subscriptions')
      .select('tier, status, stripe_subscription_id')
      .eq('user_id', user.id)
      .maybeSingle();

    tier = (data?.tier as PlanTier | undefined) ?? null;
    status = (data?.status as SubscriptionStatus | undefined) ?? null;
    stripeSubscriptionId = data?.stripe_subscription_id ?? null;
  }

  const decision = decideDeletion({
    userId: user?.id ?? null,
    confirmation,
    adminConfigured: isSupabaseAdminConfigured(),
    stripeConfigured: isStripeConfigured(),
    tier,
    status,
  });

  if (!decision.allowed) {
    serverLog('warn', 'account.deletion_refused', { reason: decision.reason });
    return refuse(decision.reason);
  }

  if (decision.cancelSubscriptionFirst && stripeSubscriptionId) {
    const cancelled = await cancelSubscriptionAtStripe(stripeSubscriptionId);
    if (!cancelled) {
      serverLog('error', 'account.deletion_blocked_by_cancel_failure', {});
      return refuse('active_subscription');
    }
  }

  const { error } = await getSupabaseAdminClient().auth.admin.deleteUser(decision.userId);

  if (error) {
    serverLog('error', 'account.deletion_failed', { reason: error.message });
    return refuse('failed');
  }

  // The user is gone; the cookie in this request is now a token for nothing.
  // Clearing it means the browser stops presenting it rather than retrying
  // until it expires.
  if (client) await client.auth.signOut();

  serverLog('info', 'account.deleted', {});
  return { ok: true };
}
