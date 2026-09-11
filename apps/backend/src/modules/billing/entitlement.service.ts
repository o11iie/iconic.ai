import { prisma } from "../../prisma";
import type { EntitlementStatus, SlateProProduct } from "@prisma/client";
import type { PlaySubscriptionPurchase } from "./play-verification";
import { isValidProductId } from "../../config/products";

/** Maps Play Developer API subscription states to Slate's own entitlement state machine. */
function mapPlayState(state: string): EntitlementStatus {
  switch (state) {
    case "SUBSCRIPTION_STATE_ACTIVE":
      return "ACTIVE";
    case "SUBSCRIPTION_STATE_IN_GRACE_PERIOD":
      return "GRACE_PERIOD";
    case "SUBSCRIPTION_STATE_ON_HOLD":
      return "ON_HOLD";
    case "SUBSCRIPTION_STATE_CANCELED":
      return "CANCELLED";
    case "SUBSCRIPTION_STATE_EXPIRED":
      return "EXPIRED";
    case "SUBSCRIPTION_STATE_PENDING":
      return "PENDING";
    default:
      return "NONE";
  }
}

export class InvalidPurchaseError extends Error {}

/**
 * Applies a verified Play purchase to a user's entitlement, idempotently.
 * `PurchaseEvent`'s unique(purchaseToken, rawStatus) constraint means
 * re-delivering the same RTDN notification (Pub/Sub at-least-once
 * delivery) or the client re-submitting the same token is a safe no-op.
 */
export async function applyVerifiedPurchase(
  userId: string,
  purchase: PlaySubscriptionPurchase,
  purchaseToken: string,
): Promise<void> {
  const lineItem = purchase.lineItems[0];
  if (!lineItem || !isValidProductId(lineItem.productId)) {
    throw new InvalidPurchaseError(`Unrecognized product id in Play purchase: ${lineItem?.productId}`);
  }

  const status = mapPlayState(purchase.subscriptionState);

  const entitlement = await prisma.entitlement.upsert({
    where: { userId },
    create: { userId, status: "PENDING" },
    update: {},
  });

  const alreadyProcessed = await prisma.purchaseEvent.findUnique({
    where: { purchaseToken_rawStatus: { purchaseToken, rawStatus: purchase.subscriptionState } },
  });
  if (alreadyProcessed) return; // idempotent: this exact (token, status) pair was already applied

  await prisma.$transaction([
    prisma.entitlement.update({
      where: { userId },
      data: {
        productId: lineItem.productId as SlateProProduct,
        status,
        expiresAt: new Date(lineItem.expiryTime),
        autoRenewing: lineItem.autoRenewingPlan?.autoRenewEnabled ?? false,
        startedAt: entitlement.startedAt ?? new Date(),
        latestPurchaseToken: purchaseToken,
      },
    }),
    prisma.purchaseEvent.create({
      data: {
        entitlementId: entitlement.id,
        purchaseToken,
        productId: lineItem.productId as SlateProProduct,
        rawStatus: purchase.subscriptionState,
      },
    }),
  ]);
}

export async function getEntitlement(userId: string) {
  return prisma.entitlement.findUnique({ where: { userId } });
}

export function isEntitlementActive(status: EntitlementStatus, expiresAt: Date | null): boolean {
  if (status !== "ACTIVE" && status !== "GRACE_PERIOD" && status !== "CANCELLED") return false;
  if (!expiresAt) return false;
  return expiresAt.getTime() > Date.now();
}
