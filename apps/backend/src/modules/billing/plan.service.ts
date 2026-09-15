import type { PlanLimits, PlanTier, PaywallTrigger } from "@slate/shared";
import { limitsFor } from "@slate/shared";
import { prisma } from "../../prisma";

/**
 * The single place the backend decides whether a user is Pro.
 *
 * This previously lived inline in follows, watchlist and AI usage —
 * three copies of the same status comparison. Centralised so a change to
 * what counts as "entitled" (a new billing state, a new provider) happens
 * once, and so no future gate can accidentally implement it differently.
 *
 * Always derived from the verified Entitlement row. The client cannot
 * influence this.
 */
const ENTITLED_STATUSES = new Set(["ACTIVE", "GRACE_PERIOD"]);

export async function getPlanTier(userId: string): Promise<PlanTier> {
  const entitlement = await prisma.entitlement.findUnique({
    where: { userId },
    select: { status: true, expiresAt: true },
  });
  if (!entitlement || !ENTITLED_STATUSES.has(entitlement.status)) return "FREE";

  // A GRACE_PERIOD/ACTIVE row whose expiry has passed is not entitled —
  // guards against a stale row if a lifecycle sync was missed.
  if (entitlement.expiresAt && entitlement.expiresAt.getTime() <= Date.now()) return "FREE";

  return "PRO";
}

export async function getPlan(userId: string): Promise<{ tier: PlanTier; limits: PlanLimits }> {
  const tier = await getPlanTier(userId);
  return { tier, limits: limitsFor(tier) };
}

export function paywall(trigger: PaywallTrigger, error: string) {
  return { error, code: "PRO_REQUIRED" as const, trigger };
}
