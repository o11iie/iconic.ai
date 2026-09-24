import {
  ENTITLEMENT_KEYS,
  type EntitlementKey,
  type PlanTier,
} from '@/types/domain/billing';

/**
 * Metered allowances.
 *
 * ## Why this exists at all
 *
 * `Entitlement` has carried `limit` and `usage` since Gate 1, and both have
 * always been `null` and `0`. The tier map already encodes what they were for:
 * `material.upload` is a free capability and `material.unlimited_uploads` is a
 * paid one; `spatial.unlimited_sessions` likewise. The key names say plainly
 * that free access is metered and paying removes the meter. Nothing ever
 * implemented the meter, so "free" silently meant "unlimited" — which made the
 * paid tiers grant, in practice, nothing a free account did not already have.
 *
 * This module supplies the missing half. It does NOT re-decide who may do
 * what: `resolveEntitlements` in `@/lib/stripe/entitlements` remains the only
 * place a tier is mapped to capabilities, and this only says how many times.
 *
 * ## Why the numbers are here and not scattered
 *
 * A quota is a commercial promise. If it lives in three route handlers, three
 * people will change one of them, and a learner will be told a different
 * remaining balance on two screens. One object, named, reviewable.
 */

/**
 * What a capability costs per use, and how often it may be used for free.
 *
 * `null` means unmetered. A paid tier that grants a capability grants it
 * without a meter — that is what the `unlimited_*` keys have always meant.
 */
export const FREE_DAILY_LIMITS: Readonly<Partial<Record<EntitlementKey, number>>> = {
  /**
   * Generated flashcards, per day.
   *
   * Ten is a real study session's worth: enough that a free account is a
   * usable product rather than a demonstration, low enough that the paid tier
   * is worth buying. It is deliberately not 1 — a limit a learner hits before
   * understanding the feature teaches them the product is broken.
   */
  'ai.generate_flashcards': 10,

  /** Uploads per day. `material.unlimited_uploads` removes this. */
  'material.upload': 5,
};

/**
 * Capabilities whose use is counted.
 *
 * Derived from the limit table rather than repeated, so a key can never be
 * metered in one place and unmetered in another.
 */
export const METERED_KEYS: readonly EntitlementKey[] = ENTITLEMENT_KEYS.filter(
  (key) => key in FREE_DAILY_LIMITS,
);

export function isMetered(key: EntitlementKey): key is EntitlementKey {
  return key in FREE_DAILY_LIMITS;
}

/**
 * The daily allowance for a capability on a tier.
 *
 * `null` means no meter. Paid tiers are unmetered for everything they hold:
 * the meter is the free tier's shape, and removing it is what paying buys.
 */
export function limitFor(tier: PlanTier, key: EntitlementKey): number | null {
  if (tier !== 'free') return null;
  return FREE_DAILY_LIMITS[key] ?? null;
}

/** How a metered capability stands for one learner right now. */
export interface QuotaState {
  readonly key: EntitlementKey;
  /** Null means unmetered. */
  readonly limit: number | null;
  readonly used: number;
  readonly remaining: number | null;
  readonly exhausted: boolean;
}

export function quotaState(
  tier: PlanTier,
  key: EntitlementKey,
  used: number,
): QuotaState {
  const limit = limitFor(tier, key);
  const safeUsed = Number.isFinite(used) && used > 0 ? Math.floor(used) : 0;

  if (limit === null) {
    return { key, limit: null, used: safeUsed, remaining: null, exhausted: false };
  }

  const remaining = Math.max(0, limit - safeUsed);
  return { key, limit, used: safeUsed, remaining, exhausted: remaining === 0 };
}
