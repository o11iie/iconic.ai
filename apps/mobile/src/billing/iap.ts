import { Platform } from "react-native";
import {
  ErrorCode,
  endConnection,
  fetchProducts,
  finishTransaction,
  getAvailablePurchases,
  initConnection,
  purchaseErrorListener,
  purchaseUpdatedListener,
  requestPurchase,
} from "react-native-iap";
import type {
  ProductSubscriptionAndroid,
  Purchase,
  PurchaseAndroid,
  PurchaseError,
} from "react-native-iap";
import type { SlateProProductId } from "@slate/shared";

/**
 * Slate's only contact with Google Play Billing.
 *
 * Running on react-native-iap 14, which reaches the store through
 * `io.github.hyochan.openiap:openiap-google`, which in turn depends on
 * Play Billing Library 8.3.0. react-native-iap 12 and 13 pinned Billing 7,
 * whose new-app deadline passed on 31 August 2026, and they cannot be lifted
 * to 8 — they import `QueryPurchaseHistoryParams` and `PurchaseHistoryRecord`
 * and call `queryPurchaseHistoryAsync` and the no-argument
 * `enablePendingPurchases()`, all of which Billing 8 removed.
 *
 * Nothing here decides whether a user is Pro. A purchase produces a token;
 * the token goes to Slate's backend, which asks Google. A successful callback
 * on this side means "ask the server", never "grant access".
 *
 * The shape is different from react-native-iap 12: `requestPurchase` does not
 * resolve with the purchase. It starts the Play flow and the result arrives
 * on `purchaseUpdatedListener` or `purchaseErrorListener`. That is wrapped
 * back into a promise here so callers keep a linear flow, but the listeners
 * are the real source — including for a purchase that completes while the app
 * was backgrounded.
 */

export interface PurchaseResult {
  productId: string;
  purchaseToken: string;
  /**
   * Google has the purchase but has not completed it — a slow payment
   * method, a pending-transaction card. Not entitled yet; the backend
   * records PENDING rather than granting Pro.
   */
  isPending: boolean;
  /**
   * Billing 8.1+: the subscription exists but payment failed and the user
   * must fix it in Play. Play's guidance is explicit that entitlements must
   * not be granted for a suspended subscription.
   */
  isSuspended: boolean;
  /** Passed back to finishTransaction once the backend has verified. */
  raw: Purchase;
}

/** The user backed out of the Play sheet. Not an error worth alerting about. */
export class PurchaseCancelledError extends Error {
  constructor() {
    super("Purchase cancelled.");
  }
}

/** Play already has an active subscription for this account. Restore, don't re-buy. */
export class AlreadyOwnedError extends Error {
  constructor() {
    super("This Google account already has an active Slate Pro subscription.");
  }
}

export interface SubscriptionOption {
  productId: SlateProProductId;
  /** Play's localized price string — what the user will actually be charged. */
  formattedPrice: string | null;
  /**
   * Mandatory since Play Billing 5: a subscription SKU is a container of base
   * plans and offers, and a purchase must name exactly one.
   */
  offerToken: string;
}

let connected = false;

export async function initIap(): Promise<void> {
  if (Platform.OS !== "android" || connected) return;
  await initConnection();
  connected = true;
}

/** Closes the billing connection. Called when the paywall unmounts. */
export async function endIap(): Promise<void> {
  if (Platform.OS !== "android" || !connected) return;
  connected = false;
  await endConnection().catch(() => undefined);
}

/**
 * Narrows a Purchase to its Android shape. Written as a type guard rather
 * than a cast so the field names below are checked against the library's
 * types — `isSuspendedAndroid` and `purchaseState` only exist on the Android
 * variant, and a silent rename would otherwise read as `undefined` and
 * quietly stop suppressing suspended subscriptions.
 */
function isAndroidPurchase(purchase: Purchase): purchase is PurchaseAndroid {
  return purchase.platform === "android";
}

function toResult(purchase: Purchase): PurchaseResult {
  const android = isAndroidPurchase(purchase) ? purchase : null;
  return {
    productId: purchase.productId,
    purchaseToken: android?.purchaseToken ?? "",
    isPending: android?.purchaseState === "pending",
    isSuspended: android?.isSuspendedAndroid === true,
    raw: purchase,
  };
}

