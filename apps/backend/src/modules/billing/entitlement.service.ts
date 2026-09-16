import { Prisma } from "@prisma/client";
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
 * A purchase token that already belongs to a different Slate account.
 *
 * Google Play issues one purchase token per subscription, not per account,
 * and the token is visible to the device that made the purchase. Without
 * this check a token lifted from one device could be submitted on any other
 * account: `/billing/verify-purchase` would ask Google "is this real and
 * active?", get "yes", and grant the caller Pro. One paid subscription
 * could be replayed onto unlimited accounts.
 *
 * The existing (purchaseToken, rawStatus) idempotency constraint blocks the
 * naive replay, but only while Google reports a state already recorded for
 * that token — a subscription moving ACTIVE -> IN_GRACE_PERIOD opens the
 * window again. Ownership has to be checked explicitly.
 *
 * It also keeps RTDN routing deterministic: notifications carry no Slate
 * identity and are matched purely on the token, so two entitlements holding
 * the same token makes which user gets renewed arbitrary.
 */
export class PurchaseTokenAlreadyBoundError extends Error {
  constructor() {
    super("This purchase is already linked to a different Slate account.");
  }
}

/**
 * The account a purchase token is already bound to, or null if it is unseen.
 *
 * PurchaseEvent is the durable record — it is append-only and survives the
 * entitlement's `latestPurchaseToken` being overwritten by a later purchase,
 * so it is checked first.
 */
async function findExistingOwner(purchaseToken: string): Promise<string | null> {
  const event = await prisma.purchaseEvent.findFirst({
    where: { purchaseToken },
    select: { entitlement: { select: { userId: true } } },
  });
  if (event) return event.entitlement.userId;

  const bound = await prisma.entitlement.findFirst({
    where: { latestPurchaseToken: purchaseToken },
    select: { userId: true },
  });
  return bound?.userId ?? null;
}

/**
 * Gets or creates the user's entitlement row.
 *
 * `upsert` is not atomic against a concurrent insert: two parallel calls for
 * a user who has no row yet both see nothing, both try to create, and the
 * loser trips the unique constraint on userId. That is not hypothetical here
 * — Pub/Sub can deliver the first notification for a subscription twice in
 * parallel, and a 500 makes Google redeliver it forever.
 */
async function ensureEntitlement(userId: string) {
  const existing = await prisma.entitlement.findUnique({ where: { userId } });
  if (existing) return existing;

  try {
    return await prisma.entitlement.create({ data: { userId, status: "PENDING" } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      // Someone else created it between the read and the write. Read it back.
      const raced = await prisma.entitlement.findUnique({ where: { userId } });
      if (raced) return raced;
    }
    throw err;
  }
}

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

  // Play returns expiry as an RFC3339 string. A malformed or absent value
  // would become an Invalid Date, which silently reads as "expired" and
  // would deny Pro to someone who has paid — fail loudly instead.
  const expiresAt = new Date(lineItem.expiryTime);
  if (Number.isNaN(expiresAt.getTime())) {
    throw new InvalidPurchaseError(`Play purchase has an unusable expiryTime: ${lineItem.expiryTime}`);
  }

  // A token belongs to exactly one account, for the whole of its life.
  const existingOwner = await findExistingOwner(purchaseToken);
  if (existingOwner !== null && existingOwner !== userId) {
    throw new PurchaseTokenAlreadyBoundError();
  }

  const status = mapPlayState(purchase.subscriptionState);

  const entitlement = await ensureEntitlement(userId);

  // The entitlement is always written to whatever Google currently reports.
  //
  // This used to be skipped whenever a (token, status) pair had been seen
  // before, which looked like deduplication and was in fact data loss: a
  // subscription reports ACTIVE again on every single renewal, so the second
  // month's notification was discarded, expiresAt stayed pinned to the first
  // period, and a paying subscriber silently lost Pro while still being
  // charged. The same bug froze anyone whose payment failed and recovered
  // (IN_GRACE_PERIOD -> ACTIVE) at GRACE_PERIOD forever.
  //
  // Writing Google's current answer is idempotent by nature — setting the
  // same status and expiry twice is indistinguishable from doing it once — so
  // no guard is needed here at all. Deduplication belongs only on the audit
  // log, which is append-only and therefore genuinely needs it.
  try {
    await prisma.$transaction([
      prisma.entitlement.update({
        where: { userId },
        data: {
          productId: lineItem.productId as SlateProProduct,
          status,
          expiresAt,
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
          expiresAt,
        },
      }),
    ]);
  } catch (err) {
    // A duplicate audit row means this exact notification — same token, same
    // status, same expiry — has already been applied. Pub/Sub delivers
    // at-least-once, so that is expected traffic, not a fault. Swallowing it
    // keeps the webhook returning 200 rather than 500, which is what stops
    // Google redelivering the same message forever.
    //
    // The entitlement write is in the same transaction and rolls back with
    // it, which is correct: it would have written the values already there.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return;
    throw err;
  }
}

export async function getEntitlement(userId: string) {
  return prisma.entitlement.findUnique({ where: { userId } });
}

export function isEntitlementActive(status: EntitlementStatus, expiresAt: Date | null): boolean {
  if (status !== "ACTIVE" && status !== "GRACE_PERIOD" && status !== "CANCELLED") return false;
  if (!expiresAt) return false;
  return expiresAt.getTime() > Date.now();
}
