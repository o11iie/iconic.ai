/**
 * Entitlement domain. This mirrors what the BACKEND persists as the source
 * of truth. The mobile client must always treat its local purchase state as
 * provisional (`PENDING`) until the backend confirms verification — a client
 * flag alone must never unlock Pro features. See apps/backend/src/modules/billing.
 */
export type SlateProProductId = "SLATE_PRO_MONTHLY" | "SLATE_PRO_YEARLY";

export type EntitlementStatus =
  | "NONE"
  | "PENDING" // purchase token received, verification in flight
  | "ACTIVE"
  | "GRACE_PERIOD" // payment issue, Google-defined grace window
  | "ON_HOLD" // payment failed, access suspended pending resolution
  | "CANCELLED" // user cancelled, access continues until expiry
  | "EXPIRED"
  | "REVOKED"; // refunded / chargeback / policy violation

export interface Entitlement {
  userId: string;
  productId: SlateProProductId;
  status: EntitlementStatus;
  /** ISO-8601. When ACTIVE/GRACE_PERIOD/CANCELLED access should be treated as valid until this instant. */
  expiresAt: string | null;
  autoRenewing: boolean;
  startedAt: string;
  updatedAt: string;
  /** Google Play purchase token — never sent to any client other than the owning user's own device for restore. */
  latestPurchaseToken?: string;
}

export interface ProductCatalogEntry {
  productId: SlateProProductId;
  /** Display price is sourced from Play Billing at purchase time; this is the configured hypothesis for server-side display/testing only. */
  referencePriceUsd: number;
  billingPeriod: "P1M" | "P1Y";
  trialDays?: number;
}

export function isEntitlementActive(entitlement: Pick<Entitlement, "status" | "expiresAt">): boolean {
  if (entitlement.status !== "ACTIVE" && entitlement.status !== "GRACE_PERIOD" && entitlement.status !== "CANCELLED") {
    return false;
  }
  if (!entitlement.expiresAt) return false;
  return new Date(entitlement.expiresAt).getTime() > Date.now();
}