/**
 * Product discovery. Returns Play's own localized price alongside the offer
 * token needed to purchase.
 */
export async function fetchSubscriptionOptions(
  productIds: SlateProProductId[],
): Promise<SubscriptionOption[]> {
  const products = await fetchProducts({ skus: productIds, type: "subs" });
  const options: SubscriptionOption[] = [];

  for (const product of products ?? []) {
    const offers = (product as ProductSubscriptionAndroid).subscriptionOfferDetailsAndroid ?? [];
    // Offers come back most-specific first; the base plan is what Slate sells.
    const offer = offers[0];
    if (!offer?.offerToken) continue;

    const phases = offer.pricingPhases?.pricingPhaseList ?? [];
    // The last phase is the recurring price. An introductory phase, if one is
    // ever configured in Play, comes first and is not the ongoing cost.
    const recurring = phases[phases.length - 1];

    options.push({
      productId: product.id as SlateProProductId,
      formattedPrice: recurring?.formattedPrice ?? null,
      offerToken: offer.offerToken,
    });
  }

  return options;
}

/** How long to wait for Play to call back before giving up on the promise. */
const PURCHASE_TIMEOUT_MS = 180_000;

/**
 * Starts the Play purchase flow and resolves with the token to verify
 * server-side.
 *
 * `obfuscatedAccountId` ties the purchase to the Slate account that initiated
 * it. Google surfaces it in the Developer API, which gives support and fraud
 * review a way to tell whose purchase a token is, and it is the identifier
 * Play recommends for exactly this.
 */
export async function purchaseSubscription(
  option: SubscriptionOption,
  obfuscatedAccountId?: string,
): Promise<PurchaseResult> {
  return new Promise<PurchaseResult>((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      if (settled) return;
      settled = true;
      updated.remove();
      failed.remove();
      clearTimeout(timer);
    };

    const updated = purchaseUpdatedListener((purchase: Purchase) => {
      // Play can replay purchases for other SKUs on connect; only settle on
      // the one this call asked for.
      if (purchase.productId !== option.productId) return;
      cleanup();
      resolve(toResult(purchase));
    });

    const failed = purchaseErrorListener((error: PurchaseError) => {
      cleanup();
      if (error.code === ErrorCode.UserCancelled) return reject(new PurchaseCancelledError());
      if (error.code === ErrorCode.AlreadyOwned) return reject(new AlreadyOwnedError());
      reject(new Error(error.message || "Purchase failed."));
    });

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Google Play didn't respond. If you were charged, use Restore purchases."));
    }, PURCHASE_TIMEOUT_MS);

    requestPurchase({
      type: "subs",
      request: {
        google: {
          skus: [option.productId],
          subscriptionOffers: [{ sku: option.productId, offerToken: option.offerToken }],
          ...(obfuscatedAccountId ? { obfuscatedAccountId } : {}),
        },
      },
    }).catch((err: unknown) => {
      cleanup();
      reject(err instanceof Error ? err : new Error("Purchase failed."));
    });
  });
}

/**
 * Acknowledges the purchase with Play so it is not auto-refunded after three
 * days, and clears it from the pending queue.
 *
 * Called only AFTER Slate's backend has verified the token. Acknowledging
 * first would be telling Google the goods were delivered before establishing
 * that the purchase was genuine. The backend also acknowledges through the
 * Play Developer API, which is the path that survives the app being killed;
 * both are idempotent, so doing both is safe and neither alone is a gap.
 */
export async function completePurchase(result: PurchaseResult): Promise<void> {
  // Subscriptions are never consumable.
  await finishTransaction({ purchase: result.raw, isConsumable: false });
}

/** Used for "Restore purchases": re-reads whatever Play already knows this device owns. */
export async function getExistingPurchases(): Promise<PurchaseResult[]> {
  // Suspended subscriptions are included deliberately so the caller can tell
  // "payment is broken, fix it in Play" apart from "you own nothing".
  const purchases = await getAvailablePurchases({ includeSuspendedAndroid: true });
  return (purchases ?? []).map(toResult).filter((p) => p.purchaseToken.length > 0);
}
